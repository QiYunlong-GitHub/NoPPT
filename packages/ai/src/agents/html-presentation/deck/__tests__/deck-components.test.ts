/**
 * 阶段 3：core Deck 契约扩展 + 语义组件渲染 + PPTX parity 数据真值。
 */

import { describe, expect, it } from 'vitest';
import {
  normalizeNodes,
  type DeckDecorationKind,
  type DeckDecorationNode,
  type DeckNode,
} from '@noppt/core/deck';
import type { PresentationPlan, SlidePlan } from '../../../../types';
import { buildLayoutContext, planToDeck } from '../plan-to-deck';
import { deckSlideToHtml } from '../deck-to-html';
import { attachVisualComponents } from '../deck-component-layouts';
import { measureVisualDensity, VISUAL_DENSITY_BASELINE } from '../visual-density';

function buildPlan(slideCount = 2): PresentationPlan {
  const slides: SlidePlan[] = Array.from({ length: slideCount }, (_, i) => ({
    pageType: i === 0 ? 'cover' : 'content-cards',
    title: `第 ${i + 1} 页标题`,
    keyPoints: ['要点一：第一项内容', '要点二：第二项内容'],
    needsImage: false,
  }));
  return { title: '组件化', primaryColor: '#2563eb', slides };
}

function buildDeck(slideCount = 2) {
  const plan = buildPlan(slideCount);
  return {
    plan,
    deck: planToDeck(plan, { imageEnabled: false, imagePreference: 'content-only' }),
  };
}

describe('core Deck 契约', () => {
  it('normalizeNodes 保留 decoration 节点并钳制 progress', () => {
    const nodes = normalizeNodes([
      {
        kind: 'decoration',
        rect: { x: 0, y: 0, w: 44, h: 44 },
        decoration: 'kpi',
        value: '3',
        label: '关键要点',
        tone: 'amber',
        progress: 180,
      },
    ]);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].kind).toBe('decoration');
    expect((nodes[0] as DeckDecorationNode).progress).toBe(100);
    expect((nodes[0] as DeckDecorationNode).tone).toBe('amber');
  });

  it('非法 tone 被丢弃，未知组件类型仍可归一化', () => {
    const nodes = normalizeNodes([
      { kind: 'decoration', rect: { x: 0, y: 0, w: 10, h: 10 }, decoration: 'badge', tone: 'neon' },
    ]);
    expect((nodes[0] as DeckDecorationNode).tone).toBeUndefined();
  });
});

describe('语义组件 HTML 渲染', () => {
  const kinds: DeckDecorationKind[] = [
    'badge',
    'kpi',
    'timeline',
    'callout',
    'quote',
    'heat-cell',
  ];

  it.each(kinds)('%s 组件输出合法节点标识且不拦截选中', (decoration) => {
    const { plan, deck } = buildDeck(1);
    const node: DeckNode = {
      kind: 'decoration',
      id: 'deco-1',
      role: 'decoration',
      decoration,
      value: '42',
      label: '说明文字',
      tone: 'amber',
      progress: 60,
      rect: { x: 80, y: 120, w: 240, h: 96 },
    };
    const slide = { ...deck.slides[0], nodes: [node] };
    const html = deckSlideToHtml(slide, buildLayoutContext(plan), { visualTheme: 'blue' });
    expect(html).toContain('data-deck-node-id="deco-1"');
    expect(html).toContain('data-role="decoration"');
    expect(html).toContain('pointer-events:none');
    expect(html).toContain('data-canonical-root="true"');
  });
});

describe('组件化后的视觉密度', () => {
  it('无图模式只保留全篇统一页脚条，不再生成伪 KPI / 伪柱图', () => {
    const { deck } = buildDeck(2);
    const enhanced = attachVisualComponents(deck);
    const kinds = new Set(enhanced.slides.flatMap((s) => s.nodes.map((n) => n.kind)));
    expect(kinds.has('decoration')).toBe(true);
    expect(kinds.has('chart')).toBe(false);
    const footers = enhanced.slides.flatMap((s) =>
      s.nodes.filter((n): n is DeckDecorationNode => n.kind === 'decoration'),
    );
    expect(footers.length).toBeGreaterThan(0);
    for (const footer of footers) {
      expect(footer.id).toContain('deco-footer');
      expect(footer.label).toMatch(/^\d{2} \/ \d{2}$/);
      expect(footer.value).toBeUndefined();
      expect(footer.progress).toBeGreaterThan(0);
    }
  });

  it('attachVisualComponents 不修改输入 Deck', () => {
    const { deck } = buildDeck(2);
    const before = deck.slides.map((s) => s.nodes.length);
    attachVisualComponents(deck);
    expect(deck.slides.map((s) => s.nodes.length)).toEqual(before);
  });

  it('组件化页面 HTML 的色值数超过历史基线', () => {
    const { plan, deck } = buildDeck(2);
    const enhanced = attachVisualComponents(deck);
    const html = deckSlideToHtml(enhanced.slides[1], buildLayoutContext(plan), {
      visualTheme: 'blue',
    });
    const d = measureVisualDensity(html);
    expect(d.hexColors.length).toBeGreaterThan(VISUAL_DENSITY_BASELINE.hexColorCount);
    expect(d.radialGradients).toBeGreaterThanOrEqual(1);
    expect(d.boxShadows).toBeGreaterThanOrEqual(1);
    expect(d.svgElements).toBeGreaterThanOrEqual(1);
  });
});
