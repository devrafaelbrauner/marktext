import { locales as grammarLocales } from '@plugins/grammar/locales'
import { manifest as grammarManifest } from '@plugins/grammar/manifest'
import type { RendererPluginEntry } from './host/manager'

/**
 * Renderer parts of the built-in plugins, in activation order. Each entry
 * reuses the plugin's manifest and locales from `@plugins/manifests` and
 * loads its code lazily, e.g.
 * `{ ...info, load: () => import('@plugins/<id>/renderer').then((m) => m.default) }`.
 */
export const BUILTIN_RENDERER_PLUGINS: RendererPluginEntry[] = [
  {
    manifest: grammarManifest,
    locales: grammarLocales,
    load: () => import('@plugins/grammar/renderer').then((m) => m.default)
  }
]
