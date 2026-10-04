/**
 * Obsidian comments (`%% … %%`) inside a paragraph, for the editor's inline
 * syntax. A paragraph that is just `%%` or starts with `%% ` without a closing
 * `%%` (the lines of a multi-line comment such as the Kanban settings block,
 * which the editor splits into separate blocks) is a comment as a whole.
 */
export const matchObsidianComment = (src: string, prevChar: string): number | null => {
  if (!src.startsWith('%%')) return null
  const close = src.indexOf('%%', 2)
  if (close !== -1) return close + 2
  if (prevChar === '' && (src === '%%' || src.startsWith('%% '))) return src.length
  return null
}
