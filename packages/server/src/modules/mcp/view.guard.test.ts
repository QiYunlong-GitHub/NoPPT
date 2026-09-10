import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { checkViewAccess, isLoopbackRequest } from './view.guard';
import { sanitizeScopeSegment } from '../../common/storage.service';
import { McpError } from '../../common/mcp-errors';

/** TC-109（规格 5.2.1）：ViewGuard 的 loopback 放行矩阵、token 判定与参数 sanitize。 */
describe('M7 ViewGuard', () => {
  beforeEach(() => {
    delete process.env.NOPPT_MCP_VIEW_TOKEN;
  });

  afterEach(() => {
    delete process.env.NOPPT_MCP_VIEW_TOKEN;
  });

  const req = (over: Record<string, unknown> = {}) =>
    ({ ip: '127.0.0.1', query: {}, headers: {}, ...over }) as never;

  describe('loopback 判定', () => {
    it.each(['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost', '127.0.1.5'])('放行回环地址 %s', (ip) => {
      expect(isLoopbackRequest({ ip } as never)).toBe(true);
    });

    it.each(['192.168.1.10', '10.0.0.5', '8.8.8.8', ''])('拒绝非回环地址 %s', (ip) => {
      expect(isLoopbackRequest({ ip } as never)).toBe(false);
    });
  });

  describe('未配置 token（默认仅本机）', () => {
    it('本机放行', () => {
      expect(checkViewAccess(req({ ip: '127.0.0.1' })).ok).toBe(true);
    });

    it('非本机拒绝 403', () => {
      const res = checkViewAccess(req({ ip: '203.0.113.9' }));
      expect(res.ok).toBe(false);
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('forbidden');
    });
  });

  describe('配置 token 后（所有来源均需校验）', () => {
    beforeEach(() => {
      process.env.NOPPT_MCP_VIEW_TOKEN = 'secret-token';
    });

    it('query 携带正确 token → 放行（即使非本机）', () => {
      expect(checkViewAccess(req({ ip: '203.0.113.9', query: { token: 'secret-token' } })).ok).toBe(true);
    });

    it('X-View-Token 头携带正确 token → 放行', () => {
      expect(checkViewAccess(req({ ip: '203.0.113.9', headers: { 'x-view-token': 'secret-token' } })).ok).toBe(true);
    });

    it('token 错误 → 403', () => {
      expect(checkViewAccess(req({ ip: '127.0.0.1', query: { token: 'wrong' } })).ok).toBe(false);
    });

    it('缺少 token → 403（本机也不例外）', () => {
      expect(checkViewAccess(req({ ip: '127.0.0.1' })).ok).toBe(false);
    });
  });

  describe('参数 sanitize（不触发文件系统读取前先校验）', () => {
    it.each(['..', 'a/b', '%2e%2e', '中文', ''])('拒绝非法作用域段 %s', (v) => {
      expect(() => sanitizeScopeSegment(v)).toThrow(McpError);
    });

    it('放行合法段', () => {
      expect(sanitizeScopeSegment('alice')).toBe('alice');
      expect(sanitizeScopeSegment('user-01')).toBe('user-01');
    });
  });
});
