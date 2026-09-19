// ================================================================
// AiService · postProcessPresentation 关键子阶段 —— 行为锁定测试（characterization）
//
// 目的：在 Phase 5 把后处理子阶段切块外置之前，先锁定「现状行为」保证后续纯搬移不变：
//   1) 5 级 single-source primary 链（resolveFinalEffectivePrimary）
//   2) 参考注入（resolveReferenceForGeneration / backfillReferenceOriginalSources /
//      persistReferenceOriginals）
//   3) 孤儿配图编排（rescueOrphanImages）—— 见下方 describe
//
// 调用方式：const svc = Object.create(AiService.prototype) as any;
// 纯逻辑方法直接调用；依赖 this.* 的方法用 vi.fn 打桩。
// ================================================================
import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AiService } from '../ai.service';

const svc = Object.create(AiService.prototype) as any;

// —— 最小 ReferenceVisualAttributes 构造器 ——
function makeRva(overrides: any = {}) {
  const cat = (primaryColor?: string, hasBox = false) => ({
    uploaded: !!primaryColor,
    style: primaryColor ? { primaryColor } : {},
    master: hasBox ? { logo: { x: 0, y: 0, w: 1, h: 1 } } : undefined,
    referenceImageUrl: undefined,
  });
  return {
    byCategory: {
      cover: cat(overrides.cover, true),
      content: cat(overrides.content, true),
      summary: cat(overrides.summary, true),
    },
    global: { uploaded: false, style: {} },
    ...overrides.extra,
  };
}

describe('AiService · 5 级 single-source primary 链（resolveFinalEffectivePrimary）', () => {
  it('无参考属性 → 回落 design.primaryColor（5 级链），并写回 presentation.design 与 generationOptions', () => {
    const presentation: any = { design: { primaryColor: '#999999' } };
    const generationOptions: any = {};
    const final = svc.resolveFinalEffectivePrimary(presentation, generationOptions, {
      primaryColor: undefined,
      colorTheme: undefined,
      design: { primaryColor: '#123456' },
    });
    expect(final).toBe('#123456');
    expect(presentation.design.primaryColor).toBe('#123456');
    expect(generationOptions.primaryColor).toBe('#123456');
  });

  it('参考 deck 主色优先（single-source：参考 > 用户 > 默认蓝）', () => {
    const presentation: any = { design: { primaryColor: '#000000' } };
    const generationOptions: any = { referenceVisualAttributes: makeRva({ content: '#C7000B' }) };
    const final = svc.resolveFinalEffectivePrimary(presentation, generationOptions, {
      primaryColor: '#2563eb',
      colorTheme: undefined,
      design: { primaryColor: '#123456' },
    });
    // content 单分类主色被提升为 deck 级 → 优先于用户/design
    expect(final).toBe('#c7000b');
    expect(generationOptions.primaryColor).toBe('#c7000b');
  });

  it('colorTheme 存在时同步写回 design.colorTheme 与 generationOptions.colorTheme', () => {
    const presentation: any = { design: { primaryColor: '#123456' } };
    const generationOptions: any = {};
    svc.resolveFinalEffectivePrimary(presentation, generationOptions, {
      primaryColor: undefined,
      colorTheme: 'warm-red',
      design: { primaryColor: '#123456' },
    });
    expect(presentation.design.colorTheme).toBe('warm-red');
    expect(generationOptions.colorTheme).toBe('warm-red');
  });

  it('presentation 无 design 对象时不抛错（容错）', () => {
    const presentation: any = {};
    const generationOptions: any = {};
    const final = svc.resolveFinalEffectivePrimary(presentation, generationOptions, {
      primaryColor: undefined,
      colorTheme: undefined,
      design: { primaryColor: '#abcdef' },
    });
    expect(final).toBe('#abcdef');
  });
});

describe('AiService · 参考注入（resolveReferenceForGeneration）', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('聚合 referenceVisualAttributes + brief + version/source', async () => {
    const rva = makeRva({ content: '#C7000B' });
    svc.resolveReferenceVisualAttributes = vi.fn(async () => ({
      referenceVisualAttributes: rva,
      refAttrsVersion: 'v42',
      source: 'html',
    }));
    const res = await svc.resolveReferenceForGeneration({} as any);
    expect(res.referenceVisualAttributes).toBe(rva);
    expect(res.refAttrsVersion).toBe('v42');
    // brief 由 buildReferenceBrief（纯函数）产出，content 分类有主色 → 非空
    expect(typeof res.referenceHtmlBrief).toBe('string');
    expect(svc.resolveReferenceVisualAttributes).toHaveBeenCalledTimes(1);
  });
});

describe('AiService · 参考注入（backfillReferenceOriginalSources）', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('无 presentationId → 直接返回（不读盘）', () => {
    const read = vi.fn();
    svc.storage = { readReferenceOriginalImage: read } as any;
    svc.backfillReferenceOriginalSources(makeRva(), undefined);
    expect(read).not.toHaveBeenCalled();
  });

  it('读盘命中 cover 原图 → 写回 master.logo.src / refW / refH 与 referenceImageUrl', () => {
    const read = vi.fn((_id: string, slot: string) =>
      slot === 'cover' ? { url: '/c.png', width: 10, height: 20 } : undefined,
    );
    svc.storage = { readReferenceOriginalImage: read } as any;
    const rva = makeRva();
    svc.backfillReferenceOriginalSources(rva, 'pid');
    expect(read).toHaveBeenCalledTimes(3);
    expect(read).toHaveBeenCalledWith('pid', 'cover');
    expect(read).toHaveBeenCalledWith('pid', 'content');
    expect(read).toHaveBeenCalledWith('pid', 'summary');
    expect((rva.byCategory as any).cover.master.logo.src).toBe('/c.png');
    expect((rva.byCategory as any).cover.master.logo.refW).toBe(10);
    expect((rva.byCategory as any).cover.master.logo.refH).toBe(20);
    expect((rva.byCategory as any).cover.referenceImageUrl).toBe('/c.png');
    // 未命中槽位不被写回
    expect((rva.byCategory as any).content.referenceImageUrl).toBeUndefined();
  });
});

describe('AiService · 参考注入（persistReferenceOriginals）', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('本轮上传的 cover 原图 → save；content/summary 未上传 → 复用磁盘 read', async () => {
    const save = vi.fn((_id: string, slot: string, _data: string) => ({
      url: `/${slot}.png`,
      width: 100,
      height: 200,
    }));
    const read = vi.fn((_id: string, slot: string) =>
      slot === 'summary' ? { url: '/summary-existing.png', width: 5, height: 6 } : undefined,
    );
    svc.storage = { saveReferenceOriginalImage: save, readReferenceOriginalImage: read } as any;
    const req: any = {
      presentationId: 'pid',
      referenceImageCoverOriginal: 'data:image/png;base64,AAA',
      referenceImageContentOriginal: undefined,
      referenceImageSummaryOriginal: undefined,
    };
    const res = await svc.persistReferenceOriginals(req);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith('pid', 'cover', 'data:image/png;base64,AAA');
    expect(read).toHaveBeenCalledWith('pid', 'content');
    expect(read).toHaveBeenCalledWith('pid', 'summary');
    expect(res.cover).toEqual({ url: '/cover.png', width: 100, height: 200 });
    expect(res.summary).toEqual({ url: '/summary-existing.png', width: 5, height: 6 });
    expect(res.content).toBeUndefined();
  });

  it('无 presentationId → 返回空对象', async () => {
    svc.storage = { saveReferenceOriginalImage: vi.fn(), readReferenceOriginalImage: vi.fn() } as any;
    const res = await svc.persistReferenceOriginals({ presentationId: undefined } as any);
    expect(res).toEqual({});
  });
});
