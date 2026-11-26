import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

/**
 * In development this dev server is the only HTTP listener, and it exists for
 * hot module replacement only — the overlay loads it via VOCAB_OVERLAY_URL. The
 * API is not proxied anywhere: it lives in the Electron main process and is
 * reached over IPC. The production build is loaded from `vocab://app/`, so asset
 * paths must stay relative.
 */
export default defineConfig({
  base: './',
  plugins: [vue()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5180,
    strictPort: true,
    host: '127.0.0.1',
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
})
