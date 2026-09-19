/**
 * PostProcess 颜色 / 对比度数学簇（从 html-presentation-agent.ts 外置）。
 *
 * 纯函数，无 this 依赖；`parseStyleDeclarations` 来自 @noppt/core。
 * agent 中对应 private 方法改为「薄委托」保留在原型上，对外调用方与测试网不变。
 */

import { parseStyleDeclarations } from '@noppt/core';

export function normalizeHex(hex: string): string | null {
  let h = hex.replace('#', '');
  if (h.length === 3) {
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  }
  if (h.length === 6 || h.length === 8) {
    return '#' + h.substring(0, 6);
  }
  return null;
}

/** hex (#rrggbb / #rgb) → rgba(r,g,b,a)。 */
export function hexToRgba(hex: string, alpha: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return `rgba(0, 0, 0, ${alpha})`;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

/** rgb()/rgba() 字符串只看 rgb 三通道 → #rrggbb（alpha 仅用于判断透明度，不影响色相）。 */
export function rgbStringToHex(str: string): string | null {
  const m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(str);
  if (!m) return null;
  const clamp = (n: number): string =>
    Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0');
  return `#${clamp(parseInt(m[1], 10))}${clamp(parseInt(m[2], 10))}${clamp(parseInt(m[3], 10))}`;
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const h = normalizeHex(hex);
  if (!h) return null;
  return {
    r: parseInt(h.substring(1, 3), 16),
    g: parseInt(h.substring(3, 5), 16),
    b: parseInt(h.substring(5, 7), 16),
  };
}

export function parseColorToRgba(
  token: string,
): [number, number, number, number] | null {
  const t = token.trim().toLowerCase();
  const hexM = t.match(/^#([0-9a-f]{3,8})/i);
  if (hexM) {
    let h = hexM[1];
    let a = 1;
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    else if (h.length === 4) {
      a = parseInt(h[3] + h[3], 16) / 255;
      h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    } else if (h.length === 8) {
      a = parseInt(h.slice(6, 8), 16) / 255;
      h = h.slice(0, 6);
    }
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
      a,
    ];
  }
  const rgbM = t.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/i);
  if (rgbM)
    return [
      parseInt(rgbM[1], 10),
      parseInt(rgbM[2], 10),
      parseInt(rgbM[3], 10),
      rgbM[4] !== undefined ? parseFloat(rgbM[4]) : 1,
    ];
  return null;
}

// 半透明前景叠加到不透明基底，得到合成后可见颜色
export function compositeOver(
  fg: [number, number, number, number],
  base: [number, number, number],
): [number, number, number] {
  const [r, g, b, a] = fg;
  return [
    Math.round(r * a + base[0] * (1 - a)),
    Math.round(g * a + base[1] * (1 - a)),
    Math.round(b * a + base[2] * (1 - a)),
  ];
}

// WCAG 相对亮度
export function relativeLuminance(rgb: [number, number, number]): number {
  const lin = (c: number) => {
    const x = c / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
}

// WCAG 对比度比
export function contrastRatio(
  fg: [number, number, number],
  bg: [number, number, number],
): number {
  const lf = relativeLuminance(fg);
  const lb = relativeLuminance(bg);
  const lighter = Math.max(lf, lb);
  const darker = Math.min(lf, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

// 装饰层识别：绝对定位 + 屏蔽指针事件（调用方再配合"无可见文本"判定）；不参与整页色调
export function isDecorativeLayer(styleStr: string): boolean {
  const lower = styleStr.toLowerCase();
  return /position\s*:\s*absolute/.test(lower) && /pointer-events\s*:\s*none/.test(lower);
}

// 合成出某个 inline style 的真实可见背景 RGB（白底画布），无背景返回 null（调用方回退到父级/白底）
export function resolveEffectiveBgRgb(styleStr: string): [number, number, number] | null {
  const lower = styleStr.toLowerCase();
  const gradMatch = lower.match(
    /linear-gradient\(([^)]*)\)|radial-gradient\(([^)]*)\)|conic-gradient\(([^)]*)\)|repeating-linear-gradient\(([^)]*)\)/i,
  );
  if (gradMatch) {
    const inner = gradMatch[1] || gradMatch[2] || gradMatch[3] || gradMatch[4] || '';
    const tokens =
      inner.match(
        /#[0-9a-f]{8}\b|#[0-9a-f]{6}\b|#[0-9a-f]{4}\b|#[0-9a-f]{3}\b|rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(?:,\s*[\d.]+)?\s*\)/gi,
      ) || [];
    let sum = 0;
    let count = 0;
    for (const tok of tokens) {
      const rgba = parseColorToRgba(tok);
      if (!rgba) continue;
      const [r, g, b, a] = rgba;
      if (a <= 0.2) continue; // 极浅透明色标不参与（与仓库既有 α≤0x33 口径一致）
      const comp = compositeOver([r, g, b, a], [255, 255, 255]);
      sum += relativeLuminance(comp);
      count++;
    }
    if (count === 0) return null; // 全是透明色标 → 无实底色
    const avgL = sum / count;
    const y = avgL <= 0.03928 ? avgL * 12.92 : Math.pow(avgL, 1 / 2.4) * 1.055 - 0.055;
    const v = Math.max(0, Math.min(255, Math.round(y * 255)));
    return [v, v, v];
  }
  const decls = parseStyleDeclarations(styleStr);
  let bgVal = '';
  for (const d of decls) {
    if (d.key === 'background-color') bgVal = d.value.toLowerCase();
    else if (d.key === 'background' && !bgVal) bgVal = d.value.toLowerCase();
  }
  if (!bgVal) return null;
  if (/white|#fff\b|#ffffff\b|#fafafa|#f8fafc|#f1f5f9|#f3f4f6|#f9fafb|#e5e7eb/i.test(bgVal))
    return [255, 255, 255];
  const rgba = parseColorToRgba(bgVal);
  if (rgba) return compositeOver(rgba, [255, 255, 255]);
  const rgbaM = bgVal.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/i);
  if (rgbaM)
    return compositeOver(
      [+rgbaM[1], +rgbaM[2], +rgbaM[3], rgbaM[4] !== undefined ? parseFloat(rgbaM[4]) : 1],
      [255, 255, 255],
    );
  return null;
}

// 统一背景色调权威：alpha 感知 + 合成 + 装饰层豁免；四个兜底函数统一调用
export function resolveBgTone(
  styleStr: string,
  _primaryColor: string,
  opts?: { isDecorative?: boolean },
): 'light' | 'dark' | 'unknown' {
  if (opts?.isDecorative) return 'unknown';
  const rgb = resolveEffectiveBgRgb(styleStr);
  if (!rgb) return 'unknown';
  const L = relativeLuminance(rgb);
  if (L < 0.18) return 'dark';
  if (L > 0.6) return 'light';
  return 'unknown';
}

// 按 WCAG 阈值判断是否需改写：正文 ≥4.5、大字(≥24px 或 ≥18.66px 且 bold) ≥3.0，达标不动
export function needsContrastFix(
  fgToken: string,
  bgRgb: [number, number, number],
  fontSizePx: number,
  fontWeight: number,
): boolean {
  const fg = parseColorToRgba(fgToken);
  if (!fg) return false; // 命名色/var 无法解析 → 保守不动
  const ratio = contrastRatio([fg[0], fg[1], fg[2]], bgRgb);
  const isLarge = fontSizePx >= 24 || (fontSizePx >= 18.66 && fontWeight >= 700);
  return ratio < (isLarge ? 3.0 : 4.5);
}

export function fontSizeOf(props: Map<string, string>): number {
  const v = (props.get('font-size') || '').match(/[\d.]+/);
  return v ? parseFloat(v[0]) : 18;
}

export function fontWeightOf(props: Map<string, string>): number {
  const v = props.get('font-weight');
  if (!v) return 400;
  if (/bold/i.test(v)) return 700;
  const n = parseInt(v, 10);
  return isNaN(n) ? 400 : n;
}
/**
 * 计算 HEX 颜色的相对亮度 (WCAG sRGB 伽马校正公式)，返回 0~1
 */
export function hexLuminance(hex: string): number {
  const clean = hex.replace('#', '').trim();
  let r: number, g: number, b: number;
  if (clean.length === 3) {
    r = parseInt(clean[0] + clean[0], 16);
    g = parseInt(clean[1] + clean[1], 16);
    b = parseInt(clean[2] + clean[2], 16);
  } else if (clean.length === 6) {
    r = parseInt(clean.slice(0, 2), 16);
    g = parseInt(clean.slice(2, 4), 16);
    b = parseInt(clean.slice(4, 6), 16);
  } else {
    return 0.5;
  }
  const srgb = [r, g, b].map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
}

/**
 * 将 HEX 主色按 (1 - ratio) 朝黑色渐变（保持色调不变，降低明度）
 */
export function darkenPrimaryColor(primaryColor: string, ratio: number): string {
  const hex = primaryColor.replace('#', '').trim();
  let r: number, g: number, b: number;
  if (hex.length === 3) {
    r = parseInt(hex[0] + hex[0], 16);
    g = parseInt(hex[1] + hex[1], 16);
    b = parseInt(hex[2] + hex[2], 16);
  } else if (hex.length === 6) {
    r = parseInt(hex.slice(0, 2), 16);
    g = parseInt(hex.slice(2, 4), 16);
    b = parseInt(hex.slice(4, 6), 16);
  } else {
    return '#111827';
  }
  r = Math.max(0, Math.min(255, Math.round(r * ratio)));
  g = Math.max(0, Math.min(255, Math.round(g * ratio)));
  b = Math.max(0, Math.min(255, Math.round(b * ratio)));
  // 避免变暗后变成纯黑（看起来像 bug），至少保留亮度 0.05
  const lum = hexLuminance(
    `${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`,
  );
  if (lum < 0.05) {
    const boost = 0.08;
    r = Math.min(255, Math.round(r + (255 - r) * boost * 2));
    g = Math.min(255, Math.round(g + (255 - g) * boost * 2));
    b = Math.min(255, Math.round(b + (255 - b) * boost * 2));
  }
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}
