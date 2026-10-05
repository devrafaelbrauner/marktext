// `window.fileUtils` channels (desktop main/ipc/fs.ts, ipc/paths.ts and the
// trash handler of app/index.ts) over the FileBackend, scoped like desktop
// (src/main/scope.ts). Results keep the desktop shapes: predicates answer
// `false` outside the scope, everything else rejects.
//
// Android differences:
// - `mt::fs::is-executable` is always false (apps cannot run files);
// - `mt::fs-trash-item` deletes permanently after a confirmation (no trash);
// - `mt::fs::grant-user-path` has no effect: Android grants come only from
//   the SAF pickers, and files dropped or pasted from other apps have no path.

import { posix } from 'pathe'
import { IMAGE_EXTENSIONS } from 'common/filesystem/extensions'
import { MobileFsError, type FileBackend } from './fs/backend'
import type { CoreContext } from './context'
import { confirmAndDelete, type EditorWindow } from './editorWindow'
import { ipcMain } from './ipc'
import { IMAGE_CONTENT_TYPES } from './misc'
import { normalizeVirtualPath } from './scope'
import { getRootPath } from './state'

/** Rejects paths outside the scope with PERMISSION_DENIED; returns the normalized path. */
function scoped(ctx: CoreContext, candidate: unknown): string {
  const path = normalizeVirtualPath(candidate)
  if (!path || !ctx.scope.isAllowed(path)) {
    throw new MobileFsError('PERMISSION_DENIED', String(candidate), `Access to "${String(candidate)}" is not allowed.`)
  }
  return path
}

/** fs-extra copy: files and whole folders; existing files are overwritten. */
async function copyRecursive(backend: FileBackend, src: string, dest: string): Promise<void> {
  const stat = await backend.stat(src)
  if (!stat) throw new MobileFsError('ENOENT', src)
  if (!stat.isDirectory) {
    await backend.copy(src, dest)
    return
  }
  await backend.mkdirp(dest)
  for (const entry of await backend.readdir(src)) {
    await copyRecursive(backend, `${src}/${entry.name}`, `${dest}/${entry.name}`)
  }
}

async function sha1Hex(bytes: Uint8Array): Promise<string> {
  // Copied into a fresh ArrayBuffer: digest() refuses shared buffers.
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', new Uint8Array(bytes)))
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** Buffer encodings `fs.readFile(path, encoding)` callers use. */
function decodeAs(bytes: Uint8Array, encoding: string, path: string): string {
  const lower = encoding.toLowerCase()
  if (lower === 'utf8' || lower === 'utf-8') return new TextDecoder().decode(bytes)
  if (lower !== 'latin1' && lower !== 'binary' && lower !== 'base64') {
    throw new MobileFsError('UNSUPPORTED_ON_ANDROID', path, `Encoding "${encoding}" is not supported on Android.`)
  }
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return lower === 'base64' ? btoa(binary) : binary
}

export function registerFsHandlers(ctx: CoreContext, editor: EditorWindow): void {
  const { backend } = ctx
  const language = (): string => {
    const value = ctx.preferences.getItem('language')
    return typeof value === 'string' && value ? value : 'en'
  }

  ipcMain.handle('mt::fs::is-file', async(_event, path) => {
    if (!ctx.scope.isAllowed(path)) return false
    return (await backend.stat(path).catch(() => null))?.isFile === true
  })
  ipcMain.handle('mt::fs::is-directory', async(_event, path) => {
    if (!ctx.scope.isAllowed(path)) return false
    return (await backend.stat(path).catch(() => null))?.isDirectory === true
  })
  ipcMain.handle('mt::fs::path-exists', async(_event, path) => {
    if (!ctx.scope.isAllowed(path)) return false
    return (await backend.stat(path).catch(() => null)) !== null
  })
  ipcMain.handle('mt::fs::is-executable', () => false)
  ipcMain.handle('mt::fs::stat', async(_event, path) => {
    const target = scoped(ctx, path)
    const stat = await backend.stat(target)
    if (!stat) throw new MobileFsError('ENOENT', target)
    // SAF exposes no change time or links; ctime mirrors mtime.
    return {
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      ctimeMs: stat.mtimeMs,
      isFile: stat.isFile,
      isDirectory: stat.isDirectory,
      isSymbolicLink: false
    }
  })
  ipcMain.handle('mt::fs::readdir', async(_event, path) => {
    const entries = await backend.readdir(scoped(ctx, path))
    return entries.map((entry) => entry.name)
  })
  ipcMain.handle('mt::fs::read-file', async(_event, path, encoding) => {
    const target = scoped(ctx, path)
    const bytes = await backend.readFile(target)
    return encoding ? decodeAs(bytes, encoding, target) : bytes
  })
  ipcMain.handle('mt::fs::write-file', async(_event, path, data) => {
    const target = scoped(ctx, path)
    await backend.writeFile(target, data)
    editor.reportMutation([target], true)
  })
  ipcMain.handle('mt::fs::output-file', async(_event, path, data) => {
    const target = scoped(ctx, path)
    await backend.writeFile(target, data)
    editor.reportMutation([target], true)
  })
  ipcMain.handle('mt::fs::ensure-dir', async(_event, path) => {
    const target = scoped(ctx, path)
    await backend.mkdirp(target)
    editor.reportMutation([target])
  })
  ipcMain.handle('mt::fs::copy', async(_event, src, dest) => {
    const from = scoped(ctx, src)
    const to = scoped(ctx, dest)
    await copyRecursive(backend, from, to)
    editor.reportMutation([to])
  })
  ipcMain.handle('mt::fs::move', async(_event, src, dest) => {
    const from = scoped(ctx, src)
    const to = scoped(ctx, dest)
    // fs-extra move with overwrite:false; the backend rejects EEXIST.
    await backend.rename(from, to)
    editor.reportMutation([from, to])
  })
  ipcMain.handle('mt::fs::copy-with-content-hash', async(_event, src, outputDir) => {
    const from = scoped(ctx, src)
    const dir = scoped(ctx, outputDir)
    const bytes = await backend.readFile(from)
    const dest = `${dir}/${await sha1Hex(bytes)}${posix.extname(from)}`
    if (!(await backend.stat(dest))) {
      await backend.writeFile(dest, bytes)
      editor.reportMutation([dest])
    }
    return dest
  })
  ipcMain.handle('mt::fs-trash-item', async(_event, pathname) => {
    const target = scoped(ctx, pathname)
    const deleted = await confirmAndDelete(ctx, language(), target)
    if (deleted) editor.reportMutation([target])
    return deleted
  })
  ipcMain.on('mt::fs::grant-user-path', () => {})

  ipcMain.handle('mt::paths::is-image', async(_event, path) => {
    if (!IMAGE_EXTENSIONS.includes(posix.extname(String(path)).slice(1).toLowerCase())) return false
    if (!ctx.scope.isAllowed(path)) return false
    return (await backend.stat(path).catch(() => null))?.isFile === true
  })
  // Virtual paths are case-sensitive: equal only when identical.
  ipcMain.handleSync('mt::paths::is-same-sync', (_event, a, b) => !!a && a === b)

  // Electron's save dialog becomes the SAF create picker; the caller then
  // writes through `mt::fs::write-file`, so the picked document is granted.
  ipcMain.handle('mt::dialog::show-save', async(_event, request) => {
    const suggested = posix.basename(request?.defaultPath ?? '') || 'Untitled'
    const extension = posix.extname(suggested).slice(1).toLowerCase()
    const mimeType = IMAGE_CONTENT_TYPES[extension] ?? 'application/octet-stream'
    const directory = request?.defaultPath ? normalizeVirtualPath(posix.dirname(request.defaultPath)) : null
    const picked = await backend.pickSaveFile(suggested, mimeType, directory ?? getRootPath() ?? undefined)
    if (!picked) return null
    ctx.scope.grantFile(picked.path)
    return picked.path
  })
}
