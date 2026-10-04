import { locales as grammarLocales } from '@plugins/grammar/locales'
import { manifest as grammarManifest } from '@plugins/grammar/manifest'
import type { RendererPluginEntry } from './host/manager'
import { locales as linksLocales } from '@plugins/links/locales'
import { manifest as linksManifest } from '@plugins/links/manifest'

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
  },
  {
    manifest: linksManifest,
    locales: linksLocales,
    load: () => import('@plugins/links/renderer').then((m) => m.default)
  }
]
