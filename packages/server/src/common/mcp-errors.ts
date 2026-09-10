/**
 * MCP 统一错误码与结构化错误体（对应规格文档 2.7 / 附录 B）。
 *
 * 边界约定（规格 3.2）：
 * - E1xxx（认证/鉴权）→ HTTP 401；
 * - 其余（E2xxx 限流 / E3xxx 参数 / E4xxx 作用域 / E5xxx 业务）→ HTTP 200 + MCP `isError:true`；
 * - 错误体只含 `error` 枚举、`message` 与可选 `retryAfterMs` / `field`，
 *   **绝不回传异常堆栈、config.json 的模型 apiKey 或 baseUrl**（NFR-4）。
 */

import { translate } from '../i18n/translate';
import { zhByCode } from '../i18n/messages/zh-CN';
import type { Locale, MessageParams } from '../i18n/types';

export type McpErrorCode =
  | 'E1001'
  | 'E1002'
  | 'E1003'
  | 'E1004'
  | 'E1005'
  | 'E1006'
  | 'E2001'
  | 'E2002'
  | 'E3001'
  | 'E3002'
  | 'E3003'
  | 'E3004'
  | 'E3005'
  | 'E4001'
  | 'E4002'
  | 'E5001'
  | 'E5002'
  | 'E5003'
  | 'E5004'
  | 'E5005'
  | 'E5006'
  | 'E5007'
  | 'E5008';

/** `error` 字段枚举值：调用方据此分支处理，不解析 message 文案。 */
export const MCP_ERROR_NAMES: Record<McpErrorCode, string> = {
  E1001: 'missing_authorization',
  E1002: 'invalid_api_key',
  E1003: 'api_key_disabled',
  E1004: 'missing_admin_key',
  E1005: 'admin_key_mismatch',
  E1006: 'admin_key_not_configured',
  E2001: 'rate_limited',
  E2002: 'rate_limited',
  E3001: 'missing_topic',
  E3002: 'invalid_argument',
  E3003: 'reference_html_too_large',
  E3004: 'reference_image_too_large',
  E3005: 'schema_validation_failed',
  E4001: 'forbidden_scope',
  E4002: 'invalid_scope',
  E5001: 'presentation_not_found',
  E5002: 'slide_locate_failed',
  E5003: 'selector_not_found',
  E5004: 'too_many_slides',
  E5005: 'internal_error',
  E5006: 'job_not_found',
  E5007: 'draft_not_found',
  E5008: 'draft_expired',
};

export interface McpErrorBody {
  error: string;
  message: string;
  retryAfterMs?: number;
  field?: string;
}

/** 业务/协议错误。抛出后由 MCP 控制器转成 `isError:true` 的结构化响应。 */
export class McpError extends Error {
  public readonly code: McpErrorCode;
  public readonly params?: MessageParams;
  public readonly extra?: Record<string, unknown>;

  /**
   * @param code    错误码
   * @param message 可选。指定后作为该次报文的原始文案（仍会经 translate 做英文回退与脱敏）；
   *                不指定则按 `zhByCode[code]` 模板渲染，支持 params 插值。
   * @param params  `{name}` 插值参数（如 {index}/{jobId}/{seconds}）。
   * @param extra   透传到报文的结构化字段（retryAfterMs / field / bucket 等）。
   */
  constructor(
    code: McpErrorCode,
    message?: string,
    params?: MessageParams,
    extra?: Record<string, unknown>,
  ) {
    super(message ?? zhByCode[code] ?? MCP_ERROR_NAMES[code] ?? 'internal_error');
    this.name = 'McpError';
    this.code = code;
    this.params = params;
    this.extra = extra;
  }

  /** 转成写入 MCP `content[].text` 的 JSON 错误体。locale 缺省按 zh-CN，保持既有行为。 */
  toBody(locale: Locale = 'zh-CN'): McpErrorBody {
    const source = this.message || zhByCode[this.code] || 'internal_error';
    const rendered = translate(source, locale, this.params);
    const safe = sanitizeMessage(rendered);
    const body: McpErrorBody = {
      error: MCP_ERROR_NAMES[this.code] || 'internal_error',
      message: safe,
    };
    if (typeof this.extra?.retryAfterMs === 'number') body.retryAfterMs = this.extra.retryAfterMs;
    const field = this.extra?.field ?? this.params?.field;
    if (typeof field === 'string') body.field = field;
    return body;
  }
}

/** 判断任意抛出物是否为 McpError（避免 instanceof 跨包失真）。 */
export function isMcpError(e: unknown): e is McpError {
  return !!e && typeof e === 'object' && (e as { name?: string }).name === 'McpError';
}

/**
 * 把任意异常归一为 McpError。
 * 非 McpError 一律降级为 E5005 且只保留 message 摘要，**不回传堆栈**。
 */
export function toMcpError(e: unknown): McpError {
  if (isMcpError(e)) return e;
  const message = e instanceof Error ? e.message : String(e);
  // 非 McpError 一律降级为 E5005，文案由 zhByCode 渲染（不回传原始异常细节）
  return new McpError('E5005');
}

/**
 * 抹除可能泄漏的敏感片段（模型 apiKey / baseUrl / 绝对路径）。
 * 双保险：即便上游把 provider 原始错误（含 baseUrl）抛上来也不会外泄。
 */
export function sanitizeMessage(message: string): string {
  if (!message) return '内部错误';
  return message
    .replace(/(https?:\/\/[^\s'"）)]+)/gi, '[url]')
    .replace(/(sk-[A-Za-z0-9_-]{6,})/g, '[key]')
    .replace(/([A-Za-z0-9_-]{32,})/g, '[token]')
    .slice(0, 500);
}
