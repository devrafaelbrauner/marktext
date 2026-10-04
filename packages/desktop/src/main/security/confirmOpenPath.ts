import path from 'path'
import { dialog } from 'electron'
import type { BrowserWindow } from 'electron'
import { isDangerousExecutableFile } from 'common/filesystem/paths'
import { t } from '../i18n'

/**
 * Whether `pathname` may be handed to the OS shell. A script or executable
 * would run silently (#3575), so those need the user's explicit consent.
 */
export const confirmOpenPath = async(win: BrowserWindow | null, pathname: string): Promise<boolean> => {
  if (!isDangerousExecutableFile(pathname)) return true
  const options = {
    type: 'warning' as const,
    buttons: [t('dialog.cancel'), t('dialog.openAnyway')],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
    title: t('dialog.unsafeFileTitle'),
    message: t('dialog.unsafeFileMessage'),
    detail: t('dialog.unsafeFileDetail', { name: path.basename(pathname) })
  }
  const { response } = win
    ? await dialog.showMessageBox(win, options)
    : await dialog.showMessageBox(options)
  return response === 1
}
