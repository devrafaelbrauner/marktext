import { describe, expect, it } from 'vitest'
import { createLazyValue } from '@plugins/icons/common/loader'

describe('createLazyValue', () => {
  it('calls the factory once, shares it between concurrent loads and caches the value', async() => {
    let calls = 0
    const lazy = createLazyValue(async() => {
      calls++
      return { icons: calls }
    })
    expect(lazy.get()).toBeNull()
    expect(calls).toBe(0)

    const [a, b] = await Promise.all([lazy.load(), lazy.load()])
    expect(a).toBe(b)
    expect(await lazy.load()).toBe(a)
    expect(lazy.get()).toBe(a)
    expect(calls).toBe(1)
  })

  it('does not cache a failure, so the next load retries', async() => {
    let calls = 0
    const lazy = createLazyValue(async() => {
      calls++
      if (calls === 1) throw new Error('chunk failed')
      return 'pack'
    })
    await expect(lazy.load()).rejects.toThrow('chunk failed')
    expect(lazy.get()).toBeNull()
    expect(await lazy.load()).toBe('pack')
    expect(calls).toBe(2)
  })
})
