import { describe, expect, it } from 'vitest';
import type {
  DeckImageNode,
  DeckShapeNode,
  DeckSlide,
  DeckTextNode,
  DeckNode,
} from '@noppt/core/deck';
import type { PresentationPlan, SlidePlan } from '../../../../types';
import { deckSlideToHtml } from '../deck-to-html';
import { buildLayoutContext, planToDeck } from '../plan-to-deck';

/**
 * **Validates: Requirements 3.1–3.7**
 *
 * Task 2 is observation-first: these tests characterize legal, non-bug inputs
 * against the current implementation before any visual-integrity fix lands.
 * The generator is deliberately local and deterministic so a failed baseline
 * can be reproduced without adding a runtime dependency.
 */
const FIXED_SEED = 0x51a7;
const RANDOM_CASE_SEED = 0x9e3779b9;

function next(seed: { value: number }): number {
  seed.value = (Math.imul(seed.value, 1664525) + 1013904223) >>> 0;
  return seed.value / 0x1_0000_0000;
}

function generatedText(seed: { value: number }, prefix: string, index: number): string {
  const suffixes = ['内容稳定', '合法边界', '用户编辑', '保留顺序'];
  return `${prefix}-${index}-${suffixes[Math.floor(next(seed) * suffixes.length)]}`;
}

function textNode(id: string, text: string, y: number, role: DeckTextNode['role'] = 'content'): DeckTextNode {
  return {
    id,
    kind: 'text',
    role,
    rect: { x: 96, y, w: 1088, h: 56 },
    paragraphs: [{ runs: [{ text, fontSize: 24, fontFace: 'Arial', color: '1F2937' }] }],
  };
}

function legalSlide(seed: { value: number }, index: number): DeckSlide {
  const body = Array.from({ length: 1 + Math.floor(next(seed) * 3) }, (_, item) =>
    generatedText(seed, `slide-${index}`, item),
  );
  const decoration: DeckShapeNode = {
    id: `decoration-${index}`,
    kind: 'shape',
    role: 'decoration',
    shape: 'roundRect',
    rect: { x: 48, y: 32, w: 1184, h: 656 },
    fill: {
      type: 'gradient',
      gradient: { angle: 45, stops: [{ color: 'FFFFFF', offset: 0 }, { color: 'DBEAFE', offset: 1 }] },
    },
  };
  const image: DeckImageNode = {
    id: `image-${index}`,
    kind: 'image',
    role: 'decoration',
    rect: { x: 1000, y: 560, w: 160, h: 96 },
    src: 'https://example.com/legal-decoration.png',
    alt: '合法装饰图',
    fit: 'contain',
  };
  return {
    id: `legal-slide-${index}`,
    pageType: 'content-cards',
    title: `合法页面 ${index}`,
    nodes: [
      decoration,
      textNode(`title-${index}`, `合法页面 ${index}`, 96, 'title'),
      ...body.map((value, item) => textNode(`body-${index}-${item}`, value, 184 + item * 72)),
      image,
    ],
  };
}

function nodeText(node: DeckNode): string {
  if (node.kind === 'text') return node.paragraphs.flatMap((p) => p.runs.map((r) => r.text)).join('');
  if (node.kind === 'shape') return (node.text ?? []).flatMap((p) => p.runs.map((r) => r.text)).join('');
  if (node.kind === 'group') return node.children.map(nodeText).join('');
  return '';
}

function observableSlide(slide: DeckSlide, html: string) {
  const text = slide.nodes.map(nodeText).filter(Boolean);
  return {
    id: slide.id,
    pageType: slide.pageType,
    title: slide.title,
    text,
    nodeKinds: slide.nodes.map((node) => node.kind),
    decorationPreserved: html.includes('linear-gradient') && html.includes('legal-decoration.png'),
    logicalRects: slide.nodes.map((node) => node.rect),
  };
}

function planFixture(seed: { value: number }): PresentationPlan {
  const slides: SlidePlan[] = [
    {
      pageType: 'cover',
      title: generatedText(seed, 'cover', 0),
      keyPoints: [],
      needsImage: false,
    },
    {
      pageType: 'content-image-left',
      title: generatedText(seed, 'content', 1),
      keyPoints: [generatedText(seed, 'point', 0)],
      needsImage: false,
    },
  ];
  return { title: '合法演示', description: '合法输入基线', primaryColor: '#2563eb', slides };
}

describe('presentation visual integrity · AI preservation baseline', () => {
  it('preserves content order, legal decorations, and logical geometry for seeded legal Decks', () => {
    const seed = { value: FIXED_SEED };
    const observations = Array.from({ length: 4 }, (_, index) => {
      const slide = legalSlide(seed, index);
      const html = deckSlideToHtml(slide, buildLayoutContext({ title: 't', primaryColor: '#2563eb', slides: [] }));
      const observed = observableSlide(slide, html);

      expect(observed.text).toContain(`合法页面 ${index}`);
      expect(observed.decorationPreserved).toBe(true);
      expect(slide.nodes.every((node) => node.rect.x >= 0 && node.rect.y >= 0)).toBe(true);
      expect(slide.nodes.every((node) => node.rect.x + node.rect.w <= 1280 && node.rect.y + node.rect.h <= 720)).toBe(true);
      expect(html).toContain('合法装饰图');
      return observed;
    });

    expect(observations).toMatchSnapshot('fixed-seed-legal-decks');
  });

  it('preserves page count, order, titles, and style intent through plan-to-deck', () => {
    const seed = { value: RANDOM_CASE_SEED };
    const plan = planFixture(seed);
    const deck = planToDeck(plan, { fontFamily: 'Arial' });

    expect(deck.slides).toHaveLength(plan.slides.length);
    expect(deck.slides.map((slide) => slide.pageType)).toEqual(plan.slides.map((slide) => slide.pageType));
    expect(deck.slides.map((slide) => slide.title)).toEqual(plan.slides.map((slide) => slide.title));
    expect(deck.theme?.primary).toBe('2563EB');
    expect(deck.theme?.fontFamily).toBe('Arial');
    expect(deck.slides.every((slide) => slide.nodes.length > 0)).toBe(true);
  });

  it('runs the same preservation invariant across generated legal Decks', () => {
    const seeds = [FIXED_SEED, RANDOM_CASE_SEED, 0x12345678, 0xdeadbeef];
    const cases = seeds.map((initialSeed, caseIndex) => {
      const seed = { value: initialSeed };
      const slide = legalSlide(seed, caseIndex);
      const html = deckSlideToHtml(slide, buildLayoutContext({ title: 't', primaryColor: '#2563eb', slides: [] }));
      const expectedText = slide.nodes.map(nodeText).filter(Boolean);
      const missing = expectedText.filter((text) => !html.includes(text));

      expect(missing, `seed=${initialSeed}`).toEqual([]);
      expect(slide.nodes.filter((node) => node.role === 'decoration')).toHaveLength(2);
      return { seed: initialSeed, textCount: expectedText.length, missingCount: missing.length };
    });

    expect(cases).toMatchSnapshot('seeded-property-cases');
  });

  it('records browser/font limitations as unverified rather than treating them as preservation passes', () => {
    const environmentBaseline = [
      { capability: 'Chromium visual renderer', status: 'unverified', reason: 'Task 2 baseline does not start a browser service.' },
      { capability: 'Declared font metric resolution', status: 'unverified', reason: 'No per-node font metric probe is available in the current pre-fix boundary.' },
    ];

    expect(environmentBaseline.every((item) => item.status !== 'pass')).toBe(true);
    expect(environmentBaseline).toMatchSnapshot('environment-limitations');
  });
});
