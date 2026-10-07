import { describe, expect, it, vi } from 'vitest';
import type { Page } from 'playwright-core';
import { SlideRenderer } from './slide-renderer';

describe('SlideRenderer font readiness', () => {
  it('keeps an unavailable document.fonts API unverified', async () => {
    const page = {
      evaluate: vi.fn().mockResolvedValue({
        available: false,
        ready: false,
        status: 'unverified',
        reason: 'document.fonts is unavailable',
      }),
    } as unknown as Page;
    const renderer = new SlideRenderer();

    const readiness = await renderer.waitForFonts(page);

    expect(readiness.status).toBe('unverified');
    expect(renderer.getFontReadiness(page)).toEqual(readiness);
  });

  it('records a completed Font Loading API wait separately from font resolution', async () => {
    const page = {
      evaluate: vi.fn().mockResolvedValue({ available: true, ready: true, status: 'ready' }),
    } as unknown as Page;
    const renderer = new SlideRenderer();

    await expect(renderer.waitForFonts(page)).resolves.toMatchObject({
      available: true,
      ready: true,
      status: 'ready',
    });
  });
});
