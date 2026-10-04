import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseMtFileUrl, toMtFileUrl } from 'common/mtFileUrl'
import { handleMtFileRequest } from 'main_renderer/protocol/mtFile'
import { resolveAppFile } from 'main_renderer/protocol/mtApp'

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

const created: string[] = []

const tempDir = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-file-'))
  created.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of created.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('mt-file URL', () => {
  it('round-trips a POSIX absolute path', () => {
    const parsed = parseMtFileUrl(toMtFileUrl('/tmp/pics/a cat.png'))
    expect(parsed).toEqual({ ok: true, filePath: '/tmp/pics/a cat.png' })
  })

  it('rejects a remote host and a UNC path before any file is opened', () => {
    expect(parseMtFileUrl('mt-file://127.0.0.1/share/x.png')).toMatchObject({
      ok: false,
      status: 403,
      reason: 'remote-host'
    })
    expect(parseMtFileUrl('mt-file://attacker/share/x.png')).toMatchObject({
      ok: false,
      reason: 'remote-host'
    })
    expect(parseMtFileUrl(toMtFileUrl('\\\\attacker\\share\\x.png'))).toMatchObject({
      ok: false,
      reason: 'remote-host'
    })
    expect(parseMtFileUrl(toMtFileUrl('//attacker/share/x.png'))).toMatchObject({
      ok: false,
      reason: 'remote-host'
    })
  })

  it('rejects traversal, including a dot-segment the URL parser would collapse', () => {
    expect(parseMtFileUrl('mt-file://local/tmp/../../etc/passwd.png')).toMatchObject({
      ok: false,
      reason: 'traversal'
    })
    expect(parseMtFileUrl('mt-file://local/tmp/%2e%2e/secret.png')).toMatchObject({
      ok: false,
      reason: 'traversal'
    })
  })
})

describe('mt-file handler', () => {
  it('serves allowed image types with the matching Content-Type', async() => {
    const dir = tempDir()
    const cases: Array<[string, string]> = [
      ['a.png', 'image/png'],
      ['a.jpg', 'image/jpeg'],
      ['a.jpeg', 'image/jpeg'],
      ['a.gif', 'image/gif'],
      ['a.svg', 'image/svg+xml'],
      ['a.webp', 'image/webp'],
      ['a.bmp', 'image/bmp'],
      ['a.ico', 'image/x-icon'],
      ['a.avif', 'image/avif'],
      ['a.apng', 'image/apng']
    ]
    for (const [name, type] of cases) {
      const filePath = path.join(dir, name)
      fs.writeFileSync(filePath, name.endsWith('.svg') ? '<svg xmlns="http://www.w3.org/2000/svg"/>' : PNG)
      const response = await handleMtFileRequest(toMtFileUrl(filePath))
      expect(response.status, name).toBe(200)
      expect(response.headers.get('content-type'), name).toBe(type)
    }
  })

  it('sends a restrictive CSP on SVG and refuses a non-image', async() => {
    const dir = tempDir()
    const svg = path.join(dir, 'drawing.svg')
    fs.writeFileSync(svg, '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
    const svgResponse = await handleMtFileRequest(toMtFileUrl(svg))
    expect(svgResponse.headers.get('content-security-policy')).toContain("default-src 'none'")
    expect(svgResponse.headers.get('content-security-policy')).toContain("script-src 'none'")

    const text = path.join(dir, 'notes.txt')
    fs.writeFileSync(text, 'secret')
    const refused = await handleMtFileRequest(toMtFileUrl(text))
    expect(refused.status).toBe(403)
  })

  it('does not read a file for a UNC or remote-host URL', async() => {
    let reads = 0
    const io = {
      realpath: async(filePath: string) => {
        reads += 1
        return filePath
      },
      stat: async() => ({ isFile: () => true }),
      readFile: async() => new Uint8Array()
    }
    const remote = await handleMtFileRequest('mt-file://127.0.0.1/share/x.png', io)
    const unc = await handleMtFileRequest(toMtFileUrl('//127.0.0.1/share/x.png'), io)
    expect(remote.status).toBe(403)
    expect(unc.status).toBe(403)
    expect(reads).toBe(0)
  })

  it('returns 404 when the image is missing and refuses a symlink to a non-image', async() => {
    const dir = tempDir()
    const missing = await handleMtFileRequest(toMtFileUrl(path.join(dir, 'gone.png')))
    expect(missing.status).toBe(404)

    const secret = path.join(dir, 'secret.txt')
    const link = path.join(dir, 'photo.png')
    fs.writeFileSync(secret, 'nope')
    fs.symlinkSync(secret, link)
    const response = await handleMtFileRequest(toMtFileUrl(link))
    expect(response.status).toBe(403)
  })
})

describe('mt-app file resolution', () => {
  it('serves a file inside the renderer directory and rejects traversal', () => {
    const dir = tempDir()
    fs.writeFileSync(path.join(dir, 'index.html'), '<html></html>')
    expect(fs.realpathSync(resolveAppFile(dir, 'mt-app://bundle/index.html')!)).toBe(fs.realpathSync(path.join(dir, 'index.html')))
    expect(resolveAppFile(dir, 'mt-app://bundle/../../etc/passwd')).toBeNull()
    expect(resolveAppFile(dir, 'mt-app://evil/index.html')).toBeNull()
    const outside = tempDir()
    fs.writeFileSync(path.join(outside, 'secret.html'), 'no')
    fs.symlinkSync(outside, path.join(dir, 'link'))
    expect(resolveAppFile(dir, 'mt-app://bundle/link/secret.html')).toBeNull()
  })
})
