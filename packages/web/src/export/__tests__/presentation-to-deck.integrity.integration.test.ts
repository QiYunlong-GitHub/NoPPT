import { describe, expect, it } from 'vitest';
import type { Presentation } from '@noppt/core';
import type { DeckSlide } from '@noppt/core/deck';
import { presentationToDeck } from '../presentation-to-deck';
import { buildPptx } from '../pptx/deck-to-pptx';

function deckSlide(text: string, id = 'structured'): DeckSlide {
  return {
    id,
    pageType: 'content-cards',
    nodes: [
      {
        id: `${id}-node`,
        kind: 'text',
        contentId: `${id}-content`,
        role: 'body',
        rect: { x: 64, y: 64, w: 600, h: 80 },
        paragraphs: [{ runs: [{ text }] }],
      },
    ],
  };
}

function presentation(slide: Partial<Presentation['slides'][number]>): Presentation {
  return {
    id: 'p-task-9',
    title: 'Task 9',
    slides: [{
      id: 's1',
      title: 'Task 9 slide',
      html: '<div data-canonical-root="true" data-logical-width="1280" data-logical-height="720"><p>HTML text</p></div>',
      hidden: false,
      index: 0,
      createdAt: 0,
      updatedAt: 0,
      ...slide,
    }],
    width: 1280,
    height: 720,
    zoom: 1,
    transition: 'none',
    createdAt: 0,
    updatedAt: 0,
    version: 1,
  } as Presentation;
}

describe('Task 9 presentation/export parity boundary', () => {
  it('prioritizes a valid Deck over contradictory HTML', () => {
    const deck = presentationToDeck(presentation({
      deck: deckSlide('Deck truth'),
      html: '<div><p>HTML text</p></div>',
    }));
    const text = deck.slides[0].nodes[0];

    expect(text.kind).toBe('text');
    if (text.kind === 'text') expect(text.paragraphs[0].runs[0].text).toBe('Deck truth');
    expect(deck.slides[0].source).toBe('plan');
    expect(deck.slides[0].geometryFallback).toBe(false);
    expect(deck.slides[0].parity).toBe('pass');
  });

  it('uses HTML-only fallback with explicit provenance and geometry downgrade', () => {
    const deck = presentationToDeck(presentation({
      html: '<div><h2>历史 HTML</h2><p>只存在于 HTML</p></div>',
    }));

    expect(deck.slides[0].source).toBe('html');
    expect(deck.slides[0].geometryFallback).toBe(true);
    expect(deck.slides[0].parity).toBe('needs_review');
    expect(deck.slides[0].nodes.length).toBeGreaterThan(0);
  });

  it('blocks a canonical Deck/HTML parity mismatch instead of silently exporting Deck', async () => {
    const deck = presentationToDeck(presentation({
      deck: deckSlide('Deck truth'),
      html: '<div data-canonical-root="true" data-logical-width="1280" data-logical-height="720"><p>HTML truth</p></div>',
    }));

    expect(deck.slides[0].nodes).toHaveLength(0);
    expect(deck.slides[0].parity).toBe('needs_review');
    expect(deck.slides[0].parityIssues).toEqual(expect.arrayContaining([expect.stringContaining('text')]));
    expect(deck.integrity?.status).toBe('needs_review');
    await expect(buildPptx(deck)).rejects.toThrow(/integrity requires review|parity requires review/u);
  });
});
