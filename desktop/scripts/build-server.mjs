import * as esbuild from 'esbuild'
import { mkdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const desktopRoot = path.resolve(__dirname, '..')
const repoRoot = path.resolve(desktopRoot, '..')
const outfile = path.join(desktopRoot, 'dist-server', 'server.cjs')

mkdirSync(path.dirname(outfile), { recursive: true })

await esbuild.build({
  entryPoints: [path.join(repoRoot, 'server', 'src', 'server.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  external: ['bufferutil', 'utf-8-validate'],
  // CJS has no import.meta — synthesize it from __filename so path
  // resolution (appPaths, lsp defaults, run scratch) still works.
  banner: {
    js: 'var __import_meta_url=require("url").pathToFileURL(__filename).href;',
  },
  define: {
    'import.meta.url': '__import_meta_url',
  },
})

const size = statSync(outfile).size
console.log(`server bundle → ${outfile} (${(size / 1024).toFixed(1)} KiB)`)
