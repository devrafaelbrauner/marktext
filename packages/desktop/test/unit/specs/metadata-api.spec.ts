import { describe, expect, it, vi } from 'vitest'
import type { VaultChangeEvent } from '@shared/plugins/types'
import type { VaultIndexReadyState } from '@shared/types/ipc'
import { createMetadataApi } from '@/plugins/host/metadataApi'

const createBridge = (isReady: Promise<boolean>) => {
  let pushReady: (state: VaultIndexReadyState) => void = () => {}
  let pushChange: (event: VaultChangeEvent) => void = () => {}
  const bridge = {
    isReady: vi.fn(() => isReady),
    getFile: vi.fn(async() => null),
    listFiles: vi.fn(async() => []),
    resolveLink: vi.fn(async() => '/vault/Note.md'),
    getBacklinks: vi.fn(async() => []),
    getTags: vi.fn(async() => [{ tag: 'a', count: 2 }]),
    getFilesWithTag: vi.fn(async() => ['/vault/a.md']),
    request: vi.fn(async() => ({ rows: 3 })),
    onChanged: vi.fn((handler: (event: VaultChangeEvent) => void) => {
      pushChange = handler
      return () => {}
    }),
    onReadyState: vi.fn((handler: (state: VaultIndexReadyState) => void) => {
      pushReady = handler
      return () => {}
    })
  } satisfies VaultIndexAPI
  return { bridge, pushReady: (state: VaultIndexReadyState) => pushReady(state), pushChange: (event: VaultChangeEvent) => pushChange(event) }
}

describe('createMetadataApi', () => {
  it('becomes ready from the initial query when the index was already built', async() => {
    const { bridge } = createBridge(Promise.resolve(true))
    const api = createMetadataApi(bridge)
    const onReady = vi.fn()
    api.onDidBecomeReady(onReady)
    expect(api.isReady()).toBe(false)
    await vi.waitFor(() => expect(api.isReady()).toBe(true))
    expect(onReady).toHaveBeenCalledTimes(1)
  })

  it('follows ready pushes and fires onDidBecomeReady only on transitions to ready', async() => {
    const { bridge, pushReady } = createBridge(Promise.resolve(false))
    const api = createMetadataApi(bridge)
    const onReady = vi.fn()
    api.onDidBecomeReady(onReady)
    await Promise.resolve()

    pushReady({ rootPath: '/vault', ready: true })
    pushReady({ rootPath: '/vault', ready: true })
    expect(api.isReady()).toBe(true)
    expect(onReady).toHaveBeenCalledTimes(1)

    // The window opened another folder whose index is still being built.
    pushReady({ rootPath: '/other', ready: false })
    expect(api.isReady()).toBe(false)
    pushReady({ rootPath: '/other', ready: true })
    expect(onReady).toHaveBeenCalledTimes(2)
  })

  it('ignores an initial query answer that arrives after a push', async() => {
    let answer: (value: boolean) => void = () => {}
    const { bridge, pushReady } = createBridge(new Promise<boolean>((resolve) => (answer = resolve)))
    const api = createMetadataApi(bridge)
    pushReady({ rootPath: null, ready: false })
    answer(true)
    await Promise.resolve()
    await Promise.resolve()
    expect(api.isReady()).toBe(false)
  })

  it('delivers change events to listeners until disposed, isolating failing listeners', () => {
    const { bridge, pushChange } = createBridge(Promise.resolve(false))
    const api = createMetadataApi(bridge)
    const failing = vi.fn(() => {
      throw new Error('listener bug')
    })
    const listener = vi.fn()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    api.onDidChange(failing)
    const subscription = api.onDidChange(listener)
    const event = { changed: ['/vault/a.md'], removed: [] }
    pushChange(event)
    expect(listener).toHaveBeenCalledWith(event)
    subscription.dispose()
    pushChange(event)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(failing).toHaveBeenCalledTimes(2)
    errorSpy.mockRestore()
  })

  it('forwards queries to the bridge with normalized options', async() => {
    const { bridge } = createBridge(Promise.resolve(false))
    const api = createMetadataApi(bridge)
    await expect(api.resolveLink('Note', '/vault/a.md')).resolves.toBe('/vault/Note.md')
    expect(bridge.resolveLink).toHaveBeenCalledWith('Note', '/vault/a.md')
    await expect(api.getTags()).resolves.toEqual([{ tag: 'a', count: 2 }])
    await api.getFilesWithTag('a', { includeNested: true })
    await api.getFilesWithTag('a')
    expect(bridge.getFilesWithTag.mock.calls).toEqual([['a', { includeNested: true }], ['a', undefined]])
    await expect(api.request<{ rows: number }>('dataview.query', { q: 'TABLE' })).resolves.toEqual({ rows: 3 })
    expect(bridge.request).toHaveBeenCalledWith('dataview.query', { q: 'TABLE' })
  })
})
