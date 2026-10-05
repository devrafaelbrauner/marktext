// `mt-file://local` plus the absolute path is the only form the handler serves.
// The host is a fixed token, never a machine name: a markdown image written as
// `//attacker/share/x.png` must not become a URL the browser fetches over the
// network (NTLM / SMB). Anything else is rejected before a file is opened.

export const MT_FILE_HOST = 'local'

const UNC_OR_HOST_REG = /^(?:\\\\|\/\/)/

export function isUncOrRemoteHostPath(filePath: string): boolean {
  if (!filePath) return false
  return UNC_OR_HOST_REG.test(filePath) || UNC_OR_HOST_REG.test(filePath.replace(/\\/g, '/'))
}

export function isAbsoluteLocalPath(filePath: string): boolean {
  if (!filePath || isUncOrRemoteHostPath(filePath)) return false
  if (filePath.startsWith('/')) return true
  return /^[a-zA-Z]:[\\/]/.test(filePath)
}

/** A URL the handler rejects. Used so a UNC path never falls through to `http:` or `file://host`. */
export const MT_FILE_REJECT_URL = 'mt-file://reject/unc'

// Builds the URL of an absolute local path for builds without the `mt-file:`
// protocol. The Android WebView serves files from `https://vault.local/...`,
// and the browser dev build from blob URLs; desktop never sets it.
let localFileUrlBuilder: ((absolutePath: string) => string) | null = null

/**
 * Replaces the `mt-file://local` form `toMtFileUrl` emits. The builder only
 * sees absolute, forward-slashed, non-UNC paths; rejected paths still map to
 * `MT_FILE_REJECT_URL`.
 */
export function setLocalFileUrlBuilder(builder: ((absolutePath: string) => string) | null): void {
  localFileUrlBuilder = builder
}

export function toMtFileUrl(absolutePath: string): string {
  if (!absolutePath || isUncOrRemoteHostPath(absolutePath)) return MT_FILE_REJECT_URL
  const normalized = absolutePath.replace(/\\/g, '/')
  if (!isAbsoluteLocalPath(normalized)) return MT_FILE_REJECT_URL
  if (localFileUrlBuilder) return localFileUrlBuilder(normalized)
  const encoded = normalized.split('/').map((part) => encodeURIComponent(part)).join('/')
  return encoded.startsWith('/')
    ? `mt-file://${MT_FILE_HOST}${encoded}`
    : `mt-file://${MT_FILE_HOST}/${encoded}`
}

export type ParsedMtFile =
  | { ok: true; filePath: string }
  | { ok: false; status: number; reason: string }

const fail = (status: number, reason: string): ParsedMtFile => ({ ok: false, status, reason })

/**
 * Parse an `mt-file:` request URL into a local absolute path, or a rejection.
 * Does not touch the filesystem or the network.
 */
export function parseMtFileUrl(rawUrl: string): ParsedMtFile {
  if (typeof rawUrl !== 'string' || !rawUrl) return fail(400, 'malformed')
  // A raw `..` or encoded dot-segment in the URL path is traversal even if the
  // URL parser would collapse it into a different path before we see it.
  if (/(?:^|\/)\.\.(?:\/|$)|%2e%2e|%2E%2E/i.test(rawUrl.split(/[?#]/, 1)[0])) {
    return fail(400, 'traversal')
  }

  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return fail(400, 'malformed')
  }
  if (url.protocol !== 'mt-file:') return fail(400, 'scheme')
  if (url.username || url.password || url.hostname !== MT_FILE_HOST) {
    return fail(403, 'remote-host')
  }

  let filePath: string
  try {
    filePath = decodeURIComponent(url.pathname)
  } catch {
    return fail(400, 'encoding')
  }
  if (/^\/[a-zA-Z]:\//.test(filePath)) filePath = filePath.slice(1)
  if (filePath.includes('\0') || filePath.includes('\\')) return fail(400, 'null')
  if (isUncOrRemoteHostPath(filePath)) return fail(403, 'unc')
  if (filePath.split('/').some((part) => part === '..' || part === '.')) {
    return fail(400, 'traversal')
  }
  if (!isAbsoluteLocalPath(filePath)) return fail(400, 'not-absolute')
  return { ok: true, filePath }
}

/** Inverse of a `file://` URL the exporter still writes. A remote host comes back as `//host/...`. */
export function fileUrlToLocalPath(fileUrl: string): string | null {
  let url: URL
  try {
    url = new URL(fileUrl)
  } catch {
    return null
  }
  if (url.protocol !== 'file:') return null
  if (url.hostname && url.hostname !== 'localhost') {
    return `//${url.hostname}${decodeURIComponent(url.pathname)}`
  }
  let pathname = decodeURIComponent(url.pathname)
  if (/^\/[a-zA-Z]:\//.test(pathname)) pathname = pathname.slice(1)
  return pathname
}

/** Rewrite a print-container image URL so Chromium can load it with webSecurity on. */
export function toInAppImageSrc(src: string): string {
  if (!src || /^mt-file:/i.test(src)) return src
  if (!/^file:/i.test(src)) return src
  const absolute = fileUrlToLocalPath(src)
  return absolute ? toMtFileUrl(absolute) : MT_FILE_REJECT_URL
}
