/**
 * shared.ts 二次拆分产出：颜色换算（hexToHsl/hslToHex/darkenColor）与主色主题
 * 由 html-presentation/shared.ts 的顶层声明逐块搬移，对外导出保持不变。
 */

import type { ColorTheme } from '../../types';

export function darkenColor(hex: string, percent: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  const f = 1 - percent / 100;
  const nr = Math.max(0, Math.min(255, Math.round(r * f)));
  const ng = Math.max(0, Math.min(255, Math.round(g * f)));
  const nb = Math.max(0, Math.min(255, Math.round(b * f)));
  return '#' + [nr, ng, nb].map((c) => c.toString(16).padStart(2, '0')).join('');
}

/** hex → HSL（H:0~360°, S:0~1, L:0~1）。无效 hex 返回 null。 */

export function hexToHsl(hex: string): { h: number; s: number; l: number } | null {
  const n = (hex || '').replace('#', '').trim();
  if (n.length !== 6 && n.length !== 3) return null;
  let r: number, g: number, b: number;
  if (n.length === 3) {
    r = parseInt(n[0] + n[0], 16);
    g = parseInt(n[1] + n[1], 16);
    b = parseInt(n[2] + n[2], 16);
  } else {
    r = parseInt(n.substring(0, 2), 16);
    g = parseInt(n.substring(2, 4), 16);
    b = parseInt(n.substring(4, 6), 16);
  }
  if ([r, g, b].some((v) => Number.isNaN(v))) return null;
  const rn = r / 255,
    gn = g / 255,
    bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  let h = 0,
    s = 0;
  const l = (max + min) / 2;
  const d = max - min;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn:
        h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
        break;
      case gn:
        h = ((bn - rn) / d + 2) / 6;
        break;
      case bn:
        h = ((rn - gn) / d + 4) / 6;
        break;
    }
  }
  return { h: h * 360, s, l };
}

/** HSL → hex (#rrggbb)。分量越界自动钳制。 */

export function hslToHex(h: number, s: number, l: number): string {
  h = (((h % 360) + 360) % 360) / 360;
  s = Math.max(0, Math.min(1, s));
  l = Math.max(0, Math.min(1, l));
  let r: number, g: number, b: number;
  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  const toHex = (v: number) => {
    const n = Math.max(0, Math.min(255, Math.round(v * 255)));
    return n.toString(16).padStart(2, '0');
  };
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/** 两 hex 的最小色相差（考虑色环 360° 回环）。 */

export function hueDelta(hex1: string, hex2: string): number {
  const a = hexToHsl(hex1);
  const b = hexToHsl(hex2);
  if (!a || !b) return 0;
  return hueDeltaDeg(a.h, b.h);
}
/** 色环上两个色相角度的最小差值（0-180）。 */

export function hueDeltaDeg(h1: number, h2: number): number {
  const raw = Math.abs((h1 % 360) - (h2 % 360));
  return Math.min(raw, 360 - raw);
}

/**
 * FR-8 L-1：primary / darker 色相一致性断言（色相差 ≤ maxDelta，默认 20°）。
 * 若不通过 → 自动用 darkenColor(primary, 20%) 重算 correctedDarker，永远可直接用。
 * 返回 { pass: 是否通过, correctedDarker: 建议使用的 darker 色值, message: 人类可读诊断 }
 */

export function assertHueClose(
  primary: string,
  darker: string,
  maxDelta: number = 20,
): { pass: boolean; correctedDarker: string; message: string } {
  const p = (primary || '').toLowerCase();
  const d = (darker || '').toLowerCase();
  const fallback = darkenColor(p, 20).toLowerCase();
  if (!/^#[0-9a-f]{6}$/.test(p)) {
    return {
      pass: false,
      correctedDarker: fallback,
      message: `assertHueClose: primary=${p} 非 6 位 hex，fallback to darkenColor(${p},20%)=${fallback}`,
    };
  }
  if (!/^#[0-9a-f]{6}$/.test(d)) {
    return {
      pass: false,
      correctedDarker: fallback,
      message: `assertHueClose: darker=${d} 非 6 位 hex，fallback to darkenColor(${p},20%)=${fallback}`,
    };
  }
  const delta = hueDelta(p, d);
  if (delta <= maxDelta) {
    return {
      pass: true,
      correctedDarker: d,
      message: `色相 ${delta.toFixed(1)}° ≤ ${maxDelta}°（OK）`,
    };
  }
  return {
    pass: false,
    correctedDarker: fallback,
    message: `[HUE-JUMP] primary(${p} H=${hexToHsl(p)?.h.toFixed(1)}°) / darker(${d} H=${hexToHsl(d)?.h.toFixed(1)}°) ΔH=${delta.toFixed(1)}° > ${maxDelta}°。自动校正 darker=${fallback}。`,
  };
}


export const COLOR_THEMES: Record<ColorTheme | string, string> = {
  blue: '#2563eb',
  purple: '#7c3aed',
  green: '#059669',
  orange: '#ea580c',
  teal: '#0891b2',
  gray: '#4b5563',
  business: '#2563eb',
  creative: '#7c3aed',
  simple: '#4b5563',
  academic: '#0891b2',
};

/**
 * 后处理（postProcessSlideHtml）版本指纹。生成/发布时用于核对 dist 里编译产物是否包含
 * 最新一代后处理链（enforceSinglePalette + sanitizeStyleSyntax + assertGrid8pt）。
 */

export const POST_VERSION_SIG =
  'enforceSinglePalette:sanitizeStyleSyntax:assertGrid8pt:injectStructuredGraphics:r4';

// ===== 每页重生成熔断（page-level regeneration limiter）=====
// 共享计数：同一次生成（同一 presentationId）下，critique 重试循环 / 单页重生成共用同一 total budget。
// 另按通道(通道配额)独立限流：任一通道超播即使 total 未达上限也被拦截，避免某通道耗尽共享预算后其它通道一步都重试不了。
