import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'dist',
    minify: false,
    rollupOptions: {
      treeshake: false
    },
    emptyOutDir: true,
  }
});
