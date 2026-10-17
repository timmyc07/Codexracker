import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [svelte()],
  build: {
    lib: {
      entry: 'src/overlay/entry.ts',
      name: 'CodexrackerOverlay',
      formats: ['iife'],
      fileName: 'overlay',
    },
    emptyOutDir: true,
  },
  test: {
    include: ['tests/unit/**/*.test.{ts,mjs}'],
    environment: 'node',
  },
})
