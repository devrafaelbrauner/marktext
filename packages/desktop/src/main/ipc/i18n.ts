import { ipcMain } from 'electron'
import { loadTranslations, getSupportedLanguages, isLanguageSupported } from 'common/i18n'

export const registerI18nHandlers = (): void => {
  // The language becomes part of a file path inside loadTranslations; null is
  // the renderer's existing "could not load" answer.
  ipcMain.handle('mt::i18n::load', (_e, language: unknown) =>
    typeof language === 'string' && isLanguageSupported(language) ? loadTranslations(language) : null
  )
  ipcMain.handle('mt::i18n::supported', () => getSupportedLanguages())
  ipcMain.handle('mt::i18n::is-supported', (_e, language: string) => isLanguageSupported(language))
}
