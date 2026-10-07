/**
 * deck-to-html 渲染测试：各 pageType 渲染 + 样式 / 几何 parity。
 *
 * 与 `deck-to-html.parity.test.ts` 的分工：
 * - parity 测试断言「审计 / 后处理赖以通过的不变量」（契约式 parity，含图表 SVG、图片占位灰块）；
 * - 本文件断言「全部 pageType 都能被确定性渲染器渲染出合法 HTML」，
 *   并覆盖几何钳制与整册拼接，防止某个版式模板产出空页或越界坐标。
 *
 * 注意：8pt 网格是**安全区常量**的约定（DECK_CONTENT_RECT / DECK_BODY_RECT 均 8 对齐），
 * 并非所有版式的每个装饰矩形都严格 8 对齐（如 cover 的装饰条）。因此这里断言的是
 * 「常量 8pt 对齐」+「所有节点矩形不越出 1280×720 画布（clampToSlide 生效）」，
 * 避免把既有版式几何当成缺陷去改，从而引入视觉回归。
 */

import { describe, expect, it } from 'vitest';
import type { DeckNode } from '@noppt/core/deck';
import type { PresentationPlan, SlidePageType, SlidePlan } from '../../../../types';
import { DECK_BODY_RECT, DECK_CONTENT_RECT, DECK_LAYOUT_BUILDERS } from '../layout-templates';
import { buildLayoutContext, planToDeck } from '../plan-to-deck';
import { deckSlideToHtml, deckToHtml } from '../deck-to-html';

const ALL_PAGE_TYPES = Object.keys(DECK_LAYOUT_BUILDERS) as SlidePageType[];

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function ctx() {
  return buildLayoutContext({ title: 't', primaryColor: '#2563eb', slides: [] });
}

function planOf(pageType: SlidePageType): PresentationPlan {
  const sp: SlidePlan = {
    pageType,
    title: '确定性渲染标题',
    keyPoints: ['要点一：第一项内容', '要点二：第二项内容'],
    needsImage: false,
  };
  return { title: '演示', primaryColor: '#2563eb', slides: [sp] };
}

function renderOne(pageType: SlidePageType): string {
  const deck = planToDeck(planOf(pageType), {
    imageEnabled: false,
    imagePreference: 'content-only',
  });
  return deckSlideToHtml(deck.slides[0], ctx());
}

/** 递归收集所有节点矩形。 */
function collectRects(nodes: DeckNode[], out: Rect[]): void {
  for (const n of nodes) {
    const r = (n as { rect?: Rect }).rect;
    if (r) out.push(r);
    const kids = (n as { children?: DeckNode[] }).children;
    if (kids) collectRects(kids, out);
  }
}

describe('deck-to-html · 全 pageType 渲染', () => {
  it('每个 pageType 都产出合法根容器（1280×720 + relative）', () => {
    expect(ALL_PAGE_TYPES.length).toBeGreaterThan(0);
    for (const pt of ALL_PAGE_TYPES) {
      const html = renderOne(pt);
      expect(html.startsWith('<div style="position:relative;width:1280px;height:720px;')).toBe(
        true,
      );
      expect(html.length).toBeGreaterThan(80);
    }
  });

  it('全部 pageType 输出均不使用 inset 定位', () => {
    for (const pt of ALL_PAGE_TYPES) {
      expect(renderOne(pt)).not.toMatch(/\binset\s*:/);
    }
  });

  it('几何钳制：所有节点矩形不越出 1280×720 画布', () => {
    for (const pt of ALL_PAGE_TYPES) {
      const deck = planToDeck(planOf(pt), { imageEnabled: false, imagePreference: 'content-only' });
      const rects: Rect[] = [];
      collectRects(deck.slides[0].nodes, rects);
      expect(rects.length).toBeGreaterThan(0);
      for (const r of rects) {
        const inside = r.x >= 0 && r.y >= 0 && r.x + r.w <= 1280 && r.y + r.h <= 720;
        expect(inside, `pageType=${pt} 越界矩形: ${JSON.stringify(r)}`).toBe(true);
      }
    }
  });

  it('安全区常量 8pt 对齐（DECK_CONTENT_RECT / DECK_BODY_RECT）', () => {
    for (const r of [DECK_CONTENT_RECT, DECK_BODY_RECT]) {
      for (const v of [r.x, r.y, r.w, r.h]) expect(v % 8).toBe(0);
    }
  });
});

describe('deck-to-html · 样式与整册拼接', () => {
  it('主色经 ctx 透传到输出（颜色已做大小写归一）', () => {
    const html = renderOne('content-cards' as SlidePageType).toLowerCase();
    expect(html).toContain('#2563eb');
  });

  it('deckToHtml 整册渲染：每页一个根容器', () => {
    const slides = ALL_PAGE_TYPES.slice(0, 3).map(
      (pageType) =>
        ({
          pageType,
          title: `页-${pageType}`,
          keyPoints: ['要点一', '要点二'],
          needsImage: false,
        }) as SlidePlan,
    );
    const plan: PresentationPlan = { title: '演示', primaryColor: '#2563eb', slides };
    const deck = planToDeck(plan, { imageEnabled: false, imagePreference: 'content-only' });
    const html = deckToHtml(deck);
    const roots = html.match(/<div style="position:relative;width:1280px;/g) ?? [];
    expect(roots).toHaveLength(3);
  });
});
