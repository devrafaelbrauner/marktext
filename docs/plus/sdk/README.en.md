# Community plugin SDK

Community plugins run in an `<iframe sandbox="allow-scripts">` with no preload
and an opaque origin, loaded from `mt-plugin://<id>/`. Main serves files only
from `<userData>/plugins/<id>/`. The plugin cannot see `window.electron`, the
host DOM, or the network, except what its manifest declares and the user
accepts.

The client is `@marktext-plus/plugin-sdk`. The host is the authority for
protocol 1 (`packages/desktop/src/shared/plugins/community.ts`).

## Install

Preferences → Plugins → Community. A folder or a `.zip`. The plugin is
installed disabled. Enabling shows the permissions. `--safe` keeps every
community plugin off. Uninstall deletes the folder.

Caps: zip 32 MiB, uncompressed 64 MiB, one file 8 MiB. `..`, absolute paths
and symlinks that leave the folder are rejected.

## manifest.json

`id` is kebab-case and must not collide with a built-in. `description` is a
string or `{ en, pt }`. `settings` uses the same schema as Preferences
(`boolean`, `string`, `number`, `enum`, `stringList`, `secret`). A secret can
be saved in Preferences, but a community plugin cannot read it.

## Permissions and RPC methods

Commands, `notify` and settings need no permission.

| Method                                                                                                                                                                                             | Permission                                 |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `commands.register`, `dispose`, `notify`, `settings.get`, `settings.set`, `settings.subscribe`, `ui.openSettings`                                                                                  | always                                     |
| `editor.getMarkdown`, `editor.getActiveTab`, `editor.getCheckableBlocks`, `editor.subscribeContent`, `editor.subscribeActiveTab`, `editor.subscribeSetContent`, `editor.registerCodeBlockRenderer` | `editor:read`                              |
| `editor.insertText`, `editor.replaceRange`                                                                                                                                                         | `editor:write`                             |
| `editor.setDecorations`, `editor.clearDecorations`, `editor.subscribeDecorationClick`                                                                                                              | `editor:decorate`                          |
| `vault.readText`, `vault.readBinary`, `vault.exists`, `vault.list`                                                                                                                                 | `vault:read`                               |
| `vault.writeText`, `vault.createText`                                                                                                                                                              | `vault:write`                              |
| `metadata.isReady`, `metadata.getFile`, `metadata.listFiles`, `metadata.resolveLink`, `metadata.getBacklinks`, `metadata.getTags`, `metadata.getFilesWithTag`, `metadata.subscribe`                | `metadata:read`                            |
| `net.fetch`                                                                                                                                                                                        | `network:<host>` matching the URL hostname |
| `ui.registerSidebarPanel`, `ui.revealSidebarPanel`                                                                                                                                                 | `ui:sidebar`                               |
| `ui.registerStatusBarItem`, `ui.updateStatusBarItem`                                                                                                                                               | `ui:statusbar`                             |
| `clipboard.writeText`                                                                                                                                                                              | `clipboard:write`                          |

`network:api.example.com` does not cover subdomains. Plain HTTP is only
allowed to loopback, through the same `safeFetch` built-ins use.

The host calls the plugin with `command.run`, `codeblock.render` and
`codeblock.exportHtml`. Events: `settings:change`, `editor:content-change`,
`editor:active-tab`, `editor:set-content`, `editor:decoration-click`,
`metadata:ready`, `metadata:change`, `host:language`, `host:shutdown`.

A method without its permission replies `{ ok: false, error: { code: "PERMISSION_DENIED" } }`.

## v1 limits

No inline syntax and no Vue components. A code-block renderer returns HTML;
the host sanitizes it with DOMPurify before insertion. Status bar items are
text plus a tooltip. Decorations only use `spelling`, `grammar`, `style` and
`info`. A command id must start with `<id>.`.

Activation times out after 10 seconds. A crash or timeout disables the plugin
and notifies.

## Template

`templates/community-plugin` is the per-section word counter (Vite +
TypeScript). `pnpm build` writes `dist/word-counter.zip`. The sidebar panel
is another sandboxed iframe using `definePanel`.
