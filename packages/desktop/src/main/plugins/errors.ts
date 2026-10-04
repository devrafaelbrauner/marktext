import type { PluginIpcResult } from '@shared/types/ipc'
import type { PluginErrorShape } from '@/plugins/types'

export type PluginErrorCode = PluginErrorShape['code']

/** Error carrying a `PluginErrorShape` code; converted to a `PluginIpcResult` at the IPC boundary. */
export class PluginError extends Error {
  constructor(
    readonly code: PluginErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'PluginError'
  }
}

/**
 * Runs `task` and folds its outcome into the serializable result sent over
 * IPC. Rejections that are not a `PluginError` become 'FAILED' with their
 * message: Electron would otherwise drop everything but the message text.
 */
export const toIpcResult = async<T>(task: () => Promise<T> | T): Promise<PluginIpcResult<T>> => {
  try {
    return { ok: true, value: await task() }
  } catch (err) {
    if (err instanceof PluginError) {
      return { ok: false, error: { code: err.code, message: err.message } }
    }
    return { ok: false, error: { code: 'FAILED', message: err instanceof Error ? err.message : String(err) } }
  }
}
