import type { Disposable } from '@shared/plugins/types'

interface ParsedAccelerator {
  ctrl: boolean
  meta: boolean
  alt: boolean
  shift: boolean
  /** Lower-case `KeyboardEvent.key` values that match, or null when only `codes` decide. */
  keys: string[] | null
  /** `KeyboardEvent.code` values that match (layout-independent keys). */
  codes: string[]
}

const NAMED_KEYS: Record<string, { keys?: string[]; codes?: string[] }> = {
  plus: { keys: ['+'] },
  space: { codes: ['Space'] },
  tab: { keys: ['tab'] },
  backspace: { keys: ['backspace'] },
  delete: { keys: ['delete'] },
  insert: { keys: ['insert'] },
  return: { keys: ['enter'] },
  enter: { keys: ['enter'] },
  up: { keys: ['arrowup'] },
  down: { keys: ['arrowdown'] },
  left: { keys: ['arrowleft'] },
  right: { keys: ['arrowright'] },
  home: { keys: ['home'] },
  end: { keys: ['end'] },
  pageup: { keys: ['pageup'] },
  pagedown: { keys: ['pagedown'] },
  escape: { keys: ['escape'] },
  esc: { keys: ['escape'] }
}

// Physical keys of the US layout, so Alt/Option combinations (which change
// `event.key` on macOS) still match.
const PUNCTUATION_CODES: Record<string, string> = {
  '-': 'Minus',
  '=': 'Equal',
  '[': 'BracketLeft',
  ']': 'BracketRight',
  '\\': 'Backslash',
  ';': 'Semicolon',
  "'": 'Quote',
  ',': 'Comma',
  '.': 'Period',
  '/': 'Slash',
  '`': 'Backquote'
}

/**
 * Parses an Electron accelerator (`CmdOrCtrl+Alt+D`) for matching DOM key
 * events on `platform`. Returns null for accelerators it cannot represent.
 */
export const parseAccelerator = (accelerator: string, isMac: boolean): ParsedAccelerator | null => {
  const parts = accelerator.split('+')
  // `CmdOrCtrl++` / `Shift++` name the plus key with an empty last part.
  if (accelerator.endsWith('++')) parts.splice(-2, 2, 'Plus')
  const keyPart = parts.pop()?.trim()
  if (!keyPart) return null
  const parsed: ParsedAccelerator = { ctrl: false, meta: false, alt: false, shift: false, keys: null, codes: [] }
  for (const raw of parts) {
    switch (raw.trim().toLowerCase()) {
      case 'cmdorctrl':
      case 'commandorcontrol':
        if (isMac) parsed.meta = true
        else parsed.ctrl = true
        break
      case 'cmd':
      case 'command':
      case 'meta':
      case 'super':
        parsed.meta = true
        break
      case 'ctrl':
      case 'control':
        parsed.ctrl = true
        break
      case 'alt':
      case 'option':
        parsed.alt = true
        break
      case 'shift':
        parsed.shift = true
        break
      default:
        return null
    }
  }
  const key = keyPart.toLowerCase()
  if (/^[a-z]$/.test(key)) {
    parsed.codes = [`Key${key.toUpperCase()}`]
  } else if (/^[0-9]$/.test(key)) {
    parsed.codes = [`Digit${key}`, `Numpad${key}`]
  } else if (/^f([1-9]|1[0-9]|2[0-4])$/.test(key)) {
    parsed.keys = [key]
  } else if (PUNCTUATION_CODES[keyPart]) {
    parsed.keys = [keyPart]
    parsed.codes = [PUNCTUATION_CODES[keyPart]]
  } else if (NAMED_KEYS[key]) {
    parsed.keys = NAMED_KEYS[key].keys ?? null
    parsed.codes = NAMED_KEYS[key].codes ?? []
  } else {
    return null
  }
  return parsed
}

export const matchesKeyEvent = (parsed: ParsedAccelerator, event: KeyboardEvent): boolean => {
  if (
    event.ctrlKey !== parsed.ctrl ||
    event.metaKey !== parsed.meta ||
    event.altKey !== parsed.alt ||
    event.shiftKey !== parsed.shift
  ) {
    return false
  }
  if (parsed.codes.includes(event.code)) return true
  return !!parsed.keys && parsed.keys.includes(event.key.toLowerCase())
}

/** Whether two accelerators are pressed with the same keys (same modifiers, overlapping key). */
const sameKeys = (a: ParsedAccelerator, b: ParsedAccelerator): boolean =>
  a.ctrl === b.ctrl &&
  a.meta === b.meta &&
  a.alt === b.alt &&
  a.shift === b.shift &&
  (a.codes.some((code) => b.codes.includes(code)) || !!a.keys?.some((key) => b.keys?.includes(key)))

interface Binding {
  commandId: string
  accelerator: string
  parsed: ParsedAccelerator
  run: () => void
  /** Why the binding is inactive, or null while it handles key presses. */
  blockedBy: string | null
}

export type KeybindingLogger = (message: string) => void

/**
 * Keyboard shortcuts of plugin commands, handled in the renderer. A binding
 * that collides with an app accelerator (the map main sends as
 * `mt::keybindings-response`) or with an earlier plugin binding stays
 * registered but inactive, and the collision is logged once; collisions are
 * re-evaluated whenever the app map changes.
 */
export class PluginKeybindings {
  private readonly bindings: Binding[] = []
  private appAccelerators: ParsedAccelerator[] = []
  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.defaultPrevented || event.isComposing) return
    const binding = this.bindings.find((b) => !b.blockedBy && matchesKeyEvent(b.parsed, event))
    if (!binding) return
    event.preventDefault()
    event.stopPropagation()
    binding.run()
  }

  constructor(
    private readonly target: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>,
    private readonly isMac: boolean,
    private readonly log: KeybindingLogger
  ) {
    target.addEventListener('keydown', this.onKeyDown as EventListener)
  }

  /** Replaces the app accelerator map (command id → accelerator). */
  setAppKeybindings(map: Record<string, string>): void {
    this.appAccelerators = Object.values(map)
      .map((acc) => (typeof acc === 'string' ? parseAccelerator(acc, this.isMac) : null))
      .filter((parsed): parsed is ParsedAccelerator => parsed !== null)
    this.evaluate()
  }

  /**
   * Binds `accelerator` to `run`. Returns the disposable of the binding, or
   * null when the accelerator cannot be parsed (logged).
   */
  register(commandId: string, accelerator: string, run: () => void): Disposable | null {
    const parsed = parseAccelerator(accelerator, this.isMac)
    if (!parsed) {
      this.log(`Ignoring keybinding "${accelerator}" of "${commandId}": not a valid accelerator`)
      return null
    }
    const binding: Binding = { commandId, accelerator, parsed, run, blockedBy: null }
    this.bindings.push(binding)
    this.evaluate()
    return {
      dispose: () => {
        const index = this.bindings.indexOf(binding)
        if (index === -1) return
        this.bindings.splice(index, 1)
        this.evaluate()
      }
    }
  }

  /** Whether the binding of `commandId` currently handles key presses. */
  isActive(commandId: string): boolean {
    return this.bindings.some((b) => b.commandId === commandId && !b.blockedBy)
  }

  dispose(): void {
    this.target.removeEventListener('keydown', this.onKeyDown as EventListener)
    this.bindings.length = 0
  }

  private evaluate(): void {
    this.bindings.forEach((binding, index) => {
      let blockedBy: string | null = null
      if (this.appAccelerators.some((acc) => sameKeys(acc, binding.parsed))) {
        blockedBy = 'an app shortcut'
      } else {
        const earlier = this.bindings
          .slice(0, index)
          .find((other) => !other.blockedBy && sameKeys(other.parsed, binding.parsed))
        if (earlier) blockedBy = `"${earlier.commandId}"`
      }
      if (blockedBy && blockedBy !== binding.blockedBy) {
        this.log(`Ignoring keybinding "${binding.accelerator}" of "${binding.commandId}": it collides with ${blockedBy}`)
      }
      binding.blockedBy = blockedBy
    })
  }
}
