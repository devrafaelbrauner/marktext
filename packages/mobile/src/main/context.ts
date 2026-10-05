// Services the Android main side modules share, built once at boot
// (src/main/core.ts) and passed explicitly so unit tests can build their own
// over a MemoryFileBackend.

import type { FileBackend } from './fs/backend'
import type { LoadOptions } from './markdownFile'
import type { Preferences, UserData } from './preferences'
import type { PathScope } from './scope'
import type { TreeSync } from './tree'

export interface CoreContext {
  backend: FileBackend
  preferences: Preferences
  userData: UserData
  scope: PathScope
  tree: TreeSync
  userDataPath: string
}

/** loadMarkdownFile arguments from the current preferences (desktop openTabs). */
export function loadOptionsFrom(preferences: Preferences): LoadOptions {
  const trim = preferences.getItem('trimTrailingNewline')
  return {
    preferredEol: preferences.getPreferredEol(),
    autoGuessEncoding: preferences.getItem('autoGuessEncoding') !== false,
    trimTrailingNewline: typeof trim === 'number' ? trim : 2,
    autoNormalizeLineEndings: preferences.getItem('autoNormalizeLineEndings') === true
  }
}
