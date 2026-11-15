import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {},
  // Sandboxed preload scripts must be CommonJS.
  preload: { build: { rolldownOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } } } },
  renderer: {
    plugins: [react(), tailwindcss()],
    // bot-avatars is linked from ../bots, which has its own React; use the app's copy.
    resolve: { alias: { '@': resolve(import.meta.dirname, 'src/renderer/src') }, dedupe: ['react', 'react-dom'] },
  },
})
