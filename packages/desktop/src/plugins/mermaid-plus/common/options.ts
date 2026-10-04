import type { MermaidEngineOptions } from '@/plugins/types'

const THEMES: Record<string, NonNullable<MermaidEngineOptions['theme']>> = {
  default: 'default',
  neutral: 'neutral',
  forest: 'forest',
  dark: 'dark',
  base: 'base'
}

/**
 * Engine request for the plugin settings. Theme `auto` (or any unknown value)
 * leaves the theme to the app (light/dark); an unknown look falls back to classic.
 */
export const mermaidEngineOptions = (theme: string, look: string): MermaidEngineOptions => {
  const options: MermaidEngineOptions = { look: look === 'handDrawn' ? 'handDrawn' : 'classic' }
  const mermaidTheme = THEMES[theme]
  if (mermaidTheme) options.theme = mermaidTheme
  return options
}
