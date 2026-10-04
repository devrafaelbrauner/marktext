/**
 * A value produced once by an async factory (typically a dynamic `import()`)
 * and then kept in memory. Concurrent `load()` calls share one factory call;
 * a failed load is not cached, so the next `load()` tries again.
 */
export interface LazyValue<T> {
  /** The loaded value, or null while it has not finished loading. */
  get(): T | null
  load(): Promise<T>
}

export const createLazyValue = <T>(factory: () => Promise<T>): LazyValue<T> => {
  let value: T | null = null
  let pending: Promise<T> | null = null
  return {
    get: () => value,
    load: () => {
      if (value !== null) return Promise.resolve(value)
      pending ??= factory().then(
        (loaded) => {
          value = loaded
          return loaded
        },
        (err: unknown) => {
          pending = null
          throw err
        }
      )
      return pending
    }
  }
}
