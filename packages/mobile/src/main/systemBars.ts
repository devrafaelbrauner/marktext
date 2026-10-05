// Status and navigation bars in the editor theme's colour. The WebView sits
// between the bars (index.html has no `viewport-fit=cover`, so Capacitor pads
// it and the desktop layout's fixed title bar stays below the status bar);
// the padding shows the window background, which is painted here.

import { Capacitor, registerPlugin } from '@capacitor/core'

interface MtSystemBarsPlugin {
  apply(options: { color: string; dark: boolean }): Promise<void>
}

const MtSystemBars = registerPlugin<MtSystemBarsPlugin>('MtSystemBars')

/** `#rrggbb` and whether light icons are needed, for any CSS colour; `null` if unparsable. */
export function barsFor(cssColor: string, probe: HTMLElement): { color: string; dark: boolean } | null {
  probe.style.color = ''
  probe.style.color = cssColor.trim()
  if (!probe.style.color) return null
  const match = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(getComputedStyle(probe).color)
  if (!match) return null
  const [r, g, b] = match.slice(1, 4).map(Number) as [number, number, number]
  const hex = `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
  // Rec. 709 luma: below the midpoint, dark icons would vanish.
  return { color: hex, dark: 0.2126 * r + 0.7152 * g + 0.0722 * b < 128 }
}

export function registerSystemBars(): void {
  if (!Capacitor.isNativePlatform()) return
  const probe = document.createElement('span')
  probe.style.display = 'none'
  let applied = ''
  let frame: number | null = null

  const apply = (force: boolean): void => {
    if (frame !== null) return
    frame = requestAnimationFrame(() => {
      frame = null
      if (!probe.isConnected) document.body.append(probe)
      const bars = barsFor(getComputedStyle(document.documentElement).getPropertyValue('--editorBgColor'), probe)
      if (!bars) return
      const key = `${bars.color}/${bars.dark}`
      if (key === applied && !force) return
      applied = key
      MtSystemBars.apply(bars).catch((error: unknown) => console.error('[system-bars]', error))
    })
  }

  // Themes are a <style> the renderer rewrites (util/theme.ts addThemeStyle).
  new MutationObserver(() => apply(false)).observe(document.head, {
    childList: true,
    subtree: true,
    characterData: true
  })
  // A configuration change (rotation, system dark mode) makes Capacitor reset
  // the window background; it also resizes the WebView.
  window.addEventListener('resize', () => apply(true))
  apply(true)
}
