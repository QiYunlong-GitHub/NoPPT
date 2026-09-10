import { describe, it, expect } from 'vitest';
import {
  hasReferenceImage,
  resolveHeroImageForPage,
  normalizeBBox,
} from './reference-attribute-resolver';
import type { ReferenceVisualAttributes, ReferenceVisualFeatures } from '../types';

function visual(over: Partial<ReferenceVisualFeatures> = {}): ReferenceVisualFeatures {
  return {
    composition: undefined,
    columns: undefined,
    titleScale: undefined,
    decoration: undefined,
    backgroundTone: undefined,
    cardRadius: undefined,
    imagery: 'none',
    ...over,
  };
}

function makeRva(over: Partial<ReferenceVisualAttributes> = {}): ReferenceVisualAttributes {
  const base = {
    global: { uploaded: false, referenceImageUrl: undefined, referenceHtml: undefined, visual: visual(), style: {} as any, master: undefined },
    byCategory: {
      cover: { uploaded: true, referenceImageUrl: undefined, referenceHtml: undefined, visual: visual(), style: {} as any, master: undefined },
      content: { uploaded: true, referenceImageUrl: undefined, referenceHtml: undefined, visual: visual(), style: {} as any, master: undefined },
      summary: { uploaded: true, referenceImageUrl: undefined, referenceHtml: undefined, visual: visual(), style: {} as any, master: undefined },
    },
  };
  return { ...base, ...over } as ReferenceVisualAttributes;
}

describe('FR-0 normalizeBBox', () => {
  it('accepts a well-formed normalized bbox', () => {
    expect(normalizeBBox({ x: 0.1, y: 0.2, w: 0.5, h: 0.3 })).toEqual({ x: 0.1, y: 0.2, w: 0.5, h: 0.3 });
  });
  it('rejects null / non-object', () => {
    expect(normalizeBBox(null)).toBeUndefined();
    expect(normalizeBBox('nope')).toBeUndefined();
  });
  it('rejects non-finite values', () => {
    expect(normalizeBBox({ x: 'a', y: 0.2, w: 0.5, h: 0.3 })).toBeUndefined();
    expect(normalizeBBox({ x: NaN, y: 0.2, w: 0.5, h: 0.3 })).toBeUndefined();
  });
  it('rejects out-of-range origin or size', () => {
    expect(normalizeBBox({ x: 1.1, y: 0.2, w: 0.5, h: 0.3 })).toBeUndefined();
    expect(normalizeBBox({ x: 0.1, y: 0.2, w: 0, h: 0.3 })).toBeUndefined();
    expect(normalizeBBox({ x: 0.1, y: 0.2, w: 0.5, h: -0.1 })).toBeUndefined();
  });
  it('rejects bbox exceeding unit square', () => {
    expect(normalizeBBox({ x: 0.6, y: 0.2, w: 0.5, h: 0.3 })).toBeUndefined();
  });
});

describe('FR-0 hasReferenceImage (dual channel)', () => {
  it('detects VLM photo imagery on cover', () => {
    const rva = makeRva();
    rva.byCategory.cover.visual = visual({ imagery: 'photo' });
    expect(hasReferenceImage(rva, 'cover')).toBe(true);
  });
  it('detects VLM illustration imagery on content', () => {
    const rva = makeRva();
    rva.byCategory.content.visual = visual({ imagery: 'illustration' });
    expect(hasReferenceImage(rva, 'content')).toBe(true);
  });
  it('returns false for imagery=none without html', () => {
    const rva = makeRva();
    rva.byCategory.cover.visual = visual({ imagery: 'none' });
    expect(hasReferenceImage(rva, 'cover')).toBe(false);
  });
  it('detects <img> in reference HTML (channel B)', () => {
    const rva = makeRva();
    rva.byCategory.cover.referenceHtml = '<div><img src="x.png"></div>';
    expect(hasReferenceImage(rva, 'cover')).toBe(true);
  });
  it('detects background-image in reference HTML (channel B)', () => {
    const rva = makeRva();
    rva.byCategory.cover.referenceHtml = '<div style="background-image:url(x.png)"></div>';
    expect(hasReferenceImage(rva, 'cover')).toBe(true);
  });
  it('maps structural page types (toc) to the content category', () => {
    const rva = makeRva();
    rva.byCategory.content.visual = visual({ imagery: 'photo' });
    expect(hasReferenceImage(rva, 'toc')).toBe(true);
  });
  it('returns false for toc when content has no image attribute', () => {
    const rva = makeRva();
    rva.byCategory.content.visual = visual({ imagery: 'none' });
    expect(hasReferenceImage(rva, 'toc')).toBe(false);
  });
  it('returns false without attributes', () => {
    expect(hasReferenceImage(undefined, 'cover')).toBe(false);
    expect(hasReferenceImage(null, 'cover')).toBe(false);
  });
});

describe('FR-0 resolveHeroImageForPage', () => {
  it('returns src for cover photo with referenceImageUrl', () => {
    const rva = makeRva();
    rva.byCategory.cover.visual = visual({ imagery: 'photo' });
    rva.byCategory.cover.referenceImageUrl = 'file:///cover.png';
    expect(resolveHeroImageForPage(rva, 'cover')).toEqual({ src: 'file:///cover.png' });
  });
  it('returns src + bbox when contentImageBBox present and valid', () => {
    const rva = makeRva();
    rva.byCategory.summary.visual = visual({ imagery: 'photo', contentImageBBox: { x: 0.1, y: 0.2, w: 0.5, h: 0.3 } });
    rva.byCategory.summary.referenceImageUrl = 'file:///sum.png';
    expect(resolveHeroImageForPage(rva, 'summary')).toEqual({
      src: 'file:///sum.png',
      bbox: { x: 0.1, y: 0.2, w: 0.5, h: 0.3 },
    });
  });
  it('returns undefined when hasImage true but no referenceImageUrl', () => {
    const rva = makeRva();
    rva.byCategory.cover.visual = visual({ imagery: 'photo' });
    expect(resolveHeroImageForPage(rva, 'cover')).toBeUndefined();
  });
  it('falls back to global referenceImageUrl for summary html channel', () => {
    const rva = makeRva();
    rva.byCategory.summary.referenceHtml = '<img src="x.png">';
    rva.global.referenceImageUrl = 'file:///global.png';
    expect(resolveHeroImageForPage(rva, 'summary')).toEqual({ src: 'file:///global.png' });
  });
});
