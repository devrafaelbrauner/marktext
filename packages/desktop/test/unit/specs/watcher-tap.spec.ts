import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The vault index learns which window shows which folder, and every change
// below it, only through Watcher.addTap. These tests pin that every way a
// directory watcher ends is reported, and that file watchers stay silent.

type Handler = (...args: unknown[]) => void
const created: Array<{ handlers: Record<string, Handler>; close: ReturnType<typeof vi.fn> }> = []

vi.mock('chokidar', () => ({
  default: {
    watch: () => {
      const handlers: Record<string, Handler> = {}
      const fake = {
        handlers,
        close: vi.fn(),
        on: vi.fn((event: string, handler: Handler) => {
          handlers[event] = handler
          return fake
        })
      }
      created.push(fake)
      return fake
    }
  }
}))

// See watcher-await-write-finish.spec.ts: the markdown loader pulls in the native `ced` addon.
vi.mock('ced', () => ({ default: () => 'UTF-8' }))

import Watcher, { type WatcherTapEvent } from 'main_renderer/filesystem/watcher'

describe('Watcher tap', () => {
  let watcher: Watcher
  let events: WatcherTapEvent[]
  let removeTap: () => void
  const win = { id: 7, webContents: { send: vi.fn() } }

  beforeEach(() => {
    created.length = 0
    events = []
    watcher = new Watcher({ getItem: vi.fn(() => false) } as never)
    removeTap = Watcher.addTap((event) => events.push(event))
  })

  afterEach(() => {
    removeTap()
  })

  it('reports directory watch start, path events and unwatch', () => {
    watcher.watch(win as never, '/vault', 'dir')
    created[0].handlers.all('add', '/vault/a.md')
    created[0].handlers.all('unlinkDir', '/vault/sub')
    created[0].handlers.all('ready', '/vault')
    watcher.unwatch(win as never, '/vault', 'dir')
    expect(events).toEqual([
      { type: 'watch', windowId: 7, rootPath: '/vault' },
      { type: 'add', windowId: 7, rootPath: '/vault', pathname: '/vault/a.md' },
      { type: 'unlinkDir', windowId: 7, rootPath: '/vault', pathname: '/vault/sub' },
      { type: 'unwatch', windowId: 7, rootPath: '/vault' }
    ])
  })

  it('reports unwatch when the window closes or all watchers close', () => {
    watcher.watch(win as never, '/vault', 'dir')
    watcher.unwatchByWindowId(7)
    watcher.watch(win as never, '/other', 'dir')
    watcher.close()
    expect(events.filter((event) => event.type === 'unwatch')).toEqual([
      { type: 'unwatch', windowId: 7, rootPath: '/vault' },
      { type: 'unwatch', windowId: 7, rootPath: '/other' }
    ])
  })

  it('ignores single-file watchers and stops after the tap is removed', () => {
    watcher.watch(win as never, '/vault/a.md', 'file')
    expect(created[0].handlers.all).toBeUndefined()
    watcher.unwatch(win as never, '/vault/a.md', 'file')
    expect(events).toEqual([])
    removeTap()
    watcher.watch(win as never, '/vault', 'dir')
    expect(events).toEqual([])
  })
})
