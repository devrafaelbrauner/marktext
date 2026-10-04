import { describe, expect, it, vi } from 'vitest'
import { resolveDiagramLink } from '@plugins/mermaid-plus/common/links'

const VAULT: Record<string, string> = {
  'My Note': '/vault/My Note.md',
  'Projects/Plan': '/vault/Projects/Plan.md',
  'doc.pdf': '/vault/files/doc.pdf'
}

const resolver = () => vi.fn(async(target: string) => VAULT[target] ?? null)

describe('mermaid-plus internal-link resolution', () => {
  it('resolves a node label as a wikilink target relative to the source note', async() => {
    const resolve = resolver()
    await expect(resolveDiagramLink(' My Note ', '/vault/Diagrams/Flow.md', resolve)).resolves.toEqual({ pathname: '/vault/My Note.md' })
    expect(resolve).toHaveBeenCalledWith('My Note', '/vault/Diagrams/Flow.md')
  })

  it('drops heading and alias parts, keeps the subpath of a non-note target', async() => {
    const resolve = resolver()
    await expect(resolveDiagramLink('Projects/Plan#Goals|the plan', '/vault/a.md', resolve)).resolves.toEqual({ pathname: '/vault/Projects/Plan.md' })
    expect(resolve).toHaveBeenCalledWith('Projects/Plan', '/vault/a.md')
    await expect(resolveDiagramLink('doc.pdf#page=3', '/vault/a.md', resolve)).resolves.toEqual({ pathname: '/vault/files/doc.pdf', subpath: 'page=3' })
  })

  it('returns null for unresolved and empty targets without guessing', async() => {
    const resolve = resolver()
    await expect(resolveDiagramLink('Missing', '/vault/a.md', resolve)).resolves.toBeNull()
    await expect(resolveDiagramLink('#Heading', '/vault/a.md', resolve)).resolves.toBeNull()
    await expect(resolveDiagramLink('   ', '/vault/a.md', resolve)).resolves.toBeNull()
    expect(resolve).toHaveBeenCalledTimes(1)
  })
})
