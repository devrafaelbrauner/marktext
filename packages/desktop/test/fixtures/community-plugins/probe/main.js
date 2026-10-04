const slot = globalThis
slot.__MT_PLUGIN_DEFINITION__ = {
  kind: 'background',
  async start(_init, port) {
    port.start()
    const call = (method, payload) => new Promise((resolve, reject) => {
      const id = Math.floor(Math.random() * 1e9)
      const onMessage = (event) => {
        const data = event.data
        if (!data || data.id !== id) return
        port.removeEventListener('message', onMessage)
        if (data.ok) resolve(data.value)
        else reject(data.error || { code: 'FAILED', message: 'failed' })
      }
      port.addEventListener('message', onMessage)
      port.postMessage({ id, method, args: payload === undefined ? [] : [payload] })
    })
    const attempt = async(fn) => {
      try {
        return await fn()
      } catch (err) {
        // DOM cross-origin denials carry a numeric code (SecurityError = 18);
        // only a string code is a host RPC rejection worth reporting as-is.
        return err && typeof err.code === 'string' ? err.code : 'throw'
      }
    }
    const report = {
      electron: typeof window.electron !== 'undefined',
      parentDocument: await attempt(() => window.parent.document.title),
      hostDom: await attempt(() => window.parent.document.querySelector('#app')),
      fetch: await Promise.race([
        attempt(async () => {
          const response = await fetch('https://example.com/')
          return 'ok:' + response.status
        }),
        new Promise((resolve) => setTimeout(() => resolve('timeout'), 2000))
      ]),
      netFetch: await attempt(() => call('net.fetch', { url: 'https://example.com/' })),
      editorRead: await attempt(() => call('editor.getMarkdown'))
    }
    await call('notify', { message: JSON.stringify(report), type: 'info', timeout: 20000 })
    port.postMessage({ event: 'activated', payload: {} })
  }
}
