import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/** Drop the unused CDN default from @monaco-editor/loader so packaged builds stay offline. */
function stripMonacoCdn(): Plugin {
  return {
    name: 'strip-monaco-cdn',
    transform(code, id) {
      if (!id.replace(/\\/g, '/').includes('@monaco-editor/loader')) return
      if (!code.includes('jsdelivr')) return
      return {
        code: code.replace(/https:\/\/cdn\.jsdelivr\.net\/npm\/monaco-editor@[^'"`\s]+/g, ''),
        map: null,
      }
    },
  }
}

export default defineConfig({
  plugins: [react(), stripMonacoCdn()],
  server: {
    proxy: {
      '/api': 'http://localhost:8787',
      '/lsp': { target: 'http://localhost:8787', ws: true },
      '/ws/events': { target: 'ws://localhost:8787', ws: true },
    },
  },
})
