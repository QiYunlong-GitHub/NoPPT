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
});
