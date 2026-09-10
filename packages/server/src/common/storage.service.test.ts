import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  sanitizeScopeSegment,
  createScopedStorage,
  StorageService,
  getStorageService,
} from './storage.service';
import { McpError } from './mcp-errors';

/**
 * TC-101 / TC-102（规格 5.2.1）
 * 单测禁止污染真实 `packages/server/data`：统一把 `process.cwd()` 指向临时目录。
 */
describe('M1 StorageService 作用域化', () => {
  let tmpRoot: string;
  let cwdSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'noppt-storage-test-'));
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tmpRoot);
  });

  afterEach(() => {
    cwdSpy.mockRestore();
    try {
      rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  describe('TC-101 sanitizeScopeSegment', () => {
    it.each(['alice', 'user-01', '_dev', 'default', 'A', '0', 'a_b-c'])('放行合法段 %s', (v) => {
      expect(sanitizeScopeSegment(v)).toBe(v);
    });

    it.each(['..', '../', '%2e%2e', 'a/b', 'a\\b', 'alice/bob', '中文', 'a b', 'a.b', '', 'a@b'])(
      '拒绝非法段 %s',
      (v) => {
        expect(() => sanitizeScopeSegment(v)).toThrow(McpError);
        try {
          sanitizeScopeSegment(v);
        } catch (e) {
          expect((e as McpError).code).toBe('E4002');
        }
      },
    );

    it('拒绝超过 64 字符的段（65 字符）', () => {
      const tooLong = 'a'.repeat(65);
      expect(() => sanitizeScopeSegment(tooLong)).toThrow(McpError);
    });

    it('放行恰好 64 字符的段', () => {
      const ok = 'a'.repeat(64);
      expect(sanitizeScopeSegment(ok)).toBe(ok);
    });

    it('非法段不会创建任何目录', () => {
      expect(() => createScopedStorage('tenants', '..', 'users', 'alice')).toThrow(McpError);
      expect(existsSync(join(tmpRoot, 'data', 'tenants'))).toBe(false);
    });
  });

  describe('TC-102 createScopedStorage / getPublicBase', () => {
    it('作用域目录落在 data/tenants/{t}/users/{u}/workspace', () => {
      const s = createScopedStorage('tenants', 'default', 'users', 'alice');
      expect(s.getScope()).toEqual(['tenants', 'default', 'users', 'alice']);
      expect(s.getWorkspaceDir()).toBe(
        join(tmpRoot, 'data', 'tenants', 'default', 'users', 'alice', 'workspace'),
      );
      expect(s.getPresentationDir('x')).toBe(
        join(
          tmpRoot,
          'data',
          'tenants',
          'default',
          'users',
          'alice',
          'workspace',
          'presentations',
          'x',
        ),
      );
      expect(s.getPublicBase()).toBe('/data/tenants/default/users/alice/workspace');
    });

    it('无作用域时与旧行为完全一致（Web 兼容红线）', () => {
      const s = new StorageService();
      expect(s.getScope()).toEqual([]);
      expect(s.getBaseDir()).toBe(join(tmpRoot, 'data'));
      expect(s.getWorkspaceDir()).toBe(join(tmpRoot, 'data', 'workspace'));
      expect(s.getPublicBase()).toBe('/data/workspace');
      expect(s.getPresentationDir('p1')).toBe(
        join(tmpRoot, 'data', 'workspace', 'presentations', 'p1'),
      );
      expect(s.getImagesDir('p1')).toBe(
        join(tmpRoot, 'data', 'workspace', 'presentations', 'p1', 'assets', 'images'),
      );
    });

    it('不同用户的作用域目录互相独立', () => {
      const alice = createScopedStorage('tenants', 'default', 'users', 'alice');
      const bob = createScopedStorage('tenants', 'default', 'users', 'bob');
      expect(alice.getPresentationDir('same-id')).not.toBe(bob.getPresentationDir('same-id'));
    });

    it('作用域化后资源 URL 前缀随作用域变化', async () => {
      const s = createScopedStorage('tenants', 't1', 'users', 'u1');
      const url = await s.saveImageFromUrl('p1', 'data:image/png;base64,iVBORw0KGgo=');
      expect(
        url.startsWith('/data/tenants/t1/users/u1/workspace/presentations/p1/assets/images/'),
      ).toBe(true);
    });

    it('无作用域时资源 URL 前缀保持 /data/workspace（回归红线）', async () => {
      const s = new StorageService();
      const url = await s.saveImageFromUrl('p1', 'data:image/png;base64,iVBORw0KGgo=');
      expect(url.startsWith('/data/workspace/presentations/p1/assets/images/')).toBe(true);
    });

    it('getStorageService() 单例仍为无作用域实例', () => {
      const a = getStorageService();
      const b = getStorageService();
      expect(a).toBe(b);
      expect(a.getScope()).toEqual([]);
      expect(a.getPublicBase()).toBe('/data/workspace');
    });
  });
});
