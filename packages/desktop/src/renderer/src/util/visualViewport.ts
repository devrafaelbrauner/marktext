// Soft-keyboard handling for touch devices (the Android build's WebView).
//
// The keyboard is detected from the visual viewport: it is open while the
// viewport is more than KEYBOARD_MIN_HEIGHT shorter than the tallest height
// seen at the same width. Comparing against the window instead would miss it
// under `adjustResize`, where the whole window shrinks with the keyboard.
//
// While it is open, `--mt-keyboard-inset` on the root element holds how much
// of the layout viewport the keyboard covers (0 when the window was resized
// around it), the root carries `mt-keyboard-visible`, and the caret is kept
// scrolled above the keyboard after every input and selection change.
//
// A fine primary pointer (desktop) keeps the module inert: there a shorter
// viewport is a window resize, never a keyboard.

const KEYBOARD_MIN_HEIGHT = 150
const CARET_MARGIN = 24
const VISIBLE_CLASS = 'mt-keyboard-visible'
const INSET_PROPERTY = '--mt-keyboard-inset'

let keyboardVisible = false

export const isKeyboardVisible = (): boolean => keyboardVisible

function caretRect(selection: Selection): DOMRect | null {
  const { focusNode, focusOffset } = selection
  if (!focusNode) return null

  const range = focusNode.ownerDocument?.createRange()
  if (!range) return null
  range.setStart(focusNode, focusOffset)
  range.collapse(true)
  const [rect] = range.getClientRects()
  if (rect) return rect

  // A caret on an empty line has no client rects; use its line's box.
  const element = focusNode instanceof Element ? focusNode : focusNode.parentElement

  return element?.getBoundingClientRect() ?? null
}

/**
 * Track the soft keyboard and keep the caret inside `scrollContainer` visible
 * above it. Returns the teardown, which also clears the root class/property.
 */
export function watchSoftKeyboard(scrollContainer: HTMLElement): () => void {
  const doc = scrollContainer.ownerDocument
  const view = doc.defaultView
  const viewport = view?.visualViewport
  if (!view || !viewport || !view.matchMedia('(pointer: coarse)').matches) {
    return () => {}
  }

  const root = doc.documentElement
  // Tallest viewport height per width, so rotating keeps each orientation's
  // keyboard-free height.
  const fullHeights = new Map<number, number>()
  let frame: number | null = null

  const revealCaret = (): void => {
    frame = null
    const selection = doc.getSelection()
    if (!keyboardVisible || !selection?.focusNode || !scrollContainer.contains(selection.focusNode)) {
      return
    }

    const caret = caretRect(selection)
    if (!caret) return

    const bounds = scrollContainer.getBoundingClientRect()
    const top = Math.max(bounds.top, viewport.offsetTop) + CARET_MARGIN
    const bottom = Math.min(bounds.bottom, viewport.offsetTop + viewport.height) - CARET_MARGIN
    if (caret.bottom > bottom) {
      scrollContainer.scrollTop += caret.bottom - bottom
    } else if (caret.top < top) {
      scrollContainer.scrollTop -= top - caret.top
    }
  }

  const scheduleReveal = (): void => {
    if (keyboardVisible && frame === null) {
      frame = view.requestAnimationFrame(revealCaret)
    }
  }

  const update = (): void => {
    const { width, height, offsetTop } = viewport
    const fullHeight = Math.max(fullHeights.get(width) ?? 0, height)
    fullHeights.set(width, fullHeight)

    const visible = fullHeight - height > KEYBOARD_MIN_HEIGHT
    const inset = visible ? Math.max(0, view.innerHeight - height - offsetTop) : 0
    root.style.setProperty(INSET_PROPERTY, `${Math.round(inset)}px`)
    root.classList.toggle(VISIBLE_CLASS, visible)

    const opened = visible && !keyboardVisible
    keyboardVisible = visible
    if (opened) scheduleReveal()
  }

  update()
  viewport.addEventListener('resize', update)
  viewport.addEventListener('scroll', update)
  doc.addEventListener('selectionchange', scheduleReveal)
  doc.addEventListener('input', scheduleReveal)

  return () => {
    viewport.removeEventListener('resize', update)
    viewport.removeEventListener('scroll', update)
    doc.removeEventListener('selectionchange', scheduleReveal)
    doc.removeEventListener('input', scheduleReveal)
    if (frame !== null) view.cancelAnimationFrame(frame)
    frame = null
    keyboardVisible = false
    root.classList.remove(VISIBLE_CLASS)
    root.style.removeProperty(INSET_PROPERTY)
  }
}
