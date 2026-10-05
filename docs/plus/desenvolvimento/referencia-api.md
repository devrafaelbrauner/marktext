# Referência da API

Não existe um tipo `PluginContext`. Os contratos são
`RendererPluginContext` (`packages/desktop/src/renderer/src/plugins/types.ts`)
e `MainPluginContext` (`packages/desktop/src/main/plugins/types.ts`). Tipos
serializáveis ficam em `packages/desktop/src/shared/plugins/types.ts`.

Plugins embutidos são confiáveis. Nenhum método recebe permissão. O desenho
com permissões é o da [comunidade](plugins-comunidade.md); a referência
daquele lado é o SDK, não esta página.

`Disposable` é `{ dispose(): void }`. O que `register*` e `on*` devolvem já
está preso à vida do plugin. `track` faz o mesmo com um disposable seu e o
devolve.

## Renderer

`activate(ctx: RendererPluginContext): void | Promise<void>`,
`deactivate?()`.

| Membro                     | Assinatura                                       | Uso                                                                                        |
| -------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `id`                       | `string`                                         | Id do manifesto                                                                            |
| `manifest`                 | `PluginManifest`                                 | Manifesto deste plugin                                                                     |
| `t`                        | `(key, params?) => string`                       | Tradução do namespace; cai no inglês                                                       |
| `language`                 | `Readonly<Ref<string>>`                          | Idioma da interface. Observe o ref; não há evento                                          |
| `commands.register`        | `(command: PluginCommand) => Disposable`         | Paleta. `id` único, em geral `<plugin>.<ação>`                                             |
| `ui.registerSidebarPanel`  | `(panel) => Disposable`                          | `id`, `title` (chave), `icon` (SVG `currentColor`, sanitizado), `component` com prop `ctx` |
| `ui.revealSidebarPanel`    | `(panelId) => void`                              | Abre o painel                                                                              |
| `ui.registerStatusBarItem` | `(item) => Disposable`                           | Componente com prop `ctx`                                                                  |
| `ui.notify`                | `({ message, title?, type?, timeout? }) => void` | `type`: `primary` `info` `warning` `error`. `timeout` 0 não fecha                          |
| `ui.openSettings`          | `() => void`                                     | Preferências nesta ficha                                                                   |
| `track`                    | `<T extends Disposable>(d: T) => T`              | Prende à vida do plugin                                                                    |

`PluginCommand`: `id`, `title` (chave i18n), `run()`, `keybinding?` no
formato de accelerator do Electron (`CmdOrCtrl+Alt+D`). Colisão com atalho
do aplicativo deixa o binding inativo.

### `editor`

| Método                                    | Efeito                                                                                                                                                                                                                                              |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getMuya()`                               | Motor, ou `null` antes de existir                                                                                                                                                                                                                   |
| `getActiveTab()`                          | `{ id, pathname, filename, isSaved, kind: 'markdown' \| 'asset', viewId }`                                                                                                                                                                          |
| `onDidChangeActiveTab`                    |                                                                                                                                                                                                                                                     |
| `getMarkdown()`                           | Markdown da aba markdown ativa, ou `null`                                                                                                                                                                                                           |
| `onDidChangeContent`                      | `{ tabId, source: 'user' \| 'api' }`                                                                                                                                                                                                                |
| `onDidSetContent`                         | Documento carregado; decorações já limpas                                                                                                                                                                                                           |
| `setDecorations(layerId, ranges)`         | Marcas de pintura. `className` só para sublinhado, fundo e cor                                                                                                                                                                                      |
| `clearDecorations(layerId)`               |                                                                                                                                                                                                                                                     |
| `onDidClickDecoration(layerId, listener)` | `rect` para posicionar um balão                                                                                                                                                                                                                     |
| `replaceRange(edit)`                      | `false` se o texto não for mais `expected`                                                                                                                                                                                                          |
| `getCheckableBlocks(paths?)`              | Sem código, matemática, HTML nem front matter                                                                                                                                                                                                       |
| `insertText(text)`                        | No cursor                                                                                                                                                                                                                                           |
| `getSelection()`                          | `EditorSelection \| null`: `{ anchor: { path, offset }, focus: { path, offset } }`, offsets no texto do bloco; `anchor` pode vir depois de `focus`. Mantida com o editor sem foco (paleta de comandos)                                              |
| `insertMarkdownBlocks(markdown, after?)`  | Converte `markdown` em blocos e insere depois do bloco de nível superior que contém `after: BlockPath` (padrão: o bloco selecionado), num passo de desfazer. Front matter não é reconhecido. `false` se o bloco não existe ou o markdown está vazio |
| `registerInlineSyntax(rule)`              | `precedence`: `beforeEmphasis` `beforeEmoji` `afterHtml`. O texto do token é o fonte                                                                                                                                                                |
| `onDidClickInlineToken(name, listener)`   | Só Ctrl/Cmd-clique                                                                                                                                                                                                                                  |
| `registerCodeBlockRenderer(renderer)`     | `lang` em minúsculas; não pode ser linguagem de diagrama embutida                                                                                                                                                                                   |
| `registerCompletionProvider(provider)`    | `trigger` termina em `$`; grupo 1 é a consulta                                                                                                                                                                                                      |
| `requestEngineOptions(options)`           | OR entre plugins: `atxHeadingRequiresSpace`, `disableNativeSpellcheck`. `mermaid` não é OR: o pedido mais recente vence                                                                                                                             |

`RangeEdit`: `{ path, start, end, expected, replacement }`, offsets UTF-16
no `block.text`.

### `workspace`

| Método                                      | Efeito                                                                 |
| ------------------------------------------- | ---------------------------------------------------------------------- |
| `getRootPath()` / `onDidChangeRootPath`     | Pasta da janela, ou `null`                                             |
| `openFile(pathname, { anchor?, subpath? })` | Markdown no editor; outro arquivo na vista registrada para a extensão  |
| `createAndOpenFile(pathname, content)`      | Cria pastas que faltam                                                 |
| `registerTabView(view)`                     | `kind: 'asset'` com `extensions`, ou `kind: 'markdown'` com `matches?` |
| `onDidRenameFile`                           | Só renomeações feitas pelo aplicativo, não por outros programas        |

Vista markdown: `update(markdown)` deixa a aba sem salvar. Vista de asset:
`readFile(maxBytes?)` passa pelas mesmas checagens do cofre. `subpath` é o
trecho depois de `#`.

### `vault`

Caminhos absolutos. Fora da pasta: rejeição `OUTSIDE_VAULT`.

| Método                                           | Efeito                                                                                        |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `readText(path)`                                 | `{ content, mtimeMs }`                                                                        |
| `readBinary(path, maxBytes?)`                    | Teto duro 64 MiB. Maior: `TOO_LARGE`                                                          |
| `writeText(path, content, { expectedMtimeMs? })` | Aba aberta recebe a edição (sem salvar) e `mtimeMs` volta `null`. `CONFLICT` se o disco mudou |
| `createText(path, content)`                      | `EXISTS` se já existe                                                                         |
| `exists(path)`                                   |                                                                                               |
| `list({ extensions? })`                          | Para em 50 000 entradas                                                                       |

Outros códigos: `NOT_FOUND`, `DISABLED`, `UNKNOWN_METHOD`, `FAILED`.

### `metadata`

| Método                                     | Efeito                                                            |
| ------------------------------------------ | ----------------------------------------------------------------- |
| `isReady()` / `onDidBecomeReady`           | Varredura inicial terminou                                        |
| `onDidChange`                              | `{ changed, removed }` caminhos absolutos                         |
| `getFile` / `listFiles`                    | `FileMetadata` ou `null`                                          |
| `resolveLink(target, sourcePath)`          | Caminho exato, relativo, depois o nome mais curto. Não olha alias |
| `getBacklinks(path)`                       |                                                                   |
| `getTags()`                                | `{ tag, count }`                                                  |
| `getFilesWithTag(tag, { includeNested? })` | `includeNested` só se for exatamente `true`                       |
| `request(type, payload)`                   | Handler registrado no worker                                      |

`FileMetadata` está em `@shared/plugins/types`: `frontmatter`, `aliases`,
`tags` (sem `#`), `headings`, `links`, `tasks`, `fields` (chaves
minúsculas), `day`, `wordCount`.

### `settings` e `ipc`

| Método                        | Efeito                                          |
| ----------------------------- | ----------------------------------------------- |
| `settings.get(key)`           | Valor gravado ou o default do esquema           |
| `settings.set(key, value)`    | Recusa `secret`                                 |
| `settings.onDidChange`        |                                                 |
| `settings.isSecretSet(key)`   | Nunca o texto                                   |
| `ipc.invoke(method, ...args)` | Parte principal. `DISABLED` ou `UNKNOWN_METHOD` |
| `ipc.on(event, listener)`     | Eventos de `ctx.emit`                           |

## Principal

`MainPluginModule.activate(ctx)`. Hoje só `grammar` e `ai` têm uma.

| Membro                         | Assinatura                                           | Uso                              |
| ------------------------------ | ---------------------------------------------------- | -------------------------------- |
| `handle`                       | `(method, (call, ...args) => unknown) => Disposable` | `call.windowId` pode ser `null`  |
| `emit`                         | `(event, payload, windowId?) => void`                | Todas as janelas, ou uma         |
| `settings.get` / `onDidChange` |                                                      | Igual ao renderer, sem `set`     |
| `secrets.get`                  | `(key) => Promise<string \| null>`                   | Só chaves `secret` do manifesto  |
| `secrets.isSet`                | `(key) => boolean`                                   |                                  |
| `net.fetch`                    | `(url, init?) => Promise<SafeFetchResponse>`         | `GET` ou `POST`. Ver arquitetura |
| `log`                          | `info` / `warn` / `error`                            | electron-log com escopo          |
| `track`                        |                                                      | Como no renderer                 |

`SafeFetchInit`: `timeoutMs` padrão 15 000, `maxResponseBytes` padrão 5 MiB.
`SafeFetchResponse`: `status`, `ok`, `headers` em minúsculas, `body`,
`text()`, `json()`.

Argumentos de `handle` chegam como foram enviados. Valide-os. O retorno (ou
a rejeição) volta para `invoke`.
