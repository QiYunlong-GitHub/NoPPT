/**
 * 全篇统一表面色回归：所有页型的大面积内容容器必须使用不透明的
 * `DECK_SURFACE.card / panel`，不得再各自用半透明主色叠底。
 *
 * 守护 pres_mwhtjl0l_rfish7g 的实测缺陷：2/5 灰白卡片（#F9FAFB）、
 * 3/5 桃粉步骤卡（rgba(234,88,12,0.10)），导致同一套页脚呈现不同深浅。
 */

import { describe, expect, it } from 'vitest';
import type { PresentationPlan, SlidePlan } from '../../../../types';
import { DECK_SURFACE, cardSurface, panelSurface } from '../layout-primitives';
import { buildLayoutContext, planToDeck } from '../plan-to-deck';
import { attachVisualComponents } from '../deck-component-layouts';
import { deckSlideToHtml } from '../deck-to-html';

const PAGE_TYPES = [
  'cover', 'content-no-image', 'content-cards', 'content-compare', 'summary',
  'content-flowchart', 'comparison-deep-dive',
];
const KEY_POINTS = [
  '海表温度持续偏高0.5℃以上，判定为厄尔尼诺事件',
  '事件通常每2至7年出现一次，持续9至12个月后消退',
  '东南信风减弱使暖水东移，秘鲁沿岸海温显著上升',
  '沃克环流随之减弱，西太平洋降水减少而东岸增多',
  '全球平均气温抬升约0.2℃，极端天气风险同步上升',
];

describe('统一不透明表面色 token', () => {
  it('card / panel 都是不透明纯色且来自同一常量', () => {
    expect(cardSurface()).toEqual({ type: 'solid', color: DECK_SURFACE.card });
    expect(panelSurface()).toEqual({ type: 'solid', color: DECK_SURFACE.panel });
    expect(cardSurface().transparency).toBeUndefined();
    expect(panelSurface().transparency).toBeUndefined();
  });

  it('7 种页型的大面积内容容器只使用统一表面色', () => {
    const slides: SlidePlan[] = PAGE_TYPES.map((pageType, i) => ({
      pageType,
      title: `第 ${i + 1} 页标题`,
      keyPoints: KEY_POINTS,
      needsImage: false,
    }));
    const plan: PresentationPlan = { title: '表面色一致性', primaryColor: '#EA580C', slides };
    const deck = planToDeck(plan, { imageEnabled: false, imagePreference: 'content-only' });
    const allowed = new Set([DECK_SURFACE.card, DECK_SURFACE.panel]);
    const surfaceColors: string[] = [];
    for (const slide of deck.slides) {
      for (const node of slide.nodes) {
        if (node.kind !== 'shape' || node.rect.w < 200 || node.rect.h < 40) continue;
        const fill = node.fill;
        if (!fill || fill.type !== 'solid' || fill.transparency !== undefined) continue;
        surfaceColors.push(String(fill.color).toUpperCase());
      }
    }
    expect(surfaceColors.length).toBeGreaterThan(0);
    expect([...new Set(surfaceColors)].every((color) => allowed.has(color))).toBe(true);
  });

  it('各内容页页脚渲染为同一种不透明表面色且不含正文', () => {
    const slides: SlidePlan[] = PAGE_TYPES.slice(0, 5).map((pageType, i) => ({
      pageType,
      title: `第 ${i + 1} 页标题`,
      keyPoints: KEY_POINTS,
      needsImage: false,
    }));
    const plan: PresentationPlan = { title: '页脚一致性', primaryColor: '#EA580C', slides };
    const deck = attachVisualComponents(
      planToDeck(plan, { imageEnabled: false, imagePreference: 'content-only' }),
    );
    const footerStyles = deck.slides.slice(1, 4).map((slide) => {
      const html = deckSlideToHtml(slide, buildLayoutContext(plan), {
        primaryColor: '#EA580C', visualTheme: 'warm', deriveDecorFromPrimary: true,
      });
      return html.match(/data-deck-node-id="[^"]*deco-footer"[^>]*style="([^"]*)"/)?.[1] ?? '';
    });
    expect(footerStyles).toHaveLength(3);
    expect(footerStyles.every((style) => style.includes('background:#f9fafb'))).toBe(true);
    expect(footerStyles.every((style) => !style.includes('rgba('))).toBe(true);
    const backgrounds = footerStyles.map(
      (style) => style.match(/background:([^;]+);/)?.[1] ?? '',
    );
    expect(new Set(backgrounds).size).toBe(1);
  });
});
