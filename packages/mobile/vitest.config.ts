import { defineConfig } from 'vitest/config'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const desktop = resolve(__dirname, '../desktop')

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['test/**/*.spec.ts']
  },
  resolve: {
    alias: {
      '@': resolve(desktop, 'src/renderer/src'),
      common: resolve(desktop, 'src/common'),
      '@shared': resolve(desktop, 'src/shared'),
      '@plugins': resolve(desktop, 'src/plugins'),
      '@mobile': resolve(__dirname, 'src'),
      electron: resolve(__dirname, 'src/shim/electron.ts'),
      path: 'pathe'
    },
    extensions: ['.mjs', '.ts', '.js', '.json']
  }
})
