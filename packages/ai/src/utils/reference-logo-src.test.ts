// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  applyMasterLogoSources,
  applyReferenceImageUrlSources,
  type ReferenceOriginalUrls,
} from './reference-logo-src';
import type { ReferenceVisualAttributes } from '../types';

function makeRva(): ReferenceVisualAttributes {
  return {
    global: { uploaded: true, visual: { colorTone: 'light', imagery: 'none' }, master: undefined },
    byCategory: {
      cover: {
        uploaded: true,
        visual: {
          colorTone: 'light',
          imagery: 'photo',
          contentImageBBox: { x: 0, y: 0.32, w: 1, h: 0.36 },
        },
        master: {
          logo: {
            position: 'top-left',
            colorHex: '#e60012',
            x: 0.03,
            y: 0.04,
            w: 0.38,
            h: 0.12,
            confidence: 0.98,
          },
          header: { elements: [{ type: 'text', colorHex: '#e60012' }] },
        },
      },
      content: {
        uploaded: true,
        visual: { colorTone: 'light', imagery: 'none' },
        master: {
          logo: {
            position: 'top-right',
            colorHex: '#e60012',
            x: 0.81,
            y: 0.04,
            w: 0.18,
            h: 0.07,
            confidence: 0.9,
          },
          footer: { hasPageNumber: true },
        },
      },
      summary: {
        uploaded: false,
        visual: { colorTone: 'light', imagery: 'none' },
        master: undefined,
      },
    },
  } as unknown as ReferenceVisualAttributes;
}

describe('applyMasterLogoSources（FR-16 原图 URL 回写 + 尺寸）', () => {
  it('info 对象：回写 logo.src 且带回 refW/refH', () => {
    const rva = makeRva();
    const originals: ReferenceOriginalUrls = {
      cover: { url: '/data/.../cover.png', width: 2560, height: 1440 },
      content: { url: '/data/.../content.png', width: 2560, height: 1440 },
    };
    applyMasterLogoSources(rva, originals);
    expect(rva.byCategory.cover.master!.logo.src).toBe('/data/.../cover.png');
    expect(rva.byCategory.cover.master!.logo.refW).toBe(2560);
    expect(rva.byCategory.cover.master!.logo.refH).toBe(1440);
    expect(rva.byCategory.content.master!.logo.src).toBe('/data/.../content.png');
    expect(rva.byCategory.content.master!.logo.refW).toBe(2560);
  });

  it('兼容旧调用方直接传字符串 URL（无尺寸）', () => {
    const rva = makeRva();
    const originals: ReferenceOriginalUrls = { cover: '/data/.../cover.png' };
    applyMasterLogoSources(rva, originals);
    expect(rva.byCategory.cover.master!.logo.src).toBe('/data/.../cover.png');
    expect(rva.byCategory.cover.master!.logo.refW).toBeUndefined();
  });

  it('跨步骤兜底：仅传已落盘 URL（无 dataURL）时仍回写 src，保证 content/summary LOGO 不丢', () => {
    const rva = makeRva();
    // 模拟「缓存命中、本轮未重传原图」场景：originals 由磁盘复用得到
    const originals: ReferenceOriginalUrls = {
      cover: { url: '/data/.../cover.png', width: 2560, height: 1440 },
      content: { url: '/data/.../content.png', width: 2560, height: 1440 },
      summary: { url: '/data/.../summary.png', width: 2560, height: 1440 },
    };
    applyMasterLogoSources(rva, originals);
    // 三个分类的 logo.src 都应被补齐（含此前会丢失的 content/summary）
    expect(rva.byCategory.cover.master!.logo.src).toBeTruthy();
    expect(rva.byCategory.content.master!.logo.src).toBeTruthy();
    expect(rva.byCategory.summary.master).toBeUndefined(); // summary 无 master 设计，不强行造
  });

  it('缺少 bbox 的 logo 不回写 src（避免误开窗）', () => {
    const rva = makeRva();
    rva.byCategory.cover.master!.logo = { position: 'top-left', colorHex: '#e60012' };
    applyMasterLogoSources(rva, { cover: { url: '/data/.../cover.png' } });
    expect(rva.byCategory.cover.master!.logo.src).toBeUndefined();
  });
});

describe('applyReferenceImageUrlSources', () => {
  it('回写各分类 referenceImageUrl（info / 字符串兼容）', () => {
    const rva = makeRva();
    const originals: ReferenceOriginalUrls = {
      cover: { url: '/data/.../cover.png', width: 2560, height: 1440 },
      content: '/data/.../content.png',
    };
    applyReferenceImageUrlSources(rva, originals);
    expect(rva.byCategory.cover.referenceImageUrl).toBe('/data/.../cover.png');
    expect(rva.byCategory.content.referenceImageUrl).toBe('/data/.../content.png');
  });
});
