import type { PluginLocales, PluginManifest } from '@shared/plugins/types'
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

/**
 * Manifest and UI strings of one built-in plugin. Both processes read this
 * list: main to validate `plugins.json` and IPC requests, the renderer to
 * merge plugin strings into vue-i18n and to render Preferences → Plugins.
 * Code entry points are listed separately (renderer: `@/plugins/builtin`,
 * main: `src/main/plugins/builtin.ts`) so neither process bundles the other's
 * plugin code.
 */
export interface BuiltinPluginInfo {
  manifest: PluginManifest
  locales: PluginLocales
}

export const BUILTIN_PLUGINS: BuiltinPluginInfo[] = [
  { manifest: linksManifest, locales: linksLocales },
  { manifest: tagsManifest, locales: tagsLocales },
  { manifest: iconsManifest, locales: iconsLocales },
  { manifest: dailyNotesManifest, locales: dailyNotesLocales },
  { manifest: dataviewManifest, locales: dataviewLocales },
  { manifest: kanbanManifest, locales: kanbanLocales },
  { manifest: mermaidPlusManifest, locales: mermaidPlusLocales },
  { manifest: pdfReaderManifest, locales: pdfReaderLocales },
  { manifest: grammarManifest, locales: grammarLocales }
]
