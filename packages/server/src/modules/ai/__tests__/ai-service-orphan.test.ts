// ================================================================
// AiService · 孤儿配图救援（rescueOrphanImages）—— 行为锁定测试（characterization）
//
// 目的：在 Phase 5 把孤儿配图编排切块外置之前，锁定「按 imagePreference 选择注入目标 /
// 结构页(封面/目录/总结)恒不配图 / 已含图页跳过 / 无正文页跳过 / minimal 限量」等现状行为。
//
// storage / inject* 用 vi.fn 打桩（inject 成功即返回 html+marker）；inferImagePreferenceFromPresentation
// 与 slideHasMeaningfulBody 用真实实现（纯逻辑，经原型可调用），仅在个别用例覆写以验证跳过分支。
// ================================================================
import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AiService } from '../ai.service';

const svc = Object.create(AiService.prototype) as any;

const CONTENT = (extra = '') =>
  `<div><h2>标题</h2><p>这是一段足够长的正文内容用于测试孤儿配图救援逻辑${extra}</p></div>`;

function makeResult(opts: {
  slides: Array<{ html: string; title?: string }>;
  imagePreference?: string;
}) {
  return {
    id: 'P1',
    imagePreference: opts.imagePreference,
    slides: opts.slides.map((s, i) => ({ id: `s${i}`, title: s.title ?? `slide${i}`, html: s.html })),
  } as any;
}

function installStubs(orphanFiles: string[]) {
  svc.storage = {
    getImagesDir: vi.fn(() => '/img'),
    listDir: vi.fn(() => orphanFiles),
  } as any;
  // inject 成功：返回原 html + marker（rebuilt !== html → 视为注入成功并推进 orphanIdx）
  svc.injectOrphanImageIntoBackground = vi.fn(
    (html: string, _url: string, kind: string) => `${html}<!--BG:${kind}-->`,
  );
  svc.injectOrphanImageIntoSlide = vi.fn((html: string) => `${html}<!--SLIDE-->`);
  svc.slideHasMeaningfulBody = vi.fn(() => true);
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('AiService · 孤儿配图救援（rescueOrphanImages）', () => {
  it('pref=all：封面/总结走背景大图注入，内容页走左图右文注入', () => {
    installStubs(['a.png', 'b.png']);
    const result = makeResult({
      imagePreference: 'all',
      slides: [
        { html: CONTENT(), title: '封面' },
        { html: CONTENT(), title: '内容' },
        { html: CONTENT(), title: '总结' },
      ],
    });
    const rescued = svc.rescueOrphanImages(result, false);
    // step2 先把 2 张孤儿图注入封面/总结（BG），内容循环因 orphanIdx 已耗尽不再注入
    expect(rescued).toBe(2);
    expect(svc.injectOrphanImageIntoBackground).toHaveBeenCalledTimes(2);
    expect(svc.injectOrphanImageIntoSlide).not.toHaveBeenCalled();
    expect(result.slides[0].html).toContain('BG:cover');
    expect(result.slides[2].html).toContain('BG:summary');
  });

  it('pref=content-only：封面/总结不注入，仅内容页左图右文（结构页跳过）', () => {
    installStubs(['a.png', 'b.png']);
    const result = makeResult({
      imagePreference: 'content-only',
      slides: [
        { html: CONTENT(), title: '封面' },
        { html: CONTENT(), title: '内容' },
        { html: CONTENT(), title: '总结' },
      ],
    });
    const rescued = svc.rescueOrphanImages(result, false);
    // 封面/总结为结构页（isStructurePage）→ 跳过；仅内容页(s=1)注入 1 张
    expect(rescued).toBe(1);
    expect(svc.injectOrphanImageIntoSlide).toHaveBeenCalledTimes(1);
    expect(svc.injectOrphanImageIntoBackground).not.toHaveBeenCalled();
    expect(result.slides[1].html).toContain('SLIDE');
  });

  it('pref=minimal：限量最多注入 2 张（即便有更多内容页）', () => {
    installStubs(['a.png', 'b.png', 'c.png', 'd.png']);
    const result = makeResult({
      imagePreference: 'minimal',
      slides: [
        { html: CONTENT(), title: '封面' },
        { html: CONTENT(), title: '内容1' },
        { html: CONTENT(), title: '内容2' },
        { html: CONTENT(), title: '内容3' },
        { html: CONTENT(), title: '总结' },
      ],
    });
    const rescued = svc.rescueOrphanImages(result, false);
    // 结构页(0,4)跳过；内容页 1,2,3 中因 maxFill=2 只注入前 2 张
    expect(rescued).toBe(2);
    expect(svc.injectOrphanImageIntoSlide).toHaveBeenCalledTimes(2);
  });

  it('磁盘无孤儿图 → 返回 0，不调用任何 inject', () => {
    installStubs([]);
    const result = makeResult({
      imagePreference: 'all',
      slides: [{ html: CONTENT(), title: '封面' }],
    });
    const rescued = svc.rescueOrphanImages(result, false);
    expect(rescued).toBe(0);
    expect(svc.injectOrphanImageIntoBackground).not.toHaveBeenCalled();
    expect(svc.injectOrphanImageIntoSlide).not.toHaveBeenCalled();
  });

  it('已含 <img> 的内容页跳过（不重复配图）', () => {
    installStubs(['a.png', 'b.png']);
    const result = makeResult({
      imagePreference: 'all',
      slides: [
        { html: CONTENT(), title: '封面' },
        { html: `<div><img src="x.png"><h2>已配图</h2><p>正文足够长用于测试孤儿救援跳过已含图页面逻辑</p></div>`, title: '已含图' },
        { html: CONTENT(), title: '总结' },
      ],
    });
    const rescued = svc.rescueOrphanImages(result, false);
    // 内容页 s=1 含 <img> 跳过；封面/总结各注入 1 张 BG → 共 2
    expect(rescued).toBe(2);
    expect(result.slides[1].html).not.toContain('SLIDE');
  });

  it('目录页（data-layout=toc）恒不配图', () => {
    installStubs(['a.png', 'b.png']);
    const result = makeResult({
      imagePreference: 'all',
      slides: [
        { html: CONTENT(), title: '封面' },
        { html: `<div data-layout="toc"><h2>目录</h2><p>目录页正文足够长用于测试孤儿救援对目录页的跳过行为</p></div>`, title: '目录' },
        { html: CONTENT(), title: '总结' },
      ],
    });
    const rescued = svc.rescueOrphanImages(result, false);
    // 目录页(toc)跳过；封面/总结 BG 各 1 → 2
    expect(rescued).toBe(2);
    expect(result.slides[1].html).not.toContain('SLIDE');
  });

  it('无正文页（slideHasMeaningfulBody=false）跳过', () => {
    installStubs(['a.png', 'b.png']);
    svc.slideHasMeaningfulBody = vi.fn(() => false);
    const result = makeResult({
      imagePreference: 'all',
      slides: [
        { html: CONTENT(), title: '封面' },
        { html: CONTENT(), title: '内容' },
        { html: CONTENT(), title: '总结' },
      ],
    });
    const rescued = svc.rescueOrphanImages(result, false);
    // 内容页因无正文被跳过；封面/总结 BG 各 1 → 2
    expect(rescued).toBe(2);
    expect(svc.injectOrphanImageIntoSlide).not.toHaveBeenCalled();
  });

  it('注入失败（rebuilt===html）不推进 orphanIdx，不重复消耗孤儿图', () => {
    installStubs(['a.png', 'b.png']);
    // 模拟所有注入都失败（返回原 html）
    svc.injectOrphanImageIntoBackground = vi.fn((html: string) => html);
    svc.injectOrphanImageIntoSlide = vi.fn((html: string) => html);
    const result = makeResult({
      imagePreference: 'all',
      slides: [
        { html: CONTENT(), title: '封面' },
        { html: CONTENT(), title: '内容' },
        { html: CONTENT(), title: '总结' },
      ],
    });
    const rescued = svc.rescueOrphanImages(result, false);
    expect(rescued).toBe(0);
  });
});
