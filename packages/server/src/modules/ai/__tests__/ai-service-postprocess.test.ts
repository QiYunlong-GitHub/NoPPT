// ================================================================
// AiService 后处理 / 孤儿配图 / 参考属性哈希 —— 行为锁定测试（characterization）
//
// 目的：ai.service.ts 的 postProcessPresentation(2341+) 与孤儿配图救援、
// 参考属性哈希等逻辑在外置（Phase 5）之前先锁定「现状行为」，保证后续纯搬移
// 不改变输出。
//
// 调用方式：const svc = Object.create(AiService.prototype) as any;
// 这些 private 方法编译后是普通原型方法，可通过原型直接调用（与已通过的
// ai-service-html-utils.test.ts / postprocess-pipeline.test.ts 先例一致）。
// 被锁定方法均为纯函数 / 只依赖原型方法（_visibleTextLength），无需构造 Nest 容器。
// ================================================================
import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { AiService } from '../ai.service';

const svc = Object.create(AiService.prototype) as any;

describe('AiService · 参考属性哈希（computeRefAttrsHash）', () => {
  const baseReq = {
    referenceHtml: '<p>ref</p>',
    referenceImage: '/data/ref.png',
  } as any;

  it('相同输入 → 相同哈希（确定性）', () => {
    const a = svc.computeRefAttrsHash({ ...baseReq });
    const b = svc.computeRefAttrsHash({ ...baseReq });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{40}$/); // sha1 hex
  });

  it('referenceImage 变化 → 哈希变化', () => {
    const a = svc.computeRefAttrsHash({ ...baseReq });
    const b = svc.computeRefAttrsHash({ ...baseReq, referenceImage: '/data/other.png' });
    expect(a).not.toBe(b);
  });

  it('referenceHtml 变化 → 哈希变化', () => {
    const a = svc.computeRefAttrsHash({ ...baseReq });
    const b = svc.computeRefAttrsHash({ ...baseReq, referenceHtml: '<p>different</p>' });
    expect(a).not.toBe(b);
  });

  it('分类参考字段独立参与哈希（cover/image 不影响彼此）', () => {
    const a = svc.computeRefAttrsHash({ ...baseReq, referenceHtmlCover: '<p>c</p>' });
    const b = svc.computeRefAttrsHash({ ...baseReq, referenceImageCover: '/data/c.png' });
    expect(a).not.toBe(b);
  });

  it('空输入 → 稳定哈希（仅含版本号）', () => {
    const a = svc.computeRefAttrsHash({} as any);
    const b = svc.computeRefAttrsHash({} as any);
    expect(a).toBe(b);
  });
});

describe('AiService · 可见文本长度（_visibleTextLength）', () => {
  it('空串 → 0', () => {
    expect(svc._visibleTextLength('')).toBe(0);
  });
  it('纯文本计入长度（空白被归一剥离）', () => {
    // "Hello World" 经 \s+ 剥离 → "HelloWorld" = 10
    expect(svc._visibleTextLength('<div>Hello World</div>')).toBe(10);
  });
  it('标签 / 注释 / &nbsp; 不计入（&nbsp; 先归一为空格再被 \s+ 剥离）', () => {
    const html = '<div><!-- 注释 --><p>AB</p><style>x{y:z}</style>&nbsp;C</div>';
    // AB(2) + &nbsp;→空格→被 \s+ 剥离 + C(1) = "ABC" = 3
    expect(svc._visibleTextLength(html)).toBe(3);
  });
});

describe('AiService · 启发式 imagePreference 推断（inferImagePreferenceFromPresentation）', () => {
  const slide = (html: string, pageType?: string, title?: string) => ({ html, pageType, title });

  it('全部无图 → none', () => {
    const r = { slides: [slide('<div><h2>x</h2><p>正文</p></div>')] };
    expect(svc.inferImagePreferenceFromPresentation(r)).toBe('none');
  });

  it('极少图（<15%）→ minimal', () => {
    const slides = [
      slide('<div><h1>cover</h1></div>', 'cover'),
      slide('<div><h2>x</h2><p>无图正文</p></div>'),
      slide('<div><h2>y</h2><p>无图正文</p></div>'),
      slide('<div><h2>z</h2><p>无图正文</p></div>'),
      slide('<div><h2>w</h2><p>无图正文</p></div>'),
      slide('<div><h2>end</h2><p>结尾无图</p></div>', 'summary'),
    ];
    // 0 张图 → totalRatio 0 → none（仅 1 张图才是 minimal，这里造 0 图确认 none 优先）
    expect(svc.inferImagePreferenceFromPresentation({ slides })).toBe('none');
  });

  it('仅 1/7 有图（<15%）→ minimal', () => {
    const slides = [
      slide('<div><img src="a.png"><h1>cover</h1></div>', 'cover'),
      slide('<div><h2>x</h2><p>无图</p></div>'),
      slide('<div><h2>y</h2><p>无图</p></div>'),
      slide('<div><h2>z</h2><p>无图</p></div>'),
      slide('<div><h2>w</h2><p>无图</p></div>'),
      slide('<div><h2>v</h2><p>无图</p></div>'),
      slide('<div><h2>end</h2><p>无图</p></div>', 'summary'),
    ];
    expect(svc.inferImagePreferenceFromPresentation({ slides })).toBe('minimal');
  });

  it('cover+summary+内容均大量有图（>=70%）→ all', () => {
    const imgSlide = (pt?: string) => slide(`<div><img src="a.png"><h2>${pt ?? 'c'}</h2><p>有图</p></div>`, pt);
    const slides = [
      imgSlide('cover'),
      imgSlide(),
      imgSlide(),
      imgSlide(),
      imgSlide(),
      imgSlide(),
      imgSlide(),
      imgSlide('summary'),
    ];
    expect(svc.inferImagePreferenceFromPresentation({ slides })).toBe('all');
  });

  it('部分内容有图（15%~70%）→ content-only', () => {
    const withImg = slide('<div><img src="a.png"><h2>c</h2><p>有图</p></div>');
    const noImg = slide('<div><h2>c</h2><p>无图</p></div>');
    const slides = [
      slide('<div><h1>cover</h1></div>', 'cover'),
      withImg,
      withImg,
      noImg,
      noImg,
      noImg,
      noImg,
      slide('<div><h2>end</h2><p>无图</p></div>', 'summary'),
    ];
    // 2/6 内容页有图；cover/summary 无图 → 不满足 all，ratio≈0.285 → content-only
    expect(svc.inferImagePreferenceFromPresentation({ slides })).toBe('content-only');
  });

  it('空 slides → content-only（默认最常见）', () => {
    expect(svc.inferImagePreferenceFromPresentation({ slides: [] })).toBe('content-only');
  });
});

describe('AiService · 孤儿配图注入（injectOrphanImageIntoSlide）', () => {
  const contentHtml =
    '<div style="display:flex;flex-direction:column;width:100%;height:100%;">' +
    '<h2>测试标题</h2>' +
    '<p>这是一段用于验证孤儿配图注入后文本不被吞掉的正文内容。</p>' +
    '</div>';

  it('入参缺失（空 html / 空 url）原样返回', () => {
    expect(svc.injectOrphanImageIntoSlide('', '/data/x.png')).toBe('');
    expect(svc.injectOrphanImageIntoSlide(contentHtml, '')).toBe(contentHtml);
  });

  it('已含 <img> 的 slide 不重复注入', () => {
    const html = '<div><img src="/data/exist.png"><h2>已配图</h2></div>';
    expect(svc.injectOrphanImageIntoSlide(html, '/data/x.png')).toBe(html);
  });

  it('结构页（explicit pageType=cover）不注入', () => {
    expect(svc.injectOrphanImageIntoSlide(contentHtml, '/data/x.png', { pageType: 'cover' })).toBe(
      contentHtml,
    );
  });

  it('受保护 layout（data-layout=content-cards）不注入', () => {
    const html =
      '<div data-layout="content-cards" style="display:flex;flex-direction:column;">' +
      '<h2>卡片</h2><p>正文</p></div>';
    expect(svc.injectOrphanImageIntoSlide(html, '/data/x.png')).toBe(html);
  });

  it('合法内容页 → 注入 45% 图列 + 保留可见文本', () => {
    const out = svc.injectOrphanImageIntoSlide(contentHtml, '/data/orphan.png');
    expect(out).toContain('/data/orphan.png');
    expect(out).toContain('data-image-ratio="4:3"');
    expect(out).toContain('flex:0 0 45%');
    // 不变量：可见文本长度不减少（文本未被吞）
    expect(svc._visibleTextLength(out)).toBeGreaterThanOrEqual(svc._visibleTextLength(contentHtml));
    expect(out).toContain('测试标题');
  });
});

describe('AiService · HTML 占位审核回调（buildHtmlAuditHook）', () => {
  const makeHook = (options: any) =>
    svc.buildHtmlAuditHook({
      agent: {} as any,
      topic: '测试主题',
      options,
      maxRetries: 3,
      slideWidth: 1280,
      slideHeight: 720,
    });

  it('critique.enabled=false → 短路返回原 slides，不触发 VLM', async () => {
    const hook = makeHook({ critique: { enabled: false } });
    const slides = [{ html: '<div>原始</div>' }] as any;
    const out = await hook(slides, { plan: {} as any, design: {} as any });
    expect(out).toBe(slides); // 同一引用，未做任何修改
  });

  it('critique 缺失（undefined）→ 短路返回原 slides', async () => {
    const hook = makeHook({});
    const slides = [{ html: '<div>原始2</div>' }] as any;
    const out = await hook(slides, { plan: {} as any, design: {} as any });
    expect(out).toBe(slides);
  });
});
