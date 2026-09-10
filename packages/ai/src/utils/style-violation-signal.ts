/**
 * styleViolationSignal —— 终局防线越权信号统计（与 server 终局防线版本一致）
 *
 * 将原 ai.service.ts 中 server 端的 styleViolationSignal 迁移为可独立测试的可复用模块，
 * 以便 server 包与 ai 包、audit 包共享同一套判定逻辑，避免"两处实现漂移"。
 *
 * 返回结构化三分量 + 总分，便于按阈值触发（而不是任何 >0 就换 fallback）。
 */

export interface StyleViolationBreakdown {
  /** font-size 在 [22, 29]px 区间的超规字号计数 */
  neutralFont22_29: number;
  /** 真正的"缺分号粘接"：\d+px 后紧跟字母/连字符，且前一个字符不是合法分隔符 */
  neutralPxSticky: number;
  /** 越权色（非灰度/非 neutral 白名单/非 expectedPrimary 30° 色环内）计数 */
  colorViolations: number;
  total: number;
}

export function hexToHsl(hex: string): { h: number; s: number; l: number } | null {
  // 兼容 6 位与 8 位带 alpha hex，取前 6 位本体判定 hue
  const m = /^#([0-9a-fA-F]{6})/.exec(hex);
  if (!m) return null;
  const r = parseInt(m[1].slice(0, 2), 16) / 255;
  const g = parseInt(m[1].slice(2, 4), 16) / 255;
  const b = parseInt(m[1].slice(4, 6), 16) / 255;
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
        h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
        break;
      case g:
        h = ((b - r) / d + 2) * 60;
        break;
      case b:
        h = ((r - g) / d + 4) * 60;
        break;
    }
  }
  return { h, s, l };
}

export function hueDeltaDeg(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/** neutral 白名单 hex（文本、边框、灰底、语义红/绿/橙/蓝） */
export const NEUTRAL_HEX_WHITELIST: string[] = [
  '#0f172a',
  '#111827',
  '#1f2937',
  '#374151',
  '#4b5563',
  '#6b7280',
  '#9ca3af',
  '#d1d5db',
  '#e5e7eb',
  '#f3f4f6',
  '#f9fafb',
  '#ffffff',
  '#000000',
  '#1e293b',
  '#334155',
  '#cbd5e1',
  '#e2e8f0',
  '#f1f5f9',
  '#f8fafc',
  '#ef4444',
  '#22c55e',
  '#f59e0b',
  '#3b82f6',
];

/**
 * 统计「真·缺分号粘接」px 拼接次数。
 *
 * 精确语义：对每个 \d+px 命中，取其后**紧邻第一个字符（不跳空白）**：
 *   - 若为空白字符（空格/Tab/换行） → 合法（CSS 值之间空格分隔，如 "5px solid"）→ 不计数；
 *   - 若为合法分隔符 (; " ' ) ] > , } ` . :) 或 EOF → 合法（属性间分号/属性值结束引号等）→ 不计数；
 *   - 若为字母或连字符 '-'  → 真缺分号粘接（如 "24pxborder-radius" 的 24pxb）→ +1；
 *   - 若为数字 / # / % 或其他 → 属于"数值拼接"或"颜色/单位"等其他语法问题，非本类，不计数。
 *
 * 重点：**不跳过任何空白**，因为 `5px solid`（px 后有空格）必须判为合法，而不得像旧实现那样
 * 把跳过空格后得到的 "s(solid)" 误判为缺分号粘接（本规格 G1/G6/G10 修复点）。
 */
export function countPxSticky(html: string): number {
  const re = /\d+px/g;
  let count = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const endIdx = m.index + m[0].length;
    if (endIdx >= html.length) continue; // EOF 合法
    const ch = html[endIdx];
    if (/\s/.test(ch)) continue; // 空白 = 合法 CSS 多值分隔（如 5px solid）
    // 合法分隔符集合：; " ' ) ] > , } ` . : / % #
    if (';"\')]>},.:/%#`'.includes(ch)) continue;
    if (/[A-Za-z-]/.test(ch)) {
      count++;
    }
    // 数字 / 其他 不计数（如 4px16px 数字拼值、4px!important 非字母等）
  }
  return count;
}

export const STYLE_VIOLATION_THRESHOLDS = {
  neutralFont22_29: 5,
  // FR-7 防御伪阳性：原阈值 3 太低，enforce8ptGrid 一旦丢分号易误触发 fallback。
  // 现在阈值提升到 20；配合 enforce8ptGrid 修复（不丢分号），
  // 只有真·大规模缺分号才会触发兜底。
  neutralPxSticky: 20,
  colorViolations: 10,
} as const;

export function exceedsThreshold(b: StyleViolationBreakdown): boolean {
  return (
    b.neutralFont22_29 >= STYLE_VIOLATION_THRESHOLDS.neutralFont22_29 ||
    b.neutralPxSticky >= STYLE_VIOLATION_THRESHOLDS.neutralPxSticky ||
    b.colorViolations >= STYLE_VIOLATION_THRESHOLDS.colorViolations
  );
}

export function styleViolationSignal(
  html: string,
  expectedPrimary: string = '#2563eb',
  options?: { allowedAccentHexes?: Set<string> },
): StyleViolationBreakdown {
  const neutralFont22_29 = (html.match(/font-size:\s*2[2-9]px/g) || []).length;
  const neutralPxSticky = countPxSticky(html);
  const expected = hexToHsl(expectedPrimary);
  const allowedAccentHexes = options?.allowedAccentHexes;

  // 所有 6~8 位 hex（含 alpha）匹配 → 只取前 7 位 (#RRGGBB) 做 hue 比较
  // 正则用 # + 6 hex + 可选 2 hex 保证能抓到 8 位，再由 hexToHsl 裁剪前 6 位。
  // 这里仍沿用 6 位贪婪匹配（之前的消费策略），但配合 hexToHsl 兼容 8 位。
  const hexMatches = html.match(/#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?/g) || [];

  let colorViolations = 0;
  for (const raw of hexMatches) {
    const hsl = hexToHsl(raw);
    if (!hsl) continue;
    // 灰度色、纯黑、近白直接放行
    if (hsl.s < 0.12 || hsl.l < 0.08 || hsl.l > 0.93) continue;
    const low = (raw.startsWith('#') ? raw.slice(0, 7) : '#' + raw.slice(0, 6)).toLowerCase();
    if (NEUTRAL_HEX_WHITELIST.includes(low)) continue;
    // 参考撞色板 / 标题色 / 正文色 / 描边色：用户明确上传的风格，不计入越权信号，
    // 避免参考多色页被误判为越权而反复触发终局重放。
    if (allowedAccentHexes && allowedAccentHexes.has(low)) continue;
    if (expected && hueDeltaDeg(hsl.h, expected.h) <= 30) continue;
    colorViolations++;
  }
  const total = neutralFont22_29 + neutralPxSticky + colorViolations;
  return { neutralFont22_29, neutralPxSticky, colorViolations, total };
}

/** 向后兼容：旧调用点将 breakdown.total 作为 number 返回 */
export function styleViolationSignalLegacy(
  html: string,
  expectedPrimary: string = '#2563eb',
): number {
  return styleViolationSignal(html, expectedPrimary).total;
}

export interface StyleViolationSamples {
  fontMatches: string[];
  pxStickyMatches: Array<{ snippet: string; sticky: string }>;
  colorCounts: Record<string, number>;
}

export function collectStyleViolationSamples(
  html: string,
  breakdown: StyleViolationBreakdown,
  maxSamples = 5,
): StyleViolationSamples {
  const fontMatches = (html.match(/font-size:\s*2[2-9]px/g) || []).slice(0, maxSamples);

  // px-sticky: 按 countPxSticky 的扫描逻辑，记录每个命中片段 + sticky 字
  const pxStickyMatches: StyleViolationSamples['pxStickyMatches'] = [];
  {
    const re = /\d+px/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      const endIdx = m.index + m[0].length;
      let i = endIdx;
      while (i < html.length && /\s/.test(html[i])) i++;
      if (i >= html.length) continue;
      const ch = html[i];
      if (';"\')]>},`'.includes(ch)) continue;
      if (/[A-Za-z-]/.test(ch)) {
        const from = Math.max(0, m.index - 10);
        const to = Math.min(html.length, i + 11);
        pxStickyMatches.push({ snippet: html.slice(from, to), sticky: m[0] + ch });
        if (pxStickyMatches.length >= maxSamples) break;
      }
    }
  }

  // color 聚合计数（按实际 6 位 hex）
  const colorCounts: Record<string, number> = {};
  {
    const hexMatches = html.match(/#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?/g) || [];
    for (const raw of hexMatches) {
      const norm = (raw.startsWith('#') ? raw.slice(0, 7) : '#' + raw.slice(0, 6)).toLowerCase();
      colorCounts[norm] = (colorCounts[norm] || 0) + 1;
    }
  }

  if (breakdown.colorViolations > 0 && Object.keys(colorCounts).length > maxSamples * 2) {
    // 只返回前 20 条聚合，避免 samples 过长
    const top = Object.entries(colorCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20);
    return {
      fontMatches,
      pxStickyMatches,
      colorCounts: Object.fromEntries(top),
    };
  }

  return { fontMatches, pxStickyMatches, colorCounts };
}

export function formatStyleViolationSamplesSummary(
  expectedPrimary: string,
  samples: StyleViolationSamples,
): string {
  const colorPart = Object.entries(samples.colorCounts)
    .slice(0, 10)
    .map(([hex, n]) => `${hex}×${n}`)
    .join(', ');
  const stickyPart = samples.pxStickyMatches.map((m) => `${m.sticky}`).join(', ');
  const fontPart = samples.fontMatches.join(', ');
  return (
    `[expectedPrimary=${expectedPrimary}] ` +
    `font=[${fontPart || '-'}] sticky=[${stickyPart || '-'}] colors=[${colorPart || '-'}]`
  );
}

/**
 * 检测「黑块标题」fatal 信号：渐变文字声明顺序错误导致深色渐变铺满盒子 + 文字透明。
 *
 * 命中条件（针对任意带 style 的元素）：
 *   - 含 `-webkit-text-fill-color:transparent`（文字设为透明，意图裁剪填充）
 *   - 且存在 `background-clip:text`（本应裁剪到文字）
 *   - 但 `background:` 简写出现在 clip 声明**之后** → 简写把 clip 重置为 border-box，
 *     实际整块被深色渐变填充、文字不可见（参考克隆封面页现场 pres_mtrcm1nx 的根因）。
 *
 * 该函数与 core 的 isEffectiveClipText 同源判定，供终局重生成信号复用。
 */
export function detectBlackBlockTitle(html: string): boolean {
  const re = /style="([^"]*)"/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const style = m[1];
    if (!/-webkit-text-fill-color\s*:\s*transparent/i.test(style)) continue;
    const clipMatch = /(?:-webkit-)?background-clip\s*:\s*text/i.exec(style);
    if (!clipMatch) continue;
    const afterClip = style.slice(clipMatch.index);
    if (/(^|;)\s*background\s*:/i.test(afterClip)) return true;
  }
  return false;
}
