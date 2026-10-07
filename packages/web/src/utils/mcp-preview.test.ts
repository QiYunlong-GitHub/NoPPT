import { describe, expect, it } from 'vitest';
import { MCP_PREVIEW_MAX_TOTAL, parseMcpIndexMessage } from './mcp-preview';

describe('MCP preview message validation', () => {
  const frame = {} as Window;
  const event = (data: unknown, source: Window | null = frame) => ({ data, source });

  it('accepts only a bounded message from the iframe window', () => {
    expect(parseMcpIndexMessage(event({ type: 'noppt:index', index: 1, total: 3 }), frame)).toEqual(
      { type: 'noppt:index', index: 1, total: 3 },
    );
    expect(
      parseMcpIndexMessage(event({ type: 'noppt:index', index: 1, total: 3 }), {} as Window),
    ).toBeNull();
  });

  it('rejects malformed, non-integer, out-of-range, and oversized payloads', () => {
    const invalid = [
      null,
      'noppt:index',
      { type: 'other', index: 0, total: 1 },
      { type: 'noppt:index', index: 0.5, total: 1 },
      { type: 'noppt:index', index: -1, total: 1 },
      { type: 'noppt:index', index: 1, total: 1 },
      { type: 'noppt:index', index: 0, total: MCP_PREVIEW_MAX_TOTAL + 1 },
      { type: 'noppt:index', index: 0, total: 1, extra: true },
    ];
    for (const data of invalid) expect(parseMcpIndexMessage(event(data), frame)).toBeNull();
  });
});
