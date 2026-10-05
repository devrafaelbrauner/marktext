# API reference

There is no type named `PluginContext`. The contracts are
`RendererPluginContext` (`packages/desktop/src/renderer/src/plugins/types.ts`)
and `MainPluginContext` (`packages/desktop/src/main/plugins/types.ts`).
Serializable types live in `packages/desktop/src/shared/plugins/types.ts`.

Built-in plugins are trusted. No method takes a permission. The permissioned
design is the [community](community-plugins.md) one; that reference is the
SDK, not this page.

`Disposable` is `{ dispose(): void }`. What `register*` and `on*` return is
already tied to the plugin lifetime. `track` does the same for a disposable
you own and returns it.

## Renderer

`activate(ctx: RendererPluginContext): void | Promise<void>`,
`deactivate?()`.

| Member                     | Signature                                        | Use                                                                                            |
| -------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `id`                       | `string`                                         | Manifest id                                                                                    |
| `manifest`                 | `PluginManifest`                                 | This plugin's manifest                                                                         |
| `t`                        | `(key, params?) => string`                       | Namespace translation; falls back to English                                                   |
| `language`                 | `Readonly<Ref<string>>`                          | UI language. Watch the ref; there is no event                                                  |
| `commands.register`        | `(command: PluginCommand) => Disposable`         | Palette. `id` unique, conventionally `<plugin>.<action>`                                       |
| `ui.registerSidebarPanel`  | `(panel) => Disposable`                          | `id`, `title` (key), `icon` (SVG using `currentColor`, sanitized), `component` with prop `ctx` |
| `ui.revealSidebarPanel`    | `(panelId) => void`                              | Shows the panel                                                                                |
| `ui.registerStatusBarItem` | `(item) => Disposable`                           | Component with prop `ctx`                                                                      |
| `ui.notify`                | `({ message, title?, type?, timeout? }) => void` | `type`: `primary` `info` `warning` `error`. `timeout` 0 stays open                             |
| `ui.openSettings`          | `() => void`                                     | Preferences on this card                                                                       |
| `track`                    | `<T extends Disposable>(d: T) => T`              | Ties it to the plugin lifetime                                                                 |

`PluginCommand`: `id`, `title` (i18n key), `run()`, optional `keybinding` as
an Electron accelerator (`CmdOrCtrl+Alt+D`). A collision with an app
shortcut leaves the binding inactive.

### `editor`

| Method                                    | Effect                                                                                                                                                                                                                                               |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getMuya()`                               | The engine, or `null` before it exists                                                                                                                                                                                                               |
| `getActiveTab()`                          | `{ id, pathname, filename, isSaved, kind: 'markdown' \| 'asset', viewId }`                                                                                                                                                                           |
| `onDidChangeActiveTab`                    |                                                                                                                                                                                                                                                      |
| `getMarkdown()`                           | Markdown of the active markdown tab, or `null`                                                                                                                                                                                                       |
| `onDidChangeContent`                      | `{ tabId, source: 'user' \| 'api' }`                                                                                                                                                                                                                 |
| `onDidSetContent`                         | Document loaded; decorations already cleared                                                                                                                                                                                                         |
| `setDecorations(layerId, ranges)`         | Paint-only marks. `className` may only affect underline, background, and color                                                                                                                                                                       |
| `clearDecorations(layerId)`               |                                                                                                                                                                                                                                                      |
| `onDidClickDecoration(layerId, listener)` | `rect` for positioning a popover                                                                                                                                                                                                                     |
| `replaceRange(edit)`                      | `false` if the text is no longer `expected`                                                                                                                                                                                                          |
| `getCheckableBlocks(paths?)`              | Excludes code, math, HTML, and front matter                                                                                                                                                                                                          |
| `insertText(text)`                        | At the caret                                                                                                                                                                                                                                         |
| `getSelection()`                          | `EditorSelection \| null`: `{ anchor: { path, offset }, focus: { path, offset } }`, offsets into the block text; `anchor` may come after `focus`. Kept while the editor is blurred (command palette)                                                 |
| `insertMarkdownBlocks(markdown, after?)`  | Parses `markdown` into blocks and inserts them after the top-level block containing `after: BlockPath` (default: the selected block), as one undo step. Front matter is not recognized. `false` when there is no such block or the markdown is blank |
| `registerInlineSyntax(rule)`              | `precedence`: `beforeEmphasis` `beforeEmoji` `afterHtml`. Token text is the source                                                                                                                                                                   |
| `onDidClickInlineToken(name, listener)`   | Ctrl/Cmd-click only                                                                                                                                                                                                                                  |
| `registerCodeBlockRenderer(renderer)`     | lower-case `lang`; must not be a built-in diagram language                                                                                                                                                                                           |
| `registerCompletionProvider(provider)`    | `trigger` must end with `$`; group 1 is the query                                                                                                                                                                                                    |
| `requestEngineOptions(options)`           | ORed across plugins: `atxHeadingRequiresSpace`, `disableNativeSpellcheck`. `mermaid` is not ORed: the latest request wins                                                                                                                            |

`RangeEdit`: `{ path, start, end, expected, replacement }`, UTF-16 offsets
into `block.text`.

### `workspace`

| Method                                      | Effect                                                                           |
| ------------------------------------------- | -------------------------------------------------------------------------------- |
| `getRootPath()` / `onDidChangeRootPath`     | This window's folder, or `null`                                                  |
| `openFile(pathname, { anchor?, subpath? })` | Markdown in the editor; other files in the view registered for the extension     |
| `createAndOpenFile(pathname, content)`      | Creates missing folders                                                          |
| `registerTabView(view)`                     | `kind: 'asset'` with `extensions`, or `kind: 'markdown'` with optional `matches` |
| `onDidRenameFile`                           | Renames the app itself made, not changes from other programs                     |

A markdown view's `update(markdown)` leaves the tab unsaved. An asset view's
`readFile(maxBytes?)` uses the same vault checks. `subpath` is the part
after `#`.

### `vault`

Absolute paths. Outside the folder: rejection `OUTSIDE_VAULT`.

| Method                                           | Effect                                                                                                  |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `readText(path)`                                 | `{ content, mtimeMs }`                                                                                  |
| `readBinary(path, maxBytes?)`                    | Hard cap 64 MiB. Larger: `TOO_LARGE`                                                                    |
| `writeText(path, content, { expectedMtimeMs? })` | An open tab receives the edit (unsaved) and `mtimeMs` is `null`. `CONFLICT` if the file changed on disk |
| `createText(path, content)`                      | `EXISTS` if it already exists                                                                           |
| `exists(path)`                                   |                                                                                                         |
| `list({ extensions? })`                          | Stops after 50 000 entries                                                                              |

Other codes: `NOT_FOUND`, `DISABLED`, `UNKNOWN_METHOD`, `FAILED`.

### `metadata`

| Method                                     | Effect                                                                  |
| ------------------------------------------ | ----------------------------------------------------------------------- |
| `isReady()` / `onDidBecomeReady`           | The initial scan finished                                               |
| `onDidChange`                              | `{ changed, removed }` absolute paths                                   |
| `getFile` / `listFiles`                    | `FileMetadata` or `null`                                                |
| `resolveLink(target, sourcePath)`          | Exact path, then relative, then shortest name. Does not look up aliases |
| `getBacklinks(path)`                       |                                                                         |
| `getTags()`                                | `{ tag, count }`                                                        |
| `getFilesWithTag(tag, { includeNested? })` | `includeNested` only if it is exactly `true`                            |
| `request(type, payload)`                   | A handler registered in the worker                                      |

`FileMetadata` is in `@shared/plugins/types`: `frontmatter`, `aliases`,
`tags` (no `#`), `headings`, `links`, `tasks`, `fields` (lower-cased keys),
`day`, `wordCount`.

### `settings` and `ipc`

| Method                        | Effect                                    |
| ----------------------------- | ----------------------------------------- |
| `settings.get(key)`           | Stored value, or the schema default       |
| `settings.set(key, value)`    | Rejects `secret`                          |
| `settings.onDidChange`        |                                           |
| `settings.isSecretSet(key)`   | Never the plaintext                       |
| `ipc.invoke(method, ...args)` | Main part. `DISABLED` or `UNKNOWN_METHOD` |
| `ipc.on(event, listener)`     | Events from `ctx.emit`                    |

## Main

`MainPluginModule.activate(ctx)`. Only `grammar` and `ai` have one today.

| Member                         | Signature                                            | Use                                  |
| ------------------------------ | ---------------------------------------------------- | ------------------------------------ |
| `handle`                       | `(method, (call, ...args) => unknown) => Disposable` | `call.windowId` may be `null`        |
| `emit`                         | `(event, payload, windowId?) => void`                | Every window, or one                 |
| `settings.get` / `onDidChange` |                                                      | Same as the renderer, without `set`  |
| `secrets.get`                  | `(key) => Promise<string \| null>`                   | Only `secret` keys from the manifest |
| `secrets.isSet`                | `(key) => boolean`                                   |                                      |
| `net.fetch`                    | `(url, init?) => Promise<SafeFetchResponse>`         | `GET` or `POST`. See architecture    |
| `log`                          | `info` / `warn` / `error`                            | scoped electron-log                  |
| `track`                        |                                                      | Same as the renderer                 |

`SafeFetchInit`: `timeoutMs` default 15 000, `maxResponseBytes` default
5 MiB. `SafeFetchResponse`: `status`, `ok`, lower-cased `headers`, `body`,
`text()`, `json()`.

`handle` arguments arrive as sent. Validate them. The return value (or the
rejection) is delivered to `invoke`.
