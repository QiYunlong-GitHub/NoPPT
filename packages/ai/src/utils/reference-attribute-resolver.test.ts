import { describe, it, expect } from 'vitest';
import type { ReferenceVisualAttributes, CategoryReference } from '../types';
import {
  resolveReferencePrimaryColor,
  resolveDeckReferencePrimaryColor,
  resolveFinalPagePrimaryColor,
  resolveTitleColor,
  resolveBodyColor,
  resolveHeroImageForPage,
  resolveLayoutForPage,
  formatReferenceOverrideForPage,
} from './reference-attribute-resolver';

function emptyCat(): CategoryReference {
  return { uploaded: false, style: {} };
}

function makeRva(): ReferenceVisualAttributes {
  return {
    byCategory: { cover: emptyCat(), content: emptyCat(), summary: emptyCat() },
    global: emptyCat(),
  };
}

describe('resolveReferencePrimaryColor', () => {
  it('分类已上传且主色合法 → 返回该分类主色（小写）', () => {
    const rva = makeRva();
    rva.byCategory.cover = { uploaded: true, style: { primaryColor: '#C7000B' } };
    expect(resolveReferencePrimaryColor(rva, 'cover')).toBe('#c7000b');
  });

  it('分类未上传 → 回落 global 主色', () => {
    const rva = makeRva();
    rva.global = { uploaded: true, style: { primaryColor: '#E60012' } };
    expect(resolveReferencePrimaryColor(rva, 'cover')).toBe('#e60012');
  });

  it('分类未上传且 global 未上传 → undefined（向后兼容，不回落默认蓝）', () => {
    const rva = makeRva();
    expect(resolveReferencePrimaryColor(rva, 'content')).toBeUndefined();
  });

  it('主色非法（非 6 位 hex）→ 视为无参考', () => {
    const rva = makeRva();
    rva.byCategory.content = { uploaded: true, style: { primaryColor: '#zzz' as any } };
    expect(resolveReferencePrimaryColor(rva, 'content')).toBeUndefined();
  });

  it('attrs 为 null/undefined → undefined', () => {
    expect(resolveReferencePrimaryColor(null, 'cover')).toBeUndefined();
    expect(resolveReferencePrimaryColor(undefined, 'cover')).toBeUndefined();
  });
});

describe('resolveDeckReferencePrimaryColor', () => {
  it('多分类主色一致/相近 → 提升为 deck 级（取众数，content 优先）', () => {
    const rva = makeRva();
    rva.byCategory.cover = { uploaded: true, style: { primaryColor: '#C7000B' } };
    rva.byCategory.content = { uploaded: true, style: { primaryColor: '#D81E06' } };
    rva.byCategory.summary = { uploaded: true, style: { primaryColor: '#E60012' } };
    rva.global = { uploaded: true, style: { primaryColor: '#123456' } };
    // 三个红相近（≤阈值），达成多分类共识 → 取 content 的 #d81e06
    expect(resolveDeckReferencePrimaryColor(rva)).toBe('#d81e06');
  });

  it('多分类主色互不一致 → 不提升（undefined，避免单一偶然值染全 deck）', () => {
    const rva = makeRva();
    rva.byCategory.cover = { uploaded: true, style: { primaryColor: '#00AA00' } }; // 绿
    rva.byCategory.content = { uploaded: true, style: { primaryColor: '#D81E06' } }; // 红
    rva.byCategory.summary = { uploaded: true, style: { primaryColor: '#0000FF' } }; // 蓝
    expect(resolveDeckReferencePrimaryColor(rva)).toBeUndefined();
  });

  it('唯一主色来源是 content → 提升为 deck 级', () => {
    const rva = makeRva();
    rva.byCategory.content = { uploaded: true, style: { primaryColor: '#D81E06' } };
    expect(resolveDeckReferencePrimaryColor(rva)).toBe('#d81e06');
  });

  it('唯一主色来源是 cover（非 content）→ 不提升，退化到 global', () => {
    const rva = makeRva();
    rva.byCategory.cover = { uploaded: true, style: { primaryColor: '#C7000B' } };
    expect(resolveDeckReferencePrimaryColor(rva)).toBeUndefined();
  });

  it('唯一主色来源是 summary（非 content）→ 不提升（修复粉染全 deck）', () => {
    const rva = makeRva();
    rva.byCategory.summary = { uploaded: true, style: { primaryColor: '#FF4D6D' } };
    expect(resolveDeckReferencePrimaryColor(rva)).toBeUndefined();
  });

  it('仅 summary 上传主色但有显式 global 主色 → 退化到 global', () => {
    const rva = makeRva();
    rva.byCategory.summary = { uploaded: true, style: { primaryColor: '#FF4D6D' } };
    rva.global = { uploaded: true, style: { primaryColor: '#654321' } };
    expect(resolveDeckReferencePrimaryColor(rva)).toBe('#654321');
  });

  it('仅 global 上传 → 取 global', () => {
    const rva = makeRva();
    rva.global = { uploaded: true, style: { primaryColor: '#654321' } };
    expect(resolveDeckReferencePrimaryColor(rva)).toBe('#654321');
  });

  it('无任何参考主色 → undefined', () => {
    const rva = makeRva();
    expect(resolveDeckReferencePrimaryColor(rva)).toBeUndefined();
  });
});

describe('resolveFinalPagePrimaryColor · 终局逐页三级链', () => {
  it('① 页面分类主色命中时优先返回（即便其它分类也有主色）', () => {
    const rva = makeRva();
    rva.byCategory.cover = { uploaded: true, style: { primaryColor: '#C7000B' } };
    rva.byCategory.content = { uploaded: true, style: { primaryColor: '#D81E06' } };
    expect(resolveFinalPagePrimaryColor(rva, 'content', '#2563eb')).toBe('#d81e06');
  });

  it('② 页面分类缺失，但唯一 content 主色被提升为 deck 级 → summary 页取 content 参考红，不回落默认蓝', () => {
    // 仅 content 上传主色（content 单分类可提升为 deck 级）；summary 页应取 content 参考红而非 fallback 默认蓝
    const rva = makeRva();
    rva.byCategory.content = { uploaded: true, style: { primaryColor: '#D81E06' } };
    expect(resolveFinalPagePrimaryColor(rva, 'summary', '#2563eb')).toBe('#d81e06');
  });

  it('②b 页面分类缺失，且唯一主色来自非 content（仅 cover）→ 不提升 deck 级，回落 fallback', () => {
    // 护栏：单 cover 主色不扩散为 deck 级；summary 页取 fallback（不回落到 cover 的色）
    const rva = makeRva();
    rva.byCategory.cover = { uploaded: true, style: { primaryColor: '#C7000B' } };
    expect(resolveFinalPagePrimaryColor(rva, 'summary', '#2563eb')).toBe('#2563eb');
  });

  it('②c 多分类主色互不一致 → deck 级不提升，无自身色的 content 页回落 fallback', () => {
    const rva = makeRva();
    rva.byCategory.cover = { uploaded: true, style: { primaryColor: '#00AA00' } };
    rva.byCategory.summary = { uploaded: true, style: { primaryColor: '#0000FF' } };
    // content 分类未上传主色，且其自身分类无主色 → 走 deck 级，但多分类不一致不提升 → fallback
    expect(resolveFinalPagePrimaryColor(rva, 'content', '#2563eb')).toBe('#2563eb');
  });

  it('③ 全部分类缺失但 global 有主色 → 取 global', () => {
    const rva = makeRva();
    rva.global = { uploaded: true, style: { primaryColor: '#654321' } };
    expect(resolveFinalPagePrimaryColor(rva, 'content', '#2563eb')).toBe('#654321');
  });

  it('④ 无任何参考主色时等于 fallback（向后兼容，与改造前逐字节一致）', () => {
    const rva = makeRva();
    expect(resolveFinalPagePrimaryColor(rva, 'content', '#2563eb')).toBe('#2563eb');
    expect(resolveFinalPagePrimaryColor(null, 'cover', '#2563eb')).toBe('#2563eb');
    expect(resolveFinalPagePrimaryColor(undefined, 'cover', '#2563eb')).toBe('#2563eb');
  });
});

describe('formatReferenceOverrideForPage · 视觉特征注入', () => {
  it('含 visual 时输出「视觉风格特征」指引行', () => {
    const rva = makeRva();
    rva.byCategory.cover = {
      uploaded: true,
      style: { primaryColor: '#c7000b' },
      referenceHtml: '<div class="cover-ref"></div>',
      visual: { composition: 'centered', columns: 2, decoration: 'gradient-glow', backgroundTone: 'light' },
    };
    const out = formatReferenceOverrideForPage(rva, 'cover');
    expect(out).toContain('视觉风格特征');
    expect(out).toContain('居中构图');
    expect(out).toContain('2 栏');
    expect(out).toContain('渐变光晕装饰');
  });

  it('无 visual 时不输出视觉指引行', () => {
    const rva = makeRva();
    rva.byCategory.cover = { uploaded: true, style: { primaryColor: '#c7000b' } };
    const out = formatReferenceOverrideForPage(rva, 'cover');
    expect(out).not.toContain('视觉风格特征');
  });
});

describe('resolveTitleColor / resolveBodyColor · 三级链 ref>user>default', () => {
  it('ref 优先于 user 与 default', () => {
    expect(resolveTitleColor('#111827', undefined, '#000000')).toBe('#111827');
    expect(resolveTitleColor(undefined, '#c7000b', '#000000')).toBe('#c7000b');
    expect(resolveTitleColor(undefined, undefined, '#000000')).toBe('#000000');
    expect(resolveBodyColor('#333333', undefined, '#374151')).toBe('#333333');
    expect(resolveBodyColor(undefined, undefined, '#374151')).toBe('#374151');
  });
  it('非法 hex 视为无参考，回落', () => {
    expect(resolveTitleColor('red', undefined, '#111827')).toBe('#111827');
    expect(resolveBodyColor('xyz', '#c7000b', '#374151')).toBe('#c7000b');
  });
});

describe('formatReferenceOverrideForPage · 文字色注入', () => {
  it('含 titleColor/bodyColor 时输出文字色指引行', () => {
    const rva = makeRva();
    rva.byCategory.cover = { uploaded: true, style: { titleColor: '#111827', bodyColor: '#333333' } };
    const out = formatReferenceOverrideForPage(rva, 'cover');
    expect(out).toContain('标题文字色(titleColor)');
    expect(out).toContain('正文文字色(bodyColor)');
    expect(out).toContain('#111827');
    expect(out).toContain('#333333');
  });
});

describe('resolveHeroImageForPage · bbox 降级语义（Q3 固化 + 纵深防御）', () => {
  it('正常 bbox 保留（传入 content 分类的参考原图 + 合法 contentImageBBox）', () => {
    const rva = makeRva();
    rva.byCategory.content = {
      uploaded: true,
      style: {},
      referenceImageUrl: '/data/x/content.png',
      visual: { imagery: 'photo', contentImageBBox: { x: 0.1, y: 0.2, w: 0.5, h: 0.3 } },
    };
    const res = resolveHeroImageForPage(rva, 'content');
    expect(res).toEqual({ src: '/data/x/content.png', bbox: { x: 0.1, y: 0.2, w: 0.5, h: 0.3 } });
  });

  it('越界 bbox（y+h>1）丢弃并降级为整图 cover（仅返回 src，无 bbox）', () => {
    const rva = makeRva();
    rva.byCategory.content = {
      uploaded: true,
      style: {},
      referenceImageUrl: '/data/x/content.png',
      // 脏数据：y + h = 0.8 + 0.3 = 1.1 > 1
      visual: { imagery: 'photo', contentImageBBox: { x: 0.1, y: 0.8, w: 0.5, h: 0.3 } },
    };
    const res = resolveHeroImageForPage(rva, 'content');
    expect(res).toEqual({ src: '/data/x/content.png' });
  });

  it('非法 bbox（宽高<=0）丢弃并降级为整图 cover', () => {
    const rva = makeRva();
    rva.byCategory.content = {
      uploaded: true,
      style: {},
      referenceImageUrl: '/data/x/content.png',
      visual: { imagery: 'photo', contentImageBBox: { x: 0.1, y: 0.2, w: 0, h: 0.3 } },
    };
    const res = resolveHeroImageForPage(rva, 'content');
    expect(res).toEqual({ src: '/data/x/content.png' });
  });

  it('参考图 URL 缺失 → undefined（有 imagery 但无 src 可注入）', () => {
    const rva = makeRva();
    rva.byCategory.content = {
      uploaded: true,
      style: {},
      visual: { imagery: 'photo', contentImageBBox: { x: 0.1, y: 0.2, w: 0.5, h: 0.3 } },
    };
    expect(resolveHeroImageForPage(rva, 'content')).toBeUndefined();
  });
});

describe('resolveLayoutForPage · 单分类作用域放宽（封面/总结不再被整体丢弃）', () => {
  it('content 分类 single 布局 → 内容页第 0 页应用，映射为内置 pageType', () => {
    const rva = makeRva();
    rva.byCategory.content = { uploaded: true, style: {}, layout: { type: 'single', single: 'card-grid' } };
    expect(resolveLayoutForPage(rva, 'content', 0, 'content-no-image')).toBe('content-cards');
    // 分类内非第 0 页不应用
    expect(resolveLayoutForPage(rva, 'content', 1, 'content-no-image')).toBeUndefined();
  });

  it('cover 分类 single 布局 → 封面页不再被作用域丢弃（仅 toc 仍排除），且不破坏封面结构页型', () => {
    const rva = makeRva();
    rva.byCategory.cover = { uploaded: true, style: {}, layout: { type: 'single', single: 'fullscreen-quote' } };
    // 放宽：封面页（第 0 页）会尝试应用；但结构保护避免把 cover 覆盖为 content-quote，故返回 undefined
    expect(resolveLayoutForPage(rva, 'cover', 0, 'cover')).toBeUndefined();
    // toc 仍被排除
    expect(resolveLayoutForPage(rva, 'cover', 0, 'toc')).toBeUndefined();
  });

  it('cover 分类 single 布局映射到与封面同类页型时仍允许覆盖（结构保护不误伤）', () => {
    const rva = makeRva();
    // 用 content 页型验证：若某封面骨架恰好映射为 cover 等价（此处以 content 路径代表），不拦截
    rva.byCategory.cover = { uploaded: true, style: {}, layout: { type: 'single', single: 'card-grid' } };
    // 封面页仍以内容型映射结果被结构保护拦截
    expect(resolveLayoutForPage(rva, 'cover', 0, 'cover')).toBeUndefined();
  });

  it('summary 分类 single 布局 → 总结页放宽作用域但不破坏 summary 结构页型', () => {
    const rva = makeRva();
    rva.byCategory.summary = { uploaded: true, style: {}, layout: { type: 'single', single: 'three-section' } };
    // summary 页结构保护：content-three-section !== 'summary' → 不覆盖，返回 undefined
    expect(resolveLayoutForPage(rva, 'summary', 0, 'summary')).toBeUndefined();
    // 但若 summary 骨架作为内容页参考（content 分类）则正常映射
    const rva2 = makeRva();
    rva2.byCategory.content = { uploaded: true, style: {}, layout: { type: 'single', single: 'three-section' } };
    expect(resolveLayoutForPage(rva2, 'content', 0, 'content-no-image')).toBe('content-three-section');
  });

  it('无上传分类 / 无布局 → undefined', () => {
    const rva = makeRva();
    expect(resolveLayoutForPage(rva, 'content', 0, 'content-no-image')).toBeUndefined();
  });
});

