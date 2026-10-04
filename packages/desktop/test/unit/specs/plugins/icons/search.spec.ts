import { describe, expect, it } from 'vitest'
import lucideTags from 'lucide-static/tags.json'
import lucidePack from '@plugins/icons/renderer/lucide'
import { createIconPack, normalizeSearchText } from '@plugins/icons/common/pack'
import { searchIcons } from '@plugins/icons/common/search'
import { PT_BR_SYNONYMS } from '@plugins/icons/common/synonyms'

const pack = createIconPack(
  'lucide',
  {
    house: [],
    'house-plus': [],
    houses: [],
    hourglass: [],
    warehouse: [],
    'arrow-up': [],
    'circle-arrow-up': [],
    heart: [],
    bookmark: []
  },
  {
    house: ['home', 'living'],
    heart: ['love', 'like'],
    bookmark: ['read later'],
    'arrow-up': ['forward', 'direction north']
  }
)

describe('searchIcons', () => {
  it('ranks exact name, name prefix (shortest first), segment prefix, keyword, then substring', () => {
    expect(searchIcons(pack, 'hou')).toEqual(['house', 'houses', 'hourglass', 'house-plus', 'warehouse'])
    expect(searchIcons(pack, 'house')).toEqual(['house', 'houses', 'house-plus', 'warehouse'])
    expect(searchIcons(pack, 'up')).toEqual(['arrow-up', 'circle-arrow-up'])
    expect(searchIcons(pack, 'love')).toEqual(['heart'])
    expect(searchIcons(pack, 'lat')).toEqual(['bookmark'])
    expect(searchIcons(pack, 'north')).toEqual(['arrow-up'])
  })

  it('treats spaces and hyphens alike and ignores case and accents', () => {
    expect(searchIcons(pack, 'Arrow Up')).toEqual(['arrow-up', 'circle-arrow-up'])
    expect(searchIcons(pack, 'read-later')).toEqual(['bookmark'])
    expect(searchIcons(pack, 'CORAÇÃO')).toEqual(['heart'])
    expect(searchIcons(pack, 'coracao')).toEqual(['heart'])
  })

  it('lists everything alphabetically for an empty query and honours the limit', () => {
    expect(searchIcons(pack, '  ', 3)).toEqual(['arrow-up', 'bookmark', 'circle-arrow-up'])
    expect(searchIcons(pack, 'hou', 2)).toEqual(['house', 'houses'])
    expect(searchIcons(pack, 'zzz')).toEqual([])
  })
})

describe('Lucide pack', () => {
  it('loads every lucide-static icon with geometry and tags', () => {
    expect(lucidePack.prefix).toBe('lucide')
    expect(lucidePack.entries.length).toBe(Object.keys(lucideTags).length)
    expect(lucidePack.entries.length).toBeGreaterThan(1500)
    const house = lucidePack.get('house')
    expect(house?.nodes.length).toBeGreaterThan(0)
    expect(house?.keywords).toEqual(expect.arrayContaining(['home', 'casa']))
  })

  it('ships pt-BR synonyms only for existing icons', () => {
    const missing = Object.keys(PT_BR_SYNONYMS).filter((name) => !lucidePack.get(name))
    expect(missing).toEqual([])
    expect(Object.keys(PT_BR_SYNONYMS).length).toBeGreaterThanOrEqual(50)
  })

  it('finds common icons by Portuguese words and completes `hou` to `house` first', () => {
    expect(searchIcons(lucidePack, 'casa')[0]).toBe('house')
    expect(searchIcons(lucidePack, 'lixeira')[0]).toBe('trash')
    expect(searchIcons(lucidePack, 'calendario')).toContain('calendar')
    expect(searchIcons(lucidePack, 'hou', 50)[0]).toBe('house')
    expect(normalizeSearchText(' Ícone ')).toBe('icone')
  })
})
