// 8pt 网格归一化纯工具函数
//
// 从 html-presentation-agent.ts 抽出可独立测试的逻辑。
// 修复点：enforce8ptGrid 在 normalize 时必须保留 style 分隔符
// （分号 / 属性值末尾），避免产生 "64pxdisplay" 这种 pxSticky
// 伪阳性，错误触发 fallback。
//
// 说明：本模块所有函数均作用于 style body（即 style="..." 引号内部文本）
// 或完整 HTML 的标签 style 属性；正则中不包含引号字符，避免 TS/ESBuild
// 转义歧义。

/**
 * 归整到 8pt 网格（就近取整），但**不做单向放大**。
 *
 * 旧实现 `Math.max(8, Math.round(v / 8) * 8)` 有两个系统性放大缺陷：
 *   ① `Math.max(8, …)` 把 4px 这类紧凑内边距强行抬到 8px（徽章/紧凑卡片被撑大）；
 *   ② `Math.round` 对 `.5` 一律进位，于是 12→16、20→24、28→32，
 *      凡是「半步长」值都被 +4，卡片总高被逐层累加放大后溢出 1280×720 画布
 *      （pres_mu7skl55_0cmg3m7 slide-03 遮挡的放大因素之一）。
 *
 * 新规则：
 *   - `v <= 0`：原样返回（0 / auto 等）；
 *   - `v < 8`：保留原值（小间距不再被抬到 8px）；
 *   - 其余：就近取整，恰好半步长（`v % 8 === 4`，如 12/20/28）统一**向下**取；
 *   - 因此单次归整的最大增量为 3px（仅当余数 > 4 时），不会再出现 +4 的系统性放大。
 *
 * 例：19->16, 14->16, 4->4, 12->8, 20->16, 28->24, 30->32, 48->48
 */
export function roundTo8(v: number): number {
  if (v <= 0) return v;
  if (v < 8) return v;
  const r = v % 8;
  if (r === 0) return v;
  // r === 4 恰好半步长 → 与 r < 4 同样向下取（12→8 / 20→16 / 28→24）
  return r <= 4 ? v - r : v + (8 - r);
}

/** 对 margin / padding / gap 的值 token 做 8 倍数归一（就近取整，不单向放大）。
 *  auto / 0 / 非 px / 小于 8px 的值原样返回。 */
export function normGridTokens(valsRaw: string): string {
  return valsRaw
    .trim()
    .split(/\s+/)
    .map((tk) => {
      const mm = /^(\d+)(\.\d+)?px$/i.exec(tk);
      if (!mm) return tk;
      const v = parseFloat(mm[0]);
      if (v <= 0) return tk;
      return `${roundTo8(v)}px`;
    })
    .join(' ');
}

// 正则：margin / padding 系列。注：无引号。
const SP_PROP_RE = /((?:margin|padding)(?:-top|-right|-bottom|-left)?)\s*:\s*([^;]*?)(;|$)/gi;
// 正则：gap。注：无引号。
const SP_GAP_RE = /\bgap\s*:\s*([^;]*?)(;|$)/gi;

/** 对一段 CSS styleBody 执行间距值归一化（margin / padding / gap 三类），
 * 同时严格保留末尾原有的分号（或结尾空），避免丢失分号导致
 * "64pxdisplay:flex" 这种缺分号粘接。
 *
 * 典型：
 *   入  "padding:48px 64px;display:flex"
 *   出  "padding:48px 64px;display:flex" （保留分号）
 */
export function normalizeSpacing8ptStyleBody(styleBody: string): string {
  return styleBody
    .replace(SP_PROP_RE, (_m, prop, valsRaw, sep) => `${prop}:${normGridTokens(valsRaw)}${sep}`)
    .replace(SP_GAP_RE, (_m, valsRaw, sep) => `gap:${normGridTokens(valsRaw)}${sep}`);
}

// 归一化扫描：只处理这些标签的 style 属性。
const TAGS_RE_TOKENS = '(?:div|p|li|h[1-6]|ul|ol|span|img|section|article|table|td|th|button)';

/** 跳过谓词：返回 true 时该处 style 跳过 8pt 归一化（保持原值，且 assertSpacing8pt 不计入 violations）。
 * 业务无关的 grid 工具只认「标签名 + style 串 + 在原文中的偏移」，由调用方按自身语义判定是否豁免。 */
export type SpacingSkipPredicate = (ctx: {
  tag: string;
  styleBody: string;
  offset: number;
}) => boolean;

// 从捕获组 pre（`<tag ...style="`）提取标签名，供跳过谓词判定。
function spacingMatchTag(pre: string): string {
  return (pre.match(/^<([a-z0-9]+)/i) || [])[1] || '';
}

/** 归一化 HTML 中布局标签 style。若 style 无变动，则原属性串保持不变。
 *  @param shouldSkip 可选跳过谓词；命中时该处 style 原样保留（向后兼容：不传则行为不变）。 */
export function normalizeSpacing8pt(html: string, shouldSkip?: SpacingSkipPredicate): string {
  const re = new RegExp(`(<${TAGS_RE_TOKENS}[^>]*style=")([^"]*?)(")`, 'gi');
  return html.replace(re, (full, pre, styleBody, quote, offset) => {
    if (shouldSkip && shouldSkip({ tag: spacingMatchTag(pre), styleBody, offset })) return full;
    const next = normalizeSpacing8ptStyleBody(styleBody);
    if (next === styleBody) return full;
    return `${pre}${next}${quote}`;
  });
}

/** 与 normalizeSpacing8pt 相同 normalize 逻辑，但额外收集被改过的
 *  spacing 属性名列表（用于 assertGrid8pt 末尾 warn）。
 *  @param shouldSkip 可选跳过谓词；命中时该处 style 原样保留，且不计 violations（避免豁免引发无意义告警）。 */
export function assertSpacing8pt(
  html: string,
  shouldSkip?: SpacingSkipPredicate,
): { html: string; violations: string[] } {
  const allViolations: string[] = [];
  const re = new RegExp(`(<${TAGS_RE_TOKENS}[^>]*style=")([^"]*?)(")`, 'gi');
  const out = html.replace(
    re,
    (full: string, pre: string, styleBody: string, quote: string, offset: number) => {
      if (shouldSkip && shouldSkip({ tag: spacingMatchTag(pre), styleBody, offset })) return full;
      let next: string = styleBody;
      let changed = false;
      next = next.replace(SP_PROP_RE, (_m: string, prop: string, valsRaw: string, sep: string) => {
        const normed = normGridTokens(valsRaw);
        if (normed !== valsRaw.trim()) {
          allViolations.push(`${prop}:${valsRaw.trim()}`);
          changed = true;
        }
        return `${prop}:${normed}${sep}`;
      });
      next = next.replace(SP_GAP_RE, (_m: string, valsRaw: string, sep: string) => {
        const normed = normGridTokens(valsRaw);
        if (normed !== valsRaw.trim()) {
          allViolations.push(`gap:${valsRaw.trim()}`);
          changed = true;
        }
        return `gap:${normed}${sep}`;
      });
      if (!changed) return full;
      return `${pre}${next}${quote}`;
    },
  );
  return { html: out, violations: allViolations };
}
