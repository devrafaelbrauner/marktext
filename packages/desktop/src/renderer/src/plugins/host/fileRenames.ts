import type { Disposable } from '@shared/plugins/types'
import type { FileRenameEvent } from '../types'

type Listener = (event: FileRenameEvent) => void

const listeners = new Set<Listener>()

/**
 * Window-wide hub for renames and moves the app performed itself (menu
 * Rename/Move to, sidebar rename, sidebar cut/paste). Called by the stores
 * after the file system operation succeeded and the tabs were updated.
 */
export const notifyFileRenamed = (event: FileRenameEvent): void => {
  if (event.oldPath === event.newPath) return
  for (const listener of [...listeners]) {
    try {
      listener(event)
    } catch (err) {
      console.error('[plugins] onDidRenameFile listener failed:', err)
    }
  }
}

export const onDidRenameFile = (listener: Listener): Disposable => {
  listeners.add(listener)
  return {
    dispose: () => {
      listeners.delete(listener)
    }
  }
}
