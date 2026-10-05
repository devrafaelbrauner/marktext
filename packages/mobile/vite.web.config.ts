// Static web build of the desktop renderer for the Capacitor WebView. Reuses
// the renderer section of the desktop electron-vite config (aliases, Vue,
// SVG loader, pdf.js assets, PostCSS) and swaps the Electron-only pieces:
// `electron` resolves to the in-WebView shim and the entry runs the mobile
// main side before the unchanged preload and renderer.

import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { defineConfig, type UserConfig } from 'vite'
import desktopConfig from '../desktop/electron.vite.config'
import packageJson from '../desktop/package.json' with { type: 'json' }

const __dirname = dirname(fileURLToPath(import.meta.url))
const renderer = (desktopConfig as { renderer: UserConfig }).renderer
const rendererAliases = (renderer.resolve?.alias ?? {}) as Record<string, string>

export default defineConfig({
  ...renderer,
  root: __dirname,
  base: './',
  define: {
    ...renderer.define,
    MARKTEXT_VERSION: JSON.stringify(packageJson.version),
    MARKTEXT_VERSION_STRING: JSON.stringify(`v${packageJson.version}`)
  },
  resolve: {
    ...renderer.resolve,
    alias: {
      ...rendererAliases,
      electron: resolve(__dirname, 'src/shim/electron.ts'),
      '@mobile': resolve(__dirname, 'src')
    }
  },
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    // The mobile main side awaits native state at module top level.
    target: 'es2022',
    chunkSizeWarningLimit: 8192
  }
})
