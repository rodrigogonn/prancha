'use strict'

// ---------- dados fixos ----------
const PAPEIS = [
  ['A4', 'A4', 210, 297],
  ['A5', 'A5', 148, 210],
  ['A3', 'A3', 297, 420],
  ['carta', 'Carta', 215.9, 279.4],
  ['oficio', 'Ofício', 216, 330],
  ['foto10x15', 'Foto 10 × 15', 100, 150],
  ['foto13x18', 'Foto 13 × 18', 130, 180],
  ['custom', 'Outro', 0, 0],
]
const PRESETS = [
  ['3 × 4', 30, 40], ['5 × 7', 50, 70], ['10 × 15', 100, 150], ['13 × 18', 130, 180],
  ['15 × 21', 150, 210], ['Quadrada 6 × 6', 60, 60], ['Cartão 9 × 5', 90, 50], ['Polaroid 8,8 × 10,7', 88, 107],
]
const ESPACO_SUG = 4, MARGEM_SUG = 5, SANGRIA = 1

const uid = () => Math.random().toString(36).slice(2, 10)
const $ = (id) => document.getElementById(id)
const cm = (mm) => (Math.round(mm) / 10).toLocaleString('pt-BR', { maximumFractionDigits: 1 })
const lerCm = (txt) => { const v = parseFloat(String(txt).replace(',', '.')); return isFinite(v) && v > 0 ? Math.round(v * 10 * 10) / 10 : null }

function estadoInicial() {
  return {
    papel: 'A4', papelW: 210, papelH: 297, deitado: false,
    margem: MARGEM_SUG, espaco: ESPACO_SUG,
    guias: 'cantos', sangria: true, girar: true, girarFoto: true, centralizar: false,
    ativo: null,
    grupos: [novoGrupo(30, 40, 6)],
  }
}
function novoGrupo(w, h, n) {
  return { id: uid(), w, h, quadros: Array.from({ length: n }, () => ({ img: null, crop: null })) }
}

let state = estadoInicial()
const imgs = new Map() // id -> { blob, prev (desenhável), w, h }
let selecionado = null // quadro selecionado (objeto)

// ---------- armazenamento (opcional: o app funciona sem) ----------
const CHAVE = 'medidinha'
let dbp = null
function db() {
  if (!dbp) dbp = new Promise((res, rej) => {
    try {
      const r = indexedDB.open(CHAVE, 1)
      r.onupgradeneeded = () => r.result.createObjectStore('imgs')
      r.onsuccess = () => res(r.result)
      r.onerror = () => rej(r.error)
    } catch (e) { rej(e) }
  })
  return dbp
}
async function idb(modo, fn) {
  try {
    const d = await db()
    return await new Promise((res, rej) => {
      const t = d.transaction('imgs', modo)
      const r = fn(t.objectStore('imgs'))
      t.oncomplete = () => res(r && r.result)
      t.onerror = () => rej(t.error)
    })
  } catch { return null }
}
let salvarTimer = null
function salvar() {
  clearTimeout(salvarTimer)
  salvarTimer = setTimeout(() => {
    try { localStorage.setItem(CHAVE, JSON.stringify(state)) } catch {}
    const usados = new Set()
    state.grupos.forEach(g => g.quadros.forEach(q => q.img && usados.add(q.img)))
    for (const id of [...imgs.keys()]) {
      if (!usados.has(id)) { imgs.delete(id); idb('readwrite', s => s.delete(id)) }
    }
  }, 300)
}
async function carregar() {
  let salvo = null
  try { salvo = JSON.parse(localStorage.getItem(CHAVE) || 'null') } catch {}
  if (!salvo || !Array.isArray(salvo.grupos)) return
  state = Object.assign(estadoInicial(), salvo)
  const ids = new Set()
  state.grupos.forEach(g => g.quadros.forEach(q => q.img && ids.add(q.img)))
  for (const id of ids) {
    const blob = await idb('readonly', s => s.get(id))
    if (blob) { try { imgs.set(id, await prepararBlob(blob)) } catch {} }
  }
  state.grupos.forEach(g => g.quadros.forEach(q => { if (q.img && !imgs.has(q.img)) { q.img = null; q.crop = null } }))
}

// ---------- imagens ----------
async function decodificar(blob) {
  if (window.createImageBitmap) {
    try { return await createImageBitmap(blob, { imageOrientation: 'from-image' }) } catch {}
  }
  return await new Promise((res, rej) => {
    const im = new Image()
    im.onload = () => res(im)
    im.onerror = rej
    im.src = URL.createObjectURL(blob)
  })
}
const larg = (im) => im.naturalWidth || im.width
const alt = (im) => im.naturalHeight || im.height

function reduzir(src, w, h, max) {
  const k = Math.min(1, max / Math.max(w, h))
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k))
  const x = c.getContext('2d')
  x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height)
  x.imageSmoothingQuality = 'high'
  x.drawImage(src, 0, 0, c.width, c.height)
  return c
}
async function prepararBlob(blob) {
  const im = await decodificar(blob)
  const w = larg(im), h = alt(im)
  const prev = reduzir(im, w, h, 1100)
  if (im.close) im.close()
  return { blob, prev, w, h }
}
// Arquivo que chega: guarda no máximo 3600 px no lado maior (sobra para 300 dpi até 30 cm).
async function importar(file) {
  const im = await decodificar(file)
  const w = larg(im), h = alt(im)
  let blob = file
  if (Math.max(w, h) > 3600 || !/^image\/(jpeg|png|webp)$/.test(file.type)) {
    const c = reduzir(im, w, h, 3600)
    blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.93))
  }
  if (im.close) im.close()
  const info = await prepararBlob(blob)
  const id = uid()
  imgs.set(id, info)
  idb('readwrite', s => s.put(blob, id))
  return id
}

// ---------- recorte ----------
function rot4(c) { return (((c && c.r) || 0) % 4 + 4) % 4 }
function medidasCrop(f, lw, lh, c) {
  const r = rot4(c)
  const iw = r % 2 ? f.h : f.w, ih = r % 2 ? f.w : f.h
  const cover = Math.max(lw / iw, lh / ih)
  const minS = Math.min(lw / iw, lh / ih) / cover
  return { iw, ih, cover, minS }
}
function limitarCrop(c, f, lw, lh) {
  const m = medidasCrop(f, lw, lh, c)
  c.s = Math.min(8, Math.max(m.minS, c.s))
  const dw = m.iw * m.cover * c.s, dh = m.ih * m.cover * c.s
  const mx = Math.abs(dw - lw) / 2 / lw, my = Math.abs(dh - lh) / 2 / lh
  c.x = Math.min(mx, Math.max(-mx, c.x))
  c.y = Math.min(my, Math.max(-my, c.y))
  return c
}
function cropPadrao() { return { s: 1, x: 0, y: 0, r: 0 } }
// Medida do quadro como a foto o vê: quadro "virado" troca largura e altura (foto deitada num tamanho em pé).
const dimsQ = (g, q) => q.vira ? [g.h, g.w] : [g.w, g.h]
// Desenha a foto no quadro lógico lw×lh centrado na origem (unidades: mm).
function desenharFoto(ctx, src, f, lw, lh, c) {
  const m = medidasCrop(f, lw, lh, c)
  const sc = m.cover * c.s
  ctx.save()
  ctx.translate(c.x * lw, c.y * lh)
  ctx.rotate(rot4(c) * Math.PI / 2)
  ctx.drawImage(src, -f.w * sc / 2, -f.h * sc / 2, f.w * sc, f.h * sc)
  ctx.restore()
}

// ---------- montagem da folha ----------
function dimsPapel() {
  const w = state.papelW, h = state.papelH
  return state.deitado ? { W: Math.max(w, h), H: Math.min(w, h) } : { W: Math.min(w, h), H: Math.max(w, h) }
}
function cabem(w, h) {
  const { W, H } = dimsPapel(), m = state.margem, e = state.espaco
  const uw = W - 2 * m, uh = H - 2 * m
  if (w > uw + 1e-6 || h > uh + 1e-6) return 0
  return Math.floor((uw + e + 1e-6) / (w + e)) * Math.floor((uh + e + 1e-6) / (h + e))
}
// Girar um tamanho inteiro só quando isso economiza folha; empate fica como está, sem foto de lado à toa.
function montar() {
  const n = state.grupos.length, rots = new Array(n).fill(false)
  if (state.girar) for (let i = 0; i < n; i++) {
    const a = montarCom(rots).folhas.length
    rots[i] = true
    const b = montarCom(rots).folhas.length
    rots[i] = b < a
  }
  const L = montarCom(rots)
  L.rots = rots
  return L
}
function montarCom(rots) {
  const { W, H } = dimsPapel(), m = state.margem, e = state.espaco
  const uw = W - 2 * m, uh = H - 2 * m
  const folhas = [], naoCabe = []
  let folha = null, x = 0, y = 0, alturaLinha = 0, linha = null
  const novaFolha = () => { folha = { itens: [], linhas: [] }; folhas.push(folha); x = 0; y = 0; alturaLinha = 0; linha = []; folha.linhas.push(linha) }
  const novaLinha = () => { y += alturaLinha + e; x = 0; alturaLinha = 0; linha = []; folha.linhas.push(linha) }
  const cabe = (w, h) => w <= uw + 1e-6 && h <= uh + 1e-6
  state.grupos.forEach((g, gi) => {
    if (!cabe(g.w, g.h) && !cabe(g.h, g.w)) { naoCabe.push(g); return }
    g.quadros.forEach((q, qi) => {
      const [lw, lh] = dimsQ(g, q)
      let rot = !!rots[gi]
      if (!cabe(...(rot ? [lh, lw] : [lw, lh]))) rot = !rot
      const w = rot ? lh : lw, h = rot ? lw : lh
      if (!folha) novaFolha()
      if (x > 0 && x + w > uw + 1e-6) novaLinha()
      if (y + h > uh + 1e-6) novaFolha()
      const it = { g, q, qi, x: m + x, y: m + y, w, h, rot }
      folha.itens.push(it); linha.push(it)
      x += w + e; alturaLinha = Math.max(alturaLinha, h)
    })
  })
  if (state.centralizar) {
    for (const f of folhas) for (const l of f.linhas) {
      if (!l.length) continue
      const fim = l[l.length - 1]
      const dx = (uw - (fim.x + fim.w - l[0].x)) / 2
      l.forEach(it => { it.x += dx })
    }
  }
  return { folhas, naoCabe, W, H }
}
const sangriaAtual = () => state.sangria ? Math.min(SANGRIA, state.espaco / 2) : 0

function desenharFolha(ctx, folha, L, k, modo, fontes) {
  const b = sangriaAtual()
  ctx.save()
  ctx.scale(k, k)
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, L.W, L.H)
  if (modo === 'tela' && state.margem > 0) {
    ctx.save()
    ctx.strokeStyle = 'rgba(63,182,142,.45)'; ctx.lineWidth = 0.3; ctx.setLineDash([2, 1.5])
    ctx.strokeRect(state.margem, state.margem, L.W - 2 * state.margem, L.H - 2 * state.margem)
    ctx.restore()
  }
  for (const it of folha.itens) {
    const f = it.q.img && fontes(it.q.img)
    const [lw, lh] = dimsQ(it.g, it.q)
    ctx.save()
    ctx.translate(it.x + it.w / 2, it.y + it.h / 2)
    if (it.rot) ctx.rotate(Math.PI / 2)
    if (f) {
      ctx.save()
      ctx.beginPath(); ctx.rect(-lw / 2 - b, -lh / 2 - b, lw + 2 * b, lh + 2 * b); ctx.clip()
      desenharFoto(ctx, f.src, f, lw, lh, it.q.crop || cropPadrao(f, lw, lh))
      ctx.restore()
    } else if (modo === 'tela') {
      ctx.fillStyle = '#fff3ea'; ctx.fillRect(-lw / 2, -lh / 2, lw, lh)
      ctx.strokeStyle = '#f5b28e'; ctx.lineWidth = 0.4; ctx.setLineDash([1.6, 1.2])
      ctx.strokeRect(-lw / 2, -lh / 2, lw, lh); ctx.setLineDash([])
      const fs = Math.max(2.4, Math.min(lw, lh) * 0.12)
      ctx.fillStyle = '#e08455'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.font = `800 ${fs * 1.6}px Nunito, system-ui, sans-serif`
      ctx.fillText('+', 0, -fs * 0.7)
      ctx.font = `800 ${fs}px Nunito, system-ui, sans-serif`
      ctx.fillText(`${cm(lw)} × ${cm(lh)}`, 0, fs * 0.9)
    }
    ctx.restore()
  }
  desenharGuias(ctx, folha, b, modo, fontes)
  if (modo === 'tela' && selecionado) {
    const it = folha.itens.find(i => i.q === selecionado)
    if (it) {
      ctx.strokeStyle = '#ff7a45'; ctx.lineWidth = Math.max(0.8, 1.6 / k * 2)
      ctx.strokeRect(it.x - 0.6, it.y - 0.6, it.w + 1.2, it.h + 1.2)
    }
  }
  if (modo === 'tela' && arraste && arraste.alvo) {
    const it = folha.itens.find(i => i.q === arraste.alvo)
    if (it) {
      ctx.fillStyle = 'rgba(255,122,69,.2)'; ctx.fillRect(it.x, it.y, it.w, it.h)
      ctx.strokeStyle = '#ff7a45'; ctx.lineWidth = 0.8; ctx.strokeRect(it.x, it.y, it.w, it.h)
    }
  }
  ctx.restore()
}
function desenharGuias(ctx, folha, b, modo, fontes) {
  if (state.guias === 'nada') return
  const e = state.espaco
  ctx.save()
  ctx.strokeStyle = '#6b6b6b'; ctx.lineWidth = 0.2; ctx.setLineDash([])
  for (const it of folha.itens) {
    if (modo !== 'tela' && !(it.q.img && fontes(it.q.img))) continue
    if (state.guias === 'contorno') { ctx.strokeRect(it.x, it.y, it.w, it.h); continue }
    // Marcas nos cantos: prolongam as bordas para fora, sem entrar na sangria do vizinho.
    const o = b + 0.4
    const L = Math.min(4, e - o - b)
    if (L < 0.6) { ctx.strokeRect(it.x, it.y, it.w, it.h); continue }
    const x0 = it.x, y0 = it.y, x1 = it.x + it.w, y1 = it.y + it.h
    ctx.beginPath()
    for (const [cx, sx] of [[x0, -1], [x1, 1]]) for (const [cy, sy] of [[y0, -1], [y1, 1]]) {
      ctx.moveTo(cx + sx * o, cy); ctx.lineTo(cx + sx * (o + L), cy)
      ctx.moveTo(cx, cy + sy * o); ctx.lineTo(cx, cy + sy * (o + L))
    }
    ctx.stroke()
  }
  ctx.restore()
}

// ---------- tela ----------
let ultimoL = null
const canvases = []
function render() {
  const L = montar()
  ultimoL = L
  const cont = $('folhas'), prev = $('previa')
  const estreito = window.innerWidth <= 820
  const cw = prev.clientWidth - (estreito ? 24 : 40)
  const ch = prev.clientHeight - prev.querySelector('.barra-previa').offsetHeight - $('avisos').offsetHeight - 110
  let dw = estreito ? Math.min(cw, window.innerHeight * 0.58 * L.W / L.H) : Math.min(cw, ch * L.W / L.H)
  dw = Math.max(200, Math.min(dw, 900))
  const dh = dw * L.H / L.W
  const n = Math.max(1, L.folhas.length)
  while (canvases.length < n) {
    const wrap = document.createElement('div'); wrap.className = 'folha-wrap'
    const rot = document.createElement('div'); rot.className = 'rot'
    const c = document.createElement('canvas')
    wrap.append(c, rot); cont.append(wrap)
    ligarCanvas(c, canvases.length)
    canvases.push({ wrap, rot, c })
  }
  while (canvases.length > n) canvases.pop().wrap.remove()
  const dpr = Math.min(2.5, window.devicePixelRatio || 1)
  const fontes = (id) => { const i = imgs.get(id); return i && { src: i.prev, w: i.w, h: i.h } }
  canvases.forEach((cv, i) => {
    const folha = L.folhas[i] || { itens: [], linhas: [] }
    cv.c.style.width = dw + 'px'; cv.c.style.height = dh + 'px'
    const pw = Math.round(dw * dpr), ph = Math.round(dh * dpr)
    if (cv.c.width !== pw || cv.c.height !== ph) { cv.c.width = pw; cv.c.height = ph }
    const ctx = cv.c.getContext('2d')
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    desenharFolha(ctx, folha, L, pw / L.W, 'tela', fontes)
    cv.rot.textContent = n > 1 ? `Folha ${i + 1} de ${n}` : `${cm(L.W)} × ${cm(L.H)} cm`
  })
  // resumo e avisos
  const total = state.grupos.reduce((s, g) => s + g.quadros.length, 0)
  const comFoto = state.grupos.reduce((s, g) => s + g.quadros.filter(q => q.img).length, 0)
  const nomePapel = state.papel === 'custom' ? `${cm(state.papelW)} × ${cm(state.papelH)} cm` : (PAPEIS.find(p => p[0] === state.papel) || ['', ''])[1]
  $('resumo').textContent = `${nomePapel} ${state.deitado ? 'deitado' : 'em pé'} · ${comFoto} de ${total} com foto · ${L.folhas.length || 1} ${L.folhas.length > 1 ? 'folhas' : 'folha'}`
  const av = []
  for (const g of L.naoCabe) av.push(['alerta', `${cm(g.w)} × ${cm(g.h)} cm não cabe nesse papel. Tente virar o papel ou diminuir a margem.`])
  if (total && !comFoto) av.push(['', '👆 Toque num quadrinho para pôr a foto, ou arraste as fotos para cima da folha.'])
  else if (comFoto < total) av.push(['', `${total - comFoto} ${total - comFoto > 1 ? 'quadrinhos vazios ficam' : 'quadrinho vazio fica'} de fora da impressão.`])
  $('avisos').innerHTML = av.map(([c, t]) => `<div class="${c}">${t}</div>`).join('')
  const temFoto = comFoto > 0
  for (const id of ['btnImprimir', 'btnPdf', 'btnPng']) $(id).disabled = !temFoto
  renderGrupos(L)
  salvar()
}

function itemEm(i, ev) {
  const L = ultimoL, folha = L && L.folhas[i]
  if (!folha) return null
  const r = canvases[i].c.getBoundingClientRect()
  const x = (ev.clientX - r.left) / r.width * L.W, y = (ev.clientY - r.top) / r.height * L.H
  return folha.itens.find(it => x >= it.x && x <= it.x + it.w && y >= it.y && y <= it.y + it.h) || null
}

let arraste = null
function ligarCanvas(c, i) {
  c.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return
    const it = itemEm(i, ev)
    if (!it) return
    arraste = { origem: it, x: ev.clientX, y: ev.clientY, ativo: false, alvo: null, mouse: ev.pointerType === 'mouse' }
  })
  c.addEventListener('pointermove', (ev) => {
    if (!arraste || !arraste.mouse || !arraste.origem.q.img) return
    if (!arraste.ativo && Math.hypot(ev.clientX - arraste.x, ev.clientY - arraste.y) > 6) { arraste.ativo = true; c.classList.add('arrastando') }
    if (arraste.ativo) {
      const alvo = itemEm(i, ev)
      const novo = alvo && alvo.q !== arraste.origem.q ? alvo.q : null
      if (novo !== arraste.alvo) { arraste.alvo = novo; render() }
    }
  })
  c.addEventListener('pointerup', (ev) => {
    const a = arraste; arraste = null; c.classList.remove('arrastando')
    if (!a) return
    if (a.ativo) {
      if (a.alvo) trocar(a.origem.q, a.alvo)
      render(); return
    }
    const it = itemEm(i, ev)
    if (!it || it.q !== a.origem.q) return
    selecionado = it.q
    if (it.q.img) abrirEditor(it)
    else escolherArquivos(it.g, it.q)
    render()
  })
  c.addEventListener('pointerleave', () => { if (arraste && arraste.ativo) { arraste.alvo = null; render() } })
  c.addEventListener('dragover', (ev) => { ev.preventDefault(); ev.dataTransfer.dropEffect = 'copy' })
  c.addEventListener('drop', (ev) => {
    ev.preventDefault()
    const files = [...ev.dataTransfer.files].filter(f => f.type.startsWith('image/'))
    if (!files.length) return
    const it = itemEm(i, ev)
    preencher(files, it ? it.g : grupoAtivo(), it ? it.q : null)
  })
}
function trocar(a, b) {
  const ga = state.grupos.find(g => g.quadros.includes(a)), gb = state.grupos.find(g => g.quadros.includes(b))
  ;[a.img, b.img] = [b.img, a.img]
  ;[a.vira, b.vira] = [b.vira, a.vira]
  if (ga === gb) [a.crop, b.crop] = [b.crop, a.crop]
  else { a.crop = null; b.crop = null }
  selecionado = b
}

// drop na área toda (fora da folha) cai no tamanho ativo
let soltaTimer = null
document.addEventListener('dragover', (ev) => {
  ev.preventDefault()
  $('folhas').classList.add('soltando')
  clearTimeout(soltaTimer); soltaTimer = setTimeout(() => $('folhas').classList.remove('soltando'), 150)
})
document.addEventListener('drop', (ev) => {
  ev.preventDefault()
  if (ev.target.tagName === 'CANVAS') return
  const files = [...(ev.dataTransfer?.files || [])].filter(f => f.type.startsWith('image/'))
  if (files.length) preencher(files, grupoAtivo(), null)
})

function grupoAtivo() {
  return state.grupos.find(g => g.id === state.ativo) || state.grupos[0]
}

let destinoArquivo = null
function escolherArquivos(g, q) {
  destinoArquivo = { g, q }
  $('arquivo').value = ''
  $('arquivo').click()
}
$('arquivo').addEventListener('change', () => {
  const files = [...$('arquivo').files]
  const d = destinoArquivo || { g: grupoAtivo(), q: null }
  destinoArquivo = null
  if (files.length) preencher(files, d.g, d.q, d.trocar)
})

// Coloca as fotos a partir do quadro clicado, depois nos vazios; o que sobrar vira quadro novo.
async function preencher(files, g, inicio, soEste) {
  if (!g) { g = novoGrupo(30, 40, 0); state.grupos.push(g) }
  ocupado(true, files.length > 1 ? `Carregando ${files.length} fotos…` : 'Carregando…')
  try {
    const ids = []
    for (const f of files) { try { ids.push(await importar(f)) } catch { toast(`Não consegui abrir ${f.name}`) } }
    const alvos = []
    if (inicio) alvos.push(inicio)
    if (!soEste) {
      for (const q of g.quadros) if (!q.img && q !== inicio) alvos.push(q)
      for (const og of state.grupos) if (og !== g) for (const q of og.quadros) if (!q.img) alvos.push(q)
    }
    let girou = 0
    ids.forEach((id, n) => {
      let q = alvos[n]
      if (!q) { q = { img: null, crop: null }; g.quadros.push(q) }
      const dono = state.grupos.find(x => x.quadros.includes(q))
      q.img = id
      const f = imgs.get(id)
      q.crop = cropPadrao()
      q.vira = state.girarFoto && dono.w !== dono.h && f.w !== f.h && (f.w > f.h) !== (dono.w > dono.h)
      if (q.vira) girou++
      selecionado = q
    })
    if (girou) toast(girou > 1 ? `${girou} fotos ganharam quadro deitado, no formato delas.` : 'A foto ganhou quadro deitado, no formato dela.')
  } finally { ocupado(false) }
  render()
}

// ---------- painel ----------
function renderGrupos(L) {
  const box = $('grupos')
  box.innerHTML = ''
  state.grupos.forEach((g) => {
    const el = document.createElement('div')
    el.className = 'grupo' + (g === grupoAtivo() ? ' ativo' : '')
    const comFoto = g.quadros.filter(q => q.img).length
    const gi = state.grupos.indexOf(g)
    const giro = !!(L.rots && L.rots[gi])
    const capUsada = cabem(...(giro ? [g.h, g.w] : [g.w, g.h])), capGirado = cabem(g.h, g.w)
    const cap = Math.max(capUsada, cabem(g.w, g.h), capGirado)
    el.innerHTML = `
      <div class="g1">
        <span class="forma"><i style="width:${Math.round(26 * g.w / Math.max(g.w, g.h))}px;height:${Math.round(26 * g.h / Math.max(g.w, g.h))}px"></i></span>
        <input type="text" inputmode="decimal" data-k="w" value="${cm(g.w)}" aria-label="largura em cm">
        <span class="x">×</span>
        <input type="text" inputmode="decimal" data-k="h" value="${cm(g.h)}" aria-label="altura em cm">
        <span class="un">cm</span>
        <button class="btn icone" data-a="inverter" title="trocar largura e altura">⇄</button>
        <button class="btn icone" data-a="remover" title="tirar este tamanho">✕</button>
      </div>
      <div class="g2">
        <span class="qtd"><button data-a="menos" aria-label="menos">−</button><span>${g.quadros.length}</span><button data-a="mais" aria-label="mais">+</button></span>
        <button class="btn pequeno primario" data-a="fotos">+ Fotos</button>
      </div>
      <div class="info">${cap ? `Cabem <b>${capUsada || cap}</b> por folha${giro ? ' (quadros deitados)' : (state.girar && capGirado > capUsada ? ` (${capGirado} se precisar girar)` : '')} · ${comFoto} com foto · <button class="link" data-a="encher">encher a folha</button>` : '<span class="aviso">Não cabe nesse papel</span>'}</div>`
    el.addEventListener('click', (ev) => {
      if (state.ativo !== g.id) { state.ativo = g.id; if (!ev.target.closest('button,input')) render() }
    })
    el.querySelectorAll('input').forEach(inp => {
      const aplicar = () => {
        const v = lerCm(inp.value)
        if (v && v >= 5 && v <= 2000) { g[inp.dataset.k] = v; g.quadros.forEach(q => { if (q.crop) limitarSeTem(q, g) }) }
        render()
      }
      inp.addEventListener('change', aplicar)
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur() })
    })
    el.querySelectorAll('button').forEach(bt => bt.addEventListener('click', () => acaoGrupo(g, bt.dataset.a)))
    box.append(el)
  })
}
function limitarSeTem(q, g) {
  const f = imgs.get(q.img)
  if (f) limitarCrop(q.crop, f, ...dimsQ(g, q))
}
function acaoGrupo(g, a) {
  state.ativo = g.id
  if (a === 'menos') {
    if (g.quadros.length <= 1) return render()
    let i = -1
    for (let k = g.quadros.length - 1; k >= 0; k--) if (!g.quadros[k].img) { i = k; break }
    g.quadros.splice(i < 0 ? g.quadros.length - 1 : i, 1)
  } else if (a === 'mais') {
    g.quadros.push({ img: null, crop: null })
  } else if (a === 'encher') {
    encher(g)
  } else if (a === 'fotos') {
    return escolherArquivos(g, null)
  } else if (a === 'inverter') {
    ;[g.w, g.h] = [g.h, g.w]
    g.quadros.forEach(q => { if (q.crop) limitarSeTem(q, g) })
  } else if (a === 'remover') {
    if (state.grupos.length === 1) { toast('Precisa ter ao menos um tamanho.'); return }
    if (g.quadros.some(q => q.img) && !confirm('Tirar este tamanho e as fotos dele?')) return
    state.grupos = state.grupos.filter(x => x !== g)
    state.ativo = null
  }
  render()
}
// Acrescenta quadros até a folha (a última) ficar cheia.
function encher(g) {
  if (!cabem(g.w, g.h) && !cabem(g.h, g.w)) return toast('Esse tamanho não cabe no papel.')
  let base = montar().folhas.length
  let primeira = true
  for (let n = 0; n < 500; n++) {
    g.quadros.push({ img: null, crop: null })
    const agora = montar().folhas.length
    if (agora > base) {
      if (primeira && agora === base + 1 && base > 0) { base = agora; primeira = false; continue }
      g.quadros.pop(); break
    }
    primeira = false
  }
}

function montarPainel() {
  $('papeis').innerHTML = PAPEIS.map(p => `<button class="chip" data-p="${p[0]}"${p[2] ? ` title="${cm(p[2])} × ${cm(p[3])} cm"` : ''}>${p[1]}</button>`).join('')
  const mini = (w, h) => `<i class="mini" style="width:${Math.round(14 * w / Math.max(w, h))}px;height:${Math.round(14 * h / Math.max(w, h))}px"></i>`
  $('presets').innerHTML = PRESETS.map((p, i) => `<button class="chip" data-i="${i}">${mini(p[1], p[2])}${p[0]}</button>`).join('') + '<button class="chip" data-i="-1">Outro…</button>'
  $('presets').addEventListener('click', (ev) => {
    const b = ev.target.closest('.chip'); if (!b) return
    const i = +b.dataset.i
    const [w, h] = i >= 0 ? [PRESETS[i][1], PRESETS[i][2]] : [50, 50]
    const g = novoGrupo(w, h, 1)
    state.grupos.push(g); state.ativo = g.id
    render()
    if (i < 0) setTimeout(() => { const inp = $('grupos').lastElementChild.querySelector('input'); inp.focus(); inp.select() }, 30)
  })
  $('papeis').addEventListener('click', (ev) => {
    const b = ev.target.closest('.chip'); if (!b) return
    const p = PAPEIS.find(x => x[0] === b.dataset.p)
    state.papel = p[0]
    if (p[0] !== 'custom') { state.papelW = p[2]; state.papelH = p[3] }
    sincronizarPainel(); render()
  })
  for (const k of ['papelW', 'papelH']) $(k).addEventListener('change', () => {
    const v = lerCm($(k).value); if (v && v >= 20 && v <= 3000) state[k] = v
    sincronizarPainel(); render()
  })
  $('virar').onclick = () => { state.deitado = !state.deitado; sincronizarPainel(); render() }
  $('emPe').onclick = () => { state.deitado = false; sincronizarPainel(); render() }
  $('deitado').onclick = () => { state.deitado = true; sincronizarPainel(); render() }
  $('espaco').oninput = () => { state.espaco = +$('espaco').value; sincronizarPainel(); render() }
  $('margem').oninput = () => { state.margem = +$('margem').value; sincronizarPainel(); render() }
  $('espacoSug').onclick = () => { state.espaco = ESPACO_SUG; sincronizarPainel(); render() }
  $('margemSug').onclick = () => { state.margem = MARGEM_SUG; sincronizarPainel(); render() }
  $('guias').addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (!b) return; state.guias = b.dataset.v; sincronizarPainel(); render() })
  for (const k of ['sangria', 'girar', 'girarFoto', 'centralizar']) $(k).onchange = () => { state[k] = $(k).checked; render() }
  $('limpar').onclick = () => {
    if (!confirm('Apagar tudo e começar do zero?')) return
    state = estadoInicial(); selecionado = null
    sincronizarPainel(); render()
  }
  $('btnImprimir').onclick = imprimir
  $('btnPdf').onclick = baixarPdf
  $('btnPng').onclick = baixarPng
  $('addFotos').onclick = () => escolherArquivos(grupoAtivo(), null)
}
function sincronizarPainel() {
  $('papeis').querySelectorAll('.chip').forEach(b => b.classList.toggle('on', b.dataset.p === state.papel))
  $('papelCustom').hidden = state.papel !== 'custom'
  $('papelW').value = cm(state.papelW); $('papelH').value = cm(state.papelH)
  $('emPe').classList.toggle('on', !state.deitado)
  $('virarIco').className = 'ico-folha ' + (state.deitado ? 'deitado' : 'pe')
  $('deitado').classList.toggle('on', state.deitado)
  $('espaco').value = state.espaco; $('espacoVal').textContent = `${String(state.espaco).replace('.', ',')} mm`
  $('margem').value = state.margem; $('margemVal').textContent = `${String(state.margem).replace('.', ',')} mm`
  $('guias').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === state.guias))
  for (const k of ['sangria', 'girar', 'girarFoto', 'centralizar']) $(k).checked = !!state[k]
}

// ---------- editor de recorte ----------
let ed = null
function abrirEditor(it) {
  const f = imgs.get(it.q.img)
  if (!f) return
  if (!it.q.crop) it.q.crop = cropPadrao()
  ed = { it, f, ponteiros: new Map() }
  rotuloEditor()
  $('editor').hidden = false
  requestAnimationFrame(() => { desenharEditor(); sincronizarZoom() })
}
function rotuloEditor() { const [lw, lh] = dimsQ(ed.it.g, ed.it.q); $('edTam').textContent = `${cm(lw)} × ${cm(lh)} cm` }
function fecharEditor() { $('editor').hidden = true; ed = null; render() }
function geomEditor() {
  const c = $('edCanvas'), r = c.getBoundingClientRect()
  const dpr = Math.min(2.5, window.devicePixelRatio || 1)
  if (c.width !== Math.round(r.width * dpr) || c.height !== Math.round(r.height * dpr)) {
    c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr)
  }
  const [lw, lh] = dimsQ(ed.it.g, ed.it.q)
  const k = Math.min(r.width * 0.74 / lw, r.height * 0.8 / lh)
  return { c, r, dpr, lw, lh, k }
}
function desenharEditor() {
  if (!ed) return
  const { c, r, dpr, lw, lh, k } = geomEditor()
  const ctx = c.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.fillStyle = '#3a2c24'; ctx.fillRect(0, 0, r.width, r.height)
  ctx.translate(r.width / 2, r.height / 2); ctx.scale(k, k)
  const crop = ed.it.q.crop
  ctx.globalAlpha = 0.3
  desenharFoto(ctx, ed.f.prev, ed.f, lw, lh, crop)
  ctx.globalAlpha = 1
  ctx.save(); ctx.beginPath(); ctx.rect(-lw / 2, -lh / 2, lw, lh); ctx.clip()
  ctx.fillStyle = '#fff'; ctx.fillRect(-lw / 2, -lh / 2, lw, lh)
  desenharFoto(ctx, ed.f.prev, ed.f, lw, lh, crop)
  ctx.restore()
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2 / k; ctx.strokeRect(-lw / 2, -lh / 2, lw, lh)
  // terços, ajuda a enquadrar rosto
  ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1 / k; ctx.beginPath()
  for (const t of [1 / 3, 2 / 3]) { ctx.moveTo(-lw / 2 + lw * t, -lh / 2); ctx.lineTo(-lw / 2 + lw * t, lh / 2); ctx.moveTo(-lw / 2, -lh / 2 + lh * t); ctx.lineTo(lw / 2, -lh / 2 + lh * t) }
  ctx.stroke()
}
function mudarCrop(fn) {
  const { lw, lh } = geomEditor()
  fn(ed.it.q.crop)
  limitarCrop(ed.it.q.crop, ed.f, lw, lh)
  desenharEditor(); sincronizarZoom()
}
function faixaZoom() {
  const m = medidasCrop(ed.f, ...dimsQ(ed.it.g, ed.it.q), ed.it.q.crop)
  return [Math.log(m.minS), Math.log(8)]
}
function sincronizarZoom() {
  if (!ed) return
  const [a, b] = faixaZoom()
  $('edZoom').value = b > a ? (Math.log(ed.it.q.crop.s) - a) / (b - a) : 0
}
$('edZoom').addEventListener('input', () => {
  const [a, b] = faixaZoom()
  mudarCrop(c => { c.s = Math.exp(a + (b - a) * +$('edZoom').value) })
})
const edC = $('edCanvas')
edC.addEventListener('pointerdown', (ev) => { if (!ed) return; edC.setPointerCapture(ev.pointerId); ed.ponteiros.set(ev.pointerId, { x: ev.clientX, y: ev.clientY }) })
edC.addEventListener('pointermove', (ev) => {
  if (!ed || !ed.ponteiros.has(ev.pointerId)) return
  const ps = ed.ponteiros
  const antes = [...ps.values()].map(p => ({ ...p }))
  ps.set(ev.pointerId, { x: ev.clientX, y: ev.clientY })
  const depois = [...ps.values()]
  const { lw, lh, k } = geomEditor()
  const media = (l) => ({ x: l.reduce((s, p) => s + p.x, 0) / l.length, y: l.reduce((s, p) => s + p.y, 0) / l.length })
  const m0 = media(antes), m1 = media(depois)
  mudarCrop(c => {
    if (depois.length >= 2) {
      const d0 = Math.hypot(antes[0].x - antes[1].x, antes[0].y - antes[1].y)
      const d1 = Math.hypot(depois[0].x - depois[1].x, depois[0].y - depois[1].y)
      if (d0 > 0) { const s0 = c.s; c.s *= d1 / d0; const q = c.s / s0; c.x *= q; c.y *= q }
    }
    c.x += (m1.x - m0.x) / k / lw
    c.y += (m1.y - m0.y) / k / lh
  })
})
const soltar = (ev) => { if (ed) ed.ponteiros.delete(ev.pointerId) }
edC.addEventListener('pointerup', soltar)
edC.addEventListener('pointercancel', soltar)
edC.addEventListener('wheel', (ev) => {
  if (!ed) return
  ev.preventDefault()
  mudarCrop(c => { const s0 = c.s; c.s *= Math.exp(-ev.deltaY * 0.0015); const q = c.s / s0; c.x *= q; c.y *= q })
}, { passive: false })
$('edGirar').onclick = () => mudarCrop(c => { c.r = (rot4(c) + 1) % 4; c.s = 1; c.x = 0; c.y = 0 })
$('edVirar').onclick = () => { ed.it.q.vira = !ed.it.q.vira; rotuloEditor(); mudarCrop(c => { c.s = 1; c.x = 0; c.y = 0 }); render() }
$('edPreencher').onclick = () => mudarCrop(c => { c.s = 1; c.x = 0; c.y = 0 })
$('edInteira').onclick = () => mudarCrop(c => { c.s = 0; c.x = 0; c.y = 0 })
$('edTrocar').onclick = () => { const it = ed.it; fecharEditor(); destinoArquivo = { g: it.g, q: it.q, trocar: true }; $('arquivo').value = ''; $('arquivo').click() }
$('edRepetir').onclick = () => {
  const { it } = ed
  let n = 0
  for (const q of it.g.quadros) if (!q.img) { q.img = it.q.img; q.crop = { ...it.q.crop }; q.vira = it.q.vira; n++ }
  toast(n ? `Foto repetida em ${n} ${n > 1 ? 'quadros' : 'quadro'}.` : 'Não há quadro vazio nesse tamanho. Use o + ou "Encher a folha".')
  fecharEditor()
}
$('edTirar').onclick = () => { ed.it.q.img = null; ed.it.q.crop = null; fecharEditor() }
$('edPronto').onclick = fecharEditor
$('edFechar').onclick = fecharEditor
$('editor').addEventListener('click', (ev) => { if (ev.target === $('editor')) fecharEditor() })
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && ed) fecharEditor() })

// ---------- saída em tamanho real ----------
// 300 dpi, limitado a ~16 MP por folha (teto de canvas do iPhone).
function dpiPara(L) { return Math.min(300, 25.4 * Math.sqrt(16e6 / (L.W * L.H))) }
async function renderFinal(folha, L) {
  const dpi = dpiPara(L), k = dpi / 25.4
  const c = document.createElement('canvas')
  c.width = Math.round(L.W * k); c.height = Math.round(L.H * k)
  const ctx = c.getContext('2d')
  ctx.imageSmoothingQuality = 'high'
  const cache = new Map()
  for (const it of folha.itens) {
    const id = it.q.img
    if (!id || cache.has(id)) continue
    const i = imgs.get(id); if (!i) continue
    const bm = await decodificar(i.blob)
    cache.set(id, { src: bm, w: i.w, h: i.h })
  }
  desenharFolha(ctx, folha, L, c.width / L.W, 'final', (id) => cache.get(id))
  for (const v of cache.values()) if (v.src.close) v.src.close()
  return { c, dpi }
}
const folhasComFoto = (L) => L.folhas.filter(f => f.itens.some(it => it.q.img && imgs.has(it.q.img)))
const paraBlob = (c, tipo, q) => new Promise(r => c.toBlob(r, tipo, q))
function baixar(blob, nome) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob); a.download = nome
  document.body.append(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 60000)
}
const nomeArquivo = (ext, i, n) => `medidinha-${state.papel === 'custom' ? 'papel' : state.papel}${n > 1 ? '-folha' + (i + 1) : ''}.${ext}`

async function imprimir() {
  const L = montar(), fs = folhasComFoto(L)
  if (!fs.length) return
  ocupado(true, 'Preparando a impressão…')
  try {
    const box = $('impressao')
    box.querySelectorAll('img').forEach(im => URL.revokeObjectURL(im.src))
    box.innerHTML = ''
    for (const f of fs) {
      const { c } = await renderFinal(f, L)
      const im = document.createElement('img')
      im.src = URL.createObjectURL(await paraBlob(c, 'image/jpeg', 0.95))
      im.style.width = L.W + 'mm'; im.style.height = L.H + 'mm'
      box.append(im)
      await im.decode().catch(() => {})
    }
    $('estilo-pagina').textContent = `@page { size: ${L.W}mm ${L.H}mm; margin: 0 } @media print { html, body { margin: 0 !important; padding: 0 !important; height: auto !important } }`
  } finally { ocupado(false) }
  window.print()
}

async function baixarPng() {
  const L = montar(), fs = folhasComFoto(L)
  if (!fs.length) return
  ocupado(true, 'Gerando a imagem…')
  try {
    for (let i = 0; i < fs.length; i++) {
      const { c, dpi } = await renderFinal(fs[i], L)
      const png = await paraBlob(c, 'image/png')
      baixar(await comDpi(png, dpi), nomeArquivo('png', i, fs.length))
    }
  } finally { ocupado(false) }
  toast(`Imagem em ${Math.round(dpiPara(L))} dpi: imprimindo em tamanho real, as medidas saem certas.`)
}

async function baixarPdf() {
  const L = montar(), fs = folhasComFoto(L)
  if (!fs.length) return
  ocupado(true, 'Gerando o PDF…')
  try {
    const paginas = []
    for (const f of fs) {
      const { c } = await renderFinal(f, L)
      const jpg = new Uint8Array(await (await paraBlob(c, 'image/jpeg', 0.95)).arrayBuffer())
      paginas.push({ jpg, w: c.width, h: c.height })
    }
    baixar(montarPdf(paginas, L.W * 72 / 25.4, L.H * 72 / 25.4), nomeArquivo('pdf', 0, 1))
  } finally { ocupado(false) }
}

// PDF mínimo: cada folha é uma imagem JPEG do tamanho exato da página.
function montarPdf(paginas, pw, ph) {
  const enc = new TextEncoder(), partes = [], offs = []
  let off = 0
  const add = (x) => { const b = typeof x === 'string' ? enc.encode(x) : x; partes.push(b); off += b.length }
  const n = paginas.length
  add('%PDF-1.4\n%âãÏÓ\n')
  offs[1] = off; add('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n')
  const kids = paginas.map((_, i) => `${3 + i * 3} 0 R`).join(' ')
  offs[2] = off; add(`2 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${n} >>\nendobj\n`)
  const f = (v) => v.toFixed(3)
  paginas.forEach((p, i) => {
    const po = 3 + i * 3, co = po + 1, io = po + 2
    offs[po] = off
    add(`${po} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${f(pw)} ${f(ph)}] /Resources << /XObject << /Im0 ${io} 0 R >> >> /Contents ${co} 0 R >>\nendobj\n`)
    const conteudo = `q ${f(pw)} 0 0 ${f(ph)} 0 0 cm /Im0 Do Q`
    offs[co] = off
    add(`${co} 0 obj\n<< /Length ${conteudo.length} >>\nstream\n${conteudo}\nendstream\nendobj\n`)
    offs[io] = off
    add(`${io} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${p.w} /Height ${p.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpg.length} >>\nstream\n`)
    add(p.jpg)
    add('\nendstream\nendobj\n')
  })
  const total = 3 + n * 3
  const xref = off
  let x = `xref\n0 ${total}\n0000000000 65535 f \n`
  for (let i = 1; i < total; i++) x += String(offs[i]).padStart(10, '0') + ' 00000 n \n'
  add(x + `trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`)
  return new Blob(partes, { type: 'application/pdf' })
}

// Carimba a resolução no PNG (chunk pHYs): sem ela o programa de impressão chuta 72 ou 96 dpi.
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 } return t })()
function crc32(b) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
async function comDpi(png, dpi) {
  const buf = new Uint8Array(await png.arrayBuffer())
  const ppm = Math.round(dpi / 0.0254)
  const ch = new Uint8Array(21), dv = new DataView(ch.buffer)
  dv.setUint32(0, 9); ch.set([112, 72, 89, 115], 4)
  dv.setUint32(8, ppm); dv.setUint32(12, ppm); ch[16] = 1
  dv.setUint32(17, crc32(ch.subarray(4, 17)))
  const ihdrFim = 8 + 25
  return new Blob([buf.subarray(0, ihdrFim), ch, buf.subarray(ihdrFim)], { type: 'image/png' })
}

// ---------- miudezas ----------
let toastTimer = null
function toast(t) {
  const el = $('toast'); el.textContent = t; el.classList.add('on')
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('on'), 3200)
}
function ocupado(on, txt) { $('ocupado').hidden = !on; if (txt) $('ocupadoTxt').textContent = txt }
let rz = null
window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { render(); if (ed) desenharEditor() }, 80) })

;(async () => {
  montarPainel()
  await carregar()
  sincronizarPainel()
  render()
  // a letra do quadro vazio é desenhada no canvas: redesenha quando a fonte chegar
  if (document.fonts) document.fonts.ready.then(render)
})()
