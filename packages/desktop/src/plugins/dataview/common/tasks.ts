// Same task shape as the vault index parser (common/markdownExt/parseNote.ts):
// optional quote markers and indentation, a bullet or ordered marker, then `[c]`.
const TASK_LINE = /^((?:[ \t]*>)*[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+\[)([^\]\n])(\](?:[ \t]+(.*))?)$/

const taskTextAt = (line: string): string | null => {
  const match = TASK_LINE.exec(line)
  return match ? (match[4] ?? '').trim() : null
}

/**
 * Sets the checkbox of the task reported at `line` (0-based) with text
 * `text` to `[x]` or `[ ]`, returning the new document, or null when the
 * task cannot be found any more. When the document changed since it was
 * indexed (unsaved edits shift lines) the task is looked up by its text, and
 * only an unambiguous match is toggled. Line endings are preserved.
 */
export const toggleTaskInContent = (content: string, line: number, text: string, checked: boolean): string | null => {
  const lines = content.split('\n')
  const wanted = text.trim()
  const matches = (index: number): boolean => taskTextAt(lines[index].replace(/\r$/, '')) === wanted

  let target = line >= 0 && line < lines.length && matches(line) ? line : -1
  if (target === -1) {
    const candidates = lines.flatMap((_, index) => (matches(index) ? [index] : []))
    if (candidates.length !== 1) return null
    target = candidates[0]
  }
  const eol = lines[target].endsWith('\r') ? '\r' : ''
  const body = eol ? lines[target].slice(0, -1) : lines[target]
  lines[target] = body.replace(TASK_LINE, (_match, open: string, _status: string, close: string) => `${open}${checked ? 'x' : ' '}${close}`) + eol
  return lines.join('\n')
}
