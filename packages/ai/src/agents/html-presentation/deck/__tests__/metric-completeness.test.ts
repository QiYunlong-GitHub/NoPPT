import { describe, expect, it } from 'vitest';
import type { PresentationPlan, SlidePlan } from '../../../../types';
import {
  buildValidatedDeck,
  slidePlanToDeckSlide,
  buildLayoutContext,
} from '../plan-to-deck';
import {
  collectOmissions,
  normalizeSlideContent,
  validateSlideContent,
} from '../slide-contract';
import { layoutSlideNodes } from '../layout-templates';

function metricSlide(overrides: Partial<SlidePlan> = {}): SlidePlan {
  return {
    pageType: 'content-stats-highlight',
    title: '关键指标',
    keyPoints: [],
    needsImage: false,
    ...overrides,
  };
}

function planFor(slide: SlidePlan): PresentationPlan {
  return {
    title: '指标完整性测试',
    primaryColor: '#2563eb',
    slides: [slide],
  };
}

function textOf(node: { kind: string; paragraphs?: Array<{ runs: Array<{ text: string }> }> }): string {
  return node.kind === 'text'
    ? (node.paragraphs ?? []).flatMap((paragraph) => paragraph.runs.map((run) => run.text)).join(' ')
    : '';
}

describe('content-stats-highlight metric completeness', () => {
  it('renders typed metrics with non-empty value and label and stable content identity', () => {
    const slide = metricSlide({
      metricItems: [
        {
          kind: 'metric',
          contentId: 'metric-temperature',
          order: 0,
          label: '全球平均气温',
          value: '+0.2°C',
        },
      ],
    });

    const deckSlide = slidePlanToDeckSlide(slide, buildLayoutContext(planFor(slide)), 0);
    const metricNodes = deckSlide.nodes.filter(
      (node) => node.kind === 'text' && node.contentId === 'metric-temperature',
    );
    const visibleText = metricNodes.map(textOf).filter(Boolean);

    expect(visibleText).toContain('+0.2°C');
    expect(visibleText).toContain('全球平均气温');
    expect(metricNodes.every((node) => textOf(node).trim().length > 0)).toBe(true);
    expect(deckSlide.contentManifest).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ contentId: 'metric-temperature', role: 'metric', required: true }),
      ]),
    );
  });

  it('uses compact metric cards and records descriptionState=not_provided when description is absent', () => {
    const slide = metricSlide({
      metricItems: [
        {
          kind: 'metric',
          contentId: 'metric-compact',
          order: 0,
          label: '新增用户',
          value: '3万人',
        },
      ],
    });

    const deckSlide = slidePlanToDeckSlide(slide, buildLayoutContext(planFor(slide)), 0);
    const metadata = deckSlide.layoutParams as Record<string, unknown>;
    const states = metadata.descriptionStateByContentId as Record<string, string>;
    const metricNodes = deckSlide.nodes.filter(
      (node) => node.kind === 'text' && node.contentId === 'metric-compact',
    );

    expect(states['metric-compact']).toBe('not_provided');
    expect(metricNodes).toHaveLength(2);
    expect(metricNodes.every((node) => textOf(node).trim().length > 0)).toBe(true);
    expect(metricNodes.some((node) => textOf(node).trim().length === 0)).toBe(false);
  });

  it('measures value, label, description, and trend regions instead of allocating empty fixed text boxes', () => {
    const slide = metricSlide({
      metricItems: [
        {
          kind: 'metric',
          contentId: 'metric-described',
          order: 0,
          label: '转化率',
          value: '42%',
          description: '较上季度提升，保持稳定增长',
          trend: 'up',
        },
      ],
    });

    const nodes = layoutSlideNodes(slide, buildLayoutContext(planFor(slide)));
    const metricNodes = nodes.filter(
      (node) => node.kind === 'text' && node.contentId === 'metric-described',
    );
    const texts = metricNodes.map(textOf);

    expect(texts).toEqual(expect.arrayContaining(['42%', '转化率', '较上季度提升，保持稳定增长']));
    expect(texts.some((text) => text.includes('上升'))).toBe(true);
    expect(metricNodes.every((node) => node.rect.h > 0 && textOf(node).trim().length > 0)).toBe(true);
  });

  it('reports metricValues length mismatches as structured contract issues without padding empty metrics', () => {
    const slide = metricSlide({
      metricItems: [
        { kind: 'metric', contentId: 'metric-1', order: 0, label: '一', value: '1' },
        { kind: 'metric', contentId: 'metric-2', order: 1, label: '二', value: '2' },
      ],
      metricValues: [80],
    });

    const result = buildValidatedDeck(planFor(slide), { validationMode: 'strict' });

    expect(result.status).toBe('fail');
    expect(result.deck).toBeUndefined();
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'metric_count_mismatch',
          path: 'metricValues',
          expected: '2',
          observed: '1',
          recoverable: false,
        }),
      ]),
    );
    expect(layoutSlideNodes(slide, buildLayoutContext(planFor(slide))).filter(
      (node) => node.kind === 'text' && node.contentId?.startsWith('metric-'),
    )).toHaveLength(4);
  });

  it('keeps Chinese numeric units reversible when adapting legacy keyPoints', () => {
    const slide = metricSlide({ keyPoints: ['新增用户3万人'] });
    const content = normalizeSlideContent(slide, 0);
    const item = content.metricItems[0];

    expect(item.kind).toBe('metric');
    if (item.kind === 'metric') {
      expect(item.value).toBe('3万人');
      expect(item.label).toBe('新增用户');
      expect(`${item.label}${item.value}`).toBe('新增用户3万人');
      expect(item.contentId).toBe('slide-1-metric-1');
    }
  });

  it('preserves uncertain legacy keyPoints as explicit omissions without empty required text', () => {
    const originalText = '趋势持续改善但未提供可核验数值';
    const slide = metricSlide({ keyPoints: [originalText] });
    const validation = validateSlideContent(slide, 0);
    const omissions = collectOmissions(validation.normalized);

    expect(omissions).toEqual([
      expect.objectContaining({
        contentId: 'slide-1-metric-1',
        originalText,
        reason: 'value_not_separable',
        status: 'omitted',
        legacyDerived: true,
      }),
    ]);
    expect(validation.requiredItems).toEqual([
      expect.objectContaining({
        contentId: 'slide-1-metric-1',
        text: originalText,
        role: 'metric',
      }),
    ]);
    expect(validation.issues.filter((issue) => issue.code === 'empty_required_text')).toEqual([]);
  });
});
