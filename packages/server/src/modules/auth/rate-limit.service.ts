import { Injectable } from '@nestjs/common';
import type { ApiKeyRecord, RateLimitBucketConfig } from './api-key.service';
import { readMcpEnv } from '../../common/env';

/**
 * 每 Key 限流（规格 2.5.3 / FR-3 / FR-4）：进程内滑动窗口。
 *
 * - 桶维度：`${bucket}:${keyId}:${userKey}`，两桶（generate / edit）配额互不消耗；
 * - 单次判定 O(窗口内条数)，无 I/O，满足 NFR-2（<1ms）；
 * - 每 60s 清理空桶，防 `Map` 无界增长（NFR-8 替换点：可整体换 Redis，接口不变）。
 */

export type RateLimitBucket = 'generate' | 'edit';

export interface RateLimitConfig extends RateLimitBucketConfig {
  /** 配额来源，便于日志/审计追溯 */
  source: 'key' | 'env' | 'default';
}

export interface ConsumeResult {
  allowed: boolean;
  /** 被拒时距下次可用的毫秒数；放行时为 0 */
  retryAfterMs: number;
  remaining: number;
  limit: number;
}

const CLEANUP_INTERVAL_MS = 60_000;

@Injectable()
export class RateLimitService {
  /** key = `${bucket}:${keyId}:${userKey}` → 窗口内的调用时间戳数组（升序） */
  private readonly buckets = new Map<string, number[]>();
  private cleanupTimer?: NodeJS.Timeout;

  constructor() {
    this.cleanupTimer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS);
    // 不阻止进程退出
    this.cleanupTimer.unref?.();
  }

  /** 仅清理空桶；非空桶的过期时间戳在 consume 时惰性淘汰。 */
  private cleanup(): void {
    for (const [key, timestamps] of this.buckets) {
      if (!timestamps || timestamps.length === 0) this.buckets.delete(key);
    }
  }

  /**
   * 消耗一次配额。
   * @param windowMs 滑动窗口长度
   */
  consume(bucket: RateLimitBucket, scopeKey: string, limit: number, windowMs: number, now: number = Date.now()): ConsumeResult {
    const key = `${bucket}:${scopeKey}`;
    const safeLimit = Math.max(0, Math.floor(limit));
    const safeWindow = Math.max(1, Math.floor(windowMs));
    const cutoff = now - safeWindow;

    let timestamps = this.buckets.get(key);
    if (!timestamps) {
      timestamps = [];
      this.buckets.set(key, timestamps);
    }
    // 1) 清掉窗口外的时间戳
    let drop = 0;
    while (drop < timestamps.length && timestamps[drop] <= cutoff) drop++;
    if (drop > 0) timestamps.splice(0, drop);

    // 2) 超限 → 拒绝，retryAfterMs = 窗口内最早时间戳 + window - now
    if (timestamps.length >= safeLimit) {
      const retryAfterMs = Math.max(1, timestamps[0] + safeWindow - now);
      return { allowed: false, retryAfterMs, remaining: 0, limit: safeLimit };
    }

    // 3) 放行
    timestamps.push(now);
    return { allowed: true, retryAfterMs: 0, remaining: safeLimit - timestamps.length, limit: safeLimit };
  }

  /** 当前桶内条数（测试/观测用）。 */
  peek(bucket: RateLimitBucket, scopeKey: string): number {
    return this.buckets.get(`${bucket}:${scopeKey}`)?.length ?? 0;
  }

  /** 桶数量（测试/观测用）。 */
  size(): number {
    return this.buckets.size;
  }

  /** 清空全部状态（测试用）。 */
  reset(): void {
    this.buckets.clear();
  }

  /** 进程退出时释放定时器。 */
  onModuleDestroy(): void {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    this.cleanupTimer = undefined;
  }
}

/**
 * 配额优先级（规格 2.5.3）：Key 记录 rateLimit.{bucket} > 环境变量 > 内置默认。
 */
export function resolveRateLimitConfig(bucket: RateLimitBucket, record?: Pick<ApiKeyRecord, 'rateLimit'>): RateLimitConfig {
  const fromKey = record?.rateLimit?.[bucket];
  if (fromKey && Number.isFinite(fromKey.limit) && fromKey.limit > 0) {
    return {
      limit: Math.floor(fromKey.limit),
      windowMs: Number.isFinite(fromKey.windowMs) && fromKey.windowMs > 0 ? Math.floor(fromKey.windowMs) : 60_000,
      source: 'key',
    };
  }
  const env = readMcpEnv();
  if (bucket === 'generate') {
    return { limit: env.rateLimitGenerate, windowMs: env.rateLimitWindowMs, source: 'env' };
  }
  return { limit: env.rateLimitEdit, windowMs: env.rateLimitWindowMs, source: 'env' };
}
