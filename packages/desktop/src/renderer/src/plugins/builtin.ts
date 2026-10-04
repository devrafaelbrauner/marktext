import { locales as kanbanLocales } from '@plugins/kanban/locales'
import { manifest as kanbanManifest } from '@plugins/kanban/manifest'
import type { RendererPluginEntry } from './host/manager'

/**
 * Renderer parts of the built-in plugins, in activation order. Each entry
 * reuses the plugin's manifest and locales from `@plugins/manifests` and
 * loads its code lazily, e.g.
 * `{ ...info, load: () => import('@plugins/<id>/renderer').then((m) => m.default) }`.
 */
export const BUILTIN_RENDERER_PLUGINS: RendererPluginEntry[] = [
  {
    manifest: kanbanManifest,
    locales: kanbanLocales,
    load: () => import('@plugins/kanban/renderer').then((m) => m.default)
  }
]
