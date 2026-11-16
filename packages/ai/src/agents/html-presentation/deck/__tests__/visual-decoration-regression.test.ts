/**
 * 出片前视觉回归（确定性 Deck 路径）。
 *
 * 守护 WorkBuddy 对 pres_mwg4qdcr_7mjjirl 的实测缺陷：
 * 双重硬编码「01」、装饰色与橙色主色冲突、无语义伪图表、装饰越出画布。
 */

import { describe, expect, it } from 'vitest';
import type { PresentationPlan, SlidePlan } from '../../../../types';
import { buildLayoutContext, planToDeck } from '../plan-to-deck';
import { deckSlideToHtml } from '../deck-to-html';
import { attachVisualComponents } from '../deck-component-layouts';
import { deriveDecorColors } from '../deck-primary-visual';
import { VISUAL_THEMES } from '../visual-tokens';
import { auditSlideHtml } from '../../../../utils/slide-visual-audit';

const PRIMARY = '#EA580C';
const PAGE_TYPES = ['cover', 'content-no-image', 'content-cards', 'content-compare', 'summary'];

function fivePageDeck() {
  const slides: SlidePlan[] = PAGE_TYPES.map((pageType, i) => ({
    pageType,
    title: `第 ${i + 1} 页标题`,
    keyPoints: [
      '判定阈值约0.5℃',
      '通常每2至7年出现一次',
      '东南信风强度变化',
      '南美沿海降水偏多',
    ],
    needsImage: false,
  }));
  const plan: PresentationPlan = { title: '厄尔尼诺简介', primaryColor: PRIMARY, slides };
  const deck = planToDeck(plan, { imageEnabled: false, imagePreference: 'content-only' });
  return { plan, deck: attachVisualComponents(deck) };
}

function renderProduction(index: number): string {
  const { plan, deck } = fivePageDeck();
  return deckSlideToHtml(deck.slides[index], buildLayoutContext(plan), {
    primaryColor: PRIMARY,
    visualTheme: 'warm',
    deriveDecorFromPrimary: true,
  });
}

describe('确定性 Deck 装饰主色派生', () => {
  it('派生色保留主色 hex，变体只用 rgba 不引入新色值', () => {
    const colors = deriveDecorColors(PRIMARY);
    expect(colors?.main).toBe(PRIMARY);
    expect(colors?.accent).toBe(PRIMARY);
    expect(colors?.soft).toMatch(/^rgba\(/);
    expect(colors?.glowA).toMatch(/^rgba\(/);
    expect(deriveDecorColors('not-a-color')).toBeUndefined();
  });

  it('生产路径 5 页装饰不再出现固定蓝/紫/青，且无硬编码 01 徽章', () => {
    for (let i = 0; i < PAGE_TYPES.length; i += 1) {
      const html = renderProduction(i);
      expect(html).not.toContain('#3b82f6');
      expect(html).not.toContain('#a855f7');
      expect(html).not.toContain('#14b8a6');
      expect(html).not.toContain('>01<');
      expect(html).toContain(PRIMARY);
    }
  });

  it('封面与封底不生成页脚条，中间页只承载页码与阅读进度', () => {
    const { deck } = fivePageDeck();
    const footers = deck.slides.map((slide) =>
      slide.nodes.filter((node) => node.kind === 'decoration' && node.id?.endsWith('deco-footer')),
    );
    expect(footers[0]).toHaveLength(0);
    expect(footers[4]).toHaveLength(0);
    for (const index of [1, 2, 3]) {
      expect(footers[index].length).toBeLessThanOrEqual(1);
      for (const node of footers[index]) {
        if (node.kind !== 'decoration') continue;
        expect(node.label).toMatch(/^\d{2} \/ \d{2}$/);
        // 不再把该页第一条正文写进 value（02/05、03/05 的重复缺陷）。
        expect(node.value).toBeUndefined();
        expect(node.progress).toBeGreaterThan(0);
      }
    }
  });

  it('页脚文字与列表正文零重复（pres_mwhtjl0l_rfish7g 缺陷零回流）', () => {
    for (let i = 0; i < PAGE_TYPES.length; i += 1) {
      const result = auditSlideHtml(renderProduction(i), {
        primary: PRIMARY,
        skipDensityChecks: true,
      });
      expect(result.issues.map((issue) => issue.code)).not.toContain('footer_duplicates_body');
    }
  });

  it('装饰几何全部落在 1280×720 画布内', () => {
    const pattern = /position:absolute;left:(-?\d+)px;top:(-?\d+)px;width:(\d+)px;height:(\d+)px/g;
    for (let i = 0; i < PAGE_TYPES.length; i += 1) {
      const html = renderProduction(i);
      for (const match of html.matchAll(pattern)) {
        const [, left, top, width, height] = match;
        expect(Number(left)).toBeGreaterThanOrEqual(0);
        expect(Number(top)).toBeGreaterThanOrEqual(0);
        expect(Number(left) + Number(width)).toBeLessThanOrEqual(1280);
        expect(Number(top) + Number(height)).toBeLessThanOrEqual(720);
      }
    }
  });

  it('未开启派生时固定主题保真分支不受影响', () => {
    const { plan, deck } = fivePageDeck();
    const html = deckSlideToHtml(deck.slides[0], buildLayoutContext(plan), {
      visualTheme: 'warm',
    });
    expect(html).toContain(VISUAL_THEMES.warm.glowA);
  });
});
