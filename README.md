# Prancha

**Fotos na medida exata, prontas para recortar.**

Escolha as fotos e o tamanho delas (3 × 4, 10 × 15, o que quiser), e a Prancha monta a folha
sozinha, de cima para baixo, com marcas de corte entre as fotos. Depois é imprimir em tamanho real
e passar a tesoura. Sem Photoshop, sem modelo de A4, sem redimensionar imagem por imagem.

🌐 **[prancha.rodrigohub.com](https://prancha.rodrigohub.com)**

![A prancha no computador: duas fotos 3 × 4 com três cópias cada e duas 10 × 15 numa folha A4](docs/prancha.png)

## O que ela faz

- **Monta a folha sozinha.** Vários tamanhos na mesma folha, organizados do topo para baixo. O que
  não cabe vai para uma folha nova.
- **Cópias e "encher a folha".** Uma foto 3 × 4 vira uma folha inteira com um clique (36 numa A4).
- **Recorte de editor de imagem.** A foto aparece inteira com alças nos cantos: arraste uma alça
  para redimensionar, arraste dentro para mover, arraste por fora para girar em qualquer ângulo.
- **Quadro no formato da foto.** Foto deitada num tamanho em pé ganha o quadro deitado
  (10 × 15 vira 15 × 10).
- **Pronta para a tesoura.** Marcas de corte nos cantos (ou contorno), 4 mm entre as fotos e 1 mm
  de sangria: se o corte desviar, não sobra filete branco.
- **Qualquer papel.** A4, A5, A3, Carta, papel foto 10 × 15 ou medida própria, em pé ou deitado.
- **Desfazer e refazer** em tudo.
- **Sai do jeito que você precisar:** impressão direta, PDF do tamanho exato da página ou imagem
  PNG em 300 dpi.
- **Nada sai do seu aparelho.** As fotos ficam no navegador; não existe servidor recebendo nada.

![O editor de recorte: a foto inteira com alças nos cantos e o quadro de 3 × 4 cm no centro](docs/editor.png)

## Como usar

**No computador** a prancha abre direto, com a folha vazia.

1. Clique em **Escolher fotos** (ou arraste as fotos para a folha).
2. No painel, ajuste a **medida** (largura × altura em cm) e as **cópias** de cada foto.
3. Clique numa foto da folha para ajustar o recorte. Arraste uma foto sobre outra para trocar
   as duas de lugar.
4. **+ Outro tamanho** acrescenta mais um tamanho na mesma folha.
5. **Imprimir**, ou **Exportar → PDF / Imagem**.

**No celular** ela vai por passos: escolher as fotos, dizer a medida e montar. O resto (cópias,
papel, ajustes) fica na própria prancha.

![No celular: escolher as fotos, dizer a medida e a folha montada](docs/celular.png)

> **Na impressora, escolha "tamanho real" (100%).** "Ajustar à página" muda a escala e as fotos
> saem com a medida errada.

## Atalhos

| | |
|---|---|
| `Ctrl` `Z` | desfazer |
| `Ctrl` `Shift` `Z` ou `Ctrl` `Y` | refazer |
| `Ctrl` `P` | imprimir a prancha |
| `Ctrl` + roda do mouse | zoom da folha na tela |
| No editor: roda do mouse | aproximar ou afastar a foto |
| No editor: `Shift` ao girar | gira de 15 em 15 graus |
| No editor: `Enter` / `Esc` | aplicar / cancelar |
| No celular: dois dedos | aproximar e girar a foto |

## Por dentro

- **Tudo é medido em milímetros.** A tela e a impressão desenham a mesma folha com a mesma
  função; só muda quantos pixels vale cada milímetro.
- **Impressão em 300 dpi.** Uma A4 sai com 2480 × 3508 pixels. Papéis maiores baixam um pouco a
  resolução para não passar de 16 megapixels, o limite de canvas do Safari no iPhone.
- **O PDF é montado no próprio navegador**, sem biblioteca: cada folha vira uma página com
  exatamente o tamanho do papel, então o leitor de PDF não tem o que reescalar.
- **O PNG leva a resolução gravada** (chunk `pHYs`), para o programa de impressão saber que são
  300 dpi em vez de chutar 72 ou 96.
- **O recorte não estraga a foto.** A original fica guardada (reduzida a no máximo 3600 px no lado
  maior); o recorte é só posição, zoom e giro, aplicados na hora de desenhar.
- **Fica salvo entre visitas.** O estado vai para o `localStorage` e as fotos para o `IndexedDB`
  do navegador. Nada é enviado para fora.

## Rodar e publicar

É um site estático, sem build e sem dependências:

```bash
python3 -m http.server 8000
# abra http://localhost:8000
```

| arquivo | o que é |
|---|---|
| `index.html` | a página |
| `estilo.css` | o visual |
| `app.js` | toda a lógica: montagem da folha, editor, desfazer, impressão, PDF e PNG |
| `icone.svg`, `manifest.webmanifest` | ícone e instalação na tela inicial do celular |
| `CNAME` | o domínio do GitHub Pages |

Publicado pelo **GitHub Pages** a partir da `main`: cada push atualiza o site em cerca de um
minuto.

---

<sub>Fotos dos exemplos: Unsplash, via Lorem Picsum.</sub>
