import { describe, expect, it } from 'vitest'
import { fsChanged, type FsChange } from '../src/main/state'
import { ROOT, createCore, recordPushes } from './helpers'

const treeEvents = (pushed: unknown[][]): string[] =>
  pushed.map(([, payload]) => {
    const { type, change } = payload as { type: string; change: { pathname: string } }
    return `${type} ${change.pathname.slice(ROOT.length) || '/'}`
  })

describe('TreeSync', () => {
  it('lists folders before their content and only markdown and viewable assets', async() => {
    const { ctx } = await createCore({
      [`${ROOT}/b.md`]: '# b',
      [`${ROOT}/a/z.md`]: 'z',
      [`${ROOT}/a/deep/x.markdown`]: 'x',
      [`${ROOT}/a/photo.png`]: 'png',
      [`${ROOT}/book.pdf`]: 'pdf',
      [`${ROOT}/notes.txt`]: 'txt',
      [`${ROOT}/.git/HEAD.md`]: 'hidden',
      [`${ROOT}/node_modules/pkg/readme.md`]: 'dep'
    })
    const pushed = recordPushes(['mt::update-object-tree'])
    await ctx.tree.open(ROOT)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(treeEvents(pushed)).toEqual([
      'addDir /a',
      'addDir /a/deep',
      'add /a/deep/x.markdown',
      'add /a/z.md',
      'add /b.md',
      'add /book.pdf',
      'add /notes.txt'
    ])
    const add = pushed[2]?.[1] as { change: Record<string, unknown> }
    expect(add.change).toMatchObject({ name: 'x.markdown', isFile: true, isDirectory: false, isMarkdown: true })
    expect(add.change.birthTime).toBeInstanceOf(Date)
    expect(add.change).not.toHaveProperty('data')
    expect((pushed[0]?.[1] as { change: unknown }).change).toEqual({
      pathname: `${ROOT}/a`,
      name: 'a',
      isCollapsed: true,
      isDirectory: true,
      isFile: false,
      isMarkdown: false,
      folders: [],
      files: []
    })
  })

  it('diffs a rescan into add, change, unlink and unlinkDir, mirrored on fsChanged', async() => {
    const { ctx, backend } = await createCore({
      [`${ROOT}/keep.md`]: 'k',
      [`${ROOT}/gone.md`]: 'g',
      [`${ROOT}/old/inner.md`]: 'i'
    })
    await ctx.tree.open(ROOT)
    const pushed = recordPushes(['mt::update-object-tree'])
    const changes: FsChange[] = []
    fsChanged.on((change) => changes.push(change))

    await backend.writeFile(`${ROOT}/keep.md`, 'changed')
    await backend.remove(`${ROOT}/gone.md`)
    await backend.remove(`${ROOT}/old`)
    await backend.writeFile(`${ROOT}/new/fresh.md`, '# fresh')
    await ctx.tree.refresh()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(treeEvents(pushed)).toEqual([
      'unlink /gone.md',
      'unlink /old/inner.md',
      'unlinkDir /old',
      'change /keep.md',
      'addDir /new',
      'add /new/fresh.md'
    ])
    expect(changes.map((change) => `${change.type} ${change.pathname.slice(ROOT.length)}`)).toEqual(treeEvents(pushed))
    expect(changes.find((change) => change.type === 'change')).toMatchObject({ mtimeMs: expect.any(Number) })
  })

  it('attaches the document to adds of files the app just created', async() => {
    const { ctx, backend } = await createCore({ [`${ROOT}/a.md`]: 'a' })
    await ctx.tree.open(ROOT)
    const pushed = recordPushes(['mt::update-object-tree'])
    await backend.writeFile(`${ROOT}/sub/created.md`, '# Created\n')
    await ctx.tree.refresh([`${ROOT}/sub/created.md`], true)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(treeEvents(pushed)).toEqual(['addDir /sub', 'add /sub/created.md'])
    expect((pushed[1]?.[1] as { change: { data: unknown } }).change.data).toMatchObject({
      markdown: '# Created\n',
      filename: 'created.md',
      encoding: { encoding: 'utf8', isBom: false }
    })
  })

  it('ignores paths outside the open folder and stops after close', async() => {
    const { ctx, backend } = await createCore({ [`${ROOT}/a.md`]: 'a', '/vault/other/X/b.md': 'b' })
    await ctx.tree.open(ROOT)
    const pushed = recordPushes(['mt::update-object-tree'])
    await ctx.tree.refresh(['/vault/other/X/b.md'])
    ctx.tree.close()
    await backend.writeFile(`${ROOT}/late.md`, 'x')
    await ctx.tree.refresh()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(pushed).toEqual([])
  })
})
