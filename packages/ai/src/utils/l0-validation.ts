// L0 定量硬校验（Task5 / FR-4 底线）：不依赖 LLM 的硬性可达性校验。
// 当前覆盖两条最易引发"不可读"的底线规则：
//   ① 正文字号 ≥ 12px（过小字在投影/缩略场景下不可辨）
//   ② 文本与其背景的对比度 ≥ 4.5:1（WCAG AA 正文级）
// 仅当能从 inline style 明确判定时才报错；无法判定的情形一律跳过（不误杀）。

export interface L0Issue {
  severity: 'fatal' | 'important';
  rule: string;
  detail: string;
}

const PX_PER_UNIT: Record<string, number> = { px: 1, pt: 1.333, rem: 16, em: 16 };

function toPx(value: number, unit: string): number {
  return value * (PX_PER_UNIT[unit] ?? 1);
}

/** 解析 #rgb / #rrggbb / rgb()/rgba() 为 [r,g,b]（0-255），无法解析返回 null。 */
function parseColor(input: string): [number, number, number] | null {
  const s = input.trim().toLowerCase();
  const hex = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgb = s.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  return null;
}

function luminance([r, g, b]: [number, number, number]): number {
  const a = [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
}

/** WCAG 相对对比度（1..21），任一色无法解析返回 -1。 */
export function contrastRatio(fg: string, bg: string): number {
  const c1 = parseColor(fg);
  const c2 = parseColor(bg);
  if (!c1 || !c2) return -1;
  const l1 = luminance(c1);
  const l2 = luminance(c2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function readCssValue(style: string, prop: string): string | undefined {
  const re = new RegExp(`${prop}\\s*:\\s*([^;}"']+)`, 'i');
  const m = style.match(re);
  return m ? m[1].trim() : undefined;
}

/**
 * 对单页 HTML 执行 L0 定量硬校验，返回违规清单（空数组 = 通过）。
 * @param html   单页 slide HTML
 * @param pageType 可选，仅用于日志/排查
 */
export function l0ValidateSlide(html: string, pageType?: string): L0Issue[] {
  const issues: L0Issue[] = [];
  if (!html) return issues;

  // ① 字号底线：扫描所有 inline font-size，px/pt/rem/em 折算后 < 12 即致命
  const fontRe = /font-size\s*:\s*(\d+(?:\.\d+)?)(px|pt|rem|em|vh|vw|%)/gi;
  let fm: RegExpExecArray | null;
  while ((fm = fontRe.exec(html)) !== null) {
    const val = parseFloat(fm[1]);
    const unit = fm[2];
    if (unit === '%' || unit === 'vh' || unit === 'vw') continue; // 相对单位无法静态折算，跳过
    const px = toPx(val, unit);
    if (px > 0 && px < 12) {
      issues.push({
        severity: 'fatal',
        rule: 'font-size>=12px',
        detail: `检测到 font-size:${fm[1]}${unit}（≈${px.toFixed(1)}px），低于 L0 底线 12px${pageType ? `（${pageType}）` : ''}`,
      });
    }
  }

  // ② 对比度底线：逐元素检查同时带 color 与 background(-color) 的情形
  const tagRe = /<[a-z][a-z0-9]*\b([^>]*)>/gi;
  let tm: RegExpExecArray | null;
  while ((tm = tagRe.exec(html)) !== null) {
    const attrs = tm[1];
    const styleMatch = attrs.match(/style\s*=\s*["']([^"']*)["']/i);
    if (!styleMatch) continue;
    const style = styleMatch[1];
    const color = readCssValue(style, 'color');
    const bg = readCssValue(style, 'background-color') || readCssValue(style, 'background');
    if (!color || !bg) continue;
    // 渐变背景无法静态判定，跳过
    if (/gradient/.test(bg)) continue;
    const ratio = contrastRatio(color, bg);
    if (ratio >= 0 && ratio < 4.5) {
      issues.push({
        severity: 'important',
        rule: 'contrast>=4.5:1',
        detail: `文本色 ${color} 与背景 ${bg} 对比度 ${ratio.toFixed(2)}:1，低于 WCAG AA 4.5:1${pageType ? `（${pageType}）` : ''}`,
      });
    }
  }

  return issues;
}
