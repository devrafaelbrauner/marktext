// FileBackend over the native MtFs plugin (android/app/src/main/java/app/
// marktextplus/android/MtFsPlugin.java), which maps the virtual paths of
// backend.ts onto Context.getFilesDir() and Storage Access Framework grants.
// Text crosses the bridge as UTF-8 strings, bytes as base64.

import { registerPlugin } from '@capacitor/core'
import { MobileFsError, type DirEntry, type FileBackend, type FileStat, type MobileFsErrorCode, type PickedEntry } from './backend'

interface NativeStat {
  exists: boolean
  isFile?: boolean
  isDirectory?: boolean
  size?: number
  mtimeMs?: number
  birthtimeMs?: number
}

type NativePick = { path: string; name: string } | { cancelled: true }

interface MtFsPlugin {
  stat(options: { path: string }): Promise<NativeStat>
  readdir(options: { path: string }): Promise<{ entries: Array<DirEntry & { size: number; mtimeMs: number }> }>
  readFile(options: { path: string; encoding: 'utf8' | 'base64' }): Promise<{ data: string }>
  writeFile(options: { path: string; data: string; encoding: 'utf8' | 'base64' }): Promise<void>
  mkdirp(options: { path: string }): Promise<void>
  rename(options: { from: string; to: string }): Promise<void>
  copy(options: { from: string; to: string }): Promise<void>
  remove(options: { path: string }): Promise<void>
  pickDirectory(): Promise<NativePick>
  pickOpenFile(options: { mimeTypes: string[] }): Promise<NativePick>
  pickSaveFile(options: { suggestedName: string; mimeType: string; initialPath?: string }): Promise<NativePick>
  openExternal(options: { url: string }): Promise<void>
}

export const MtFs = registerPlugin<MtFsPlugin>('MtFs')

const ERROR_CODES: Record<string, MobileFsErrorCode> = {
  ENOENT: 'ENOENT',
  EEXIST: 'EEXIST',
  ENOTDIR: 'ENOTDIR',
  EISDIR: 'EISDIR',
  ENOTEMPTY: 'ENOTEMPTY',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  UNSUPPORTED_ON_ANDROID: 'UNSUPPORTED_ON_ANDROID',
  EIO: 'EIO'
}

/** Runs a native call, turning its rejection (`{code, message}`) into MobileFsError. */
async function call<T>(path: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    const raw = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
    const message = error instanceof Error ? error.message : String(error)
    throw new MobileFsError(ERROR_CODES[raw] ?? 'EIO', path, message)
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  // Chunked: String.fromCharCode spreads its arguments onto the stack.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

function fromBase64(data: string): Uint8Array {
  const binary = atob(data)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

const toPicked = (result: NativePick): PickedEntry | null => ('cancelled' in result ? null : result)

export class NativeFileBackend implements FileBackend {
  async stat(path: string): Promise<FileStat | null> {
    const result = await call(path, () => MtFs.stat({ path }))
    if (!result.exists) return null
    return {
      isFile: !!result.isFile,
      isDirectory: !!result.isDirectory,
      size: result.size ?? 0,
      mtimeMs: result.mtimeMs ?? 0,
      birthtimeMs: result.birthtimeMs ?? result.mtimeMs ?? 0
    }
  }

  async readdir(path: string): Promise<DirEntry[]> {
    const { entries } = await call(path, () => MtFs.readdir({ path }))
    // SAF has no creation time; the native side reports mtime for both.
    return entries.map(({ name, isFile, isDirectory, size, mtimeMs }) => ({
      name,
      isFile,
      isDirectory,
      size,
      mtimeMs,
      birthtimeMs: mtimeMs
    }))
  }

  async readFile(path: string): Promise<Uint8Array> {
    const { data } = await call(path, () => MtFs.readFile({ path, encoding: 'base64' }))
    return fromBase64(data)
  }

  async readText(path: string): Promise<string> {
    const { data } = await call(path, () => MtFs.readFile({ path, encoding: 'utf8' }))
    return data
  }

  async writeFile(path: string, data: Uint8Array | string): Promise<void> {
    await call(path, () =>
      typeof data === 'string'
        ? MtFs.writeFile({ path, data, encoding: 'utf8' })
        : MtFs.writeFile({ path, data: toBase64(data), encoding: 'base64' })
    )
  }

  async mkdirp(path: string): Promise<void> {
    await call(path, () => MtFs.mkdirp({ path }))
  }

  async rename(from: string, to: string): Promise<void> {
    await call(from, () => MtFs.rename({ from, to }))
  }

  async copy(from: string, to: string): Promise<void> {
    await call(from, () => MtFs.copy({ from, to }))
  }

  async remove(path: string): Promise<void> {
    await call(path, () => MtFs.remove({ path }))
  }

  async pickDirectory(): Promise<PickedEntry | null> {
    return toPicked(await call('', () => MtFs.pickDirectory()))
  }

  async pickOpenFile(mimeTypes: string[]): Promise<PickedEntry | null> {
    return toPicked(await call('', () => MtFs.pickOpenFile({ mimeTypes })))
  }

  async pickSaveFile(suggestedName: string, mimeType: string, initialPath?: string): Promise<PickedEntry | null> {
    return toPicked(await call('', () => MtFs.pickSaveFile({ suggestedName, mimeType, initialPath })))
  }
}
