import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [svelte()],
  build: {
    lib: {
      entry: 'src/overlay/mount.ts',
      formats: ['es'],
      fileName: 'overlay',
    },
    emptyOutDir: true,
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
