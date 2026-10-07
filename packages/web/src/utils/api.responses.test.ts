import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assetsApi, draftApi, presentationApi } from './api';

const jsonResponse = (payload: unknown, ok = true, status = 200): Response =>
  ({
    ok,
    status,
    statusText: ok ? 'OK' : 'Bad Request',
    json: vi.fn().mockResolvedValue(payload),
  }) as unknown as Response;

const presentation = {
  id: 'p1',
  title: 'Test',
  slides: [{ id: 's1', title: 'Slide', html: '<div>ok</div>' }],
};

describe('API response boundaries', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects malformed JSON shapes and HTTP errors', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'p1' }));
    await expect(presentationApi.get('p1')).rejects.toThrow('Invalid presentation response');

    fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'nope' }, false, 500));
    await expect(presentationApi.get('p1')).rejects.toThrow('API Error: 500');
  });

  it('checks upload HTTP status and validates the returned asset', async () => {
    const fetchMock = vi.mocked(fetch);
    const file = new File(['image'], 'slide.png', { type: 'image/png' });
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'a1' }, false, 413));
    await expect(assetsApi.upload('p1', 'image', file)).rejects.toThrow('API Error: 413');

    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'a1' }));
    await expect(assetsApi.upload('p1', 'image', file)).rejects.toThrow('Invalid asset response');
  });

  it('validates successful draft responses without adding REST auth', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        draftId: 'd1',
        topic: 'Topic',
        referenceLimit: 3000,
        referenceTruncated: false,
        referenceOriginalChars: 10,
        mode: 'auto',
        expiresAt: Date.now() + 1000,
      }),
    );
    await expect(draftApi.get('d1', 'tenant', 'user', 'token')).resolves.toMatchObject({
      draftId: 'd1',
    });
    const [, options] = fetchMock.mock.calls[0];
    expect(new Headers(options?.headers).has('Authorization')).toBe(false);

    fetchMock.mockResolvedValueOnce(jsonResponse({ draftId: 'd1' }));
    await expect(draftApi.get('d1', 'tenant', 'user', 'token')).rejects.toThrow(
      'Invalid draft response',
    );
  });

  it('keeps valid presentation responses accepted', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(presentation));
    await expect(presentationApi.get('p1')).resolves.toMatchObject({ id: 'p1' });
  });
});
