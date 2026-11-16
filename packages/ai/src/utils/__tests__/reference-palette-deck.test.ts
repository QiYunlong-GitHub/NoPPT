/**
 * Deck 路径参考调色板收敛回归：整册共用一套 accents，
 * 同时确认 LLM-HTML 回退路径的逐页分类策略保持不变（参考多色保真）。
 */

import { describe, expect, it } from 'vitest';
import type { ReferencePalette, ReferenceVisualAttributes } from '../../types';
import { getReferencePaletteForDeck, getReferencePaletteForPage } from '../reference/color';

const GLOBAL: ReferencePalette = {
  primary: '#111827', accents: ['#06d6a0', '#073b4c', '#118ab2'], isMultiColor: true,
};
const COVER: ReferencePalette = {
  primary: '#a8d5b5', accents: ['#a8d5b5', '#f5d76e'], isMultiColor: true,
};
const CONTENT: ReferencePalette = {
  primary: '#5c6b7a', accents: ['#5c6b7a', '#e94560'], isMultiColor: true,
};
const SUMMARY: ReferencePalette = {
  primary: '#073b4c', accents: ['#06d6a0', '#073b4c', '#118ab2'], isMultiColor: true,
};

const attrs: ReferenceVisualAttributes = {
  global: { uploaded: false, style: {}, palette: GLOBAL },
  byCategory: {
    cover: { uploaded: true, style: {}, palette: COVER },
    content: { uploaded: true, style: {}, palette: CONTENT },
    summary: { uploaded: true, style: {}, palette: SUMMARY },
  },
  source: 'fallback-global',
};

describe('deck 级参考调色板裁决', () => {
  it('整册 global 上传时优先取 global，且与页型无关', () => {
    const withGlobal: ReferenceVisualAttributes = {
      ...attrs,
      global: { ...attrs.global, uploaded: true },
    };
    expect(getReferencePaletteForDeck(withGlobal)).toBe(GLOBAL);
    expect(getReferencePaletteForDeck(withGlobal)).toBe(getReferencePaletteForDeck(withGlobal));
  });

  it('无 global 时统一回落到 content 分类，不再跨页漂移', () => {
    expect(getReferencePaletteForDeck(attrs)).toBe(CONTENT);
  });

  it('全局与分类都未上传时返回 undefined（默认零装饰）', () => {
    const empty: ReferenceVisualAttributes = {
      global: { uploaded: false, style: {} },
      byCategory: {
        cover: { uploaded: false, style: {} },
        content: { uploaded: false, style: {} },
        summary: { uploaded: false, style: {} },
      },
      source: 'fallback-global',
    };
    expect(getReferencePaletteForDeck(empty)).toBeUndefined();
  });

  it('LLM-HTML 侧逐页策略仍按 cover/content/summary 分档（保真不变）', () => {
    expect(getReferencePaletteForPage(attrs, 'cover')).toBe(COVER);
    expect(getReferencePaletteForPage(attrs, 'content-no-image')).toBe(CONTENT);
    expect(getReferencePaletteForPage(attrs, 'summary')).toBe(SUMMARY);
  });
});
