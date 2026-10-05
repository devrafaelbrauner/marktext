import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { CoreContext } from '../src/main/context'
import type { EditorWindow } from '../src/main/editorWindow'
import type { MemoryFileBackend } from '../src/main/fs/memoryBackend'
import { registerFsHandlers } from '../src/main/fsHandlers'
import { rendererIpc } from '../src/main/ipc'
import { ROOT, createCore, flush, recordPushes } from './helpers'

let backend: MemoryFileBackend
let ctx: CoreContext
let editor: EditorWindow

beforeAll(async() => {
  ;({ backend, ctx, editor } = await createCore({
    [`${ROOT}/a.md`]: '# A\n',
    [`${ROOT}/img/cat.png`]: 'png',
    [`${ROOT}/dir/x.md`]: 'x',
    '/data/marktext/preferences.json': '{}',
    '/vault/other/X/secret.md': 'nope'
  }))
  registerFsHandlers(ctx, editor)
  await editor.openFolder(ROOT)
  await editor.idle()
})

describe('mt::fs::* scope', () => {
  it('answers predicates with false outside the scope', async() => {
    expect(await rendererIpc.invoke('mt::fs::is-file', `${ROOT}/a.md`)).toBe(true)
    expect(await rendererIpc.invoke('mt::fs::is-directory', `${ROOT}/dir`)).toBe(true)
    expect(await rendererIpc.invoke('mt::fs::path-exists', '/vault/other/X/secret.md')).toBe(false)
    expect(await rendererIpc.invoke('mt::fs::is-file', '/data/marktext/preferences.json')).toBe(false)
    expect(await rendererIpc.invoke('mt::fs::is-executable', `${ROOT}/a.md`)).toBe(false)
  })

  it('rejects reads and writes outside the scope with PERMISSION_DENIED', async() => {
    await expect(rendererIpc.invoke('mt::fs::read-file', '/vault/other/X/secret.md', 'utf8')).rejects.toMatchObject({
      code: 'PERMISSION_DENIED'
    })
    await expect(rendererIpc.invoke('mt::fs::write-file', '/data/marktext/preferences.json', '{}')).rejects.toMatchObject({
      code: 'PERMISSION_DENIED'
    })
    await expect(rendererIpc.invoke('mt::fs::read-file', `${ROOT}/../X/secret.md`, 'utf8')).rejects.toMatchObject({
      code: 'PERMISSION_DENIED'
    })
  })
})

describe('mt::fs::* results', () => {
  it('reads text and bytes, stats and lists like fs-extra', async() => {
    expect(await rendererIpc.invoke('mt::fs::read-file', `${ROOT}/a.md`, 'utf8')).toBe('# A\n')
    expect(await rendererIpc.invoke('mt::fs::read-file', `${ROOT}/a.md`)).toEqual(new TextEncoder().encode('# A\n'))
    expect(await rendererIpc.invoke('mt::fs::read-file', `${ROOT}/a.md`, 'base64')).toBe(btoa('# A\n'))
    expect(await rendererIpc.invoke('mt::fs::stat', `${ROOT}/a.md`)).toMatchObject({
      size: 4,
      isFile: true,
      isDirectory: false,
      isSymbolicLink: false
    })
    expect(await rendererIpc.invoke('mt::fs::readdir', ROOT)).toEqual(['a.md', 'dir', 'img'])
    expect(await rendererIpc.invoke('mt::paths::is-image', `${ROOT}/img/cat.png`)).toBe(true)
    expect(await rendererIpc.invoke('mt::paths::is-image', `${ROOT}/a.md`)).toBe(false)
    expect(rendererIpc.sendSync('mt::paths::is-same-sync', '/a/B.md', '/a/b.md')).toBe(false)
  })

  it('creates a file from the sidebar and reports it with its document', async() => {
    const pushed = recordPushes(['mt::update-object-tree'])
    await rendererIpc.invoke('mt::fs::output-file', `${ROOT}/new/note.md`, '')
    await editor.idle()
    await flush()
    expect(await backend.readText(`${ROOT}/new/note.md`)).toBe('')
    expect(pushed.map(([, event]) => (event as { type: string }).type)).toEqual(['addDir', 'add'])
    expect((pushed[1]?.[1] as { change: { data?: unknown } }).change.data).toMatchObject({ filename: 'note.md' })
  })

  it('moves without overwriting and copies folders recursively', async() => {
    await rendererIpc.invoke('mt::fs::copy', `${ROOT}/dir`, `${ROOT}/dir-copy`)
    expect(await backend.readText(`${ROOT}/dir-copy/x.md`)).toBe('x')
    await expect(rendererIpc.invoke('mt::fs::move', `${ROOT}/dir`, `${ROOT}/dir-copy`)).rejects.toMatchObject({ code: 'EEXIST' })
    await rendererIpc.invoke('mt::fs::move', `${ROOT}/dir-copy`, `${ROOT}/moved`)
    expect(await backend.stat(`${ROOT}/dir-copy`)).toBeNull()
    expect(await backend.readText(`${ROOT}/moved/x.md`)).toBe('x')
  })

  it('stores an image under its content hash once', async() => {
    const first = await rendererIpc.invoke('mt::fs::copy-with-content-hash', `${ROOT}/img/cat.png`, `${ROOT}/assets`)
    const second = await rendererIpc.invoke('mt::fs::copy-with-content-hash', `${ROOT}/img/cat.png`, `${ROOT}/assets`)
    // `printf png | shasum -a 1`
    expect(first).toBe(`${ROOT}/assets/9040a7d6cdf7a0d6cab1823831c6ceb7d01af97f.png`)
    expect(second).toBe(first)
    expect(await backend.readText(first as string)).toBe('png')
  })

  it('deletes permanently only after confirmation', async() => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    expect(await rendererIpc.invoke('mt::fs-trash-item', `${ROOT}/a.md`)).toBe(false)
    expect(await backend.stat(`${ROOT}/a.md`)).not.toBeNull()
    expect(await rendererIpc.invoke('mt::fs-trash-item', `${ROOT}/a.md`)).toBe(true)
    expect(await backend.stat(`${ROOT}/a.md`)).toBeNull()
    expect(confirm.mock.calls[0]?.[0]).toMatch(/permanently/)
  })
})
