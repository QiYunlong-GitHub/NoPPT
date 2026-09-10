import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ApiKeyService, isPlainKeyFormat } from './api-key.service';

/**
 * TC-103（规格 5.2.1）：createKey 明文仅一次 / 落盘仅哈希 / verifyKey 命中与禁用 / 重启持久化 / 并发安全。
 * 数据目录用临时目录 + mock cwd 隔离，不污染真实 `packages/server/data`。
 */
describe('M2 ApiKeyService', () => {
  let tmpRoot: string;
  let cwdSpy: ReturnType<typeof vi.spyOn>;
  let service: ApiKeyService;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'noppt-apikeys-test-'));
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tmpRoot);
    service = new ApiKeyService();
  });

  afterEach(() => {
    cwdSpy.mockRestore();
    try {
      rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  const readRaw = (): { keys: Array<Record<string, unknown>> } =>
    JSON.parse(readFileSync(join(tmpRoot, 'data', 'apikeys.json'), 'utf-8'));

  it('createKey 返回 nppt_ + 32hex 明文，且明文仅出现在返回值中', async () => {
    const { key, record } = await service.createKey({ name: 'hermes-prod' });
    expect(isPlainKeyFormat(key)).toBe(true);
    expect(key.startsWith('nppt_')).toBe(true);
    expect(key).toHaveLength(5 + 32);
    expect(record.id.startsWith('k_')).toBe(true);
    expect(record.enabled).toBe(true);
    expect((record as Record<string, unknown>).keyHash).toBeUndefined();
    expect(record.tenantId).toBe('default');
    expect(record.userKey).toBe('default');
  });

  it('落盘只存 sha256 哈希，绝不出现明文', async () => {
    const { key } = await service.createKey({ name: 'hermes-prod' });
    const raw = readFileSync(join(tmpRoot, 'data', 'apikeys.json'), 'utf-8');
    expect(raw).not.toContain(key);
    const file = readRaw();
    expect(file.keys).toHaveLength(1);
    expect(String(file.keys[0].keyHash)).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('verifyKey 命中有效 Key；错误格式 / 未知 Key 返回 null', async () => {
    const { key, record } = await service.createKey({ name: 'k1' });
    const hit = await service.verifyKey(key);
    expect(hit?.id).toBe(record.id);
    expect(service.verifyKeySync('nppt_' + 'f'.repeat(32))).toBeNull();
    expect(service.verifyKeySync('bad-token')).toBeNull();
    expect(service.verifyKeySync('')).toBeNull();
  });

  it('revokeKey 后 verifyKey 失效，但 locateByRawKeySync 仍可定位（区分 E1002 / E1003）', async () => {
    const { key, record } = await service.createKey({ name: 'k1' });
    expect(await service.verifyKey(key)).not.toBeNull();
    expect(await service.revokeKey(record.id)).toBe(true);
    expect(await service.verifyKey(key)).toBeNull();
    const located = service.locateByRawKeySync(key);
    expect(located).not.toBeNull();
    expect(located?.enabled).toBe(false);
  });

  it('revokeKey 未知 id 返回 false', async () => {
    expect(await service.revokeKey('k_not_exist')).toBe(false);
  });

  it('重启持久化：新建实例（模拟重启）后仍可验证', async () => {
    const { key } = await service.createKey({ name: 'persist' });
    const restarted = new ApiKeyService();
    expect(await restarted.verifyKey(key)).not.toBeNull();
    expect(restarted.listKeys()).toHaveLength(1);
  });

  it('listKeys 脱敏：不含 keyHash', async () => {
    await service.createKey({ name: 'k1' });
    const list = service.listKeys();
    expect(list).toHaveLength(1);
    expect((list[0] as Record<string, unknown>).keyHash).toBeUndefined();
  });

  it('并发 createKey 不丢记录（写锁 + 原子 rename）', async () => {
    await Promise.all(Array.from({ length: 12 }, (_, i) => service.createKey({ name: `k${i}` })));
    expect(service.listKeys()).toHaveLength(12);
    expect(readRaw().keys).toHaveLength(12);
  });

  it('verifyKey 会刷新 lastUsedAt', async () => {
    const { key, record } = await service.createKey({ name: 'k1' });
    expect(service.listKeys()[0].lastUsedAt).toBeUndefined();
    await service.verifyKey(key);
    // touchKey 为异步写，轮询等待落盘
    for (let i = 0; i < 50; i++) {
      if (service.locateByRawKeySync(key)?.lastUsedAt) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(service.locateByRawKeySync(key)?.lastUsedAt).toBeGreaterThan(0);
    expect(record.id).toBeTruthy();
  });

  it('ensureDevKey：NOPPT_DEV_KEY 为合法明文时按该值引导，且幂等', async () => {
    const devKey = 'nppt_' + 'a'.repeat(32);
    await service.ensureDevKey(devKey);
    expect(await service.verifyKey(devKey)).not.toBeNull();
    await service.ensureDevKey(devKey);
    expect(service.listKeys().filter((k) => k.name === 'dev')).toHaveLength(1);
  });

  it('ensureDevKey：空值不创建任何 Key', async () => {
    await service.ensureDevKey('');
    expect(service.listKeys()).toHaveLength(0);
  });
});
