import { McpError } from '../../common/mcp-errors';
import type { McpEnv } from '../../common/env';

/**
 * RAG 素材入参的校验与归一化（规格 2.5.8 / TC-110）。
 * 独立成文件以便单测覆盖，且不牵连 MCP 控制器与 Nest 依赖。
 */

/** referenceHtml 文本上限（约 2MB，规格 2.5.8「大小约束」）。 */
export const MAX_REFERENCE_HTML_BYTES = 2 * 1024 * 1024;

export interface NormalizedReferenceInput {
  referenceText?: string;
  truncated: boolean;
}

/**
 * referenceText 硬截断。
 * - `maxChars <= 0` 视为不限制；
 * - 空值/非字符串 → 原样返回，`truncated=false`。
 */
export function truncateReferenceText(text: unknown, maxChars: number): NormalizedReferenceInput {
  // 空串与纯空白一律视为「无素材」
  if (typeof text !== 'string' || !text.trim()) return { referenceText: undefined, truncated: false };
  if (!Number.isFinite(maxChars) || maxChars <= 0) return { referenceText: text, truncated: false };
  if (text.length <= maxChars) return { referenceText: text, truncated: false };
  return { referenceText: text.slice(0, maxChars), truncated: true };
}

/** data URL 的近似字节数（base64 部分按 3/4 折算）。 */
export function dataUrlBytes(dataUrl: string): number {
  const base64 = (dataUrl || '').split(',')[1] || '';
  return Math.floor((base64.length * 3) / 4);
}

/** 字符串 UTF-8 字节数。 */
export function byteLength(s: string): number {
  return Buffer.byteLength(s || '', 'utf-8');
}

/**
 * 素材大小校验：超限抛 E3003 / E3004。
 * 远程 http(s) 图片无法预知体积，交由下游 `saveImageFromUrl` 处理。
 */
export function assertReferenceSizes(input: { referenceHtml?: unknown; referenceImage?: unknown }, env: McpEnv): void {
  if (typeof input.referenceHtml === 'string' && byteLength(input.referenceHtml) > MAX_REFERENCE_HTML_BYTES) {
    throw new McpError('E3003');
  }
  if (typeof input.referenceImage === 'string' && input.referenceImage.startsWith('data:')) {
    if (dataUrlBytes(input.referenceImage) > env.maxRefImageBytes) {
      throw new McpError('E3004');
    }
  }
}
