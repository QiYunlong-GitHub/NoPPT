import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    globals: true,
    environment: 'node',
    testTimeout: 20000,
    hookTimeout: 20000,
    pool: 'forks',
  },
  resolve: {
    alias: {
      '@noppt/core': path.resolve(__dirname, '../core/src'),
      '@noppt/core/*': path.resolve(__dirname, '../core/src/*'),
    },
  },
  server: {
    fs: {
      allow: [path.resolve(__dirname, '..')],
    },
  },
  esbuild: {
    target: 'node18',
  },
});
