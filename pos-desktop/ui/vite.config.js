import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  server: {
    // During `npm run dev`, the UI runs on :5173 while the POS agent runs on :7070.
    // Proxy API calls so the UI can talk to the real agent instead of falling back to demo mode.
    proxy: (() => {
      const target = process.env.POS_AGENT_URL || 'http://127.0.0.1:7070';
      return {
        '/api': { target, changeOrigin: true },
        // Printable receipt endpoint is not under /api.
        '/receipt': { target, changeOrigin: true },
      };
    })(),
  },
  build: {
    outDir: 'dist',
    minify: false,
    rollupOptions: {
      treeshake: false
    },
    emptyOutDir: true,
  }
});
