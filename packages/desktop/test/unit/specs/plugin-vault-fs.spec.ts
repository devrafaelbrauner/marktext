// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  createText,
  exists,
  listFiles,
  readBinary,
  readText,
  writeText
} from '../../../src/main/plugins/vaultFs'
import type { PluginError } from '../../../src/main/plugins/errors'

let base: string
let root: string
let outside: string

const codeOf = async(promise: Promise<unknown>): Promise<string> => {
  try {
    await promise
  } catch (err) {
    return (err as PluginError).code ?? 'NO_CODE'
  }
  return 'RESOLVED'
}

beforeEach(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mt-vault-')))
  root = path.join(base, 'vault')
  outside = path.join(base, 'outside')
  fs.mkdirSync(path.join(root, 'notes'), { recursive: true })
  fs.mkdirSync(outside)
  fs.writeFileSync(path.join(root, 'notes', 'a.md'), '# A\n')
  fs.writeFileSync(path.join(outside, 'secret.md'), 'secret')
})

afterEach(() => {
  fs.rmSync(base, { recursive: true, force: true })
})

describe('vault scoping', () => {
  it('reads files inside the vault with their mtime', async() => {
    const file = path.join(root, 'notes', 'a.md')
    const result = await readText(root, file)
    expect(result).toEqual({ content: '# A\n', mtimeMs: fs.statSync(file).mtimeMs })
  })

  it('rejects files outside the vault, relative paths and `..` escapes', async() => {
    expect(await codeOf(readText(root, path.join(outside, 'secret.md')))).toBe('OUTSIDE_VAULT')
    expect(await codeOf(readText(root, 'notes/a.md'))).toBe('OUTSIDE_VAULT')
    expect(await codeOf(readText(root, `${root}/notes/../../outside/secret.md`))).toBe('OUTSIDE_VAULT')
    expect(await codeOf(exists(root, `${root}/../outside`))).toBe('OUTSIDE_VAULT')
  })

  it('rejects everything when no vault is open', async() => {
    expect(await codeOf(readText(null, path.join(root, 'notes', 'a.md')))).toBe('OUTSIDE_VAULT')
    expect(await listFiles(null)).toEqual([])
  })

  it('resolves `..` that stays inside the vault', async() => {
    const result = await readText(root, `${root}/notes/../notes/a.md`)
    expect(result.content).toBe('# A\n')
  })

  it('rejects symlinks that escape the vault (file, folder and missing file below a folder link)', async() => {
    fs.symlinkSync(path.join(outside, 'secret.md'), path.join(root, 'link.md'))
    fs.symlinkSync(outside, path.join(root, 'linked-dir'))
    expect(await codeOf(readText(root, path.join(root, 'link.md')))).toBe('OUTSIDE_VAULT')
    expect(await codeOf(readText(root, path.join(root, 'linked-dir', 'secret.md')))).toBe('OUTSIDE_VAULT')
    expect(await codeOf(createText(root, path.join(root, 'linked-dir', 'new.md'), 'x'))).toBe('OUTSIDE_VAULT')
    expect(fs.existsSync(path.join(outside, 'new.md'))).toBe(false)
  })

  it('refuses to write through a dangling symlink', async() => {
    fs.symlinkSync(path.join(outside, 'created.md'), path.join(root, 'dangling.md'))
    expect(await codeOf(writeText(root, path.join(root, 'dangling.md'), 'x'))).toBe('OUTSIDE_VAULT')
    expect(fs.existsSync(path.join(outside, 'created.md'))).toBe(false)
  })

  it('accepts symlinks that stay inside the vault', async() => {
    fs.symlinkSync(path.join(root, 'notes'), path.join(root, 'alias'))
    expect((await readText(root, path.join(root, 'alias', 'a.md'))).content).toBe('# A\n')
  })
})

describe('vault writes', () => {
  it('rejects a write with a stale expectedMtimeMs as CONFLICT and leaves the file alone', async() => {
    const file = path.join(root, 'notes', 'a.md')
    const { mtimeMs } = await readText(root, file)
    const written = await writeText(root, file, 'first', mtimeMs)
    expect(fs.readFileSync(file, 'utf8')).toBe('first')
    expect(await codeOf(writeText(root, file, 'second', mtimeMs - 1000))).toBe('CONFLICT')
    expect(fs.readFileSync(file, 'utf8')).toBe('first')
    await writeText(root, file, 'third', written.mtimeMs)
    expect(fs.readFileSync(file, 'utf8')).toBe('third')
  })

  it('treats a deleted file as a conflict when an mtime was expected', async() => {
    expect(await codeOf(writeText(root, path.join(root, 'gone.md'), 'x', 123))).toBe('CONFLICT')
  })

  it('creates files with missing folders and refuses to overwrite', async() => {
    const file = path.join(root, 'Daily', '2026', '2026-10-04.md')
    await createText(root, file, '# Today\n')
    expect(fs.readFileSync(file, 'utf8')).toBe('# Today\n')
    expect(await codeOf(createText(root, file, 'again'))).toBe('EXISTS')
    expect(fs.readFileSync(file, 'utf8')).toBe('# Today\n')
  })

  it('reports NOT_FOUND when writing into a missing folder', async() => {
    expect(await codeOf(writeText(root, path.join(root, 'missing', 'x.md'), 'x'))).toBe('NOT_FOUND')
  })
})

describe('vault binary reads and listing', () => {
  it('rejects files above the requested size cap as TOO_LARGE', async() => {
    const file = path.join(root, 'doc.pdf')
    fs.writeFileSync(file, Buffer.alloc(2048, 1))
    expect(await codeOf(readBinary(root, file, 1024))).toBe('TOO_LARGE')
    const bytes = await readBinary(root, file, 2048)
    expect(bytes).toBeInstanceOf(Uint8Array)
    expect(bytes.byteLength).toBe(2048)
  })

  it('lists files below the vault, skipping hidden entries and node_modules, filtered by extension', async() => {
    fs.mkdirSync(path.join(root, '.obsidian'))
    fs.writeFileSync(path.join(root, '.obsidian', 'app.json'), '{}')
    fs.mkdirSync(path.join(root, 'node_modules'))
    fs.writeFileSync(path.join(root, 'node_modules', 'x.md'), '')
    fs.writeFileSync(path.join(root, 'Doc.PDF'), 'pdf')
    const all = (await listFiles(root)).map((e) => path.relative(root, e.path)).sort()
    expect(all).toEqual(['Doc.PDF', path.join('notes', 'a.md')])
    const pdfs = await listFiles(root, ['pdf'])
    expect(pdfs.map((e) => [e.name, e.extension])).toEqual([['Doc.PDF', 'pdf']])
  })
})
