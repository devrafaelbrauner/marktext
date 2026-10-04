import type { PluginLocaleMessages, PluginLocales } from '@shared/plugins/types'

/** Root key of plugin strings in the app's vue-i18n messages: `plugins.<id>.<key>`. */
export const PLUGIN_MESSAGES_ROOT = 'plugins'

const deepMerge = (base: PluginLocaleMessages, override: PluginLocaleMessages): PluginLocaleMessages => {
  const result: PluginLocaleMessages = { ...base }
  for (const [key, value] of Object.entries(override)) {
    const current = result[key]
    result[key] =
      typeof value === 'object' && typeof current === 'object' ? deepMerge(current, value) : value
  }
  return result
}

/**
 * Messages of one plugin for `language`: its English bundle overlaid with the
 * bundle of that language, so every key the plugin ships in English resolves
 * in every language without relying on vue-i18n's fallback.
 */
export const resolvePluginMessages = (locales: PluginLocales, language: string): PluginLocaleMessages => {
  const translated = language === 'en' ? undefined : locales[language]
  return translated ? deepMerge(locales.en, translated) : locales.en
}

/** The `{ plugins: { <id>: messages } }` subtree to merge into the app messages of `language`. */
export const buildPluginMessages = (
  plugins: ReadonlyMap<string, PluginLocales>,
  language: string
): Record<string, Record<string, PluginLocaleMessages>> => {
  const subtree: Record<string, PluginLocaleMessages> = {}
  for (const [id, locales] of plugins) subtree[id] = resolvePluginMessages(locales, language)
  return { [PLUGIN_MESSAGES_ROOT]: subtree }
}
