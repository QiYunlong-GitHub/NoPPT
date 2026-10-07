import { describe, expect, it } from 'vitest';
import type { SlidePlan } from '../../../../types';
import { deckSlideToHtml } from '../deck-to-html';
import { buildLayoutContext, planToDeck } from '../plan-to-deck';
import { layoutSlideNodes } from '../layout-templates';
import type { DeckTextNode } from '@noppt/core/deck';

function comparePlan(pairCount: number): SlidePlan {
  const comparisonItems = Array.from({ length: pairCount * 2 }, (_, index) => {
    const order = index % pairCount;
    const column = index < pairCount ? 'left' : 'right';
    return {
      contentId: `compare-${column}-${order}`,
      text: `${column}-${order}`,
      column: column as 'left' | 'right',
      order,
      bullet: order === 0 || column === 'left',
    };
  });
  return {
    pageType: 'content-compare',
    title: '对比',
    keyPoints: comparisonItems.map((item) => item.text),
    comparisonItems,
    needsImage: false,
  };
}

function textValue(node: DeckTextNode): string {
  return node.paragraphs.flatMap((paragraph) => paragraph.runs.map((run) => run.text)).join('');
}

describe('content-compare canonical layout', () => {
  it('keeps every typed item identity and aligns equal-order rows across columns', () => {
    const nodes = layoutSlideNodes(comparePlan(2), buildLayoutContext({ title: 't', primaryColor: '#2563eb', slides: [] }));
    const contentNodes = nodes.filter((node): node is DeckTextNode => node.kind === 'text' && node.role !== 'title');

    expect(contentNodes).toHaveLength(4);
    expect(contentNodes.map((node) => node.contentId)).toEqual([
      'compare-left-0',
      'compare-left-1',
      'compare-right-0',
      'compare-right-1',
    ]);
    expect(contentNodes.map(textValue)).toEqual(['left-0', 'left-1', 'right-0', 'right-1']);
    expect(contentNodes[0].rect.y).toBe(contentNodes[2].rect.y);
    expect(contentNodes[1].rect.y).toBe(contentNodes[3].rect.y);
    expect(contentNodes.every((node) => node.rect.h > 0)).toBe(true);
  });

  it('preserves the typed column/order/bullet contract for arbitrary paired row counts', () => {
    for (let pairCount = 1; pairCount <= 8; pairCount += 1) {
      const nodes = layoutSlideNodes(comparePlan(pairCount), buildLayoutContext({ title: 't', primaryColor: '#2563eb', slides: [] }));
      const contentNodes = nodes.filter((node): node is DeckTextNode => node.kind === 'text' && node.role !== 'title');
      expect(contentNodes, `pairCount=${pairCount}`).toHaveLength(pairCount * 2);
      expect(new Set(contentNodes.map((node) => node.contentId)).size, `pairCount=${pairCount}`).toBe(pairCount * 2);
      for (let order = 0; order < pairCount; order += 1) {
        const left = contentNodes.find((node) => node.contentId === `compare-left-${order}`)!;
        const right = contentNodes.find((node) => node.contentId === `compare-right-${order}`)!;
        expect(left.rect.y, `pairCount=${pairCount},order=${order}`).toBe(right.rect.y);
      }
    }
  });

  it('marks legacy keyPoints ownership as derived when no column manifest exists', () => {
    const legacy = comparePlan(2);
    delete legacy.comparisonItems;
    const deck = planToDeck({ title: 't', primaryColor: '#2563eb', slides: [legacy] });

    expect(deck.slides[0].layoutParams?.legacyDerived).toBe(true);
    expect(deck.slides[0].layoutParams?.warnings).toContain('compare_column_ownership_unverified');
    expect(deck.slides[0].nodes.filter((node) => node.kind === 'text' && node.contentId)).toHaveLength(4);
  });  it('keeps the target compare page at four items with two per column', () => {
    const targetItems = [
      { contentId: 'target-compare-1', text: '海表温度异常升高', column: 'left' as const, order: 0, bullet: true },
      { contentId: 'target-compare-2', text: '沃克环流减弱', column: 'left' as const, order: 1, bullet: true },
      { contentId: 'target-compare-3', text: '秘鲁沿岸降雨增多', column: 'right' as const, order: 0, bullet: true },
      { contentId: 'target-compare-4', text: '全球气候变暖加剧', column: 'right' as const, order: 1, bullet: true },
    ];
    const plan: SlidePlan = {
      pageType: 'content-compare',
      title: '厄尔尼诺与拉尼娜：太平洋的冷暖交替',
      keyPoints: targetItems.map((item) => item.text),
      comparisonItems: targetItems,
      needsImage: false,
    };
    const deck = planToDeck({ title: plan.title, primaryColor: '#27ae60', slides: [plan] });
    const contentNodes = deck.slides[0].nodes.filter((node): node is DeckTextNode => node.kind === 'text' && node.contentId);
    const first = contentNodes.find((node) => node.contentId === 'target-compare-1')!;

    expect(contentNodes).toHaveLength(4);
    expect(contentNodes.filter((node) => node.contentColumn === 'left')).toHaveLength(2);
    expect(contentNodes.filter((node) => node.contentColumn === 'right')).toHaveLength(2);
    expect(textValue(first)).toBe('海表温度异常升高');
    expect(first.bullet).toBe(true);
    expect(first.paragraphs[0]?.bullet).toBe(true);
  });

  it('renders one compare root, two columns, and keeps bullet marker with its text item', () => {
    const deck = planToDeck({ title: 't', primaryColor: '#2563eb', slides: [comparePlan(2)] });
    const html = deckSlideToHtml(deck.slides[0], buildLayoutContext({ title: 't', primaryColor: '#2563eb', slides: [] }));

    expect((html.match(/data-compare-root=/g) ?? []).length).toBe(1);
    expect((html.match(/data-compare-column=/g) ?? []).length).toBe(2);
    expect(html).toContain('data-content-id="compare-left-0"');
    expect(html).toContain('data-content-id="compare-right-0"');
    expect(html).toMatch(/data-content-id="compare-left-0"[\s\S]*>• <span[^>]*>left-0/);
    expect(html).not.toMatch(/<p[^>]*>\s*•\s*<\/p>/i);
  });
});
