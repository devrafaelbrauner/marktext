import fs from 'fs-extra'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import log from 'electron-log'
import { SecretsStore, SECRETS_FILE_NAME } from 'main_renderer/security/secretsStore'

vi.mock('electron', () => ({ safeStorage: {} }))
vi.mock('electron-log', () => ({ default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))

// Reversible but not identity, so the file never holds the plaintext.
const fakeSafeStorage = (opts: { available?: boolean; backend?: string; reEncrypt?: boolean } = {}) => ({
  isAsyncEncryptionAvailable: vi.fn(async() => opts.available ?? true),
  encryptStringAsync: vi.fn(async(text: string) => Buffer.from(`enc:${text}`, 'utf8').reverse()),
  decryptStringAsync: vi.fn(async(buf: Buffer) => {
    const plain = Buffer.from(buf).reverse().toString('utf8')
    if (!plain.startsWith('enc:')) throw new Error('bad ciphertext')
    return { result: plain.slice(4), shouldReEncrypt: opts.reEncrypt ?? false }
  }),
  getSelectedStorageBackend: vi.fn(() => (opts.backend ?? 'gnome_libsecret') as never)
})

let dir: string
const filePath = () => path.join(dir, SECRETS_FILE_NAME)

beforeEach(async() => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mt-secrets-'))
  vi.mocked(log.error).mockClear()
})

afterEach(async() => {
  await fs.remove(dir)
})

describe('SecretsStore', () => {
  it('round-trips a value through the encrypted file and a fresh instance', async() => {
    const safeStorage = fakeSafeStorage()
    const store = new SecretsStore(dir, { safeStorage, platform: 'darwin' })
    await store.set('languagetool', 'apiKey', 's3cr3t-value')

    const raw = await fs.readFile(filePath(), 'utf8')
    expect(raw).not.toContain('s3cr3t-value')
    expect(JSON.parse(raw).languagetool.apiKey).toMatch(/^[A-Za-z0-9+/=]+$/)

    const reopened = new SecretsStore(dir, { safeStorage, platform: 'darwin' })
    expect(reopened.has('languagetool', 'apiKey')).toBe(true)
    await expect(reopened.get('languagetool', 'apiKey')).resolves.toBe('s3cr3t-value')
  })

  it('keeps has() in sync with set/delete and isolates namespaces', async() => {
    const store = new SecretsStore(dir, { safeStorage: fakeSafeStorage(), platform: 'darwin' })
    expect(store.has('a', 'k')).toBe(false)
    await store.set('a', 'k', 'v')
    expect(store.has('a', 'k')).toBe(true)
    expect(store.has('b', 'k')).toBe(false)
    await expect(store.get('b', 'k')).resolves.toBeNull()
    await store.delete('a', 'k')
    expect(store.has('a', 'k')).toBe(false)
    await expect(store.get('a', 'k')).resolves.toBeNull()
    expect(JSON.parse(await fs.readFile(filePath(), 'utf8'))).toEqual({})
  })

  it('does not treat inherited object keys as stored secrets', () => {
    const store = new SecretsStore(dir, { safeStorage: fakeSafeStorage(), platform: 'darwin' })
    expect(store.has('a', 'toString')).toBe(false)
  })

  it('refuses to store on the Linux basic_text backend', async() => {
    const store = new SecretsStore(dir, { safeStorage: fakeSafeStorage({ backend: 'basic_text' }), platform: 'linux' })
    expect(store.backend()).toBe('basic_text')
    await expect(store.set('p', 'k', 'v')).rejects.toMatchObject({ code: 'WEAK_BACKEND' })
    expect(store.has('p', 'k')).toBe(false)
    expect(await fs.pathExists(filePath())).toBe(false)
  })

  it('reports the backend as "os" outside Linux', () => {
    const store = new SecretsStore(dir, { safeStorage: fakeSafeStorage({ backend: 'basic_text' }), platform: 'win32' })
    expect(store.backend()).toBe('os')
  })

  it('refuses to store when encryption is unavailable', async() => {
    const store = new SecretsStore(dir, { safeStorage: fakeSafeStorage({ available: false }), platform: 'darwin' })
    await expect(store.isEncryptionAvailable()).resolves.toBe(false)
    await expect(store.set('p', 'k', 'v')).rejects.toMatchObject({ code: 'UNAVAILABLE' })
  })

  it('starts empty on a corrupted file and logs without the content', async() => {
    await fs.writeFile(filePath(), '{"p": {"k": "abc"', 'utf8')
    const store = new SecretsStore(dir, { safeStorage: fakeSafeStorage(), platform: 'darwin' })
    expect(store.has('p', 'k')).toBe(false)
    expect(log.error).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(vi.mocked(log.error).mock.calls)).not.toContain('abc')
    // Still writable afterwards: the broken file is replaced.
    await store.set('p', 'k', 'v')
    await expect(new SecretsStore(dir, { safeStorage: fakeSafeStorage(), platform: 'darwin' }).get('p', 'k')).resolves.toBe('v')
  })

  it('ignores non-string entries in an otherwise valid file', async() => {
    await fs.writeFile(filePath(), JSON.stringify({ p: { good: 'x', bad: 42 }, q: 'nope' }), 'utf8')
    const store = new SecretsStore(dir, { safeStorage: fakeSafeStorage(), platform: 'darwin' })
    expect(store.has('p', 'good')).toBe(true)
    expect(store.has('p', 'bad')).toBe(false)
    expect(store.has('q', 'nope')).toBe(false)
  })

  it('returns null when a stored value cannot be decrypted, without logging it', async() => {
    await fs.writeFile(filePath(), JSON.stringify({ p: { k: Buffer.from('garbage').toString('base64') } }), 'utf8')
    const store = new SecretsStore(dir, { safeStorage: fakeSafeStorage(), platform: 'darwin' })
    await expect(store.get('p', 'k')).resolves.toBeNull()
  })

  it('re-encrypts a value when safeStorage asks for it', async() => {
    const safeStorage = fakeSafeStorage()
    const store = new SecretsStore(dir, { safeStorage, platform: 'darwin' })
    await store.set('p', 'k', 'v')
    safeStorage.decryptStringAsync.mockResolvedValueOnce({ result: 'v', shouldReEncrypt: true })
    safeStorage.encryptStringAsync.mockClear()
    await expect(store.get('p', 'k')).resolves.toBe('v')
    expect(safeStorage.encryptStringAsync).toHaveBeenCalledWith('v')
  })

  it('keeps the last of concurrent writes on disk', async() => {
    const store = new SecretsStore(dir, { safeStorage: fakeSafeStorage(), platform: 'darwin' })
    await Promise.all([store.set('p', 'a', '1'), store.set('p', 'b', '2'), store.delete('p', 'a')])
    const reopened = new SecretsStore(dir, { safeStorage: fakeSafeStorage(), platform: 'darwin' })
    expect(reopened.has('p', 'a')).toBe(false)
    await expect(reopened.get('p', 'b')).resolves.toBe('2')
  })
})
