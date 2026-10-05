// Message boxes the desktop main process shows with `dialog.showMessageBox`.
// The WebView's `window.confirm` is a native Android AlertDialog (Capacitor's
// WebChromeClient), so a Yes/No question needs no extra plugin. Desktop's
// three-button "Save / Don't save / Cancel" becomes two questions.

import { isMobileFsError } from './fs/backend'
import { translate } from './i18n'
import { UnsupportedEncodingError } from './markdownFile'

// Android-only wording, plus the desktop main process's untranslated
// notification titles, in English and the locales with a translator on this
// fork; other languages fall back to English.
const ANDROID_STRINGS = {
  en: {
    deletePermanently: 'Delete "{name}" permanently? Android has no trash.',
    discardChanges: 'Close without saving? Your changes will be lost.',
    fileMissing: 'Could not find file {name} on disk, please save your work.',
    cannotOpenFolder: 'Cannot open folder',
    cannotOpenTab: 'Cannot open file',
    cannotSave: 'Cannot save file',
    cannotRename: 'Cannot rename file',
    cannotMove: 'Cannot move file',
    cannotReload: 'Cannot reload the file changed by another app',
    unsupportedEncoding: 'Saving as "{name}" is not supported on Android; change the file encoding to UTF-8.',
    ENOENT: 'The file or folder no longer exists.',
    EEXIST: 'A file with this name already exists.',
    ENOTDIR: 'The path is not a folder.',
    EISDIR: 'The path is a folder.',
    ENOTEMPTY: 'The folder is not empty.',
    PERMISSION_DENIED: 'Android revoked access. Choose the folder again in ☰ → Open Folder.',
    UNSUPPORTED_ON_ANDROID: 'Not available on Android.',
    EIO: 'The storage provider reported an error.'
  },
  pt: {
    deletePermanently: 'Excluir "{name}" permanentemente? O Android não tem lixeira.',
    discardChanges: 'Fechar sem salvar? Suas alterações serão perdidas.',
    fileMissing: 'O arquivo {name} não foi encontrado. Salve seu trabalho.',
    cannotOpenFolder: 'Não foi possível abrir a pasta',
    cannotOpenTab: 'Não foi possível abrir o arquivo',
    cannotSave: 'Não foi possível salvar o arquivo',
    cannotRename: 'Não foi possível renomear o arquivo',
    cannotMove: 'Não foi possível mover o arquivo',
    cannotReload: 'Não foi possível recarregar o arquivo alterado por outro app',
    unsupportedEncoding: 'Salvar em "{name}" não é suportado no Android; mude a codificação do arquivo para UTF-8.',
    ENOENT: 'O arquivo ou a pasta não existe mais.',
    EEXIST: 'Já existe um arquivo com esse nome.',
    ENOTDIR: 'O caminho não é uma pasta.',
    EISDIR: 'O caminho é uma pasta.',
    ENOTEMPTY: 'A pasta não está vazia.',
    PERMISSION_DENIED: 'O Android revogou o acesso. Escolha a pasta de novo em ☰ → Abrir pasta.',
    UNSUPPORTED_ON_ANDROID: 'Não disponível no Android.',
    EIO: 'O armazenamento informou um erro.'
  }
} satisfies Record<string, Record<string, string>>

export type AndroidStringKey = keyof (typeof ANDROID_STRINGS)['en']

export function androidString(language: string, key: AndroidStringKey, name = ''): string {
  const table: Record<AndroidStringKey, string> =
    language in ANDROID_STRINGS ? ANDROID_STRINGS[language as keyof typeof ANDROID_STRINGS] : ANDROID_STRINGS.en
  return table[key].replace('{name}', name)
}

/** User-facing text of a failure: file errors by code, others as thrown. */
export function describeError(language: string, error: unknown): string {
  if (isMobileFsError(error)) return androidString(language, error.code)
  if (error instanceof UnsupportedEncodingError) return androidString(language, 'unsupportedEncoding', error.encoding)
  return error instanceof Error ? error.message : String(error)
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
