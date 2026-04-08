import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  build: {
    emptyOutDir: false,
    outDir: 'dist/renderer',
  },
  plugins: [react(), tailwindcss()],
})
