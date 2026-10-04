import { locales as grammarLocales } from '@plugins/grammar/locales'
import { manifest as grammarManifest } from '@plugins/grammar/manifest'
import { locales as kanbanLocales } from '@plugins/kanban/locales'
import { manifest as kanbanManifest } from '@plugins/kanban/manifest'
import { locales as linksLocales } from '@plugins/links/locales'
import { manifest as linksManifest } from '@plugins/links/manifest'
import { locales as pdfReaderLocales } from '@plugins/pdf-reader/locales'
import { manifest as pdfReaderManifest } from '@plugins/pdf-reader/manifest'
import type { RendererPluginEntry } from './host/manager'

/**
 * Renderer parts of the built-in plugins, in activation order. Each entry
 * reuses the plugin's manifest and locales from `@plugins/manifests` and
 * loads its code lazily, e.g.
 * `{ ...info, load: () => import('@plugins/<id>/renderer').then((m) => m.default) }`.
 */
export const BUILTIN_RENDERER_PLUGINS: RendererPluginEntry[] = [
  {
    manifest: linksManifest,
    locales: linksLocales,
    load: () => import('@plugins/links/renderer').then((m) => m.default)
  },
  {
    manifest: kanbanManifest,
    locales: kanbanLocales,
    load: () => import('@plugins/kanban/renderer').then((m) => m.default)
  },
  {
    manifest: pdfReaderManifest,
    locales: pdfReaderLocales,
    load: () => import('@plugins/pdf-reader/renderer').then((m) => m.default)
  },
  {
    manifest: grammarManifest,
    locales: grammarLocales,
    load: () => import('@plugins/grammar/renderer').then((m) => m.default)
  }
]
