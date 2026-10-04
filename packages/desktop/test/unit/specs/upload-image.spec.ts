import { describe, it, expect, beforeEach, vi } from 'vitest'
import { uploadImage } from '@/util/fileSystem'

// uploadImage forwards to the preload contextBridge surface
// (window.uploader.uploadImage). The uploader and its cliScript are chosen by
// the main process from its own settings, so the payload carries only the
// document path and the image — a renderer-supplied script path would let any
// page that reaches the channel run an arbitrary executable.
const uploadImageFn = vi.fn((_payload?: unknown) => Promise.resolve('https://cdn/x.png'))

const win = window as unknown as {
  uploader: { uploadImage: typeof uploadImageFn }
}

beforeEach(() => {
  uploadImageFn.mockClear()
  win.uploader = { uploadImage: uploadImageFn }
})

describe('uploadImage IPC payload shape', () => {
  const docPath = '/tmp/notes/a.md'

  it('forwards a local path string with isPath:true and no uploader settings', async() => {
    const source = '/Users/someone/pictures/pic.png'
    const result = await uploadImage(docPath, source)

    expect(uploadImageFn).toHaveBeenCalledTimes(1)
    expect(uploadImageFn.mock.calls[0][0]).toEqual({ pathname: docPath, image: source, isPath: true })
    expect(result).toBe('https://cdn/x.png')
  })

  it('forwards a binary File with isPath:false and a Uint8Array + name', async() => {
    const file = new File([new Uint8Array([1, 2, 3])], 'pic.png', { type: 'image/png' })
    await uploadImage(docPath, file)

    const payload = uploadImageFn.mock.calls[0][0] as {
      pathname: string
      image: { data: Uint8Array; name: string }
      isPath: boolean
    }
    expect(Object.keys(payload).sort()).toEqual(['image', 'isPath', 'pathname'])
    expect(payload.pathname).toBe(docPath)
    expect(payload.isPath).toBe(false)
    expect(payload.image.name).toBe('pic.png')
    expect(payload.image.data).toBeInstanceOf(Uint8Array)
    expect(Array.from(payload.image.data)).toEqual([1, 2, 3])
  })
})
