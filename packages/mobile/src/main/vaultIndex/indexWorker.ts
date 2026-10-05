// Entry of the vault index Web Worker (spawned by host.ts, one per open
// folder). The Android counterpart of desktop's utility-process entry
// (desktop main/vaultIndex/worker/entry.ts).
import type { HostToWorkerMessage, WorkerToHostMessage } from './protocol'
import { createIndexWorker } from './worker'

// Built-in plugins add request handlers (registerWorkerHandler) from
// `src/plugins/<id>/worker/index.ts`; importing the modules registers them.
import.meta.glob('../../../../desktop/src/plugins/*/worker/index.ts', { eager: true })

// The package compiles against the DOM lib, which types `self` as Window.
const scope = self as unknown as {
  postMessage(message: WorkerToHostMessage): void
  onmessage: ((event: MessageEvent<HostToWorkerMessage>) => void) | null
}
const worker = createIndexWorker((message) => scope.postMessage(message))
scope.onmessage = (event) => worker.handle(event.data)
