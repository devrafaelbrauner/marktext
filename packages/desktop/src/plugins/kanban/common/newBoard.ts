import { FRONT_MATTER_KEY, formatLaneHeading, type BoardMarkers } from './board'

/**
 * Markdown of a new board with the given lanes, the last one marked complete.
 * The layout is the one MarkText's editor writes back (blank line between
 * blocks), so switching to the editor and saving keeps the file unchanged.
 */
export const createBoardMarkdown = (lanes: string[], markers: BoardMarkers): string => {
  const lines = ['---', `${FRONT_MATTER_KEY}: board`, '---', '']
  lanes.forEach((title, index) => {
    lines.push(formatLaneHeading(2, title, 0), '')
    if (index === lanes.length - 1) lines.push(`**${markers.complete}**`, '')
  })
  lines.push('%% kanban:settings', '', '```', JSON.stringify({ [FRONT_MATTER_KEY]: 'board' }), '```', '', '%%', '')
  return lines.join('\n')
}

/** `name` as a file name: path separators and characters invalid on Windows removed, `.md` added. */
export const toBoardFileName = (name: string): string => {
  const base = [...name]
    .map((char) => (char.charCodeAt(0) < 32 ? ' ' : char))
    .join('')
    .replace(/\.md$/i, '')
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
  return `${base || 'Kanban'}.md`
}
