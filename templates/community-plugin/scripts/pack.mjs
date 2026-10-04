import { build } from 'vite'
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateRawSync, crc32 } from 'node:zlib'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'dist')
rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })

const bundle = async (entry, fileName) => {
  await build({
    configFile: false,
    root,
    build: {
      emptyOutDir: false,
      outDir: out,
      lib: {
        entry: join(root, entry),
        formats: ['es'],
        fileName: () => fileName
      },
      rollupOptions: {
        output: { inlineDynamicImports: true }
      }
    },
    logLevel: 'warn'
  })
}

await bundle('src/main.ts', 'main.js')
await bundle('src/panel.ts', 'panel.js')
cpSync(join(root, 'manifest.json'), join(out, 'manifest.json'))
cpSync(join(root, 'panel.html'), join(out, 'panel.html'))

const crc = (data) => crc32(data) >>> 0
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b }
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b }
const files = readdirSync(out).filter((name) => !name.endsWith('.zip'))
const locals = []
const centrals = []
let offset = 0
for (const name of files) {
  const data = readFileSync(join(out, name))
  const compressed = deflateRawSync(data)
  const nameBuf = Buffer.from(name)
  const local = Buffer.concat([
    u32(0x04034b50), u16(20), u16(0), u16(8), u16(0), u16(0),
    u32(crc(data)), u32(compressed.length), u32(data.length),
    u16(nameBuf.length), u16(0), nameBuf, compressed
  ])
  locals.push(local)
  centrals.push(Buffer.concat([
    u32(0x02014b50), u16(20), u16(20), u16(0), u16(8), u16(0), u16(0),
    u32(crc(data)), u32(compressed.length), u32(data.length),
    u16(nameBuf.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), nameBuf
  ]))
  offset += local.length
}
const central = Buffer.concat(centrals)
const eocd = Buffer.concat([
  u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
  u32(central.length), u32(offset), u16(0)
])
writeFileSync(join(out, 'word-counter.zip'), Buffer.concat([...locals, central, eocd]))
console.log('wrote', join(out, 'word-counter.zip'))
