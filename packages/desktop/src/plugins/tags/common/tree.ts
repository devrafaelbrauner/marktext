import type { TagCount } from '@shared/plugins/types'

export interface TagTreeNode {
  /** Last path segment, e.g. `c` for `a/b/c`. */
  name: string
  /** Full tag without `#`, in the spelling of the index (first occurrence). */
  tag: string
  /** Notes carrying this tag or any tag nested below it. */
  count: number
  children: TagTreeNode[]
}

interface BuildNode {
  name: string
  tag: string
  count: number
  /** False for a parent only implied by a nested tag. */
  listed: boolean
  children: BuildNode[]
}

const lastSegment = (path: string): string => path.slice(path.lastIndexOf('/') + 1)

const byName = (a: { name: string }, b: { name: string }): number =>
  a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || a.name.localeCompare(b.name)

/**
 * Nests the index's tag counts by `/` (`a/b/c` under `a/b` under `a`),
 * merging spellings case-insensitively. The index already counts a note once
 * for each parent of its tags, so a parent's count is the number of notes
 * having it or any child; a parent missing from the list gets the largest
 * child count, the least number of notes it can have. Siblings are sorted by
 * name.
 */
export const buildTagTree = (tags: readonly TagCount[]): TagTreeNode[] => {
  const nodes = new Map<string, BuildNode>()
  const roots: BuildNode[] = []

  const ensure = (path: string): BuildNode => {
    const key = path.toLowerCase()
    let node = nodes.get(key)
    if (!node) {
      node = { name: lastSegment(path), tag: path, count: 0, listed: false, children: [] }
      nodes.set(key, node)
      const slash = path.lastIndexOf('/')
      if (slash === -1) roots.push(node)
      else ensure(path.slice(0, slash)).children.push(node)
    }
    return node
  }

  for (const entry of tags) {
    const path = entry.tag.replace(/^#/, '').replace(/\/+$/, '')
    if (!path || path.split('/').includes('')) continue
    const node = ensure(path)
    if (!node.listed) {
      // The listed spelling wins over the one a nested tag implied.
      node.listed = true
      node.tag = path
      node.name = lastSegment(path)
      node.count = entry.count
    } else {
      node.count = Math.max(node.count, entry.count)
    }
  }

  const finish = (list: BuildNode[]): TagTreeNode[] =>
    list
      .map((node) => {
        const children = finish(node.children)
        const count = node.listed ? node.count : Math.max(0, ...children.map((child) => child.count))
        return { name: node.name, tag: node.tag, count, children }
      })
      .sort(byName)

  return finish(roots)
}

export interface TagTreeRow {
  node: TagTreeNode
  /** 1-based depth, for `aria-level`. */
  level: number
  expanded: boolean
}

/** Full tags (lower-cased) of every node that has children, for "expand all". */
export const collectParentKeys = (nodes: readonly TagTreeNode[]): string[] => {
  const result: string[] = []
  const walk = (list: readonly TagTreeNode[]): void => {
    for (const node of list) {
      if (node.children.length > 0) {
        result.push(node.tag.toLowerCase())
        walk(node.children)
      }
    }
  }
  walk(nodes)
  return result
}

/**
 * Rows the panel shows, in tree order. Without a filter, children appear
 * under expanded nodes only (`expanded` holds lower-cased full tags). With a
 * filter (case-insensitive substring of the full tag, leading `#` ignored),
 * every node whose subtree contains a match is shown expanded, so matches
 * always appear with their parents.
 */
export const flattenTagTree = (
  nodes: readonly TagTreeNode[],
  expanded: ReadonlySet<string>,
  filter: string
): TagTreeRow[] => {
  const needle = filter.trim().replace(/^#/, '').toLowerCase()
  const rows: TagTreeRow[] = []
  const containsMatch = (node: TagTreeNode): boolean =>
    node.tag.toLowerCase().includes(needle) || node.children.some(containsMatch)

  const walk = (list: readonly TagTreeNode[], level: number): void => {
    for (const node of list) {
      if (needle && !containsMatch(node)) continue
      const open = node.children.length > 0 && (needle ? true : expanded.has(node.tag.toLowerCase()))
      rows.push({ node, level, expanded: open })
      if (open) walk(node.children, level + 1)
    }
  }
  walk(nodes, 1)
  return rows
}
