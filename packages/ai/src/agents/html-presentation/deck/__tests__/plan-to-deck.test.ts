import { describe, expect, it } from 'vitest';
import { SLIDE_H_PX, SLIDE_W_PX, isDeckNode, normalizeDeck } from '@noppt/core/deck';
import type { PresentationPlan, SlidePageType, SlidePlan } from '../../../../types';
import {
  DECK_LAYOUT_BUILDERS,
  layoutSlideNodes,
  type DeckLayoutContext,
} from '../layout-templates';
import { darkenHex, planToDeck } from '../plan-to-deck';

const ALL_PAGE_TYPES = Object.keys(DECK_LAYOUT_BUILDERS) as SlidePageType[];

function slide(pageType: SlidePageType, overrides?: Partial<SlidePlan>): SlidePlan {
  return {
    pageType,
    title: '测试标题',
    keyPoints: ['要点一：说明一', '要点二：说明二', '要点三', '要点四'],
    needsImage: false,
    metricValues: [40, 70, 90],
    advantageIndices: [1],
    showcaseMetrics: [
      { label: '营收', value: '1.2亿', trend: 'up' },
      { label: '用户', value: '38万', trend: 'up' },
      { label: '成本', value: '-12%' },
    ],
    chart: {
      kind: 'bar',
      series: [
        {
          name: '一季度',
          points: [
            { label: '1月', value: 10 },
            { label: '2月', value: 20 },
          ],
        },
      ],
      unit: '万',
      showLegend: true,
      showValues: true,
    },
    architecture: {
      layers: [
        { title: '接入层', nodeIds: [0, 1] },
        { title: '服务层', nodeIds: [2] },
      ],
      nodes: [
        { id: 0, label: 'Web', variant: 'box' },
        { id: 1, label: 'DB', variant: 'cylinder' },
        { id: 2, label: 'API' },
      ],
    },
    ...overrides,
  };
}

function inSlide(rect: { x: number; y: number; w: number; h: number }): boolean {
  return (
    rect.x >= 0 &&
    rect.y >= 0 &&
    rect.x + rect.w <= SLIDE_W_PX + 0.001 &&
    rect.y + rect.h <= SLIDE_H_PX + 0.001 &&
    rect.w >= 0 &&
    rect.h >= 0
  );
}

describe('layout-templates', () => {
  it('覆盖全部 33 种 pageType', () => {
    expect(ALL_PAGE_TYPES.length).toBe(33);
    for (const t of [
      'cover',
      'toc',
      'summary',
      'content-cards',
      'content-architecture',
    ] as SlidePageType[]) {
      expect(ALL_PAGE_TYPES).toContain(t);
    }
  });

  it.each(ALL_PAGE_TYPES)('%s 产出合法节点且全部落在画布内', (pageType) => {
    const nodes = layoutSlideNodes(slide(pageType), defaultCtx());
    expect(nodes.length).toBeGreaterThan(0);
    for (const n of nodes) {
      expect(isDeckNode(n), `${pageType}/${n.kind}`).toBe(true);
      expect(inSlide(n.rect), `${pageType}/${n.kind} rect=${JSON.stringify(n.rect)}`).toBe(true);
    }
  });

  it('图表页产出 chart 节点', () => {
    for (const pt of [
      'content-chart-bar',
      'content-chart-line',
      'content-chart-pie',
      'content-chart-donut',
    ] as SlidePageType[]) {
      const nodes = layoutSlideNodes(slide(pt), defaultCtx());
      const chart = nodes.find((n) => n.kind === 'chart');
      expect(chart, pt).toBeDefined();
      expect(chart!.kind === 'chart' && chart!.chart.kind).toBe(
        pt === 'content-chart-bar'
          ? 'bar'
          : pt === 'content-chart-line'
            ? 'line'
            : pt === 'content-chart-pie'
              ? 'pie'
              : 'donut',
      );
    }
  });

  it('图文左右混排满足 45%:55% 与 gap 40', () => {
    const nodes = layoutSlideNodes(slide('content-image-left', { needsImage: true }), defaultCtx());
    const img = nodes.find((n) => n.kind === 'image');
    expect(img).toBeDefined();
    // body 宽 1152，gap 40 → 可用 1112；图占 45%
    expect(img!.rect.w).toBeCloseTo(1112 * 0.45, 0);
    const text = nodes.find((n) => n.kind === 'text' && n.role !== 'title');
    expect(text!.rect.x).toBeGreaterThan(img!.rect.x + img!.rect.w);
  });

  it('图上文下：要点数越多图区越矮', () => {
    const h2 = layoutSlideNodes(
      slide('content-image-top', { needsImage: true, keyPoints: ['a', 'b'] }),
      defaultCtx(),
    ).find((n) => n.kind === 'image')!.rect.h;
    const h4 = layoutSlideNodes(
      slide('content-image-top', { needsImage: true, keyPoints: ['a', 'b', 'c', 'd'] }),
      defaultCtx(),
    ).find((n) => n.kind === 'image')!.rect.h;
    expect(h2).toBeGreaterThan(h4);
  });

  it('未知页型降级到最小版式而不抛错', () => {
    const nodes = layoutSlideNodes(
      { pageType: 'not-a-page' as SlidePageType, title: 'x', keyPoints: ['a'], needsImage: false },
      defaultCtx(),
    );
    expect(nodes.length).toBeGreaterThan(0);
  });

  it('脏数据（null keyPoints / 空标题）不崩', () => {
    const nodes = layoutSlideNodes(
      {
        pageType: 'content-cards',
        title: '',
        keyPoints: null as unknown as string[],
        needsImage: true,
      },
      defaultCtx(),
    );
    expect(Array.isArray(nodes)).toBe(true);
  });
});

describe('planToDeck', () => {
  const plan: PresentationPlan = {
    title: '年度报告',
    description: '2026 年度总结',
    primaryColor: '#2563eb',
    slides: [slide('cover'), slide('toc'), slide('content-cards'), slide('summary')],
  };

  it('产出结构完整的 Deck', () => {
    const deck = planToDeck(plan);
    expect(deck.title).toBe('年度报告');
    expect(deck.slides).toHaveLength(4);
    expect(deck.source).toBe('plan');
    expect(normalizeDeck(deck)).not.toBeNull();
  });

  it('主色被归一化为 6 位 HEX，并派生加深色', () => {
    const deck = planToDeck(plan);
    expect(deck.theme?.primary).toBe('2563EB');
    expect(deck.theme?.primaryDark).toMatch(/^[0-9A-F]{6}$/);
    expect(darkenHex('FFFFFF')).toBe('D1D1D1');
  });

  it('母版带 title/body 占位符与页码', () => {
    const deck = planToDeck(plan);
    expect(deck.master?.title).toBe('NOPPT_MASTER');
    expect(deck.master?.placeholders?.map((p) => p.name)).toEqual(['title', 'body']);
    expect(deck.master?.slideNumber).toBeDefined();
    expect(planToDeck(plan, { includePageNumber: false }).master?.slideNumber).toBeUndefined();
  });

  it('元信息写入标题/主题/关键词', () => {
    const deck = planToDeck(plan);
    expect(deck.meta?.title).toBe('年度报告');
    expect(deck.meta?.subject).toBe('2026 年度总结');
    expect(deck.meta?.keywords).toContain('测试标题');
  });

  it('逐页备注可通过 notesResolver 注入', () => {
    const deck = planToDeck(plan, { notesResolver: (i) => `第 ${i + 1} 页备注` });
    expect(deck.slides[0].notes).toBe('第 1 页备注');
    expect(deck.slides[3].notes).toBe('第 4 页备注');
  });

  it('页型与下标被保留，便于回查', () => {
    const deck = planToDeck(plan);
    expect(deck.slides.map((s) => s.pageType)).toEqual([
      'cover',
      'toc',
      'content-cards',
      'summary',
    ]);
    expect(deck.slides.map((s) => s.id)).toEqual(['slide-1', 'slide-2', 'slide-3', 'slide-4']);
  });

  it('空 plan 不崩且产出空 slides', () => {
    const deck = planToDeck({ title: '', primaryColor: '', slides: [] });
    expect(deck.slides).toHaveLength(0);
    expect(deck.title).toBe('未命名演示');
  });

  it('null plan 不崩', () => {
    const deck = planToDeck(null as unknown as PresentationPlan);
    expect(deck.slides).toHaveLength(0);
  });
});

function defaultCtx(): DeckLayoutContext {
  return {
    primary: '2563EB',
    primaryDark: '1D4ED8',
    background: 'FFFFFF',
    text: '1F2937',
    textMuted: '6B7280',
  };
}
