import { afterEach, describe, expect, it } from 'vitest'
import { createIconPack, type IconNode } from '@plugins/icons/common/pack'
import {
  ICON_BASE_CSS,
  iconCssRule,
  iconMaskUri,
  renderExportSvg,
  renderIconSvg,
  svgToDataUri
} from '@plugins/icons/common/svg'
import { IconStyleSheet } from '@plugins/icons/renderer/iconStyles'

const HOUSE: IconNode[] = [
  ['path', { d: 'M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8' }],
  ['circle', { cx: '12', cy: '12', r: '3', fill: 'currentColor' }]
]

const parseSvg = (markup: string): SVGSVGElement => {
  const doc = new DOMParser().parseFromString(markup, 'image/svg+xml')
  expect(doc.querySelector('parsererror')).toBeNull()
  return doc.documentElement as unknown as SVGSVGElement
}

// The sheet batches writes in a microtask queued before this one resolves.
const flush = (): Promise<void> => Promise.resolve()

describe('renderIconSvg', () => {
  it('serializes Lucide geometry with the stroke style of the set', () => {
    const svg = parseSvg(renderIconSvg(HOUSE))
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24')
    expect(svg.getAttribute('stroke')).toBe('currentColor')
    expect(svg.getAttribute('fill')).toBe('none')
    expect([...svg.children].map((child) => child.tagName)).toEqual(['path', 'circle'])
    expect(svg.children[1].getAttribute('fill')).toBe('currentColor')
  })

  it('drops foreign elements, attributes and unsafe values and escapes the rest', () => {
    const hostile: IconNode[] = [
      ['script', { src: 'x.js' }],
      ['foreignObject', { width: '10' }],
      ['image', { href: 'https://evil.test/x.png' }],
      ['path', { d: 'M0 0h1', onload: 'alert(1)', style: 'fill:red', href: 'javascript:alert(1)' }],
      ['rect', { x: '1', width: 'url(javascript:alert(1))', height: '"/><script>' }]
    ]
    const markup = renderIconSvg(hostile, { 'data-test': 'a"<b>&' })
    expect(markup).not.toMatch(/script|foreignObject|image|onload|style=|href|javascript|url\(/)
    const svg = parseSvg(markup)
    const children = [...svg.children].map((child) => [
      child.tagName,
      Object.fromEntries([...child.attributes].map((attr) => [attr.name, attr.value]))
    ])
    expect(children).toEqual([
      ['path', { d: 'M0 0h1' }],
      ['rect', { x: '1' }]
    ])
    expect(svg.getAttribute('data-test')).toBe('a"<b>&')
  })

  it('exports a 1em, text-coloured, decorative icon', () => {
    const svg = parseSvg(renderExportSvg(HOUSE))
    expect(svg.getAttribute('width')).toBe('1em')
    expect(svg.getAttribute('height')).toBe('1em')
    expect(svg.getAttribute('class')).toBe('mt-icon')
    expect(svg.getAttribute('aria-hidden')).toBe('true')
    expect(svg.getAttribute('stroke')).toBe('currentColor')
  })
})

describe('svgToDataUri', () => {
  it('produces a CSS-safe data URI that decodes back to the SVG', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg">\n  <path d="M0 0" fill="#fff"/>\n</svg>'
    const uri = svgToDataUri(svg)
    expect(uri.startsWith('data:image/svg+xml,')).toBe(true)
    const payload = uri.slice('data:image/svg+xml,'.length)
    expect(payload).not.toMatch(/["\n#<>\\]/)
    expect(decodeURIComponent(payload)).toBe(
      '<svg xmlns=\'http://www.w3.org/2000/svg\'> <path d=\'M0 0\' fill=\'#fff\'/> </svg>'
    )
  })

  it('builds mask images drawn in an opaque colour', () => {
    const decoded = decodeURIComponent(iconMaskUri(HOUSE).slice('data:image/svg+xml,'.length))
    expect(decoded).toContain('stroke=\'black\'')
    expect(decoded).toContain('<circle cx=\'12\'')
  })
})

describe('iconCssRule', () => {
  it('targets the icon token pseudo-element by name', () => {
    expect(iconCssRule('arrow-up', 'data:image/svg+xml,x')).toBe(
      '.mu-inline-icon[data-icon="arrow-up"]::before { mask-image: url("data:image/svg+xml,x"); }'
    )
  })
})

describe('IconStyleSheet', () => {
  const pack = createIconPack('lucide', { house: HOUSE, star: [['path', { d: 'M1 1' }]] }, {})
  let sheet: IconStyleSheet | null = null

  afterEach(() => {
    sheet?.dispose()
    sheet = null
  })

  const styleText = (): string => document.head.querySelector('style[data-plugin="icons"]')?.textContent ?? ''

  it('writes one rule per shown icon once the pack is set, in one batched update', async() => {
    sheet = new IconStyleSheet(document)
    sheet.add('star')
    sheet.add('house')
    sheet.add('unknown')
    await flush()
    expect(styleText()).toBe(ICON_BASE_CSS)

    sheet.setPack(pack)
    await flush()
    const css = styleText()
    expect(css.startsWith(ICON_BASE_CSS)).toBe(true)
    expect(css).toContain(iconCssRule('house', iconMaskUri(HOUSE)))
    expect(css.indexOf('data-icon="house"')).toBeLessThan(css.indexOf('data-icon="star"'))
    expect(css).not.toContain('unknown')
  })

  it('replaces the icon set and removes its element on dispose', async() => {
    sheet = new IconStyleSheet(document)
    sheet.setPack(pack)
    sheet.add('house')
    await flush()
    sheet.replace(['star'])
    await flush()
    expect(styleText()).toContain('data-icon="star"')
    expect(styleText()).not.toContain('data-icon="house"')

    sheet.dispose()
    expect(document.head.querySelector('style[data-plugin="icons"]')).toBeNull()
    expect(sheet.maskUri('house')).toBe(iconMaskUri(HOUSE))
    expect(sheet.maskUri('nope')).toBeNull()
  })
})
