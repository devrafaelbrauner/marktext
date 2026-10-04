import { dialog, type BrowserWindow, type OpenDialogOptions, type SaveDialogOptions } from 'electron'

// Paths the user picked in a dialog this process showed, plus OS file drops
// and clipboard file paths. Grants are per window and live for the session.
const filesByWindow = new Map<number, Set<string>>()
const dirsByWindow = new Map<number, Set<string>>()
const tempDirs = new Set<string>()

const fileSet = (windowId: number): Set<string> => {
  let set = filesByWindow.get(windowId)
  if (!set) {
    set = new Set()
    filesByWindow.set(windowId, set)
  }
  return set
}

const dirSet = (windowId: number): Set<string> => {
  let set = dirsByWindow.get(windowId)
  if (!set) {
    set = new Set()
    dirsByWindow.set(windowId, set)
  }
  return set
}

export function grantFile(windowId: number, filePath: string): void {
  if (!filePath) return
  fileSet(windowId).add(filePath)
}

export function grantDirectory(windowId: number, dir: string): void {
  if (!dir) return
  dirSet(windowId).add(dir)
}

export function grantTempDir(dir: string): void {
  if (dir) tempDirs.add(dir)
}

export function grantedFiles(windowId: number): string[] {
  return [...(filesByWindow.get(windowId) ?? [])]
}

export function grantedDirectories(windowId: number): string[] {
  return [...(dirsByWindow.get(windowId) ?? [])]
}

export function grantedTempDirs(): string[] {
  return [...tempDirs]
}

export function clearPathGrants(): void {
  filesByWindow.clear()
  dirsByWindow.clear()
  tempDirs.clear()
}

const grantOpenResult = (
  win: BrowserWindow | null | undefined,
  filePaths: string[],
  options: OpenDialogOptions
): void => {
  if (!win) return
  const asDirectory = options.properties?.includes('openDirectory') === true
  for (const filePath of filePaths) {
    if (asDirectory) grantDirectory(win.id, filePath)
    else grantFile(win.id, filePath)
  }
}

export async function showOpenDialogScoped(
  win: BrowserWindow | null | undefined,
  options: OpenDialogOptions
): Promise<Electron.OpenDialogReturnValue> {
  const result = win
    ? await dialog.showOpenDialog(win, options)
    : await dialog.showOpenDialog(options)
  if (!result.canceled) grantOpenResult(win, result.filePaths, options)
  return result
}

export async function showSaveDialogScoped(
  win: BrowserWindow | null | undefined,
  options: SaveDialogOptions
): Promise<Electron.SaveDialogReturnValue> {
  const result = win
    ? await dialog.showSaveDialog(win, options)
    : await dialog.showSaveDialog(options)
  if (!result.canceled && result.filePath && win) grantFile(win.id, result.filePath)
  return result
}
