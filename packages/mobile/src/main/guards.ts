// Type guards for values the Android main side receives untyped: IPC payloads
// and JSON read back from app-private storage.

/** A plain JSON object; its fields stay `unknown` until checked one by one. */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
