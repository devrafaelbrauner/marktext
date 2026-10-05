// Keeps packages/mobile/BRIDGE.md honest: every channel of the IPC contract
// has exactly one row, and a row says "Implementado" or "Sem efeito" exactly
// when the booted Android main side registers a handler for it.

import { readFileSync } from 'fs'
import { resolve } from 'path'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { registeredInvokeChannels, registeredSendChannels, registeredSyncChannels } from '../src/main/ipc'

const BRIDGE = readFileSync(resolve(__dirname, '../BRIDGE.md'), 'utf8')
const CONTRACT = readFileSync(resolve(__dirname, '../../desktop/src/shared/types/ipc.ts'), 'utf8')

type Kind = 'invoke' | 'send' | 'sync'
const STATUSES = ['Implementado', 'Sem efeito no Android', 'Não suportado'] as const

function contractChannels(name: string): string[] {
  const start = CONTRACT.indexOf(`export interface ${name} {`)
  const body = CONTRACT.slice(start, CONTRACT.indexOf('\n}\n', start))
  return [...body.matchAll(/^ {2}'([^']+)':/gm)].map((match) => match[1] as string)
}

interface Row {
  channel: string
  kind: Kind
  status: string
}

// `| \`channel\` | invoke | Implementado | note |`
const ROWS: Row[] = [...BRIDGE.matchAll(/^\| `([^`]+)` \| (invoke|send|sync) \| ([^|]+?) \|/gm)].map((match) => ({
  channel: match[1] as string,
  kind: match[2] as Kind,
  status: (match[3] as string).trim()
}))

const key = (kind: Kind, channel: string): string => `${kind} ${channel}`

beforeAll(async() => {
  // The boot reads build-time constants and browser APIs jsdom lacks; it is
  // imported after stubbing them, as the web build evaluates it.
  vi.stubGlobal('MARKTEXT_VERSION', '0.0.0-test')
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {} }))
  await import('../src/main/index')
})

describe('BRIDGE.md', () => {
  it('lists every IPC contract channel exactly once', () => {
    const expected = [
      ...contractChannels('IpcInvokeChannels').map((channel) => key('invoke', channel)),
      ...contractChannels('IpcSendChannels').map((channel) => key('send', channel)),
      ...contractChannels('IpcSyncChannels').map((channel) => key('sync', channel))
    ].sort()
    expect(expected.length).toBeGreaterThan(150)
    expect(ROWS.map((row) => key(row.kind, row.channel)).sort()).toEqual(expected)
  })

  it('uses only the documented statuses', () => {
    expect(ROWS.filter((row) => !(STATUSES as readonly string[]).includes(row.status))).toEqual([])
  })

  it('marks a channel handled exactly when a handler is registered after boot', () => {
    const registered = [
      ...registeredInvokeChannels().map((channel) => key('invoke', channel)),
      ...registeredSendChannels().map((channel) => key('send', channel)),
      ...registeredSyncChannels().map((channel) => key('sync', channel))
    ].sort()
    const documented = ROWS.filter((row) => row.status !== 'Não suportado')
      .map((row) => key(row.kind, row.channel))
      .sort()
    expect(documented).toEqual(registered)
  })

  it('covers the 15 globals of the desktop preload', () => {
    const preload = readFileSync(resolve(__dirname, '../../desktop/src/preload/index.ts'), 'utf8')
    const globals = [...preload.matchAll(/exposeInMainWorld\('([^']+)'/g)].map((match) => match[1] as string)
    expect(globals).toHaveLength(15)
    for (const name of globals) expect(BRIDGE).toMatch(new RegExp(`^\\| \`window\\.${name}\` \\|`, 'm'))
  })
})
