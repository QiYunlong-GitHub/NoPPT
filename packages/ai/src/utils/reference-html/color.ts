// 参考 HTML 单分类提取（Task 2 / FR-1 / FR-9 / FR-11.2 / C-1~C-14）
// 独立 export 函数，JSDOM 全文解析（不抽样），供 ai.service 与 Vitest 直接调用。
import {
  ReferencePalette,
} from '../../types';
import {
  resolveComputedDecl,
  toHex,
  firstColorIn,
  CascadeIndex,
} from '../reference-style-cascade';

// ---------- 颜色工具 ----------

export function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function isGray(h: string): boolean {
  const [r, g, b] = rgb(h);
  return Math.max(r, g, b) - Math.min(r, g, b) < 24;
}

export function isNearBlack(h: string): boolean {
  const [r, g, b] = rgb(h);
  // 放宽阈值：#0f172a 这类极深藏蓝(b=42)也应视为近黑，作为兜底候选，
  // 避免大面积深色背景被误选为主色（主色应优先取彩色品牌色）。
  return r < 50 && g < 50 && b < 50;
}

export function isNearWhite(h: string): boolean {
  const [r, g, b] = rgb(h);
  return r > 215 && g > 215 && b > 215;
}

export function isExcludedColor(h: string): boolean {
  return isGray(h) || isNearBlack(h) || isNearWhite(h);
}

export function hueOf(h: string): number {
  const [r, g, b] = rgb(h).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return -1;
  let h2 = 0;
  if (max === r) h2 = ((g - b) / d) % 6;
  else if (max === g) h2 = (b - r) / d + 2;
  else h2 = (r - g) / d + 4;
  h2 *= 60;
  return h2 < 0 ? h2 + 360 : h2;
}


// ---------- 画布识别（FR-参考克隆：取真实画布而非预览台 body）----------
export function chromaOf(h: string): number {
  const [r, g, b] = rgb(h);
  return Math.max(r, g, b) - Math.min(r, g, b);
}

export function lumOf(h: string): number {
  const [r, g, b] = rgb(h);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

export function colorDistance(a: string, b: string): number {
  const [r1, g1, b1] = rgb(a);
  const [r2, g2, b2] = rgb(b);
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
}


// ---------- 调色板提取（主色 + 撞色 accent + 描边色 + 画布背景）----------
export function extractColorPalette(
  doc: Document,
  cascade: CascadeIndex | undefined,
  canvas: Element,
): ReferencePalette {
  const weightByColor: Record<string, number> = {};
  const consider = (raw: string | undefined, weight: number) => {
    const hex = toHex(raw || '');
    if (!hex) return;
    if (isGray(hex)) return; // 调色板只要彩色，中性灰阶不入
    weightByColor[hex] = (weightByColor[hex] || 0) + weight;
  };
  doc.querySelectorAll('*').forEach((el) => {
    const s = (el as HTMLElement).getAttribute('style') || '';
    const mBg = s.match(/background(?:-color)?\s*:\s*([^;]+)/i);
    if (mBg) consider(firstColorIn(mBg[1] ?? ''), 3);
    const mBorder = s.match(/border[^;]*?(#[0-9a-fA-F]{6})\b/i);
    if (mBorder) consider(mBorder[1], 1);
    const mColor = s.match(/color\s*:\s*([^;]+)/i);
    if (mColor) consider(firstColorIn(mColor[1] ?? ''), 1);
    if (cascade) {
      const cb =
        resolveComputedDecl(el, 'background-color', '', cascade) ||
        resolveComputedDecl(el, 'background', '', cascade);
      if (cb) consider(firstColorIn(cb), 3);
      const cc = resolveComputedDecl(el, 'color', '', cascade);
      if (cc) consider(cc, 1);
      const bcol =
        resolveComputedDecl(el, 'border-color', '', cascade) ||
        resolveComputedDecl(el, 'border', '', cascade);
      if (bcol) {
        const h = firstColorIn(bcol);
        if (h) consider(h, 1);
      }
    }
  });
  if (cascade) {
    for (const [k, v] of Object.entries(cascade.vars)) {
      if (/primary|brand|accent|color|theme/i.test(k)) consider(v, 5);
    }
  }
  const primary = extractPrimaryColor(doc, cascade);
  const candidates = Object.entries(weightByColor)
    .filter(([h]) => h !== primary)
    .map(([h, w]) => ({ h, w }))
    .filter((e) => chromaOf(e.h) >= 30 && lumOf(e.h) > 0.08 && lumOf(e.h) < 0.95)
    .sort((a, b) => b.w - a.w);
  const accents: string[] = [];
  for (const e of candidates) {
    if (accents.every((a) => colorDistance(a, e.h) > 40)) accents.push(e.h);
    if (accents.length >= 5) break;
  }
  // 粗描边色（孟菲斯 border:4px solid）
  let strokeColor: string | undefined;
  let maxBW = 0;
  doc.querySelectorAll('*').forEach((el) => {
    const s = (el as HTMLElement).getAttribute('style') || '';
    const m = s.match(/border\s*:\s*(\d+)px\s+(?:solid|dashed|dotted)\s*(#[0-9a-fA-F]{6})/i);
    if (m && parseInt(m[1], 10) >= 3 && parseInt(m[1], 10) > maxBW) {
      maxBW = parseInt(m[1], 10);
      strokeColor = m[2].toLowerCase();
    }
    if (cascade) {
      const b = resolveComputedDecl(el, 'border', '', cascade);
      const mm = b && b.match(/(\d+)px\s+(?:solid|dashed|dotted)\s*(#[0-9a-fA-F]{6})/i);
      if (mm && parseInt(mm[1], 10) >= 3 && parseInt(mm[1], 10) > maxBW) {
        maxBW = parseInt(mm[1], 10);
        strokeColor = mm[2].toLowerCase();
      }
    }
  });
  // 画布背景
  let canvasBg: string | undefined;
  const cs = (canvas as HTMLElement).getAttribute('style') || '';
  const mBg = cs.match(/background(?:-color)?\s*:\s*([^;]+)/i);
  if (mBg) canvasBg = toHex(firstColorIn(mBg[1] ?? '') ?? '');
  if (!canvasBg && cascade) {
    const c =
      resolveComputedDecl(canvas, 'background-color', '', cascade) ||
      resolveComputedDecl(canvas, 'background', '', cascade) ||
      '';
    if (c) canvasBg = toHex(firstColorIn(c) ?? '');
  }
  let maxPair = 0;
  for (let i = 0; i < accents.length; i++) {
    for (let j = i + 1; j < accents.length; j++) {
      maxPair = Math.max(maxPair, colorDistance(accents[i], accents[j]));
    }
  }
  return {
    primary: primary || '#888888',
    accents,
    strokeColor,
    canvasBg,
    isMultiColor: accents.length >= 2 && maxPair > 80,
  };
}


// ---------- C-1 主色（加权：背景/渐变 > 边框/文字；CSS 变量 --primary 等强候选；灰阶仅作兜底）----------
export function extractPrimaryColor(doc: Document, cascade?: CascadeIndex): string | undefined {
  const colorSet: Record<string, number> = {};
  const fallbackSet: Record<string, number> = {};
  const consider = (raw: string | undefined, weight: number) => {
    if (!raw) return;
    const hex = toHex(raw);
    if (!hex) return;
    if (isExcludedColor(hex)) fallbackSet[hex] = (fallbackSet[hex] || 0) + weight;
    else colorSet[hex] = (colorSet[hex] || 0) + weight;
  };
  doc.querySelectorAll('*').forEach((el) => {
    const s = (el as HTMLElement).getAttribute('style') || '';
    const mBg = s.match(/background(?:-color)?\s*:\s*([^;]+)/i);
    if (mBg) consider(firstColorIn(mBg[1]), 3);
    const mBc = s.match(/border(?:-bottom|-top|-left|-right)?-color\s*:\s*([^;]+)/i);
    if (mBc) consider(mBc[1], 1);
    const mColor = s.match(/color\s*:\s*([^;]+)/i);
    if (mColor) consider(mColor[1], 1);
    if (cascade) {
      const cb =
        resolveComputedDecl(el, 'background-color', '', cascade) ||
        resolveComputedDecl(el, 'background', '', cascade);
      if (cb) consider(firstColorIn(cb), 3);
      const cc = resolveComputedDecl(el, 'color', '', cascade);
      if (cc) consider(cc, 1);
    }
  });
  if (cascade) {
    for (const [k, v] of Object.entries(cascade.vars)) {
      if (/primary|brand|accent|color|theme/i.test(k)) consider(v, 5);
    }
  }
  const pick = (set: Record<string, number>): string | undefined => {
    const e = Object.entries(set).sort((a, b) => b[1] - a[1]);
    return e.length ? e[0][0] : undefined;
  };
  return pick(colorSet) || pick(fallbackSet);
}


// ---------- C-1b 文字色（标题/正文，允许近黑/白/灰，不复用 isExcludedColor）----------
export function extractTextColorBySelector(
  doc: Document,
  selector: string,
  cascade?: CascadeIndex,
): string | undefined {
  const freq: Record<string, number> = {};
  doc.querySelectorAll(selector).forEach((el) => {
    const s = (el as HTMLElement).getAttribute('style') || '';
    let hex = toHex((s.match(/color\s*:\s*([^;]+)/i)?.[1] || '').trim());
    if (!hex && cascade) {
      const c = resolveComputedDecl(el, 'color', '', cascade);
      if (c) hex = toHex(c);
    }
    if (hex) freq[hex] = (freq[hex] || 0) + 1;
  });
  const entries = Object.entries(freq).sort((a, b) => b[1] - a[1]);
  return entries.length ? entries[0][0] : undefined;
}

/** 标题色：取 h1/h2/h3 上显式声明的 color（允许近黑/白/灰）。 */
export function extractTitleColor(doc: Document, cascade?: CascadeIndex): string | undefined {
  return extractTextColorBySelector(doc, 'h1, h2, h3', cascade);
}

/** 正文色：取 li/p 上显式声明的 color（允许近黑/白/灰）。 */
export function extractBodyColor(doc: Document, cascade?: CascadeIndex): string | undefined {
  return extractTextColorBySelector(doc, 'li, p', cascade);
}


export function extractBorderColor(el: Element): string | undefined {
  const s = (el as HTMLElement).getAttribute('style') || '';
  const m1 = s.match(/border(?:-bottom|-top|-left|-right)?-color\s*:\s*(#[0-9a-fA-F]{6})/i);
  if (m1) return m1[1].toLowerCase();
  const m2 = s.match(
    /border(?:-bottom|-top|-left|-right)?\s*:\s*\d+px\s+(?:solid|dashed|dotted)\s*(#[0-9a-fA-F]{6})/i,
  );
  return m2 ? m2[1].toLowerCase() : undefined;
}
