import { defineConfig } from 'vite';
import path from 'node:path';
import { builtinModules } from 'node:module';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pkg = require('./package.json') as {
  dependencies?: Record<string, string>;
};

/** Keep Electron main lean: load runtime deps from node_modules, do not bundle them. */
const dependencyExternals = Object.keys(pkg.dependencies ?? {});

export default defineConfig({
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
  },
  build: {
    lib: {
      entry: 'src/main/index.ts',
      formats: ['cjs'],
      fileName: () => 'main.js',
    },
    rollupOptions: {
      external: [
        'electron',
        'electron-squirrel-startup',
        'ws',
        'bufferutil',
        'utf-8-validate',
        'openai',
        '@google/genai',
        ...dependencyExternals,
        ...builtinModules,
        ...builtinModules.map((name) => `node:${name}`),
      ],
    },
  },
});
