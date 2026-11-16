/**
 * 出片前视觉门禁回归：结构缺陷零回流，空页必须被密度下限拦截，达标页必须放行。
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PresentationPlan, SlidePlan } from '../../../types';
import { buildLayoutContext, planToDeck } from '../../agents/html-presentation/deck/plan-to-deck';
import { deckSlideToHtml } from '../../agents/html-presentation/deck/deck-to-html';
import { attachVisualComponents } from '../../agents/html-presentation/deck/deck-component-layouts';
import { auditSlideHtml } from '../slide-visual-audit';

const PRIMARY = '#EA580C';
const PRIMARY_DARK = '#C0480A';
const PAGE_TYPES = ['cover', 'content-no-image', 'content-cards', 'content-compare', 'summary'];
/** 与 planning.prompt.ts 的新预算一致：5 条要点、每条「结论 + 证据」18-32 字。 */
const DENSE_KEY_POINTS = [
  '海表温度持续偏高0.5℃以上，判定为厄尔尼诺事件',
  '事件通常每2至7年出现一次，持续9至12个月后消退',
  '东南信风减弱使暖水东移，秘鲁沿岸海温显著上升',
  '沃克环流随之减弱，西太平洋降水减少而东岸增多',
  '全球平均气温抬升约0.2℃，极端天气风险同步上升',
];

/** 真实稀疏产物用到的高级页型，单独复验流程图 / 深度对比的铺满效果。 */
const ADVANCED_PAGE_TYPES = ['content-flowchart', 'comparison-deep-dive'];

function renderWithPageTypes(pageTypes: string[], index: number): string {
  const slides: SlidePlan[] = pageTypes.map((pageType, i) => ({
    pageType,
    title: `第 ${i + 1} 页标题`,
    keyPoints: DENSE_KEY_POINTS,
    needsImage: false,
    metricValues: [72, 45, 88],
    advantageIndices: [0, 2],
  }));
  const plan: PresentationPlan = { title: '厄尔尼诺简介', primaryColor: PRIMARY, slides };
  const deck = attachVisualComponents(
    planToDeck(plan, { imageEnabled: false, imagePreference: 'content-only' }),
  );
  return deckSlideToHtml(deck.slides[index], buildLayoutContext(plan), {
    primaryColor: PRIMARY,
    visualTheme: 'warm',
    deriveDecorFromPrimary: true,
  });
}

function renderProduction(index: number): string {
  return renderWithPageTypes(PAGE_TYPES, index);
}

describe('出片前视觉门禁', () => {
  it('结构硬指标零回流（几何 / 字号 / 编号 / 配色）', () => {
    for (let i = 0; i < PAGE_TYPES.length; i += 1) {
      const result = auditSlideHtml(renderProduction(i), {
        primary: PRIMARY,
        allowedHex: [PRIMARY_DARK],
        // 密度下限由独立用例验证：该 fixture 是极简构造内容，本用例只锁定上一轮已修好的结构缺陷。
        skipDensityChecks: true,
      });
      expect(result.issues, `slide ${i + 1}: ${JSON.stringify(result.issues)}`).toEqual([]);
      expect(result.fontSizes.length).toBeLessThanOrEqual(4);
    }
  });

  it('能拦截越界、硬编码 01、字号阶梯失控、非派生装饰色与空页', () => {
    const bad =
      '<div class="noppt-visual-backdrop">' +
      '<div style="position:absolute;left:1200px;top:700px;width:400px;height:200px;">01</div>' +
      '</div>' +
      '<div style="font-size:92px">大</div><div style="font-size:72px">标</div>' +
      '<div style="font-size:50px">题</div><div style="font-size:32px">文</div>' +
      '<div style="font-size:24px">字</div><div style="color:#3b82f6">蓝</div>';
    const result = auditSlideHtml(bad, { primary: PRIMARY });
    const codes = result.issues.map((issue) => issue.code);
    expect(codes).toContain('geometry_outside');
    expect(codes).toContain('hardcoded_badge');
    expect(codes).toContain('font_size_tiers');
    expect(codes).toContain('foreign_hex');
    expect(codes).toContain('text_below_min');
    expect(codes).toContain('content_nodes_below_min');
    expect(codes).toContain('visual_elements_below_min');
    expect(result.outsideCount).toBe(1);
  });

  it('页脚复述正文会被拦截，修复后的 5 页页脚只含页码', () => {
    const badFooter =
      '<div data-deck-node-id="s1-deco-footer" data-role="decoration" ' +
      'style="position:absolute;left:64px;top:664px;width:1152px;height:32px;">' +
      '<strong>02 / 05</strong><span>指东太平洋海表温度连续数月高于常年水平</span></div>';
    const blocked = auditSlideHtml(badFooter, { primary: PRIMARY, skipDensityChecks: true });
    expect(blocked.issues.map((issue) => issue.code)).toContain('footer_duplicates_body');
    for (let i = 0; i < PAGE_TYPES.length; i += 1) {
      const clean = auditSlideHtml(renderProduction(i), {
        primary: PRIMARY,
        allowedHex: [PRIMARY_DARK],
        skipDensityChecks: true,
      });
      expect(clean.issues.map((issue) => issue.code)).not.toContain('footer_duplicates_body');
    }
  });

  it('主色加深变体与中性灰阶不算越界配色', () => {
    const html = `<div style="color:${PRIMARY};background:${PRIMARY_DARK};border-color:#e5e7eb">正文</div>`;
    const result = auditSlideHtml(html, {
      primary: PRIMARY,
      allowedHex: [PRIMARY_DARK],
      skipDensityChecks: true,
    });
    expect(result.issues).toEqual([]);
  });

  it('字数 / 内容节点 / 视觉手段全部达标时放行', () => {
    const nodes = Array.from({ length: 8 }, (_, i) =>
      `<div data-deck-node-id="n${i}" data-role="metric" ` +
      `style="position:absolute;left:${64 + (i % 4) * 288}px;top:${120 + Math.floor(i / 4) * 240}px;` +
      `width:264px;height:200px;background:linear-gradient(135deg,#ffffff,#f9fafb);` +
      `box-shadow:0 2px 8px rgba(0,0,0,0.06);border:1px solid #e5e7eb;">` +
      `<span style="font-size:20px">海温距平达到阈值判定为事件</span></div>`,
    ).join('');
    const html = '<div class="noppt-visual-backdrop"></div>' + nodes;
    const result = auditSlideHtml(html, { primary: PRIMARY });
    expect(result.chineseChars).toBe(104);
    expect(result.contentNodes).toBe(8);
    expect(result.visualElementKinds.length).toBeGreaterThanOrEqual(2);
    expect(result.issues).toEqual([]);
  });

  it('封面 / 封底按页型分档放宽字数与节点下限', () => {
    const empty = '<div class="noppt-visual-backdrop"></div><div style="font-size:20px">短</div>';
    const strict = auditSlideHtml(empty, { primary: PRIMARY });
    const cover = auditSlideHtml(empty, { primary: PRIMARY, pageType: 'cover' });
    expect(cover.issues.filter((i) => i.code === 'text_below_min')).toHaveLength(1);
    expect(cover.issues.filter((i) => i.code === 'content_nodes_below_min')).toHaveLength(1);
    expect(strict.issues.find((i) => i.code === 'text_below_min')?.detail).toContain('< 80');
    expect(cover.issues.find((i) => i.code === 'text_below_min')?.detail).toContain('< 40');
  });

  it('按新预算生成的 5 页均通过密度下限（稀疏页零回流）', () => {
    for (let i = 0; i < PAGE_TYPES.length; i += 1) {
      const result = auditSlideHtml(renderProduction(i), {
        primary: PRIMARY,
        allowedHex: [PRIMARY_DARK],
        pageType: PAGE_TYPES[i],
      });
      expect(result.issues, `slide ${i + 1} (${PAGE_TYPES[i]}): ${JSON.stringify(result.issues)}`).toEqual([]);
      expect(result.chineseChars).toBeGreaterThanOrEqual(PAGE_TYPES[i] === 'cover' ? 40 : 60);
      expect(result.contentNodes).toBeGreaterThanOrEqual(6);
      expect(result.visualElementKinds.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('流程图 / 深度对比页按新预算铺满且通过密度下限', () => {
    ADVANCED_PAGE_TYPES.forEach((pageType, index) => {
      const result = auditSlideHtml(renderWithPageTypes(ADVANCED_PAGE_TYPES, index), {
        primary: PRIMARY,
        allowedHex: [PRIMARY_DARK],
        pageType,
      });
      expect(result.issues, `${pageType}: ${JSON.stringify(result.issues)}`).toEqual([]);
      expect(result.chineseChars).toBeGreaterThanOrEqual(80);
    });
  });

  it('按需导出充实后 5 页与高级页型 HTML 供浏览器逐页复验', () => {
    if (process.env.NOPPT_WRITE_VISUAL_FIXTURE !== '1') return;
    const outDir = path.resolve(process.cwd(), '../../scripts/output/qa-slides');
    fs.mkdirSync(outDir, { recursive: true });
    const toSlides = (pageTypes: string[], prefix: string) => pageTypes.map((pageType, index) => ({
      id: `${prefix}-${index + 1}`,
      title: pageType,
      pageType,
      html: renderWithPageTypes(pageTypes, index),
    }));
    const slides = toSlides(PAGE_TYPES, 'fixed');
    const advanced = toSlides(ADVANCED_PAGE_TYPES, 'advanced');
    fs.writeFileSync(
      path.join(outDir, 'fixed-presentation.json'),
      JSON.stringify({ slides }, null, 2),
    );
    fs.writeFileSync(
      path.join(outDir, 'advanced-presentation.json'),
      JSON.stringify({ slides: advanced }, null, 2),
    );
    expect(slides).toHaveLength(5);
    expect(advanced).toHaveLength(2);
  });
});
