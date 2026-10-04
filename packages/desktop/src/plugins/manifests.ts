import type { PluginLocales, PluginManifest } from '@shared/plugins/types'
import { locales as dailyNotesLocales } from './daily-notes/locales'
import { manifest as dailyNotesManifest } from './daily-notes/manifest'
import { locales as dataviewLocales } from './dataview/locales'
import { manifest as dataviewManifest } from './dataview/manifest'
import { locales as iconsLocales } from './icons/locales'
import { manifest as iconsManifest } from './icons/manifest'
import { locales as mermaidPlusLocales } from './mermaid-plus/locales'
import { manifest as mermaidPlusManifest } from './mermaid-plus/manifest'
import { locales as tagsLocales } from './tags/locales'
import { manifest as tagsManifest } from './tags/manifest'

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
  { manifest: iconsManifest, locales: iconsLocales },
  { manifest: dailyNotesManifest, locales: dailyNotesLocales },
  { manifest: mermaidPlusManifest, locales: mermaidPlusLocales },
  { manifest: tagsManifest, locales: tagsLocales },
  { manifest: dataviewManifest, locales: dataviewLocales }
]
