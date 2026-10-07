import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, rmSync, symlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  MAX_DATA_URL_CHARS,
  MAX_IMAGE_BYTES,
  REMOTE_IMAGE_TIMEOUT_MS,
  StorageService,
} from './storage.service';
import type { RemoteImageResult } from './remote-image-fetcher';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function responseFor(buffer: Buffer, contentType = 'image/png', contentLength?: number): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers({
      'content-type': contentType,
      ...(contentLength === undefined ? {} : { 'content-length': String(contentLength) }),
    }),
    body: null,
    arrayBuffer: vi.fn(async () =>
      buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
    ),
  } as unknown as Response;
}

describe('StorageService security boundaries', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'noppt-storage-security-'));
    vi.spyOn(process, 'cwd').mockReturnValue(root);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      // Ignore Windows file cleanup races.
    }
  });

  it('rejects traversal, absolute, null-byte, and escaping symlink presentation paths', () => {
    const storage = new StorageService();
    expect(() => storage.getPresentationDir('../outside')).toThrow();
    expect(() => storage.getPresentationDir('C:\\outside')).toThrow();
    expect(() => storage.getPresentationDir('/outside')).toThrow();
    expect(() => storage.getPresentationDir('safe\0name')).toThrow();
    expect(() => storage.getReferenceAttrsPath('p1', '../outside')).toThrow();

    const outside = join(root, 'outside');
    const link = join(root, 'data', 'workspace', 'presentations', 'escape');
    mkdirSync(outside, { recursive: true });
    mkdirSync(join(root, 'data', 'workspace', 'presentations'), { recursive: true });
    try {
      symlinkSync(outside, link, 'junction');
    } catch {
      return;
    }
    expect(() => storage.getPresentationDir('escape')).toThrow();
  });

  it('rejects generic file operations outside the storage data root', async () => {
    const storage = new StorageService();
    const outside = join(root, 'outside.json');
    await expect(
      Promise.resolve().then(() => storage.writeJsonFile(outside, {})),
    ).rejects.toThrow();
    expect(existsSync(outside)).toBe(false);
  });

  it('bounds data URLs and requires a matching image signature', async () => {
    const storage = new StorageService();
    await expect(
      storage.saveImageFromUrl('p1', `data:image/png;base64,${'A'.repeat(MAX_DATA_URL_CHARS)}`),
    ).rejects.toThrow(/size limit/i);
    await expect(storage.saveImageFromUrl('p1', 'data:image/png;base64,AAAA')).rejects.toThrow();
    await expect(
      storage.saveImageFromUrl('p1', 'data:text/plain;base64,SGVsbG8='),
    ).rejects.toThrow();

    const url = await storage.saveImageFromUrl(
      'p1',
      `data:image/png;base64,${PNG_SIGNATURE.toString('base64')}`,
    );
    expect(url).toMatch(/\/assets\/images\/[0-9a-f-]+\.png$/i);
  });

  it('rejects private remote destinations, redirects, oversized responses, and non-images', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const storage = new StorageService(undefined, { remoteImageFetcher: globalFetchAdapter });

    await expect(storage.saveImageFromUrl('p1', 'http://127.0.0.1/image.png')).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 302,
      headers: new Headers(),
      body: null,
    } as Response);
    await expect(storage.saveImageFromUrl('p1', 'https://example.com/redirect')).rejects.toThrow();

    fetchMock.mockResolvedValueOnce(responseFor(Buffer.alloc(0), 'image/png', MAX_IMAGE_BYTES + 1));
    await expect(storage.saveImageFromUrl('p1', 'https://example.com/large')).rejects.toThrow(
      /size limit/i,
    );

    fetchMock.mockResolvedValueOnce(responseFor(PNG_SIGNATURE, 'text/plain'));
    await expect(storage.saveImageFromUrl('p1', 'https://example.com/not-image')).rejects.toThrow();
  });

  it('rejects DNS-sensitive local hostnames and IPv6/link-local destinations before fetch', async () => {
    const storage = new StorageService();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    for (const host of [
      'localhost',
      'assets.localhost',
      'service.internal',
      '169.254.169.254',
      '[::1]',
      '[fe80::1]',
      'http://metadata.google.internal',
    ]) {
      const url = host.startsWith('http') ? `${host}/image.png` : `https://${host}/image.png`;
      await expect(storage.saveImageFromUrl('p1', url)).rejects.toThrow();
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('aborts a remote fetch that exceeds the timeout', async () => {
    const fetchMock = vi.fn(
      (_url: string, options: RequestInit) =>
        new Promise<Response>((_resolve) => {
          // The production timeout must abort the request even when fetch never settles.
          void options.signal;
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    vi.useFakeTimers();
    const storage = new StorageService(undefined, { remoteImageFetcher: globalFetchAdapter });

    const pending = storage.saveImageFromUrl('p1', 'https://example.com/slow');
    const assertion = expect(pending).rejects.toThrow(/timed out/i);
    await vi.advanceTimersByTimeAsync(REMOTE_IMAGE_TIMEOUT_MS);
    await assertion;
    expect(fetchMock.mock.calls[0][1]?.signal).toBeDefined();
  });

  it('limits streamed response bodies before concatenating them', async () => {
    const cancel = vi.fn(async () => undefined);
    const read = vi
      .fn()
      .mockResolvedValueOnce({ done: false, value: new Uint8Array(MAX_IMAGE_BYTES + 1) });
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          ({
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'image/png' }),
            body: { getReader: () => ({ read, cancel, releaseLock: vi.fn() }) },
          }) as unknown as Response,
      ),
    );
    const storage = new StorageService(undefined, { remoteImageFetcher: globalFetchAdapter });

    await expect(storage.saveImageFromUrl('p1', 'https://example.com/stream')).rejects.toThrow(
      /size limit/i,
    );
    expect(cancel).toHaveBeenCalled();
  });
});

async function globalFetchAdapter(
  url: URL,
  signal: AbortSignal,
  maxBytes: number,
): Promise<RemoteImageResult> {
  const response = await fetch(url.toString(), { signal });
  const chunks: Buffer[] = [];
  let total = 0;
  if (response.body) {
    const reader = response.body.getReader();
    try {
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        const chunk = Buffer.from(result.value);
        total += chunk.length;
        if (total > maxBytes) {
          await reader.cancel();
          throw new Error('Downloaded image exceeds the size limit');
        }
        chunks.push(chunk);
      }
    } finally {
      reader.releaseLock();
    }
  } else {
    const chunk = Buffer.from(await response.arrayBuffer());
    if (chunk.length > maxBytes) throw new Error('Downloaded image exceeds the size limit');
    chunks.push(chunk);
  }
  return {
    ok: response.ok,
    status: response.status,
    headers: response.headers,
    buffer: Buffer.concat(chunks),
  };
}
