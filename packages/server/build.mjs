import { build } from 'esbuild';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

try {
  await build({
    entryPoints: [resolve(__dirname, 'src/main.ts')],
    bundle: true,
    outfile: resolve(__dirname, 'dist/main.js'),
    platform: 'node',
    target: 'node20',
    format: 'esm',
    external: [
      '@nestjs/websockets/socket-module',
      '@nestjs/microservices',
      'class-transformer',
      'class-validator',
    ],
    alias: {
      '@noppt/core': resolve(__dirname, '../core/src/index.ts'),
      '@noppt/ai': resolve(__dirname, '../ai/src/index.ts'),
      '@noppt/ai/agents/html-presentation-agent': resolve(__dirname, '../ai/src/agents/html-presentation-agent.ts'),
    },
    sourcemap: true,
    logLevel: 'info',
  });
  console.log('Build succeeded!');
} catch (error) {
  console.error('Build failed:', error);
  process.exit(1);
}
