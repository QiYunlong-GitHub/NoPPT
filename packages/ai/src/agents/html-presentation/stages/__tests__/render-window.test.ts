import { describe, expect, it } from 'vitest';
import type { PresentationPlan } from '../../../../types';
import { resolveRenderWindow } from '../render-window';

function makePlan(count: number): PresentationPlan {
  return {
    title: 't',
    primaryColor: '#2563eb',
    slides: Array.from({ length: count }, (_, i) => ({
      pageType: 'content-no-image',
      title: `页 ${i + 1}`,
      keyPoints: ['要点'],
      needsImage: false,
    })),
  };
}

describe('render window resolution', () => {
  it('recognizes only the guided first-slide preview window', () => {
    expect(resolveRenderWindow(makePlan(5), { startIndex: 0, endIndex: 1 })).toEqual({
      startIdx: 0,
      endIdx: 1,
      isFirstSlidePreview: true,
    });
  });

  it('keeps full-generation and local-regeneration windows strict', () => {
    expect(resolveRenderWindow(makePlan(5)).isFirstSlidePreview).toBe(false);
    expect(resolveRenderWindow(makePlan(5), { startIndex: 1 }).isFirstSlidePreview).toBe(false);
    expect(resolveRenderWindow(makePlan(5), { startIndex: 0, endIndex: 2 }).isFirstSlidePreview).toBe(false);
    expect(resolveRenderWindow(makePlan(1), { startIndex: 0, endIndex: 1 }).isFirstSlidePreview).toBe(false);
  });

  it('clamps indexes without slicing the plan', () => {
    const plan = makePlan(3);
    expect(resolveRenderWindow(plan, { startIndex: -2, endIndex: 99 })).toEqual({
      startIdx: 0,
      endIdx: 3,
      isFirstSlidePreview: false,
    });
    expect(plan.slides).toHaveLength(3);
  });
});
