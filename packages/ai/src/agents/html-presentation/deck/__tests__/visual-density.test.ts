/**
 * 阶段 0 视觉密度基线固化。
 *
 * - `LEGACY_COVER_HTML` 是 2026-11-10 产物 P1（cover）的静态切片，永久固定历史事实；
 * - 「当前渲染器能力」用命名快照跟踪，阶段 2/3 改造后用 `vitest -u` 显式更新；
 * - 目标常量只校验方向（目标 > 基线），不把目标写成当前门禁。
 */

import { describe, expect, it } from 'vitest';
import type { PresentationPlan, SlidePlan } from '../../../../types';
import { buildLayoutContext, planToDeck } from '../plan-to-deck';
import { deckSlideToHtml } from '../deck-to-html';
import {
  measureVisualDensity,
  VISUAL_DENSITY_BASELINE,
  VISUAL_DENSITY_TARGET,
} from '../visual-density';

/** 历史产物 cover 页切片：白底 + 单一绿色 + 纯色几何块 + 大字标题。 */
const LEGACY_COVER_HTML = [
  '<div style="width:100%;height:100%;overflow:hidden;position:relative;box-sizing:border-box;padding:0px;background-color:#fff;display:flex;flex-direction:column;font-family:system-ui,sans-serif">',
  '<div style="position:relative;width:1280px;height:720px;background:#FFFFFF" data-canonical-root="true" data-logical-width="1280" data-logical-height="720" data-page-type="cover">',
  '<div style="position:absolute;left:840px;top:0px;width:440px;height:440px;border-radius:50%;background:rgba(39,174,96,0.19)"></div>',
  '<div style="position:absolute;left:0px;top:440px;width:480px;height:280px;background:rgba(39,174,96,0.09)"></div>',
  '<div style="position:absolute;left:80px;top:144px;width:3px;height:432px;background:#27AE60"></div>',
  '<h2><span style="color:#27AE60;font-weight:700;font-size:74px">厄尔尼诺简介：海温异常牵动全球天气</span></h2>',
  '<div style="position:absolute;left:550px;top:376px;width:180px;height:8px;border-radius:4px;background:linear-gradient(135deg,#27AE60 0%,#208F4F 100%)"></div>',
  '<span style="color:#27AE60;font-weight:700;font-size:32px">赤道中东太平洋海温异常偏暖</span>',
  '</div></div>',
].join('');

function renderCurrentCover(): string {
  const sp: SlidePlan = {
    pageType: 'cover',
    title: '确定性渲染标题',
    keyPoints: ['要点一：第一项内容', '要点二：第二项内容'],
    needsImage: false,
  };
  const plan: PresentationPlan = { title: '视觉密度基线', primaryColor: '#2563eb', slides: [sp] };
  const deck = planToDeck(plan, { imageEnabled: false, imagePreference: 'content-only' });
  return deckSlideToHtml(deck.slides[0], buildLayoutContext(plan));
}

describe('视觉密度历史基线', () => {
  it('静态切片可复现「白底 + 单色 + 纯色块」特征', () => {
    const d = measureVisualDensity(LEGACY_COVER_HTML);
    expect(d.hexColors).toEqual(['#208f4f', '#27ae60', '#ffffff']);
    expect(d.linearGradients).toBe(1);
    expect(d.radialGradients).toBe(0);
    expect(d.boxShadows).toBe(0);
    expect(d.svgElements).toBe(0);
    expect(d.tables).toBe(0);
    expect(d.cssVariableDeclarations).toBe(0);
    expect(d.fontSizes).toEqual([32, 74]);
    expect(d.chineseChars).toBeGreaterThan(0);
  });

  it('全篇实测常量与分析文档记录一致', () => {
    expect(VISUAL_DENSITY_BASELINE.hexColorCount).toBe(7);
    expect(VISUAL_DENSITY_BASELINE.radialGradients).toBe(0);
    expect(VISUAL_DENSITY_BASELINE.svgElements).toBe(0);
    expect(VISUAL_DENSITY_BASELINE.deckKinds).toEqual(['shape', 'text']);
  });

  it('目标值只作方向参照，不把目标锁成当前门禁', () => {
    expect(VISUAL_DENSITY_TARGET.hexColorCountAtLeast).toBeGreaterThan(
      VISUAL_DENSITY_BASELINE.hexColorCount,
    );
    expect(VISUAL_DENSITY_TARGET.radialGradientsAtLeast).toBeGreaterThan(
      VISUAL_DENSITY_BASELINE.radialGradients,
    );
    expect(VISUAL_DENSITY_TARGET.deckKindsAtLeast).toBeGreaterThan(
      VISUAL_DENSITY_BASELINE.deckKinds.length,
    );
  });
});

describe('当前确定性渲染器能力', () => {
  it('输出合法 canonical root 且能力快照可显式更新', () => {
    const html = renderCurrentCover();
    expect(html).toContain('data-canonical-root="true"');
    const d = measureVisualDensity(html);
    expect({
      hexColorCount: d.hexColors.length,
      linearGradients: d.linearGradients,
      radialGradients: d.radialGradients,
      boxShadows: d.boxShadows,
      svgElements: d.svgElements,
      cssVariableDeclarations: d.cssVariableDeclarations,
    }).toMatchSnapshot('deterministic-deck-current-capability');
  });
});
