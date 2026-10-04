/** Why a PDF could not be shown; each kind has its own message in the locales (`error.<kind>`). */
export type LoadErrorKind = 'encrypted' | 'invalid' | 'tooLarge' | 'notFound' | 'outsideVault' | 'unknown'

/**
 * Classifies a rejection of the file read (vault `PluginError` codes) or of
 * pdf.js `getDocument` (exception class names, which survive the worker
 * boundary while `instanceof` does not).
 */
export const classifyLoadError = (error: unknown): LoadErrorKind => {
  if (!error || typeof error !== 'object') return 'unknown'
  const { name, code } = error as { name?: unknown; code?: unknown }
  if (name === 'PasswordException') return 'encrypted'
  if (name === 'InvalidPDFException') return 'invalid'
  if (code === 'TOO_LARGE') return 'tooLarge'
  if (code === 'NOT_FOUND') return 'notFound'
  if (code === 'OUTSIDE_VAULT') return 'outsideVault'
  return 'unknown'
}
