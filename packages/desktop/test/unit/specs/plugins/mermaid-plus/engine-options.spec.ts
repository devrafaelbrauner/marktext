import { describe, expect, it, vi } from 'vitest'
import { EngineHost, type EngineInstance } from '@/plugins/host/engine'
import { mermaidEngineOptions } from '@plugins/mermaid-plus/common/options'

const createHost = () => {
  const host = new EngineHost({
    getActiveTabId: () => null,
    isMac: false,
    registries: {
      registerInlineSyntax: () => () => {},
      registerCodeBlockRenderer: () => () => {},
      registerCompletionProvider: () => () => {}
    }
  })
  const setOptions = vi.fn()
  const muya = { on: vi.fn(), off: vi.fn(), setOptions } as unknown as EngineInstance
  host.attach(muya)
  return { host, setOptions }
}

describe('mermaid-plus settings → engine request', () => {
  it('leaves the theme to the app for auto and unknown values', () => {
    expect(mermaidEngineOptions('auto', 'classic')).toEqual({ look: 'classic' })
    expect(mermaidEngineOptions('sepia', 'sketch')).toEqual({ look: 'classic' })
  })

  it('passes an explicit theme and the hand-drawn look', () => {
    expect(mermaidEngineOptions('forest', 'handDrawn')).toEqual({ theme: 'forest', look: 'handDrawn' })
  })
})

describe('engine host mermaid option', () => {
  it('maps to the muya options and restores app behaviour when the request ends', () => {
    const { host, setOptions } = createHost()
    expect(setOptions).toHaveBeenLastCalledWith({ atxHeadingRequiresSpace: false, mermaidThemeOverride: null, mermaidLook: 'classic' })

    const request = host.requestEngineOptions({ mermaid: { theme: 'neutral', look: 'handDrawn' } })
    expect(setOptions).toHaveBeenLastCalledWith({ atxHeadingRequiresSpace: false, mermaidThemeOverride: 'neutral', mermaidLook: 'handDrawn' })

    request.dispose()
    expect(setOptions).toHaveBeenLastCalledWith({ atxHeadingRequiresSpace: false, mermaidThemeOverride: null, mermaidLook: 'classic' })
  })

  it('lets the latest active request win and keeps OR-ing the switches', () => {
    const { host, setOptions } = createHost()
    const first = host.requestEngineOptions({ mermaid: { theme: 'dark' } })
    const second = host.requestEngineOptions({ atxHeadingRequiresSpace: true, mermaid: { look: 'handDrawn' } })
    host.requestEngineOptions({ atxHeadingRequiresSpace: false })
    expect(host.getEngineOptions()).toEqual({ atxHeadingRequiresSpace: true, disableNativeSpellcheck: false, mermaid: { look: 'handDrawn' } })
    expect(setOptions).toHaveBeenLastCalledWith({ atxHeadingRequiresSpace: true, mermaidThemeOverride: null, mermaidLook: 'handDrawn' })

    second.dispose()
    expect(host.getEngineOptions()).toEqual({ atxHeadingRequiresSpace: false, disableNativeSpellcheck: false, mermaid: { theme: 'dark' } })
    expect(setOptions).toHaveBeenLastCalledWith({ atxHeadingRequiresSpace: false, mermaidThemeOverride: 'dark', mermaidLook: 'classic' })
    first.dispose()
    expect(host.getEngineOptions()).toEqual({ atxHeadingRequiresSpace: false, disableNativeSpellcheck: false })
  })
})
