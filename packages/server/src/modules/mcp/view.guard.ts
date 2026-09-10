import type { Request } from 'express';
import { envStr } from '../../common/env';

/**
 * 只读预览访问控制 ViewGuard（规格 2.5.7 / 2.6）。
 *
 * - 未配置 `NOPPT_MCP_VIEW_TOKEN`：仅允许本机回环访问（`127.0.0.1` / `::1`）；
 * - 配置了 token：所有来源（含本机）都必须带 `?token=` 或 `X-View-Token`，且值匹配。
 */

const LOOPBACK_IPS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost']);

export function isLoopbackRequest(req: Pick<Request, 'ip' | 'socket'>): boolean {
  const ip = (req as { ip?: string })?.ip || '';
  if (!ip) return false;
  if (LOOPBACK_IPS.has(ip)) return true;
  return /^127\./.test(ip) || ip === '::ffff:127.0.0.1';
}

export interface ViewGuardResult {
  ok: boolean;
  /** 拒绝时的 HTTP 状态码（固定 403） */
  status: 403;
  /** 拒绝时的结构化错误体 */
  body: { error: string; message: string };
}

export function checkViewAccess(req: Pick<Request, 'ip' | 'socket' | 'query' | 'headers'>): ViewGuardResult {
  const token = envStr('NOPPT_MCP_VIEW_TOKEN');
  if (token) {
    const queryToken = (req.query as Record<string, unknown>)?.token;
    const headerToken = (req.headers as Record<string, unknown>)?.['x-view-token'];
    const provided = typeof queryToken === 'string' ? queryToken : typeof headerToken === 'string' ? headerToken : '';
    if (provided !== token) {
      return { ok: false, status: 403, body: { error: 'forbidden', message: '缺少或错误的预览访问令牌' } };
    }
    return { ok: true, status: 403, body: { error: '', message: '' } };
  }
  if (!isLoopbackRequest(req)) {
    return {
      ok: false,
      status: 403,
      body: { error: 'forbidden', message: '只读预览仅允许本机访问，或配置 NOPPT_MCP_VIEW_TOKEN' },
    };
  }
  return { ok: true, status: 403, body: { error: '', message: '' } };
}
