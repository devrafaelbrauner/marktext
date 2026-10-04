// Entry of the vault index utility process (built as `vaultIndexWorker.js`
// next to the main bundle and forked by VaultIndexManager). One process
// serves one vault root.
import type { MainToWorkerMessage } from '../types'
import { createIndexWorkerRuntime } from './runtime'

// Built-in plugins add request handlers (registerWorkerHandler) from
// `src/plugins/<id>/worker/index.ts`; importing the modules registers them.
import.meta.glob('../../../plugins/*/worker/index.ts', { eager: true })

const port = process.parentPort
const runtime = createIndexWorkerRuntime((message) => port.postMessage(message), {
  onDisposed: () => process.exit(0)
})
port.on('message', (event) => runtime.handle(event.data as MainToWorkerMessage))
