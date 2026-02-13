import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte({
    compilerOptions: {
      runes: true,
    },
  })],
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
});
