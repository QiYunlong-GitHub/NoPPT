/**
 * 阶段 1：验证「参考克隆 · 色彩红线豁免」的 accents 真正到达确定性 Deck 渲染器。
 * 默认（无多色参考）输出必须保持零装饰，避免影响既有 parity / 视觉完整性快照。
 */

import { describe, expect, it } from 'vitest';
import type { PresentationPlan, ReferencePalette, SlidePlan } from '../../../../types';
import { buildLayoutContext, planToDeck } from '../plan-to-deck';
import { deckSlideToHtml, type DeckToHtmlOptions } from '../deck-to-html';

const PALETTE: ReferencePalette = {
  primary: '#4c9a6b',
  accents: ['#f5d76e', '#5bb8a0', '#e11d48'],
  isMultiColor: true,
};

function render(options?: DeckToHtmlOptions): string {
  const sp: SlidePlan = {
    pageType: 'cover',
    title: '参考配色标题',
    keyPoints: ['要点一：第一项内容', '要点二：第二项内容'],
    needsImage: false,
  };
  const plan: PresentationPlan = { title: '参考配色', primaryColor: '#2563eb', slides: [sp] };
  const deck = planToDeck(plan, { imageEnabled: false, imagePreference: 'content-only' });
  return deckSlideToHtml(deck.slides[0], buildLayoutContext(plan), options);
}

describe('参考调色板进入 Deck HTML', () => {
  it('无参考调色板时保持零装饰（既有 parity 不变）', () => {
    expect(render()).not.toContain('noppt-accent-layer');
  });

  it('多色参考时 accents 进入 HTML，且装饰层不拦截元素选中', () => {
    const html = render({ referencePalette: PALETTE });
    expect(html).toContain('noppt-accent-layer');
    expect(html).toContain('#f5d76e');
    expect(html).toContain('#5bb8a0');
    expect(html).toContain('#e11d48');
    expect(html).toContain('pointer-events:none');
    expect(html).toContain('data-canonical-root="true"');
  });

  it('单色/空 accents 参考不产生装饰层', () => {
    const single: ReferencePalette = { primary: '#4c9a6b', accents: [], isMultiColor: false };
    expect(render({ referencePalette: single })).not.toContain('noppt-accent-layer');
    expect(render({ referencePalette: { ...PALETTE, accents: [] } })).not.toContain(
      'noppt-accent-layer',
    );
  });
});
