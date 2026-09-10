// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { applyMasterToSlideHtml } from './apply-master-to-slide-html';
import type { ReferenceMaster } from '../types';

const BASE = `<div style="width:1280px;height:720px;background:#fff;"><h1>标题</h1><p>正文</p></div>`;

const master: ReferenceMaster = {
  logo: { src: 'data:image/png;base64,AAAA', position: 'top-left', colorHex: '#111111' },
  footer: { textContent: '机密 · 内部', hasPageNumber: false },
  watermark: { text: 'CONFIDENTIAL' },
  header: { elements: [{ colorHex: '#333333' }] },
  sideDecorations: [{ side: 'left', colorHex: '#444444' }],
};

describe('applyMasterToSlideHtml (FR-3 母版注入 · Task5)', () => {
  it('注入 data-master 标记与 logo/页脚/水印/页眉/侧边装饰节点', () => {
    const out = applyMasterToSlideHtml(BASE, master);
    expect(out).toContain('data-master=');
    expect(out).toContain('data-master-logo');
    expect(out).toContain('data-master-footer');
    expect(out).toContain('data-master-watermark');
    expect(out).toContain('data-master-header');
    expect(out).toContain('data-master-side="left"');
  });

  it('确保根节点为定位上下文（position:relative）', () => {
    const out = applyMasterToSlideHtml(BASE, master);
    expect(out).toMatch(/<div[^>]*position:relative/);
  });

  it('无 master 时原样返回', () => {
    const out = applyMasterToSlideHtml(BASE, undefined);
    expect(out).toBe(BASE);
  });

  it('幂等：重复注入不产生多重 data-master / 多重 hero 注释', () => {
    const once = applyMasterToSlideHtml(BASE, master);
    const twice = applyMasterToSlideHtml(once, master);
    expect((twice.match(/data-master=/g) || []).length).toBe(1);
    // 该 master 无 heroImage → 不应出现 hero 注释
    expect((twice.match(/noppt-hero/g) || []).length).toBe(0);
  });

  it('纯 logo（无 src/htmlSnippet）→ 不渲染占位，避免 logo(#hex) 字面文本', () => {
    const logoOnly: ReferenceMaster = { logo: { colorHex: '#abcdef' } };
    const out = applyMasterToSlideHtml(BASE, logoOnly);
    expect(out).not.toContain('data-master-logo');
    // 仅 logo 占位（无原图可开窗 / 无 htmlSnippet）时不应产生任何母版层
    expect(out).toBe(BASE);
  });

  it('母版层不拦截内容交互（pointer-events:none）', () => {
    const out = applyMasterToSlideHtml(BASE, master);
    expect(out).toContain('pointer-events:none');
    expect(out).toContain('noppt-master-layer');
  });

  it('母版层用四边定位（top/left/right/bottom）而非 inset，避免旧白名单剥离成 0 尺寸', () => {
    const out = applyMasterToSlideHtml(BASE, master);
    const layer = out.slice(out.indexOf('noppt-master-layer'));
    expect(layer).toContain('top:0');
    expect(layer).toContain('left:0');
    expect(layer).toContain('right:0');
    expect(layer).toContain('bottom:0');
    expect(layer).not.toContain('inset:0');
  });

  it('P1 CSS 开窗（不变形）：logo.src + 归一化 bbox + refW/refH → 百分比精灵图 + 按宽高比定盒', () => {
    const m: ReferenceMaster = {
      logo: {
        src: '/data/reference-originals/cover-x.png',
        x: 0.6, y: 0.1, w: 0.2, h: 0.15, position: 'top-right',
        refW: 2560, refH: 1440,
      },
    };
    const out = applyMasterToSlideHtml(BASE, m);
    expect(out).toContain('data-master-logo');
    expect(out).toContain("background-image:url('/data/reference-originals/cover-x.png')");
    expect(out).toContain('background-size:');
    expect(out).toContain('background-position:');
    // 开窗分支不应再回退到 <img> 占位
    expect(out).not.toContain('<img');
    // 区域宽高比 = (0.2*2560)/(0.15*1440) = 2.37 > 1.5 → 以宽 180 约束，高 = 180/2.37 ≈ 75.9
    expect(out).toContain('width:180.0px');
    expect(out).toContain('height:75.9px');
    // 百分比精灵图：size=(100/0.2)% (100/0.15)%，pos=(0.6/0.8)*100% (0.1/0.85)*100%
    expect(out).toContain('background-size:500.00% 666.67%');
    expect(out).toContain('background-position:75.00% 11.76%');
  });

  it('P1 无 refW/refH 时按 16:9 退化定盒，不产生 px 方形拉伸', () => {
    const m: ReferenceMaster = {
      logo: { src: '/assets/logo.png', x: 0.6, y: 0.1, w: 0.2, h: 0.15, position: 'top-right' },
    };
    const out = applyMasterToSlideHtml(BASE, m);
    // 退化区域宽高比 16/9≈1.78>1.5 → 宽 180, 高≈101.25；绝不应出现 473.7px 方形
    expect(out).toContain('width:180.0px');
    expect(out).not.toContain('473.7');
    expect(out).not.toContain('background-size:800.0px');
  });

  it('logo.src 但无 bbox → 回退普通 <img> 渲染（不误用开窗）', () => {
    const m: ReferenceMaster = { logo: { src: '/assets/logo.png', colorHex: '#123456' } };
    const out = applyMasterToSlideHtml(BASE, m);
    expect(out).toContain('data-master-logo');
    expect(out).toContain('<img');
    expect(out).toContain('object-fit:contain');
    expect(out).not.toContain('background-image');
  });
});

describe('applyMasterToSlideHtml · hero 整页背景三级条件注入 (FR-0)', () => {
  const heroMaster: ReferenceMaster = {
    logo: {
      src: '/data/reference-originals/cover.png', position: 'top-left', colorHex: '#111111',
      x: 0.03, y: 0.04, w: 0.38, h: 0.12, refW: 2560, refH: 1440,
    },
    heroImage: { src: 'data:image/png;base64,AAAA', x: 0, y: 0.32, w: 1, h: 0.37 },
  };

  it('浅底/无背景 → 把背景写进根容器自身 style（非 z-index:-1 子层），并打 noppt-hero 注释', () => {
    const out = applyMasterToSlideHtml(BASE, heroMaster);
    expect(out).toContain('<!--noppt-hero-->');
    expect(out).toContain('background-image:linear-gradient');
    // 关键修复：不再是会被根容器白底遮住的负 z-index 子层
    expect(out).not.toContain('z-index:-1');
    expect(out).toContain('data-master-logo');
  });

  it('幂等：根容器已带 hero 背景 → 不重复注入', () => {
    const once = applyMasterToSlideHtml(BASE, heroMaster);
    const twice = applyMasterToSlideHtml(once, heroMaster);
    expect((twice.match(/noppt-hero/g) || []).length).toBe(1);
  });

  it('无参考 heroImage → 不注入 hero 背景', () => {
    const noHero: ReferenceMaster = { logo: { src: '/data/reference-originals/cover.png', position: 'top-left', colorHex: '#111111' } };
    const out = applyMasterToSlideHtml(BASE, noHero);
    expect(out).not.toContain('noppt-hero');
    expect(out).toContain('data-master-logo');
  });

  it('P2 页面已有深色/渐变背景 → 不注入 hero 背景，母版层仍注入', () => {
    const dark = `<div style="background-image:linear-gradient(135deg,#e60012,#b8000e);"><h1>标题</h1></div>`;
    const out = applyMasterToSlideHtml(dark, heroMaster);
    expect(out).not.toContain('noppt-hero');
    expect(out).toContain('data-master-logo');
  });

  it('bbox 开窗公式修正：{x:0,y:0.32,w:1,h:0.37} → size≈100% 270.27%、pos≈0% 50.79%', () => {
    const out = applyMasterToSlideHtml(BASE, heroMaster);
    expect(out).toContain('background-size:100.00% 270.27%');
    expect(out).toContain('background-position:0.00% 50.79%');
  });

  it('无 bbox 的 hero → cover 整图铺满', () => {
    const m: ReferenceMaster = { heroImage: { src: '/data/reference-originals/cover.png' } };
    const out = applyMasterToSlideHtml(BASE, m);
    expect(out).toContain('background-size:cover');
    expect(out).toContain('background-position:center');
  });
});
