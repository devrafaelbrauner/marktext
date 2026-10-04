# Compatibilidade com cofres do Obsidian

O objetivo é ler e gravar as mesmas notas, não executar plugins do Obsidian.
DataviewJS, sincronização e o aplicativo móvel estão fora.

Abra a pasta do cofre. O índice ignora segmentos ocultos (`.obsidian`,
`.git`, `.trash`), `node_modules` e os padrões de exclusão da árvore. Uma
nota markdown maior que 5 MiB é listada sem metadados.

Metadados de front matter saem só de YAML (`---` na primeira linha, fecho,
depois linha em branco ou fim de arquivo). TOML (`+++`) e JSON não alimentam
tags, aliases nem o opt-out do corretor.

## O que vai e volta

| Recurso | No arquivo | No MarkText Plus |
| --- | --- | --- |
| Wikilink | `[[Nota]]`, `[[Nota\|rótulo]]`, `[[Nota#Título]]`, `[[Nota#^id]]`, `[[#Título]]`, `![[arquivo]]` | Lidos e gravados como estão. Clique abre. Ver [Links](plugins/links.md) |
| Link markdown | `[texto](Nota.md#titulo)` | Indexado. Renomear reescreve o caminho relativo |
| PDF | `[[doc.pdf#page=3]]` | Abre na página. `zoom=` é ignorado |
| Tag | `#a/b`, YAML `tags` / `tag` | Painel, conclusão, renomeação |
| Alias | `aliases` / `alias` | Guardado. Usado em menções sem link, não na resolução |
| Campo inline | `chave:: valor`, `[chave:: valor]` | Vira propriedade no Dataview. Chave em minúsculas |
| Tarefa | `- [ ]` `- [x]` e outros caracteres | Dataview TASK. Só `x`/`X` contam como concluídas |
| Nota diária | `YYYY-MM-DD.md`, ou o formato configurado | Calendário. O campo `file.day` do índice só vê `YYYY-MM-DD` |
| Modelo diário | `{{date}}`, `{{time}}`, `{{title}}`, `{{yesterday}}`, `{{tomorrow}}`, `{{date+1d:FORMATO}}` | Preenchidos ao criar. Variáveis do Templater ficam literais |
| Kanban | `kanban-plugin: board`, colunas, cartões, `%% kanban:settings` | [Kanban](plugins/kanban.md). Palavras Complete/Archive também em português |
| Dataview | bloco `dataview` com TABLE, LIST, TASK | Subconjunto em [Dataview](plugins/dataview.md). O bloco não é reescrito |
| Mermaid | bloco `mermaid`, classe `internal-link` | Pré-visualização e clique com modificador |
| Ícone | `:lucide-nome:` | Não é sintaxe do Obsidian. O arquivo continua texto |
| Comentário | `%% texto %%` | Esmaecido. Some na exportação HTML |
| Opt-out | `languagetool: false` | Específico deste fork. O Obsidian ignora a chave |

Renomear ou mover dentro do MarkText pode reescrever links nas outras notas,
se o plugin de links estiver em **Perguntar** ou **Sempre**. A aba aberta
fica sem salvar.

## O que não é o Obsidian

- `![[nota]]` não incorpora o conteúdo. É um link.
- `[[alias do front matter]]` não resolve. A resolução é caminho exato,
  caminho relativo e depois o nome de arquivo mais curto.
- `[[nota#^bloco]]` abre a nota e não rola até o bloco. Não há índice de
  blocos.
- O título visível de `[[nota#Título]]` é `nota#Título`, não só o título.
- Tags só numéricas e cores `#fff` / `#1e1e1e` não são tags. `#cafe` é.
- DataviewJS, `CALENDAR`, `GROUP BY`, `FLATTEN` e consultas inline não rodam.
- Kanban em idioma que não seja inglês ou português não reconhece as palavras
  de coluna concluída e de arquivo.
- Propriedades do Obsidian além de YAML `tags`, `aliases` e campos `chave::`
  não têm painel próprio. Elas aparecem como campos do Dataview se estiverem
  no front matter.
- Plugins `.obsidian/plugins` não são carregados.
- Callouts (`> [!note]`), embeds de título e notas periódicas semanais não
  têm tratamento especial.

Os analisadores estão em `packages/desktop/src/common/markdownExt/`
(`wikilinks.ts`, `tags.ts`, `frontMatter.ts`, `inlineFields.ts`, `resolve.ts`,
`parseNote.ts`) e nos plugins citados acima.
