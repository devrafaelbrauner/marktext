import { locales as aiLocales } from '@plugins/ai/locales'
import { manifest as aiManifest } from '@plugins/ai/manifest'
import { locales as dailyNotesLocales } from '@plugins/daily-notes/locales'
import { manifest as dailyNotesManifest } from '@plugins/daily-notes/manifest'
import { locales as dataviewLocales } from '@plugins/dataview/locales'
import { manifest as dataviewManifest } from '@plugins/dataview/manifest'
import { locales as grammarLocales } from '@plugins/grammar/locales'
import { manifest as grammarManifest } from '@plugins/grammar/manifest'
import { locales as iconsLocales } from '@plugins/icons/locales'
import { manifest as iconsManifest } from '@plugins/icons/manifest'
import { locales as kanbanLocales } from '@plugins/kanban/locales'
import { manifest as kanbanManifest } from '@plugins/kanban/manifest'
import { locales as linksLocales } from '@plugins/links/locales'
import { manifest as linksManifest } from '@plugins/links/manifest'
import { locales as mermaidPlusLocales } from '@plugins/mermaid-plus/locales'
import { manifest as mermaidPlusManifest } from '@plugins/mermaid-plus/manifest'
import { locales as pdfReaderLocales } from '@plugins/pdf-reader/locales'
import { manifest as pdfReaderManifest } from '@plugins/pdf-reader/manifest'
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
    manifest: linksManifest,
    locales: linksLocales,
    load: () => import('@plugins/links/renderer').then((m) => m.default)
  },
  {
    manifest: tagsManifest,
    locales: tagsLocales,
    load: () => import('@plugins/tags/renderer').then((m) => m.default)
  },
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
    manifest: dataviewManifest,
    locales: dataviewLocales,
    load: () => import('@plugins/dataview/renderer').then((m) => m.default)
  },
  {
    manifest: kanbanManifest,
    locales: kanbanLocales,
    load: () => import('@plugins/kanban/renderer').then((m) => m.default)
  },
  {
    manifest: mermaidPlusManifest,
    locales: mermaidPlusLocales,
    load: () => import('@plugins/mermaid-plus/renderer').then((m) => m.default)
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
  },
  {
    manifest: aiManifest,
    locales: aiLocales,
    load: () => import('@plugins/ai/renderer').then((m) => m.default)
  }
]
