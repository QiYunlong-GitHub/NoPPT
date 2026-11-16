import { describe, expect, it } from 'vitest';
import type { PresentationPlan } from '../../../../types';
import { buildValidatedDeck, type PlanToDeckResult } from '../plan-to-deck';
import type { PlanContractIssue } from '../slide-contract';
import {
  formatStrictDeckIssues,
  inspectDeckResultInWindow,
  inspectStrictDeckResult,
  normalizePlanForStrictDeck,
  StrictDeckValidationError,
} from '../strict-deck';

function makeLegacyComparePlan(keyPoints: string[]): PresentationPlan {
  return {
    title: '对比页',
    primaryColor: '#2563eb',
    slides: [
      {
        pageType: 'content-compare',
        title: '左右对比',
        keyPoints,
        needsImage: false,
      },
    ],
  };
}

describe('strict Deck runtime', () => {
  it('normalizes even legacy compare keyPoints into explicit typed ownership', () => {
    const plan = makeLegacyComparePlan(['左一', '左二', '右一', '右二']);
    const normalized = normalizePlanForStrictDeck(plan);
    const slide = normalized.slides[0];

    expect(slide.comparisonItems).toHaveLength(4);
    expect(slide.legacyColumnManifest).toHaveLength(4);
    expect(slide.comparisonItems?.map((item) => item.column)).toEqual(['left', 'left', 'right', 'right']);
    expect(slide.comparisonItems?.map((item) => item.order)).toEqual([0, 1, 0, 1]);
    expect(slide.comparisonItems?.every((item) => !item.legacyDerived)).toBe(true);
    expect(plan.slides[0].comparisonItems).toBeUndefined();
  });

  it('degrades odd legacy compare plans to a non-compare page without dropping content', () => {
    const plan = makeLegacyComparePlan(['左一', '右一', '未配对项']);
    const normalized = normalizePlanForStrictDeck(plan);
    expect(normalized).not.toBe(plan);
    expect(normalized.slides[0].pageType).toBe('content-no-image');
    expect(normalized.slides[0].keyPoints).toEqual(['左一', '右一', '未配对项']);
    expect(normalized.slides[0].comparisonItems).toBeUndefined();
    expect(normalized.slides[0].legacyColumnManifest).toBeUndefined();

    const result = buildValidatedDeck(normalized, { validationMode: 'strict' });
    expect(result.status).not.toBe('fail');
    expect(result.deck).toBeDefined();
    expect(result.issues.map((issue) => issue.code)).not.toContain('compare_column_count');
    expect(result.issues.map((issue) => issue.code)).not.toContain('compare_pair_alignment');
  });

  it('keeps explicitly typed compare errors fatal', () => {
    const plan = makeLegacyComparePlan([]);
    plan.slides[0].comparisonItems = [
      { contentId: 'l0', text: '左一', column: 'left', order: 0, bullet: true },
      { contentId: 'r0', text: '右一', column: 'right', order: 0, bullet: true },
      { contentId: 'r1', text: '右二', column: 'right', order: 1, bullet: true },
    ];
    const normalized = normalizePlanForStrictDeck(plan);
    expect(normalized.slides[0].comparisonItems).toHaveLength(3);

    const result = buildValidatedDeck(normalized, { validationMode: 'strict' });
    expect(result.status).toBe('fail');
    expect(result.issues.map((issue) => issue.code)).toContain('compare_column_count');
  });

  it('returns pass from strict buildValidatedDeck after typed ownership normalization', () => {
    const plan = makeLegacyComparePlan(['左一', '左二', '右一', '右二']);
    const result = buildValidatedDeck(normalizePlanForStrictDeck(plan), { validationMode: 'strict' });
    expect(result.status).toBe('pass');
    expect(result.deck).toBeDefined();
    expect(result.issues).toHaveLength(0);
  });

  it('accepts needs_review when the deck exists and every issue is recoverable', () => {
    const plan = makeLegacyComparePlan(['左一', '左二', '右一', '右二']);
    const passResult = buildValidatedDeck(normalizePlanForStrictDeck(plan), { validationMode: 'strict' });
    const recoverableIssue: PlanContractIssue = {
      code: 'compare_column_ownership_unverified',
      slideIndex: 0,
      path: 'comparisonItems',
      expected: 'explicit column manifest',
      observed: 'legacy keyPoints',
      recoverable: true,
    };
    const result: PlanToDeckResult = {
      ...passResult,
      status: 'needs_review',
      issues: [recoverableIssue],
    };

    const inspection = inspectStrictDeckResult(result);
    expect(inspection.ok).toBe(true);
    expect(inspection.deck).toBe(result.deck);
    expect(inspection.warnings.some((issue) => issue.code === 'compare_column_ownership_unverified')).toBe(true);
    expect(formatStrictDeckIssues(inspection.warnings)).toContain('compare_column_ownership_unverified');
  });

  it('rejects fail results and formats issue codes', () => {
    const invalidPlan: PresentationPlan = {
      title: 'Invalid',
      primaryColor: '#2563eb',
      slides: [
        {
          pageType: 'content-stats-highlight',
          title: '指标',
          keyPoints: [],
          metricItems: [{ kind: 'metric', contentId: 'm1', order: 0, label: '', value: '' }],
          needsImage: false,
        },
      ],
    };
    const result = buildValidatedDeck(invalidPlan, { validationMode: 'strict' });
    expect(result.status).toBe('fail');

    const inspection = inspectStrictDeckResult(result);
    expect(inspection.ok).toBe(false);
    expect(inspection.deck).toBeUndefined();
    expect(formatStrictDeckIssues(inspection.issues)).toContain('empty_required_text');
    expect(formatStrictDeckIssues([])).toBe('unknown');
  });

  it('only blocks on fatal issues inside the first-slide preview window', () => {
    const base = buildValidatedDeck(
      normalizePlanForStrictDeck(makeLegacyComparePlan(['左一', '左二', '右一', '右二'])),
      { validationMode: 'legacy' },
    );
    const fatalOnSecondSlide: PlanContractIssue = {
      code: 'compare_column_count',
      slideIndex: 1,
      path: 'comparisonItems',
      expected: 'equal left/right item counts',
      observed: '2/1',
      recoverable: false,
    };
    const result: PlanToDeckResult = { ...base, status: 'fail', issues: [fatalOnSecondSlide] };

    expect(inspectStrictDeckResult(result).ok).toBe(false);
    const preview = inspectDeckResultInWindow(result, 0, 1);
    expect(preview.ok).toBe(true);
    expect(preview.deck).toBe(result.deck);
    expect(preview.issues).toHaveLength(0);
  });

  it('separates fatal codes from recoverable warnings in the validation error', () => {
    const fatal: PlanContractIssue = {
      code: 'compare_column_count',
      slideIndex: 1,
      path: 'comparisonItems',
      expected: 'equal columns',
      observed: '2/1',
      recoverable: false,
    };
    const warning: PlanContractIssue = {
      code: 'compare_column_ownership_unverified',
      slideIndex: 1,
      path: 'comparisonItems',
      expected: 'explicit manifest',
      observed: 'legacy keyPoints',
      recoverable: true,
    };
    const error = new StrictDeckValidationError([fatal], [warning]);

    expect(error.message).toContain('compare_column_count');
    expect(error.message).not.toContain('compare_column_ownership_unverified');
    expect(error.message).toContain('slide2');
    expect(error.fatalIssues).toEqual([fatal]);
    expect(error.warnings).toEqual([warning]);
  });
});
