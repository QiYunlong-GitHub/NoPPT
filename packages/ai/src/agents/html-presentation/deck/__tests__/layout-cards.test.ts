import { describe, expect, it } from 'vitest';
import type { DeckNode, DeckRect } from '@noppt/core/deck';
import type { CardItem, SlidePlan } from '../../../../types';
import {
  DEFAULT_DECK_LAYOUT_CONTEXT,
  layoutSlideNodes,
  resolveViewportProfile,
  type DeckLayoutContext,
} from '../layout-templates';

function context(width: number, height = 720): DeckLayoutContext {
  return {
    ...DEFAULT_DECK_LAYOUT_CONTEXT,
    viewport: { width, height },
    viewportProfile: resolveViewportProfile(width, height),
  };
}

function cardPlan(cardItems: CardItem[], keyPoints: string[] = []): SlidePlan {
  return {
    pageType: 'content-cards',
    title: '策略',
    keyPoints,
    needsImage: false,
    cardItems,
  };
}

function textOf(node: DeckNode): string {
  if (node.kind !== 'text') return '';
  return node.paragraphs.flatMap((paragraph) => paragraph.runs.map((run) => run.text)).join('');
}

function textNodes(nodes: DeckNode[]): DeckNode[] {
  return nodes.filter((node) => node.kind === 'text');
}

function cardShapes(nodes: DeckNode[]): DeckNode[] {
  return nodes.filter((node) => node.kind === 'shape' && node.role !== 'title');
}

function inLogicalCanvas(rect: DeckRect): boolean {
  return rect.x >= 0 && rect.y >= 0 && rect.x + rect.w <= 1280 && rect.y + rect.h <= 720;
}

describe('content-cards measured density and typed content', () => {
  it('renders typed title/body cards without dropping either field', () => {
    const nodes = layoutSlideNodes(cardPlan([
      { contentId: 'strategy-1', title: '监测预警', body: '持续跟踪海表温度变化并及时识别风险。' },
      { contentId: 'strategy-2', title: '协同应对', body: '联动相关部门，降低极端天气影响。' },
    ]), context(1280));

    const owned = textNodes(nodes).filter((node) => node.contentId === 'strategy-1' || node.contentId === 'strategy-2');
    expect(owned.map(textOf).join('')).toContain('监测预警');
    expect(owned.map(textOf).join('')).toContain('持续跟踪海表温度变化并及时识别风险。');
    expect(owned.map(textOf).join('')).toContain('协同应对');
    expect(owned.map(textOf).join('')).toContain('联动相关部门，降低极端天气影响。');
    expect(owned.every((node) => node.contentId)).toBe(true);
  });

  it('uses one compact text card when a typed card has no body', () => {
    const nodes = layoutSlideNodes(cardPlan([
      { contentId: 'title-only', title: '仅有标题', body: '' },
    ]), context(1280));

    const owned = textNodes(nodes).filter((node) => node.contentId === 'title-only');
    expect(owned).toHaveLength(1);
    expect(owned.map(textOf)).toEqual(['仅有标题']);
  });

  it('preserves complete legacy strategy sentences as readable body text', () => {
    const sentence = '通过监测海表温度变化，提前识别风险并协调响应。';
    const nodes = layoutSlideNodes(cardPlan([], [sentence]), context(1280));

    const owned = textNodes(nodes).filter((node) => textOf(node).includes(sentence));
    expect(owned).toHaveLength(1);
    expect(textOf(owned[0])).toBe(sentence);
  });

  it.each([
    [1, 1],
    [2, 2],
    [3, 3],
  ] as const)('chooses %s columns for %s standard cards', (count, expectedColumns) => {
    const items = Array.from({ length: count }, (_, index) => ({
      contentId: `standard-${index + 1}`,
      title: `策略${index + 1}`,
      body: `说明${index + 1}`,
    }));
    const nodes = layoutSlideNodes(cardPlan(items), context(1280));
    const shapes = cardShapes(nodes);
    const uniqueX = new Set(shapes.map((node) => node.rect.x));
    expect(uniqueX.size).toBe(expectedColumns);
  });

  it('uses at most two columns on narrow profiles and keeps order and identity', () => {
    const items = [
      { contentId: 'narrow-1', title: '策略一', body: '先监测变化，再及时发出预警。' },
      { contentId: 'narrow-2', title: '策略二', body: '根据风险等级协调跨部门响应。' },
      { contentId: 'narrow-3', title: '策略三', body: '复盘行动结果并持续更新方案。' },
    ];
    const nodes = layoutSlideNodes(cardPlan(items), context(800, 600));
    const shapes = cardShapes(nodes);
    const owned = textNodes(nodes).filter((node) => items.some((item) => item.contentId === node.contentId));
    const orderedIds = owned.filter((node) => node.rect.y >= Math.min(...shapes.map((shape) => shape.rect.y))).map((node) => node.contentId);

    expect(new Set(shapes.map((node) => node.rect.x)).size).toBeLessThanOrEqual(2);
    expect(orderedIds).toEqual(expect.arrayContaining(items.map((item) => item.contentId)));
    expect(orderedIds.indexOf('narrow-1')).toBeLessThan(orderedIds.indexOf('narrow-2'));
    expect(orderedIds.indexOf('narrow-2')).toBeLessThan(orderedIds.indexOf('narrow-3'));
    expect(nodes.every((node) => inLogicalCanvas(node.rect))).toBe(true);
  });

  it('selects one column for long narrow card bodies so body text remains readable', () => {
    const body = '完整策略说明需要保留全部事实信息，并根据真实文本需求分配卡片高度，不能依赖固定空白区域。'.repeat(3);
    const nodes = layoutSlideNodes(cardPlan([
      { contentId: 'long-1', title: '策略一', body },
      { contentId: 'long-2', title: '策略二', body },
      { contentId: 'long-3', title: '策略三', body },
    ]), context(800, 600));

    const shapes = cardShapes(nodes);
    expect(new Set(shapes.map((node) => node.rect.x)).size).toBe(1);
    expect(nodes.every((node) => inLogicalCanvas(node.rect))).toBe(true);
    for (const item of ['long-1', 'long-2', 'long-3']) {
      const bodyNode = textNodes(nodes).find((node) => node.contentId === item && textOf(node).includes(body));
      expect(bodyNode).toBeDefined();
      expect(bodyNode && bodyNode.rect.h).toBeGreaterThan(24);
    }
  });

  it('does not create empty body placeholders for compact legacy cards', () => {
    const nodes = layoutSlideNodes(cardPlan([], ['完整策略句一', '完整策略句二', '完整策略句三']), context(1280));
    const owned = textNodes(nodes).filter((node) => node.contentId);

    expect(owned).toHaveLength(3);
    expect(owned.map(textOf)).toEqual(['完整策略句一', '完整策略句二', '完整策略句三']);
    expect(owned.every((node) => textOf(node).trim().length > 0)).toBe(true);
  });
});
