/**
 * Page requested by the subpath of a PDF link (`doc.pdf#page=3`), as Obsidian
 * writes it. Parameters are `&`-separated like a URL fragment
 * (`page=3&zoom=50`); only `page` matters here. Returns the 1-based page, or
 * null when the subpath names no valid page.
 */
export const parsePageSubpath = (subpath: string | null | undefined): number | null => {
  if (!subpath) return null
  for (const part of subpath.replace(/^#/, '').split('&')) {
    const separator = part.indexOf('=')
    if (separator === -1) continue
    if (part.slice(0, separator).trim().toLowerCase() !== 'page') continue
    const value = part.slice(separator + 1).trim()
    if (!/^\d{1,9}$/.test(value)) return null
    const page = Number(value)
    return page >= 1 ? page : null
  }
  return null
}

/** Clamps a requested 1-based page into `[1, pageCount]`. */
export const clampPage = (page: number, pageCount: number): number => {
  if (pageCount < 1) return 1
  if (!Number.isFinite(page)) return 1
  return Math.min(pageCount, Math.max(1, Math.round(page)))
}
