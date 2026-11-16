/**
 * 阶段 4：受控语义色板不被 17 步后处理 / 单色系归一重写。
 */

import { describe, expect, it } from 'vitest';
import type { SlidePlan } from '../../../../types';
import { postProcessSlideHtml } from '../../palette';
import { semanticPaletteHexes, VISUAL_THEMES } from '../visual-tokens';

const plan: SlidePlan = {
  pageType: 'content-cards',
  title: '语义色板保留',
  keyPoints: ['要点一：第一项内容', '要点二：第二项内容'],
  needsImage: false,
};

describe('受控语义色板保真', () => {
  it('后处理不重写主题色板的 color / background / border', () => {
    const theme = VISUAL_THEMES.blue;
    const html = [
      '<div style="position:relative;width:1280px;height:720px;background:#FFFFFF;">',
      `<div style="position:absolute;left:64px;top:64px;width:240px;height:96px;` +
        `color:${theme.palette.blue};background:${theme.palette.softBlue};` +
        `border:1px solid ${theme.palette.teal};box-shadow:0 4px 16px rgba(15,23,42,0.06);">`,
      '<p style="font-size:18px;color:#374151;">正文内容</p>',
      '</div></div>',
    ].join('');
    const out = postProcessSlideHtml(
      html,
      plan,
      '#2563eb',
      '#1d4ed8',
      1280,
      720,
      false,
    ).toLowerCase();
    expect(out).toContain(theme.palette.blue.toLowerCase());
    expect(out).toContain(theme.palette.softBlue.toLowerCase());
    expect(out).toContain(theme.palette.teal.toLowerCase());
  });

  it('色板仍是受控有限集合，不放行任意色值', () => {
    const hexes = semanticPaletteHexes(VISUAL_THEMES.blue);
    expect(hexes.length).toBeGreaterThanOrEqual(10);
    expect(hexes.length).toBeLessThan(30);
    expect(hexes).not.toContain('#123456');
    expect(new Set(hexes).size).toBe(hexes.length);
  });
});
