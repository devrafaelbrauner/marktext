# Calendário e notas diárias

Notas diárias compatíveis com o Obsidian, com um calendário na barra
lateral. Ligado por padrão. Id: `daily-notes`.

O calendário só funciona com uma pasta aberta.

## Onde a nota é criada

| Chave | Padrão | Efeito |
| --- | --- | --- |
| `folder` | vazio | Pasta do cofre. Vazio = raiz. Exemplo: `Diario` |
| `format` | `YYYY-MM-DD` | Nome do arquivo, tokens do moment. `/` cria subpastas |
| `template` | vazio | Caminho de uma nota modelo. `.md` é acrescentado se faltar |
| `weekStart` | `sunday` | `sunday` ou `monday` |
| `openOnStartup` | desligado | Abre a nota de hoje quando a janela abre com uma pasta |

```text
folder: Diario
format: YYYY/MM/YYYY-MM-DD
```

cria `Diario/2026/10/2026-10-04.md`. Formato vazio volta a `YYYY-MM-DD`.

Tokens que o código exercita: `YYYY`, `MM`, `DD`, `dddd`, `MMMM`, `Do`,
`Q`, `ww` / `WW`, `gggg` / `GGGG`. Com a interface em português, nomes de
dia e mês saem em pt-BR (`domingo, 4 de outubro de 2026`). Nos outros
idiomas da interface, o formato usa inglês.

O índice do cofre só marca como dia um nome de arquivo exatamente
`YYYY-MM-DD`. Este plugin também reconhece o formato configurado. Se vários
arquivos disputam o mesmo dia, vence o caminho exato da configuração, depois
quem está na pasta das notas diárias.

## Modelo

Variáveis entre chaves duplas, com espaços opcionais:

| Variável | Vira |
| --- | --- |
| `{{date}}` | o dia da nota, no formato configurado |
| `{{date:dddd, D [de] MMMM}}` | esse formato do moment |
| `{{date+1d}}` `{{date-1M:YYYY-MM}}` | deslocamento. Unidades: `y` `q` `M` `w` `d` `h` `m` `s` |
| `{{time}}` | hora atual, `HH:mm` (não a hora da nota) |
| `{{time:HH:mm:ss}}` `{{time+30m}}` | formato ou deslocamento da hora |
| `{{title}}` | nome do arquivo sem extensão |
| `{{yesterday}}` `{{tomorrow}}` | o dia anterior ou seguinte, no formato da nota |

`q` são três meses, não um trimestre de calendário. `{{yesterday}}` e
`{{tomorrow}}` não aceitam deslocamento nem formato próprio:
`{{yesterday+1d}}` e `{{title:X}}` ficam como foram escritos. Nomes
desconhecidos (`{{weather}}`) também.

```markdown
# {{title}}

[[{{yesterday}}]] · {{date:dddd}}
```

Se o arquivo de modelo não puder ser lido, a nota nasce vazia e um aviso
aparece.

## Comandos

| Id | Atalho | Nome |
| --- | --- | --- |
| `daily-notes.open-today` | `Ctrl+Alt+Shift+D` / `Cmd+Alt+Shift+D` | Abrir nota de hoje |
| `daily-notes.open-previous` | — | Nota diária anterior |
| `daily-notes.open-next` | — | Próxima nota diária |
| `daily-notes.open-calendar` | — | Abrir calendário |

`Ctrl+Alt+D` já é Duplicar, por isso a nota de hoje leva um Shift a mais.

Anterior e próxima abrem a nota diária existente mais próxima, e só se a aba
ativa já for uma nota diária. Não criam o dia vizinho vazio.

## Calendário

Seis semanas. Um ponto marca dia com nota; o tamanho acompanha a contagem
de palavras do índice. Clique cria ou abre. Setas movem o dia; Home e End,
as bordas da semana.

## Limitações

Não há notas semanais separadas: o que o formato gerar é o que existe.
`openOnStartup` dispara uma vez por janela, não de novo se você reativar o
plugin. Renomear a nota é um rename comum; o plugin de links pode atualizar
os links se estiver ligado.
