import type { IconNode } from './pack'

// Only the geometry Lucide uses: anything else in icon data (scripts,
// event handlers, links, styles) is dropped when building markup.
const ALLOWED_ELEMENTS = new Set(['circle', 'ellipse', 'line', 'path', 'polygon', 'polyline', 'rect'])
const ALLOWED_ATTRIBUTES = new Set([
  'cx', 'cy', 'd', 'fill', 'height', 'points', 'r', 'rx', 'ry', 'width', 'x', 'x1', 'x2', 'y', 'y1', 'y2'
])
// Path data, numbers, lengths and plain colour keywords (`none`, `currentColor`).
const SAFE_VALUE_RE = /^[a-zA-Z0-9.,\s%-]*$/

/** Attributes Lucide puts on its root `<svg>`. */
const ROOT_ATTRIBUTES: Record<string, string> = {
  xmlns: 'http://www.w3.org/2000/svg',
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': '2',
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round'
}

const serializeAttributes = (attrs: Record<string, string>): string =>
  Object.entries(attrs)
    .map(([key, value]) => {
      const escaped = value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      return ` ${key}="${escaped}"`
    })
    .join('')

/**
 * Serializes an icon as a standalone `<svg>` element. Child elements and
 * attributes outside Lucide's geometry vocabulary, and attribute values that
 * are not plain numbers/path data/keywords, are dropped, so the result is
 * safe to inline even if the icon data were tampered with. `rootAttrs`
 * override or extend the default root attributes (`stroke: currentColor`, …).
 */
export const renderIconSvg = (nodes: readonly IconNode[], rootAttrs: Record<string, string> = {}): string => {
  const children = nodes
    .filter(([tag]) => ALLOWED_ELEMENTS.has(tag))
    .map(([tag, attrs]) => {
      const safe: Record<string, string> = {}
      for (const [key, value] of Object.entries(attrs)) {
        if (ALLOWED_ATTRIBUTES.has(key) && SAFE_VALUE_RE.test(value)) safe[key] = value
      }
      return `<${tag}${serializeAttributes(safe)}/>`
    })
    .join('')
  return `<svg${serializeAttributes({ ...ROOT_ATTRIBUTES, ...rootAttrs })}>${children}</svg>`
}

/**
 * Inline SVG used in HTML/PDF exports: 1em square, coloured by the
 * surrounding text and hidden from assistive technology.
 */
export const renderExportSvg = (nodes: readonly IconNode[]): string =>
  renderIconSvg(nodes, {
    width: '1em',
    height: '1em',
    class: 'mt-icon',
    'aria-hidden': 'true',
    style: 'vertical-align:-0.125em'
  })

/**
 * `data:` URI of `svg` for use inside a double-quoted CSS `url("…")`. Uses
 * percent-encoding only where needed (quotes become apostrophes), which keeps
 * it about a third smaller than base64.
 */
export const svgToDataUri = (svg: string): string => {
  const compact = svg.replace(/\s+/g, ' ').replace(/"/g, '\'')
  return `data:image/svg+xml,${compact.replace(/[\r\n%#()<>?[\\\]^`{|}]/g, encodeURIComponent)}`
}

/**
 * Mask image of an icon: drawn opaque on a transparent background, so the
 * masked element shows its `background-color` (the text colour) in the
 * icon's shape.
 */
export const iconMaskUri = (nodes: readonly IconNode[]): string =>
  svgToDataUri(renderIconSvg(nodes, { stroke: 'black' }))

/** Class the engine gives the inline token of the `icon` syntax. */
export const ICON_TOKEN_CLASS = 'mu-inline-icon'

/** Rules shared by every icon token: an inline 1em box painted with the text colour through the icon mask. */
export const ICON_BASE_CSS = `.${ICON_TOKEN_CLASS}::before {
  content: '';
  display: inline-block;
  width: 1em;
  height: 1em;
  vertical-align: -0.125em;
  background-color: currentColor;
  mask-repeat: no-repeat;
  mask-position: center;
  mask-size: 100% 100%;
}`

/** CSS rule drawing icon `name` (a validated kebab-case name) on its tokens. */
export const iconCssRule = (name: string, maskUri: string): string =>
  `.${ICON_TOKEN_CLASS}[data-icon="${name}"]::before { mask-image: url("${maskUri}"); }`
