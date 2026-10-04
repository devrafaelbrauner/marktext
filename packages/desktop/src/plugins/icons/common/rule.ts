import type { InlineSyntaxRule } from '@/plugins/types'
import type { IconPack } from './pack'
import { matchIconShortcode } from './shortcode'
import { renderExportSvg } from './svg'

/** How icon shortcodes are written in HTML/PDF exports (plugin setting `exportMode`). */
export type IconExportMode = 'svg' | 'shortcode'

export interface IconSyntaxOptions {
  /** Read at export time, so a settings change applies to the next export. */
  getExportMode(): IconExportMode
  /** Called with each icon name the rule matches (tokens about to be rendered). */
  onMatch?(name: string): void
}

/**
 * The `icon` inline syntax for the shortcodes of `pack`: matches known icons
 * only (unknown shortcodes stay emoji candidates) and exports them as inline
 * SVG, or as the shortcode text in 'shortcode' mode.
 */
export const createIconSyntaxRule = (pack: IconPack, options: IconSyntaxOptions): InlineSyntaxRule => ({
  name: 'icon',
  precedence: 'beforeEmoji',
  noSpellcheck: true,
  match: (src, prevChar) => {
    const match = matchIconShortcode(src, prevChar, pack.prefix, (name) => !!pack.get(name))
    if (match) options.onMatch?.(match.data.icon)
    return match
  },
  exportHtml: (raw, data) => {
    const icon = pack.get(data.icon)
    // `raw` matched `:[a-z0-9]+-[a-z0-9-]+:`, so it needs no escaping.
    return icon && options.getExportMode() === 'svg' ? renderExportSvg(icon.nodes) : raw
  }
})
