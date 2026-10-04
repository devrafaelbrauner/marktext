import { beforeEach, describe, expect, it, vi } from 'vitest'
import { dialog, shell } from 'electron'
import { registerShellHandlers } from 'main_renderer/ipc/shell'
import { registerI18nHandlers } from 'main_renderer/ipc/i18n'
import { validateSender } from 'main_renderer/security/validateSender'

type Handler = (event: unknown, ...args: unknown[]) => unknown

const { handlers, listeners } = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  listeners: new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: Handler) => handlers.set(channel, fn),
    on: (channel: string, fn: Handler) => listeners.set(channel, fn)
  },
  shell: { openExternal: vi.fn(async() => {}), openPath: vi.fn(async() => ''), showItemInFolder: vi.fn() },
  dialog: { showMessageBox: vi.fn() },
  BrowserWindow: { fromWebContents: vi.fn(() => ({})) },
  clipboard: {},
  nativeImage: {}
}))
vi.mock('electron-log', () => ({ default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }))
vi.mock('main_renderer/security/validateSender', () => ({ validateSender: vi.fn(() => true) }))
vi.mock('main_renderer/i18n', () => ({ t: (key: string) => key }))

registerShellHandlers()
registerI18nHandlers()

const invoke = (channel: string, ...args: unknown[]) => handlers.get(channel)!({ sender: {} }, ...args)

beforeEach(() => {
  vi.mocked(shell.openExternal).mockClear()
  vi.mocked(shell.openPath).mockClear()
  vi.mocked(dialog.showMessageBox).mockReset()
  vi.mocked(validateSender).mockReturnValue(true)
})

describe('mt::shell::open-external', () => {
  it.each(['https://marktext.app', 'http://example.com/a', 'mailto:me@example.com'])('opens %s', async(url) => {
    await expect(invoke('mt::shell::open-external', url)).resolves.toBe(true)
    expect(shell.openExternal).toHaveBeenCalledWith(url)
  })

  it.each(['file:///Applications/Calculator.app', 'smb://host/share', 'javascript:alert(1)', 'ms-msdt:/id', 'not a url', 42])(
    'refuses %s', async(url) => {
      await expect(invoke('mt::shell::open-external', url)).resolves.toBe(false)
      listeners.get('mt::shell::open-external')!({ sender: {} }, url)
      expect(shell.openExternal).not.toHaveBeenCalled()
    }
  )

  it('refuses a sender that is not the app renderer', async() => {
    vi.mocked(validateSender).mockReturnValue(false)
    expect(await invoke('mt::shell::open-external', 'https://marktext.app')).toBe(false)
    expect(shell.openExternal).not.toHaveBeenCalled()
  })
})

describe('mt::shell::open-path', () => {
  it('opens a non-executable file without asking', async() => {
    await invoke('mt::shell::open-path', '/notes/image.png')
    expect(dialog.showMessageBox).not.toHaveBeenCalled()
    expect(shell.openPath).toHaveBeenCalledWith('/notes/image.png')
  })

  it('does not open a dangerous executable unless the user confirms', async() => {
    vi.mocked(dialog.showMessageBox).mockResolvedValueOnce({ response: 0, checkboxChecked: false })
    await invoke('mt::shell::open-path', '/notes/run.command')
    expect(shell.openPath).not.toHaveBeenCalled()

    vi.mocked(dialog.showMessageBox).mockResolvedValueOnce({ response: 1, checkboxChecked: false })
    await invoke('mt::shell::open-path', '/notes/run.command')
    expect(shell.openPath).toHaveBeenCalledWith('/notes/run.command')
  })
})

describe('mt::i18n::load', () => {
  it('loads a supported language', () => {
    const result = invoke('mt::i18n::load', 'pt') as Record<string, unknown> | null
    expect(result).not.toBeNull()
    expect(Object.keys(result!).length).toBeGreaterThan(0)
  })

  it.each(['../../../etc/passwd', 'xx', '', 42])('returns null for unsupported %s', (language) => {
    expect(invoke('mt::i18n::load', language)).toBeNull()
  })
})
