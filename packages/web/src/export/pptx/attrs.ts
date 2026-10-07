/**
 * Deck 视觉属性 → PptxGenJS 属性。
 *
 * PptxGenJS 的 `ShapeFillProps` 只支持 `solid` / `none`（类型层面），
 * 因此 Deck 的渐变填充在此**降级为纯色**（取渐变中点的混合色）——
 * 与 HTML 侧的 `linear-gradient(135deg,P,PD)` 视觉接近，且不会生成非法 OOXML。
 */

import type { DeckColor, DeckFill, DeckLine, DeckShadow } from '@noppt/core/deck';
import { normalizeColor } from '@noppt/core/deck';

export interface PptxFill {
  color?: string;
  transparency?: number;
  type?: 'none' | 'solid';
}

export interface PptxLine {
  color?: string;
  width?: number;
  transparency?: number;
  dash?: 'solid' | 'dash' | 'dashDot' | 'lgDash' | 'lgDashDot' | 'dot' | 'sysDash' | 'sysDot';
}

export interface PptxShadow {
  type: 'outer' | 'inner';
  angle?: number;
  blur?: number;
  color?: string;
  offset?: number;
  opacity?: number;
}

/** 两个 HEX 按 t 混合（0→a，1→b）。 */
export function mixHex(a: string, b: string, t = 0.5): string {
  const ca = normalizeColor(a, '000000');
  const cb = normalizeColor(b, '000000');
  const pa = parseInt(ca, 16);
  const pb = parseInt(cb, 16);
  const ch = (x: number, y: number) => Math.round(x + (y - x) * t);
  const r = ch((pa >> 16) & 255, (pb >> 16) & 255);
  const g = ch((pa >> 8) & 255, (pb >> 8) & 255);
  const bl = ch(pa & 255, pb & 255);
  return [r, g, bl]
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

/** DeckFill → PptxGenJS fill。 */
export function toPptxFill(fill?: DeckFill): PptxFill | undefined {
  if (!fill) return undefined;
  if (fill.type === 'gradient' && fill.gradient?.stops?.length) {
    const stops = fill.gradient.stops;
    const first = stops[0];
    const last = stops[stops.length - 1];
    return { type: 'solid', color: normalizeColor(mixHex(first.color, last.color, 0.5)) };
  }
  if (!fill.color) return undefined;
  return {
    type: 'solid',
    color: normalizeColor(fill.color),
    ...(typeof fill.transparency === 'number' ? { transparency: fill.transparency } : {}),
  };
}

/** DeckLine → PptxGenJS line。 */
export function toPptxLine(line?: DeckLine): PptxLine | undefined {
  if (!line) return undefined;
  const out: PptxLine = {};
  if (line.color) out.color = normalizeColor(line.color);
  if (typeof line.width === 'number') out.width = line.width;
  if (typeof line.transparency === 'number') out.transparency = line.transparency;
  if (line.dash) out.dash = line.dash;
  return Object.keys(out).length > 0 ? out : undefined;
}

/** DeckShadow → PptxGenJS shadow。 */
export function toPptxShadow(shadow?: DeckShadow): PptxShadow | undefined {
  if (!shadow) return undefined;
  return {
    type: shadow.type ?? 'outer',
    ...(typeof shadow.angle === 'number' ? { angle: shadow.angle } : {}),
    ...(typeof shadow.blur === 'number' ? { blur: shadow.blur } : {}),
    ...(shadow.color ? { color: normalizeColor(shadow.color) } : {}),
    ...(typeof shadow.offset === 'number' ? { offset: shadow.offset } : {}),
    ...(typeof shadow.opacity === 'number' ? { opacity: shadow.opacity } : {}),
  };
}

/** 默认中文字体（PPTX 侧必须显式指定，否则中文会落到西文字体）。 */
export const DEFAULT_PPTX_FONT_FACE = 'Microsoft YaHei';

/** 归一化颜色为 OOXML 惯例（6 位、无 `#`）。 */
export function pptxColor(color: DeckColor | undefined, fallback = '000000'): string {
  return normalizeColor(color, fallback);
}
