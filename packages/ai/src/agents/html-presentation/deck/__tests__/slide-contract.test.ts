import { describe, expect, it } from 'vitest';
import type { SlidePlan } from '../../../../types';
import {
  collectOmissions,
  collectRequiredContent,
  normalizeSlideContent,
  validateSlideContent,
} from '../slide-contract';

function plan(overrides: Partial<SlidePlan> = {}): SlidePlan {
  return {
    pageType: 'content-no-image',
    title: '内容',
    keyPoints: ['保留的事实'],
    needsImage: false,
    ...overrides,
  };
}

describe('typed slide contract', () => {
  it('normalizes compare items with stable identity and column order', () => {
    const slide = plan({
      pageType: 'content-compare',
      keyPoints: [],
      comparisonItems: [
        { contentId: 'compare-a', text: '左一', column: 'left', order: 0, bullet: true },
        { contentId: 'compare-b', text: '左二', column: 'left', order: 1, bullet: false },
        { contentId: 'compare-c', text: '右一', column: 'right', order: 0, bullet: true },
        { contentId: 'compare-d', text: '右二', column: 'right', order: 1, bullet: false },
      ],
    });

    const first = normalizeSlideContent(slide, 1);
    const second = normalizeSlideContent(slide, 1);

    expect(first.comparisonItems).toEqual(second.comparisonItems);
    expect(first.comparisonItems.map((item) => item.contentId)).toEqual([
      'compare-a',
      'compare-b',
      'compare-c',
      'compare-d',
    ]);
    expect(validateSlideContent(slide, 1).issues).toEqual([]);
  });

  it('returns structured issues for empty text, duplicate identity, and unbalanced columns', () => {
    const result = validateSlideContent(
      plan({
        pageType: 'content-compare',
        keyPoints: [],
        comparisonItems: [
          { contentId: 'same', text: '', column: 'left', order: 0, bullet: true },
          { contentId: 'same', text: '右一', column: 'right', order: 0, bullet: true },
          { contentId: 'right-only', text: '右二', column: 'right', order: 1, bullet: true },
        ],
      }),
      0,
    );

    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['empty_required_text', 'duplicate_content_id', 'compare_column_count']),
    );
    expect(result.issues.every((issue) => issue.slideIndex === 0)).toBe(true);
    expect(result.normalized).toBeDefined();
  });

  it('never creates empty metric fields when adapting legacy keyPoints', () => {
    const result = validateSlideContent(
      plan({
        pageType: 'content-stats-highlight',
        keyPoints: ['全球均温升高约 0.2°C', '仅有指标名称'],
      }),
      2,
    );

    expect(result.normalized.metricItems).toHaveLength(2);
    expect(result.normalized.metricItems[0]).toMatchObject({ kind: 'metric', label: '全球均温升高约', value: '0.2°C' });
    expect(result.normalized.metricItems[1]).toMatchObject({
      kind: 'omission',
      contentId: 'slide-3-metric-2',
      order: 1,
      originalText: '仅有指标名称',
      reason: 'value_not_separable',
      status: 'omitted',
    });
    expect(result.normalized.metricItems[1]).not.toHaveProperty('value');
    expect(result.requiredItems).toContainEqual({
      contentId: 'slide-3-metric-2',
      text: '仅有指标名称',
      role: 'metric',
      sourceIndex: 1,
    });
    expect(result.normalized.metricItems.every((item) => item.kind === 'omission' || (item.label && item.value))).toBe(true);
  });

  it('preserves unsplittable legacy cards and all summary points', () => {
    const cards = normalizeSlideContent(
      plan({ pageType: 'content-cards', keyPoints: ['完整策略句，不应被丢弃'] }),
      3,
    );
    const summary = normalizeSlideContent(
      plan({ pageType: 'summary', keyPoints: ['结论一', '行动二', '行动三'] }),
      4,
    );

    expect(cards.cardItems).toEqual([
      expect.objectContaining({ body: '完整策略句，不应被丢弃', compact: true, legacyDerived: true }),
    ]);
    expect(summary.summaryItems.map((item) => item.text)).toEqual(['结论一', '行动二', '行动三']);
    expect(collectRequiredContent(summary)).toHaveLength(3);
    expect(collectOmissions(summary)).toEqual([]);
  });

  it('reports metric count mismatch instead of padding empty metrics', () => {
    const result = validateSlideContent(
      plan({
        pageType: 'content-stats-highlight',
        keyPoints: ['营收 42%', '用户 38%'],
        metricValues: [42],
      }),
      0,
    );

    expect(result.issues.map((issue) => issue.code)).toContain('metric_count_mismatch');
    expect(result.normalized.metricItems).not.toContainEqual(expect.objectContaining({ value: '' }));
  });
});

  it('does not silently filter an empty legacy required point', () => {
    const result = validateSlideContent(
      plan({ pageType: 'summary', keyPoints: [''] }),
      0,
    );

    expect(result.issues.map((issue) => issue.code)).toContain('empty_required_text');
  });
