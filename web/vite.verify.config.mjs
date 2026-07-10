import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({
  root: 'C:/Users/Tyler/Documents/projects/socratic-tutor/web',
  plugins: [react()],
  server: {
    port: 5198,
    strictPort: true,
    proxy: {
      '/api': 'http://localhost:8792',
      '/lsp': { target: 'http://localhost:8792', ws: true },
    },
  },
})
