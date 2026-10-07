import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    globals: true,
    environment: 'node',
  },
  resolve: {
    alias: {
      '@noppt/core': path.resolve(__dirname, '../core/src'),
      '@noppt/core/*': path.resolve(__dirname, '../core/src/*'),
      '@noppt/ai': path.resolve(__dirname, '../ai/src'),
      '@noppt/ai/*': path.resolve(__dirname, '../ai/src/*'),
      '@noppt/web/export/presentation-to-deck': path.resolve(__dirname, '../web/src/export/presentation-to-deck.ts'),
      '@noppt/web/*': path.resolve(__dirname, '../web/src/*'),
    },
  },
});
