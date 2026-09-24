import { defineConfig } from 'vite';
import path from 'node:path';

// Forge's Vite preload target uses rollup input (not lib mode).
// Force a stable filename so main can load `.vite/build/preload.js`.
export default defineConfig({
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        entryFileNames: 'preload.js',
        chunkFileNames: 'preload.js',
      },
    },
  },
});
