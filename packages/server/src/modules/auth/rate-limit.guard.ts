import type { RateLimitBucket, RateLimitService } from './rate-limit.service';
import { resolveRateLimitConfig } from './rate-limit.service';
import type { McpAuth } from './api-key.guard';
import { McpError } from '../../common/mcp-errors';

/**
 * 限流装饰器与强制入口（规格 2.5.3）。
 *
 * MCP 工具处理函数统一约定签名为 `(args, auth)`，`@RateLimit(bucket)` 直接包裹方法，
 * 在执行业务逻辑前按 `keyId:userKey` 消耗配额；超限抛 `McpError`（E2001/E2002），
 * 由 MCP 控制器转成 HTTP 200 + `isError:true` + `retryAfterMs`。
 */

/** 需要限流的工具 → 桶。未列出的工具（`noppt_get_presentation` / `noppt_export_html` / `noppt_list_templates`）不限流。 */
export const RATE_LIMITED_TOOLS: Record<string, RateLimitBucket> = {
  noppt_generate: 'generate',
  noppt_edit_slide: 'edit',
  noppt_edit_element: 'edit',
  noppt_edit_global: 'edit',
};

export function rateLimitScopeKey(auth: McpAuth): string {
  return `${auth.keyId}:${auth.userKey}`;
}

/** 命令式限流入口（供工具处理函数与测试直接调用）。 */
export function enforceRateLimit(
  service: RateLimitService,
  bucket: RateLimitBucket,
  auth: McpAuth,
): void {
  const cfg = resolveRateLimitConfig(bucket, auth.record);
  const result = service.consume(bucket, rateLimitScopeKey(auth), cfg.limit, cfg.windowMs);
  if (!result.allowed) {
    throw new McpError(
      bucket === 'generate' ? 'E2001' : 'E2002',
      undefined,
      { seconds: Math.ceil(result.retryAfterMs / 1000) },
      { retryAfterMs: result.retryAfterMs, bucket },
    );
  }
}

/**
 * 方法装饰器：在执行前按桶限流。
 * 约定被装饰方法的第二个参数为 `McpAuth`（即签名 `(args, auth)`）。
 */
export function RateLimit(bucket: RateLimitBucket) {
  return function (
    _target: unknown,
    _propertyKey: string,
    descriptor: PropertyDescriptor,
  ): PropertyDescriptor {
    const original = descriptor.value as (...args: unknown[]) => unknown;
    descriptor.value = async function (
      this: { rateLimitService: RateLimitService },
      ...args: unknown[]
    ) {
      const auth = args[1] as McpAuth | undefined;
      if (auth && this?.rateLimitService) {
        enforceRateLimit(this.rateLimitService, bucket, auth);
      }
      return original.apply(this, args);
    };
    return descriptor;
  };
}
