// Kept apart from watcher.ts (Electron, chokidar) so the vault index manager
// can be bundled for the Android WebView.

/**
 * Activity of directory (opened folder) watchers, observed through
 * `Watcher.addTap`. Single-file watchers are not reported. Path events
 * carry only the path; consumers re-read the file themselves.
 */
export type WatcherTapEvent =
  | { type: 'watch' | 'unwatch'; windowId: number; rootPath: string }
  | {
    type: 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir'
    windowId: number
    rootPath: string
    pathname: string
  }
