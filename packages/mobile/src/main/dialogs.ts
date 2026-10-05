// Message boxes the desktop main process shows with `dialog.showMessageBox`.
// The WebView's `window.confirm` is a native Android AlertDialog (Capacitor's
// WebChromeClient), so a Yes/No question needs no extra plugin. Desktop's
// three-button "Save / Don't save / Cancel" becomes two questions.

import { translate } from './i18n'

// Android-only wording (no trash, two-step close), English plus the locales
// with a translator on this fork; other languages fall back to English.
const ANDROID_STRINGS: Record<string, Record<string, string>> = {
  en: {
    deletePermanently: 'Delete "{name}" permanently? Android has no trash.',
    discardChanges: 'Close without saving? Your changes will be lost.'
  },
  pt: {
    deletePermanently: 'Excluir "{name}" permanentemente? O Android não tem lixeira.',
    discardChanges: 'Fechar sem salvar? Suas alterações serão perdidas.'
  }
}

export function androidString(language: string, key: 'deletePermanently' | 'discardChanges', name = ''): string {
  const table = ANDROID_STRINGS[language] ?? ANDROID_STRINGS.en
  return (table?.[key] ?? '').replace('{name}', name)
}

export type UnsavedChoice = 'save' | 'discard' | 'cancel'

/** desktop showUnsavedFilesMessage. */
export async function askUnsavedChanges(language: string, filenames: string[]): Promise<UnsavedChoice> {
  const count = filenames.length
  const type = await translate(language, count === 1 ? 'dialog.file' : 'dialog.files')
  const question = await translate(language, 'dialog.saveChanges', { count, type, files: filenames.join('\n') })
  if (window.confirm(`${question}\n\n${filenames.join('\n')}`)) return 'save'
  return window.confirm(androidString(language, 'discardChanges')) ? 'discard' : 'cancel'
}
