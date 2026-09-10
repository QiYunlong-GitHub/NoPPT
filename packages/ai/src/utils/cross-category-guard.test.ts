import { describe, it, expect } from 'vitest';
import {
  resolveStructureSource,
  getReferenceSnippetForPage,
  resolveReferenceComposition,
  computePageIndexInCategory,
  formatReferenceOverrideForPage,
  type ReferenceVisualAttributes,
  type CategoryReference,
} from './reference-attribute-resolver';

function emptyCat(): CategoryReference {
  return { uploaded: false, style: {} } as CategoryReference;
}

function makeRva(opts: {
  cover?: CategoryReference;
  content?: CategoryReference;
  summary?: CategoryReference;
  global?: CategoryReference;
}): ReferenceVisualAttributes {
  return {
    global: opts.global ?? emptyCat(),
    byCategory: {
      cover: opts.cover ?? emptyCat(),
      content: opts.content ?? emptyCat(),
      summary: opts.summary ?? emptyCat(),
    },
    source: 'merged-category-assembled',
  };
}

const contentRef = {
  uploaded: true,
  style: { primaryColor: '#D81E06' },
  referenceHtml: '<div class="content-skeleton">...</div>',
  layout: { type: 'single', single: 'card-grid' },
  visual: { composition: 'left-aligned', columns: 2 },
  structure: { layoutVerbal: '左文右图', hasImageSlot: true, imageSide: 'left' },
} as CategoryReference;

describe('单份参考跨分类结构污染防护', () => {
  it('仅传一份 global（无分类上传）：structure 来源仅 content 为 global-content-fallback，cover/summary 为 none', () => {
    const rva = makeRva({ global: contentRef });
    expect(resolveStructureSource(rva, 'cover').kind).toBe('none');
    expect(resolveStructureSource(rva, 'summary').kind).toBe('none');
    expect(resolveStructureSource(rva, 'content').kind).toBe('global-content-fallback');
  });

  it('仅传一份 global：getReferenceSnippetForPage 对 content 返回骨架、对 cover/summary 返回空', () => {
    const rva = makeRva({ global: contentRef });
    expect(getReferenceSnippetForPage(rva, 'content', 0)).toBe(contentRef.referenceHtml);
    expect(getReferenceSnippetForPage(rva, 'cover', 0)).toBe('');
    expect(getReferenceSnippetForPage(rva, 'summary', 0)).toBe('');
  });

  it('仅传一份 global：resolveReferenceComposition 对 cover 返回 unknown、对 content 返回 left-aligned', () => {
    const rva = makeRva({ global: contentRef });
    expect(resolveReferenceComposition(rva, 'cover')).toBe('unknown');
    expect(resolveReferenceComposition(rva, 'content')).toBe('left-aligned');
  });

  it('仅传一份 global：content 第 1 页骨架片段降级为空（防多页雷同）', () => {
    const rva = makeRva({ global: contentRef });
    expect(getReferenceSnippetForPage(rva, 'content', 1)).toBe('');
  });
});

describe('分类显式上传：结构层正常生效', () => {
  it('content 分类显式上传：explicit 来源，首屏含 layout/结构指引/构图红线', () => {
    const rva = makeRva({ content: contentRef, global: contentRef });
    expect(resolveStructureSource(rva, 'content').kind).toBe('explicit');
    const block = formatReferenceOverrideForPage(rva, 'content', 0);
    expect(block).toContain('布局骨架(layout)：card-grid');
    expect(block).toContain('参考版式结构指引');
    expect(block).toContain('构图红线');
  });

  it('cover 分类显式上传：cover 可继承自身结构，不受 global 影响', () => {
    const coverRef = {
      uploaded: true,
      style: { primaryColor: '#c7000b' },
      referenceHtml: '<div class="cover-skeleton"></div>',
      layout: { type: 'single', single: 'hero-centered' },
    } as CategoryReference;
    const rva = makeRva({ cover: coverRef, global: contentRef });
    expect(resolveStructureSource(rva, 'cover').kind).toBe('explicit');
    expect(formatReferenceOverrideForPage(rva, 'cover', 0)).toContain(
      '布局骨架(layout)：hero-centered',
    );
  });
});

describe('computePageIndexInCategory', () => {
  const slides = [
    { pageType: 'cover' },
    { pageType: 'content-cards' },
    { pageType: 'content-timeline' },
    { pageType: 'content-cards' },
    { pageType: 'summary' },
  ];
  it('正确计算分类内序号（第 0 页才克隆参考结构）', () => {
    expect(computePageIndexInCategory(slides, 0)).toBe(0);
    expect(computePageIndexInCategory(slides, 1)).toBe(0);
    expect(computePageIndexInCategory(slides, 2)).toBe(1);
    expect(computePageIndexInCategory(slides, 3)).toBe(2);
    expect(computePageIndexInCategory(slides, 4)).toBe(0);
  });
});
