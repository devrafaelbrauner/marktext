import type { Disposable, VaultChangeEvent } from '@shared/plugins/types'
import type { MetadataApi } from '../types'

/**
 * `MetadataApi` over the preload `vaultIndex` bridge; create one per window.
 * Readiness is tracked from `mt::index::ready` pushes (the index of a newly
 * opened folder starts not ready) plus one initial `is-ready` query for the
 * case where the window attached to an index that was already built.
 */
export const createMetadataApi = (bridge: VaultIndexAPI = window.vaultIndex): MetadataApi => {
  let ready = false
  // Pushes are authoritative: an `is-ready` reply that arrives after a push is stale.
  let pushesSeen = 0
  const readyListeners = new Set<() => void>()
  const changeListeners = new Set<(event: VaultChangeEvent) => void>()

  const setReady = (value: boolean): void => {
    const becameReady = value && !ready
    ready = value
    if (!becameReady) return
    for (const listener of [...readyListeners]) {
      try {
        listener()
      } catch (error) {
        console.error('[vault-index] onDidBecomeReady listener failed:', error)
      }
    }
  }

  bridge.onReadyState((state) => {
    pushesSeen++
    setReady(state.ready)
  })
  bridge.onChanged((event) => {
    for (const listener of [...changeListeners]) {
      try {
        listener(event)
      } catch (error) {
        console.error('[vault-index] onDidChange listener failed:', error)
      }
    }
  })
  const pushesBeforeQuery = pushesSeen
  bridge.isReady().then(
    (value) => {
      if (pushesSeen === pushesBeforeQuery) setReady(value)
    },
    (error: unknown) => console.error('[vault-index] is-ready failed:', error)
  )

  const subscribe = <T>(set: Set<T>, listener: T): Disposable => {
    set.add(listener)
    return { dispose: () => set.delete(listener) }
  }

  return {
    isReady: () => ready,
    onDidBecomeReady: (listener) => subscribe(readyListeners, listener),
    onDidChange: (listener) => subscribe(changeListeners, listener),
    getFile: (path) => bridge.getFile(path),
    listFiles: () => bridge.listFiles(),
    resolveLink: (target, sourcePath) => bridge.resolveLink(target, sourcePath),
    getBacklinks: (path) => bridge.getBacklinks(path),
    getTags: () => bridge.getTags(),
    getFilesWithTag: (tag, options) =>
      bridge.getFilesWithTag(tag, options ? { includeNested: options.includeNested === true } : undefined),
    request: <T = unknown>(type: string, payload: unknown) => bridge.request(type, payload) as Promise<T>
  }
}
