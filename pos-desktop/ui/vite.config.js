import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  build: {
    outDir: 'dist',
    minify: false,
    rollupOptions: {
      treeshake: false
    },
    emptyOutDir: true,
  }
});
