# Writing a built-in plugin

A built-in plugin is reviewed code, bundled with the app. It uses the same
API the community runtime is meant to see later, but there is no permission
check today: the process is trusted.

## Files

```text
packages/desktop/src/plugins/<id>/
  manifest.ts
  locales/en.json      # required
  locales/pt.json      # the nine current plugins ship it; other languages fall back to English
  locales/index.ts
  renderer/index.ts    # export default { activate, deactivate? }
  main/index.ts        # only for network, secrets, or work the renderer cannot do
  worker/index.ts      # only if the query runs in the index
```

`id` is kebab-case and stable: it namespaces settings, secrets, i18n keys,
and IPC methods.

`locales/en.json` is the namespace root. `t('panel.title')` reads
`plugins.<id>.panel.title`. Manifest `name` and `description` are keys in
that namespace, not the final text.

## Manifest

```ts
import type { PluginManifest } from '@shared/plugins/types'

export const manifest: PluginManifest = {
  id: 'example',
  version: '1.0.0',
  name: 'name',
  description: 'description',
  defaultEnabled: true,
  affectsParsing: false,
  settings: [
    { key: 'enabled', type: 'boolean', label: 'settings.enabled', default: true }
  ]
}
```

Setting types: `boolean`, `string` (`pattern`, `placeholder`, `required`),
`number` (`min`, `max`, `step`), `enum` (`options[].label` is an i18n key),
`stringList`, `secret`. A secret has no `default` and is not stored in
`plugins.json`.

Set `affectsParsing: true` when the plugin registers inline syntax or a code
block renderer: the host reloads open documents after a toggle.

## Register

1. `{ manifest, locales }` in `BUILTIN_PLUGINS`
   (`src/plugins/manifests.ts`).
2. A lazy entry in `BUILTIN_RENDERER_PLUGINS`
   (`src/renderer/src/plugins/builtin.ts`):

   ```ts
   load: () => import('@plugins/example/renderer').then((m) => m.default)
   ```

3. If there is a main part, the same in `src/main/plugins/builtin.ts`.
4. An index handler: `registerWorkerHandler` at import time in
   `worker/index.ts`. The glob in `vaultIndex/worker/entry.ts` loads it;
   there is no third list. Prefix the type (`example.query`).

The renderer calls main with `ctx.ipc.invoke('method', …)`. Main answers
with `ctx.handle` and pushes events with `ctx.emit`.

## Lifecycle

```ts
const activate = (ctx: RendererPluginContext): void => {
  ctx.commands.register({
    id: 'example.do',
    title: 'commands.do',
    keybinding: 'CmdOrCtrl+Alt+Shift+E',
    run: () => ctx.ui.notify({ message: ctx.t('notify.ok') })
  })
}

export default { activate }
```

`activate` may be async. `deactivate` is optional: the host already disposes
what `register*` / `on*` / `track` returned. Do not keep a listener outside
`ctx`.

A keybinding that collides with an app shortcut is registered and stays
inactive. The palette shows the shortcut only while it is active.

Preferences → Plugins draws the form from `settings`. Do not import Vue into
that window.

## What not to put in a new built-in unless you need it

- Network in the renderer. Use `ctx.net.fetch` in the main part.
- Reading `apiKey` in the renderer. Only `ctx.secrets.get` in main, and only
  for keys declared `secret`.
- Writing outside the opened folder. `ctx.vault` rejects that.
