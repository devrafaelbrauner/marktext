import { createI18n } from 'vue-i18n'
import { compile, type MessageCompiler } from '@intlify/core-base'
import bus from '../bus'
import type { PluginLocales } from '@shared/plugins/types'
import { BUILTIN_PLUGINS } from '@plugins/manifests'
import { buildPluginMessages, PLUGIN_MESSAGES_ROOT } from '../plugins/host/i18n'
// Directly import translation files
import enTranslations from '../../../../static/locales/en.json'

// vue-i18n compiles each translation lazily on first use, and its compiler
// throws a SyntaxError on any value it can't parse — e.g. a literal `{{x}}`
// (nested placeholder) or stray linked-message syntax. A single malformed
// translation then crashed the renderer; during HTML/PDF export this surfaced
// as an "Unexpected renderer process error" even though the export itself
// succeeded (issue #4046). Reuse vue-i18n's own compiler so well-formed
// messages keep their `{name}` interpolation, plurals and linked references,
// and fall back to the raw text when compilation fails.
const safeMessageCompiler: MessageCompiler = (message, context) => {
  try {
    return compile(message, context)
  } catch (err) {
    if (typeof message === 'string') {
      return () => message
    }
    throw err
  }
}

// vue-i18n's options type intersection between Composition + Legacy modes is
// notoriously difficult to satisfy with mixed shapes; we cast the options once
// at the call site rather than spreading `any` further.
const i18n = createI18n({
  legacy: false,
  locale: 'en', // default is en
  fallbackLocale: 'en',
  messages: { en: enTranslations }, // Load en by default only
  // Disable linking to avoid '@' symbols being misinterpreted
  modifiers: {
    '@': () => '@'
  },
  // Disable plural parsing
  pluralRules: {},
  // Degrade malformed translations to raw text instead of crashing the renderer.
  messageCompiler: safeMessageCompiler
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any)

// Export the translation function - Fix: correctly handle the Vue i18n v9+ global getter
export const t = (key: string, ...args: unknown[]): string => {
  // Check if the i18n instance is available
  if (!i18n) {
    console.warn('⚠️ i18n实例不可用，使用英文fallback')
    return key
  }

  try {
    // Correctly access the global property
    if (!i18n.global) {
      console.warn('⚠️ i18n.global not ready yet, falling back to EN')
      return key
    }

    // vue-i18n's `t` is heavily overloaded; the variadic call signature here
    // intentionally bypasses the strict overload set.
    return (i18n.global.t as (key: string, ...args: unknown[]) => string)(key, ...args)
  } catch (error) {
    console.error('❌ 翻译函数执行错误:', error)
    return key
  }
}

// Cache in-flight translation loads so that concurrent setLanguage() calls
// don't fire duplicate IPCs for the same locale.
const inflightLoads = new Map<string, Promise<Record<string, unknown> | undefined>>()

export const setLanguage = async(locale: string): Promise<void> => {
  if (!locale) return
  const globalI18n = i18n.global
  if (!globalI18n.availableLocales.includes(locale)) {
    let pending = inflightLoads.get(locale)
    if (!pending) {
      pending = Promise.resolve(window.i18nUtils.loadTranslations(locale)).finally(() =>
        inflightLoads.delete(locale)
      )
      inflightLoads.set(locale, pending)
    }
    const translation = await pending
    if (!translation) return // Failed to load locale file

    if (!globalI18n.availableLocales.includes(locale)) {
      globalI18n.setLocaleMessage(locale, translation)
      pluginMessageStore.mergeLocaleMessage(locale, buildPluginMessages(pluginLocales, locale))
      console.log(`🌐 Loaded and set new locale: ${locale}`)
    }
  }
  globalI18n.locale.value = locale
}

// Export the current language getter function
export const getCurrentLanguage = (): string => {
  return i18n.global.locale.value
}

// Plugin strings live under `plugins.<id>` of every language, including
// languages loaded after the plugin registered them.
const pluginLocales = new Map<string, PluginLocales>()

// The composer methods used for plugin strings, typed loosely: vue-i18n's
// generic signatures over the full message schema exceed TypeScript's
// instantiation depth (TS2589).
interface PluginMessageStore {
  availableLocales: string[]
  te(key: string): boolean
  mergeLocaleMessage(locale: string, messages: Record<string, unknown>): void
}
const pluginMessageStore = i18n.global as unknown as PluginMessageStore

export const registerPluginLocales = (pluginId: string, locales: PluginLocales): void => {
  pluginLocales.set(pluginId, locales)
  const single = new Map([[pluginId, locales]])
  for (const locale of pluginMessageStore.availableLocales) {
    pluginMessageStore.mergeLocaleMessage(locale, buildPluginMessages(single, locale))
  }
}

/** Translates `key` of a plugin's namespace in the current language; unknown keys come back unchanged. */
export const translatePluginKey = (
  pluginId: string,
  key: string,
  params?: Record<string, string | number>
): string => {
  const fullKey = `${PLUGIN_MESSAGES_ROOT}.${pluginId}.${key}`
  return pluginMessageStore.te(fullKey) ? t(fullKey, params ?? {}) : key
}

for (const { manifest, locales } of BUILTIN_PLUGINS) registerPluginLocales(manifest.id, locales)

// Export the i18n instance (named and default export)
export { i18n }
export default i18n

// Listen for language changes. `language-changed` reaches bus listeners only
// once the new messages are loaded, so a listener that re-translates its
// strings sees the new language even on the first switch to it.
if (window.electron && window.electron.ipcRenderer) {
  const applyLanguage = async(language: string): Promise<void> => {
    try {
      await setLanguage(language)
    } catch (err) {
      console.error(`Failed to load language "${language}":`, err)
    }
    bus.emit('language-changed', language)
  }
  window.electron.ipcRenderer.on('language-changed', (_event, newLocale) => {
    applyLanguage(newLocale)
  })

  // Request the current language setting at startup
  window.electron.ipcRenderer.send('mt::get-current-language')
  window.electron.ipcRenderer.on('mt::current-language', (_event, language) => {
    applyLanguage(language)
  })
}
