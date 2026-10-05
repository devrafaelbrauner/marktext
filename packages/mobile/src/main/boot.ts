import type { BootInfo } from '@shared/types/ipc'
import { MARKDOWN_INCLUSIONS } from 'common/filesystem/extensions'
import { ipcMain } from './ipc'

// App-private root the vault and settings live under; the native side maps
// it onto Context.getFilesDir(). Renderer code only sees it as a path prefix.
export const USER_DATA_PATH = '/data/marktext'

const bootInfo = (): BootInfo => ({
  // `linux` keeps every desktop platform branch on its non-mac, non-win path.
  platform: 'linux',
  arch: 'arm64',
  versions: {},
  env: {
    NODE_ENV: import.meta.env.MODE === 'development' ? 'development' : 'production',
    MARKTEXT_VERSION_STRING: `v${MARKTEXT_VERSION}`
  },
  paths: {
    resources: '/android_asset',
    userData: USER_DATA_PATH,
    cwd: '/',
    ripgrepBinary: ''
  },
  isUpdatable: false,
  MARKDOWN_INCLUSIONS: [...MARKDOWN_INCLUSIONS]
})

export async function registerBoot(): Promise<void> {
  const info = bootInfo()
  ipcMain.handleSync('mt::boot-info', () => info)
  ipcMain.handle('mt::boot-info-async', () => info)

  // The desktop renderer reads its window arguments from the query string the
  // main process loads it with (bootstrap.ts parseUrlArgs).
  const params = new URLSearchParams({ wid: '1', udp: USER_DATA_PATH, type: 'editor' })
  window.history.replaceState(null, '', `${window.location.pathname}?${params}${window.location.hash}`)
}

declare const MARKTEXT_VERSION: string
