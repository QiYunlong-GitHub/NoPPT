import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    globals: true,
    environment: 'jsdom',
  },
  resolve: {
    alias: {
      '@noppt/core': path.resolve(__dirname, '../core/src'),
      '@noppt/core/*': path.resolve(__dirname, '../core/src/*'),
    },
  },
});
