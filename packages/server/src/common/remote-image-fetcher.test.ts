import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { fetchPinnedRemoteImageWithLookup } from './remote-image-fetcher';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('pinned remote image transport', () => {
  it('connects to the validated address even if a later DNS answer changes', async () => {
    let hostHeader = '';
    const server = createServer((request, response) => {
      hostHeader = request.headers.host ?? '';
      response.writeHead(200, {
        'content-type': 'image/png',
        'content-length': PNG_SIGNATURE.length,
      });
      response.end(PNG_SIGNATURE);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    let lookupCalls = 0;

    try {
      const result = await fetchPinnedRemoteImageWithLookup(
        new URL(`http://rebinding.test:${port}/image.png`),
        new AbortController().signal,
        1024,
        () => false,
        async () => {
          lookupCalls += 1;
          const answer = lookupCalls === 1 ? '127.0.0.1' : '127.0.0.2';
          return [{ address: answer, family: 4 }];
        },
      );
      expect(result.ok).toBe(true);
      expect(result.buffer).toEqual(PNG_SIGNATURE);
      expect(lookupCalls).toBe(1);
      expect(hostHeader).toBe(`rebinding.test:${port}`);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
