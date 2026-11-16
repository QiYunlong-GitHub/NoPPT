import { describe, expect, it } from 'vitest';
import type { DeckNode, DeckShapeNode } from '@noppt/core/deck';
import type { SlidePlan } from '../../../../types';
import {
  DEFAULT_DECK_LAYOUT_CONTEXT,
  type DeckLayoutContext,
} from '../layout-templates';
import { applySparseEnhancement } from '../sparse-enhancement';
import { deckSlideToHtml } from '../deck-to-html';

const ctx = (density: DeckLayoutContext['density']): DeckLayoutContext => ({
  ...DEFAULT_DECK_LAYOUT_CONTEXT,
  density,
});

const basePlan = (overrides: Partial<SlidePlan> = {}): SlidePlan => ({
  pageType: 'content-no-image',
  title: '稀疏页示例',
  keyPoints: ['海温：赤道中东太平洋持续偏暖'],
  needsImage: false,
  ...overrides,
});

/** 一张铺满正文区的卡片：正文只占顶部，下方大片留白（spacious 典型形态）。 */
const cardWithTopText = (): DeckNode[] => [
  {
    kind: 'shape',
    shape: 'roundRect',
    role: 'content',
    rect: { x: 64, y: 112, w: 1152, h: 540 },
  } as DeckShapeNode,
  {
    kind: 'text',
    role: 'content',
    rect: { x: 88, y: 136, w: 1104, h: 60 },
    paragraphs: [{ runs: [{ text: '海温：赤道中东太平洋持续偏暖' }] }],
  },
];

describe('sparse-enhancement · 稀疏页零成本视觉增强', () => {
  it('非稀疏页 / 关闭开关时不追加任何节点', () => {
    const plan = basePlan({ metricItems: [] });
    for (const density of ['standard', 'compact'] as const) {
      const result = applySparseEnhancement(plan, cardWithTopText(), ctx(density), 'slide-1');
      expect(result.decision.kind).toBe('none');
      expect(result.nodes).toHaveLength(2);
    }
    const disabled = applySparseEnhancement(plan, cardWithTopText(), ctx('spacious'), 'slide-1', {
      enabled: false,
    });
    expect(disabled.decision.kind).toBe('none');
    expect(disabled.nodes).toHaveLength(2);
  });

  it('结构页不增强，且输入节点数组不被修改', () => {
    const input = cardWithTopText();
    const result = applySparseEnhancement(
      basePlan({ pageType: 'cover' }),
      input,
      ctx('spacious'),
      'slide-1',
    );
    expect(result.decision.kind).toBe('none');
    expect(result.nodes).toBe(input);
  });

  it('真实 metricItems 生成 kpi 装饰，不做数值编造', () => {
    const plan = basePlan({
      metricItems: [
        {
          kind: 'metric',
          contentId: 'm1',
          order: 0,
          label: '海温距平',
          value: '+0.8℃',
        },
      ],
    });
    const result = applySparseEnhancement(plan, cardWithTopText(), ctx('spacious'), 'slide-2');
    expect(result.decision.kind).toBe('kpi');
    const added = result.nodes.slice(2);
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({
      kind: 'decoration',
      decoration: 'kpi',
      role: 'decoration',
      value: '+0.8℃',
      label: '海温距平',
    });
  });

  it('omission 指标不当作数值来源，回退到 badge 装饰', () => {
    const plan = basePlan({
      metricItems: [
        {
          kind: 'omission',
          contentId: 'm1',
          order: 0,
          originalText: '海温异常升高',
          reason: 'value_not_separable',
          status: 'needs_review',
        },
      ],
    });
    const result = applySparseEnhancement(plan, cardWithTopText(), ctx('spacious'), 'slide-2');
    expect(result.decision.kind).toBe('badge');
    expect(result.nodes.slice(2)[0]).toMatchObject({ kind: 'decoration', decoration: 'badge' });
  });

  it('配图已被 plan 放行时只做 defer，不叠加确定性装饰', () => {
    const plan = basePlan({ needsImage: true });
    const result = applySparseEnhancement(plan, cardWithTopText(), ctx('spacious'), 'slide-3', {
      imageEnabled: true,
      imagePreference: 'content-only',
    });
    expect(result.decision.kind).toBe('image-deferred');
    expect(result.nodes).toHaveLength(2);
  });

  it('imagePreference=none / minimal 时即使 imageEnabled 也不 defer，走确定性装饰', () => {
    const plan = basePlan({ needsImage: false });
    for (const pref of ['none', 'minimal'] as const) {
      const result = applySparseEnhancement(plan, cardWithTopText(), ctx('spacious'), 'slide-3', {
        imageEnabled: true,
        imagePreference: pref,
      });
      expect(result.decision.kind).not.toBe('image-deferred');
      expect(result.nodes.length).toBeGreaterThan(2);
    }
  });

  it('追加节点与既有节点不重叠，且落在正文安全区内', () => {
    const plan = basePlan({
      metricItems: [
        { kind: 'metric', contentId: 'm1', order: 0, label: 'A', value: '1' },
        { kind: 'metric', contentId: 'm2', order: 1, label: 'B', value: '2' },
        { kind: 'metric', contentId: 'm3', order: 2, label: 'C', value: '3' },
      ],
    });
    const result = applySparseEnhancement(plan, cardWithTopText(), ctx('spacious'), 'slide-4');
    const added = result.nodes.slice(2);
    expect(added.length).toBeGreaterThan(1);
    for (const node of added) {
      const r = node.rect;
      expect(r.x).toBeGreaterThanOrEqual(64);
      expect(r.y).toBeGreaterThanOrEqual(112);
      expect(r.x + r.w).toBeLessThanOrEqual(1216);
      expect(r.y + r.h).toBeLessThanOrEqual(656);
    }
  });
});

describe('sparse-enhancement · HTML / PPTX parity', () => {
  it('增强节点进入 Deck 后被确定性渲染器输出为语义装饰（data-role=decoration）', () => {
    const plan = basePlan({
      metricItems: [{ kind: 'metric', contentId: 'm1', order: 0, label: '距平', value: '+0.8℃' }],
    });
    const enhanced = applySparseEnhancement(plan, cardWithTopText(), ctx('spacious'), 'slide-5');
    const html = deckSlideToHtml(
      {
        id: 'slide-5',
        pageType: plan.pageType,
        title: plan.title,
        nodes: enhanced.nodes,
      },
      { ...DEFAULT_DECK_LAYOUT_CONTEXT, primary: '#EA580C' },
    );
    expect(html).toContain('data-role="decoration"');
    expect(html).toContain('+0.8℃');
    // 装饰色来自主题派生，不在节点层写死 hex。
    expect(enhanced.nodes.slice(2).every((node) => node.kind !== 'decoration' || !('fill' in node))).toBe(true);
  });
});
