import { describe, expect, it } from 'vitest';
import type { PresentationPlan, SlidePlan } from '../../../../types';
import { buildValidatedDeck } from '../plan-to-deck';
import { normalizeComparePlan, isPairedLegacyManifest } from '../compare-contract-normalizer';

function compareSlide(overrides: Partial<SlidePlan> = {}): SlidePlan {
  return {
    pageType: 'content-compare',
    title: '左右对比',
    keyPoints: ['左一', '左二', '右一', '右二'],
    needsImage: false,
    ...overrides,
  };
}

function planOf(...slides: SlidePlan[]): PresentationPlan {
  return { title: '对比页', primaryColor: '#2563eb', slides };
}

describe('compare contract normalizer', () => {
  it('pairs even non-empty legacy keyPoints into typed ownership with stable ids', () => {
    const result = normalizeComparePlan(planOf(compareSlide()));
    const slide = result.plan.slides[0];

    expect(slide.pageType).toBe('content-compare');
    expect(slide.comparisonItems?.map((item) => item.contentId)).toEqual([
      'strict-compare-0-0',
      'strict-compare-0-1',
      'strict-compare-0-2',
      'strict-compare-0-3',
    ]);
    expect(slide.comparisonItems?.map((item) => item.column)).toEqual(['left', 'left', 'right', 'right']);
    expect(slide.comparisonItems?.map((item) => item.order)).toEqual([0, 1, 0, 1]);
    expect(slide.legacyColumnManifest).toHaveLength(4);
    expect(result.notices.map((notice) => notice.strategy)).toEqual(['paired_legacy']);
  });

  it('degrades odd legacy keyPoints without dropping content', () => {
    const points = ['左一', '右一', '未配对项'];
    const result = normalizeComparePlan(planOf(compareSlide({ keyPoints: points })));
    const slide = result.plan.slides[0];

    expect(slide.pageType).toBe('content-no-image');
    expect(slide.keyPoints).toEqual(points);
    expect(slide.comparisonItems).toBeUndefined();
    expect(slide.legacyColumnManifest).toBeUndefined();
    expect(result.notices[0].strategy).toBe('degraded_to_cards');
    expect(result.notices[0].retainedPoints).toBe(3);
  });

  it('degrades single-point and empty-item compare pages', () => {
    const single = normalizeComparePlan(planOf(compareSlide({ keyPoints: ['只有一条'] })));
    expect(single.plan.slides[0].pageType).toBe('content-no-image');
    expect(single.plan.slides[0].keyPoints).toEqual(['只有一条']);

    const withEmpty = normalizeComparePlan(planOf(compareSlide({ keyPoints: ['左一', '', '右一', '右二'] })));
    expect(withEmpty.plan.slides[0].pageType).toBe('content-no-image');
    expect(withEmpty.plan.slides[0].keyPoints).toEqual(['左一', '右一', '右二']);
  });

  it('keeps a valid column manifest and degrades an invalid one', () => {
    const valid = normalizeComparePlan(planOf(compareSlide({
      legacyColumnManifest: [
        { column: 'left', order: 0 },
        { column: 'left', order: 1 },
        { column: 'right', order: 0 },
        { column: 'right', order: 1 },
      ],
    })));
    expect(valid.plan.slides[0].pageType).toBe('content-compare');
    expect(valid.notices).toHaveLength(0);
    expect(isPairedLegacyManifest([
      { column: 'left', order: 0 },
      { column: 'right', order: 0 },
      { column: 'right', order: 1 },
    ])).toBe(false);

    const badLength = normalizeComparePlan(planOf(compareSlide({
      legacyColumnManifest: [{ column: 'left', order: 0 }],
    })));
    expect(badLength.plan.slides[0].pageType).toBe('content-no-image');
    expect(badLength.plan.slides[0].legacyColumnManifest).toBeUndefined();

    const unaligned = normalizeComparePlan(planOf(compareSlide({
      legacyColumnManifest: [
        { column: 'left', order: 0 },
        { column: 'left', order: 1 },
        { column: 'right', order: 0 },
        { column: 'right', order: 2 },
      ],
    })));
    expect(unaligned.plan.slides[0].pageType).toBe('content-no-image');
  });

  it('keeps explicit typed comparisonItems untouched for strict validation', () => {
    const typed = [
      { contentId: 'l0', text: '左一', column: 'left' as const, order: 0, bullet: true },
      { contentId: 'r0', text: '右一', column: 'right' as const, order: 0, bullet: true },
      { contentId: 'r1', text: '右二', column: 'right' as const, order: 1, bullet: true },
    ];
    const original = planOf(compareSlide({ keyPoints: [], comparisonItems: typed }));
    const result = normalizeComparePlan(original);

    expect(result.plan).toBe(original);
    expect(result.notices).toHaveLength(0);
    const built = buildValidatedDeck(result.plan, { validationMode: 'strict' });
    expect(built.status).toBe('fail');
    expect(built.issues.map((issue) => issue.code)).toContain('compare_column_count');
  });

  it('leaves non-compare pages untouched and only normalizes compare pages', () => {
    const other: SlidePlan = {
      pageType: 'content-no-image',
      title: '内容页',
      keyPoints: ['要点一', '要点二', '要点三'],
      needsImage: false,
    };
    const original = planOf(other, compareSlide({ keyPoints: ['左一', '右一', '多余项'] }));
    const result = normalizeComparePlan(original);

    expect(result.plan.slides[0]).toBe(other);
    expect(result.plan.slides[1].pageType).toBe('content-no-image');
    expect(result.notices.map((notice) => notice.slideIndex)).toEqual([1]);
  });

  it('produces a strict-ready plan for every unpaired legacy shape', () => {
    const shapes: string[][] = [
      ['左一', '右一', '未配对项'],
      ['只有一条'],
      ['左一', '', '右一'],
      [],
    ];
    for (const keyPoints of shapes) {
      const result = normalizeComparePlan(planOf(compareSlide({ keyPoints })));
      const built = buildValidatedDeck(result.plan, { validationMode: 'strict' });
      expect(built.status, `keyPoints=${JSON.stringify(keyPoints)}`).not.toBe('fail');
      expect(built.deck, `keyPoints=${JSON.stringify(keyPoints)}`).toBeDefined();
      expect(built.issues.map((issue) => issue.code)).not.toContain('compare_column_count');
    }
  });
});
