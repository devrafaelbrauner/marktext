import fs from 'fs-extra'
import { type Stats } from 'fs'
import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import {
  isFile as commonIsFile,
  isDirectory as commonIsDirectory,
  isExecutableFile
} from 'common/filesystem'
import { copyFileWithContentHash } from '../filesystem'
import { validateSender } from '../security/validateSender'
import {
  assertImageCopyAllowed,
  assertPathsAllowed,
  executableCheckAllowed,
  pathIsAllowed
} from '../security/fsAccess'
import { grantFile } from '../security/pathGrants'

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

const isSerializedBuffer = (data: object): data is { type: 'Buffer'; data: number[] } =>
  'type' in data &&
  data.type === 'Buffer' &&
  'data' in data &&
  Array.isArray(data.data)

const toBuffer = (data: unknown): unknown => {
  if (data == null) return data
  if (Buffer.isBuffer(data)) return data
  if (data instanceof Uint8Array) return Buffer.from(data)
  if (typeof data === 'string') return data
  if (data && typeof data === 'object' && isSerializedBuffer(data)) {
    return Buffer.from(data.data)
  }
  return data
}

const rejected = (): never => {
  throw new Error('IPC sender rejected')
}

const requireSender = (event: IpcMainInvokeEvent): void => {
  if (!validateSender(event)) rejected()
}

export const registerFsHandlers = (): void => {
  ipcMain.handle('mt::fs::is-file', async(e, p: string) => {
    if (!validateSender(e) || !(await pathIsAllowed(e, p))) return false
    return commonIsFile(p)
  })
  ipcMain.handle('mt::fs::is-directory', async(e, p: string) => {
    if (!validateSender(e) || !(await pathIsAllowed(e, p))) return false
    return commonIsDirectory(p)
  })
  ipcMain.handle('mt::fs::copy', async(e, src: string, dest: string) => {
    requireSender(e)
    await assertPathsAllowed(e, [src, dest])
    return fs.copy(src, dest)
  })
  ipcMain.handle('mt::fs::copy-with-content-hash', async(e, src: string, outputDir: string) => {
    requireSender(e)
    await assertImageCopyAllowed(e, src, outputDir)
    return copyFileWithContentHash(src, outputDir)
  })
  ipcMain.handle('mt::fs::ensure-dir', async(e, p: string) => {
    requireSender(e)
    await assertPathsAllowed(e, [p])
    return fs.ensureDir(p)
  })
  ipcMain.handle('mt::fs::output-file', async(e, p: string, data: unknown) => {
    requireSender(e)
    await assertPathsAllowed(e, [p])
    return fs.outputFile(p, toBuffer(data) as string | NodeJS.ArrayBufferView)
  })
  ipcMain.handle('mt::fs::move', async(e, src: string, dest: string) => {
    requireSender(e)
    await assertPathsAllowed(e, [src, dest])
    return fs.move(src, dest, { overwrite: false })
  })
  ipcMain.handle('mt::fs::stat', async(e, p: string) => {
    requireSender(e)
    await assertPathsAllowed(e, [p])
    return serializeStat(await fs.stat(p))
  })
  ipcMain.handle('mt::fs::write-file', async(e, p: string, data: unknown) => {
    requireSender(e)
    await assertPathsAllowed(e, [p])
    return fs.writeFile(p, toBuffer(data) as string | NodeJS.ArrayBufferView)
  })
  ipcMain.handle('mt::fs::read-file', async(e, p: string, encoding?: BufferEncoding) => {
    requireSender(e)
    await assertPathsAllowed(e, [p])
    return fs.readFile(p, encoding)
  })
  ipcMain.handle('mt::fs::path-exists', async(e, p: string) => {
    if (!validateSender(e) || !(await pathIsAllowed(e, p))) return false
    return fs.pathExists(p)
  })
  ipcMain.handle('mt::fs::readdir', async(e, p: string) => {
    requireSender(e)
    await assertPathsAllowed(e, [p])
    return fs.readdir(p)
  })
  // The preferences panel green-ticks a cliScript the user is still typing.
  // That window may check any path; the editor window may not.
  ipcMain.handle('mt::fs::is-executable', async(e, p: string) => {
    if (!validateSender(e) || !(await executableCheckAllowed(e, p))) return false
    return isExecutableFile(p)
  })

  // Paths of File objects the OS handed this window (drag-drop, file input).
  // A synthetic File yields an empty path from webUtils, so the renderer cannot
  // grant an arbitrary string through this channel.
  ipcMain.on('mt::fs::grant-user-path', (e, filePath: string) => {
    if (!validateSender(e) || typeof filePath !== 'string' || !filePath) return
    const win = BrowserWindow.fromWebContents(e.sender)
    if (win) grantFile(win.id, filePath)
  })
}
