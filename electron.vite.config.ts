import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {},
  // Sandboxed preload scripts must be CommonJS.
  preload: { build: { rolldownOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } } } },
  renderer: { plugins: [react()] },
})
