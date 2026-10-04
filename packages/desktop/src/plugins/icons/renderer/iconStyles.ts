import type { IconPack } from '../common/pack'
import { ICON_BASE_CSS, iconCssRule, iconMaskUri } from '../common/svg'

/**
 * Owns the `<style>` element that draws icon tokens: the shared base rule plus
 * one mask rule per icon currently shown. The engine renders tokens as plain
 * text (`span.mu-inline-icon[data-icon]`), so this sheet is the only place
 * icon pictures come from. Mask URIs are cached per icon for the window's
 * lifetime; the element itself is removed by `dispose()`.
 */
export class IconStyleSheet {
  private readonly element: HTMLStyleElement
  private readonly names = new Set<string>()
  private readonly maskUris = new Map<string, string>()
  private pack: IconPack | null = null
  private flushQueued = false
  private css = ''

  constructor(doc: Document) {
    this.element = doc.createElement('style')
    this.element.dataset.plugin = 'icons'
    doc.head.appendChild(this.element)
  }

  setPack(pack: IconPack): void {
    this.pack = pack
    this.queueFlush()
  }

  /** Adds an icon now on screen (e.g. reported by the inline rule while rendering). */
  add(name: string): void {
    if (this.names.has(name)) return
    this.names.add(name)
    this.queueFlush()
  }

  /** Replaces the icon set, e.g. with the icons of a newly loaded document. */
  replace(names: Iterable<string>): void {
    this.names.clear()
    for (const name of names) this.names.add(name)
    this.queueFlush()
  }

  /** Mask image URI of `name`, or null when the icon is unknown or the pack is not loaded. */
  maskUri(name: string): string | null {
    const cached = this.maskUris.get(name)
    if (cached) return cached
    const icon = this.pack?.get(name)
    if (!icon) return null
    const uri = iconMaskUri(icon.nodes)
    this.maskUris.set(name, uri)
    return uri
  }

  dispose(): void {
    this.element.remove()
    this.names.clear()
  }

  // Batches the rule rebuilds of one render pass (the inline rule reports
  // icons token by token) into one stylesheet write.
  private queueFlush(): void {
    if (this.flushQueued) return
    this.flushQueued = true
    queueMicrotask(() => {
      this.flushQueued = false
      this.flush()
    })
  }

  private flush(): void {
    if (!this.element.isConnected) return
    const rules = [ICON_BASE_CSS]
    for (const name of [...this.names].sort()) {
      const uri = this.maskUri(name)
      if (uri) rules.push(iconCssRule(name, uri))
    }
    const css = rules.join('\n')
    if (css !== this.css) {
      this.css = css
      this.element.textContent = css
    }
  }
}
