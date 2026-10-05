import { describe, expect, it } from 'vitest'
import { PathScope, normalizeVirtualPath } from '../src/main/scope'

const scopeWith = (root: string | null, userData: Record<string, unknown> = {}): PathScope =>
  new PathScope({ userDataPath: '/data/marktext', rootPath: () => root, userData: () => userData })

describe('normalizeVirtualPath', () => {
  it('normalizes absolute POSIX paths and rejects everything else', () => {
    expect(normalizeVirtualPath('/vault/k/V/a/../b.md')).toBe('/vault/k/V/b.md')
    expect(normalizeVirtualPath('/vault/k/V/')).toBe('/vault/k/V')
    expect(normalizeVirtualPath('relative/a.md')).toBeNull()
    expect(normalizeVirtualPath('//host/share/a.png')).toBeNull()
    expect(normalizeVirtualPath('/vault/a\\b')).toBeNull()
    expect(normalizeVirtualPath('/vault/a\0b')).toBeNull()
    expect(normalizeVirtualPath(42)).toBeNull()
  })
})

describe('PathScope', () => {
  it('allows the open folder and nothing beside it', () => {
    const scope = scopeWith('/vault/k/Notes')
    expect(scope.isAllowed('/vault/k/Notes')).toBe(true)
    expect(scope.isAllowed('/vault/k/Notes/sub/a.md')).toBe(true)
    expect(scope.isAllowed('/vault/k/Notes2/a.md')).toBe(false)
    expect(scope.isAllowed('/vault/k/Notes/../Other/a.md')).toBe(false)
    expect(scope.isAllowed('/vault/other/X/a.md')).toBe(false)
  })

  it('keeps the user data root out of scope but allows the app subfolders', () => {
    const scope = scopeWith(null)
    expect(scope.isAllowed('/data/marktext/preferences.json')).toBe(false)
    expect(scope.isAllowed('/data/marktext/buffer.json')).toBe(false)
    expect(scope.isAllowed('/data/marktext/images/a.png')).toBe(true)
    expect(scope.isAllowed('/data/marktext/images/../preferences.json')).toBe(false)
    expect(scope.isAllowed('/data/marktext/themes/x.css')).toBe(true)
  })

  it('allows the folders of opened documents until they close', () => {
    const scope = scopeWith(null)
    scope.addOpenedFile('/vault/k/Old/notes/a.md')
    expect(scope.isAllowed('/vault/k/Old/notes/assets/cat.png')).toBe(true)
    scope.removeOpenedFile('/vault/k/Old/notes/a.md')
    expect(scope.isAllowed('/vault/k/Old/notes/assets/cat.png')).toBe(false)
  })

  it('allows picked documents and the configured image folders', () => {
    const scope = scopeWith(null, { imageFolderPath: '/vault/k/Pics/$' + '{filename}', screenshotFolderPath: '/data/marktext/screenshot' })
    scope.grantFile('/doc/1234abcd/Letter.md')
    expect(scope.isAllowed('/doc/1234abcd/Letter.md')).toBe(true)
    expect(scope.isAllowed('/doc/9999abcd/Other.md')).toBe(false)
    expect(scope.isAllowed('/vault/k/Pics/note/a.png')).toBe(true)
  })

  it('never treats / or the user data root as a folder of an opened file', () => {
    const scope = scopeWith(null)
    scope.addOpenedFile('/top.md')
    scope.addOpenedFile('/data/marktext/stray.md')
    expect(scope.isAllowed('/etc/passwd')).toBe(false)
    expect(scope.isAllowed('/data/marktext/preferences.json')).toBe(false)
  })
})
