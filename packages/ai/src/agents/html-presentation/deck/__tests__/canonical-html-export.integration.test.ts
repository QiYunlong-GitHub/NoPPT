import { describe, expect, it } from 'vitest';
import type { DeckSlide, DeckTextNode } from '@noppt/core/deck';
import { buildLayoutContext } from '../plan-to-deck';
import { deckSlideToHtml } from '../deck-to-html';

const context = buildLayoutContext({ title: 'canonical', primaryColor: '#2563eb', slides: [] });

function compareSlide(): DeckSlide {
  const item: DeckTextNode = {
    id: 'deck-node-item-1',
    kind: 'text',
    contentId: 'compare-item-1',
    contentColumn: 'left',
    contentOrder: 0,
    bullet: true,
    role: 'content',
    rect: { x: 64, y: 120, w: 560, h: 48 },
    paragraphs: [{ runs: [{ text: '海表温度异常升高' }], bullet: true }],
  };
  return { id: 'compare', pageType: 'content-compare', nodes: [item] };
}

describe('Task 9 canonical Deck → HTML integration contract', () => {
  it('emits one canonical logical-canvas root with identity metadata', () => {
    const html = deckSlideToHtml(compareSlide(), context);

    expect(html).toMatch(/^<div[^>]*data-canonical-root="true"/);
    expect(html).toContain('data-logical-width="1280"');
    expect(html).toContain('data-logical-height="720"');
    expect(html).toContain('aspect-ratio:1280 / 720');
    expect(html).toContain('width:var(--noppt-root-width,100vw)');
    expect(html).toContain('data-logical-canvas="true"');
    expect(html).toContain('max-width:1280px');
    expect((html.match(/data-canonical-root="true"/g) ?? [])).toHaveLength(1);
    expect(html).toContain('data-content-id="compare-item-1"');
    expect(html).toContain('data-deck-node-id="deck-node-item-1"');
    expect(html).toContain('data-role="content"');
  });

  it('keeps a bullet marker and its text in one mapped content node', () => {
    const html = deckSlideToHtml(compareSlide(), context);
    expect(html).toMatch(/<div[^>]*data-content-id="compare-item-1"[^>]*data-bullet="true"[\s\S]*• <span[^>]*>海表温度异常升高<\/span>[\s\S]*<\/div>/u);
    expect(html).not.toMatch(/<p[^>]*>•<\/p>\s*<span[^>]*>海表温度异常升高<\/span>/u);
  });

  it('bullet 段落不再 nowrap，长中文按卡片宽度换行且不越出 rect', () => {
    const longItem: DeckTextNode = {
      ...compareSlide().nodes[0] as DeckTextNode,
      paragraphs: [{
        runs: [{ text: '降雨：正常年西太平洋多雨，厄尔尼诺年降雨带明显东移并引发区域旱涝风险' }],
        bullet: true,
      }],
    };
    const html = deckSlideToHtml(
      { id: 'compare-long', pageType: 'content-compare', nodes: [longItem] } as DeckSlide,
      context,
    );
    expect(html).not.toContain('white-space:nowrap');
    expect(html).toContain('word-break:break-word');
    expect(html).toContain('overflow-wrap:anywhere');
    // 文本节点 rect 仍是 560px 上限，换行由样式约束，不再横向溢出到画布右缘。
    expect(html).toContain('width:560px');
  });

  it('canonical root 保持唯一最外层，不被 padding wrapper 包裹', () => {
    const html = deckSlideToHtml(compareSlide(), context);
    expect((html.match(/data-canonical-root="true"/g) ?? [])).toHaveLength(1);
    expect(html).not.toContain('padding:48px 64px');
    expect(html).not.toContain('padding: 48px 64px');
  });
});
