/**
 * 出片前视觉门禁 —— 纯字符串审计，可在任意包的 vitest 中直接断言。
 *
 * 与 `scripts/qa-slides-visual-gate.cjs` 互补：本模块负责「无需浏览器即可拦截」
 * 的结构硬指标（几何越界 / 字号阶梯 / 硬编码编号 / 非派生色 / 字数与内容量下限 / 视觉手段），
 * 脚本负责真实渲染下基于 getBoundingClientRect 的可见覆盖率、重叠与越界复核。
 * 复用 `measureVisualDensity`，不重复实现同类度量。
 */

import { measureVisualDensity } from '../agents/html-presentation/deck/visual-density';

export interface VisualAuditLimits {
  width: number;
  height: number;
  maxFontSizeTiers: number;
  minChineseChars: number;
  maxChineseChars: number;
  minContentNodes: number;
  minVisualElementKinds: number;
  footerBottom: number;
}

export const VISUAL_AUDIT_LIMITS: Readonly<VisualAuditLimits> = Object.freeze({
  width: 1280,
  height: 720,
  maxFontSizeTiers: 4,
  minChineseChars: 80,
  // 新预算为 5-6 条 × 18-32 字，叠加标题与页脚结论条后约 150 字；
  // 旧 120 上限会把「按新预算生成的充实页面」误判为文字超限。
  maxChineseChars: 180,
  // `data-deck-node-id` 只落在文本节点上（shape 由浏览器门禁的
  // visibleContentElements 统计），因此纯字符串侧按「标题 + 要点」的实际数量设 6。
  minContentNodes: 6,
  minVisualElementKinds: 2,
  footerBottom: 700,
});

/** 封面 / 封底信息量天然低于内容页，按页型分档，避免一刀切误伤。 */
export const VISUAL_AUDIT_PAGE_LIMITS: Record<string, Partial<VisualAuditLimits>> = {
  cover: { minChineseChars: 40, minContentNodes: 6 },
  summary: { minChineseChars: 60, minContentNodes: 6 },
};

/** 中性灰阶与画布底色，不属于「非派生装饰色」违规。 */
const NEUTRAL_HEX = new Set([
  '#0f172a', '#1f2937', '#374151', '#475569', '#6b7280', '#94a3b8', '#9ca3af',
  '#e5e7eb', '#d1d5db', '#f3f4f6', '#f9fafb', '#ffffff', '#000000', '#111827',
]);

export type VisualAuditCode =
  | 'geometry_outside'
  | 'font_size_tiers'
  | 'hardcoded_badge'
  | 'foreign_hex'
  | 'footer_duplicates_body'
  | 'text_budget'
  | 'text_below_min'
  | 'content_nodes_below_min'
  | 'visual_elements_below_min';

export interface VisualAuditIssue {
  code: VisualAuditCode;
  detail: string;
}

export interface VisualAuditResult {
  issues: VisualAuditIssue[];
  fontSizes: number[];
  rectCount: number;
  outsideCount: number;
  chineseChars: number;
  hexColors: string[];
  contentNodes: number;
  visualElementKinds: string[];
}

export interface VisualAuditOptions {
  /** deck 级统一主色；提供后才启用「非派生 hex」检查。 */
  primary?: string;
  /** 额外放行的 hex（如主色加深变体）。 */
  allowedHex?: readonly string[];
  /** 页型，用于分档下限。 */
  pageType?: string;
  width?: number;
  height?: number;
  maxFontSizeTiers?: number;
  minChineseChars?: number;
  maxChineseChars?: number;
  minContentNodes?: number;
  minVisualElementKinds?: number;
  /** 显式关闭密度下限（仅用于「只验结构缺陷」的历史用例）。 */
  skipDensityChecks?: boolean;
}

const RECT_RE = /position:absolute;left:(-?\d+)px;top:(-?\d+)px;width:(\d+)px;height:(\d+)px/g;

/** 带 data-deck-node-id 的元素即一个内容节点；装饰层不含该属性。 */
function countContentNodes(html: string): number {
  return (html.match(/data-deck-node-id=/g) ?? []).length;
}

/**
 * 页脚条只允许「NN / MM」页码与进度轨；出现汉字即说明复述了正文。
 * 页脚内部只有 strong/span、不含 div，因此非贪婪截到自身 `</div>` 即可；
 * 不能截到 HTML 末尾——`content-compare` 的列内容会在页脚之后另行渲染。
 */
function footerChineseChars(html: string): number {
  const match = html.match(/data-deck-node-id="[^"]*deco-footer"[^>]*>([\s\S]*?)<\/div>/);
  if (!match) return 0;
  const text = match[1].replace(/<[^>]*>/g, '');
  return (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
}

/** 非纯文字的视觉手段种类，用来区分「文字堆砌」与「有图示的充实页面」。 */
function collectVisualElementKinds(html: string, density: ReturnType<typeof measureVisualDensity>): string[] {
  const kinds: string[] = [];
  if (density.svgElements > 0) kinds.push('svg');
  if (density.tables > 0) kinds.push('table');
  if (density.boxShadows > 0) kinds.push('shadow');
  if (density.linearGradients + density.radialGradients > 0) kinds.push('gradient');
  if (/data-decoration=|noppt-visual-backdrop|noppt-deco-/.test(html)) kinds.push('decoration');
  if (/data-role="(?:badge|kpi|metric|progress|timeline|callout|quote|heat-cell|step)"/.test(html)) {
    kinds.push('semantic-block');
  }
  return kinds;
}

type NumericAuditLimitKey = Exclude<keyof VisualAuditLimits, 'width' | 'height' | 'footerBottom'>;

function limit(
  options: VisualAuditOptions,
  key: NumericAuditLimitKey,
  overrides: Partial<VisualAuditLimits>,
): number {
  return Number(options[key] ?? overrides[key] ?? VISUAL_AUDIT_LIMITS[key]);
}

export function auditSlideHtml(
  html: string,
  options: VisualAuditOptions = {},
): VisualAuditResult {
  const W = options.width ?? VISUAL_AUDIT_LIMITS.width;
  const H = options.height ?? VISUAL_AUDIT_LIMITS.height;
  const overrides = options.pageType ? VISUAL_AUDIT_PAGE_LIMITS[options.pageType] ?? {} : {};
  const issues: VisualAuditIssue[] = [];
  let outsideCount = 0;
  let rectCount = 0;

  for (const match of html.matchAll(RECT_RE)) {
    rectCount += 1;
    const [, l, t, w, h] = match;
    const left = Number(l);
    const top = Number(t);
    const right = left + Number(w);
    const bottom = top + Number(h);
    if (left < 0 || top < 0 || right > W + 1 || bottom > H + 1) {
      outsideCount += 1;
      if (outsideCount <= 5) {
        issues.push({
          code: 'geometry_outside',
          detail: `rect(${left},${top},${right},${bottom}) exceeds ${W}x${H}`,
        });
      }
    }
  }
  if (outsideCount > 5) {
    issues.push({ code: 'geometry_outside', detail: `...and ${outsideCount - 5} more` });
  }

  const density = measureVisualDensity(html);
  const maxTiers = limit(options, 'maxFontSizeTiers', overrides);
  if (density.fontSizes.length > maxTiers) {
    issues.push({ code: 'font_size_tiers', detail: density.fontSizes.join(',') });
  }

  if (html.includes('noppt-visual-backdrop') && />\s*01\s*</.test(html)) {
    issues.push({ code: 'hardcoded_badge', detail: 'backdrop contains hardcoded 01 badge' });
  }

  const footerChars = footerChineseChars(html);
  if (footerChars > 0) {
    issues.push({
      code: 'footer_duplicates_body',
      detail: `${footerChars} Chinese chars in footer (body text repetition)`,
    });
  }

  if (options.primary) {
    const allowed = new Set<string>([
      ...NEUTRAL_HEX,
      options.primary.toLowerCase(),
      ...(options.allowedHex ?? []).map((c) => c.toLowerCase()),
    ]);
    const foreign = density.hexColors.filter((c) => !allowed.has(c));
    if (foreign.length > 0) {
      issues.push({ code: 'foreign_hex', detail: foreign.join(',') });
    }
  }

  const contentNodes = countContentNodes(html);
  const visualElementKinds = collectVisualElementKinds(html, density);

  const maxChars = limit(options, 'maxChineseChars', overrides);
  if (density.chineseChars > maxChars) {
    issues.push({ code: 'text_budget', detail: `${density.chineseChars} > ${maxChars}` });
  }

  if (!options.skipDensityChecks) {
    const minChars = limit(options, 'minChineseChars', overrides);
    const minNodes = limit(options, 'minContentNodes', overrides);
    const minKinds = limit(options, 'minVisualElementKinds', overrides);
    if (density.chineseChars < minChars) {
      issues.push({ code: 'text_below_min', detail: `${density.chineseChars} < ${minChars}` });
    }
    if (contentNodes < minNodes) {
      issues.push({ code: 'content_nodes_below_min', detail: `${contentNodes} < ${minNodes}` });
    }
    if (visualElementKinds.length < minKinds) {
      issues.push({
        code: 'visual_elements_below_min',
        detail: `${visualElementKinds.join(',') || 'none'} < ${minKinds}`,
      });
    }
  }

  return {
    issues,
    fontSizes: density.fontSizes,
    rectCount,
    outsideCount,
    chineseChars: density.chineseChars,
    hexColors: density.hexColors,
    contentNodes,
    visualElementKinds,
  };
}
