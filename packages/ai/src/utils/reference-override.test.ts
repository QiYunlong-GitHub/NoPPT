import { describe, it, expect } from 'vitest';
import type { ReferenceVisualAttributes } from '../types';
import {
  formatReferenceOverrideForPage,
  formatReferenceOverrideOverview,
} from './reference-attribute-resolver';

function makeAttrs(over: Partial<ReferenceVisualAttributes>): ReferenceVisualAttributes {
  return {
    global: { uploaded: false, style: {} },
    byCategory: {
      cover: { uploaded: false, style: {} },
      content: { uploaded: false, style: {} },
      summary: { uploaded: false, style: {} },
    },
    source: 'merged-category-assembled',
    ...over,
  };
}

describe('formatReferenceOverrideForPage', () => {
  it('returns empty string when no reference uploaded', () => {
    const attrs = makeAttrs({});
    expect(formatReferenceOverrideForPage(attrs, 'cover')).toBe('');
    expect(formatReferenceOverrideForPage(attrs, 'content-no-image')).toBe('');
  });

  it('emits cover-class overrides for a cover page', () => {
    const attrs = makeAttrs({
      byCategory: {
        cover: { uploaded: true, style: { primaryColor: '#ff0000', fontFamily: 'serif' } },
        content: { uploaded: false, style: {} },
        summary: { uploaded: false, style: {} },
      },
    });
    const block = formatReferenceOverrideForPage(attrs, 'cover');
    expect(block).toContain('主色(primaryColor)：#ff0000');
    expect(block).toContain('字体(fontFamily)：serif');
    expect(block).toContain('pageType=cover');
    expect(block).toContain('参考文件 > 用户全局设置');
  });

  it('falls back to global when page category not uploaded', () => {
    const attrs = makeAttrs({
      global: { uploaded: true, style: { primaryColor: '#00ff00', iconStyle: 'bullet' } },
    });
    const block = formatReferenceOverrideForPage(attrs, 'content-no-image');
    expect(block).toContain('主色(primaryColor)：#00ff00');
    expect(block).toContain('图标风格(iconStyle)：bullet');
  });

  it('includes master + layout when present', () => {
    const attrs = makeAttrs({
      byCategory: {
        cover: {
          uploaded: true,
          style: {},
          master: { footer: { textContent: '机密' } },
        },
        content: {
          uploaded: true,
          style: {},
          referenceHtml: '<div class="content-ref"></div>',
          layout: { type: 'single', single: 'hero-centered' },
        },
        summary: { uploaded: false, style: {} },
      },
    });
    const coverBlock = formatReferenceOverrideForPage(attrs, 'cover');
    expect(coverBlock).toContain('页脚文字「机密」');
    // single.layout 在内容分类上照常作用（封面/总结页的骨架仅作 prompt 指引，不覆盖结构页型），故用内容页验证
    const contentBlock = formatReferenceOverrideForPage(attrs, 'content-no-image');
    expect(contentBlock).toContain('布局骨架(layout)：hero-centered');
  });
});

describe('单份参考跨分类结构污染防护（仅 global 时 cover 无结构指令）', () => {
  it('仅传一份 global 参考：cover 页不含 layout/结构指引/构图红线，但仍含风格层（主色）', () => {
    const attrs = makeAttrs({
      global: {
        uploaded: true,
        style: { primaryColor: '#D81E06', fontFamily: 'serif' },
        referenceHtml: '<div class="content-skeleton">...</div>',
        layout: { type: 'single', single: 'card-grid' },
        visual: { composition: 'left-aligned', columns: 2 },
        structure: { layoutVerbal: '左文右图', hasImageSlot: true, imageSide: 'left' },
      } as any,
    });
    const coverBlock = formatReferenceOverrideForPage(attrs, 'cover', 0);
    expect(coverBlock).not.toContain('布局骨架(layout)');
    expect(coverBlock).not.toContain('参考版式结构指引');
    expect(coverBlock).not.toContain('构图红线');
    // 风格层仍广播（保留「只传一份 → 全 deck 风格统一」预期）
    expect(coverBlock).toContain('主色(primaryColor)：#D81E06');
  });

  it('仅传一份 global 参考：content 第 0 页含结构与风格，第 1 页不再含 layout/结构指引（防多页雷同）', () => {
    const attrs = makeAttrs({
      global: {
        uploaded: true,
        style: { primaryColor: '#D81E06' },
        referenceHtml: '<div class="content-skeleton">...</div>',
        layout: { type: 'single', single: 'card-grid' },
        visual: { composition: 'left-aligned', columns: 2 },
        structure: { layoutVerbal: '左文右图' },
      } as any,
    });
    const c0 = formatReferenceOverrideForPage(attrs, 'content', 0);
    expect(c0).toContain('布局骨架(layout)：card-grid');
    expect(c0).toContain('参考版式结构指引');
    const c1 = formatReferenceOverrideForPage(attrs, 'content', 1);
    expect(c1).not.toContain('布局骨架(layout)');
    expect(c1).not.toContain('参考版式结构指引');
  });
});

describe('formatReferenceOverrideOverview', () => {
  it('returns empty string when nothing uploaded', () => {
    expect(formatReferenceOverrideOverview(makeAttrs({}))).toBe('');
  });

  it('summarizes per-category reference styles', () => {
    const attrs = makeAttrs({
      byCategory: {
        cover: { uploaded: true, style: { primaryColor: '#ff0000', fontFamily: 'serif' } },
        content: { uploaded: false, style: {} },
        summary: { uploaded: true, style: { contentDensity: 'compact' } },
      },
      global: { uploaded: true, style: { iconStyle: 'bullet' } },
    });
    const ov = formatReferenceOverrideOverview(attrs);
    expect(ov).toContain('封面类参考：主色 #ff0000、字体 serif');
    expect(ov).toContain('总结类参考：密度 compact');
    expect(ov).toContain('全局参考：图标 bullet');
    expect(ov).toContain('规划阶段');
  });
});
