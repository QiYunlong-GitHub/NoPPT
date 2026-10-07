import { describe, expect, it } from 'vitest';
import type { DeckSlide } from '@noppt/core/deck';
import type { ComparisonItem } from '@noppt/ai';
import { compareContentParity } from '../compare-content';

const items: ComparisonItem[] = [
  { contentId: 'left-0', text: '海表温度异常升高', column: 'left', order: 0, bullet: true },
  { contentId: 'left-1', text: '极端天气频率增加', column: 'left', order: 1, bullet: false },
  { contentId: 'right-0', text: '全球气候风险上升', column: 'right', order: 0, bullet: true },
  { contentId: 'right-1', text: '需要协同应对', column: 'right', order: 1, bullet: true },
];

const slide: DeckSlide = {
  id: 'slide-2',
  pageType: 'content-compare',
  nodes: [
    { kind: 'text', contentId: 'left-0', contentColumn: 'left', contentOrder: 0, bullet: true, rect: { x: 96, y: 200, w: 500, h: 80 }, paragraphs: [{ bullet: true, runs: [{ text: '海表温度异常升高' }] }] },
    { kind: 'text', contentId: 'left-1', contentColumn: 'left', contentOrder: 1, bullet: false, rect: { x: 96, y: 296, w: 500, h: 80 }, paragraphs: [{ bullet: false, runs: [{ text: '极端天气频率增加' }] }] },
    { kind: 'text', contentId: 'right-0', contentColumn: 'right', contentOrder: 0, bullet: true, rect: { x: 680, y: 200, w: 500, h: 80 }, paragraphs: [{ bullet: true, runs: [{ text: '全球气候风险上升' }] }] },
    { kind: 'text', contentId: 'right-1', contentColumn: 'right', contentOrder: 1, bullet: true, rect: { x: 680, y: 296, w: 500, h: 80 }, paragraphs: [{ bullet: true, runs: [{ text: '需要协同应对' }] }] },
  ],
  contentManifest: items.map((item) => ({ ...item, role: 'compare', required: true })),
};

const canonicalHtml = [
  '<div data-compare-root="true">',
  '<div data-compare-column="left">',
  '<div data-content-id="left-0" data-column="left" data-order="0" data-bullet="true">• 海表温度异常升高</div>',
  '<div data-content-id="left-1" data-column="left" data-order="1" data-bullet="false">极端天气频率增加</div>',
  '</div>',
  '<div data-compare-column="right">',
  '<div data-content-id="right-0" data-column="right" data-order="0" data-bullet="true">• 全球气候风险上升</div>',
  '<div data-content-id="right-1" data-column="right" data-order="1" data-bullet="true">• 需要协同应对</div>',
  '</div>',
  '</div>',
].join('');

describe('content parity for content-compare', () => {
  it('passes exact identity/order/text/column/bullet and rect semantics', () => {
    const result = compareContentParity({ items, slide, html: canonicalHtml });
    expect(result.status).toBe('pass');
    expect(result.issues).toEqual([]);
  });

  it('reports missing pairs and semantic mismatches instead of silently passing', () => {
    const result = compareContentParity({
      items,
      slide: { ...slide, nodes: slide.nodes.slice(0, 3) },
      html: canonicalHtml.replace('data-order="1" data-bullet="true">• 需要协同应对', 'data-order="0" data-bullet="false">需要协同应对'),
    });

    expect(result.status).toBe('fail');
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'item_count_mismatch',
      'order_mismatch',
      'bullet_mismatch',
    ]));
  });
});
