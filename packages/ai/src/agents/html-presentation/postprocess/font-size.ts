/**
 * PostProcess 簇B：正文字号硬 Clamp + 8pt 网格归一（从 html-presentation-agent.ts 外置）。
 * 依赖：BODY_FONT_SIZE_* 常量来自 ../constants；normalizeSpacing8pt/assertSpacing8pt/SpacingSkipPredicate 来自 ../../../utils/grid-8pt。
 */
import {
  BODY_FONT_SIZE_MIN,
  BODY_FONT_SIZE_MAX,
  BODY_FONT_SIZE_EXEMPT_TAGS,
  BODY_FONT_SIZE_EXEMPT_CLASS_KEYWORDS,
  BODY_CLAMP_TAGS,
} from '../constants';
import { normalizeSpacing8pt, assertSpacing8pt } from '../../../utils/grid-8pt';
import type { SpacingSkipPredicate } from '../../../utils/grid-8pt';

export function isHeadingExempt(attrs: string): boolean {
  if (!attrs) return false;
  if (/\brole\s*=\s*(['"])heading\1/i.test(attrs)) return true;
  const clsMatch = attrs.match(/\bclass\s*=\s*(['"])([^'"]*)\1/i);
  if (!clsMatch) return false;
  const classes = clsMatch[2].toLowerCase();
  for (const kw of BODY_FONT_SIZE_EXEMPT_CLASS_KEYWORDS) {
    if (classes.includes(kw.toLowerCase())) return true;
  }
  return false;
}

/**
 * 判断给定 styleBody + 原值 px + tagName 是否满足「metric 大字豁免」。
 * 设计针对 content-stats-highlight 等 56px 数值徽章，规则刻意保守，避免误伤正文。
 *
 * 命中任一组合即豁免：
 *  (a) fw>=800 AND lh==1 AND px>=36（典型 metric 大字特征齐全）
 *  (b) pointer-events:none AND px>=36（纯视觉装饰数字）
 *  (c) color 中性深色 AND fw>=800 AND px>=48（内容密集页的大号数值）
 */
export function isMetricExempt(styleBody: string, upper: string, fontSizePx: number): boolean {
  if (upper !== 'SPAN' && upper !== 'DIV' && upper !== 'P') return false;
  if (!Number.isFinite(fontSizePx) || fontSizePx < 36) return false;
  const body = styleBody.toLowerCase();
  // (a)
  const fw800 = /font-weight\s*:\s*(?:800|900|bold|extra-bold|extrabold|black)/i.test(styleBody);
  const lh1 =
    /line-height\s*:\s*1(?:\.0+)?(?:px)?\s*;?\s*$/.test(body) ||
    /line-height\s*:\s*1(?:\.0+)?\s*(?:;|$)/.test(body);
  if (fw800 && lh1 && fontSizePx >= 36) return true;
  // (b)
  if (/pointer-events\s*:\s*none/i.test(styleBody) && fontSizePx >= 36) return true;
  // (c) 中性色（#000 / #111827 / #1F2937 / #374151 / #4B5563 / #6B7280 等）+ 粗体
  const neutralColor =
    /color\s*:\s*(?:#000000\b|#000\b|#111827\b|#1F2937\b|#374151\b|#4B5563\b|#6B7280\b|#111\b|#222\b|#333\b|rgba?\(\s*0\s*,\s*0\s*,\s*0\b|black\b|#1e293b\b|#0f172a\b)/i.test(
      styleBody,
    );
  if (neutralColor && fw800 && fontSizePx >= 48) return true;
  return false;
}

/**
 * 对单个 style 属性体做 font-size 硬 clamp [MIN, MAX]，
 * 仅对单位为 px 的声明生效（rem/em/% → 交给上层）。
 *
 * 【2025-07 修复 R1：Heading / Metric 大字豁免】
 * 在 clamp 前先判断：
 *  - tagName ∈ BODY_FONT_SIZE_EXEMPT_TAGS → 豁免
 *  - 命中 isHeadingExempt(attrs) → 豁免
 *  - 命中 isMetricExempt（大字徽章）→ 豁免
 *  豁免后原值不动；否则按 [MIN, MAX] clamp。
 *
 * 通过 modifiedRef 聚合修改计数与前 5 条样例，用于 console 日志。
 */
export function clampStyleFontSize(
  styleBody: string,
  tagHint: string,
  modifiedRef: { count: number; samples: string[] },
  extraAttrs?: string,
): string {
  const fontSizeRegex = /(font-size\s*:\s*)(-?\d+(?:\.\d+)?)(px|rem|em|%)/gi;
  return styleBody.replace(fontSizeRegex, (full, fsKey: string, vStr: string, unit: string) => {
    if (unit !== 'px') return full;
    const v = Number(vStr);
    if (!Number.isFinite(v)) return full;

    // Heading 标签级豁免（H1-H6 属于 EXEMPT）
    if (BODY_FONT_SIZE_EXEMPT_TAGS.has(tagHint)) return full;
    // Heading 语义级豁免（role=heading / hero-title / page-title 等）
    if (extraAttrs && isHeadingExempt(extraAttrs)) return full;
    // Metric 大字豁免（数值徽章类 span/div/p，详见 isMetricExempt）
    if (isMetricExempt(styleBody, tagHint, v)) return full;

    let clamped: number | null = null;
    if (v > BODY_FONT_SIZE_MAX) clamped = BODY_FONT_SIZE_MAX;
    else if (v < BODY_FONT_SIZE_MIN) clamped = BODY_FONT_SIZE_MIN;
    if (clamped === null) return full;
    modifiedRef.count++;
    if (modifiedRef.samples.length < 5)
      modifiedRef.samples.push(`${tagHint}:${Math.round(v)}→${clamped}`);
    return `${fsKey}${clamped}${unit}`;
  });
}

/**
 * 在任意 HTML 片段内「按标签逐个定位 style 属性」做 clamp，替代原来的 styleAttrRe 全局盲扫。
 * 正则同时捕获 <TAG_NAME ... style="...">，从而拿到真实 tagName；禁止再传 '*' 作为 tagHint。
 *
 * 注意：此函数不会进入 `<svg>/<script>/<style>/<pre>/<code>` 等原始内容区的子元素，
 * 因为内部 style 属性被正则抓到时，若外围在 SVG 中其 tagName 是合法 SVG 子元素（circle/line/path），
 * 这些标签也不在 BODY_CLAMP_TAGS 里，不会被「开标签自身」clamp；但这里的全局 inner 扫描仍可能碰到。
 * 因此我们对 SVG 子元素名集合 SVG_VOID_TAGS 也做「直接跳过」的豁免。
 */
export function clampAllStylesByTag(
  htmlFragment: string,
  modifiedRef: { count: number; samples: string[] },
): string {
  // SVG 常见子元素（非 HTML，font-size 本不应用于其上，但若 LLM 把 style 写到它们也要避免 clamp 误命中）
  const SVG_RAW_TAGS = new Set([
    'SVG',
    'PATH',
    'CIRCLE',
    'RECT',
    'LINE',
    'POLYLINE',
    'POLYGON',
    'ELLIPSE',
    'USE',
    'DEFS',
    'STOP',
    'CLIPPATH',
    'MASK',
    'PATTERN',
    'LINEARGRADIENT',
    'RADIALGRADIENT',
    'ANIMATE',
    'TEXT',
    'TSPAN',
    'IMAGE',
    'MARKER',
    'SYMBOL',
    'G',
    'TITLE',
    'DESC',
    'FE*',
    'FILTER',
  ]);
  // —— 同时对 <tagName attrs ... style="..." 做一次捕获
  const re = /<([a-zA-Z][\w:-]*)(\s+[^>]*)?\bstyle\s*=\s*(['"])([\s\S]*?)\3/gi;
  return htmlFragment.replace(
    re,
    (match, tag: string, before: string | undefined, q: string, styleBody: string) => {
      const upper = tag.toUpperCase();
      if (SVG_RAW_TAGS.has(upper) || /^FE[A-Z]/.test(upper)) return match;
      const attrsFull = `${before ?? ''} `.replace(/\s+/g, ' '); // 归一空格，便于 isHeadingExempt 抓 class/role
      const newBody = clampStyleFontSize(styleBody, upper, modifiedRef, attrsFull);
      if (newBody === styleBody) return match;
      return `<${tag}${before ?? ''}style=${q}${newBody}${q}`;
    },
  );
}

/**
 * 正文字号硬 Clamp（Task-6 FR-4 升级增强版 / 2025-07 R1 修复）：
 *
 *  算法：对 BODY_CLAMP_TAGS（li/p/div/span/a/figcaption/...）中每个完整标签块做正则扫描。
 *  命中的每个块先检查【开标签豁免】：
 *    - role="heading"（ARIA 标题）→ 整块跳过
 *    - class 含 hero-title / page-title 等 → 整块跳过
 *  未豁免：
 *    1) 对【开标签自身 style】做 clamp（tagHint=开标签真实大写名）
 *    2) 对【内部所有 style】使用 clampAllStylesByTag 逐个定位到真实子标签名做 clamp，
 *       其中 H1-H6 / heading 语义 / metric 大字 三类全部豁免，避免误夹 H2 50px / metric 56px。
 *
 *  防御深度：postProcessSlideHtml 中调用 1 次后，postProcessLayout 末尾再调用 1 次；
 *            第二次调用必须严格 idempotent（modifiedRef.count===0），否则触发 warn 提醒豁免范围需复核。
 */
export function enforceBodyFontSize(html: string, options?: { round?: 1 | 2 }): string {
  if (!html) return html;
  const modifiedRef = { count: 0, samples: [] as string[] };
  let result = html;

  // 决策 4（回归修复）：封面页 h1 之后、font-size ≥ 24px 的副标题 <p> 豁免 clamp，
  // 保留封面海报标题与副标题的字号层级 / 间距，不被统一压平成正文尺寸（症状 P:32→20 / P:24→20）。
  // 仅封面页（含 <h1 且无 <h2）生效；内容页（含 h2）不受影响，正文可读性兜底保持 [16,20]。
  const isCoverPage = /<h1[^>]*>/i.test(html) && !/<h2[^>]*>/i.test(html);
  const h1CloseIdx = html.search(/<\/h1>/i);

  const tagPattern = BODY_CLAMP_TAGS.join('|');
  const blockRegex = new RegExp(`<(${tagPattern})\\b([^>]*)>([\\s\\S]*?)<\\/\\1>`, 'gi');
  const styleAttrRe = /\bstyle\s*=\s*(['"])([\s\S]*?)\1/gi;

  result = result.replace(
    blockRegex,
    (m, tag: string, attrs: string, inner: string, offset: number) => {
      const upper = tag.toUpperCase();
      // BODY_CLAMP_TAGS 不含 H1-6，但作为兜底仍保留判断
      if (BODY_FONT_SIZE_EXEMPT_TAGS.has(upper) || isHeadingExempt(attrs)) return m;
      // 决策 4（续）：封面容器整体保留。blockRegex 惰性匹配只会选中外层容器（如最外层 div），
      // 嵌套的副标题 <p> 不会被顶层匹配，会经由 clampAllStylesByTag(inner) 被误夹到 20px ——
      // 既压平封面字号层级，又使后续 8pt 间距豁免（依赖 font-size ≥ 24px）失效、把封面间距规整。
      // 故对「含 h1 的封面容器」整块 return m，保留 LLM 设定的封面海报字号与间距。
      if (isCoverPage && /<h1[^>]*>/i.test(inner)) return m;
      // 决策 4：封面副标题豁免（h1 之后、font-size ≥ 24px 的 p 整块保留，含 inner，不 clamp）
      if (isCoverPage && upper === 'P' && h1CloseIdx >= 0 && offset >= h1CloseIdx) {
        const fs = parseFloat(
          (attrs.match(/font-size\s*:\s*(\d+(?:\.\d+)?)px/i) || [])[1] || '0',
        );
        if (fs >= 24) return m;
      }
      // 1) 开标签自身 attrs 中的 style → clamp（传真实 tagHint 与 attrs，启用 heading/metric 豁免）
      const newAttrs = attrs.replace(styleAttrRe, (_sm, q: string, body: string) => {
        return `style=${q}${clampStyleFontSize(body, upper, modifiedRef, attrs)}${q}`;
      });
      // 2) 内部所有 style：逐个定位到所属子标签名 clamp（不再传 '*'，修复 R1）
      const newInner = clampAllStylesByTag(inner, modifiedRef);
      if (newAttrs === attrs && newInner === inner) return m;
      return `<${tag}${newAttrs}>${newInner}</${tag}>`;
    },
  );

  if (modifiedRef.count > 0) {
    const round = options?.round ?? 1;
    if (round === 2) {
      console.warn(
        `[POST][enforceBodyFontSize:round2] 二次兜底仍修改 ${modifiedRef.count} 处字号声明（说明豁免范围或第一轮调用位置异常，需复核）。示例：${modifiedRef.samples.join('; ')}${modifiedRef.count > modifiedRef.samples.length ? '; ...' : ''}`,
      );
    } else {
      console.warn(
        `[POST][enforceBodyFontSize:round1] Clamp 修正 ${modifiedRef.count} 处字号声明 [${BODY_FONT_SIZE_MIN}, ${BODY_FONT_SIZE_MAX}]px。示例：${modifiedRef.samples.join('; ')}${modifiedRef.count > modifiedRef.samples.length ? '; ...' : ''}`,
      );
    }
  }
  return result;
}

// 8pt 网格归一：margin / padding / gap 各值 → 最近 8 倍数（最小 8）。
// 真实实现位于 ../utils/grid-8pt.ts（可独立测试，避免丢失 style 分号 Bug）。
export function enforce8ptGrid(html: string): string {
  // 决策 4 间距豁免：封面页 h1 之后、font-size ≥ 24px 的副标题 p 跳过 8pt 规整，保留封面排版间距。
  const skip = buildCoverSubtitleSpacingSkip(html);
  return normalizeSpacing8pt(html, skip);
}

/** 8pt 网格兜底自检：整条后处理链末尾运行；若 style 内 margin/padding/gap 仍发现非 8 倍数，
 *  console.warn 并自动规整，无违规则返回原串。作为最终防线修复前面步骤引入的间距。
 *  同样接入决策 4 间距豁免谓词：Step6 写入的封面副标题 margin 由本函数在链末规整，必须同步跳过。 */
export function assertGrid8pt(html: string): string {
  const skip = buildCoverSubtitleSpacingSkip(html);
  const res = assertSpacing8pt(html, skip);
  if (res.violations.length) {
    console.warn('[POST] 8pt 规整兜底: 发现非 8 倍数间距并自动规整:', res.violations);
    return res.html;
  }
  return html;
}

/** 决策 4 间距豁免谓词：封面页（含 h1 且无 h2）+ h1 闭合之后 + font-size ≥ 24px 的 <p>。
 * 条件与 enforceBodyFontSize 现有字号豁免严格一致，避免两处豁免标准漂移；非封面页恒返回 false（内容页正文间距仍正常规整）。
 * 仅用于 8pt 网格归一（enforce8ptGrid / assertGrid8pt），保留封面海报副标题 margin/padding 不被规整。
 * 非 px 单位（rem/em/%）一律按 <24px 处理，不豁免，避免误判。 */
export function buildCoverSubtitleSpacingSkip(html: string): SpacingSkipPredicate {
  const isCoverPage = /<h1[^>]*>/i.test(html) && !/<h2[^>]*>/i.test(html);
  const h1CloseIdx = html.search(/<\/h1>/i);
  if (!isCoverPage || h1CloseIdx < 0) return () => false;
  return (ctx) => {
    if (ctx.tag.toUpperCase() !== 'P') return false;
    if (ctx.offset < h1CloseIdx) return false;
    const fs = parseFloat(
      (ctx.styleBody.match(/font-size\s*:\s*(\d+(?:\.\d+)?)px/i) || [])[1] || '0',
    );
    return fs >= 24;
  };
}

/**
 * 修复 row 布局图片容器的垂直 margin：content-image-left/right 的图片容器为 flex:0 0 45%/55%，
 * 不该有 margin-top/margin-bottom（父容器用 gap 控制两列水平间距）。content-image-top 是 column
 * 布局（flex:0 0 33%/40%），其 margin-bottom 保留。
 */
