import type { PluginLocales, PluginManifest } from '@shared/plugins/types'
import { manifest as grammarManifest } from '@plugins/grammar/manifest'
import { locales as grammarLocales } from '@plugins/grammar/locales'
import { locales as linksLocales } from './links/locales'
import { manifest as linksManifest } from './links/manifest'

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
  { manifest: grammarManifest, locales: grammarLocales },
  { manifest: linksManifest, locales: linksLocales }
]
