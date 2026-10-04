// Runs Dataview queries inside the vault index worker, next to the index, so
// the renderer only receives the (capped) result.
import { registerWorkerHandler } from '../../../main/vaultIndex/worker/handlers'
import { runQuery } from '../common/engine'
import { QUERY_REQUEST, type DataviewQueryRequest } from '../common/protocol'

const isRequest = (payload: unknown): payload is DataviewQueryRequest => {
  if (payload === null || typeof payload !== 'object') return false
  const { query, originPath } = payload as Record<string, unknown>
  return typeof query === 'string' && (originPath === null || typeof originPath === 'string')
}

registerWorkerHandler(QUERY_REQUEST, (payload, { index }) => {
  if (!isRequest(payload)) throw new Error(`${QUERY_REQUEST}: invalid payload`)
  return runQuery(payload.query, payload.originPath, index)
})
