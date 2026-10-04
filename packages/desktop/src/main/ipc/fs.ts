import fs from 'fs-extra'
import { type Stats } from 'fs'
import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import {
  isFile as commonIsFile,
  isDirectory as commonIsDirectory,
  isExecutableFile
} from 'common/filesystem'
import { copyFileWithContentHash } from '../filesystem'
import { validateSender } from '../security/validateSender'

interface SerializedStat {
  size: number
  mtimeMs: number
  ctimeMs: number
  isFile: boolean
  isDirectory: boolean
  isSymbolicLink: boolean
}

const serializeStat = (stats: Stats): SerializedStat => ({
  size: stats.size,
  mtimeMs: stats.mtimeMs,
  ctimeMs: stats.ctimeMs,
  isFile: stats.isFile(),
  isDirectory: stats.isDirectory(),
  isSymbolicLink: stats.isSymbolicLink()
})

const toBuffer = (data: unknown): unknown => {
  if (data == null) return data
  if (Buffer.isBuffer(data)) return data
  if (data instanceof Uint8Array) return Buffer.from(data)
  if (typeof data === 'string') return data
  if (
    typeof data === 'object' &&
    data !== null &&
    (data as { type?: string }).type === 'Buffer' &&
    Array.isArray((data as { data?: unknown }).data)
  ) {
    return Buffer.from((data as { data: number[] }).data)
  }
  return data
}

// Wraps a handler that writes to disk so only the app's own renderer page can
// reach it, never an embedded frame or a foreign page.
const guarded = <A extends unknown[], R>(fn: (...args: A) => R) =>
  (e: IpcMainInvokeEvent, ...args: A): R => {
    if (!validateSender(e)) throw new Error('IPC sender rejected')
    return fn(...args)
  }

export const registerFsHandlers = (): void => {
  ipcMain.handle('mt::fs::is-file', (_e, p: string) => commonIsFile(p))
  ipcMain.handle('mt::fs::is-directory', (_e, p: string) => commonIsDirectory(p))
  ipcMain.handle('mt::fs::copy', guarded((src: string, dest: string) => fs.copy(src, dest)))
  ipcMain.handle('mt::fs::copy-with-content-hash', guarded((src: string, outputDir: string) =>
    copyFileWithContentHash(src, outputDir)
  ))
  ipcMain.handle('mt::fs::ensure-dir', guarded((p: string) => fs.ensureDir(p)))

  ipcMain.handle('mt::fs::output-file', guarded((p: string, data: unknown) =>
    fs.outputFile(p, toBuffer(data) as string | NodeJS.ArrayBufferView)
  ))
  ipcMain.handle('mt::fs::move', guarded((src: string, dest: string) =>
    fs.move(src, dest, { overwrite: false })
  ))
  ipcMain.handle('mt::fs::stat', async(_e, p: string) => serializeStat(await fs.stat(p)))

  ipcMain.handle('mt::fs::write-file', guarded((p: string, data: unknown) =>
    fs.writeFile(p, toBuffer(data) as string | NodeJS.ArrayBufferView)
  ))
  ipcMain.handle('mt::fs::read-file', async(_e, p: string, encoding?: BufferEncoding) => {
    const buf = await fs.readFile(p, encoding)
    return buf
  })
  ipcMain.handle('mt::fs::path-exists', (_e, p: string) => fs.pathExists(p))
  ipcMain.handle('mt::fs::readdir', (_e, p: string) => fs.readdir(p))
  // The same predicate the main process spawns by, or the preferences panel
  // green-ticks a cliScript that then fails with EACCES.
  ipcMain.handle('mt::fs::is-executable', (_e, p: string) => isExecutableFile(p))
}
