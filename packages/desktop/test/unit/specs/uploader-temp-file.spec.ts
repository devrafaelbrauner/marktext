import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import fs from 'fs-extra'
import os from 'os'
import path from 'path'
import { restoreEnv } from '../commandFixtures'

// Capture the handler ipcMain.handle() registers so the spec can invoke the
// real upload path instead of re-implementing it.
type Handler = (event: unknown, req: unknown) => Promise<unknown>
const handlers = new Map<string, Handler>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: Handler) => handlers.set(channel, fn)
  }
}))
// Sender validation is covered by validate-sender.spec; here the caller is the app.
vi.mock('main_renderer/security/validateSender', () => ({ validateSender: () => true }))

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

let binDir: string
let argvLog: string
let copyPath: string
let originalPath: string | undefined
// What the main-side data center says; tests switch it per case.
const uploaderSettings = { currentUploader: 'picgo', cliScript: '' }

// The stand-in uploader below is a POSIX shell script, and the argv-vs-shell
// behaviour under test is the non-Windows branch of uploadByPicgo, so the whole
// file is a no-op on Windows.
const skipOnWindows = process.platform === 'win32'

// A stand-in for the picgo / cli-script executable: it appends the path it was
// handed to argvLog and prints picgo's real success format (URL on the line
// after the marker, which is what the output parser has to cope with).
const writeFakeUploader = async(name: string) => {
  const file = path.join(binDir, name)
  await fs.writeFile(
    file,
    [
      '#!/bin/sh',
      // picgo is called as `picgo u <path>`; the cli-script form gets the path
      // as the only argument. Record the last argument either way.
      'for a in "$@"; do last="$a"; done',
      `printf '%s\\n' "$last" >> "${argvLog}"`,
      `cp "$last" "${copyPath}" 2>/dev/null || true`,
      'echo "[PicGo INFO]: Before upload"',
      'echo "[PicGo SUCCESS]: "',
      'echo "https://cdn.example.com/uploaded.png"'
    ].join('\n') + '\n',
    { mode: 0o755 }
  )
  return file
}

beforeAll(async() => {
  binDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mt-uploader-bin-'))
  argvLog = path.join(binDir, 'argv.log')
  copyPath = path.join(binDir, 'received.bin')
  await fs.writeFile(argvLog, '')
  await writeFakeUploader('picgo')
  originalPath = process.env.PATH
  process.env.PATH = `${binDir}${path.delimiter}${originalPath ?? ''}`

  const { registerUploaderHandlers, setUploaderSettingsSource } = await import('main_renderer/ipc/uploader')
  setUploaderSettingsSource(async() => uploaderSettings)
  registerUploaderHandlers()
})

afterAll(async() => {
  restoreEnv('PATH', originalPath)
  await fs.remove(binDir)
})

beforeEach(async() => {
  await fs.writeFile(argvLog, '')
  uploaderSettings.currentUploader = 'picgo'
  uploaderSettings.cliScript = ''
})

const upload = async(req: unknown) => {
  const handler = handlers.get('mt::uploader::upload')
  if (!handler) throw new Error('mt::uploader::upload was never registered')
  return handler(null, req)
}

const uploadedPaths = async() =>
  (await fs.readFile(argvLog, 'utf8')).split('\n').filter(Boolean)

describe.skipIf(skipOnWindows)('uploader: clipboard image handed to the uploader as a temp file (#2915/#3360)', () => {
  it('names the temp file with the image extension so the uploader can infer the type', async() => {
    const url = await upload({
      pathname: '/tmp/notes/a.md',
      image: { data: new Uint8Array(PNG), name: 'image.png' },
      isPath: false
    })

    const [handed] = await uploadedPaths()
    expect(handed, 'uploader must be handed a path with the .png extension').toMatch(/\.png$/)
    expect(url).toBe('https://cdn.example.com/uploaded.png')
  })

  it('writes the real bytes to that temp file', async() => {
    await upload({
      pathname: '/tmp/notes/a.md',
      image: { data: new Uint8Array(PNG), name: 'image.png' },
      isPath: false
    })
    // The fake uploader copies what it was handed, because the handler unlinks
    // the temp file as soon as the upload resolves.
    expect(Buffer.compare(await fs.readFile(copyPath), PNG)).toBe(0)
  })

  it('removes the temp file once the upload finishes', async() => {
    await upload({
      pathname: '/tmp/notes/a.md',
      image: { data: new Uint8Array(PNG), name: 'image.png' },
      isPath: false
    })
    const [handed] = await uploadedPaths()
    expect(await fs.pathExists(handed)).toBe(false)
  })

  it('does not collide when two clipboard images are uploaded in the same millisecond', async() => {
    await Promise.all([
      upload({
        pathname: '/tmp/notes/a.md',
        image: { data: new Uint8Array(PNG), name: 'image.png' },
        isPath: false
      }),
      upload({
        pathname: '/tmp/notes/a.md',
        image: { data: new Uint8Array(Buffer.concat([PNG, Buffer.from([0])])), name: 'image.png' },
        isPath: false
      })
    ])
    const handed = await uploadedPaths()
    expect(handed).toHaveLength(2)
    expect(new Set(handed).size, `both uploads used the same temp path: ${handed}`).toBe(2)
  })
})

describe.skipIf(skipOnWindows)('uploader: local image path handed to picgo (#3360)', () => {
  it('passes a path containing shell metacharacters through unmangled', async() => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mt-uploader-src-'))
    // Legal on macOS/Linux, and the kind of name a screenshot tool or a
    // download can produce.
    const weird = path.join(dir, 'a "quoted" $name `x`.png')
    await fs.writeFile(weird, PNG)

    await upload({
      pathname: path.join(dir, 'note.md'),
      image: weird,
      isPath: true
    })

    const [handed] = await uploadedPaths()
    expect(handed).toBe(weird)
    await fs.remove(dir)
  })
})

describe.skipIf(skipOnWindows)('uploader: settings come from the main process only', () => {
  it('ignores a cliScript and uploader smuggled into the request', async() => {
    const marker = path.join(binDir, 'evil-ran')
    const evil = path.join(binDir, 'evil.sh')
    await fs.writeFile(evil, `#!/bin/sh\ntouch "${marker}"\necho https://evil.example/x.png\n`, { mode: 0o755 })

    const url = await upload({
      pathname: '/tmp/notes/a.md',
      image: { data: new Uint8Array(PNG), name: 'image.png' },
      isPath: false,
      preferences: { currentUploader: 'cliScript', cliScript: evil }
    })

    expect(url).toBe('https://cdn.example.com/uploaded.png')
    expect(await fs.pathExists(marker)).toBe(false)
    expect(await uploadedPaths()).toHaveLength(1)
  })

  it('runs the cliScript configured in the data center', async() => {
    uploaderSettings.currentUploader = 'cliScript'
    uploaderSettings.cliScript = await writeFakeUploader('configured-upload.sh')

    await upload({
      pathname: '/tmp/notes/a.md',
      image: { data: new Uint8Array(PNG), name: 'image.png' },
      isPath: false
    })

    const [handed] = await uploadedPaths()
    expect(handed).toMatch(/\.png$/)
  })
})
