# Quadros Kanban

Abre notas do Obsidian Kanban como quadro e esmaece `%% comentários %%` no
editor. Ligado por padrão. Id: `kanban`. Sem configurações em Preferências.

Uma nota é quadro quando o front matter tem `kanban-plugin` com qualquer
texto não vazio, inclusive o valor antigo `basic`:

````markdown
---
kanban-plugin: board
---

## A fazer

- [ ] Primeiro cartão
- [x] Feito @{2026-10-04}

## Fazendo

## Concluído

**Concluído**

%% kanban:settings

```
{"kanban-plugin":"board"}
```

%%
````

O comando **Novo quadro Kanban** (`kanban.new-board`) pede o nome e cria o
arquivo ao lado da nota ativa, ou na raiz da pasta. As colunas padrão são
A fazer, Fazendo e Concluído quando a interface está em português; em inglês,
To do, Doing e Done. A última coluna nasce marcada como concluída.

Para ver o markdown, use o comando do aplicativo que alterna a vista do
documento. Voltar ao quadro relê o arquivo.

## Formato

- Uma coluna por título. Limite WIP: `## Título (3)`. `<br>` no título vira
  quebra de linha.
- Um item de lista por cartão (`-`, `*`, `+` ou `1.`), com ou sem checkbox.
  Continuação indentada com quatro espaços ou um tab. `^id` no fim da
  primeira linha é o id de bloco.
- Coluna concluída: um parágrafo `Complete` ou `Concluído`, em geral
  `**Concluído**`. Cartão que entra nela é marcado; cartão que sai é
  desmarcado.
- Arquivo: uma linha `***` (ou `---` / `___`) e depois `## Archive` ou
  `## Arquivado`. Um título Arquivo sem essa linha é coluna normal.
- O rodapé `%% kanban:settings` guarda JSON. JSON inválido é preservado e
  não é reescrito.

Datas no cartão: `@{2026-10-04}`, `@[[2026-10-04]]` (abre a nota diária) e
hora `@@{10:30}`. Os gatilhos vêm do JSON do quadro (`date-trigger`, padrão
`@`; `time-trigger`, padrão `@@`). Só data ISO vira selo. Selos anteriores a
hoje, em cartão não marcado, aparecem como atrasados.

`[[links]]` e `#tags` no cartão são clicáveis. Uma nota que não existe é
criada ao lado do quadro. `http`, `https` e `mailto` abrem fora.

## No quadro

- Coluna: renomear, limite WIP, marcar como concluída, mover, arrastar,
  excluir.
- Cartão: Enter edita, Shift+Enter quebra a linha, Esc cancela. Alt+setas
  move. Arrastar entre colunas. Arquivar e restaurar.
- Filtro: trecho do texto, sem diferenciar maiúsculas. Clicar numa tag filtra
  por `#tag`.
- `new-card-insertion-method` no JSON: `prepend` ou `prepend-compact` insere
  no topo; qualquer outro valor, no fim.

## O que volta para o Obsidian

O que o quadro não edita permanece byte a byte, inclusive CRLF e trechos
desconhecidos. Um cartão editado é regravado como `- [ ]` ou `- [x]`, com
indentação de quatro espaços.

Não é compatível por completo:

- Só as palavras *Complete* / *Concluído* e *Archive* / *Arquivado* são
  reconhecidas. Um quadro em outro idioma do Obsidian trata esses títulos
  como colunas comuns.
- `list-collapse` é mantido no JSON se já for uma lista, mas a interface não
  recolhe colunas.
- Largura de coluna, cartão ligado a uma página, formato de data que não seja
  ISO e outras chaves do Obsidian Kanban são guardadas e ignoradas.
- Cartões arquivados só podem ser restaurados ou excluídos.
