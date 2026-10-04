import path from 'path'
import { BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import type Accessor from '../app/accessor'
import EditorWindow from '../windows/editor'
import { WindowType } from '../windows/base'
import { grantedDirectories, grantedFiles, grantedTempDirs } from './pathGrants'
import {
  imageFolderRoots,
  isPathInScope,
  isRealImageFile,
  pathsEqual,
  userDataSubdirectories
} from './pathScope'

let accessor: Accessor | null = null

export function setFsAccessAccessor(next: Accessor): void {
  accessor = next
}

const windowIdOf = (event: IpcMainInvokeEvent): number | null => {
  const win = BrowserWindow.fromWebContents(event.sender)
  return win ? win.id : null
}

export function isSettingsSender(event: IpcMainInvokeEvent): boolean {
  const windowId = windowIdOf(event)
  if (windowId == null || !accessor) return false
  return accessor.windowManager.get(windowId)?.type === WindowType.SETTINGS
}

async function rootsFor(
  event: IpcMainInvokeEvent
): Promise<{ directories: string[]; files: string[] }> {
  const directories = [...grantedTempDirs()]
  const files: string[] = []
  const windowId = windowIdOf(event)
  if (windowId != null) {
    directories.push(...grantedDirectories(windowId))
    files.push(...grantedFiles(windowId))
    const base = accessor?.windowManager.get(windowId)
    if (base instanceof EditorWindow) {
      const opened = base.openedRootDirectory
      if (opened) directories.push(opened)
      for (const filePath of base.getOpenedFilePaths()) {
        if (filePath) directories.push(path.dirname(filePath))
      }
    }
  }
  if (accessor) {
    directories.push(...userDataSubdirectories(accessor.paths.userDataPath))
    const imageFolder = await accessor.dataCenter.getItem('imageFolderPath')
    const screenshotFolder = await accessor.dataCenter.getItem('screenshotFolderPath')
    if (typeof imageFolder === 'string') directories.push(...imageFolderRoots(imageFolder))
    if (typeof screenshotFolder === 'string') directories.push(...imageFolderRoots(screenshotFolder))
  }
  return { directories, files }
}

export async function pathIsAllowed(event: IpcMainInvokeEvent, candidate: string): Promise<boolean> {
  const roots = await rootsFor(event)
  return isPathInScope(candidate, roots.directories, roots.files)
}

export async function assertPathsAllowed(
  event: IpcMainInvokeEvent,
  candidates: string[]
): Promise<void> {
  for (const candidate of candidates) {
    if (!(await pathIsAllowed(event, candidate))) {
      throw new Error('Path is outside the allowed roots')
    }
  }
}

/**
 * Image copy reads a source the user dropped, picked, or typed, then writes
 * into an allowed folder. The source may sit outside those folders; it still
 * has to be a real image file, not a symlink to something else.
 */
export async function assertImageCopyAllowed(
  event: IpcMainInvokeEvent,
  src: string,
  destDir: string
): Promise<void> {
  if (!(await pathIsAllowed(event, destDir))) {
    throw new Error('Path is outside the allowed roots')
  }
  if (await pathIsAllowed(event, src)) return
  if (isRealImageFile(src)) return
  throw new Error('Path is outside the allowed roots')
}

export async function executableCheckAllowed(
  event: IpcMainInvokeEvent,
  filePath: string
): Promise<boolean> {
  // The preferences panel green-ticks a script path the user is still typing,
  // before it is saved. That window may ask; the editor window may not.
  if (isSettingsSender(event)) return true
  if (await pathIsAllowed(event, filePath)) return true
  const script = await accessor?.dataCenter.getItem('cliScript')
  return typeof script === 'string' && script.length > 0 && pathsEqual(path.resolve(filePath), path.resolve(script))
}
