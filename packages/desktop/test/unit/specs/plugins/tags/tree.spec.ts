import { describe, expect, it } from 'vitest'
import type { TagCount } from '@shared/plugins/types'
import { buildTagTree, collectParentKeys, flattenTagTree, type TagTreeNode } from '@plugins/tags/common/tree'

const shape = (nodes: TagTreeNode[]): unknown =>
  nodes.map((node) => (node.children.length ? [node.tag, node.count, shape(node.children)] : [node.tag, node.count]))

// What VaultIndex.getTags returns for the fixture vault's project/idea notes:
// each parent counts the notes having it or any nested tag.
const INDEX_TAGS: TagCount[] = [
  { tag: 'idea', count: 1 },
  { tag: 'project', count: 3 },
  { tag: 'idea/product', count: 1 },
  { tag: 'idea/research', count: 1 },
  { tag: 'project/alpha', count: 2 },
  { tag: 'project/beta', count: 1 },
  { tag: 'a', count: 1 },
  { tag: 'a/b', count: 1 },
  { tag: 'a/b/c', count: 1 }
]

describe('tags: buildTagTree', () => {
  it('nests tags by `/` with the index counts and sorts siblings by name', () => {
    expect(shape(buildTagTree(INDEX_TAGS))).toEqual([
      ['a', 1, [['a/b', 1, [['a/b/c', 1]]]]],
      ['idea', 1, [['idea/product', 1], ['idea/research', 1]]],
      ['project', 3, [['project/alpha', 2], ['project/beta', 1]]]
    ])
  })

  it('names nodes by their last segment', () => {
    const [a] = buildTagTree(INDEX_TAGS)
    expect([a.name, a.children[0].name, a.children[0].children[0].name]).toEqual(['a', 'b', 'c'])
  })

  it('merges spellings case-insensitively, keeping the listed spelling of a parent', () => {
    const tree = buildTagTree([
      { tag: 'Project/Alpha', count: 1 },
      { tag: 'project', count: 2 },
      { tag: 'PROJECT/beta', count: 1 }
    ])
    expect(shape(tree)).toEqual([['project', 2, [['Project/Alpha', 1], ['PROJECT/beta', 1]]]])
  })

  it('gives a parent missing from the list the largest child count', () => {
    expect(shape(buildTagTree([{ tag: 'x/y', count: 2 }, { tag: 'x/z', count: 5 }]))).toEqual([
      ['x', 5, [['x/y', 2], ['x/z', 5]]]
    ])
  })

  it('ignores a leading `#`, trailing slashes and empty levels', () => {
    expect(shape(buildTagTree([{ tag: '#solo/', count: 1 }, { tag: 'a//b', count: 1 }, { tag: '', count: 1 }]))).toEqual([
      ['solo', 1]
    ])
  })
})

describe('tags: flattenTagTree', () => {
  const tree = buildTagTree(INDEX_TAGS)
  const rows = (expanded: string[], filter = ''): Array<[string, number, boolean]> =>
    flattenTagTree(tree, new Set(expanded), filter).map((row) => [row.node.tag, row.level, row.expanded])

  it('shows children of expanded nodes only', () => {
    expect(rows([])).toEqual([
      ['a', 1, false],
      ['idea', 1, false],
      ['project', 1, false]
    ])
    expect(rows(['project', 'a'])).toEqual([
      ['a', 1, true],
      ['a/b', 2, false],
      ['idea', 1, false],
      ['project', 1, true],
      ['project/alpha', 2, false],
      ['project/beta', 2, false]
    ])
  })

  it('expand all opens every level', () => {
    expect(collectParentKeys(tree)).toEqual(['a', 'a/b', 'idea', 'project'])
    expect(rows(collectParentKeys(tree)).map(([tag]) => tag)).toEqual([
      'a',
      'a/b',
      'a/b/c',
      'idea',
      'idea/product',
      'idea/research',
      'project',
      'project/alpha',
      'project/beta'
    ])
  })

  it('filters by full tag, showing matches expanded with their parents', () => {
    expect(rows([], 'alp')).toEqual([
      ['project', 1, true],
      ['project/alpha', 2, false]
    ])
    expect(rows([], '#IDEA')).toEqual([
      ['idea', 1, true],
      ['idea/product', 2, false],
      ['idea/research', 2, false]
    ])
    expect(rows([], 'nothing')).toEqual([])
  })
})
