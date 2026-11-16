/**
 * 阶段 2：设计 token 与渲染器增量能力。
 * 验收方式按用户选择改为「单测/快照 + 自动断言」，不调用任何生成工具。
 */

import { describe, expect, it } from 'vitest';
import type { PresentationPlan, SlidePlan } from '../../../../types';
import { buildLayoutContext, planToDeck } from '../plan-to-deck';
import { deckSlideToHtml, type DeckToHtmlOptions } from '../deck-to-html';
import {
  semanticPaletteHexes,
  VISUAL_THEMES,
  type VisualThemeId,
} from '../visual-tokens';
import { measureVisualDensity, VISUAL_DENSITY_BASELINE } from '../visual-density';

function render(options?: DeckToHtmlOptions): string {
  const sp: SlidePlan = {
    pageType: 'cover',
    title: '设计令牌封面标题',
    keyPoints: ['要点一：第一项内容', '要点二：第二项内容'],
    needsImage: false,
  };
  const plan: PresentationPlan = { title: '设计令牌', primaryColor: '#2563eb', slides: [sp] };
  const deck = planToDeck(plan, { imageEnabled: false, imagePreference: 'content-only' });
  return deckSlideToHtml(deck.slides[0], buildLayoutContext(plan), options);
}

describe('设计主题（16:9 分页）', () => {
  it('未传主题时保持零装饰，既有 parity 不变', () => {
    const html = render();
    expect(html).not.toContain('noppt-visual-backdrop');
    expect(html).not.toContain('radial-gradient(');
    expect(html).toContain('data-canonical-root="true"');
  });

  it('blue / warm / nature 三套主题产生不同 HTML', () => {
    const ids: VisualThemeId[] = ['blue', 'warm', 'nature'];
    const htmls = ids.map((id) => render({ visualTheme: id }));
    expect(new Set(htmls).size).toBe(3);
    for (const id of ids) {
      expect(htmls[ids.indexOf(id)]).toContain(VISUAL_THEMES[id].glowA);
    }
  });

  it('启用主题后 radial 光斑、SVG 装饰、阴影与多色值均出现', () => {
    const html = render({ visualTheme: 'blue' });
    const d = measureVisualDensity(html);
    expect(d.radialGradients).toBeGreaterThanOrEqual(2);
    expect(d.svgElements).toBeGreaterThanOrEqual(1);
    expect(d.boxShadows).toBeGreaterThanOrEqual(1);
    expect(d.hexColors.length).toBeGreaterThan(VISUAL_DENSITY_BASELINE.hexColorCount);
    expect(html).toContain('noppt-visual-backdrop');
    expect(html).toContain('pointer-events:none');
    expect(html).toContain('data-canonical-root="true"');
  });

  it('主题装饰层不参与内容节点，保证元素可选中与 PPTX parity', () => {
    const html = render({ visualTheme: 'nature' });
    const backdrop = html.slice(
      html.indexOf('noppt-visual-backdrop'),
      html.indexOf('data-deck-node-id'),
    );
    expect(backdrop).not.toContain('data-deck-node-id');
  });

  it('语义色板提供 ≥10 个受控色值供后处理白名单复用', () => {
    expect(semanticPaletteHexes(VISUAL_THEMES.blue).length).toBeGreaterThanOrEqual(10);
  });
});

describe('字体栈 HTML 属性转义（产物 Q3）', () => {
  it('root style 中的字体栈不再用双引号提前闭合属性', () => {
    for (const options of [undefined, { fontFamily: 'sans' }, { fontFamily: 'serif' }]) {
      const html = render(options);
      const firstStyle = html.match(/style="([^"]*)"/)?.[1] ?? '';
      expect(firstStyle).toContain('font-family');
      expect(firstStyle).not.toContain('"');
      expect(html).toContain('data-canonical-root="true"');
    }
  });
});
