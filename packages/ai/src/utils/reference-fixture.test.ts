// Task7 · fixture 驱动验证：用 tests/fixtures/reference 下的 Sample A~H 验证
// extractReferenceHtmlAttributes 能正确解析「9 风格 + 母版 + 布局 + 分类隔离」。
// 同时保证这些 fixture 文件本身结构是合法、可被解析的（E2E 前置条件）。
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, it, expect } from 'vitest';
import { extractReferenceHtmlAttributes } from './reference-html-extractor';

const FIX = resolve(__dirname, '../../../../tests/fixtures/reference');
function load(name: string): string {
  return readFileSync(resolve(FIX, name), 'utf8');
}

describe('Task7 · fixture 解析验证 (TR-7.1/7.2/7.5 前置)', () => {
  it('Sample A（橙创意 5 页，跨页母版）', () => {
    const r = extractReferenceHtmlAttributes(load('sample-a.html'));
    expect(r.uploaded).toBe(true);
    expect(r.style.primaryColor).toBe('#ea580c');
    expect(r.style.fontFamily).toBe('serif');
    expect(r.style.iconStyle).toBe('numbered');
    expect(r.style.contentDensity).toBe('compact');
    expect(r.style.imagePreference).toBe('all');
    expect(r.master!.logo!.position).toBe('top-left');
    expect(r.master!.header!.elements![0].colorHex).toBe('#2563eb');
    expect(r.master!.footer!.hasPageNumber).toBe(true);
  });

  it('Sample B（蓝商务 8 页，右上 LOGO + 左侧竖条，spacious）', () => {
    const r = extractReferenceHtmlAttributes(load('sample-b.html'));
    expect(r.uploaded).toBe(true);
    expect(r.style.primaryColor).toBe('#2563eb');
    expect(r.style.fontFamily).toBe('sans');
    expect(r.style.contentDensity).toBe('spacious');
    expect(r.style.imagePreference).toBe('content-only');
    expect(r.master!.logo!.position).toBe('top-right');
  });

  it('Fixture E（封面单页，绿 serif 居中 LOGO three-section）', () => {
    const r = extractReferenceHtmlAttributes(load('fixture-e-cover.html'));
    expect(r.uploaded).toBe(true);
    expect(r.style.primaryColor).toBe('#16a34a');
    expect(r.style.fontFamily).toBe('serif');
    expect(r.layout!.type).toBe('single');
    expect(r.layout!.single).toBe('three-section');
  });

  it('Fixture F（内容 5 页，橙 sans 左上 LOGO 页码 comparison 主导）', () => {
    const r = extractReferenceHtmlAttributes(load('fixture-f-content.html'));
    expect(r.uploaded).toBe(true);
    expect(r.style.primaryColor).toBe('#ea580c');
    expect(r.style.fontFamily).toBe('sans');
    expect(r.master!.footer!.hasPageNumber).toBe(true);
    expect(r.layout!.type).toBe('page-type-map');
    expect(r.layout!.pageTypeMap!['content-cards']).toBe('comparison');
  });

  it('Fixture H（旧全局参考 8 页，橙）— AC-29 向后兼容前置', () => {
    const r = extractReferenceHtmlAttributes(load('fixture-h-global.html'));
    expect(r.uploaded).toBe(true);
    expect(r.style.primaryColor).toBe('#ea580c');
  });
});

// ============ FR-参考克隆 · 三份真实模板的结构级提取回归 ============
// 验证「属性抽取」改造后，抽取结果与参考真实结构一致（不再错判 flowchart/dark/none/镜像）。
const TPL = resolve(__dirname, '../../../../Slides_Templates/HTML');
function loadTpl(name: string): string {
  return readFileSync(resolve(TPL, name), 'utf8');
}

describe('FR-参考克隆 · 孟菲斯封面 / 左文右图内容 / 孟菲斯总结 提取回归', () => {
  it('封面（孟菲斯彩）: light 底 + 几何装饰 + 撞色 palette + 骨架含装饰节点', () => {
    const r = extractReferenceHtmlAttributes(loadTpl('cover/slide-cover-07-memphis-color.html'));
    expect(r.uploaded).toBe(true);
    expect(r.visual!.backgroundTone).toBe('light'); // 旧 bug: 误判 dark
    expect(r.visual!.decoration).toBe('geometric-shapes'); // 旧 bug: 误判 gradient-glow
    expect(r.layout!.single).not.toBe('flowchart'); // 旧 bug: SVG 波浪线误判 flowchart
    expect(r.palette!.primary.toLowerCase()).toBe('#ff4d6d');
    expect(r.palette!.isMultiColor).toBe(true); // 撞色信号 → 红线豁免
    expect(r.palette!.accents.map((c) => c.toLowerCase())).toEqual(
      expect.arrayContaining(['#ffc93c', '#06d6a0', '#118ab2', '#073b4c']),
    );
    expect(r.structure!.hasImageSlot).toBe(false);
    expect(r.referenceHtml).toBeTruthy();
    expect(r.referenceHtml!.toLowerCase()).toContain('squiggle'); // 骨架含波浪线装饰
  });

  it('内容（左文右图）: 分栏构图 + imageSide=right（不镜像）+ 有图槽', () => {
    const r = extractReferenceHtmlAttributes(
      loadTpl('content/slide-content-04-text-left-image-right.html'),
    );
    expect(r.uploaded).toBe(true);
    expect(r.layout!.single).toBe('text-left-image-right'); // 旧 bug: 误判 flowchart
    expect(r.visual!.composition).toBe('split');
    expect(r.structure!.hasImageSlot).toBe(true);
    expect(r.structure!.imageSide).toBe('right'); // 旧 bug: 生成成 image-left（镜像）
    expect(r.style.imagePreference).not.toBe('none'); // 旧 bug: SVG 占位误判 none
  });

  it('总结（孟菲斯致谢）: 与封面同款撞色 palette + 几何装饰', () => {
    const r = extractReferenceHtmlAttributes(loadTpl('back/slide-end-05-memphis-thanks.html'));
    expect(r.uploaded).toBe(true);
    expect(r.visual!.backgroundTone).toBe('light');
    expect(r.visual!.decoration).toBe('geometric-shapes');
    expect(r.palette!.isMultiColor).toBe(true);
    expect(r.palette!.accents.map((c) => c.toLowerCase())).toEqual(
      expect.arrayContaining(['#ffc93c', '#06d6a0', '#118ab2', '#073b4c']),
    );
  });
});
