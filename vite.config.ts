import { defineConfig } from 'vite';

const target = `http://localhost:${process.env.PORT ?? 7777}`;
export default defineConfig({
  root: 'client',
  build: { outDir: '../dist', emptyOutDir: true, chunkSizeWarningLimit: 1200 },
  server: {
    port: 5173,
    proxy: {
      '/api': target,
      '/mcp': target,
      '/ws': { target: target.replace('http', 'ws'), ws: true },
    },
  },
});
