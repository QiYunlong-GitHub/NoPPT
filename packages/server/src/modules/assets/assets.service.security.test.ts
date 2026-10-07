import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { StorageService } from '../../common/storage.service';
import { AssetsService, MAX_ASSET_UPLOAD_BYTES } from './assets.service';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('AssetsService security validation', () => {
  let root: string;
  let cwdSpy: ReturnType<typeof vi.spyOn>;
  let storage: StorageService;
  let assets: AssetsService;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'noppt-assets-security-'));
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(root);
    storage = new StorageService();
    assets = new AssetsService(storage);
  });

  afterEach(() => {
    cwdSpy.mockRestore();
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      // Ignore Windows file cleanup races.
    }
  });

  it('accepts valid image metadata and preserves the AssetInfo contract', () => {
    const info = assets.upload('p1', 'image', 'logo.png', PNG, 'image/png');
    expect(info.name).toBe('logo.png');
    expect(info.type).toBe('image');
    expect(info.size).toBe(PNG.length);
    expect(info.url).toMatch(
      /^\/data\/workspace\/presentations\/p1\/assets\/images\/[0-9a-f-]+\.png$/i,
    );
    expect(assets.list('p1', 'image')).toHaveLength(1);
  });

  it('rejects missing, oversized, unsupported, mismatched, and fake image uploads', () => {
    expect(() =>
      assets.upload('p1', 'image', 'missing.png', Buffer.alloc(0), 'image/png'),
    ).toThrow();
    expect(() =>
      assets.upload('p1', 'image', 'fake.png', Buffer.from('not an image'), 'image/png'),
    ).toThrow();
    expect(() => assets.upload('p1', 'image', 'wrong.jpg', PNG, 'image/png')).toThrow();
    expect(() => assets.upload('p1', 'image', 'file.svg', PNG, 'image/svg+xml')).toThrow();
    expect(() => assets.upload('p1', 'audio' as 'image', 'file.png', PNG, 'image/png')).toThrow();
    expect(() =>
      assets.upload(
        'p1',
        'image',
        'large.png',
        Buffer.alloc(MAX_ASSET_UPLOAD_BYTES + 1),
        'image/png',
      ),
    ).toThrow();
  });

  it('validates video MIME and extension without changing generated names', () => {
    const info = assets.upload('p1', 'video', 'clip.mp4', Buffer.from('video'), 'video/mp4');
    expect(info.id).toMatch(/^[0-9a-f-]{36}\.mp4$/i);
    expect(info.url).toContain('/assets/videos/');
    expect(() =>
      assets.upload('p1', 'video', 'clip.mp4', Buffer.from('video'), 'video/webm'),
    ).toThrow();
    expect(() =>
      assets.upload('p1', 'video', 'clip.exe', Buffer.from('video'), 'video/mp4'),
    ).toThrow();
  });

  it('rejects traversal on delete and excludes symlink entries from listing', () => {
    expect(() => assets.delete('p1', 'image', '../outside.png')).toThrow();
    storage.ensurePresentationDir('p1');
    const imageDir = storage.getImagesDir('p1');
    const outside = join(root, 'outside.png');
    const link = join(imageDir, 'escape.png');
    writeFileSync(outside, PNG);
    try {
      symlinkSync(outside, link, 'file');
    } catch {
      return;
    }
    expect(assets.list('p1', 'image').some((asset) => asset.id === 'escape.png')).toBe(false);
    expect(() => assets.delete('p1', 'image', 'escape.png')).toThrow();
  });
});
