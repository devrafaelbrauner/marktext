import fsPromises from 'fs/promises'
import path from 'path'
import type { VaultIndexFs } from './types'

/** Disk access of the desktop index worker (utility process). */
export const nodeVaultIndexFs: VaultIndexFs = {
  async stat(file) {
    try {
      const stats = await fsPromises.stat(file)
      return {
        isFile: stats.isFile(),
        isDirectory: stats.isDirectory(),
        size: stats.size,
        mtimeMs: stats.mtimeMs,
        ctimeMs: stats.ctimeMs
      }
    } catch {
      return null
    }
  },

  // Symlinked folders are not followed (cycles); symlinked files are listed.
  async walk(dir, isIgnored) {
    const files: string[] = []
    const visit = async(current: string): Promise<void> => {
      let entries
      try {
        entries = await fsPromises.readdir(current, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        const full = path.join(current, entry.name)
        if (isIgnored(full)) continue
        if (entry.isDirectory()) await visit(full)
        else if (entry.isFile() || entry.isSymbolicLink()) files.push(full)
      }
    }
    await visit(dir)
    return files
  },

  readText: (file) => fsPromises.readFile(file, 'utf8'),

  async writeText(file, text) {
    await fsPromises.mkdir(path.dirname(file), { recursive: true })
    const temp = `${file}.${process.pid}.tmp`
    await fsPromises.writeFile(temp, text, 'utf8')
    await fsPromises.rename(temp, file)
  }
}
