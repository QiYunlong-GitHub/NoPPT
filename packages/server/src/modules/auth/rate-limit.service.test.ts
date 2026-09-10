import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RateLimitService, resolveRateLimitConfig } from './rate-limit.service';
import {
  enforceRateLimit,
  RATE_LIMITED_TOOLS,
  RateLimit,
  rateLimitScopeKey,
} from './rate-limit.guard';
import type { ApiKeyRecord } from './api-key.service';
import type { McpAuth } from './api-key.guard';
import { McpError } from '../../common/mcp-errors';

/**
 * TC-105 / TC-106（规格 5.2.1）：滑动窗口、配额独立、retryAfterMs 计算、空桶清理；
 * 以及 get / export / list 三个工具不受限流影响。
 */
describe('M3 限流', () => {
  let service: RateLimitService;

  const makeAuth = (
    keyId: string,
    userKey: string,
    record: Partial<ApiKeyRecord> = {},
  ): McpAuth => ({
    keyId,
    userKey,
    tenantId: 'default',
    record: {
      id: keyId,
      name: 'n',
      tenantId: 'default',
      userKey,
      enabled: true,
      keyHash: 'sha256:x',
      createdAt: 0,
      ...record,
    } as ApiKeyRecord,
  });

  beforeEach(() => {
    service = new RateLimitService();
    process.env.NOPPT_RATE_LIMIT_GENERATE = '10';
    process.env.NOPPT_RATE_LIMIT_EDIT = '10';
    process.env.NOPPT_RATE_LIMIT_WINDOW_MS = '60000';
  });

  afterEach(() => {
    service.onModuleDestroy();
    delete process.env.NOPPT_RATE_LIMIT_GENERATE;
    delete process.env.NOPPT_RATE_LIMIT_EDIT;
    delete process.env.NOPPT_RATE_LIMIT_WINDOW_MS;
  });

  describe('TC-105 RateLimitService', () => {
    it('配额内放行，超出后拒绝并给出 retryAfterMs', () => {
      const res1 = service.consume('generate', 'k1:alice', 2, 60_000, 1_000);
      expect(res1.allowed).toBe(true);
      expect(res1.remaining).toBe(1);
      const res2 = service.consume('generate', 'k1:alice', 2, 60_000, 1_000);
      expect(res2.allowed).toBe(true);
      expect(res2.remaining).toBe(0);
      const res3 = service.consume('generate', 'k1:alice', 2, 60_000, 1_000);
      expect(res3.allowed).toBe(false);
      expect(res3.retryAfterMs).toBe(1_000 + 60_000 - 1_000);
    });

    it('retryAfterMs 随窗口滑动递减', () => {
      service.consume('generate', 'k1:alice', 1, 60_000, 0);
      const a = service.consume('generate', 'k1:alice', 1, 60_000, 10_000);
      expect(a.allowed).toBe(false);
      expect(a.retryAfterMs).toBe(50_000);
      const b = service.consume('generate', 'k1:alice', 1, 60_000, 40_000);
      expect(b.retryAfterMs).toBe(20_000);
    });

    it('窗口外调用正确放行（滑动而非固定窗口）', () => {
      service.consume('generate', 'k1:alice', 1, 60_000, 0);
      expect(service.consume('generate', 'k1:alice', 1, 60_000, 30_000).allowed).toBe(false);
      expect(service.consume('generate', 'k1:alice', 1, 60_000, 60_001).allowed).toBe(true);
    });

    it('不同 keyId:userKey 配额互相独立', () => {
      service.consume('generate', 'k1:alice', 1, 60_000, 0);
      expect(service.consume('generate', 'k1:alice', 1, 60_000, 0).allowed).toBe(false);
      expect(service.consume('generate', 'k1:bob', 1, 60_000, 0).allowed).toBe(true);
      expect(service.consume('generate', 'k2:alice', 1, 60_000, 0).allowed).toBe(true);
    });

    it('generate 与 edit 双桶互不消耗', () => {
      const auth = makeAuth('k1', 'alice');
      service.consume('generate', rateLimitScopeKey(auth), 1, 60_000, 0);
      expect(service.consume('generate', rateLimitScopeKey(auth), 1, 60_000, 0).allowed).toBe(
        false,
      );
      expect(service.consume('edit', rateLimitScopeKey(auth), 1, 60_000, 0).allowed).toBe(true);
      expect(service.consume('edit', rateLimitScopeKey(auth), 1, 60_000, 0).allowed).toBe(false);
    });

    it('空桶会被 cleanup 回收（防内存泄漏）', () => {
      service.consume('generate', 'k1:alice', 1, 60_000, 0);
      expect(service.size()).toBe(1);
      // 直接触发私有 cleanup：通过构造后调用 consume 再清桶
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (service as any).buckets.get('generate:k1:alice').length = 0;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (service as any).cleanup();
      expect(service.size()).toBe(0);
    });

    it('reset 清空全部状态', () => {
      service.consume('generate', 'k1:alice', 5, 60_000, 0);
      service.reset();
      expect(service.peek('generate', 'k1:alice')).toBe(0);
    });
  });

  describe('TC-105 配额优先级', () => {
    it('Key 记录优先于环境变量', () => {
      const cfg = resolveRateLimitConfig('generate', {
        rateLimit: { generate: { limit: 2, windowMs: 30_000 } },
      } as ApiKeyRecord);
      expect(cfg).toEqual({ limit: 2, windowMs: 30_000, source: 'key' });
    });

    it('无 Key 配置时回退环境变量', () => {
      process.env.NOPPT_RATE_LIMIT_GENERATE = '3';
      const cfg = resolveRateLimitConfig('generate');
      expect(cfg).toMatchObject({ limit: 3, windowMs: 60_000, source: 'env' });
    });

    it('edit 桶读取 NOPPT_RATE_LIMIT_EDIT', () => {
      process.env.NOPPT_RATE_LIMIT_EDIT = '7';
      expect(resolveRateLimitConfig('edit').limit).toBe(7);
    });
  });

  describe('TC-106 工具限流分布', () => {
    it('generate 与三个编辑工具受限流；get/export/list 不限流', () => {
      expect(RATE_LIMITED_TOOLS.noppt_generate).toBe('generate');
      expect(RATE_LIMITED_TOOLS.noppt_edit_slide).toBe('edit');
      expect(RATE_LIMITED_TOOLS.noppt_edit_element).toBe('edit');
      expect(RATE_LIMITED_TOOLS.noppt_edit_global).toBe('edit');
      expect(RATE_LIMITED_TOOLS.noppt_get_presentation).toBeUndefined();
      expect(RATE_LIMITED_TOOLS.noppt_export_html).toBeUndefined();
      expect(RATE_LIMITED_TOOLS.noppt_list_templates).toBeUndefined();
    });

    it('enforceRateLimit 超限时抛出带 retryAfterMs 的 McpError', () => {
      const auth = makeAuth('k1', 'alice', {
        rateLimit: { generate: { limit: 1, windowMs: 60_000 } },
      });
      expect(() => enforceRateLimit(service, 'generate', auth)).not.toThrow();
      try {
        enforceRateLimit(service, 'generate', auth);
        throw new Error('should not reach');
      } catch (e) {
        expect(e).toBeInstanceOf(McpError);
        expect((e as McpError).code).toBe('E2001');
        expect((e as McpError).toBody().retryAfterMs).toBeGreaterThan(0);
      }
    });

    it('@RateLimit 装饰器在执行业务前按桶限流', async () => {
      class Target {
        constructor(public rateLimitService: RateLimitService) {}

        @RateLimit('generate')
        async generate(_args: unknown, _auth: McpAuth): Promise<string> {
          return 'ok';
        }
      }
      const auth = makeAuth('k9', 'carol', {
        rateLimit: { generate: { limit: 1, windowMs: 60_000 } },
      });
      const target = new Target(service);
      await expect(target.generate({}, auth)).resolves.toBe('ok');
      await expect(target.generate({}, auth)).rejects.toMatchObject({ code: 'E2001' });
      // 无 auth 时装饰器跳过限流（供内部直调场景）
      await expect(target.generate({}, undefined as unknown as McpAuth)).resolves.toBe('ok');
    });

    it('低配额 edit Key 第 2 次编辑被拒，但不影响 generate 配额', () => {
      const auth = makeAuth('k1', 'alice', { rateLimit: { edit: { limit: 1, windowMs: 60_000 } } });
      expect(() => enforceRateLimit(service, 'edit', auth)).not.toThrow();
      expect(() => enforceRateLimit(service, 'edit', auth)).toThrow(McpError);
      expect(() => enforceRateLimit(service, 'generate', auth)).not.toThrow();
      expect(() => enforceRateLimit(service, 'generate', auth)).not.toThrow();
    });
  });
});
