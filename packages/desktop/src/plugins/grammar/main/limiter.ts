export interface Clock {
  now(): number
  sleep(ms: number): Promise<void>
}

export const SYSTEM_CLOCK: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms))
}

const MINUTE_MS = 60_000

/** Token bucket refilled continuously at `capacity` tokens per minute; starts full. */
class Bucket {
  private tokens: number
  private updatedAt: number

  constructor(
    readonly capacity: number,
    now: number
  ) {
    this.tokens = capacity
    this.updatedAt = now
  }

  refill(now: number): void {
    const elapsed = Math.max(0, now - this.updatedAt)
    this.tokens = Math.min(this.capacity, this.tokens + (elapsed * this.capacity) / MINUTE_MS)
    this.updatedAt = now
  }

  /** Ms until `amount` tokens are available (0 when they already are). */
  waitFor(amount: number): number {
    const missing = amount - this.tokens
    return missing <= 0 ? 0 : Math.ceil((missing * MINUTE_MS) / this.capacity)
  }

  take(amount: number): void {
    this.tokens -= amount
  }

  drain(): void {
    this.tokens = 0
  }
}

/**
 * Per-minute limits on requests and characters, shared by every window.
 * `acquire` resolves once both budgets allow the request; callers are served
 * in FIFO order so a large request is not starved by small ones.
 */
export class RateLimiter {
  private readonly requests: Bucket
  private readonly chars: Bucket
  private queue: Promise<void> = Promise.resolve()

  constructor(
    limits: { requestsPerMinute: number; charsPerMinute: number },
    private readonly clock: Clock = SYSTEM_CLOCK
  ) {
    const now = clock.now()
    this.requests = new Bucket(limits.requestsPerMinute, now)
    this.chars = new Bucket(limits.charsPerMinute, now)
  }

  /** Waits for one request slot and `chars` characters, then consumes them. */
  acquire(chars: number): Promise<void> {
    const amount = Math.min(chars, this.chars.capacity)
    const turn = this.queue.then(async() => {
      for (;;) {
        const now = this.clock.now()
        this.requests.refill(now)
        this.chars.refill(now)
        const wait = Math.max(this.requests.waitFor(1), this.chars.waitFor(amount))
        if (wait === 0) break
        await this.clock.sleep(wait)
      }
      this.requests.take(1)
      this.chars.take(amount)
    })
    this.queue = turn.catch(() => {})
    return turn
  }

  /** Empties both budgets, e.g. after the server answered 429, so the next requests wait for a refill. */
  drain(): void {
    const now = this.clock.now()
    this.requests.refill(now)
    this.chars.refill(now)
    this.requests.drain()
    this.chars.drain()
  }
}
