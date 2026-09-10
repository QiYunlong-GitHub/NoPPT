import { parseStyleDeclarations } from '@noppt/core';

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export function parseColor(str: string): RGB | null {
  if (!str) return null;
  const s = str.trim().toLowerCase();
  if (s === 'transparent' || s === 'none' || s === 'inherit' || s === 'currentcolor') return null;

  const hexMatch = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/);
  if (hexMatch) {
    let hex = hexMatch[1];
    if (hex.length === 3) {
      hex = hex
        .split('')
        .map((c) => c + c)
        .join('');
    }
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    return { r, g, b };
  }

  const rgbMatch = s.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*[\d.]+)?\s*\)$/);
  if (rgbMatch) {
    return {
      r: parseInt(rgbMatch[1], 10),
      g: parseInt(rgbMatch[2], 10),
      b: parseInt(rgbMatch[3], 10),
    };
  }

  const namedColors: Record<string, RGB> = {
    black: { r: 0, g: 0, b: 0 },
    white: { r: 255, g: 255, b: 255 },
    red: { r: 255, g: 0, b: 0 },
    green: { r: 0, g: 128, b: 0 },
    blue: { r: 0, g: 0, b: 255 },
    yellow: { r: 255, g: 255, b: 0 },
    cyan: { r: 0, g: 255, b: 255 },
    magenta: { r: 255, g: 0, b: 255 },
    gray: { r: 128, g: 128, b: 128 },
    grey: { r: 128, g: 128, b: 128 },
    orange: { r: 255, g: 165, b: 0 },
    purple: { r: 128, g: 0, b: 128 },
    pink: { r: 255, g: 192, b: 203 },
    brown: { r: 165, g: 42, b: 42 },
  };
  return namedColors[s] || null;
}

export function extractPxValues(str: string): number[] {
  const values: number[] = [];
  const re = /(-?\d+(?:\.\d+)?)px/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(str)) !== null) {
    values.push(parseFloat(m[1]));
  }
  return values;
}

export function getStyleMap(styleStr: string): Record<string, string> {
  const map: Record<string, string> = {};
  if (!styleStr) return map;
  for (const { key, value } of parseStyleDeclarations(styleStr)) {
    map[key] = value;
  }
  return map;
}

export function getAttr(attrs: string, name: string): string {
  const re = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i');
  const m = attrs.match(re);
  return m ? m[1] : '';
}

export function getStyleFromAttrs(attrs: string): string {
  return getAttr(attrs, 'style');
}

export function getClassFromAttrs(attrs: string): string {
  return getAttr(attrs, 'class');
}

export interface ElementMatch {
  tag: string;
  attrs: string;
  fullTag: string;
  index: number;
}

export function findAllElements(html: string, tagPattern?: RegExp): ElementMatch[] {
  const results: ElementMatch[] = [];
  const re = /<([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const tag = m[1].toLowerCase();
    if (tagPattern && !tagPattern.test(tag)) continue;
    if (/\/\s*$/.test(m[2])) continue;
    results.push({
      tag,
      attrs: m[2] || '',
      fullTag: m[0],
      index: m.index,
    });
  }
  return results;
}

export function findOuterContainer(
  html: string,
): { tag: string; attrs: string; fullTag: string; innerStart: number; closeIndex: number } | null {
  const trimmed = html.trim();
  const m = /^<(div|section|article)\b([^>]*)>/i.exec(trimmed);
  if (!m) return null;
  const tag = m[1].toLowerCase();
  const attrs = m[2] || '';
  const fullTag = m[0];
  const rest = trimmed.substring(m[0].length);
  let depth = 1;
  const scanRe = new RegExp(`<(/?)(${tag})\\b([^>]*)>`, 'gi');
  let mm: RegExpExecArray | null;
  let closeIdx = -1;
  while ((mm = scanRe.exec(rest)) !== null) {
    if (mm[1] === '/') {
      depth--;
      if (depth === 0) {
        closeIdx = mm.index;
        break;
      }
    } else if (!/\/\s*$/.test(mm[3] || '')) {
      depth++;
    }
  }
  return {
    tag,
    attrs,
    fullTag,
    innerStart: m[0].length,
    closeIndex: closeIdx >= 0 ? m[0].length + closeIdx : -1,
  };
}

export function getDirectChildren(html: string, parentTag: string): ElementMatch[] {
  const outer = findOuterContainer(html);
  if (!outer || outer.tag !== parentTag) return [];
  const inner = html.substring(
    outer.innerStart,
    outer.closeIndex >= 0 ? outer.closeIndex : html.length,
  );
  const children: ElementMatch[] = [];
  let depth = 0;
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(inner)) !== null) {
    const isClose = m[1] === '/';
    const tag = m[2].toLowerCase();
    const attrs = m[3] || '';
    const isSelfClosing =
      /\/\s*$/.test(attrs) ||
      /^(img|br|hr|input|meta|link|base|wbr|source|track|embed|param|col)$/i.test(tag);
    if (isSelfClosing) {
      if (depth === 0) {
        children.push({ tag, attrs, fullTag: m[0], index: m.index });
      }
      continue;
    }
    if (!isClose) {
      if (depth === 0) {
        children.push({ tag, attrs, fullTag: m[0], index: m.index });
      }
      depth++;
    } else {
      depth--;
    }
  }
  return children;
}

export function getElementInnerText(html: string, tag: string): string[] {
  const texts: string[] = [];
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const inner = m[1]
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (inner) texts.push(inner);
  }
  return texts;
}

export function colorDistance(c1: RGB, c2: RGB): number {
  const dr = c1.r - c2.r;
  const dg = c1.g - c2.g;
  const db = c1.b - c2.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

export function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      case b:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }
  return { h: h * 360, s, l };
}

export function isNeonBrightColor(color: RGB): boolean {
  const { h, s, l } = rgbToHsl(color.r, color.g, color.b);
  return s > 0.6 && l > 0.5 && h >= 0;
}

export function stringifyStyleMap(styleMap: Record<string, string>): string {
  return Object.entries(styleMap)
    .map(([k, v]) => `${k}:${v}`)
    .join(';');
}

export function setStyleInAttrs(attrs: string, key: string, value: string): string {
  const styleMatch = attrs.match(/style="([^"]*)"/i);
  if (!styleMatch) {
    return `${attrs} style="${key}:${value}"`.trim();
  }
  const styleStr = styleMatch[1];
  const styleMap = getStyleMap(styleStr);
  styleMap[key] = value;
  const newStyle = stringifyStyleMap(styleMap);
  return attrs.replace(/style="[^"]*"/i, `style="${newStyle}"`);
}

export function removeStyleFromAttrs(attrs: string, key: string): string {
  const styleMatch = attrs.match(/style="([^"]*)"/i);
  if (!styleMatch) return attrs;
  const styleStr = styleMatch[1];
  const styleMap = getStyleMap(styleStr);
  delete styleMap[key];
  const newStyle = stringifyStyleMap(styleMap);
  return attrs.replace(/style="[^"]*"/i, `style="${newStyle}"`);
}

export function hasStyleKey(styleStr: string, key: string): boolean {
  const re = new RegExp(`(?:^|;)\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:`, 'i');
  return re.test(`;${styleStr}`);
}

export function isOn8Grid(px: number, tolerance: number = 2): boolean {
  if (px === 0) return true;
  const nearest = Math.round(px / 8) * 8;
  return Math.abs(px - nearest) <= tolerance;
}
