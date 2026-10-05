import { describe, expect, it } from 'vitest'
import { barsFor } from '../src/main/systemBars'

describe('barsFor', () => {
  const probe = document.body.appendChild(document.createElement('span'))

  it('maps a theme background to a hex colour and the icon contrast', () => {
    expect(barsFor(' #282828', probe)).toEqual({ color: '#282828', dark: true })
    expect(barsFor('rgb(255, 255, 255)', probe)).toEqual({ color: '#ffffff', dark: false })
    // Mid grey is light enough for dark icons.
    expect(barsFor('#a0a0a0', probe)).toEqual({ color: '#a0a0a0', dark: false })
  })

  it('refuses an empty value, so an unset theme variable keeps the bars as they are', () => {
    expect(barsFor('', probe)).toBeNull()
  })
})
