/**
 * Host documents served at `<origin>/__mt/bootstrap.{html,js}` for a
 * community plugin's background frame. `origin` is `mt-plugin://<id>` on
 * desktop and `https://<id>.plugin.local` on Android.
 */

export const renderBootstrapHtml = (origin: string): string => `<!doctype html>
<html>
<head><meta charset="utf-8"></head>
<body>
<script type="module" src="${origin}/__mt/bootstrap.js"></script>
</body>
</html>
`

/**
 * Host bootstrap. It imports the plugin `main` (which must call
 * `definePlugin`) and only then consumes the init message, so a slow import
 * cannot miss the MessagePort. `hello` lets the host post that message
 * without waiting for the iframe `load` event (which waits on this module).
 */
export const renderBootstrapScript = (id: string, main: string): string => {
  const mainLiteral = JSON.stringify(main)
  const idLiteral = JSON.stringify(id)
  return `const MAIN = ${mainLiteral}
const ID = ${idLiteral}
const waitInit = () => new Promise((resolve) => {
  const onMessage = (event) => {
    if (event.source !== window.parent) return
    const data = event.data
    if (!data || data.type !== 'mt-plugin:init' || data.protocol !== 1) return
    const port = event.ports && event.ports[0]
    if (!port) return
    window.removeEventListener('message', onMessage)
    resolve({ data, port })
  }
  window.addEventListener('message', onMessage)
})
const initPromise = waitInit()
window.parent.postMessage({ type: 'mt-plugin:hello', role: 'background', id: ID }, '*')
try {
  const root = new URL('/', import.meta.url)
  await import(new URL(MAIN, root).href)
} catch (err) {
  const message = err instanceof Error ? err.message : String(err)
  window.parent.postMessage({ type: 'mt-plugin:crash', id: ID, message }, '*')
  throw err
}
const pending = globalThis.__MT_PLUGIN_DEFINITION__
if (!pending || pending.kind !== 'background' || typeof pending.start !== 'function') {
  window.parent.postMessage({ type: 'mt-plugin:crash', id: ID, message: 'Plugin main did not call definePlugin' }, '*')
  throw new Error('definePlugin was not called')
}
try {
  const init = await initPromise
  await pending.start(init.data, init.port)
} catch (err) {
  const message = err instanceof Error ? err.message : String(err)
  window.parent.postMessage({ type: 'mt-plugin:crash', id: ID, message }, '*')
}
`
}
