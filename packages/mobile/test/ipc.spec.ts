import { describe, expect, it, vi } from 'vitest'
import { ipcMain, push, rendererIpc } from '../src/main/ipc'

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

describe('mobile ipc', () => {
  it('invoke reaches the handler with cloned arguments and returns a cloned reply', async() => {
    const reply = { nested: { n: 1 } }
    let received: unknown
    ipcMain.handle('mt::fs::path-exists', (_e, p) => {
      received = p
      return reply as unknown as boolean
    })
    const arg = '/vault/a/x.md'
    const result = await rendererIpc.invoke('mt::fs::path-exists', arg)
    expect(received).toBe(arg)
    expect(result).toEqual(reply)
    expect(result).not.toBe(reply)
  })

  it('invoke on an unhandled channel rejects like Electron', async() => {
    await expect(rendererIpc.invoke('mt::nobody-home')).rejects.toThrow(/No handler registered for 'mt::nobody-home'/)
  })

  it('refuses a second invoke handler for the same channel', () => {
    ipcMain.handle('mt::fs::stat', () => null as never)
    expect(() => ipcMain.handle('mt::fs::stat', () => null as never)).toThrow(/second handler/)
  })

  it('rejects values Electron could not clone', async() => {
    ipcMain.handle('mt::fs::is-file', () => false)
    await expect(rendererIpc.invoke('mt::fs::is-file', () => 1)).rejects.toThrow()
  })

  it('push delivers asynchronously and once listeners fire a single time', async() => {
    const seen: string[] = []
    const once = vi.fn()
    rendererIpc.on('mt::current-language', (_e, lang) => seen.push(lang as string))
    rendererIpc.once('mt::current-language', once)
    push('mt::current-language', 'pt')
    expect(seen).toEqual([])
    await flush()
    push('mt::current-language', 'en')
    await flush()
    expect(seen).toEqual(['pt', 'en'])
    expect(once).toHaveBeenCalledTimes(1)
  })

  it('removeListener with the original function detaches a once listener', async() => {
    const once = vi.fn()
    rendererIpc.once('language-changed', once)
    rendererIpc.removeListener('language-changed', once)
    rendererIpc.on('language-changed', () => {})
    push('language-changed', 'de')
    await flush()
    expect(once).not.toHaveBeenCalled()
  })

  it('sync handlers answer in the same task', () => {
    ipcMain.handleSync('mt::paths::is-same-sync', (_e, a, b) => a === b)
    expect(rendererIpc.sendSync('mt::paths::is-same-sync', '/a', '/a')).toBe(true)
  })
})
