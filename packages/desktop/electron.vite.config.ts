import { resolve, dirname, join, extname } from 'path'
import { createReadStream, readdirSync, readFileSync, statSync } from 'fs'
import type { PluginOption } from 'vite'
import { defineConfig } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import svgLoader from 'vite-svg-loader'
import postcssPresetEnv from 'postcss-preset-env'
import packageJson from './package.json' with { type: 'json' }
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// pdf.js (PDF reader plugin) loads CMaps, standard fonts, wasm image decoders
// and ICC profiles at run time from directory URLs, so they cannot go through
// the module graph. They are served under `pdfjs/<dir>/` next to index.html:
// by the dev server in dev, as emitted assets in the build.
const PDFJS_ROOT = resolve(__dirname, 'node_modules/pdfjs-dist')
const PDFJS_ASSET_DIRS = ['cmaps', 'standard_fonts', 'wasm', 'iccs']
const PDFJS_CONTENT_TYPES: Record<string, string> = {
  '.js': 'text/javascript',
  '.wasm': 'application/wasm',
  '.ttf': 'font/ttf'
}

const pdfjsAssets = (): PluginOption => ({
  name: 'marktext:pdfjs-assets',
  configureServer(server) {
    server.middlewares.use('/pdfjs', (req, res, next) => {
      const [dir, file, ...rest] = decodeURIComponent((req.url ?? '').split('?')[0]).split('/').filter(Boolean)
      if (rest.length > 0 || !PDFJS_ASSET_DIRS.includes(dir) || !file || file.startsWith('.')) return next()
      const fullPath = join(PDFJS_ROOT, dir, file)
      try {
        if (!statSync(fullPath).isFile()) return next()
      } catch {
        return next()
      }
      res.setHeader('Content-Type', PDFJS_CONTENT_TYPES[extname(file)] ?? 'application/octet-stream')
      createReadStream(fullPath).pipe(res)
    })
  },
  generateBundle() {
    for (const dir of PDFJS_ASSET_DIRS) {
      for (const file of readdirSync(join(PDFJS_ROOT, dir))) {
        this.emitFile({ type: 'asset', fileName: `pdfjs/${dir}/${file}`, source: readFileSync(join(PDFJS_ROOT, dir, file)) })
      }
    }
  }
})

export default defineConfig({
  main: {
    // --> Bundled as CommonJS
    // externalizeDepsPlugin() basically externises all the dependencies from being bundled during build - treating them as runtime dependencies
    // electron-vite still builds the main and preload processes into commonJS
    // hence, we need to "exclude" (in order to NOT externalise) ESonly modules so that they can be converted to commonJS and can be required() afterwards correctly
    build: {
      externalizeDeps: {
        // Bundle electron-store + plist inline so they are available as a
        // CommonJS require() after electron-vite converts the main process
        // output. plist 5 ships ESM-only (no CJS `exports` entry), so leaving
        // it externalized makes the main process `require('plist')` throw
        // ERR_PACKAGE_PATH_NOT_EXPORTED at startup.
        exclude: ['electron-store', 'plist'],
        include: ['native-keymap']
      },
      rollupOptions: {
        // The vault index runs in an Electron utility process forked from
        // out/main/vaultIndexWorker.js (see src/main/vaultIndex/index.ts).
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          vaultIndexWorker: resolve(__dirname, 'src/main/vaultIndex/worker/entry.ts')
        }
      }
    },
    define: {
      MARKTEXT_VERSION: JSON.stringify(packageJson.version),
      MARKTEXT_VERSION_STRING: JSON.stringify(`v${packageJson.version}`)
    },
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer/src'),
        common: resolve(__dirname, 'src/common'),
        '@shared': resolve(__dirname, 'src/shared'),
        '@plugins': resolve(__dirname, 'src/plugins')
      },
      extensions: ['.mjs', '.ts', '.js', '.json']
    }
  },
  preload: {
    // --> Bundled as CommonJS
    // With sandbox: true the renderer's preload can only `require('electron')`
    // (plus a few built-ins). Inline `pathe` (ESM-only) so the bundled preload
    // doesn't try to require it from node_modules at runtime.
    build: {
      externalizeDeps: {
        exclude: ['pathe']
      }
    },
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer/src'),
        common: resolve(__dirname, 'src/common'),
        '@shared': resolve(__dirname, 'src/shared'),
        '@plugins': resolve(__dirname, 'src/plugins')
      },
      extensions: ['.mjs', '.ts', '.js', '.json']
    }
  },
  renderer: {
    // --> Bundled as ES Modules
    // The renderer runs in a sandboxed Chromium context (contextIsolation: true,
    // nodeIntegration: false, sandbox: true). All Node access must go through
    // the preload → IPC bridge. Aliasing `path` → `pathe` lets the shared
    // `common/*` helpers keep their `import path from 'path'` statements
    // without pulling in Node's path module. `pathe` always uses `/`
    // separators and handles Windows drive letters correctly.
    assetsInclude: ['**/*.md'],
    // Some bundled deps (e.g. `custom-event` via `dragula`) reference the
    // Node-only `global` at module load — undefined in a sandboxed renderer.
    // Substitute it with `globalThis` at build time so the imports don't
    // throw before Vue mounts.
    define: {
      global: 'globalThis'
    },
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer/src'),
        common: resolve(__dirname, 'src/common'),
        '@shared': resolve(__dirname, 'src/shared'),
        '@plugins': resolve(__dirname, 'src/plugins'),
        path: 'pathe'
      },
      extensions: ['.mjs', '.ts', '.js', '.json', '.vue']
    },
    optimizeDeps: {
      include: ['pako', 'pathe'],
      esbuildOptions: {
        define: {
          global: 'globalThis'
        }
      }
    },
    plugins: [vue(), svgLoader(), pdfjsAssets()] as PluginOption[],
    css: {
      postcss: {
        plugins: [
          postcssPresetEnv({
            stage: 0,
            features: {
              'nesting-rules': true,
              // Electron ships Chromium, which supports CSS logical properties
              // natively. Leave them untouched so `padding-inline-start` /
              // `inset-inline-start` mirror correctly under `dir="rtl"` instead
              // of being down-compiled to hard-coded LTR physical props (#4673).
              'logical-properties-and-values': false
            }
          })
        ]
      }
    }
  }
})
