# Leitor de PDF

Abre PDFs da pasta em uma aba: busca, zoom, sumário, miniaturas e link para
uma página. Ligado por padrão. Id: `pdf-reader`. Sem configurações.

O arquivo tem de estar dentro da pasta aberta nesta janela, e ter no máximo
64 MiB. Maior que isso, inexistente, corrompido ou protegido por senha mostra
um erro e o botão **Abrir no aplicativo padrão**. PDFs com senha não são
suportados. Formulários, anotações e links internos do PDF não são
interativos: a página é desenhada, e a camada de texto serve para selecionar
e buscar.

## Abrir numa página

```markdown
[[relatorio.pdf#page=3]]
[[relatorio.pdf#page=3&zoom=50]]
```

`page` é 1-based. `zoom=` é ignorado. O salto vale uma vez por link; trocar
de aba e voltar não desfaz a rolagem que você fez.

**PDF: Copiar link desta página** (`pdf-reader.copy-page-link`), também no
botão da barra, grava `[[nome.pdf#page=N]]` com o caminho mais curto entre
os PDFs da pasta. Se o nome tiver `[]|#^`, o link vira markdown comum.

## Barra e atalhos

Estes atalhos valem com a aba do PDF ativa. Não são comandos da paleta.

| Tecla | Ação |
| --- | --- |
| `Ctrl+F` / `Cmd+F` | Buscar |
| Enter, `F3`, `Ctrl+G` | Próximo; Shift, o anterior |
| Esc | Fecha a busca |
| `Ctrl+=` / `Ctrl+-` / `Ctrl+0` | Zoom; `0` ajusta à largura |
| `n` / `p`, ou setas | Página seguinte / anterior |
| Home / End | Primeira / última página |

A busca ignora maiúsculas e acentos. Não há regex nem “palavra inteira”.
Zoom de 25% a 500%, com ajustar à largura e ajustar à página. O padrão ao
abrir é ajustar à largura. Página, zoom e o interruptor de páginas escuras
não sobrevivem a fechar o aplicativo.

O painel lateral tem sumário (se o PDF tiver) e miniaturas. Um item do
sumário que é URL abre fora.

## Limitações

Sem impressão própria, sem rotação, sem anotações, sem XFA. Só a página do
fragmento `page=` é honrada.
