// Locale files for the renderer (`mt::i18n::*`) and the few strings the
// Android main side shows itself (save confirmations). Desktop reads
// static/locales/<lang>.json with fs (common/i18n.ts); here every locale is a
// lazy chunk of the web build.

import { ipcMain } from './ipc'

type Translations = Record<string, unknown>

const LOCALE_MODULES = import.meta.glob<Translations>('../../../desktop/static/locales/*.json', {
  import: 'default'
})

const loaders: Record<string, () => Promise<Translations>> = {}
for (const [path, load] of Object.entries(LOCALE_MODULES)) {
  const language = /\/([^/]+)\.json$/.exec(path)?.[1]
  // The minified twins hold the same strings.
  if (language && !language.endsWith('.min')) loaders[language] = load
}

export const supportedLanguages = (): string[] => Object.keys(loaders).sort()

const cache: Record<string, Translations> = {}

/** common/i18n loadTranslations: falls back to English, `null` when even that fails. */
export async function loadTranslations(language: string): Promise<Translations | null> {
  const cached = cache[language]
  if (cached) return cached
  const load = loaders[language]
  try {
    if (!load) throw new Error(`Translation file not found for language: ${language}`)
    return (cache[language] = await load())
  } catch (error) {
    console.error('Error loading translation:', error)
    return language === 'en' ? null : loadTranslations('en')
  }
}

/** common/i18n getTranslation: dot-separated key, `{param}` substitution, the key itself when missing. */
export async function translate(
  language: string,
  key: string,
  params: Record<string, string | number> = {}
): Promise<string> {
  let probe: unknown = await loadTranslations(language)
  for (const segment of key.split('.')) {
    if (!probe || typeof probe !== 'object' || !(segment in probe)) return key
    probe = Reflect.get(probe, segment) as unknown
  }
  if (typeof probe !== 'string') return key
  let result = probe
  for (const [param, replacement] of Object.entries(params)) {
    result = result.replace(new RegExp(`\\{${param}\\}`, 'g'), () => String(replacement))
  }
  return result
}

export function registerI18n(): void {
  ipcMain.handle('mt::i18n::load', async(_event, language) => {
    const translations = typeof language === 'string' && language in loaders ? await loadTranslations(language) : null
    // Desktop answers `null` ("could not load", the renderer keeps its locale)
    // although the channel type declares a record.
    return translations ?? (null as unknown as Translations)
  })
  ipcMain.handle('mt::i18n::supported', () => supportedLanguages())
  ipcMain.handle('mt::i18n::is-supported', (_event, language) => language in loaders)
}
