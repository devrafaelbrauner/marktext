import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isKeyboardVisible, watchSoftKeyboard } from '@/util/visualViewport'

// The Android build detects the soft keyboard from the visual viewport. These
// specs drive a fake viewport through the two Android resize modes and pin
// that a desktop (fine pointer) never reacts.

interface FakeViewport extends EventTarget {
  width: number
  height: number
  offsetTop: number
}

let viewport: FakeViewport
let container: HTMLElement
let stop: () => void = () => {}

function setPointer(coarse: boolean): void {
  // jsdom has no matchMedia.
  Object.defineProperty(window, 'matchMedia', {
    value: (query: string) => ({ matches: coarse && query === '(pointer: coarse)' }),
    configurable: true
  })
}

function resize(height: number, innerHeight = window.innerHeight): void {
  viewport.height = height
  Object.defineProperty(window, 'innerHeight', { value: innerHeight, configurable: true })
  viewport.dispatchEvent(new Event('resize'))
}

function rect(top: number, height: number): DOMRect {
  return new DOMRect(0, top, 300, height)
}

let frames: FrameRequestCallback[] = []

function flushFrames(): void {
  const pending = frames
  frames = []
  for (const callback of pending) callback(performance.now())
}

beforeEach(() => {
  viewport = Object.assign(new EventTarget(), { width: 393, height: 800, offsetTop: 0 })
  Object.defineProperty(window, 'visualViewport', { value: viewport, configurable: true })
  Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true })
  // jsdom has no requestAnimationFrame; queue frames for `flushFrames`.
  frames = []
  Object.defineProperty(window, 'requestAnimationFrame', {
    value: (callback: FrameRequestCallback) => frames.push(callback),
    configurable: true
  })
  Object.defineProperty(window, 'cancelAnimationFrame', { value: () => {}, configurable: true })

  container = document.createElement('div')
  container.innerHTML = '<p>first line</p><p>caret line</p>'
  document.body.appendChild(container)
  vi.spyOn(container, 'getBoundingClientRect').mockReturnValue(rect(0, 800))
})

afterEach(() => {
  stop()
  stop = () => {}
  container.remove()
  document.getSelection()?.removeAllRanges()
  Reflect.deleteProperty(Range.prototype, 'getClientRects')
  vi.restoreAllMocks()
})

describe('watchSoftKeyboard', () => {
  it('stays inert with a fine pointer even when the viewport shrinks', () => {
    setPointer(false)
    stop = watchSoftKeyboard(container)

    resize(400)

    expect(isKeyboardVisible()).toBe(false)
    expect(document.documentElement.classList.contains('mt-keyboard-visible')).toBe(false)
    expect(document.documentElement.style.getPropertyValue('--mt-keyboard-inset')).toBe('')
  })

  it('reports a keyboard overlaying the page with its covered height', () => {
    setPointer(true)
    stop = watchSoftKeyboard(container)

    resize(500)

    expect(isKeyboardVisible()).toBe(true)
    expect(document.documentElement.classList.contains('mt-keyboard-visible')).toBe(true)
    expect(document.documentElement.style.getPropertyValue('--mt-keyboard-inset')).toBe('300px')
  })

  it('reports a keyboard the window was resized around with no inset', () => {
    setPointer(true)
    stop = watchSoftKeyboard(container)

    resize(500, 500)

    expect(isKeyboardVisible()).toBe(true)
    expect(document.documentElement.style.getPropertyValue('--mt-keyboard-inset')).toBe('0px')
  })

  it('ignores a small viewport change and clears once the keyboard closes', () => {
    setPointer(true)
    stop = watchSoftKeyboard(container)

    resize(700)
    expect(isKeyboardVisible()).toBe(false)

    resize(500)
    resize(800)
    expect(isKeyboardVisible()).toBe(false)
    expect(document.documentElement.classList.contains('mt-keyboard-visible')).toBe(false)
  })

  it('scrolls the caret above the keyboard when it opens and on input', () => {
    setPointer(true)
    const caretLine = container.querySelectorAll('p')[1]
    document.getSelection()?.collapse(caretLine.firstChild, 3)
    let caretTop = 600
    // jsdom has no layout and no Range.getClientRects.
    Object.defineProperty(Range.prototype, 'getClientRects', {
      value: () => [rect(caretTop, 20)],
      configurable: true
    })
    stop = watchSoftKeyboard(container)

    resize(500)
    flushFrames()
    // Visible bottom 500 - 24 margin = 476; the caret ends at 620.
    expect(container.scrollTop).toBe(144)

    container.scrollTop = 0
    caretTop = 480
    document.dispatchEvent(new Event('input'))
    flushFrames()
    expect(container.scrollTop).toBe(24)
  })

  it('removes its root markers on teardown', () => {
    setPointer(true)
    stop = watchSoftKeyboard(container)
    resize(500)

    stop()
    stop = () => {}

    expect(isKeyboardVisible()).toBe(false)
    expect(document.documentElement.classList.contains('mt-keyboard-visible')).toBe(false)
    expect(document.documentElement.style.getPropertyValue('--mt-keyboard-inset')).toBe('')
  })
})
