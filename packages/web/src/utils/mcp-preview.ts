export const MCP_PREVIEW_MAX_TOTAL = 10_000;

export interface McpIndexMessage {
  type: 'noppt:index';
  index: number;
  total: number;
}

/** Validate both the message source and the exact bounded navigation payload. */
export function parseMcpIndexMessage(
  event: Pick<MessageEvent, 'source' | 'data'>,
  expectedSource: Window | null,
): McpIndexMessage | null {
  if (!expectedSource || event.source !== expectedSource) return null;
  const data = event.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const keys = Object.keys(data as Record<string, unknown>).sort();
  if (keys.join(',') !== 'index,total,type') return null;

  const payload = data as Record<string, unknown>;
  if (payload.type !== 'noppt:index') return null;
  if (
    typeof payload.index !== 'number' ||
    !Number.isFinite(payload.index) ||
    !Number.isInteger(payload.index) ||
    payload.index < 0
  ) {
    return null;
  }
  if (
    typeof payload.total !== 'number' ||
    !Number.isFinite(payload.total) ||
    !Number.isInteger(payload.total) ||
    payload.total < 1 ||
    payload.total > MCP_PREVIEW_MAX_TOTAL ||
    payload.index >= payload.total
  ) {
    return null;
  }

  return {
    type: 'noppt:index',
    index: payload.index,
    total: payload.total,
  };
}
