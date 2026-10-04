import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BrowserWindow } from 'electron'
import { isAppRendererUrl, validateSender } from 'main_renderer/security/validateSender'

vi.mock('electron', () => ({ BrowserWindow: { fromWebContents: vi.fn() } }))

const DEV_URL = 'http://localhost:5173'

interface FakeFrame { url: string; parent: FakeFrame | null; top: FakeFrame | null }

const topFrame = (url: string): FakeFrame => {
  const frame: FakeFrame = { url, parent: null, top: null }
  frame.top = frame
  return frame
}

const eventFrom = (frame: FakeFrame | null) => ({ sender: {}, senderFrame: frame }) as never

let originalUrl: string | undefined

beforeEach(() => {
  originalUrl = process.env.ELECTRON_RENDERER_URL
  process.env.ELECTRON_RENDERER_URL = DEV_URL
  vi.mocked(BrowserWindow.fromWebContents).mockReturnValue({} as never)
})

afterEach(() => {
  if (originalUrl === undefined) delete process.env.ELECTRON_RENDERER_URL
  else process.env.ELECTRON_RENDERER_URL = originalUrl
})

describe('validateSender', () => {
  it('accepts the top frame of an app window on the renderer URL, query included', () => {
    expect(validateSender(eventFrom(topFrame(`${DEV_URL}/?wid=1&type=editor#x`)))).toBe(true)
  })

  it('rejects an iframe inside the app page', () => {
    const top = topFrame(`${DEV_URL}/`)
    const child: FakeFrame = { url: `${DEV_URL}/`, parent: top, top }
    expect(validateSender(eventFrom(child))).toBe(false)
  })

  it('rejects a top frame that navigated to a foreign URL', () => {
    expect(validateSender(eventFrom(topFrame('https://evil.example/')))).toBe(false)
    expect(validateSender(eventFrom(topFrame('http://localhost:5174/')))).toBe(false)
  })

  it('rejects a webContents that is not an app BrowserWindow', () => {
    vi.mocked(BrowserWindow.fromWebContents).mockReturnValue(null)
    expect(validateSender(eventFrom(topFrame(`${DEV_URL}/`)))).toBe(false)
  })

  it('rejects an event whose frame is gone', () => {
    expect(validateSender(eventFrom(null))).toBe(false)
  })

  it('rejects everything when the renderer URL is unknown', () => {
    delete process.env.ELECTRON_RENDERER_URL
    expect(validateSender(eventFrom(topFrame(`${DEV_URL}/`)))).toBe(false)
  })
})

describe('isAppRendererUrl (packaged file renderer)', () => {
  const base = 'file:///Applications/MarkText.app/Contents/Resources/app.asar/out/renderer/index.html'

  it('matches the exact page regardless of query and hash', () => {
    expect(isAppRendererUrl(`${base}?wid=3&type=settings#general`, base)).toBe(true)
  })

  it('rejects other local files, even next to the renderer', () => {
    expect(isAppRendererUrl(base.replace('index.html', 'evil.html'), base)).toBe(false)
    expect(isAppRendererUrl('file:///Users/me/notes/page.html', base)).toBe(false)
  })

  it('rejects a different scheme with the same path', () => {
    expect(isAppRendererUrl(base.replace('file://', 'http://localhost'), base)).toBe(false)
  })
})

describe('isAppRendererUrl (packaged mt-app renderer)', () => {
  const base = 'mt-app://bundle/index.html'

  it('matches the exact page regardless of query and hash', () => {
    expect(isAppRendererUrl(`${base}?wid=3&type=editor#x`, base)).toBe(true)
  })

  it('rejects another file on the same origin and a remote host', () => {
    expect(isAppRendererUrl('mt-app://bundle/evil.html', base)).toBe(false)
    expect(isAppRendererUrl('mt-app://attacker/index.html', base)).toBe(false)
  })
})
