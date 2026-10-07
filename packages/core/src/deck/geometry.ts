/**
 * Deck 几何基准与 px ↔ inch 换算。
 *
 * 借鉴 python-pptx 的单位体系设计：内部统一用一种整数单位（python-pptx 用 EMU），
 * 对外提供换算函数；这里内部统一用 **px（1280×720 画布）**，导出 PPTX 时换算为 inch。
 *
 * 之所以选 1280×720：现有 HTML 幻灯片基线就是 1280×720
 * （`packages/core/src/engine/layout/constants.ts#defaultPadYx`），
 * 而 PPTX `LAYOUT_WIDE` = 13.333×7.5 inch，96 px/inch，
 * 于是 1280px / 96 = 13.333in、720px / 96 = 7.5in —— 整除关系成立，映射无损。
 */

/** 画布宽度（px）。 */
export const SLIDE_W_PX = 1280;
/** 画布高度（px）。 */
export const SLIDE_H_PX = 720;

/** 每英寸像素数（PPTX inch 体系的标准换算）。 */
export const PX_PER_INCH = 96;

/** 画布宽度（inch）—— 与 PPTX `LAYOUT_WIDE` 一致。 */
export const SLIDE_W_IN = SLIDE_W_PX / PX_PER_INCH; // 13.3333...
/** 画布高度（inch）—— 与 PPTX `LAYOUT_WIDE` 一致。 */
export const SLIDE_H_IN = SLIDE_H_PX / PX_PER_INCH; // 7.5

/** PptxGenJS 对应的版式名（16:9）。 */
export const PPTX_LAYOUT_WIDE = 'LAYOUT_WIDE';

/** Deck 矩形，单位 px，相对 1280×720 画布左上角。 */
export interface DeckRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** PPTX 矩形，单位 inch。 */
export interface DeckRectInch {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** px → inch。 */
export function pxToIn(px: number): number {
  return px / PX_PER_INCH;
}

/** inch → px。 */
export function inToPx(inch: number): number {
  return inch * PX_PER_INCH;
}

/** 保留 4 位小数，避免浮点噪声写进 OOXML。 */
export function roundIn(v: number): number {
  return Math.round(v * 10000) / 10000;
}

/** px 矩形 → inch 矩形。 */
export function rectToInch(rect: DeckRect): DeckRectInch {
  return {
    x: roundIn(pxToIn(rect.x)),
    y: roundIn(pxToIn(rect.y)),
    w: roundIn(pxToIn(rect.w)),
    h: roundIn(pxToIn(rect.h)),
  };
}

/** 构造一个 px 矩形。 */
export function rect(x: number, y: number, w: number, h: number): DeckRect {
  return { x, y, w, h };
}

/** 内缩（上右下左，CSS 顺序）。 */
export function inset(r: DeckRect, top: number, right = top, bottom = top, left = right): DeckRect {
  return {
    x: r.x + left,
    y: r.y + top,
    w: Math.max(0, r.w - left - right),
    h: Math.max(0, r.h - top - bottom),
  };
}

/** 把矩形按 8pt 网格对齐（与 NoPPT 现有 8pt 设计约束一致）。 */
export function snap8(v: number): number {
  return Math.round(v / 8) * 8;
}

/** 把矩形整体按 8pt 网格对齐。 */
export function snapRect8(r: DeckRect): DeckRect {
  const x2 = snap8(r.x + r.w);
  const y2 = snap8(r.y + r.h);
  const x = snap8(r.x);
  const y = snap8(r.y);
  return { x, y, w: Math.max(0, x2 - x), h: Math.max(0, y2 - y) };
}

/**
 * 把容器按权重横向切分为 n 份。
 * 借鉴 python-pptx 里常见的「按列宽权重排布」做法，避免手写魔法数字。
 */
export function splitH(r: DeckRect, weights: number[], gap = 0): DeckRect[] {
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const inner = r.w - gap * (weights.length - 1);
  const out: DeckRect[] = [];
  let x = r.x;
  weights.forEach((wt) => {
    const w = (inner * wt) / total;
    out.push({ x, y: r.y, w, h: r.h });
    x += w + gap;
  });
  return out;
}

/** 把容器按权重纵向切分为 n 份。 */
export function splitV(r: DeckRect, weights: number[], gap = 0): DeckRect[] {
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const inner = r.h - gap * (weights.length - 1);
  const out: DeckRect[] = [];
  let y = r.y;
  weights.forEach((wt) => {
    const h = (inner * wt) / total;
    out.push({ x: r.x, y, w: r.w, h });
    y += h + gap;
  });
  return out;
}

/** 把矩形钳制在画布内（防止 LLM/模板算出的越界坐标破坏 PPTX）。 */
export function clampToSlide(r: DeckRect): DeckRect {
  const x = Math.max(0, Math.min(SLIDE_W_PX, r.x));
  const y = Math.max(0, Math.min(SLIDE_H_PX, r.y));
  return {
    x,
    y,
    w: Math.max(0, Math.min(SLIDE_W_PX - x, r.w)),
    h: Math.max(0, Math.min(SLIDE_H_PX - y, r.h)),
  };
}
