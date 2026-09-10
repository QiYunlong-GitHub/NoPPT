import { describe, it, expect } from 'vitest';
import { buildReferenceContext } from './reference-attribute-resolver';
import type { CategoryReference, ReferenceVisualAttributes, ReferenceStyleAttrs } from '../types';

function mkCat(uploaded: boolean, style?: Partial<ReferenceStyleAttrs>): CategoryReference {
  return { uploaded, ...(style ? { style: style as ReferenceStyleAttrs } : {}) };
}

function mkRva(opts: {
  global?: boolean;
  cover?: boolean;
  content?: boolean;
  summary?: boolean;
  withStyle?: boolean;
  imageOnly?: boolean;
}): ReferenceVisualAttributes {
  const style = opts.withStyle
    ? ({ primaryColor: '#123456', style: 'tech' } as ReferenceStyleAttrs)
    : undefined;
  const contentStyle = opts.imageOnly ? undefined : style;
  return {
    global: mkCat(!!opts.global, opts.global ? style : undefined),
    byCategory: {
      cover: mkCat(!!opts.cover, opts.cover ? style : undefined),
      content: mkCat(!!opts.content, contentStyle),
      summary: mkCat(!!opts.summary, opts.summary ? style : undefined),
    },
    source: 'merged-category-assembled',
  };
}

describe('buildReferenceContext (FR-17.2 · Task5)', () => {
  it('无 rva → hasReference=false, source=none', () => {
    const ctx = buildReferenceContext(undefined);
    expect(ctx.hasReference).toBe(false);
    expect(ctx.source).toBe('none');
  });

  it('全未上传 → hasReference=false', () => {
    const ctx = buildReferenceContext(mkRva({}));
    expect(ctx.hasReference).toBe(false);
  });

  it('content 上传且带 style → hasReference=true, source=html, appliedFields 含 primaryColor', () => {
    const ctx = buildReferenceContext(mkRva({ content: true, withStyle: true }));
    expect(ctx.hasReference).toBe(true);
    expect(ctx.source).toBe('html');
    expect(ctx.appliedFields).toContain('primaryColor');
  });

  it('仅图片上传（无 style）→ source=image', () => {
    const ctx = buildReferenceContext(mkRva({ content: true, imageOnly: true }));
    expect(ctx.hasReference).toBe(true);
    expect(ctx.source).toBe('image');
  });
});
