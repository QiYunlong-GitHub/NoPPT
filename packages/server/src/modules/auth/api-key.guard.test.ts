import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { authenticateRequest, extractBearer, ApiKeyGuard } from './api-key.guard';
import { ApiKeyService } from './api-key.service';
import { PublicRoute } from './public-metadata.decorator';
import { McpError } from '../../common/mcp-errors';

/** TC-104 补充：Bearer 校验流程与 E1001/E1002/E1003 分类。 */
describe('M2 authenticateRequest', () => {
  let tmpRoot: string;
  let cwdSpy: ReturnType<typeof vi.spyOn>;
  let service: ApiKeyService;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'noppt-guard-test-'));
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

  it('extractBearer 解析成功；缺失 / 非 Bearer / 空值返回 null', () => {
    expect(extractBearer({ headers: { authorization: 'Bearer nppt_abc' } })).toBe('nppt_abc');
    expect(extractBearer({ headers: { authorization: 'bearer nppt_abc' } })).toBe('nppt_abc');
    expect(extractBearer({ headers: {} })).toBeNull();
    expect(extractBearer({ headers: { authorization: 'Basic xyz' } })).toBeNull();
    expect(extractBearer({ headers: { authorization: 'Bearer ' } })).toBeNull();
  });

  it('缺少 Authorization → E1001', async () => {
    await expect(authenticateRequest({ headers: {} }, service)).rejects.toMatchObject({
      code: 'E1001',
    });
  });

  it('无效 Key → E1002', async () => {
    await expect(
      authenticateRequest({ headers: { authorization: 'Bearer nppt_' + '0'.repeat(32) } }, service),
    ).rejects.toMatchObject({ code: 'E1002' });
  });

  it('已吊销 Key → E1003', async () => {
    const { key, record } = await service.createKey({ name: 'k1' });
    await service.revokeKey(record.id);
    await expect(
      authenticateRequest({ headers: { authorization: `Bearer ${key}` } }, service),
    ).rejects.toMatchObject({
      code: 'E1003',
    });
  });

  it('有效 Key → 返回 keyId/tenantId/userKey', async () => {
    const { key } = await service.createKey({ name: 'k1', tenantId: 'acme', userKey: 'bob' });
    const auth = await authenticateRequest(
      { headers: { authorization: `Bearer ${key}` } },
      service,
    );
    expect(auth.tenantId).toBe('acme');
    expect(auth.userKey).toBe('bob');
    expect(auth.keyId).toMatch(/^k_/);
    expect(auth.record.enabled).toBe(true);
  });

  it('抛出的错误为 McpError 且错误体不含堆栈', async () => {
    try {
      await authenticateRequest({ headers: {} }, service);
    } catch (e) {
      expect(e).toBeInstanceOf(McpError);
      const body = (e as McpError).toBody();
      expect(body.error).toBe('missing_authorization');
      expect(JSON.stringify(body)).not.toContain('at ');
    }
  });
});

describe('ApiKeyGuard route boundaries', () => {
  let tmpRoot: string;
  let cwdSpy: ReturnType<typeof vi.spyOn>;
  let service: ApiKeyService;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'noppt-guard-boundary-test-'));
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tmpRoot);
    service = new ApiKeyService();
  });

  afterEach(() => {
    cwdSpy.mockRestore();
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('bypasses only handlers/classes explicitly marked with public metadata', async () => {
    class PublicController {}
    PublicRoute()(PublicController);
    const handler = () => undefined;
    const context = {
      getHandler: () => handler,
      getClass: () => PublicController,
      switchToHttp: () => ({ getRequest: () => ({ headers: {} }) }),
    } as unknown as ExecutionContext;

    await expect(new ApiKeyGuard(service, new Reflector()).canActivate(context)).resolves.toBe(
      true,
    );
  });

  it('rejects an unannotated normal REST request with structured 401 data', async () => {
    class NormalController {}
    const context = {
      getHandler: () => () => undefined,
      getClass: () => NormalController,
      switchToHttp: () => ({ getRequest: () => ({ headers: {} }) }),
    } as unknown as ExecutionContext;

    const error = await new ApiKeyGuard(service, new Reflector())
      .canActivate(context)
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 401 });
    expect((error as { getResponse: () => unknown }).getResponse()).toMatchObject({
      error: 'missing_authorization',
    });
  });
});
