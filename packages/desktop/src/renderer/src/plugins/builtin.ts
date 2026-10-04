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
    manifest: pdfReaderManifest,
    locales: pdfReaderLocales,
    load: () => import('@plugins/pdf-reader/renderer').then((m) => m.default)
  }
]
