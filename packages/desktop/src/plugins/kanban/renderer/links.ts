import { generateGithubSlug } from '@muyajs/core'
import { isNoteTarget, parseWikilink } from 'common/markdownExt'
import type { RendererPluginContext } from '@/plugins/types'

const separatorOf = (path: string): string => (path.includes('\\') && !path.includes('/') ? '\\' : '/')

export const dirnameOf = (path: string): string => {
  const index = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return index <= 0 ? path.slice(0, index + 1) : path.slice(0, index)
}

export const joinPath = (dir: string, relative: string): string => {
  const separator = separatorOf(dir)
  const parts = relative.split(/[/\\]/).filter((part) => part && part !== '.')
  return [dir.replace(/[/\\]+$/, ''), ...parts].join(separator)
}

/**
 * Opens a card's `[[wikilink]]` like Obsidian: the vault index resolves it,
 * then a file next to the board is tried, and a missing note is created next
 * to the board.
 */
export const openWikilink = async(ctx: RendererPluginContext, raw: string, boardPath: string | null): Promise<void> => {
  const link = parseWikilink(raw)
  if (!link || !link.target || !boardPath) return
  const fileName = isNoteTarget(link.target) && !/\.md$/i.test(link.target) ? `${link.target}.md` : link.target
  const candidate = joinPath(dirnameOf(boardPath), fileName)
  const resolved = (await ctx.metadata.resolveLink(link.target, boardPath)) ??
    ((await ctx.vault.exists(candidate)) ? candidate : null)
  if (resolved) {
    await ctx.workspace.openFile(resolved, {
      ...(link.heading ? { anchor: generateGithubSlug(link.heading) } : {}),
      ...(link.subpath ? { subpath: link.subpath } : {})
    })
  } else if (isNoteTarget(link.target)) {
    await ctx.workspace.createAndOpenFile(candidate, '')
  } else {
    throw new Error(`${link.target} was not found`)
  }
}

/** Opens a markdown link of a card: web and mail links in the browser, relative paths from the board's folder. */
export const openHref = async(ctx: RendererPluginContext, href: string, boardPath: string | null): Promise<void> => {
  if (/^(?:https?|mailto):/i.test(href)) {
    // The plugin API has no external-link call; this is the app's validated shell bridge.
    await window.electron.shell.openExternal(href)
    return
  }
  if (!boardPath || href.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(href)) return
  const hash = href.indexOf('#')
  const target = decodeURI(hash === -1 ? href : href.slice(0, hash))
  const fragment = hash === -1 ? '' : href.slice(hash + 1)
  const path = target.startsWith('/') ? target : joinPath(dirnameOf(boardPath), target)
  await ctx.workspace.openFile(path, fragment ? (isNoteTarget(target) ? { anchor: fragment } : { subpath: fragment }) : {})
}
