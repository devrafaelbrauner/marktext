import type { PluginIpcResult } from '@shared/types/ipc'
import type { PluginErrorShape } from '../types'

/** Rejection of vault and plugin IPC calls; satisfies `PluginErrorShape`. */
export class PluginError extends Error implements PluginErrorShape {
  constructor(
    readonly code: PluginErrorShape['code'],
    message: string
  ) {
    super(message)
    this.name = 'PluginError'
  }
}

/** Value of a successful reply; throws `PluginError` with the reply's code otherwise. */
export const unwrapIpcResult = <T>(result: PluginIpcResult<T>): T => {
  if (result.ok) return result.value
  throw new PluginError(result.error.code, result.error.message)
}
