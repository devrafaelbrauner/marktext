import { locales as dailyNotesLocales } from '@plugins/daily-notes/locales'
import { manifest as dailyNotesManifest } from '@plugins/daily-notes/manifest'
import { locales as dataviewLocales } from '@plugins/dataview/locales'
import { manifest as dataviewManifest } from '@plugins/dataview/manifest'
import { locales as iconsLocales } from '@plugins/icons/locales'
import { manifest as iconsManifest } from '@plugins/icons/manifest'
import { locales as mermaidPlusLocales } from '@plugins/mermaid-plus/locales'
import { manifest as mermaidPlusManifest } from '@plugins/mermaid-plus/manifest'
import { locales as tagsLocales } from '@plugins/tags/locales'
import { manifest as tagsManifest } from '@plugins/tags/manifest'
import type { RendererPluginEntry } from './host/manager'

/**
 * Renderer parts of the built-in plugins, in activation order. Each entry
 * reuses the plugin's manifest and locales from `@plugins/manifests` and
 * loads its code lazily, e.g.
 * `{ ...info, load: () => import('@plugins/<id>/renderer').then((m) => m.default) }`.
 */
export const BUILTIN_RENDERER_PLUGINS: RendererPluginEntry[] = [
  {
    manifest: iconsManifest,
    locales: iconsLocales,
    load: () => import('@plugins/icons/renderer').then((m) => m.default)
  },
  {
    manifest: dailyNotesManifest,
    locales: dailyNotesLocales,
    load: () => import('@plugins/daily-notes/renderer').then((m) => m.default)
  },
  {
    manifest: mermaidPlusManifest,
    locales: mermaidPlusLocales,
    load: () => import('@plugins/mermaid-plus/renderer').then((m) => m.default)
  },
  {
    manifest: tagsManifest,
    locales: tagsLocales,
    load: () => import('@plugins/tags/renderer').then((m) => m.default)
  },
  {
    manifest: dataviewManifest,
    locales: dataviewLocales,
    load: () => import('@plugins/dataview/renderer').then((m) => m.default)
  }
]
