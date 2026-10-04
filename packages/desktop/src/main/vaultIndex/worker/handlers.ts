import type { Disposable } from '@shared/plugins/types'
import type { VaultIndexReader } from '../types'

export interface WorkerHandlerContext {
  /** The in-memory index of the vault the request came from. */
  readonly index: VaultIndexReader
}

/**
 * Answers `MetadataApi.request(type, payload)` inside the index worker. The
 * payload arrives exactly as sent (structured clone) and must be validated;
 * the (awaited) return value must be structured-cloneable. A throw rejects
 * the renderer's promise with the error message.
 */
export type WorkerHandler = (payload: unknown, context: WorkerHandlerContext) => unknown

const handlers = new Map<string, WorkerHandler>()

/**
 * Registers the handler for request `type` in this worker process. Types are
 * global to the worker, so plugins prefix them with their id
 * (`dataview.query`). Throws when `type` is empty or already registered.
 * Modules calling this are loaded by the worker entry from
 * `src/plugins/<id>/worker/index.ts`.
 */
export const registerWorkerHandler = (type: string, handler: WorkerHandler): Disposable => {
  if (!type) throw new Error('Vault index handler type must be a non-empty string')
  if (handlers.has(type)) throw new Error(`Vault index handler "${type}" is already registered`)
  handlers.set(type, handler)
  return {
    dispose() {
      if (handlers.get(type) === handler) handlers.delete(type)
    }
  }
}

/** Runs the handler registered for `type`; rejects when there is none. */
export const dispatchWorkerRequest = async(
  type: string,
  payload: unknown,
  context: WorkerHandlerContext
): Promise<unknown> => {
  const handler = handlers.get(type)
  if (!handler) throw new Error(`No vault index handler registered for "${type}"`)
  return await handler(payload, context)
}
