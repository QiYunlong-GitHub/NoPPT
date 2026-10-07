import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { buildApiHeaders } from './api';

describe('buildApiHeaders', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_NOPPT_API_KEY', 'configured-test-key');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('adds the configured Bearer key while preserving caller headers', () => {
    const headers = buildApiHeaders({ 'X-Caller': 'kept' });

    expect(headers.get('Authorization')).toBe('Bearer configured-test-key');
    expect(headers.get('X-Caller')).toBe('kept');
    expect(headers.get('Content-Type')).toBe('application/json');
  });

  it('does not overwrite caller Authorization and supports multipart headers', () => {
    const headers = buildApiHeaders(
      { Authorization: 'Bearer caller-key', 'X-Caller': 'kept' },
      false,
    );

    expect(headers.get('Authorization')).toBe('Bearer caller-key');
    expect(headers.get('X-Caller')).toBe('kept');
    expect(headers.get('Content-Type')).toBeNull();
  });

  it('omits Authorization when no key is configured', () => {
    vi.stubEnv('VITE_NOPPT_API_KEY', '');
    const headers = buildApiHeaders(undefined, false);

    expect(headers.has('Authorization')).toBe(false);
  });
});
