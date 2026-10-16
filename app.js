'use strict'

// ---------- dados fixos ----------
const PAPEIS = [
  ['A4', 'A4', 210, 297],
  ['A5', 'A5', 148, 210],
  ['A3', 'A3', 297, 420],
  ['carta', 'Carta', 215.9, 279.4],
  ['foto10x15', '10×15', 100, 150],
  ['custom', 'Outro', 0, 0],
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
    grupos: [], ativo: null, dicaVista: false,
    // o caminho de quem chega: fotos → tamanho → prancha
    etapa: 'fotos',
    novo: { fotos: [], w: 30, h: 40, copias: 1, encher: false },
  }
}
let state = estadoInicial()
const imgs = new Map() // id -> { blob, prev (desenhável), w, h }
let selecionado = null // foto selecionada

// Um tamanho guarda as fotos, quantas cópias de cada, e as cópias a mais que completam a folha.
function quadrosDe(g) {
  const out = []
  for (const f of g.fotos) for (let i = 0; i < g.copias; i++) out.push(f)
  for (let i = 0; i < (g.extra || 0) && g.fotos.length; i++) out.push(g.fotos[i % g.fotos.length])
  return out
}
// Foto que acabou de chegar ainda não está em lugar nenhum: a limpeza não pode levá-la.
const chegando = new Set()
function idsUsados() {
  const s = new Set([...state.novo.fotos, ...chegando])
  state.grupos.forEach(g => g.fotos.forEach(f => s.add(f.img)))
  return s
}
const grupoDe = (f) => state.grupos.find(g => g.fotos.includes(f))
function viraPadrao(info, g) {
  return !!(state.girarFoto && info && g.w !== g.h && info.w !== info.h && (info.w > info.h) !== (g.w > g.h))
}

// ---------- armazenamento (opcional: o app funciona sem) ----------
const CHAVE = 'prancha-v2'
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
    const usados = idsUsados()
    for (const id of [...imgs.keys()]) {
      if (!usados.has(id)) { const i = imgs.get(id); if (i.url) URL.revokeObjectURL(i.url); imgs.delete(id); idb('readwrite', s => s.delete(id)) }
    }
  }, 400)
}
async function carregar() {
  let salvo = null
  try { salvo = JSON.parse(localStorage.getItem(CHAVE) || 'null') } catch {}
  if (!salvo || !Array.isArray(salvo.grupos)) return
  state = Object.assign(estadoInicial(), salvo)
  state.novo = Object.assign(estadoInicial().novo, salvo.novo)
  for (const id of idsUsados()) {
    const blob = await idb('readonly', s => s.get(id))
    if (blob) { try { imgs.set(id, await prepararBlob(blob)) } catch {} }
  }
  state.grupos.forEach(g => { g.fotos = g.fotos.filter(f => imgs.has(f.img)) })
  state.grupos = state.grupos.filter(g => g.fotos.length)
  state.novo.fotos = state.novo.fotos.filter(id => imgs.has(id))
  if (state.etapa === 'tamanho' && !state.novo.fotos.length) state.etapa = 'fotos'
  if (state.etapa === 'prancha' && !state.grupos.length) state.etapa = 'fotos'
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
  chegando.add(id)
  imgs.set(id, info)
  idb('readwrite', s => s.put(blob, id))
  return id
}

// ---------- recorte ----------
function rot4(c) { return (((c && c.r) || 0) % 4 + 4) % 4 }
const totalGraus = (c) => rot4(c) * 90 + ((c && c.a) || 0)
// Guarda o giro como quartos de volta (r) + ajuste fino (a, entre -45 e 45 graus).
function definirGraus(c, g) {
  g = ((g % 360) + 540) % 360 - 180
  const q = Math.round(g / 90)
  c.r = ((q % 4) + 4) % 4
  c.a = Math.round((g - q * 90) * 100) / 100
}
// O quadro visto no eixo da foto (qw × qh) define a escala que cobre tudo, mesmo girada.
function medidasCrop(f, lw, lh, c) {
  const t = totalGraus(c) * Math.PI / 180, co = Math.abs(Math.cos(t)), si = Math.abs(Math.sin(t))
  const qw = lw * co + lh * si, qh = lw * si + lh * co
  const cover = Math.max(qw / f.w, qh / f.h)
  const bw = f.w * co + f.h * si, bh = f.w * si + f.h * co
  const minS = Math.min(lw / bw, lh / bh) / cover
  return { t, qw, qh, cover, minS }
}
function limitarCrop(c, f, lw, lh) {
  const m = medidasCrop(f, lw, lh, c)
  c.s = Math.min(8, Math.max(m.minS, c.s))
  const sc = m.cover * c.s
  const fx = Math.abs(f.w * sc - m.qw) / 2, fy = Math.abs(f.h * sc - m.qh) / 2
  const cs = Math.cos(m.t), sn = Math.sin(m.t), ox = c.x * lw, oy = c.y * lh
  const u = Math.min(fx, Math.max(-fx, ox * cs + oy * sn)), v = Math.min(fy, Math.max(-fy, -ox * sn + oy * cs))
  c.x = (u * cs - v * sn) / lw
  c.y = (u * sn + v * cs) / lh
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
  ctx.rotate(m.t)
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
    quadrosDe(g).forEach((q, qi) => {
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
    ctx.strokeStyle = 'rgba(80,140,210,.35)'; ctx.lineWidth = 0.3; ctx.setLineDash([2, 1.5])
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
      ctx.fillStyle = '#eef2f7'; ctx.fillRect(-lw / 2, -lh / 2, lw, lh)
      ctx.strokeStyle = '#9db2c9'; ctx.lineWidth = 0.4; ctx.setLineDash([1.6, 1.2])
      ctx.strokeRect(-lw / 2, -lh / 2, lw, lh); ctx.setLineDash([])
      const fs = Math.max(2.4, Math.min(lw, lh) * 0.12)
      ctx.fillStyle = '#6f8399'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.font = `800 ${fs * 1.6}px Inter, system-ui, sans-serif`
      ctx.fillText('+', 0, -fs * 0.7)
      ctx.font = `800 ${fs}px Inter, system-ui, sans-serif`
      ctx.fillText(`${cm(lw)} × ${cm(lh)}`, 0, fs * 0.9)
    }
    ctx.restore()
  }
  desenharGuias(ctx, folha, b, modo, fontes)
  if (modo === 'tela' && selecionado) {
    for (const it of folha.itens.filter(i => i.q === selecionado)) {
      ctx.strokeStyle = '#2f9bff'; ctx.lineWidth = Math.max(0.8, 1.6 / k * 2)
      ctx.strokeRect(it.x - 0.6, it.y - 0.6, it.w + 1.2, it.h + 1.2)
    }
  }
  if (modo === 'tela' && arraste && arraste.alvo) {
    const it = folha.itens.find(i => i.q === arraste.alvo)
    if (it) {
      ctx.fillStyle = 'rgba(47,155,255,.2)'; ctx.fillRect(it.x, it.y, it.w, it.h)
      ctx.strokeStyle = '#2f9bff'; ctx.lineWidth = 0.8; ctx.strokeRect(it.x, it.y, it.w, it.h)
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
  mostrarEtapa()
  if (state.etapa !== 'prancha') { salvar(); return }
  const L = montar()
  ultimoL = L
  const cont = $('folhas'), prev = $('previa')
  const estreito = window.innerWidth <= 860
  const cw = prev.clientWidth - (estreito ? 24 : 48)
  const ch = prev.clientHeight - prev.querySelector('.barra-previa').offsetHeight - $('avisos').offsetHeight - 90
  // no celular a folha ocupa a largura: medir pela altura fazia ela mudar quando a barra do navegador some na rolagem
  let dw = estreito ? cw : Math.min(cw, ch * L.W / L.H)
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
    cv.rot.textContent = n > 1 ? `Folha ${i + 1} de ${n}` : `${nomePapel()} · ${cm(L.W)} × ${cm(L.H)} cm`
  })
  const total = state.grupos.reduce((s, g) => s + quadrosDe(g).length, 0)
  $('resumo').textContent = `${nomePapel()} ${state.deitado ? 'deitado' : 'em pé'} · ${total} ${total === 1 ? 'foto' : 'fotos'} · ${n} ${n > 1 ? 'folhas' : 'folha'}`
  const av = []
  for (const g of L.naoCabe) av.push(['alerta', `${cm(g.w)} × ${cm(g.h)} cm não cabe nesse papel. Vire o papel ou diminua a margem.`])
  $('avisos').innerHTML = av.map(([c, t]) => `<div class="${c}">${t}</div>`).join('')
  for (const id of ['btnImprimir', 'btnPdf', 'btnPng']) $(id).disabled = !total
  $('vazio').hidden = total > 0
  renderGrupos(L)
  salvar()
}
function nomePapel() {
  if (state.papel === 'custom') return `${cm(state.papelW)} × ${cm(state.papelH)} cm`
  return ({ foto10x15: 'Foto 10 × 15', foto13x18: 'Foto 13 × 18', carta: 'Carta', oficio: 'Ofício' })[state.papel] || state.papel
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
    if (!arraste || !arraste.mouse) return
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
    abrirEditor(it)
    render()
  })
  c.addEventListener('pointerleave', () => { if (arraste && arraste.ativo) { arraste.alvo = null; render() } })
}
function trocar(a, b) {
  const ga = grupoDe(a), gb = grupoDe(b)
  const ia = ga.fotos.indexOf(a), ib = gb.fotos.indexOf(b)
  ga.fotos[ia] = b; gb.fotos[ib] = a
  if (ga !== gb) for (const [f, g] of [[a, gb], [b, ga]]) { f.crop = null; f.vira = viraPadrao(imgs.get(f.img), g) }
  selecionado = a
}

// arrastar fotos do computador para dentro da página
let soltaTimer = null
document.addEventListener('dragover', (ev) => {
  ev.preventDefault()
  document.body.classList.add('soltando')
  clearTimeout(soltaTimer); soltaTimer = setTimeout(() => document.body.classList.remove('soltando'), 150)
})
document.addEventListener('drop', (ev) => {
  ev.preventDefault()
  const files = [...(ev.dataTransfer?.files || [])].filter(f => f.type.startsWith('image/'))
  if (!files.length) return
  if (state.etapa === 'prancha') adicionarFotos(files, grupoAtivo())
  else novasFotosNoAssistente(files)
})

function grupoAtivo() {
  return state.grupos.find(g => g.id === state.ativo) || state.grupos[state.grupos.length - 1]
}

// ---------- fotos ----------
let destino = null
function escolherArquivos(d) {
  destino = d
  $('arquivo').multiple = d.modo !== 'trocar'
  $('arquivo').value = ''
  $('arquivo').click()
}
$('arquivo').addEventListener('change', async () => {
  const files = [...$('arquivo').files]
  const d = destino || { modo: 'assistente' }
  destino = null
  if (!files.length) return
  if (d.modo === 'assistente') await novasFotosNoAssistente(files)
  else if (d.modo === 'grupo') await adicionarFotos(files, d.g)
  else if (d.modo === 'trocar') await trocarFoto(d.f, files[0])
})
async function importarVarias(files) {
  ocupado(true, files.length > 1 ? `Carregando ${files.length} fotos…` : 'Carregando…')
  const ids = []
  try {
    for (const f of files) { try { ids.push(await importar(f)) } catch { toast(`Não consegui abrir ${f.name}`) } }
  } finally { ocupado(false) }
  return ids
}
async function novasFotosNoAssistente(files) {
  const ids = await importarVarias(files)
  state.novo.fotos.push(...ids)
  ids.forEach(id => chegando.delete(id))
  if (state.novo.fotos.length) state.etapa = 'tamanho'
  render()
}
async function adicionarFotos(files, g) {
  if (!g) return novasFotosNoAssistente(files)
  const ids = await importarVarias(files)
  for (const id of ids) {
    const f = { img: id, crop: null, vira: viraPadrao(imgs.get(id), g) }
    g.fotos.push(f); selecionado = f
    chegando.delete(id)
  }
  g.extra = 0
  state.ativo = g.id
  render()
}
async function trocarFoto(f, file) {
  const [id] = await importarVarias([file])
  if (!id) return
  f.img = id; f.crop = null; f.vira = viraPadrao(imgs.get(id), grupoDe(f))
  chegando.delete(id)
  render()
}
function urlDe(id) {
  const i = imgs.get(id)
  if (!i) return ''
  if (!i.url) i.url = URL.createObjectURL(i.blob)
  return i.url
}

// ---------- assistente (só no celular) ----------
const celular = () => matchMedia('(max-width: 860px)').matches
const grupoVazio = (w = state.novo.w, h = state.novo.h) => ({ id: uid(), w, h, fotos: [], copias: 1, extra: 0 })
// No computador não há passo a passo: a prancha abre direto, com um tamanho vazio esperando fotos.
function ajustarModo() {
  if (celular()) {
    state.grupos = state.grupos.filter(g => g.fotos.length)
    if (state.etapa === 'prancha' && !state.grupos.length) state.etapa = 'fotos'
  } else {
    if (state.etapa !== 'prancha') {
      if (state.novo.fotos.length) montarDoAssistente(true)
      state.etapa = 'prancha'
    }
    if (!state.grupos.length) state.grupos.push(grupoVazio())
  }
}
function mostrarEtapa() {
  ajustarModo()
  const e = state.etapa
  document.body.dataset.etapa = e
  if (e === 'prancha') return
  const adicionando = state.grupos.length > 0
  document.querySelectorAll('.wz-trilha li').forEach((li, i) => li.classList.toggle('feito', i <= (e === 'tamanho' ? 1 : 0)))
  $('wzFotos').hidden = e !== 'fotos'
  $('wzTamanho').hidden = e !== 'tamanho'
  $('wzCancelar').hidden = !adicionando
  if (e !== 'tamanho') return
  const n = state.novo
  $('wzThumbs').innerHTML = n.fotos.map((id, i) => `<span class="thumb"><img src="${urlDe(id)}" alt=""><button data-i="${i}" aria-label="tirar esta foto">✕</button></span>`).join('') +
    '<button class="thumb mais" id="wzMaisFotos" aria-label="mais fotos">+</button>'
  for (const k of ['w', 'h']) { const inp = $(k === 'w' ? 'wzW' : 'wzH'); if (document.activeElement !== inp) inp.value = cm(n[k]) }
  const cabe = Math.max(cabem(n.w, n.h), cabem(n.h, n.w))
  $('wzMontar').disabled = !cabe
  $('wzMontar').textContent = cabe ? 'Montar' : 'Não cabe no papel'
}
function montarDoAssistente(semRender) {
  const n = state.novo
  const g = { id: uid(), w: n.w, h: n.h, fotos: [], copias: n.copias, extra: 0 }
  g.fotos = n.fotos.map(id => ({ img: id, crop: null, vira: viraPadrao(imgs.get(id), g) }))
  state.grupos.push(g)
  state.ativo = g.id
  state.novo = { ...estadoInicial().novo, w: n.w, h: n.h }
  state.etapa = 'prancha'
  if (semRender) return
  if (n.encher) { render(); encher(g, true) }
  render()
}
function ligarAssistente() {
  $('wzEscolher').onclick = () => escolherArquivos({ modo: 'assistente' })
  $('wzThumbs').addEventListener('click', (ev) => {
    if (ev.target.closest('#wzMaisFotos')) return escolherArquivos({ modo: 'assistente' })
    const b = ev.target.closest('button[data-i]'); if (!b) return
    state.novo.fotos.splice(+b.dataset.i, 1)
    if (!state.novo.fotos.length) state.etapa = 'fotos'
    render()
  })
  for (const [id, k] of [['wzW', 'w'], ['wzH', 'h']]) {
    const inp = $(id)
    inp.addEventListener('input', () => { const v = lerCm(inp.value); if (v && v >= 5 && v <= 2000) { state.novo[k] = v; mostrarEtapa() } })
    inp.addEventListener('change', () => render())
    inp.addEventListener('focus', () => inp.select())
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur() })
  }
  $('wzInverter').onclick = () => { const n = state.novo; [n.w, n.h] = [n.h, n.w]; render() }
  $('wzVoltar').onclick = () => { state.etapa = 'fotos'; render() }
  $('wzMontar').onclick = () => montarDoAssistente()
  $('wzCancelar').onclick = () => { state.novo.fotos = []; state.etapa = 'prancha'; render() }
}

// ---------- painel ----------
// no "change" de um campo o foco ainda está saindo dele: o painel não pode ser refeito nessa hora
let adiarPainel = false
function renderGrupos(L) {
  const box = $('grupos')
  // quem está digitando uma medida não pode perder o foco: o painel se redesenha quando ele sair
  if (adiarPainel || (box.contains(document.activeElement) && document.activeElement.tagName === 'INPUT')) { box.dataset.pendente = '1'; return }
  delete box.dataset.pendente
  box.innerHTML = ''
  state.grupos.forEach((g, gi) => {
    const el = document.createElement('div')
    el.className = 'grupo' + (g === grupoAtivo() && state.grupos.length > 1 ? ' ativo' : '')
    const giro = !!(L.rots && L.rots[gi])
    const cap = Math.max(cabem(...(giro ? [g.h, g.w] : [g.w, g.h])), cabem(g.w, g.h))
    const na = quadrosDe(g).length
    const fw = Math.round(22 * g.w / Math.max(g.w, g.h)), fh = Math.round(22 * g.h / Math.max(g.w, g.h))
    el.innerHTML = `
      <div class="g1">
        <span class="forma"><i style="width:${fw}px;height:${fh}px"></i></span>
        <input type="text" inputmode="decimal" data-k="w" value="${cm(g.w)}" aria-label="largura em cm">
        <span class="x">×</span>
        <input type="text" inputmode="decimal" data-k="h" value="${cm(g.h)}" aria-label="altura em cm">
        <span class="un">cm</span>
        <button class="btn icone" data-a="inverter" title="trocar largura e altura">⇄</button>
        <button class="btn icone" data-a="remover" title="tirar este tamanho">✕</button>
      </div>
      <div class="thumbs">${g.fotos.map((f, i) => `<button class="thumb${f === selecionado ? ' sel' : ''}" data-f="${i}" title="ajustar"><img src="${urlDe(f.img)}" alt=""></button>`).join('')}<button class="thumb mais" data-a="fotos" title="mais fotos neste tamanho">+</button></div>
      <div class="g2">
        <span class="rot-qtd">Cópias</span>
        <span class="qtd"><button data-a="menos" aria-label="menos">−</button><span>${g.copias}</span><button data-a="mais" aria-label="mais">+</button></span>
        <button class="btn pequeno" data-a="encher" title="completar a folha com cópias">Encher folha</button>
      </div>
      ${cap ? '' : '<div class="info aviso">Não cabe nesse papel</div>'}`
    el.addEventListener('click', (ev) => {
      if (state.ativo !== g.id && state.grupos.length > 1) { state.ativo = g.id; if (!ev.target.closest('button,input')) render() }
    })
    el.querySelectorAll('input').forEach(inp => {
      const aplicar = () => {
        const v = lerCm(inp.value)
        if (v && v >= 5 && v <= 2000) { g[inp.dataset.k] = v; g.fotos.forEach(f => limitarSeTem(f, g)) }
        adiarPainel = true
        try { render() } finally { adiarPainel = false }
      }
      inp.addEventListener('change', aplicar)
      inp.addEventListener('focus', () => inp.select())
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur() })
    })
    el.querySelectorAll('button[data-a]').forEach(bt => bt.addEventListener('click', () => acaoGrupo(g, bt.dataset.a)))
    el.querySelectorAll('button[data-f]').forEach(bt => bt.addEventListener('click', () => {
      const f = g.fotos[+bt.dataset.f]
      selecionado = f
      abrirEditor({ g, q: f })
      render()
    }))
    box.append(el)
  })
}
$('grupos').addEventListener('focusout', () => setTimeout(() => {
  const box = $('grupos')
  if (box.dataset.pendente && !box.contains(document.activeElement) && ultimoL) renderGrupos(ultimoL)
}, 0))
function limitarSeTem(f, g) {
  const i = imgs.get(f.img)
  if (i && f.crop) limitarCrop(f.crop, i, ...dimsQ(g, f))
}
function acaoGrupo(g, a) {
  state.ativo = g.id
  if (a === 'menos') { g.copias = Math.max(1, g.copias - 1); g.extra = 0 }
  else if (a === 'mais') { g.copias = Math.min(99, g.copias + 1); g.extra = 0 }
  else if (a === 'encher') encher(g)
  else if (a === 'fotos') return escolherArquivos({ modo: 'grupo', g })
  else if (a === 'inverter') { [g.w, g.h] = [g.h, g.w]; g.fotos.forEach(f => limitarSeTem(f, g)) }
  else if (a === 'remover') {
    if (g.fotos.length && !confirm(`Tirar o tamanho ${cm(g.w)} × ${cm(g.h)} cm e as fotos dele?`)) return
    state.grupos = state.grupos.filter(x => x !== g)
    state.ativo = null
  }
  render()
}
// Completa a última folha com cópias: primeiro por igual, depois uma a uma até não caber mais.
function encher(g, calado) {
  if (!g.fotos.length) return
  if (!cabem(g.w, g.h) && !cabem(g.h, g.w)) return toast('Esse tamanho não cabe no papel.')
  const antes = quadrosDe(g).length
  g.extra = 0
  const folhas = () => montar().folhas.length
  const base = folhas()
  while (g.copias < 500) { g.copias++; if (folhas() > base) { g.copias--; break } }
  while (g.extra < g.fotos.length - 1) { g.extra++; if (folhas() > base) { g.extra--; break } }
  const depois = quadrosDe(g).length
  if (!calado) toast(depois > antes ? `Folha completa: ${depois} fotos de ${cm(g.w)} × ${cm(g.h)} cm.` : 'A folha já está cheia.')
}

// Papel por ícone: o desenho de cada um é proporcional ao tamanho de verdade (A3 maior, 10×15 menor).
function renderPapeis() {
  const k = 30 / 420
  const html = PAPEIS.map(([id, nome, w, h]) => {
    const [iw, ih] = w ? [Math.max(7, w * k), Math.max(10, h * k)] : [13, 18]
    return `<button class="papel" data-p="${id}" title="${w ? `${nome} · ${cm(w)} × ${cm(h)} cm` : 'outro tamanho'}"><i class="${w ? '' : 'livre'}" style="width:${iw.toFixed(0)}px;height:${ih.toFixed(0)}px"></i><span>${nome}</span></button>`
  }).join('')
  document.querySelectorAll('[data-papeis]').forEach(el => { el.innerHTML = html })
}
function escolherPapel(v) {
  const p = PAPEIS.find(x => x[0] === v)
  state.papel = p[0]
  if (p[0] !== 'custom') { state.papelW = p[2]; state.papelH = p[3] }
  sincronizarPainel(); render()
}
function deitar(v) { state.deitado = v; sincronizarPainel(); render() }
function montarPainel() {
  renderPapeis()
  document.querySelectorAll('[data-papeis]').forEach(el => el.addEventListener('click', (ev) => {
    const b = ev.target.closest('button'); if (!b) return
    if (b.dataset.p) escolherPapel(b.dataset.p)
    else deitar(b.dataset.o === '1')
  }))
  for (const k of ['papelW', 'papelH']) $(k).addEventListener('change', () => {
    const v = lerCm($(k).value); if (v && v >= 20 && v <= 3000) state[k] = v
    sincronizarPainel(); render()
  })
  $('virar').onclick = () => deitar(!state.deitado)
  $('espaco').oninput = () => { state.espaco = +$('espaco').value; sincronizarPainel(); render() }
  $('margem').oninput = () => { state.margem = +$('margem').value; sincronizarPainel(); render() }
  $('espacoSug').onclick = () => { state.espaco = ESPACO_SUG; sincronizarPainel(); render() }
  $('margemSug').onclick = () => { state.margem = MARGEM_SUG; sincronizarPainel(); render() }
  $('guias').addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (!b) return; state.guias = b.dataset.v; sincronizarPainel(); render() })
  for (const k of ['sangria', 'girar', 'girarFoto', 'centralizar']) $(k).onchange = () => { state[k] = $(k).checked; render() }
  $('outroTamanho').onclick = () => {
    if (celular()) { state.novo.fotos = []; state.etapa = 'fotos'; render(); window.scrollTo(0, 0); return }
    const g = grupoVazio(); state.grupos.push(g); state.ativo = g.id; render()
    $('grupos').lastElementChild?.querySelector('input')?.select()
  }
  $('vazio').onclick = () => escolherArquivos({ modo: 'grupo', g: grupoAtivo() })
  $('addFotos').onclick = () => escolherArquivos({ modo: 'grupo', g: grupoAtivo() })
  $('limpar').onclick = () => {
    if (!confirm('Apagar tudo e começar do zero?')) return
    state = estadoInicial(); selecionado = null
    sincronizarPainel(); render()
  }
  $('btnImprimir').onclick = imprimir
  $('btnPdf').onclick = baixarPdf
  $('btnPng').onclick = baixarPng
  ligarAssistente()
}
function sincronizarPainel() {
  document.querySelectorAll('[data-papeis] .papel').forEach(b => b.classList.toggle('on', b.dataset.p === state.papel))
  document.querySelectorAll('[data-papeis] [data-o]').forEach(b => b.classList.toggle('on', (b.dataset.o === '1') === state.deitado))
  $('papelCustom').hidden = state.papel !== 'custom'
  $('papelW').value = cm(state.papelW); $('papelH').value = cm(state.papelH)
  $('virarIco').className = 'ico-folha ' + (state.deitado ? 'deitado' : 'pe')
  $('espaco').value = state.espaco; $('espacoVal').textContent = `${String(state.espaco).replace('.', ',')} mm`
  $('margem').value = state.margem; $('margemVal').textContent = `${String(state.margem).replace('.', ',')} mm`
  $('espacoSug').hidden = state.espaco === ESPACO_SUG
  $('margemSug').hidden = state.margem === MARGEM_SUG
  $('guias').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === state.guias))
  for (const k of ['sangria', 'girar', 'girarFoto', 'centralizar']) $(k).checked = !!state[k]
}

// ---------- editor de recorte ----------
let ed = null
function abrirEditor(it) {
  const f = imgs.get(it.q.img)
  if (!f) return
  if (!it.q.crop) it.q.crop = cropPadrao()
  state.dicaVista = true
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
  ctx.fillStyle = '#161616'; ctx.fillRect(0, 0, r.width, r.height)
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
  // terços para enquadrar; girando, grade fina para endireitar o horizonte
  const n = ed.girando ? 8 : 3
  ctx.strokeStyle = ed.girando ? 'rgba(255,255,255,.28)' : 'rgba(255,255,255,.35)'; ctx.lineWidth = 1 / k; ctx.beginPath()
  for (let i = 1; i < n; i++) { const t = i / n; ctx.moveTo(-lw / 2 + lw * t, -lh / 2); ctx.lineTo(-lw / 2 + lw * t, lh / 2); ctx.moveTo(-lw / 2, -lh / 2 + lh * t); ctx.lineTo(lw / 2, -lh / 2 + lh * t) }
  ctx.stroke()
  if (ed.girando) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const txt = `${String(Math.round(totalGraus(crop) * 10) / 10).replace('.', ',')}°`
    ctx.font = '600 15px Inter, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    const w = ctx.measureText(txt).width + 22
    ctx.fillStyle = 'rgba(0,0,0,.65)'; ctx.beginPath(); ctx.roundRect(r.width / 2 - w / 2, 12, w, 28, 6); ctx.fill()
    ctx.fillStyle = '#fff'; ctx.fillText(txt, r.width / 2, 26)
  }
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
  const fino = ed.it.q.crop.a || 0
  $('edAngulo').value = fino
  $('edAnguloVal').textContent = `${String(Math.round(fino * 10) / 10).replace('.', ',')}°`
}
// Gira a foto em torno do centro do quadro: o deslocamento gira junto, senão a foto "foge".
function girarPara(c, graus) {
  const [lw, lh] = dimsQ(ed.it.g, ed.it.q)
  const d = (graus - totalGraus(c)) * Math.PI / 180, cs = Math.cos(d), sn = Math.sin(d)
  const ox = c.x * lw, oy = c.y * lh
  c.x = (ox * cs - oy * sn) / lw; c.y = (ox * sn + oy * cs) / lh
  definirGraus(c, graus)
}
$('edAngulo').addEventListener('input', () => {
  mudarCrop(c => girarPara(c, rot4(c) * 90 + +$('edAngulo').value))
})
$('edAnguloVal').onclick = () => mudarCrop(c => girarPara(c, rot4(c) * 90))
$('edZoom').addEventListener('input', () => {
  const [a, b] = faixaZoom()
  mudarCrop(c => { c.s = Math.exp(a + (b - a) * +$('edZoom').value) })
})
const edC = $('edCanvas')
// Ponto fora da moldura = girar (como no Photoshop); dentro = mover.
function foraDaMoldura(ev) {
  const { r, lw, lh, k } = geomEditor()
  const x = ev.clientX - r.left - r.width / 2, y = ev.clientY - r.top - r.height / 2
  return Math.abs(x) > lw * k / 2 + 4 || Math.abs(y) > lh * k / 2 + 4
}
function anguloNoCentro(ev) {
  const r = edC.getBoundingClientRect()
  return Math.atan2(ev.clientY - r.top - r.height / 2, ev.clientX - r.left - r.width / 2) * 180 / Math.PI
}
const angDedos = (a, b) => Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI
function grausComImã(g, shift) {
  if (shift) return Math.round(g / 15) * 15
  const q = Math.round(g / 90) * 90
  return Math.abs(g - q) < 1.2 ? q : g
}
edC.addEventListener('pointerdown', (ev) => {
  if (!ed) return
  edC.setPointerCapture(ev.pointerId)
  ed.ponteiros.set(ev.pointerId, { x: ev.clientX, y: ev.clientY })
  if (ed.ponteiros.size === 1 && foraDaMoldura(ev)) {
    ed.giro = { base: totalGraus(ed.it.q.crop), ini: anguloNoCentro(ev) }
    ed.girando = true; desenharEditor()
  } else ed.giro = null
})
edC.addEventListener('pointermove', (ev) => {
  if (!ed) return
  if (!ed.ponteiros.has(ev.pointerId)) {
    if (ev.pointerType === 'mouse') edC.classList.toggle('girar', foraDaMoldura(ev))
    return
  }
  const ps = ed.ponteiros
  if (ed.giro && ps.size === 1) {
    let d = anguloNoCentro(ev) - ed.giro.ini
    d = ((d + 540) % 360) - 180
    ed.giro.ini += d; ed.giro.base += d
    mudarCrop(c => girarPara(c, grausComImã(ed.giro.base, ev.shiftKey)))
    return
  }
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
      // dois dedos torcendo = girar
      let dg = angDedos(depois[0], depois[1]) - angDedos(antes[0], antes[1])
      dg = ((dg + 540) % 360) - 180
      if (Math.abs(dg) > 0.05) {
        ed.torcao = (ed.torcao ?? totalGraus(c)) + dg
        girarPara(c, grausComImã(ed.torcao, false))
        ed.girando = true
      }
    }
    c.x += (m1.x - m0.x) / k / lw
    c.y += (m1.y - m0.y) / k / lh
  })
})
const soltar = (ev) => {
  if (!ed) return
  ed.ponteiros.delete(ev.pointerId)
  if (ed.ponteiros.size < 2) ed.torcao = null
  if (!ed.ponteiros.size && (ed.giro || ed.girando)) { ed.giro = null; ed.girando = false; desenharEditor() }
}
edC.addEventListener('pointerup', soltar)
edC.addEventListener('pointercancel', soltar)
edC.addEventListener('pointerleave', (ev) => { if (ev.pointerType === 'mouse' && !ed?.ponteiros.size) edC.classList.remove('girar') })
edC.addEventListener('wheel', (ev) => {
  if (!ed) return
  ev.preventDefault()
  mudarCrop(c => { const s0 = c.s; c.s *= Math.exp(-ev.deltaY * 0.0015); const q = c.s / s0; c.x *= q; c.y *= q })
}, { passive: false })
$('edGirar').onclick = () => mudarCrop(c => { girarPara(c, totalGraus(c) + 90) })
$('edVirar').onclick = () => { ed.it.q.vira = !ed.it.q.vira; rotuloEditor(); mudarCrop(c => { c.s = 1; c.x = 0; c.y = 0 }); render() }
$('edPreencher').onclick = () => mudarCrop(c => { c.s = 1; c.x = 0; c.y = 0 })
$('edInteira').onclick = () => mudarCrop(c => { c.s = 0; c.x = 0; c.y = 0 })
$('edTrocar').onclick = () => { const f = ed.it.q; fecharEditor(); escolherArquivos({ modo: 'trocar', f }) }
$('edTirar').onclick = () => {
  const f = ed.it.q, g = grupoDe(f)
  g.fotos = g.fotos.filter(x => x !== f); g.extra = 0
  if (!g.fotos.length && (celular() || state.grupos.length > 1)) state.grupos = state.grupos.filter(x => x !== g)
  fecharEditor()
}
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
const nomeArquivo = (ext, i, n) => `prancha-${state.papel === 'custom' ? 'papel' : state.papel}${n > 1 ? '-folha' + (i + 1) : ''}.${ext}`

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
  toast('Na impressora: tamanho real (100%)')
}

async function baixarPdf() {
  const L = montar(), fs = folhasComFoto(L)
  if (!fs.length) return
  toast('Na impressora: tamanho real (100%)')
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
// No celular a barra do navegador some e volta ao rolar, mudando só a ALTURA: isso não redesenha a folha.
let larguraAntes = window.innerWidth
window.addEventListener('resize', () => {
  clearTimeout(rz)
  rz = setTimeout(() => {
    if (ed) desenharEditor()
    if (window.innerWidth === larguraAntes && window.innerWidth <= 860) return
    larguraAntes = window.innerWidth
    render()
  }, 80)
})

;(async () => {
  montarPainel()
  await carregar()
  sincronizarPainel()
  render()
  // a letra do quadro vazio é desenhada no canvas: redesenha quando a fonte chegar
  if (document.fonts) document.fonts.ready.then(render)
})()
