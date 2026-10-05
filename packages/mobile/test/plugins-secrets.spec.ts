import { describe, expect, it } from 'vitest'
import { CachedPluginSecrets, channelSecretsBackend, type SecretsChannel } from '../src/main/plugins/secrets'

/** Stand-in for MtSecretsPlugin's message listener: replies later, in any order. */
const fakeNative = () => {
  const stored = new Map<string, string>()
  const sent: string[] = []
  let listener: ((event: { data: unknown }) => void) | null = null
  const channel: SecretsChannel = {
    postMessage(message) {
      sent.push(message)
      const { id, op, namespace, key, value } = JSON.parse(message)
      const slot = `${namespace}/${key}`
      let reply: Record<string, unknown> = { id, ok: true }
      if (op === 'list') {
        const namespaces: Record<string, string[]> = {}
        for (const name of stored.keys()) {
          const [ns, k] = name.split('/')
          ;(namespaces[ns] ??= []).push(k)
        }
        reply.namespaces = namespaces
      } else if (op === 'get') reply.value = stored.get(slot) ?? null
      else if (op === 'set' && typeof value === 'string') stored.set(slot, value)
      else if (op === 'delete') stored.delete(slot)
      else reply = { id, ok: false, error: 'value must be a string' }
      setTimeout(() => listener?.({ data: JSON.stringify(reply) }), op === 'get' ? 5 : 0)
    },
    addEventListener(_type, next) {
      listener = next
    }
  }
  return { channel, stored, sent }
}

describe('Keystore secrets channel', () => {
  it('round-trips values and keeps has() in step without reading values', async() => {
    const native = fakeNative()
    native.stored.set('ai/apiKey', 'sk-or-existing')
    const secrets = await CachedPluginSecrets.load(channelSecretsBackend(native.channel))
    expect(secrets.has('ai', 'apiKey')).toBe(true)
    expect(native.sent.map((message) => JSON.parse(message).op)).toEqual(['list'])

    const [slow, fast] = await Promise.all([secrets.get('ai', 'apiKey'), secrets.set('grammar', 'apiKey', 'lt-key')])
    expect(slow).toBe('sk-or-existing')
    expect(fast).toBeUndefined()
    expect(secrets.has('grammar', 'apiKey')).toBe(true)
    expect(await secrets.get('grammar', 'apiKey')).toBe('lt-key')

    await secrets.delete('grammar', 'apiKey')
    expect(secrets.has('grammar', 'apiKey')).toBe(false)
    expect(await secrets.get('grammar', 'apiKey')).toBeNull()
  })

  it('surfaces native failures and leaves the key set unchanged', async() => {
    const native = fakeNative()
    const backend = channelSecretsBackend(native.channel)
    // Drops the value from the request (as a malformed caller would) so the native side rejects it.
    const secrets = await CachedPluginSecrets.load({ ...backend, set: (ns, key) => backend.set(ns, key, undefined as unknown as string) })
    await expect(secrets.set('grammar', 'apiKey', 'x')).rejects.toThrow('value must be a string')
    expect(secrets.has('grammar', 'apiKey')).toBe(false)
  })
})
