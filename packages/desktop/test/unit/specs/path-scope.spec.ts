import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  imageFolderRoots,
  isPathInScope,
  isRealImageFile,
  userDataSubdirectories
} from 'main_renderer/security/pathScope'

const created: string[] = []

const tempDir = (prefix: string): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  created.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of created.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('isPathInScope', () => {
  it('allows each kind of root and rejects a path outside them', () => {
    const opened = tempDir('scope-opened-')
    const tabDir = tempDir('scope-tab-')
    const pickedDir = tempDir('scope-picked-dir-')
    const pickedFile = path.join(tempDir('scope-picked-file-'), 'chosen.md')
    const imageFolder = tempDir('scope-images-')
    const userData = tempDir('scope-userdata-')
    const temp = tempDir('scope-temp-')
    const outside = tempDir('scope-outside-')
    fs.writeFileSync(path.join(opened, 'note.md'), '# hi')
    fs.writeFileSync(path.join(tabDir, 'open.md'), '# tab')
    fs.writeFileSync(pickedFile, 'picked')
    fs.mkdirSync(path.join(userData, 'themes', 'export'), { recursive: true })
    fs.writeFileSync(path.join(userData, 'themes', 'export', 'mine.css'), '/* Mine */')
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'no')

    const directories = [
      opened,
      tabDir,
      pickedDir,
      imageFolder,
      ...userDataSubdirectories(userData),
      temp
    ]
    const files = [pickedFile]

    expect(isPathInScope(path.join(opened, 'note.md'), directories, files)).toBe(true)
    expect(isPathInScope(path.join(opened, 'new.md'), directories, files)).toBe(true)
    expect(isPathInScope(path.join(tabDir, 'assets', 'a.png'), directories, files)).toBe(true)
    expect(isPathInScope(path.join(pickedDir, 'child.txt'), directories, files)).toBe(true)
    expect(isPathInScope(pickedFile, directories, files)).toBe(true)
    expect(isPathInScope(path.join(imageFolder, 'hash.png'), directories, files)).toBe(true)
    expect(isPathInScope(path.join(userData, 'themes', 'export', 'mine.css'), directories, files)).toBe(true)
    expect(isPathInScope(path.join(userData, 'logs', 'main.log'), directories, files)).toBe(true)
    expect(isPathInScope(path.join(userData, 'screenshot', 'shot.png'), directories, files)).toBe(true)
    expect(isPathInScope(path.join(userData, 'images', 'a.png'), directories, files)).toBe(true)
    expect(isPathInScope(path.join(userData, 'editorStates', '1.json'), directories, files)).toBe(true)
    expect(isPathInScope(path.join(userData, 'vault-index', 'cache.json'), directories, files)).toBe(true)
    expect(isPathInScope(path.join(temp, 'upload.png'), directories, files)).toBe(true)

    expect(isPathInScope(path.join(outside, 'secret.txt'), directories, files)).toBe(false)
    expect(isPathInScope(path.join(userData, 'secrets.json'), directories, files)).toBe(false)
    expect(isPathInScope('\\\\attacker\\share\\x.png', directories, files)).toBe(false)
    expect(isPathInScope('//attacker/share/x.png', directories, files)).toBe(false)
  })

  it('rejects a symlink that escapes an allowed root', () => {
    const root = tempDir('scope-link-root-')
    const outside = tempDir('scope-link-out-')
    fs.writeFileSync(path.join(outside, 'secret.png'), 'png')
    fs.symlinkSync(outside, path.join(root, 'escape'))

    expect(isPathInScope(path.join(root, 'escape', 'secret.png'), [root], [])).toBe(false)
    expect(isPathInScope(path.join(root, 'inside.md'), [root], [])).toBe(true)
  })

  it('allows a symlink whose target stays inside the root', () => {
    const root = tempDir('scope-link-in-')
    const real = path.join(root, 'real.png')
    fs.writeFileSync(real, 'png')
    fs.symlinkSync(real, path.join(root, 'alias.png'))
    expect(isPathInScope(path.join(root, 'alias.png'), [root], [])).toBe(true)
  })
})

describe('image folder roots and image copy sources', () => {
  it('uses the static prefix of an imageFolderPath template', () => {
    const token = '${' + 'filename}'
    expect(imageFolderRoots('/pics/' + token + '/assets')).toEqual(['/pics'])
    expect(imageFolderRoots('/pics/images')).toEqual(['/pics/images'])
    expect(imageFolderRoots(token)).toEqual([])
  })

  it('accepts a real image and rejects a symlink to a non-image', () => {
    const dir = tempDir('scope-image-')
    const png = path.join(dir, 'a.png')
    const secret = path.join(dir, 'secret.txt')
    const link = path.join(dir, 'photo.png')
    fs.writeFileSync(png, 'png')
    fs.writeFileSync(secret, 'no')
    fs.symlinkSync(secret, link)
    expect(isRealImageFile(png)).toBe(true)
    expect(isRealImageFile(link)).toBe(false)
    expect(isRealImageFile('\\\\attacker\\share\\x.png')).toBe(false)
  })
})
