import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Presentation, Slide } from '@noppt/core';
import type { DeckSlide } from '@noppt/core/deck';
import { presentationApi } from '@/utils/api';
import { usePresentationStore } from '@/stores/presentation';
import { presentationToDeck } from '@/export/presentation-to-deck';

/**
 * **Validates: Requirements 3.1–3.7**
 *
 * This is the Web preservation probe for the real editor/store and export
 * boundaries. It intentionally uses legal synthetic fixtures only: legacy
 * HTML, missing Deck, valid Deck, decorations, and a normal user edit flow.
 */
const FIXED_SEED = 0x51a7;
const RANDOM_CASE_SEED = 0x9e3779b9;

function next(seed: { value: number }): number {
  seed.value = (Math.imul(seed.value, 1664525) + 1013904223) >>> 0;
  return seed.value / 0x1_0000_0000;
}

const DECORATED_HTML = `<div style="width:1280px;height:720px;background:linear-gradient(135deg,#fff,#dbeafe)">
  <h2>合法编辑页面</h2><ul><li>保留列表</li><li>保留卡片</li></ul>
  <div data-role="decoration" style="background-color:#2563eb;border-radius:12px"></div>
  <img src="https://example.com/legal-decoration.png" alt="合法装饰图">
</div>`;

function deckSlide(id: string, title = '结构化页面'): DeckSlide {
  return {
    id,
    pageType: 'content-cards',
    title,
    nodes: [
      {
        id: `${id}-decoration`,
        kind: 'shape',
        role: 'decoration',
        shape: 'roundRect',
        rect: { x: 64, y: 48, w: 1152, h: 624 },
        fill: { type: 'gradient', gradient: { angle: 45, stops: [{ color: 'FFFFFF', offset: 0 }, { color: 'DBEAFE', offset: 1 }] } },
      },
      {
        id: `${id}-title`,
        kind: 'text',
        role: 'title',
        rect: { x: 96, y: 96, w: 1088, h: 64 },
        paragraphs: [{ runs: [{ text: title, fontSize: 32, fontFace: 'Arial' }] }],
      },
    ],
  };
}

function makeSlide(id: string, index: number, deck?: DeckSlide): Slide {
  return {
    id,
    title: deck?.title ?? '合法编辑页面',
    html: DECORATED_HTML,
    deck,
    hidden: false,
    index,
    createdAt: 0,
    updatedAt: 0,
  };
}

function makePresentation(slides?: Slide[]): Presentation {
  return {
    id: 'pres-preservation-baseline',
    title: '编辑能力基线',
    slides: slides ?? [makeSlide('legacy', 0), makeSlide('structured', 1, deckSlide('structured'))],
    selectedSlideId: 'legacy',
    zoom: 1,
    width: 1280,
    height: 720,
    transition: 'none',
    createdAt: 0,
    updatedAt: 0,
    version: 1,
  };
}

function observableExport(presentation: Presentation) {
  const deck = presentationToDeck(presentation);
  return {
    slideCount: deck.slides.length,
    source: deck.source,
    pageTypes: deck.slides.map((slide) => slide.pageType),
    nodeKinds: deck.slides.map((slide) => slide.nodes.map((node) => node.kind)),
    decorationKinds: deck.slides.map((slide) => slide.nodes.filter((node) => node.role === 'decoration').map((node) => node.kind)),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  usePresentationStore.setState({ presentation: null, history: [], historyIndex: -1, canUndo: false, canRedo: false, hasUnsavedChanges: false });
});

describe('presentation visual integrity · Web preservation baseline', () => {
  it('preserves legacy HTML fallback, missing Deck pages, valid Deck pages, and decorations', () => {
    const presentation = makePresentation();
    const exported = presentationToDeck(presentation);
    const legacyOnly = presentationToDeck(makePresentation([makeSlide('legacy', 0)]));

    expect(exported.slides).toHaveLength(2);
    expect(exported.source).toBe('plan');
    expect(exported.slides[0].nodes.length).toBeGreaterThan(0);
    expect(exported.slides[1].nodes).toBe(presentation.slides[1].deck?.nodes);
    expect(exported.slides[0].nodes.some((node) => node.kind === 'image')).toBe(true);
    expect(legacyOnly.source).toBe('html');
    expect(legacyOnly.slides[0].nodes.length).toBeGreaterThan(0);
    // HTML fallback has no stable role metadata yet; preserve the visual decoration as a shape.
    expect(legacyOnly.slides[0].nodes.some((node) => node.kind === 'shape')).toBe(true);
    expect(legacyOnly.slides[0].nodes.some((node) => node.kind === 'image')).toBe(true);
  });

  it('keeps export fallback behavior stable for seeded legal mixed presentations', () => {
    const seeds = [FIXED_SEED, RANDOM_CASE_SEED, 0x12345678, 0xdeadbeef];
    const observations = seeds.map((initialSeed, caseIndex) => {
      const seed = { value: initialSeed };
      const count = 1 + Math.floor(next(seed) * 3);
      const slides = Array.from({ length: count }, (_, index) => {
        const hasDeck = next(seed) > 0.45;
        return makeSlide(`generated-${caseIndex}-${index}`, index, hasDeck ? deckSlide(`generated-deck-${caseIndex}-${index}`, `页面 ${index}`) : undefined);
      });
      const presentation = makePresentation(slides);
      const observed = observableExport(presentation);

      expect(observed.slideCount).toBe(count);
      expect(observed.nodeKinds.every((nodes) => nodes.length > 0)).toBe(true);
      expect(observed.decorationKinds.every((nodes) => nodes.includes('shape') || nodes.length === 0)).toBe(true);
      return { seed: initialSeed, count, source: observed.source, pageTypes: observed.pageTypes };
    });

    expect(observations).toMatchSnapshot('seeded-export-fallback-cases');
  });

  it('keeps page selection, zoom, text edit, paste, undo/redo, and save capabilities', async () => {
    const presentation = makePresentation();
    usePresentationStore.getState().setPresentation(presentation, false, true);
    const store = usePresentationStore.getState();

    store.selectSlide('structured');
    expect(usePresentationStore.getState().presentation?.selectedSlideId).toBe('structured');

    store.setZoom(0.5);
    expect(usePresentationStore.getState().presentation?.zoom).toBe(0.5);

    store.updateSlide('structured', { title: '用户编辑标题' });
    expect(usePresentationStore.getState().presentation?.slides[1].title).toBe('用户编辑标题');
    expect(usePresentationStore.getState().canUndo).toBe(true);

    store.undo();
    expect(usePresentationStore.getState().presentation?.slides[1].title).toBe('结构化页面');
    store.redo();
    expect(usePresentationStore.getState().presentation?.slides[1].title).toBe('用户编辑标题');

    const beforePaste = usePresentationStore.getState().presentation?.slides.length ?? 0;
    store.pasteSlide(usePresentationStore.getState().presentation!.slides[0], 1);
    expect(usePresentationStore.getState().presentation?.slides.length).toBe(beforePaste + 1);

    store.updateCurrentSlideHtml('<div><p>复制粘贴后的合法文本</p></div>');
    expect(usePresentationStore.getState().hasUnsavedChanges).toBe(true);

    const saved = { ...usePresentationStore.getState().presentation!, updatedAt: 42 };
    const saveSpy = vi.spyOn(presentationApi, 'save').mockResolvedValue(saved);
    const savedOk = await usePresentationStore.getState().savePresentation();

    expect(savedOk).toBe(true);
    expect(saveSpy).toHaveBeenCalledWith(saved.id, expect.objectContaining({ id: saved.id }));
    expect(usePresentationStore.getState().hasUnsavedChanges).toBe(false);
  });

  it('records unavailable live editor/browser service as unverified without changing export assertions', () => {
    const unverified = {
      browser: { status: 'unverified', reason: 'EditorLayout live viewport is not started in the unit baseline.' },
      service: { status: 'unverified', reason: 'Task 0 recorded the API service as unavailable.' },
      font: { status: 'unverified', reason: 'Unit DOM cannot prove resolved font metrics.' },
    };

    expect(Object.values(unverified).every((item) => item.status === 'unverified')).toBe(true);
    expect(observableExport(makePresentation()).slideCount).toBe(2);
    expect(unverified).toMatchSnapshot('web-unverified-environment');
  });
});
