import fs from 'fs'
import path from 'path'
import { safeStorage as electronSafeStorage } from 'electron'
import log from 'electron-log'
import writeFileAtomic from 'write-file-atomic'

export type SafeStorageLike = Pick<
  typeof electronSafeStorage,
  'isAsyncEncryptionAvailable' | 'encryptStringAsync' | 'decryptStringAsync' | 'getSelectedStorageBackend'
>

export type SecretsStoreErrorCode = 'UNAVAILABLE' | 'WEAK_BACKEND'

export class SecretsStoreError extends Error {
  readonly code: SecretsStoreErrorCode

  constructor(code: SecretsStoreErrorCode, message: string) {
    super(message)
    this.name = 'SecretsStoreError'
    this.code = code
  }
}

/** On-disk shape: namespace → key → base64 ciphertext. */
type SecretsFile = Record<string, Record<string, string>>

export const SECRETS_FILE_NAME = 'secrets.json'

const parseSecretsFile = (raw: string): SecretsFile => {
  const parsed: unknown = JSON.parse(raw)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object')
  const result: SecretsFile = {}
  for (const [ns, entries] of Object.entries(parsed as Record<string, unknown>)) {
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)) continue
    const keys: Record<string, string> = {}
    for (const [key, value] of Object.entries(entries as Record<string, unknown>)) {
      if (typeof value === 'string') keys[key] = value
    }
    result[ns] = keys
  }
  return result
}

/**
 * Secrets encrypted with the OS keychain via `safeStorage`, persisted in
 * `<userData>/secrets.json`. Main process only: plaintext never crosses IPC
 * from here. Refuses to store anything when only Chromium's `basic_text`
 * Linux backend (a hard-coded key) is available.
 */
export class SecretsStore {
  private readonly filePath: string
  private readonly safeStorage: SafeStorageLike
  private readonly platform: NodeJS.Platform
  private data: SecretsFile
  private queue: Promise<void> = Promise.resolve()

  constructor(
    userDataPath: string,
    options: { safeStorage?: SafeStorageLike; platform?: NodeJS.Platform } = {}
  ) {
    this.filePath = path.join(userDataPath, SECRETS_FILE_NAME)
    this.safeStorage = options.safeStorage ?? electronSafeStorage
    this.platform = options.platform ?? process.platform
    this.data = this.load()
  }

  private load(): SecretsFile {
    let raw: string
    try {
      raw = fs.readFileSync(this.filePath, 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        log.error(`SecretsStore: cannot read ${this.filePath}; starting empty.`, err)
      }
      return {}
    }
    try {
      return parseSecretsFile(raw)
    } catch (err) {
      // The parser's message can quote file content, so it is not logged.
      log.error(`SecretsStore: ${this.filePath} is corrupted (${(err as Error).name}); starting empty.`)
      return {}
    }
  }

  /** Linux password-store backend name, or 'os' elsewhere. */
  backend(): string {
    return this.platform === 'linux' ? this.safeStorage.getSelectedStorageBackend() : 'os'
  }

  async isEncryptionAvailable(): Promise<boolean> {
    try {
      return await this.safeStorage.isAsyncEncryptionAvailable()
    } catch {
      return false
    }
  }

  private async assertWritable(): Promise<void> {
    if (!(await this.isEncryptionAvailable())) {
      throw new SecretsStoreError('UNAVAILABLE', 'OS secret encryption is unavailable')
    }
    if (this.backend() === 'basic_text') {
      throw new SecretsStoreError('WEAK_BACKEND', 'No secure password store is available (basic_text backend)')
    }
  }

  /** Synchronous: answers from the in-memory index of stored keys. */
  has(namespace: string, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.data[namespace] ?? {}, key)
  }

  async get(namespace: string, key: string): Promise<string | null> {
    if (!this.has(namespace, key)) return null
    const cipher = this.data[namespace][key]
    try {
      const { result, shouldReEncrypt } = await this.safeStorage.decryptStringAsync(
        Buffer.from(cipher, 'base64')
      )
      if (shouldReEncrypt) {
        await this.set(namespace, key, result).catch((err) => {
          log.warn(`SecretsStore: re-encrypting ${namespace}/${key} failed:`, (err as Error).message)
        })
      }
      return result
    } catch (err) {
      log.error(`SecretsStore: cannot decrypt ${namespace}/${key}:`, (err as Error).message)
      return null
    }
  }

  set(namespace: string, key: string, value: string): Promise<void> {
    return this.serialize(async() => {
      await this.assertWritable()
      const cipher = await this.safeStorage.encryptStringAsync(value)
      const entries = { ...(this.data[namespace] ?? {}), [key]: cipher.toString('base64') }
      this.data = { ...this.data, [namespace]: entries }
      await this.write()
    })
  }

  delete(namespace: string, key: string): Promise<void> {
    return this.serialize(async() => {
      if (!this.has(namespace, key)) return
      const entries = { ...this.data[namespace] }
      delete entries[key]
      const next = { ...this.data }
      if (Object.keys(entries).length) next[namespace] = entries
      else delete next[namespace]
      this.data = next
      await this.write()
    })
  }

  /**
   * Mutations run one at a time in call order: `set` awaits encryption, so a
   * `delete` issued after it would otherwise run first, and an older snapshot
   * could land on disk after a newer one.
   */
  private serialize(op: () => Promise<void>): Promise<void> {
    const run = this.queue.then(op)
    this.queue = run.catch(() => {})
    return run
  }

  private write(): Promise<void> {
    return writeFileAtomic(this.filePath, JSON.stringify(this.data), { encoding: 'utf8', mode: 0o600 })
  }
}
