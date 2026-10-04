/**
 * Waits for a community plugin to signal activation. A late `activate()`
 * after the timeout returns false so the host does not start a plugin it
 * has already disabled.
 */

/** DOM timer id from `setTimeout`; the renderer always runs in the DOM. */
export type ActivationTimer = number

export type ScheduleActivationTimer = (fn: () => void, ms: number) => ActivationTimer
export type CancelActivationTimer = (timer: ActivationTimer) => void

export class ActivationWatch {
  private timer: ActivationTimer | null = null
  private settled = false

  constructor(
    private readonly timeoutMs: number,
    private readonly onTimeout: () => void,
    // DI seam for the unit spec. The defaults wrap the globals in arrows
    // because a bare `setTimeout` reference throws `Illegal invocation`
    // when called unbound in the renderer. `window.` keeps the DOM overload
    // (number) instead of the Node overload (Timeout).
    private readonly schedule: ScheduleActivationTimer = (fn, ms) => window.setTimeout(fn, ms),
    private readonly cancelTimer: CancelActivationTimer = (timer) => window.clearTimeout(timer)
  ) {}

  arm(): void {
    if (this.settled) return
    const timer = this.schedule(() => {
      if (this.settled) return
      this.settled = true
      this.timer = null
      this.onTimeout()
    }, this.timeoutMs)
    this.timer = timer
  }

  /** True only for the first successful activation before timeout or cancel. */
  activate(): boolean {
    if (this.settled) return false
    this.settled = true
    const timer = this.timer
    if (timer !== null) this.cancelTimer(timer)
    this.timer = null
    return true
  }

  cancel(): void {
    this.settled = true
    const timer = this.timer
    if (timer !== null) this.cancelTimer(timer)
    this.timer = null
  }

  get done(): boolean {
    return this.settled
  }
}
