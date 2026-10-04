import fs from 'fs'
import path from 'path'
import { isUncOrRemoteHostPath } from 'common/mtFileUrl'

// Subfolders the app itself creates or reads under userData. The userData root
// is not a root: it holds secrets.json, preferences and cookies.
export const APP_USER_DATA_SUBDIRS = [
  'logs',
  'screenshot',
  'images',
  'editorStates',
  'vault-index',
  'themes'
] as const

const COPY_IMAGE_EXTENSIONS: Record<string, true> = {
  jpeg: true,
  jpg: true,
  png: true,
  gif: true,
  svg: true,
  webp: true,
  bmp: true,
  ico: true,
  avif: true,
  apng: true
}

export function userDataSubdirectories(userDataPath: string): string[] {
  if (!userDataPath) return []
  return APP_USER_DATA_SUBDIRS.map((name) => path.join(userDataPath, name))
}

/**
 * imageFolderPath may contain a ${filename} token, expanded per tab in the renderer.
 * The stable prefix is the directory the expanded path stays under.
 */
export function imageFolderRoots(raw: string | null | undefined): string[] {
  if (!raw || typeof raw !== 'string') return []
  const marker = '${' + 'filename}'
  const index = raw.indexOf(marker)
  if (index === -1) return [raw]
  const prefix = raw.slice(0, index).replace(/[\\/]+$/, '')
  return prefix ? [prefix] : []
}

export function pathsEqual(a: string, b: string): boolean {
  const left = path.normalize(a)
  const right = path.normalize(b)
  if (process.platform === 'linux') return left === right
  return left.toLowerCase() === right.toLowerCase()
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

/**
 * Lexical path after following symlinks. A missing tail (a file about to be
 * created) is appended to the realpath of the nearest existing ancestor, so a
 * link in that ancestor cannot point the tail outside the root.
 */
export function resolveContained(candidate: string): string | null {
  if (!candidate || isUncOrRemoteHostPath(candidate) || candidate.includes('\0')) return null
  const absolute = path.resolve(candidate)
  if (isUncOrRemoteHostPath(absolute)) return null

  const missing: string[] = []
  let current = absolute
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current)
    if (parent === current) return null
    missing.unshift(path.basename(current))
    current = parent
  }
  let real: string
  try {
    real = fs.realpathSync(current)
  } catch {
    return null
  }
  if (isUncOrRemoteHostPath(real)) return null
  return missing.length ? path.join(real, ...missing) : real
}

function sameGrantedFile(absolute: string, granted: string): boolean {
  if (!granted || isUncOrRemoteHostPath(granted)) return false
  const grantedAbsolute = path.resolve(granted)
  try {
    if (fs.existsSync(absolute) && fs.existsSync(grantedAbsolute)) {
      return fs.realpathSync(absolute) === fs.realpathSync(grantedAbsolute)
    }
  } catch {
    // Fall through to a lexical compare when one side does not exist yet
    // (a save-dialog path the user just picked).
  }
  return pathsEqual(absolute, grantedAbsolute)
}

/**
 * Whether `candidate` is an allowed file, or inside one of `directories`,
 * after symlink resolution. UNC and remote-host paths are never allowed.
 */
export function isPathInScope(
  candidate: string,
  directories: readonly string[],
  files: readonly string[]
): boolean {
  if (typeof candidate !== 'string' || !candidate) return false
  if (isUncOrRemoteHostPath(candidate) || candidate.includes('\0')) return false
  const absolute = path.resolve(candidate)
  if (isUncOrRemoteHostPath(absolute)) return false

  for (const file of files) {
    if (sameGrantedFile(absolute, file)) return true
  }

  const resolved = resolveContained(absolute)
  if (!resolved) return false
  for (const dir of directories) {
    if (!dir || isUncOrRemoteHostPath(dir)) continue
    const root = resolveContained(path.resolve(dir))
    if (root && isInside(root, resolved)) return true
  }
  return false
}

/**
 * A file the user asked to copy into an allowed folder. The real target must
 * itself be an image, so a `.png` symlink to a secret is not a read of that secret.
 */
export function isRealImageFile(filePath: string): boolean {
  if (typeof filePath !== 'string' || !filePath || isUncOrRemoteHostPath(filePath)) return false
  try {
    const real = fs.realpathSync(filePath)
    if (isUncOrRemoteHostPath(real)) return false
    const ext = path.extname(real).slice(1).toLowerCase()
    if (!COPY_IMAGE_EXTENSIONS[ext]) return false
    return fs.statSync(real).isFile()
  } catch {
    return false
  }
}
