import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  define: {
    'process.env': {},
    global: 'globalThis',
  },
  resolve: {
    alias: [
      { find: /^buffer$/, replacement: 'buffer' },
      { find: /^process$/, replacement: 'process/browser.js' },
      { find: /^process\/$/, replacement: 'process/browser.js' },
      { find: /^stream$/, replacement: 'stream-browserify' },
    ],
  },
  server: {
    port: 5173,
  },
})
