import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { KeysController } from './keys.controller';
import { ApiKeyService, isPlainKeyFormat } from './api-key.service';

/**
 * TC-104（规格 5.2.1）：管理接口的 x-admin-key 保护与明文返回。
 * 直接实例化控制器，不依赖 Nest DI 容器。
 */
describe('M2 KeysController', () => {
  let tmpRoot: string;
  let cwdSpy: ReturnType<typeof vi.spyOn>;
  let service: ApiKeyService;
  let controller: KeysController;
  const ADMIN = 'test-admin-key';

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'noppt-keys-ctrl-test-'));
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tmpRoot);
    service = new ApiKeyService();
    controller = new KeysController(service);
    process.env.NOPPT_ADMIN_KEY = ADMIN;
  });

  afterEach(() => {
    delete process.env.NOPPT_ADMIN_KEY;
    cwdSpy.mockRestore();
    try {
      rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('未配置 NOPPT_ADMIN_KEY → 503', async () => {
    delete process.env.NOPPT_ADMIN_KEY;
    await expect(controller.create(ADMIN, { name: 'x' })).rejects.toMatchObject({ status: 503 });
    expect(() => controller.list(ADMIN)).toThrow(expect.objectContaining({ status: 503 }));
  });

  it('缺少 x-admin-key → 401', async () => {
    await expect(controller.create(undefined, { name: 'x' })).rejects.toMatchObject({
      status: 401,
    });
    expect(() => controller.list(undefined)).toThrow(expect.objectContaining({ status: 401 }));
  });

  it('x-admin-key 不匹配 → 403', async () => {
    await expect(controller.create('wrong', { name: 'x' })).rejects.toMatchObject({ status: 403 });
    expect(() => controller.list('wrong')).toThrow(expect.objectContaining({ status: 403 }));
  });

  it('POST 返回明文 key（仅此一次）且列表脱敏', async () => {
    const res = await controller.create(ADMIN, {
      name: 'hermes-prod',
      tenantId: 't1',
      userKey: 'alice',
    });
    expect(isPlainKeyFormat(res.key)).toBe(true);
    expect(res.record.name).toBe('hermes-prod');
    expect(res.record.tenantId).toBe('t1');
    expect(res.record.userKey).toBe('alice');
    expect((res.record as Record<string, unknown>).keyHash).toBeUndefined();

    const list = controller.list(ADMIN);
    expect(list).toHaveLength(1);
    expect(list.some((r) => JSON.stringify(r).includes(res.key))).toBe(false);
  });

  it('POST 缺 name → 400', async () => {
    await expect(controller.create(ADMIN, { name: '' })).rejects.toMatchObject({ status: 400 });
  });

  it('DELETE 成功返回 success；未知 id → 404', async () => {
    const { record } = await controller.create(ADMIN, { name: 'to-revoke' });
    expect(await controller.revoke(ADMIN, record.id)).toEqual({ success: true });
    expect(controller.list(ADMIN)[0].enabled).toBe(false);
    await expect(controller.revoke(ADMIN, 'k_unknown')).rejects.toMatchObject({ status: 404 });
  });

  it('POST 的 rateLimit 被规范化，非法值被丢弃', async () => {
    const res = await controller.create(ADMIN, {
      name: 'rl',
      rateLimit: { generate: { limit: 5, windowMs: 60000 }, edit: { limit: 0, windowMs: 1 } },
    });
    expect(res.record.rateLimit?.generate).toEqual({ limit: 5, windowMs: 60000 });
    expect(res.record.rateLimit?.edit).toBeUndefined();
  });
});
