import type { AIModelProvider } from '../providers/base';
import { formatBeijingTime, formatDuration } from '../providers/base';
import type { TraceableProvider } from '../providers/base';
import { setSessionStage, openTraceSession, closeTraceSession } from '../utils/llm-tracer';
import type {
  ChatMessage,
  PresentationPlan,
  SlidePlan,
  SlidePageType,
  ImageRatio,
  ImageSize,
  ContentDensity,
  ImagePreference,
  ColorTheme,
  IconStyle,
  StyleTheme,
  PresentationGenerationOptions,
  GenerationCallback,
  ImageModelRoutingConfig,
  ImageRouteScene,
  DesignProposal,
  RenderedSlide,
  ReferenceVisualAttributes,
  ReferenceContext,
  ReferenceMaster,
  ReferencePageHints,
  PageCategory,
  SlideColorPolicy,
} from '../types';
import {
  PRESENTATION_PLANNING_PROMPT,
  SLIDE_HTML_GENERATION_PROMPT,
  HTML_SLIDE_MODIFICATION_PROMPT,
  HTML_GLOBAL_MODIFICATION_PROMPT,
  getPageTemplatesByPageType,
  BACKGROUND_PLANNING_GUIDANCE,
} from '../templates/generate-html-presentation';
import {
  renderChartSvg,
  renderCycleSvg,
  renderDashboardSvg,
  renderArchitectureSvg,
} from '../templates/structured-graphics';
import {
  critiqueSlide,
  buildCritiqueFeedback,
  DEFAULT_THRESHOLD,
  DEFAULT_MAX_RETRIES,
  type SlideCritique,
} from '../templates/slide-critique';
import { parseModelName, getQualityScore, getSpeedScore } from '../utils/model-name-parser';
import { extractReferenceHtmlAttributes } from '../utils/reference-html-extractor';
import {
  formatReferenceOverrideForPage,
  formatReferenceOverrideOverview,
  getReferenceSnippetForPage,
  getReferenceColorPolicyForPage,
  getReferenceSnippetOverview,
  getReferenceColorPolicyOverview,
  computePageIndexInCategory,
  getReferenceLayoutDiversityHint,
  resolveAttrForPage,
  resolveMasterForPage,
  resolveLayoutForPage,
  buildReferenceContext,
  pageTypeToCategory,
  resolveDeckReferencePrimaryColor,
  resolveReferencePrimaryColor,
  resolveReferenceComposition,
  resolveColorPolicyForPage,
  hasReferenceImage,
  resolveHeroImageForPage,
} from '../utils/reference-attribute-resolver';
import { applyMasterToSlideHtml } from '../utils/apply-master-to-slide-html';
import { l0ValidateSlide } from '../utils/l0-validation';
import {
  normalizeSpacing8pt,
  assertSpacing8pt,
  type SpacingSkipPredicate,
} from '../utils/grid-8pt';
import {
  enforceFlatStructure,
  enforceFlexChildrenMinWidth,
  enforceTextWrapping,
  enforceGridLayout,
  enforceImageStyles,
  enforceMinFontSize,
  parseStyleDeclarations,
  isCoverLikeHtml,
  isEffectiveClipText,
  fixGradientTextDeclarationOrder,
  applyCompositionGuard,
  type ReferenceComposition,
} from '@noppt/core';

function switchStage(provider: AIModelProvider, stage: string) {
  const sid = (provider as TraceableProvider).activeTraceSessionId;
  if (sid) setSessionStage(sid, stage);
}

export interface SlideElement {
  id: string;
  type:
    | 'heading'
    | 'paragraph'
    | 'list'
    | 'image'
    | 'card'
    | 'decoration'
    | 'table'
    | 'button'
    | 'other';
  tag: string;
  label: string;
  selector?: string;
}

export interface HTMLSlide {
  title: string;
  html: string;
  notes?: string;
  imagePrompt?: string;
  imageRatio?: ImageRatio;
  pageType?: SlidePageType;
  elements?: SlideElement[];
  critique?: {
    score: number;
    passed: boolean;
    attempts: number;
    issues: string[];
  };
}

export interface GenerationTiming {
  startTime: string;
  endTime: string;
  durationMs: number;
}

export interface HTMLPresentation {
  title: string;
  description?: string;
  primaryColor?: string;
  transition?: string;
  slides: HTMLSlide[];
  timing?: GenerationTiming;
  width?: number;
  height?: number;
  imagePreference?: ImagePreference;
  plan?: PresentationPlan;
  design?: DesignProposal;
}

export const IMAGE_PLACEHOLDER = 'https://NOPPT_IMAGE_PLACEHOLDER';

// ===== Task-6 FR-4：正文字号硬 Clamp 常量（集中配置，方便调参）=====
/** 正文类元素 font-size 下限（px），低于此值强制抬升 */
export const BODY_FONT_SIZE_MIN = 16;
/** 正文类元素 font-size 上限（px），高于此值强制压落到 20（左图右文卡片条上限） */
export const BODY_FONT_SIZE_MAX = 20;
/** 绝对豁免标签（H1-H6），这些标签内部的 font-size 不 clamp（H3 允许 28-30px） */
export const BODY_FONT_SIZE_EXEMPT_TAGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6']);
/** 豁免的 CSS class（部分关键词匹配即可），带这些类名的元素即使在 li/p 内部也不 clamp */
const BODY_FONT_SIZE_EXEMPT_CLASS_KEYWORDS = [
  'hero-title',
  'page-title',
  'slide-title',
  'cover-title',
] as const;
/** 正文类 clamp 生效的标签范围（扩大 scope，从原来的 li/p 扩展到常见正文容器） */
const BODY_CLAMP_TAGS = [
  'li',
  'p',
  'div',
  'span',
  'a',
  'figcaption',
  'aside',
  'td',
  'th',
  'em',
  'strong',
  'small',
  'label',
  'button',
];
// ==================================================================

export function replaceImagePlaceholderWithRealSrc(
  html: string,
  realSrc: string,
  ratio: ImageRatio,
): string {
  if (!html) return html;
  // 只匹配第一个占位 img（每张 slide 只应该有一张内容配图）
  const re =
    /<img\b([^>]*)src\s*=\s*["']\s*`?\s*https:\/\/NOPPT_IMAGE_PLACEHOLDER\s*`?\s*["']([^>]*)>/i;
  return html.replace(re, (_fullMatch, beforeAttrs: string, afterAttrs: string) => {
    const allAttrs = beforeAttrs + ' ' + afterAttrs;
    const attrs: string[] = [];
    // 收集除 src / data-image-ratio 以外的其它原有属性
    const attrRe = /([\w-:.]+)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/gi;
    let seenRatio = false;
    let ma: RegExpExecArray | null;
    while ((ma = attrRe.exec(allAttrs)) !== null) {
      const name = ma[1].trim().toLowerCase();
      if (!name || name === 'src') continue;
      if (name === 'data-image-ratio') {
        seenRatio = true;
        attrs.push(`data-image-ratio="${ratio}"`);
        continue;
      }
      const quote =
        ma[2] !== undefined ? `"${ma[2]}"` : ma[3] !== undefined ? `'${ma[3]}'` : (ma[4] ?? '');
      attrs.push(quote ? `${ma[1]}=${quote}` : ma[1]);
    }
    if (!seenRatio) attrs.push(`data-image-ratio="${ratio}"`);
    attrs.push(`src="${realSrc}"`);
    return `<img ${attrs.join(' ')}>`;
  });
}

function darkenColor(hex: string, percent: number): string {
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
function hexToHsl(hex: string): { h: number; s: number; l: number } | null {
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
function hslToHex(h: number, s: number, l: number): string {
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
function hueDelta(hex1: string, hex2: string): number {
  const a = hexToHsl(hex1);
  const b = hexToHsl(hex2);
  if (!a || !b) return 0;
  return hueDeltaDeg(a.h, b.h);
}
/** 色环上两个色相角度的最小差值（0-180）。 */
function hueDeltaDeg(h1: number, h2: number): number {
  const raw = Math.abs((h1 % 360) - (h2 % 360));
  return Math.min(raw, 360 - raw);
}

/**
 * FR-8 L-1：primary / darker 色相一致性断言（色相差 ≤ maxDelta，默认 20°）。
 * 若不通过 → 自动用 darkenColor(primary, 20%) 重算 correctedDarker，永远可直接用。
 * 返回 { pass: 是否通过, correctedDarker: 建议使用的 darker 色值, message: 人类可读诊断 }
 */
function assertHueClose(
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

const COLOR_THEMES: Record<ColorTheme | string, string> = {
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
const MAX_RETRY_PER_SLIDE = 3;
const CHANNEL_BUDGET: Record<string, number> = { critique: 1, placeholder: 1, triage: 1, audit: 1 };
type RetryEntry = { total: number; byChannel: Record<string, number> };
const retryBudget = new Map<string, Map<number, RetryEntry>>();
const keyOf = (presentationId: string | undefined): string => presentationId || 'anon';
function incRetryCount(
  key: string,
  idx: number,
  channel: string,
): { total: number; channelCount: number } {
  let pageMap = retryBudget.get(key);
  if (!pageMap) {
    pageMap = new Map<number, RetryEntry>();
    retryBudget.set(key, pageMap);
  }
  let entry = pageMap.get(idx);
  if (!entry) {
    entry = { total: 0, byChannel: {} };
    pageMap.set(idx, entry);
  }
  entry.total += 1;
  entry.byChannel[channel] = (entry.byChannel[channel] || 0) + 1;
  return { total: entry.total, channelCount: entry.byChannel[channel] };
}
export function getRetryState(key: string, idx: number): Readonly<RetryEntry> | null {
  return retryBudget.get(key)?.get(idx) ?? null;
}
function resetRetryCount(key: string): void {
  retryBudget.delete(key);
}

// ===== 主色单源解析（single-source primary color · FR-9.4 5级优先级，单一真相源）=====
// 优先级（固定，全系统唯一处定义，任何主色解析都必须经本函数）：
//   1) options.primaryColor（用户自定义 hex，最高）
//   2) options.colorTheme（用户选择的配色主题）
//   3) design.colorTheme（设计方案记录的配色主题）
//   4) design.primaryColor（规划/设计 LLM 返回的主色 hex）
//   5) fallback 参数（默认 #2563eb，仅当以上全无时）
// 供 renderSlides / generateDesignProposals / regenerateSingleSlide / finalGuard / audit 全链路调用，
// 保证与 COLOR_THEMES 表完全一致：colorTheme=orange → #ea580c 绝不因 LLM 猜值改变。
function resolveEffectivePrimaryColor(
  options?: { primaryColor?: string; colorTheme?: string } | null,
  design?: { primaryColor?: string; colorTheme?: string } | null,
  fallback: string = '#2563eb',
): string {
  // 1) 用户自定义 hex（最高）
  const userHex = options?.primaryColor;
  if (userHex && /^#[0-9a-fA-F]{6}$/.test(userHex)) return userHex.toLowerCase();
  // 2) 用户 colorTheme
  const theme = options?.colorTheme;
  if (theme && COLOR_THEMES[theme]) return (COLOR_THEMES[theme] as string).toLowerCase();
  // 3) design.colorTheme（老链路或 proposal 内部级 colorTheme）
  const dTheme = design?.colorTheme;
  if (dTheme && COLOR_THEMES[dTheme]) return (COLOR_THEMES[dTheme] as string).toLowerCase();
  // 4) design.primaryColor（LLM 规划值；作为兜底但优先级仍高于最终 fallback）
  const designHex = design?.primaryColor;
  if (designHex && /^#[0-9a-fA-F]{6}$/.test(designHex)) return designHex.toLowerCase();
  // 5) 最终 fallback（仅当 1-4 全无）
  return fallback.toLowerCase();
}

/**
 * 视觉设计方向（design-proposals）阶段的主色解析：参考 > 用户显式 > 主题 > 默认蓝。
 * 与 renderSlides / regenerateSingleSlide 的「参考优先」单源一致（html-presentation-agent.ts:2822/3241）。
 * 抽成纯函数便于单测；无参考时行为与改造前逐字节一致（refDeckPrimary 为 undefined → 原 5 级链）。
 */
export function resolveProposalPrimaryColor(opts: {
  referenceVisualAttributes?: ReferenceVisualAttributes | null;
  userColorTheme?: string;
  userPrimaryColor?: string;
}): string {
  const refDeckPrimary = resolveDeckReferencePrimaryColor(opts.referenceVisualAttributes);
  if (refDeckPrimary) return refDeckPrimary; // 参考最高优先级，覆盖用户配色主题
  if (opts.userPrimaryColor && /^#[0-9a-fA-F]{6}$/.test(opts.userPrimaryColor))
    return opts.userPrimaryColor;
  if (opts.userColorTheme && COLOR_THEMES[opts.userColorTheme])
    return COLOR_THEMES[opts.userColorTheme] as string;
  return '#2563eb';
}

const PAGE_TYPE_DEFAULT_IMAGE_RATIO: Record<SlidePageType, ImageRatio | null> = {
  cover: null,
  toc: null,
  summary: null,
  'content-image-left': '4:3',
  'content-image-right': '4:3',
  'content-image-top': '21:9', // 更宽更扁，给上图下文布局的文字留垂直空间（原图 16:9 偏高易溢出）
  'content-no-image': null,
  'content-cards': null,
  'content-compare': null,
  'content-timeline': null,
  'content-table': null,
  // ===== L1 高级版式默认图片比例 =====
  'comparison-deep-dive': null, // 无图，以文字+进度条+徽章为主
  'content-zigzag': '4:3', // Z 字三段都配图
  'content-value-showcase': null, // 纯数值大卡展示，无图
  'content-stats-highlight': null, // 指标并列展示，无图
  'content-image-background': '16:9', // 背景大图 16:9
  // ===== FR-18 §18.1 扩展（均无图）=====
  'content-flowchart': null,
  'content-org-chart': null,
  'content-pyramid': null,
  'content-matrix': null,
  'content-quote': null,
  'content-three-section': null,
  'content-process-steps': null,
  'content-icon-grid': null,
  'content-section-divider': null,
  'content-testimonial': null,
  // ===== FR-18 §18.5 扩展（图形页，均无图）=====
  'content-chart-bar': null,
  'content-chart-line': null,
  'content-chart-pie': null,
  'content-chart-donut': null,
  'content-cycle': null,
  'content-dashboard': null,
  'content-architecture': null,
};

/**
 * 上图下文（content-image-top）布局根据 keyPoints 数量动态选择更合理的图片比例：
 * 要点越多 → 图片越扁 → 给文字区腾更多垂直空间，防止溢出
 */
function defaultRatioForImageTop(keyPoints?: string[] | null): ImageRatio {
  const n = Array.isArray(keyPoints) ? keyPoints.length : 0;
  if (n >= 4) return '21:9'; // 4+ 要点：最扁，优先保证文字不溢出
  return '21:9'; // ≤3 要点也用 21:9，比旧 16:9 更安全，后续若需要可按 n=2/3 调回 16:9
}

const IMAGE_SIZE_MAPPINGS: Record<string, Record<ImageRatio, ImageSize>> = {
  seedream: {
    '1:1': '2048x2048',
    '4:3': '2304x1728',
    '3:4': '1728x2304',
    '16:9': '2848x1600',
    '9:16': '1600x2848',
    '3:2': '2496x1664',
    '2:3': '1664x2496',
    // 21:9 = 2.333，3136x1344 = 2.333（准确命中）
    '21:9': '3136x1344',
  },
  'qwen-image-2': {
    '1:1': '2048x2048',
    '4:3': '2368x1728',
    '3:4': '1728x2368',
    '16:9': '2688x1536',
    '9:16': '1536x2688',
    '3:2': '2048x2048',
    '2:3': '1728x2368',
    // 21:9 → 3136x1344（2.333），而不是 2688x1536（1.75 = 16:9）
    '21:9': '3136x1344',
  },
  'qwen-image-1': {
    '1:1': '1328x1328',
    '4:3': '1472x1104',
    '3:4': '1104x1472',
    '16:9': '1664x928',
    '9:16': '928x1664',
    '3:2': '1472x1104',
    '2:3': '1104x1472',
    // qwen-image-1 枚举内无标准 21:9 尺寸，选最宽的 1664x928（1.79）— 至少不再退回方形
    '21:9': '1664x928',
  },
  fallback: {
    '1:1': '1024x1024',
    '4:3': '1024x768',
    '3:4': '768x1024',
    '16:9': '1792x1024',
    '9:16': '1024x1792',
    '3:2': '1024x768',
    '2:3': '768x1024',
    // 21:9 → 3136x1344（2.333），而不是 1792x1024（1.75=16:9）
    '21:9': '3136x1344',
  },
};

interface PixelRange {
  minPixels: number;
  maxPixels: number;
  label?: string;
}
/**
 * 给定目标比例（如 21:9 = 2.333）+ 像素允许范围，自动算出符合比例、
 * 落在像素范围内、且 w/h 能被 ALIGN=32 整除（主流扩散模型尺寸对齐要求）的 (w, h)。
 * 选像素量最接近 range 中点的值，以保证细节。
 */
function computeAlignedSizeForRatio(
  ratio: ImageRatio,
  pixelRanges: Array<PixelRange>,
  align: number = 32,
): { width: number; height: number } | null {
  if (!pixelRanges || pixelRanges.length === 0) return null;
  const [a, b] = ratio.split(':').map(Number) as [number, number];
  if (!a || !b) return null;
  // 遍历所有 range，每个 range 计算一个候选，选最接近 range 中点的
  let best: { width: number; height: number } | null = null;
  let bestCloseness = Infinity;
  for (const range of pixelRanges) {
    const midPx = (range.minPixels + range.maxPixels) / 2;
    // 解 w/h = a/b，w*h = midPx → h = sqrt(midPx * b / a)，w = h * a / b
    let hRaw = Math.sqrt((midPx * b) / a);
    let wRaw = (hRaw * a) / b;
    // 对齐到 align 倍数（向下取整）
    let wOk = Math.floor(wRaw / align) * align;
    let hOk = Math.floor(hRaw / align) * align;
    if (wOk < align || hOk < align) continue;
    const pixels = wOk * hOk;
    if (pixels < range.minPixels || pixels > range.maxPixels) {
      // 如果超出，尝试把 wOk/hOk 各加减 ±2*align 找落在 range 内且比例最接近 a/b 的候选
      const candidates: Array<[number, number]> = [];
      for (let dw = -3 * align; dw <= 3 * align; dw += align) {
        for (let dh = -3 * align; dh <= 3 * align; dh += align) {
          const wc = wOk + dw;
          const hc = hOk + dh;
          if (wc <= 0 || hc <= 0) continue;
          const pc = wc * hc;
          if (pc >= range.minPixels && pc <= range.maxPixels) candidates.push([wc, hc]);
        }
      }
      if (candidates.length === 0) continue;
      let cBest: [number, number] = candidates[0];
      let cBestDiff = Infinity;
      for (const [wc, hc] of candidates) {
        const diff = Math.abs(wc / hc - a / b) / (a / b);
        if (diff < cBestDiff) {
          cBestDiff = diff;
          cBest = [wc, hc];
        }
      }
      [wOk, hOk] = cBest;
    }
    // 与像素中点的接近度（越小越好），归一化到 range 长度
    const closeness = Math.abs(wOk * hOk - midPx) / Math.max(1, range.maxPixels - range.minPixels);
    if (closeness < bestCloseness) {
      bestCloseness = closeness;
      best = { width: wOk, height: hOk };
    }
  }
  return best;
}

function getImageSizeForRatio(
  model: string | undefined,
  ratio: ImageRatio,
  availableSizes?: Array<{ width: number; height: number; label?: string }>,
  pixelRanges?: Array<{ minPixels: number; maxPixels: number; label?: string }>,
): ImageSize {
  const ratioMap: Record<ImageRatio, number> = {
    '1:1': 1,
    '4:3': 4 / 3,
    '3:4': 3 / 4,
    '16:9': 16 / 9,
    '9:16': 9 / 16,
    '3:2': 3 / 2,
    '2:3': 2 / 3,
    '21:9': 21 / 9,
  };
  const targetRatio = ratioMap[ratio];

  // ============== 优先方案 A：在 availableSizes（用户配置的显式尺寸）里找最匹配比例的 ==============
  if (availableSizes && availableSizes.length > 0) {
    let bestSize = availableSizes[0];
    let bestDiff = Infinity;
    for (const size of availableSizes) {
      const actualRatio = size.width / size.height;
      const diff = Math.abs(actualRatio - targetRatio) / targetRatio;
      if (diff < bestDiff) {
        bestDiff = diff;
        bestSize = size;
      }
    }
    // 比例误差 ≤30%：就用用户配置的尺寸（尊重配置，哪怕不完全对）
    if (bestDiff <= 0.3) {
      return `${bestSize.width}x${bestSize.height}` as ImageSize;
    }

    // ============== 优先方案 B：availableSizes 比例不对（全是方形），根据 pixelRanges 动态计算 ==============
    //            不再吸附回联合枚举，只要 w*h ∈ [minPixels, maxPixels] 就直接返回
    if (pixelRanges && pixelRanges.length > 0) {
      const computed = computeAlignedSizeForRatio(ratio, pixelRanges as PixelRange[]);
      if (computed && computed.width > 0 && computed.height > 0) {
        const { width, height } = computed;
        return `${width}x${height}` as ImageSize;
      }
    }
  } else {
    // availableSizes 为空：如果 pixelRanges 有值，直接按 pixelRanges 算（避免走硬编码mapping拿方形）
    if (pixelRanges && pixelRanges.length > 0) {
      const computed = computeAlignedSizeForRatio(ratio, pixelRanges as PixelRange[]);
      if (computed && computed.width > 0 && computed.height > 0) {
        const { width, height } = computed;
        return `${width}x${height}` as ImageSize;
      }
    }
  }

  // ============== 兜底方案 C：硬编码 mapping（没有配置 pixelRanges 时） ==============
  const modelLower = (model || '').toLowerCase();
  let mapping: Record<ImageRatio, ImageSize>;
  if (modelLower.includes('seedream') || modelLower.includes('doubao')) {
    mapping = IMAGE_SIZE_MAPPINGS.seedream;
  } else if (modelLower.includes('qwen-image-2') || modelLower.includes('qwen-vl-max')) {
    mapping = IMAGE_SIZE_MAPPINGS['qwen-image-2'];
  } else if (
    modelLower.includes('qwen-image') ||
    modelLower.includes('qwen-image-max') ||
    modelLower.includes('qwen-image-plus')
  ) {
    mapping = IMAGE_SIZE_MAPPINGS['qwen-image-1'];
  } else {
    mapping = IMAGE_SIZE_MAPPINGS.fallback;
  }
  return mapping[ratio] || mapping['16:9'] || '1024x1024';
}

function ratioMatchesSize(ratio: ImageRatio, width: number, height: number): boolean {
  const ratioMap: Record<ImageRatio, number> = {
    '1:1': 1,
    '4:3': 4 / 3,
    '3:4': 3 / 4,
    '16:9': 16 / 9,
    '9:16': 9 / 16,
    '3:2': 3 / 2,
    '2:3': 2 / 3,
    '21:9': 21 / 9,
  };
  const targetRatio = ratioMap[ratio];
  const actualRatio = width / height;
  return Math.abs(actualRatio - targetRatio) / targetRatio <= 0.05;
}

function getRouteScene(pageType: SlidePageType): ImageRouteScene {
  if (pageType === 'cover') return 'cover';
  if (
    [
      'toc',
      'content-cards',
      'content-compare',
      'content-timeline',
      'content-table',
      'summary',
      // FR-18 扩展（均为非配图页，归入 secondary 路由，避免误走 content 配图模型）
      'content-flowchart',
      'content-org-chart',
      'content-pyramid',
      'content-matrix',
      'content-quote',
      'content-three-section',
      'content-process-steps',
      'content-icon-grid',
      'content-section-divider',
      'content-testimonial',
      'content-chart-bar',
      'content-chart-line',
      'content-chart-pie',
      'content-chart-donut',
      'content-cycle',
      'content-dashboard',
      'content-architecture',
    ].includes(pageType)
  ) {
    return 'secondary';
  }
  return 'content';
}

interface CandidateModel {
  modelName: string;
  sizes: Array<{ width: number; height: number; label?: string }>;
  pixelRanges?: Array<{ minPixels: number; maxPixels: number; label?: string }>;
  index: number;
}

function selectImageModel(
  allModels: CandidateModel[],
  pageType: SlidePageType,
  targetRatio: ImageRatio,
  routingConfig?: ImageModelRoutingConfig,
  defaultModelName?: string,
): { modelName: string; modelIndex: number } {
  if (!routingConfig?.enabled || allModels.length === 0) {
    const fallback = allModels[0];
    return {
      modelName: fallback?.modelName || defaultModelName || '',
      modelIndex: fallback?.index || 0,
    };
  }

  const scene = getRouteScene(pageType);
  const manualIndex =
    scene === 'cover'
      ? routingConfig.coverModelIndex
      : scene === 'content'
        ? routingConfig.contentModelIndex
        : routingConfig.secondaryModelIndex;

  if (manualIndex !== undefined && manualIndex >= 0 && manualIndex < allModels.length) {
    const manual = allModels[manualIndex];
    return { modelName: manual.modelName, modelIndex: manual.index };
  }

  const candidates = allModels.filter((m) => {
    const matchingSizes = m.sizes.filter((s) => ratioMatchesSize(targetRatio, s.width, s.height));
    if (matchingSizes.length === 0) return false;
    if (m.pixelRanges && m.pixelRanges.length > 0) {
      const hasMatchingRange = matchingSizes.some((s) => {
        const pixels = s.width * s.height;
        return m.pixelRanges!.some((r) => pixels >= r.minPixels && pixels <= r.maxPixels);
      });
      if (!hasMatchingRange) return false;
    }
    return true;
  });

  const pool = candidates.length > 0 ? candidates : allModels;

  const scored = pool.map((m) => {
    const parsed = parseModelName(m.modelName);
    const quality = getQualityScore(parsed);
    const speed = getSpeedScore(parsed);
    return { model: m, quality, speed };
  });

  let sorted;
  if (scene === 'cover') {
    sorted = scored.sort((a, b) => b.quality - a.quality || a.speed - b.speed);
  } else if (scene === 'secondary') {
    sorted = scored.sort((a, b) => b.speed - a.speed || a.quality - b.quality);
  } else {
    sorted = scored.sort((a, b) => {
      const scoreA = a.quality * 0.6 + a.speed * 0.4;
      const scoreB = b.quality * 0.6 + b.speed * 0.4;
      return scoreB - scoreA;
    });
  }

  const selected = sorted[0]?.model || allModels[0];
  const parsed = parseModelName(selected.modelName);
  console.log(
    `[${formatBeijingTime()}] [ROUTING] pageType=${pageType} scene=${scene} ratio=${targetRatio} → ${selected.modelName} (quality=${getQualityScore(parsed)}, speed=${getSpeedScore(parsed)})`,
  );
  return { modelName: selected.modelName, modelIndex: selected.index };
}

const chineseNumbers: Record<string, number> = {
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
};

const parseNumber = (str: string): number => {
  if (/^\d+$/.test(str)) return parseInt(str);
  return chineseNumbers[str] || 0;
};

const extractSlideCount = (text: string): number | null => {
  const spec = extractSlideCountSpec(text);
  if (!spec) return null;
  if (spec.exact != null) return spec.exact;
  if (spec.min != null && spec.max != null) return Math.floor((spec.min + spec.max) / 2);
  return null;
};

export type SlideCountSpec =
  | { exact: number; min?: undefined; max?: undefined }
  | { min: number; max: number; exact?: undefined };

/**
 * 用户显式结构指令（优先级高于页数策略）
 */
export type PageStructureHints = {
  /** 只生成内容页 → 封面/目录/总结都不要 */
  contentOnly: boolean;
  /** 不生成封面页 */
  disableCover: boolean;
  /** 不生成目录页 */
  disableToc: boolean;
  /** 不生成总结/结束页 */
  disableConclusion: boolean;
};

/**
 * 从主题文本中提取用户显式的结构禁用指令。
 * 支持关键词包括：
 *   只生成内容页 → contentOnly=true（覆盖所有开关）
 *   不生成封面页 / 不要封面 / 跳过封面 / 不要封面页 → disableCover
 *   不生成目录页 / 不要目录 / 不要目录页 / 跳过目录 → disableToc
 *   不生成总结页 / 不要总结 / 不要结束页 / 不要总结页 / 跳过总结 / 不要结语 / 不要结尾 / 不要最后一页 → disableConclusion
 */
export const extractPageStructureHints = (text: string): PageStructureHints => {
  const t = (text || '').toString();
  // 分布式列举句式：单个"不要"统摄一个短句（以句号/感叹号/问号/分号/换行截断），
  // 句中同时出现 封面 / 目录 / (总结|结束) 三个词，例如"不要封面、目录和总结页"。
  // 在 25 字窗口内三者同时出现才判定，保守避免误伤。
  const noNavMatch = t.match(/不要([^。！？\n；;]{0,25})/);
  const noNavList =
    !!noNavMatch &&
    /封面/.test(noNavMatch[1]) &&
    /目录/.test(noNavMatch[1]) &&
    /(总结|结束)/.test(noNavMatch[1]);
  const hints: PageStructureHints = {
    contentOnly:
      /只生成内容页|只要内容页|只做内容页|只保留内容页|仅内容页|纯内容页|不要封面不要总结不要目录|全部内容页/.test(
        t,
      ) || noNavList,
    disableCover:
      /不生成封面页|不要封面页|不要封面|跳过封面|不做封面|无封面页|去掉封面|删去封面|不用封面|去除封面/.test(
        t,
      ),
    disableToc:
      /不生成目录页|不要目录页|不要目录|跳过目录|不做目录|无目录页|去掉目录|删去目录|不用目录|去除目录/.test(
        t,
      ),
    disableConclusion:
      /不生成总结页|不要总结页|不要总结|不要结束页|跳过总结|不做总结|无总结页|去掉总结|删去总结|不用总结|去除总结|不要结语|不要结尾|不要最后一页|不要结束/.test(
        t,
      ),
  };
  // 组合语义兜底：用户把封面/目录/总结三类结构页"同时"禁用（含顿号/逗号/和/与等连接句式，
  // 如"不要封面、目录和总结页"），等价于"只生成内容页"。仅在三者同时命中时触发，避免误伤。
  if (hints.disableCover && hints.disableToc && hints.disableConclusion) {
    hints.contentOnly = true;
  }
  // contentOnly 强覆盖：所有页面都禁用（除了内容页）
  if (hints.contentOnly) {
    hints.disableCover = true;
    hints.disableToc = true;
    hints.disableConclusion = true;
  }
  return hints;
};

/**
 * 根据「页数策略」+「用户显式禁用」推导出 理想的结构开关
 * 优先级：用户显式禁用 (hints) > 页数策略 (n)
 */
const deriveStructureFlags = (n: number, hints: PageStructureHints) => {
  // 先基于页数给默认策略
  let wantCover = true;
  let wantToc = false;
  let wantConclusion = true;
  if (n <= 2) {
    // 1~2 页：纯内容
    wantCover = false;
    wantToc = false;
    wantConclusion = false;
  } else if (n >= 3 && n <= 5) {
    // 3~5 页：封面+内容+总结，不要目录
    wantCover = true;
    wantToc = false;
    wantConclusion = true;
  } else {
    // 6+：封面+（目录可选，但默认要）+总结
    wantCover = true;
    wantToc = true;
    wantConclusion = true;
  }
  // 用户显式禁用（高优先级覆盖）
  if (hints.contentOnly) {
    wantCover = false;
    wantToc = false;
    wantConclusion = false;
  } else {
    if (hints.disableCover) wantCover = false;
    if (hints.disableToc) wantToc = false;
    if (hints.disableConclusion) wantConclusion = false;
  }
  // 结构总量上限约束：总页数不够时宁可放弃 toc，让给内容页
  let have = (wantCover ? 1 : 0) + (wantToc ? 1 : 0) + (wantConclusion ? 1 : 0);
  if (have > n) {
    // 先去掉目录
    if (wantToc && have - 1 <= n) {
      wantToc = false;
      have--;
    }
    // 如果还超，再去掉总结（只剩1页时cover也去掉）
    if (wantConclusion && have - 1 <= n) {
      wantConclusion = false;
      have--;
    }
    if (wantCover && have - 1 <= n) {
      wantCover = false;
      have--;
    }
  }
  return { wantCover, wantToc, wantConclusion };
};

/**
 * 从主题文本中智能提取页数规格。
 * - 单值（6页、不超过5页、7页左右等） → { exact: N }
 * - 区间（5-10页、三到八页、4~6页）     → { min: X, max: Y }
 * - 不匹配 → null
 */
export const extractSlideCountSpec = (text: string): SlideCountSpec | null => {
  const numberPattern = '(?:\\d+|一|二|两|三|四|五|六|七|八|九|十)';
  const patterns: Array<{ regex: RegExp; kind: 'at-most' | 'about' | 'range' | 'exact' }> = [
    { regex: new RegExp(`(${numberPattern})\\s*页\\s*以内`, 'i'), kind: 'at-most' },
    { regex: new RegExp(`(${numberPattern})\\s*页\\s*以下`, 'i'), kind: 'at-most' },
    { regex: new RegExp(`(${numberPattern})\\s*页\\s*之内`, 'i'), kind: 'at-most' },
    { regex: new RegExp(`不超过\\s*(${numberPattern})\\s*页`, 'i'), kind: 'at-most' },
    { regex: new RegExp(`最多\\s*(${numberPattern})\\s*页`, 'i'), kind: 'at-most' },
    { regex: new RegExp(`(${numberPattern})\\s*页\\s*左右`, 'i'), kind: 'about' },
    { regex: new RegExp(`(${numberPattern})\\s*页\\s*为宜`, 'i'), kind: 'about' },
    { regex: new RegExp(`(${numberPattern})\\s*页\\s*最佳`, 'i'), kind: 'about' },
    { regex: new RegExp(`(${numberPattern})\\s*页\\s*即可`, 'i'), kind: 'about' },
    { regex: new RegExp(`(${numberPattern})-(${numberPattern})\\s*页`, 'i'), kind: 'range' },
    {
      regex: new RegExp(`(${numberPattern})\\s*到\\s*(${numberPattern})\\s*页`, 'i'),
      kind: 'range',
    },
    { regex: new RegExp(`(${numberPattern})\\s*~(${numberPattern})\\s*页`, 'i'), kind: 'range' },
    { regex: new RegExp(`(${numberPattern})\\s*页`, 'i'), kind: 'exact' },
  ];
  for (const { regex, kind } of patterns) {
    const match = text.match(regex);
    if (!match) continue;
    if (kind === 'range') {
      const num1 = parseNumber(match[1]);
      const num2 = parseNumber(match[2]);
      if (num1 > 0 && num2 > 0) {
        const min = Math.min(num1, num2);
        const max = Math.max(num1, num2);
        return { min, max };
      }
    } else {
      const num = parseNumber(match[1]);
      if (num > 0) return { exact: num };
    }
  }
  return null;
};

function pLimit(concurrency: number) {
  const queue: Array<() => Promise<any>> = [];
  let active = 0;
  const next = () => {
    if (active >= concurrency || queue.length === 0) return;
    active++;
    const fn = queue.shift()!;
    fn().finally(() => {
      active--;
      next();
    });
  };
  return <T>(fn: () => Promise<T>): Promise<T> => {
    return new Promise((resolve, reject) => {
      queue.push(() => fn().then(resolve, reject));
      next();
    });
  };
}

/**
 * S2 · 字体族中文描述（用于插入提示词描述，让 LLM 理解当前字体风格）
 */
function getFontFamilyDescription(family: 'sans' | 'serif' | 'mono' = 'sans'): string {
  switch (family) {
    case 'serif':
      return 'serif 衬线体（标题使用 Georgia / 宋体，典雅学术气质，适合论文 / 学术演讲 / 白皮书类演示）';
    case 'mono':
      return 'mono 等宽体（JetBrains Mono + 中文等宽回退，工程师友好、极客感，适合技术分享 / 代码演示）';
    case 'sans':
    default:
      return 'sans 无衬线体（系统默认 UI 字体，现代扁平化、通用商务风格，推荐绝大多数场景）';
  }
}

export class HTMLPresentationAgent {
  private provider: AIModelProvider;
  private planningProvider: AIModelProvider;
  private contentProvider: AIModelProvider;
  private editingProvider: AIModelProvider;
  /** 本次生成的输出语言（'zh' | 'en'），由 generatePresentation 从调用方 options 读取。 */
  private language: 'zh' | 'en' = 'zh';

  constructor(
    provider: AIModelProvider,
    options?: {
      planningProvider?: AIModelProvider;
      contentProvider?: AIModelProvider;
      editingProvider?: AIModelProvider;
    },
  ) {
    this.provider = provider;
    this.planningProvider = options?.planningProvider || provider;
    this.contentProvider = options?.contentProvider || provider;
    this.editingProvider = options?.editingProvider || provider;
  }

  private getPrimaryColor(style?: string, colorTheme?: ColorTheme, primaryColor?: string): string {
    if (primaryColor && /^#[0-9a-fA-F]{6}$/.test(primaryColor)) return primaryColor;
    if (colorTheme && COLOR_THEMES[colorTheme]) return COLOR_THEMES[colorTheme];
    if (style && COLOR_THEMES[style]) return COLOR_THEMES[style];
    return '#2563eb';
  }

  /**
   * 计算 HEX 颜色的相对亮度 (WCAG sRGB 伽马校正公式)，返回 0~1
   */
  private hexLuminance(hex: string): number {
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
  private darkenPrimaryColor(primaryColor: string, ratio: number): string {
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
    const lum = this.hexLuminance(
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

  private buildSlideCountGuidance(
    spec:
      | SlideCountSpec
      | { exact: number; min?: undefined; max?: undefined }
      | { min: number; max: number; exact?: undefined },
  ): { guidance: string; displayText: string; planningTotal: number } {
    if ('exact' in spec && spec.exact != null) {
      const n = spec.exact;
      return {
        guidance: `1. **幻灯片数量（最高优先级）**：严格遵守用户指定的页数，**必须 ${n} 页**，不要多也不要少。\n页数要求：${n} 页。`,
        displayText: `${n} 页`,
        planningTotal: n,
      };
    }
    const min = (spec as any).min as number;
    const max = (spec as any).max as number;
    return {
      guidance: `1. **幻灯片数量（最高优先级）**：页数必须在 **${min} ~ ${max} 页之间**（含 ${min} 和 ${max}，${min} ≤ 实际页数 ≤ ${max}）。你自行根据主题的复杂度、要点多少，在范围内**选择最合适的页数**。不要超出边界。\n页数要求：${min} ~ ${max} 页，AI 按复杂度自决定。`,
      displayText: `${min} ~ ${max} 页`,
      planningTotal: max,
    };
  }

  /**
   * 构建用户显式结构指令的提示词追加内容（为空则返回空串）
   */
  private buildStructureOverridePrompt(hints: PageStructureHints): string {
    const parts: string[] = [];
    if (hints.contentOnly) {
      parts.push(
        '**用户显式要求：全部幻灯片只生成内容页，封面、目录、总结（结束页）一律不要！无论上面规则怎么写，都必须全部是内容页！**',
      );
    } else {
      if (hints.disableCover) parts.push('- **不要封面页**：第一页不要封面，直接从内容/目录页开始');
      if (hints.disableToc) parts.push('- **不要目录页**：无论多少页都不要目录');
      if (hints.disableConclusion)
        parts.push('- **不要总结/结束页**：最后一页不要总结、致谢、结语、结束之类页面');
    }
    if (parts.length === 0) return '';
    return `\n\n【用户结构指令 · 绝对最高优先级，覆盖所有规则】\n${parts.join('\n')}\n【以上结构指令必须严格遵守，不可忽略】\n`;
  }

  /**
   * S1 · summarizeReferenceHtmlBrief：抽取参考 HTML 的排版风格摘要（token 安全：≤200 字）
   * 若 referenceHtml <800 字符 → 直接使用（适当裁剪）；否则用正则抽：
   *   - 页面类型分布（有无 cover/summary/cards/timeline...）
   *   - 主色 hex + 深色变体（若存在）
   *   - 字体栈中出现的 serif / mono / sans 特征词
   *   - iconStyle 特征（出现 number-circle / letter-circle / large-number 的 class 名或 inline-style）
   *   - 有没有配图 <img data-image-ratio>
   * 输出一段简短中文说明，让 LLM 在规划和内容阶段都能感知"用户希望和参考版式一致"。
   */
  private summarizeReferenceHtmlBrief(referenceHtml: string): string {
    if (!referenceHtml) return '';
    // Task 2：改为调用独立 extractor（JSDOM 全文解析），返回 FR-5 优先级声明 + 要点
    const ref = extractReferenceHtmlAttributes(referenceHtml);
    return ref.briefText || '';
  }

  /**
   * S5 · sanitizeTopicSettingsConflict：检测 topic 中与高级选项参数矛盾的描述，
   * 仅检测+日志，不做删除/改写（防止破坏用户风格意图）。
   */
  private sanitizeTopicSettingsConflict(
    topic: string,
    params: {
      slideCount?: SlideCountSpec;
      colorTheme?: ColorTheme;
      style?: string;
      imagePreference?: ImagePreference;
    },
  ): void {
    if (!topic) return;
    const warnings: string[] = [];
    // 1) 页数冲突：
    const countMatch = topic.match(/(\d+)\s*页/);
    if (countMatch && params.slideCount) {
      const topicCount = parseInt(countMatch[1], 10);
      const exactN = 'exact' in params.slideCount ? params.slideCount.exact : null;
      if (exactN != null && exactN !== topicCount) {
        warnings.push(
          `主题中写了"${topicCount} 页"，但用户高级选项选了 ${exactN} 页（高级选项优先级更高）`,
        );
      }
    }
    // 2) 颜色冲突：
    const colorKeywords: Record<string, ColorTheme> = {
      蓝: 'blue',
      紫: 'purple',
      绿: 'green',
      橙: 'orange',
      青: 'teal',
      灰: 'gray',
    };
    for (const [k, v] of Object.entries(colorKeywords)) {
      if (
        new RegExp(k + '(色|主题|风格系)').test(topic) &&
        params.colorTheme &&
        params.colorTheme !== v
      ) {
        warnings.push(
          `主题中提到"${k}色"，但用户高级选项配色主题为 ${params.colorTheme}（高级选项优先级更高）`,
        );
        break;
      }
    }
    // 3) 风格冲突：
    if (params.style && params.style !== 'business') {
      const styleHints: Record<string, string> = {
        商务: 'business',
        创意: 'creative',
        简约: 'simple',
      };
      for (const [k, v] of Object.entries(styleHints)) {
        if (topic.includes(k) && params.style !== v) {
          warnings.push(
            `主题中写了"${k}风格"，但用户高级选项风格是 ${params.style}（高级选项优先级更高）`,
          );
          break;
        }
      }
    }
    if (warnings.length > 0) {
      console.warn(
        `[${formatBeijingTime()}] [AGENT] sanitizeTopicSettingsConflict (仅检测，不修改):\n  - ${warnings.join('\n  - ')}`,
      );
    }
  }

  /**
   * S5 · buildUserSettingsPriorityOverridePrompt：输出「用户显式参数 · 高优先级（低于参考提取属性）」大段红线
   * 放在 PRESENTATION_PLANNING_PROMPT 的 {{BACKGROUND_GUIDANCE}} 之后，作为高优先级覆盖，
   * 明确声明：高级选项参数 > topic 自然语言中任何对应词汇，但 < 参考文件提取属性（优先级：参考 > 用户显式 > 主题自然语言 > 默认）。
   */
  private buildUserSettingsPriorityOverridePrompt(params: {
    slideCount: SlideCountSpec;
    style: string;
    density: ContentDensity;
    imagePreference: ImagePreference;
    colorTheme?: ColorTheme;
    iconStyle: IconStyle;
    fontFamily: 'sans' | 'serif' | 'mono';
    backgroundEnabled: boolean;
    audience: string;
    referencePrimaryColor?: string;
  }): string {
    const densityText: Record<ContentDensity, string> = {
      compact: '紧凑（每页信息量大，字号较小）',
      normal: '适中（平衡信息量和可读性）',
      spacious: '宽松（留白充足，字号较大，重点突出）',
    };
    const imagePrefText: Record<ImagePreference, string> = {
      all: '每页都配图（包括封面/总结）',
      'content-only': '仅内容页配图，封面/目录/总结不放图（推荐）',
      minimal: '尽量少配图，主要使用文字和卡片',
      none: '不生成任何图片，纯文字/卡片布局',
    };
    const colorThemeText: Record<ColorTheme, string> = {
      blue: '蓝色商务（专业稳重）',
      purple: '紫色创意（个性活泼）',
      green: '绿色环保（清新自然）',
      orange: '橙色活力（醒目热情）',
      teal: '青色科技（科技感强）',
      gray: '极简灰度（低调克制）',
    };
    const iconStyleText: Record<IconStyle, string> = {
      auto: '智能匹配（默认使用线性SVG描边图标，简约专业，适合B端/技术/正式场景；根据语义从内置图标库选择匹配图标）',
      line: '线性SVG描边图标（Lucide风格，简约理性、专业冷静，主色描边+浅色圆角底，适合B端产品、技术PPT、研发平台、多图标并列场景）',
      filled:
        '面性SVG填充图标（实心色块，视觉权重高、醒目有力，白色图标+渐变实心底，适合封面、核心结论、大屏展示、重点模块）',
      numbered: '数字序号（渐变圆角方形/圆形 + 白色数字 1/2/3/4，适合步骤/流程/阶段类要点）',
      bullet:
        '对勾/圆点（简洁符号类：主色渐变圆形+白色对勾SVG，或主色10px小圆点，适合特性/优势/功能列表）',
      lettered: '字母分类（渐变圆形 + 白色字母 A/B/C/D…，适合分类/维度/类型类要点）',
      emoji:
        'Emoji风格（仅适合内部轻松沟通/C端/年轻群体内容；B端技术方案、正式汇报、商务宣讲禁止使用emoji，应改用line线性图标）',
      none: '无图标，纯文字列表',
    };
    const slideCountText =
      'exact' in params.slideCount
        ? `严格 ${params.slideCount.exact} 页（不要多也不要少）`
        : `${params.slideCount.min} ~ ${params.slideCount.max} 页之间（自行按复杂度决定）`;
    let colorThemeLine: string;
    // FR-2.x：若「参考文件提取属性」提供了主色，则该参考主色为绝对最高优先级，
    // 本配色主题的 hex 硬约束须让位（消除「参考最高优先级」与「#2563eb 绝对不可改」的提示词自相矛盾）。
    const refPrimaryNote = params.referencePrimaryColor
      ? `（⚠️ 但「参考文件提取属性」已提供主色 ${params.referencePrimaryColor}，该参考主色为绝对最高优先级（参考 > 用户显式 > 主题自然语言 > 默认），本配色主题的 hex 约束须让位于参考色，禁止再以本主题 hex 为唯一合法值）`
      : '';
    if (params.colorTheme && COLOR_THEMES[params.colorTheme]) {
      const expectedPrimary = COLOR_THEMES[params.colorTheme];
      if (params.referencePrimaryColor) {
        colorThemeLine = `${colorThemeText[params.colorTheme]}（默认/兜底色系为 ${expectedPrimary}）${refPrimaryNote}`;
      } else {
        colorThemeLine = `${colorThemeText[params.colorTheme]}（⚠️ primaryColor 固定为 ${expectedPrimary}，绝对不可改；示例 JSON 输出必须填入此 hex；任何渐变/描边/阴影都只能在该色系内做明暗变化，禁止引入其他色系）`;
      }
    } else {
      // colorTheme 为「自动」：按 style 计算自动匹配到的具体 hex（business→蓝 / creative→紫 / simple→灰 / academic→青），
      // 仍然以强约束形式写死，不给 LLM 自行猜色的空间，避免 auto 场景下出现深紫/深青/蓝色混乱。
      const autoPrimary = COLOR_THEMES[params.style] || '#2563eb';
      const styleDesc: Record<string, string> = {
        business: '商务蓝（匹配商务风，专业稳重）',
        creative: '创意紫（匹配创意风，个性活泼）',
        simple: '极简灰（匹配简约风，低调克制）',
        academic: '学术青（匹配学术风，理性沉稳）',
      };
      const desc = styleDesc[params.style] || '系统默认蓝（专业稳重）';
      if (params.referencePrimaryColor) {
        colorThemeLine = `${desc}（默认/兜底色系为 ${autoPrimary}）${refPrimaryNote}`;
      } else {
        colorThemeLine = `${desc}（⚠️ 本次自动匹配 primaryColor=${autoPrimary}，你必须在 JSON 输出中原样填入该 hex，绝对不可自作主张换别的色；任何渐变/描边/阴影都只能在该色系内做明暗变化，禁止引入其他色系）`;
      }
    }
    const lines: string[] = [
      '【用户显式参数 · 高优先级（仅低于参考文件提取属性） · 覆盖主题自然语言】',
      '本红线优先级 > 主题自然语言描述中的对应数量/颜色/风格词汇（即用户显式参数高于主题自然语言）；但若「参考文件提取属性」已指定同一维度，则以参考为准（优先级：参考 > 用户显式 > 主题自然语言 > 默认）。',
      '如果下列参数与上方「用户显式指令 / 主题描述 / 图文搭配覆盖规则 / 示例 imagePrompt」中的自然语言词汇冲突（例如主题里写了"10页蓝色商务风"，但下面参数写了页数=8 / 配色=紫色），以用户显式参数为准；但若与「参考文件提取属性」冲突，仍以参考为准。',
      '',
      `  · 幻灯片数量（最高优先级）：${slideCountText}`,
      `  · 风格：${params.style}`,
      `  · 内容密度：${densityText[params.density]}`,
      `  · 配图偏好：${imagePrefText[params.imagePreference]}`,
      `  · 配色主题：${colorThemeLine}`,
      `  · 列表图标风格：${iconStyleText[params.iconStyle]}`,
      `  · 字体：${getFontFamilyDescription(params.fontFamily)}`,
      `  · 自动背景图：${params.backgroundEnabled ? '开启（封面/目录/内容/总结各生成一张统一风格的背景大图）' : '关闭（纯色/浅色背景，不生成额外背景图片）'}`,
      `  · 目标受众：${params.audience || '通用商务受众'}`,
      '',
      '【以上 9 项显式参数必须严格遵守，不可被主题中的自然语言描述覆盖；但若与「参考文件提取属性」冲突，以参考为准（参考 > 用户显式 > 主题自然语言 > 默认）】',
    ];
    return '\n\n' + lines.join('\n') + '\n';
  }

  /**
   * 通用备用标题池（补齐页数时用），顺序从"深度→实施→参考→注意→展望→FAQ"
   */
  private readonly SUPPLEMENT_TITLE_POOL = [
    '深入分析与洞察',
    '关键实施路径',
    '典型案例参考',
    '常见问题与建议',
    '未来发展展望',
    '核心要点总结',
    '对比分析',
    '数据与指标',
    '落地策略',
    '风险与注意事项',
  ];

  private clampSlidesToCount(
    slides: SlidePlan[],
    target: number,
    hints: PageStructureHints = {
      contentOnly: false,
      disableCover: false,
      disableToc: false,
      disableConclusion: false,
    },
    imagePreference: ImagePreference = 'content-only',
  ): SlidePlan[] {
    if (!Array.isArray(slides)) slides = [];
    const n = slides.length;
    if (n === target && target > 0) return slides;
    if (target <= 0) target = 1;
    const flags = deriveStructureFlags(target, hints);
    // 内容页补位辅助：按 imagePreference 决定补位 slide 默认带图还是纯文字
    const buildSupplementSlide = (
      title: string,
      cursor: number,
      _asStructure = false,
    ): SlidePlan => {
      const keyPoints = ['核心要点展开分析', '相关数据支撑', '落地建议与参考'].slice(
        0,
        4 - (cursor % 3),
      );
      if (imagePreference === 'none' || imagePreference === 'minimal') {
        return { pageType: 'content-no-image', title, keyPoints, needsImage: false };
      }
      // all / content-only：补位用带图布局
      return {
        pageType: 'content-image-left',
        title,
        keyPoints,
        needsImage: true,
        imageRatio: '4:3',
      };
    };
    // 结构页降级转内容辅助
    const downgradeStructureToContent = (s: SlidePlan): SlidePlan => {
      if (imagePreference === 'none' || imagePreference === 'minimal') {
        return { ...s, pageType: 'content-no-image', needsImage: false };
      }
      return {
        ...s,
        pageType: 'content-image-left',
        needsImage: true,
        imageRatio: s.imageRatio || '4:3',
      };
    };
    // cover/toc/summary 结构页默认生成：imagePreference=all 时需要配图
    const buildDefaultStructure = (
      pageType: 'cover' | 'toc' | 'summary',
      title: string,
    ): SlidePlan => {
      if (imagePreference === 'all') {
        return {
          pageType,
          title,
          keyPoints: [],
          needsImage: true,
          imageRatio: '16:9',
          imagePrompt: `与演示主题协调的高品质专业背景插画，画面主体靠边留出文字区域，色彩沉稳克制`,
        };
      }
      return { pageType, title, keyPoints: [], needsImage: false };
    };

    // 先把 slides 中识别出结构页的位置信息：cover/toc/conclusion 各挑一个代表
    const identifyCover = (s: SlidePlan) =>
      s.pageType === 'cover' ||
      /封面|title|开始|cover/i.test(s.title || '') ||
      /封面|开篇|首页/.test(s.pageType || '');
    const identifyToc = (s: SlidePlan) =>
      s.pageType === 'toc' ||
      /目录|大纲|table\s*of\s*contents|contents/i.test(s.title || '') ||
      /toc|目录|outline/.test(s.pageType || '');
    const identifyConclusion = (s: SlidePlan) =>
      s.pageType === 'summary' ||
      /总结|致谢|结束|谢谢|展望|结语|最后|感谢观看|Q&A|问答/i.test(s.title || '');

    if (n > target) {
      // 裁剪：先根据 flags 把要的结构页标记出来，内容页从前往后保留
      const result: SlidePlan[] = [];
      // 先取 cover（如果 wantCover 且存在于 slides 的前 1/3）
      let coverIdx = -1;
      let tocIdx = -1;
      let conclusionIdx = -1;
      // cover 判定范围：前 ceil(n/3) 页里找第一个
      for (let i = 0; i < Math.min(Math.ceil(n / 3), n); i++) {
        if (identifyCover(slides[i])) {
          coverIdx = i;
          break;
        }
      }
      // toc：前半部分（不含 cover）找一个
      for (let i = 0; i < Math.floor(n * 0.5); i++) {
        if (i === coverIdx) continue;
        if (identifyToc(slides[i])) {
          tocIdx = i;
          break;
        }
      }
      // conclusion：后 1/3 里找
      for (let i = Math.max(0, n - Math.ceil(n / 3)); i < n; i++) {
        if (identifyConclusion(slides[i])) {
          conclusionIdx = i;
          break;
        }
      }
      // 如果 wantCover=true 但没识别到 cover，则把第一页当作 cover
      if (flags.wantCover && coverIdx === -1 && n > 0) coverIdx = 0;
      // wantConclusion=true 但没识别到，则把最后一页当作 conclusion
      if (flags.wantConclusion && conclusionIdx === -1 && n > 0) conclusionIdx = n - 1;
      // wantToc=true 没识别到就算了，后面 enforcePageStructure 会补齐

      // 按顺序保留（cover 最前 / toc 其次 / conclusion 最后），中间内容页按原顺序，不重复
      const used = new Set<number>();
      if (flags.wantCover && coverIdx !== -1) {
        result.push(slides[coverIdx]);
        used.add(coverIdx);
      }
      if (flags.wantToc && tocIdx !== -1 && !used.has(tocIdx)) {
        result.push(slides[tocIdx]);
        used.add(tocIdx);
      }
      // 中间内容页：从前往后填，跳过已用和结论
      for (
        let i = 0;
        i < n && result.length < target - (flags.wantConclusion && conclusionIdx !== -1 ? 1 : 0);
        i++
      ) {
        if (used.has(i)) continue;
        if (flags.wantConclusion && i === conclusionIdx) continue;
        if (!flags.wantToc && identifyToc(slides[i])) continue; // 明确不要目录则跳过
        if (!flags.wantConclusion && identifyConclusion(slides[i]) && i !== conclusionIdx) continue;
        if (!flags.wantCover && identifyCover(slides[i])) continue;
        result.push(slides[i]);
      }
      if (
        flags.wantConclusion &&
        conclusionIdx !== -1 &&
        !used.has(conclusionIdx) &&
        result.length < target
      ) {
        result.push(slides[conclusionIdx]);
      }
      // 再多退少补（因为可能结构页不够 or 过多）
      if (result.length > target) return result.slice(0, target);
      if (result.length < target) {
        // 内容页补空位
        let cursor = 0;
        while (result.length < target) {
          const title = this.SUPPLEMENT_TITLE_POOL[cursor % this.SUPPLEMENT_TITLE_POOL.length];
          cursor++;
          result.push(buildSupplementSlide(title, cursor));
        }
      }
      return result.slice(0, target);
    }

    // 补足：target > n
    // 先从 slides 中剥离 cover / toc / conclusion 三类结构页（用 identify*）
    const coverList: SlidePlan[] = [];
    const tocList: SlidePlan[] = [];
    const conclusionList: SlidePlan[] = [];
    const contentList: SlidePlan[] = [];
    for (const s of slides) {
      if (identifyConclusion(s)) conclusionList.push(s);
      else if (identifyToc(s)) tocList.push(s);
      else if (identifyCover(s)) coverList.push(s);
      else contentList.push(s);
    }
    // 根据 flags 选择保留的结构页（各最多 1 个）
    const finalCover = flags.wantCover
      ? (coverList[0] ?? buildDefaultStructure('cover', '演示封面'))
      : null;
    const finalToc = flags.wantToc ? (tocList[0] ?? buildDefaultStructure('toc', '目录')) : null;
    const finalConclusion = flags.wantConclusion
      ? (conclusionList[conclusionList.length - 1] ?? buildDefaultStructure('summary', '总结'))
      : null;

    const structureCount = (finalCover ? 1 : 0) + (finalToc ? 1 : 0) + (finalConclusion ? 1 : 0);
    const needContent = Math.max(0, target - structureCount);
    // 内容页补足：优先原有 contentList → 原有 coverList/tocList/conclusionList 被 flags 放弃的（转成内容）→ 再用 SUPPLEMENT 池补
    const finalContents: SlidePlan[] = [];
    for (const s of contentList) finalContents.push(s);
    if (!flags.wantCover)
      for (const s of coverList) finalContents.push(downgradeStructureToContent(s));
    if (!flags.wantToc) for (const s of tocList) finalContents.push(downgradeStructureToContent(s));
    if (!flags.wantConclusion)
      for (const s of conclusionList) finalContents.push(downgradeStructureToContent(s));
    let cursor = 0;
    while (finalContents.length < needContent) {
      const title = this.SUPPLEMENT_TITLE_POOL[cursor % this.SUPPLEMENT_TITLE_POOL.length];
      cursor++;
      finalContents.push(buildSupplementSlide(title, cursor));
    }
    // 拼接：cover → toc → contents → conclusion
    const result: SlidePlan[] = [];
    if (finalCover) result.push(finalCover);
    if (finalToc) result.push(finalToc);
    for (const c of finalContents.slice(0, needContent)) result.push(c);
    if (finalConclusion) result.push(finalConclusion);
    return result.slice(0, target);
  }

  /**
   * 强制对齐页结构：根据页数策略 + 用户显式禁用指令，确保封面/目录/总结正确存在或不存在。
   * 在 clampSlidesToCount 之后再跑一次，处理大模型可能生成错位（如把封面当内容、toc 放到末尾等）。
   */
  private enforcePageStructure(
    slides: SlidePlan[],
    target: number,
    hints: PageStructureHints = {
      contentOnly: false,
      disableCover: false,
      disableToc: false,
      disableConclusion: false,
    },
    imagePreference: ImagePreference = 'content-only',
  ): SlidePlan[] {
    // 辅助函数（与 clampSlidesToCount 中同名函数逻辑一致）
    const buildSupplementSlide = (title: string, cursor: number): SlidePlan => {
      const keyPoints = ['核心要点展开分析', '相关数据支撑', '落地建议与参考'].slice(
        0,
        4 - (cursor % 3),
      );
      if (imagePreference === 'none' || imagePreference === 'minimal') {
        return { pageType: 'content-no-image', title, keyPoints, needsImage: false };
      }
      return {
        pageType: 'content-image-left',
        title,
        keyPoints,
        needsImage: true,
        imageRatio: '4:3',
      };
    };
    const downgradeStructureToContent = (s: SlidePlan): SlidePlan => {
      if (imagePreference === 'none' || imagePreference === 'minimal') {
        return { ...s, pageType: 'content-no-image', needsImage: false };
      }
      return {
        ...s,
        pageType: 'content-image-left',
        needsImage: true,
        imageRatio: s.imageRatio || '4:3',
      };
    };
    const buildDefaultStructure = (
      pageType: 'cover' | 'toc' | 'summary',
      title: string,
    ): SlidePlan => {
      if (imagePreference === 'all') {
        return {
          pageType,
          title,
          keyPoints: [],
          needsImage: true,
          imageRatio: '16:9',
          imagePrompt: `与演示主题协调的高品质专业背景插画，画面主体靠边留出文字区域，色彩沉稳克制`,
        };
      }
      return { pageType, title, keyPoints: [], needsImage: false };
    };

    if (!Array.isArray(slides) || slides.length === 0) {
      slides = [buildSupplementSlide('内容', 0)];
    }
    const flags = deriveStructureFlags(target, hints);
    const identifyCover = (s: SlidePlan) =>
      s.pageType === 'cover' ||
      /封面|title|开始|cover/i.test(s.title || '') ||
      /封面|开篇|首页/.test(s.pageType || '');
    const identifyToc = (s: SlidePlan) =>
      s.pageType === 'toc' ||
      /目录|大纲|table\s*of\s*contents|contents/i.test(s.title || '') ||
      /toc|目录|outline/.test(s.pageType || '');
    const identifyConclusion = (s: SlidePlan) =>
      s.pageType === 'summary' ||
      /总结|致谢|结束|谢谢|展望|结语|最后|感谢观看|Q&A|问答/i.test(s.title || '');

    // 剥离
    let cover: SlidePlan | null = null;
    let toc: SlidePlan | null = null;
    let conclusion: SlidePlan | null = null;
    const contents: SlidePlan[] = [];
    for (const s of slides) {
      if (!cover && identifyCover(s)) {
        cover = s;
        continue;
      }
      if (!toc && identifyToc(s)) {
        toc = s;
        continue;
      }
      if (!conclusion && identifyConclusion(s)) {
        conclusion = s;
        continue;
      }
      contents.push(s);
    }

    // 如果 hints 明确禁用，就视为不存在结构页（转为内容页）
    if (cover && (flags.wantCover === false || hints.disableCover || hints.contentOnly)) {
      contents.unshift(downgradeStructureToContent(cover));
      cover = null;
    }
    if (toc && (flags.wantToc === false || hints.disableToc || hints.contentOnly)) {
      contents.push(downgradeStructureToContent(toc));
      toc = null;
    }
    if (
      conclusion &&
      (flags.wantConclusion === false || hints.disableConclusion || hints.contentOnly)
    ) {
      contents.push(downgradeStructureToContent(conclusion));
      conclusion = null;
    }

    // 如果需要结构页但还缺，就生成默认的
    if (flags.wantCover && !cover) {
      cover = buildDefaultStructure('cover', '封面');
    }
    if (flags.wantToc && !toc) {
      toc = buildDefaultStructure('toc', '目录');
    }
    if (flags.wantConclusion && !conclusion) {
      conclusion = buildDefaultStructure('summary', '总结');
    }

    const structureCount = (cover ? 1 : 0) + (toc ? 1 : 0) + (conclusion ? 1 : 0);
    const needContent = Math.max(0, target - structureCount);
    // 内容页不足 or 过多：裁剪/补足
    while (contents.length < needContent) {
      const cursor = contents.length;
      const title = this.SUPPLEMENT_TITLE_POOL[cursor % this.SUPPLEMENT_TITLE_POOL.length];
      contents.push(buildSupplementSlide(title, cursor));
    }
    const finalContents = contents.slice(0, needContent);
    const result: SlidePlan[] = [];
    if (cover) result.push(cover);
    if (toc) result.push(toc);
    for (const c of finalContents) result.push(c);
    if (conclusion) result.push(conclusion);
    return result.slice(0, target);
  }

  /**
   * FR-0：参考含图强制插图——规划阶段在 imagePreference 归一化之前插入。
   * 参考属性（参考图含照片/插画，或参考 HTML 含 <img>）优先级高于用户 imagePreference：
   *  - 封面/总结页：挂 referenceHeroImage（落盘后由 master.heroImage 做 CSS 开窗背景），并置 referenceLockedImage 锁；
   *  - 内容页：强制 needsImage=true（FR-15 已按分类取 referenceImageUrl 作 img2img seed），并置锁。
   * 无参考文件（rva 为空）时直接原样返回，向后兼容。
   */
  private applyReferenceImageOverride(
    slides: SlidePlan[],
    rva: ReferenceVisualAttributes | undefined,
  ): SlidePlan[] {
    if (!rva) return slides;
    return slides.map((s) => {
      if (!hasReferenceImage(rva, s.pageType)) return s;
      const hero = resolveHeroImageForPage(rva, s.pageType);
      const cat = pageTypeToCategory(s.pageType);
      if ((cat === 'cover' || cat === 'summary') && hero) {
        return { ...s, referenceHeroImage: hero, referenceLockedImage: true };
      }
      // 内容页：强制 AI 生图（img2img seed 复用上传的参考原图）
      return {
        ...s,
        needsImage: true,
        referenceLockedImage: true,
        imagePrompt: s.imagePrompt || `${s.title || '内容'}（参考素材风格，沿用上传参考图）`,
      };
    });
  }

  /**
   * normalizePlanByImagePreference —— 规划阶段最后一道防线，按用户显式的 imagePreference 强制归一每张 slide 的 needsImage / pageType / imageRatio / 兜底 imagePrompt。
   * 目标：85% 以上场景下，HTML 生成之前 plan.slides 就已经正确，无需走兜底。
   */
  private normalizePlanByImagePreference(
    slides: SlidePlan[],
    imagePreference: ImagePreference,
    topic: string,
    imageOptionsEnabled: boolean = true,
  ): SlidePlan[] {
    // ================ ★ 关键防御（与 server 层 CONFIG-CONFLICT 双层）★ ================
    // 当 imageOptions.enabled=false 或 imageOptions=undefined（配置开关没开 / 绕过 server 调用），
    // 即使显式传了 imagePreference=all/content-only/minimal，也强制归一到 pref=none，防止
    // plan.slides 里 needsImage=true，但 generateImageImages 阶段 imageProvider 为空 →
    // 出现"NOPPT 占位图保留/无图/异常报错"等各种不一致。
    let effectivePref = imagePreference;
    if (!imageOptionsEnabled) {
      if (imagePreference !== 'none') {
        console.warn(
          `[AGENT] imageOptions.enabled=${imageOptionsEnabled}，但 imagePreference=${imagePreference}，` +
            `强制降级为 pref=none 避免生成 NOPPT 占位图。`,
        );
      }
      effectivePref = 'none';
    }
    // ================ ★ END: 防御性降级 ★ ================
    const isStructureType = (pt: SlidePageType | undefined) =>
      pt === 'cover' || pt === 'toc' || pt === 'summary';
    const buildImagePromptFallback = (title: string) =>
      `${topic} - ${title}，与整体配色协调的高品质专业插画，画面简洁主体靠边留出文字排版空间`;
    return slides.map((s) => {
      // FR-0：参考含图锁——参考属性优先级高于用户 imagePreference，任何 pref 下都不剥离参考图
      if (s.referenceLockedImage) {
        const needs = !!s.needsImage;
        return {
          ...s,
          needsImage: needs,
          imagePrompt:
            s.imagePrompt ?? (needs ? `${s.title || '内容'}（参考素材风格）` : undefined),
          imageRatio:
            s.imageRatio ??
            (needs
              ? s.pageType === 'content-image-top'
                ? defaultRatioForImageTop(s.keyPoints)
                : '4:3'
              : undefined),
        };
      }
      // ———— pref=none：强制删除所有图片相关信息 ————
      if (effectivePref === 'none') {
        const { imageRatio: _ir, imagePrompt: _ip, ...rest } = s;
        let { pageType, needsImage } = rest;
        needsImage = false;
        if (
          pageType &&
          (pageType === 'content-image-left' ||
            pageType === 'content-image-right' ||
            pageType === 'content-image-top')
        ) {
          pageType = 'content-no-image';
        }
        return { ...rest, pageType, needsImage };
      }
      // ———— pref=minimal：仅保留 "LLM明确写了 content-image-* 且 needsImage=true" 的，其余全部 false ————
      if (effectivePref === 'minimal') {
        const isImageType =
          s.pageType === 'content-image-left' ||
          s.pageType === 'content-image-right' ||
          s.pageType === 'content-image-top';
        if (isImageType && s.needsImage) {
          return {
            ...s,
            imageRatio:
              s.imageRatio ||
              (s.pageType === 'content-image-top' ? defaultRatioForImageTop(s.keyPoints) : '4:3'),
            imagePrompt: s.imagePrompt || buildImagePromptFallback(s.title || '内容'),
          };
        }
        const { imageRatio: _ir, imagePrompt: _ip, ...rest } = s;
        return { ...rest, needsImage: false };
      }
      // ———— pref=all / content-only：强制带图 ————
      let { pageType, needsImage, imageRatio, imagePrompt, keyPoints = [] } = s;
      const isStructure = isStructureType(pageType);
      // ——— FR-1 (fix-slide-comparison-image-disaster)：L1 高级版式保持规划快照原样，不走强制带图升级 ———
      const NEVER_UPGRADE_FOR_IMAGE: ReadonlySet<string> = new Set([
        'comparison-deep-dive',
        'content-value-showcase',
        'content-stats-highlight',
        'content-image-background',
        'content-zigzag',
        'content-cards',
        'content-compare',
        'content-timeline',
        'content-table',
      ]);
      const protectedLayout = NEVER_UPGRADE_FOR_IMAGE.has(pageType);
      if (!protectedLayout && (effectivePref === 'all' || !isStructure)) {
        needsImage = true;
        // pageType 升级：所有纯文字/密集型布局统一升级为带图 left
        if (!isStructure) {
          const shouldUpgradeToImageType =
            pageType === 'content-no-image' || pageType === 'content-table';
          if (shouldUpgradeToImageType && keyPoints.length >= 1) {
            pageType = 'content-image-left';
          }
        }
        // imageRatio：给一个合理的默认；上图下文按 keyPoints 数量自动选择更扁的比例防溢出
        if (!imageRatio) {
          if (pageType === 'content-image-top') imageRatio = defaultRatioForImageTop(keyPoints);
          else if (isStructure) imageRatio = '16:9';
          else imageRatio = '4:3';
        }
        // imagePrompt 兜底
        if (!imagePrompt) {
          imagePrompt = buildImagePromptFallback(s.title || '内容');
        }
      } else {
        // content-only 下 cover/toc/summary：保持 needsImage=false（与"仅内容页配图"一致）
        needsImage = false;
      }
      return { ...s, pageType, needsImage, imageRatio, imagePrompt, keyPoints };
    });
  }

  private buildPlanningPrompt(
    topic: string,
    style: string,
    audience: string,
    slideSpec: SlideCountSpec,
    density: ContentDensity,
    imagePreference: ImagePreference,
    backgroundEnabled: boolean = false,
    pageHints: PageStructureHints = {
      contentOnly: false,
      disableCover: false,
      disableToc: false,
      disableConclusion: false,
    },
    iconStyle: IconStyle = 'auto',
    fontFamily: 'sans' | 'serif' | 'mono' = 'sans',
    colorTheme?: ColorTheme,
    referenceHtmlBrief: string = '',
    userSettingsOverride: string = '',
    effectivePrimaryColor?: string,
    categoryReferenceSummary: string = '',
    referenceStructureSnippet: string = '',
    referenceColorPolicy: string = '',
    hasReference: boolean = false,
    referenceLayoutDiversity: string = '',
    /** RAG 文本素材（Hermes 侧整理），以「权威素材」段注入大纲 prompt */
    referenceText: string = '',
  ): string {
    const densityText: Record<ContentDensity, string> = {
      compact: '紧凑（每页信息量大，字号较小）',
      normal: '适中（平衡信息量和可读性）',
      spacious: '宽松（留白充足，字号较大，重点突出）',
    };
    const imagePrefText: Record<ImagePreference, string> = {
      all: '每页都配图（包括封面/总结）',
      'content-only': '仅内容页配图，封面/目录/总结不放图（推荐）',
      minimal: '尽量少配图，主要使用文字和卡片',
      none: '不生成任何图片，纯文字/卡片布局',
    };
    const colorThemeText: Record<ColorTheme, string> = {
      blue: '蓝色商务（专业稳重）',
      purple: '紫色创意（个性活泼）',
      green: '绿色环保（清新自然）',
      orange: '橙色活力（醒目热情）',
      teal: '青色科技（科技感强）',
      gray: '极简灰度（低调克制）',
    };
    const iconStyleText: Record<IconStyle, string> = {
      auto: '智能匹配（默认使用线性SVG描边图标，简约专业，适合B端/技术/正式场景；根据语义从内置图标库选择匹配图标）',
      line: '线性SVG描边图标（Lucide风格，简约理性、专业冷静，主色描边+浅色圆角底，适合B端产品、技术PPT、研发平台、多图标并列场景）',
      filled:
        '面性SVG填充图标（实心色块，视觉权重高、醒目有力，白色图标+渐变实心底，适合封面、核心结论、大屏展示、重点模块）',
      numbered: '数字序号（渐变圆角方形/圆形 + 白色数字 1/2/3/4，适合步骤/流程/阶段类要点）',
      bullet:
        '对勾/圆点（简洁符号类：主色渐变圆形+白色对勾SVG，或主色10px小圆点，适合特性/优势/功能列表）',
      lettered: '字母分类（渐变圆形 + 白色字母 A/B/C/D…，适合分类/维度/类型类要点）',
      emoji:
        'Emoji风格（仅适合内部轻松沟通/C端/年轻群体内容；B端技术方案、正式汇报、商务宣讲禁止使用emoji，应改用line线性图标）',
      none: '无图标，纯文字列表',
    };
    const { guidance } = this.buildSlideCountGuidance(slideSpec);
    const structureOverride = this.buildStructureOverridePrompt(pageHints);
    // U-17-L：若调用方已传入 effectivePrimaryColor（即 U-17 公式计算结果），
    // 则直接使用它；否则退化至旧公式（保持向后兼容）。这保证 system prompt 里的
    // 示例 primaryColor / 配色主题强约束文案 与 user message 中主色完全一致。
    const expectedPrimaryHex = (() => {
      if (effectivePrimaryColor && /^#[0-9a-fA-F]{6}$/.test(effectivePrimaryColor)) {
        return effectivePrimaryColor;
      }
      return colorTheme && COLOR_THEMES[colorTheme] ? COLOR_THEMES[colorTheme] : '#2563eb';
    })();
    const colorThemeHint = colorTheme
      ? `【配色主题】\n配色主题（S-4 · 显式传递）：${colorThemeText[colorTheme]}。⚠️ primaryColor 必须精确填入 ${expectedPrimaryHex}（这是你输出 JSON 时的唯一合法值，绝对不可自己猜别的 hex）。imagePrompt 中生成的色调、整套 slides 的视觉气质，都要与该色系完全一致，禁止引入蓝/紫/绿等其他色系主强调色。`
      : '【配色主题】：未显式设置（默认按蓝色商务或根据主题自适应，但 primaryColor 字段必须填合法 6 位 hex）';
    const iconStyleHint = `【列表图标风格（S-7）】：${iconStyleText[iconStyle]}。规划阶段不需要写具体图标的 CSS，但要在选择 pageType 时考虑 iconStyle 的适配（例如 iconStyle=large-number 时，尽量选择带编号列表的 content-list / content-cards / content-compare 等 layout）。`;
    const fontFamilyHint = `【字体风格（S-11）】：${getFontFamilyDescription(fontFamily)}。规划阶段不用写具体 font-family CSS，但要考虑整体排版的气质与字体匹配（例如 serif 更适合大量文字的正式内容页，mono 更适合技术代码型内容页）。`;
    const referenceHtmlBriefText =
      referenceHtmlBrief ||
      (hasReference
        ? '（已上传参考文件，但本次未能提取到可落盘的 HTML 属性摘要；参考主色/字体/版式等仍以「参考文件视觉覆盖指令」为准）'
        : '（用户未上传参考文件 HTML）');
    return (
      PRESENTATION_PLANNING_PROMPT.replace(/\{\{STYLE\}\}/g, style)
        .replace(/\{\{DENSITY\}\}/g, densityText[density])
        .replace(/\{\{IMAGE_PREFERENCE\}\}/g, imagePrefText[imagePreference])
        .replace(/\{\{AUDIENCE\}\}/g, audience || '通用商务受众')
        .replace(/\{\{TOPIC\}\}/g, topic)
        .replace(/\{\{SLIDE_COUNT_GUIDANCE\}\}/g, guidance)
        .replace(
          /\{\{BACKGROUND_GUIDANCE\}\}/g,
          (backgroundEnabled ? BACKGROUND_PLANNING_GUIDANCE : '') + structureOverride,
        )
        .replace(/\{\{COLOR_THEME_HINT\}\}/g, colorThemeHint)
        .replace(/\{\{EXPECTED_PRIMARY_COLOR\}\}/g, expectedPrimaryHex)
        .replace(/\{\{ICON_STYLE_HINT\}\}/g, iconStyleHint)
        .replace(/\{\{FONT_STYLE_HINT\}\}/g, fontFamilyHint)
        .replace(/\{\{USER_SETTINGS_OVERRIDE\}\}/g, userSettingsOverride)
        .replace(/\{\{REFERENCE_HTML_BRIEF\}\}/g, referenceHtmlBriefText)
        .replace(/\{\{CATEGORY_REFERENCE_SUMMARY\}\}/g, categoryReferenceSummary)
        .replace(/\{\{REFERENCE_STRUCTURE_SNIPPET\}\}/g, referenceStructureSnippet)
        .replace(/\{\{REFERENCE_COLOR_POLICY\}\}/g, referenceColorPolicy)
        .replace(/\{\{REFERENCE_LAYOUT_DIVERSITY\}\}/g, referenceLayoutDiversity)
        // RAG 素材放最后注入：用函数式 replace 避免素材里的 `$&` 被当作替换模式，
        // 且素材中若含 {{XXX}} 字面量也不会被前面的替换规则二次改写。
        .replace(/\{\{REFERENCE_TEXT_BRIEF\}\}/g, () =>
          this.buildReferenceTextBrief(referenceText),
        ) +
      `\n\n【输出语言】${
        this.language === 'en'
          ? '请使用英文撰写本演示的全部文案（含标题、正文、要点、按钮等可见文本）。'
          : '请使用中文撰写本演示的全部文案（含标题、正文、要点、按钮等可见文本）。'
      }`
    );
  }

  /**
   * 构造「权威素材」提示段（M8）。
   * 无素材时返回空串——保证既有无素材生成链路的 prompt 与改造前**逐字一致**（NFR-5 回归红线）。
   */
  private buildReferenceTextBrief(referenceText: string): string {
    const text = (referenceText || '').trim();
    if (!text) return '';
    return [
      '【权威素材 · 必须严格遵守】',
      '以下素材由调用方（RAG：知识库检索 / 文件解析 / 联网搜索）整理后提供，是本次演示事实内容的唯一权威来源。',
      '硬约束：',
      '1. 大纲与每页要点必须源自下列素材；禁止引入素材之外的具体事实、数字、时间、人名、机构名。',
      '2. 素材未覆盖的部分可用通用表述补充，但**不得编造**任何具体数据或结论。',
      '3. 素材与主题不完全匹配时，只选取与主题相关的片段，并据此组织页序。',
      '4. 素材中的关键数字/结论应原样保留，便于溯源。',
      '',
      '<<<REFERENCE_TEXT_BEGIN>>>',
      text,
      '<<<REFERENCE_TEXT_END>>>',
    ].join('\n');
  }

  /**
   * 由参考视觉属性解析本页的参考标题色/正文色（跟随参考 > 用户 > 默认三级链）。
   * 注意：未提取到时返回 undefined（而非回退值），以便调用方区分「有参考」与「无参考」，
   * 从而保留原「无参考时浅底标题升级主色」的行为。
   */
  private resolveReferenceTextColors(
    refAttrs?: ReferenceVisualAttributes,
    pageType?: string,
  ): { titleColor?: string; bodyColor?: string } {
    if (!refAttrs) return { titleColor: undefined, bodyColor: undefined };
    const cat = pageTypeToCategory(pageType ?? '');
    const titleColor = resolveAttrForPage('titleColor', refAttrs, cat, undefined) as
      string | undefined;
    const bodyColor = resolveAttrForPage('bodyColor', refAttrs, cat, undefined) as
      string | undefined;
    return { titleColor, bodyColor };
  }

  private buildSlideHtmlPrompt(
    plan: SlidePlan,
    primaryColor: string,
    primaryColorDarker: string,
    density: ContentDensity,
    iconStyle: IconStyle,
    slideWidth: number = 1280,
    slideHeight: number = 720,
    style: string = 'business',
    audience: string = '',
    colorTheme?: ColorTheme,
    fontFamily: 'sans' | 'serif' | 'mono' = 'sans',
    imagePreference: ImagePreference = 'content-only',
    backgroundEnabled: boolean = false,
    referenceHtmlBrief: string = '',
    titleColor: string = '#111827',
    bodyColor: string = '#374151',
    categoryReferenceSummary: string = '',
    referenceStructureSnippet: string = '',
    referenceColorPolicy: string = '',
    hasReference: boolean = false,
    canvasBg?: string,
  ): string {
    const imageRequirement =
      plan.needsImage && plan.imagePrompt
        ? `需要配图，图片描述：${plan.imagePrompt}，图片比例：${plan.imageRatio || '4:3'}`
        : '不需要图片，纯文字/卡片布局';
    const keyPointsRaw =
      plan.keyPoints.map((p, i) => `${i + 1}. ${p}`).join('\n') || '- （展开相关内容）';
    // 对 content-no-image / 明确不需要配图的页面额外加一道"禁止裸文本"强提醒
    // 覆盖链路：防止 LLM 被 "content-no-image" 误导为"可以写纯文本行，不用列表"
    const needsBareTextAlert =
      plan.pageType === 'content-no-image' ||
      (!plan.needsImage && plan.pageType && plan.pageType.startsWith('content-'));
    const BARE_TEXT_ALERT = `

⚠️ 【特别提醒 · 本页为纯文字内容页】
尽管本页不包含配图（content-no-image 或无需配图），上面的每一条要点仍然必须：
  1) 用 <ul><li> ... </li></ul> 列表方式输出（推荐，配合 iconStyle 图标使用）
  2) 或逐行用 <p style="font-size:24px;color:#374151;font-weight:600;line-height:2.0;overflow-wrap:break-word;word-break:break-word;">要点文字</p> 包裹
  ✖️ 绝对禁止：把要点文字裸写在 <h2> 之后、最外层 <div> 内部，不套任何 <li> 或 <p> 标签！
  ✖️ 禁止：直接写多行 "\n" 分隔的纯文本行。这样属于"裸文本"违规格式，会被后端强制返工。
`;
    const keyPointsText = needsBareTextAlert ? `${keyPointsRaw}${BARE_TEXT_ALERT}` : keyPointsRaw;
    const padX = Math.max(32, Math.round((64 * slideWidth) / 1280 / 8) * 8);
    const padY = Math.max(24, Math.round((48 * slideHeight) / 720 / 8) * 8);
    const contentWidth = slideWidth - padX * 2;
    const contentHeight = slideHeight - padY * 2;
    const templates = getPageTemplatesByPageType(
      plan.pageType,
      slideWidth,
      slideHeight,
      iconStyle,
      fontFamily,
    );

    // 参数描述插入（P1 / S2 半通修复）
    const colorThemeText: Record<ColorTheme, string> = {
      blue: '蓝色商务（专业稳重）',
      purple: '紫色创意（个性活泼）',
      green: '绿色环保（清新自然）',
      orange: '橙色活力（醒目热情）',
      teal: '青色科技（科技感强）',
      gray: '极简灰度（低调克制）',
    };
    const styleDescriptionText =
      style === 'creative'
        ? '创意风格（排版大胆活泼，色彩鲜明）'
        : style === 'simple'
          ? '极简风格（大量留白、简洁线条）'
          : '商务风格（平衡、专业稳重，默认）';
    const styleDescription = `【风格（S-1）】：${styleDescriptionText}。所有 CSS 样式、间距、装饰元素都要符合这个整体气质。`;
    const audienceHint = audience
      ? `【目标受众（S-10）】：${audience}。用词、专业度深浅、案例风格等都要贴合这个受众。`
      : '【目标受众（S-10）】：通用商务受众';
    const colorThemeHint = colorTheme
      ? `【配色主题（S-4）】：${colorThemeText[colorTheme]}。不要硬编码与配色主题冲突的颜色（例如紫色主题里写蓝色 #1D4ED8），primaryColor / primaryColorDarker 已提供正确色值，你可以做色调变化但不要出其他色系。`
      : '【配色主题（S-4）】：未显式设置（以提供的 primaryColor / primaryColorDarker 为准）';
    const iconStyleHintText: Record<IconStyle, string> = {
      auto: '智能匹配（默认使用线性SVG描边图标，简约专业，适合B端/技术/正式场景；根据语义从内置图标库选择匹配图标，整页保持统一风格，禁止混用emoji和SVG）',
      line: '线性SVG描边图标（Lucide风格，简约理性、专业冷静，主色描边+浅色圆角底，适合B端产品、技术PPT、研发平台、多图标并列场景）',
      filled:
        '面性SVG填充图标（实心色块，视觉权重高、醒目有力，白色图标+渐变实心底，适合封面、核心结论、大屏展示、重点模块）',
      numbered: '数字序号（渐变圆角方形/圆形 + 白色数字 1/2/3/4，适合步骤/流程/阶段类要点）',
      bullet:
        '对勾/圆点（简洁符号类：主色渐变圆形+白色对勾SVG，或主色10px小圆点；优势/特性项用对勾，普通列表项可用圆点）',
      lettered: '字母分类（渐变圆形 + 白色字母 A/B/C/D…，适合分类/维度/类型类要点）',
      emoji:
        'Emoji风格（仅适合内部轻松沟通/C端/年轻群体内容；B端技术方案、正式汇报、商务宣讲禁止使用emoji，应改用line线性图标）',
      none: '无图标，纯文字列表',
    };
    const iconStyleHint = `【列表图标风格（S-7）】：${iconStyleHintText[iconStyle]}。PAGE_TEMPLATES 中已包含该风格的完整 CSS，你直接选用匹配的 layout 即可，不要自己凭空重新设计。`;
    const fontFamilyHint = `【字体风格（S-11）】：${getFontFamilyDescription(fontFamily)}。PAGE_TEMPLATES 中最外层 <div style="...font-family:XXX"> 已预置正确的 font-family 栈，你**不要在自己的代码里再修改全局 font-family**（会冲突）；局部标题若想放大加粗可以保留 font-weight / font-size。`;
    const imagePrefText: Record<ImagePreference, string> = {
      all: '每页都配图（包括封面/总结）',
      'content-only': '仅内容页配图，封面/目录/总结不放图',
      minimal: '尽量少配图，主要使用文字和卡片',
      none: '不生成任何图片，纯文字/卡片布局',
    };
    const imagePreferenceHint = `【配图偏好（S-6）】：${imagePrefText[imagePreference]}。本页如果是 needsImage=true 就严格配图；本页 needsImage=false 就不要插入 <img>。`;
    const backgroundEnabledHint = `【自动背景图（S-3）】：${backgroundEnabled ? '开启（PAGE_TEMPLATES 中 cover / content / summary 等 layout 已预置背景 CSS，你直接套用即可）' : '关闭（不要写额外的背景大图 <img>，用纯色 / 浅色渐变背景即可）'}`;

    // ===== L1/L1.5 字段注入：把 Planning 阶段产出的 layoutParams/styleTheme/metricValues 等传给内容生成阶段 =====
    const layoutParamsRaw =
      plan.layoutParams && Object.keys(plan.layoutParams).length > 0 ? plan.layoutParams : null;
    const styleThemeRaw = plan.styleTheme || null;
    const metricValuesRaw =
      Array.isArray(plan.metricValues) && plan.metricValues.length > 0 ? plan.metricValues : null;
    const advantageIndicesRaw =
      Array.isArray(plan.advantageIndices) && plan.advantageIndices.length > 0
        ? plan.advantageIndices
        : null;
    const showcaseMetricsRaw =
      Array.isArray(plan.showcaseMetrics) && plan.showcaseMetrics.length > 0
        ? plan.showcaseMetrics
        : null;

    const hasL1Fields =
      layoutParamsRaw ||
      styleThemeRaw ||
      metricValuesRaw ||
      advantageIndicesRaw ||
      showcaseMetricsRaw;
    const L1_L15_HINT = !hasL1Fields
      ? ''
      : `

---
## 【L1 布局参数 + L1.5 样式主题 · Planning 阶段显式产出 · 最高优先级】
本 slide 在规划阶段已指定以下参数，生成 HTML 时**必须严格遵守**（优先级高于 PAGE_TEMPLATES 默认模板选择，高于任何示例的默认布局）：

${
  layoutParamsRaw
    ? `- layoutParams（6 维布局调整）：\`\`\`json\n${JSON.stringify(layoutParamsRaw, null, 2)}\n\`\`\`
  含义：titlePosition=标题位置(top/left/right/inline)、contentDirection=内容流向(column/row/row-reverse)、imageAnchor=图片锚点(none/left/right/top/bottom/background)、cardShape=卡片形状(rounded/pill/glass/gradient-border/solid-block)、contentAlignment=内容对齐(left/center/justify/right)、gridCols=网格列数(auto|2|3|4)。
  执行方式：如果某维度与 PAGE_TEMPLATES 默认模板不一致，**以 layoutParams 为准**调整 CSS（例：cardShape=glass → 所有卡片背景换成 backdrop-filter 玻璃样式；contentDirection=row → 要点从纵向改为横向排列；imageAnchor=background → 图片作为全屏背景而不是左/右图）。`
    : ''
}

${
  styleThemeRaw
    ? `- styleTheme（L1.5 视觉样式主题）：\`${styleThemeRaw}\`
  可选值映射：
    - none / 未指定：默认传统卡片
    - glass：所有主要卡片加 backdrop-filter:blur + 半透明白底 + 1px 白边（玻璃拟态）
    - gradient：大标题加渐变文字（background-clip:text），标题背景容器加主色渐变
    - progress-bars：每个要点 / 指标下方加 0~100% 圆角进度条（metricValues 提供百分比）
    - badges：每个要点配一个胶囊 Badge（主色背景白字），核心数值放大显示
    - colored-cards：多张卡片用蓝/绿/橙/紫/青/灰语义调色板
    - mixed：AI 自由组合以上样式（glass+progress-bars+badges 可同页混用）
  执行方式：严格按 styleTheme 值选择对应 L1.5 样式组合写 CSS，不要省略进度条/badge/glass 装饰。`
    : ''
}

${
  metricValuesRaw
    ? `- metricValues（进度条百分比数组，长度=要点数/对比项数）：\`[${metricValuesRaw.join(', ')}]\`
  使用方法：第 N 个要点的进度条 width = metricValues[N-1] + '%'，不要随意编造数值。`
    : ''
}

${
  advantageIndicesRaw
    ? `- advantageIndices（对比页右栏优势项的索引）：\`[${advantageIndicesRaw.join(', ')}]\`
  使用方法：comparison-deep-dive 等对比布局中，这些索引对应的对比项要额外显示"徽章+"、绿色对勾、进度条填充更深一档等强化样式。`
    : ''
}

${
  showcaseMetricsRaw
    ? `- showcaseMetrics（value-showcase 核心数值）：\`\`\`json\n${JSON.stringify(showcaseMetricsRaw, null, 2)}\n\`\`\`
  使用方法：每个 {label, value, trend?} 对应一张数值大卡：value 用 72~96px 巨字号 + 渐变文字（background-clip:text），label 放在下方做副标题，trend=up/down/flat 时右上角显示绿/红/灰趋势徽章（↗/↘/→）。grid 列数根据 showcaseMetrics.length 决定。`
    : ''
}

⚠️ 可编辑性红线：无论用了哪种 L1.5 样式，**装饰性子元素（进度条填充块、Badge 内文字、大 Value 数字 span、渐变装饰 halo/blob、emoji 色块）一律加 pointer-events:none;**；**有意义的容器（玻璃卡、进度条整体、大卡外壳、彩色卡片外层 div）必须显式包含非透明 background / 非零 border / ≥8px border-radius / box-shadow 四者之一**，便于 isVisualContainer 判定可选中。
---
`;

    // ===== comparison-deep-dive 5 列结构化对比维度数据卡（对齐提示，只有本页类型才追加） =====
    let COMPARISON_DATA_CARD_HINT = '';
    if (plan.pageType === 'comparison-deep-dive') {
      const leftMerged: unknown[] = (plan as any).leftKeyPoints ?? [];
      const rightMerged: unknown[] = (plan as any).rightKeyPoints ?? [];
      const metrics: number[] = Array.isArray(metricValuesRaw)
        ? metricValuesRaw
        : ((plan as any).metricValues ?? []);
      const advIdx: number[] = Array.isArray(advantageIndicesRaw)
        ? advantageIndicesRaw
        : ((plan as any).advantageIndices ?? []);
      const advSet = new Set(advIdx);
      // 缺 leftKeyPoints / rightKeyPoints 时，用 keyPoints 作为统一维度名（左右同套，避免名称错位）
      const fallbackDim = plan.keyPoints ?? [];
      const leftDims: string[] =
        leftMerged.length > 0 ? leftMerged.map(String) : fallbackDim.map(String);
      const rightDims: string[] =
        rightMerged.length > 0 ? rightMerged.map(String) : fallbackDim.map(String);
      const N = Math.max(leftDims.length, rightDims.length, metrics.length, 3);
      const padded: Array<{
        idx: number;
        left: string;
        right: string;
        metric: number;
        win: boolean;
      }> = [];
      for (let i = 0; i < N; i++) {
        padded.push({
          idx: i,
          left: leftDims[i] ?? `【缺失-补齐】维度${i + 1}基准`,
          right: rightDims[i] ?? `【缺失-补齐】维度${i + 1}升级`,
          metric: metrics[i] ?? 60,
          win: advSet.has(i),
        });
      }
      COMPARISON_DATA_CARD_HINT = `
---
## 🔴【comparison-deep-dive · 对比维度 5 列结构化数据卡（刚性对齐 · 按行生成，缺的行也要补齐占位）】
⚠️ 此表即本页生成的**唯一事实数据源**。行数 = N = ${N}。**左栏 UL 必须写 N 个 LI，右栏 UL 必须写 N 个 LI，差一行都算违规**。
每一行 i 对应的生成规则：
  - 左栏 LI[i] 标题 = 第 i 行的「左栏维度名」
  - 右栏 LI[i] 标题 = 第 i 行的「右栏维度名」
  - 右栏 LI[i] 进度条 width = metric %，必须严格用该数值（写死 85% 算违规）
  - 右栏 LI[i] 若胜出=YES → 绿色三件套（绿色对勾图标 + 绿色"胜出"徽章 + 深一档绿色渐变）；胜出=NO → 蓝色三件套（主色对勾 + 主色徽章 + 主色渐变）

| 索引 i | 左栏维度名（基准方案） | 右栏维度名（升级方案） | 右栏 进度条 metric% | 右栏 胜出（advantageIndices）|
|--------|----------------------|----------------------|--------------------|---------------------------|
${padded.map((p) => `| ${p.idx} | ${p.left} | ${p.right} | ${p.metric} | ${p.win ? '✅ YES（绿色三件套 + 深一档渐变）' : 'NO（主色三件套 + 主色渐变）'} |`).join('\n')}

### 胜出索引再强调（advantageIndices = [${advIdx.join(', ')}]）：
${advIdx.length === 0 ? '⚠️ 空数组=无胜出维度 → 请重新规划（comparison-deep-dive 至少 1 项优势，否则换 pageType）' : advIdx.map((i) => `第 ${i} 行 → 右栏胜出（✅）`).join('\n')}
### 刚性红线速记：
  ① 左右 LI 数 = ${N}，一条不差　② 禁止 LI 内嵌套 <p>　③ 进度条 width 用本表 metric 值　④ 胜出项绿色三件套缺一不可　⑤ 禁止写固定 width/height/left/top/max-width:none
---
`;
    }

    // === 主题色浅一档推导（PRIMARY_COLOR_LIGHTER：蓝→浅蓝/绿→浅绿/橙→浅橙/紫→浅紫/青→浅青）===
    const primaryColorLighter = derivePrimaryColorLighter(primaryColor);

    const referenceHtmlBriefText =
      referenceHtmlBrief ||
      (hasReference
        ? '（已上传参考文件，但本次未能提取到可落盘的 HTML 属性摘要；参考主色/字体/版式等仍以「参考文件视觉覆盖指令」为准）'
        : '（用户未上传参考文件 HTML）');

    return (
      SLIDE_HTML_GENERATION_PROMPT.replace(/\{\{PRIMARY_COLOR\}\}/g, primaryColor)
        .replace(/\{\{PRIMARY_COLOR_DARKER\}\}/g, primaryColorDarker)
        .replace(/\{\{PRIMARY_COLOR_LIGHTER\}\}/g, primaryColorLighter)
        .replace(/\{\{EXPECTED_PRIMARY_COLOR\}\}/g, primaryColor)
        .replace(/\{\{TITLE_TEXT_COLOR\}\}/g, titleColor)
        .replace(/\{\{BODY_TEXT_COLOR\}\}/g, bodyColor)
        .replace(/\{\{CANVAS_BG_COLOR\}\}/g, canvasBg || '#ffffff')
        .replace(/\{\{SLIDE_WIDTH\}\}/g, String(slideWidth))
        .replace(/\{\{SLIDE_HEIGHT\}\}/g, String(slideHeight))
        .replace(/\{\{PADDING_X\}\}/g, String(padX))
        .replace(/\{\{PADDING_Y\}\}/g, String(padY))
        .replace(/\{\{CONTENT_WIDTH\}\}/g, String(contentWidth))
        .replace(/\{\{CONTENT_HEIGHT\}\}/g, String(contentHeight))
        .replace(
          /\{\{PAGE_TEMPLATES\}\}/g,
          templates +
            L1_L15_HINT +
            (plan.pageType === 'comparison-deep-dive' ? COMPARISON_DATA_CARD_HINT : ''),
        )
        .replace(/\{\{PAGE_TYPE\}\}/g, plan.pageType)
        .replace(/\{\{PAGE_TITLE\}\}/g, plan.title)
        .replace(/\{\{KEY_POINTS\}\}/g, keyPointsText || '- （展开相关内容）')
        .replace(/\{\{IMAGE_REQUIREMENT\}\}/g, imageRequirement)
        .replace(
          /\{\{IMAGE_RATIO\}\}/g,
          plan.imageRatio || PAGE_TYPE_DEFAULT_IMAGE_RATIO[plan.pageType] || '4:3',
        )
        .replace(/\{\{DENSITY\}\}/g, density)
        .replace(/\{\{ICON_STYLE\}\}/g, iconStyle)
        .replace(/\{\{STYLE_DESCRIPTION\}\}/g, styleDescription)
        .replace(/\{\{AUDIENCE_HINT\}\}/g, audienceHint)
        .replace(/\{\{COLOR_THEME_HINT\}\}/g, colorThemeHint)
        .replace(/\{\{ICON_STYLE_HINT\}\}/g, iconStyleHint)
        .replace(/\{\{FONT_STYLE_HINT\}\}/g, fontFamilyHint)
        .replace(/\{\{IMAGE_PREFERENCE_HINT\}\}/g, imagePreferenceHint)
        .replace(/\{\{BACKGROUND_ENABLED_HINT\}\}/g, backgroundEnabledHint)
        .replace(/\{\{REFERENCE_HTML_BRIEF\}\}/g, referenceHtmlBriefText)
        .replace(/\{\{CATEGORY_REFERENCE_SUMMARY\}\}/g, categoryReferenceSummary)
        .replace(/\{\{REFERENCE_STRUCTURE_SNIPPET\}\}/g, referenceStructureSnippet)
        .replace(/\{\{REFERENCE_COLOR_POLICY\}\}/g, referenceColorPolicy) +
      `\n\n【输出语言】${
        this.language === 'en'
          ? '请使用英文撰写本页的全部可见文案（标题、要点、按钮等）。'
          : '请使用中文撰写本页的全部可见文案（标题、要点、按钮等）。'
      }`
    );
  }

  async generatePlan(
    topic: string,
    style: string,
    audience: string,
    slideSpec: SlideCountSpec,
    density: ContentDensity,
    imagePreference: ImagePreference,
    primaryColor: string,
    onProgress?: GenerationCallback,
    backgroundEnabled: boolean = false,
    pageHints: PageStructureHints = {
      contentOnly: false,
      disableCover: false,
      disableToc: false,
      disableConclusion: false,
    },
    iconStyle: IconStyle = 'auto',
    fontFamily: 'sans' | 'serif' | 'mono' = 'sans',
    colorTheme?: ColorTheme,
    referenceHtmlBrief: string = '',
    imageOptionsEnabled: boolean = true,
    referenceVisualAttributes?: ReferenceVisualAttributes,
    /** RAG 文本素材（M8）：透传给 buildPlanningPrompt 注入「权威素材」段 */
    referenceText: string = '',
  ): Promise<PresentationPlan> {
    // 纵深防御兜底：若调用方未表达任何结构偏好（全 false），而 topic 中含明确的
    // "不要封面/目录/总结"指令，则从 topic 解析补齐，避免默认页数策略静默覆盖用户意图。
    // 显式传入的 hints 优先级最高，不会被覆盖。
    let effectiveHints = pageHints;
    const callerNoPref =
      !pageHints.contentOnly &&
      !pageHints.disableCover &&
      !pageHints.disableToc &&
      !pageHints.disableConclusion;
    if (callerNoPref) {
      const topicHints = extractPageStructureHints(topic);
      if (
        topicHints.contentOnly ||
        topicHints.disableCover ||
        topicHints.disableToc ||
        topicHints.disableConclusion
      ) {
        effectiveHints = topicHints;
      }
    }
    const { planningTotal, displayText } = this.buildSlideCountGuidance(slideSpec);
    onProgress?.({
      phase: 'outline',
      current: 0,
      total: planningTotal,
      message: `正在规划演示结构（${displayText}）...`,
    });
    const refDeckPrimary = resolveDeckReferencePrimaryColor(referenceVisualAttributes);
    const userSettingsOverride = this.buildUserSettingsPriorityOverridePrompt({
      slideCount: slideSpec,
      style,
      density,
      imagePreference,
      colorTheme,
      iconStyle,
      fontFamily,
      backgroundEnabled,
      audience,
      referencePrimaryColor: refDeckPrimary,
    });
    // U-17-L · LLM 调用前一致化：
    //   先按 U-17 公式算出最终主色，再把同一个值同时用于：
    //   ① buildPlanningPrompt 里 system prompt 示例 JSON 和 配色强约束文案
    //   ② user prompt 里主色说明
    //   ③ parsePlan 后强制覆盖（U-17 原逻辑）
    // 彻底消除「system 写 #ea580c / user 写 #2563eb」的 LLM 输入矛盾。
    // FR-2.x：参考主色（deck 级代表）为绝对最高优先级，覆盖 colorTheme 默认的蓝/紫等；
    // 否则回落 computeU17EffectivePrimaryColor（与今天行为一致）。
    const effectiveColor =
      refDeckPrimary ?? computeU17EffectivePrimaryColor(style, colorTheme, primaryColor);
    const categoryReferenceSummary = referenceVisualAttributes
      ? '【参考文件提取属性 · 绝对最高优先级 · 覆盖用户显式参数与所有示例】\n' +
        formatReferenceOverrideOverview(referenceVisualAttributes)
      : '';
    const planningSnippet = referenceVisualAttributes
      ? getReferenceSnippetOverview(referenceVisualAttributes)
      : '';
    const planningColorPolicy = referenceVisualAttributes
      ? getReferenceColorPolicyOverview(referenceVisualAttributes)
      : '';
    const planningLayoutDiversity = referenceVisualAttributes
      ? getReferenceLayoutDiversityHint(referenceVisualAttributes)
      : '';
    let prompt = this.buildPlanningPrompt(
      topic,
      style,
      audience,
      slideSpec,
      density,
      imagePreference,
      backgroundEnabled,
      effectiveHints,
      iconStyle,
      fontFamily,
      colorTheme,
      referenceHtmlBrief,
      userSettingsOverride,
      effectiveColor,
      categoryReferenceSummary,
      planningSnippet,
      planningColorPolicy,
      !!referenceVisualAttributes,
      planningLayoutDiversity,
      referenceText,
    );

    const messages: ChatMessage[] = [
      { role: 'system', content: prompt },
      { role: 'user', content: `请规划这个演示文稿，主色调使用：${effectiveColor}` },
    ];
    switchStage(this.planningProvider, 'planning');
    const response = await this.planningProvider.chat(messages, {
      temperature: 0.5,
      maxTokens: 8192,
    });
    const plan = this.parsePlan(response.content);
    if (!plan.primaryColor || !/^#[0-9a-fA-F]{6}$/.test(plan.primaryColor)) {
      plan.primaryColor = effectiveColor;
    }
    // U-17 · parsePlan 后强制覆盖：
    //   使用预先计算的 effectiveColor（与上面 messages 用同一值），
    //   保持计算单源、避免重复公式产生漂移。
    if (plan.primaryColor.toLowerCase() !== effectiveColor.toLowerCase()) {
      const reason =
        colorTheme && COLOR_THEMES[colorTheme]
          ? `colorTheme=${colorTheme}`
          : `auto(style=${style})`;
      console.warn(
        `[PLAN] parsePlan 返回 primaryColor=${plan.primaryColor}，与 ${reason} 期望 ${effectiveColor} 不一致，已强制覆盖。`,
      );
    }
    plan.primaryColor = effectiveColor;

    // 范围/精确页数裁剪 + 结构强制对齐（代码握有最终控制权）
    if ('exact' in slideSpec && slideSpec.exact != null) {
      plan.slides = this.clampSlidesToCount(
        plan.slides,
        slideSpec.exact,
        effectiveHints,
        imagePreference,
      );
      plan.slides = this.enforcePageStructure(
        plan.slides,
        slideSpec.exact,
        effectiveHints,
        imagePreference,
      );
    } else if (
      'min' in slideSpec &&
      'max' in slideSpec &&
      slideSpec.min != null &&
      slideSpec.max != null
    ) {
      if (plan.slides.length < slideSpec.min) {
        plan.slides = this.clampSlidesToCount(
          plan.slides,
          slideSpec.min,
          effectiveHints,
          imagePreference,
        );
        plan.slides = this.enforcePageStructure(
          plan.slides,
          slideSpec.min,
          effectiveHints,
          imagePreference,
        );
      } else if (plan.slides.length > slideSpec.max) {
        plan.slides = this.clampSlidesToCount(
          plan.slides,
          slideSpec.max,
          effectiveHints,
          imagePreference,
        );
        plan.slides = this.enforcePageStructure(
          plan.slides,
          slideSpec.max,
          effectiveHints,
          imagePreference,
        );
      } else {
        // 在范围内，依然强制对齐结构（数量不变，但封面/toc/总结的有无和位置要正确）
        plan.slides = this.enforcePageStructure(
          plan.slides,
          plan.slides.length,
          effectiveHints,
          imagePreference,
        );
      }
    }

    // A-2.5 FR-0：参考含图强制插图（在 imagePreference 归一化之前插入，参考属性优先级高于用户设置）
    plan.slides = this.applyReferenceImageOverride(plan.slides, referenceVisualAttributes);

    // A-3 归一化：最后一道防线，无论上游决策如何，都按 imagePreference 强制对齐
    //            并且传入 imageOptionsEnabled 做防御降级（开关没开时 → 强制 pref=none）
    plan.slides = this.normalizePlanByImagePreference(
      plan.slides,
      imagePreference,
      topic,
      imageOptionsEnabled,
    );

    // A-4 【对比意图硬兜底 · comparison-deep-dive 自动补齐】
    // 只要用户写了"深度对比""性能对比""全面对比""PK""vs""A和B对比"等 25+ 关键词，就：
    //   1. 把封面/目录/总结之外的内容页（优先：正文第 1/2 张）自动 pageType 改成 comparison-deep-dive
    //   2. 自动补齐：styleTheme='mixed' + metricValues 预设数组 + advantageIndices 高值索引 + layoutParams 双栏 + needsImage=false
    // 完全不需要用户懂这些内部术语，写自然语言即可。
    const comparisonIntent = detectComparisonIntent(topic + ' ' + (style || ''));
    if (comparisonIntent.isComparison && Array.isArray(plan.slides) && plan.slides.length > 0) {
      // 决定哪些页"优先"升级成 comparison-deep-dive：
      //   - 第一个内容页（即：跳过 cover/toc 后的第 1 个内容页，索引 i>=1）
      //   - 或 LLM 已经选了对比/卡片/列表/表格这类基础页类型（content-compare/content-cards/content-list/content-table）
      //   - 如果正文只有 1 张内容页（总页数 3 = cover + 1 内容 + summary），那就把那张内容页强制升级
      const nonNavSlides = plan.slides.filter(
        (p) => !['cover', 'toc', 'conclusion', 'summary'].includes(p.pageType),
      );
      const firstContentIdx = plan.slides.findIndex(
        (p) => !['cover', 'toc', 'conclusion', 'summary'].includes(p.pageType),
      );
      const forceCount = Math.max(1, Math.min(nonNavSlides.length, 2)); // 至少升级 1 张，最多升级 2 张（避免 summary 也变对比页）
      let upgraded = 0;
      plan.slides = plan.slides.map((page, i) => {
        const isNav = ['cover', 'toc', 'conclusion', 'summary'].includes(page.pageType);
        if (isNav) return page;
        if (upgraded >= forceCount) return page;
        // 升级条件：(a) 第一内容页优先 (b) 本身已是对比/卡片/列表类基础页 (c) 该页标题/要点里隐约也有对比词
        const pageTypeEligible = [
          'content-compare',
          'content-cards',
          'content-list',
          'content-stats-highlight',
          'content-table',
        ].includes(page.pageType);
        const titleHit =
          typeof page.title === 'string' && detectComparisonIntent(page.title).isComparison;
        const isFirstContentPages =
          firstContentIdx >= 0 && i >= firstContentIdx && i < firstContentIdx + forceCount;
        if (pageTypeEligible || titleHit || isFirstContentPages) {
          upgraded++;
          return autoCompleteComparisonPage(page);
        }
        return page;
      });
    }

    return plan;
  }

  private async generateSlideHtml(
    plan: SlidePlan,
    primaryColor: string,
    primaryColorDarker: string,
    density: ContentDensity,
    iconStyle: IconStyle,
    slideWidth: number = 1280,
    slideHeight: number = 720,
    style: string = 'business',
    audience: string = '',
    colorTheme?: ColorTheme,
    fontFamily: 'sans' | 'serif' | 'mono' = 'sans',
    imagePreference: ImagePreference = 'content-only',
    backgroundEnabled: boolean = false,
    referenceHtmlBrief: string = '',
    extraFeedback?: string,
    referenceVisualAttributes?: ReferenceVisualAttributes,
    pageIndexInCategory: number = 0,
  ): Promise<string> {
    const pageReferenceOverride = referenceVisualAttributes
      ? formatReferenceOverrideForPage(
          referenceVisualAttributes,
          plan.pageType,
          pageIndexInCategory,
        )
      : '';
    const categoryReferenceSummary = pageReferenceOverride
      ? '【参考文件提取属性 · 绝对最高优先级 · 覆盖用户显式参数】\n' + pageReferenceOverride
      : '';
    // FR-参考克隆：本页只注入自身分类的参考指令（消除多份 brief 互相打架），并附骨架片段与色彩豁免
    const referenceSnippet = referenceVisualAttributes
      ? getReferenceSnippetForPage(referenceVisualAttributes, plan.pageType, pageIndexInCategory)
      : '';
    const colorPolicy = referenceVisualAttributes
      ? getReferenceColorPolicyForPage(referenceVisualAttributes, plan.pageType)
      : '';
    const refTextColors = this.resolveReferenceTextColors(referenceVisualAttributes, plan.pageType);
    let prompt = this.buildSlideHtmlPrompt(
      plan,
      primaryColor,
      primaryColorDarker,
      density,
      iconStyle,
      slideWidth,
      slideHeight,
      style,
      audience,
      colorTheme,
      fontFamily,
      imagePreference,
      backgroundEnabled,
      pageReferenceOverride || referenceHtmlBrief,
      refTextColors.titleColor,
      refTextColors.bodyColor,
      categoryReferenceSummary,
      referenceSnippet,
      colorPolicy,
      !!referenceVisualAttributes,
      referenceVisualAttributes?.byCategory?.cover?.palette?.canvasBg ||
        referenceVisualAttributes?.global?.palette?.canvasBg ||
        undefined,
    );
    if (extraFeedback) {
      prompt = prompt + '\n\n' + extraFeedback;
    }
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content:
          '你是一个严格遵循HTML规范和设计系统的前端代码生成器。只输出HTML代码，不要任何其他内容。',
      },
      { role: 'user', content: prompt },
    ];
    switchStage(this.contentProvider, 'content');
    const response = await this.contentProvider.chat(messages, {
      temperature: 0.4,
      maxTokens: 8192,
    });
    return this.extractHtml(response.content);
  }

  /**
   * T3S·b：逐页四级链应用参考视觉属性（FR-4 · Task5 全量 9 风格覆盖）。
   * 对单页，依「参考分类 > 参考全局 > 用户全局设置 > 系统默认」四级优先级，
   * 解析出 9 个风格属性的逐页生效值：
   *   primaryColor / fontFamily / iconStyle / style / density（原 5 项）
   *   + imagePreference / backgroundEnabled / pageHints / slideCount（本次补全）
   * 供 generateSlideHtml、后处理与图片升级逻辑逐页硬应用。
   * 当未传 referenceVisualAttributes 时原样返回 base，行为完全不变。
   */
  private resolvePageReferenceStyleAttrs(
    slidePlan: SlidePlan,
    rva: ReferenceVisualAttributes | undefined,
    base: {
      primaryColor: string;
      fontFamily: 'sans' | 'serif' | 'mono';
      iconStyle: IconStyle;
      style: string;
      density: ContentDensity;
      imagePreference?: ImagePreference;
      backgroundEnabled?: boolean;
      pageHints?: ReferencePageHints;
      slideCount?: number;
    },
  ): {
    primaryColor: string;
    primaryColorDarker: string;
    fontFamily: 'sans' | 'serif' | 'mono';
    iconStyle: IconStyle;
    style: string;
    density: ContentDensity;
    imagePreference: ImagePreference;
    backgroundEnabled: boolean;
    pageHints?: ReferencePageHints;
    slideCount?: number;
  } {
    const DEF = {
      primaryColor: '#2563eb',
      fontFamily: 'sans' as 'sans' | 'serif' | 'mono',
      iconStyle: 'auto' as IconStyle,
      style: 'business' as string,
      density: 'normal' as ContentDensity,
      imagePreference: 'content-only' as ImagePreference,
      backgroundEnabled: false as boolean,
    };
    if (!rva) {
      return {
        primaryColor: base.primaryColor,
        primaryColorDarker: darkenColor(base.primaryColor, 20),
        fontFamily: base.fontFamily,
        iconStyle: base.iconStyle,
        style: base.style,
        density: base.density,
        imagePreference: base.imagePreference ?? DEF.imagePreference,
        backgroundEnabled: base.backgroundEnabled ?? DEF.backgroundEnabled,
        pageHints: base.pageHints,
        slideCount: base.slideCount,
      };
    }
    const cat = pageTypeToCategory(slidePlan.pageType);
    const primaryColor =
      resolveAttrForPage('primaryColor', rva, cat, base.primaryColor, DEF.primaryColor) ??
      base.primaryColor;
    const density =
      resolveAttrForPage('contentDensity', rva, cat, base.density, DEF.density) ?? base.density;
    const iconStyle =
      resolveAttrForPage('iconStyle', rva, cat, base.iconStyle, DEF.iconStyle) ?? base.iconStyle;
    const fontFamily =
      resolveAttrForPage('fontFamily', rva, cat, base.fontFamily, DEF.fontFamily) ??
      base.fontFamily;
    const style = resolveAttrForPage('style', rva, cat, base.style, DEF.style) ?? base.style;
    const imagePreference =
      resolveAttrForPage(
        'imagePreference',
        rva,
        cat,
        base.imagePreference ?? DEF.imagePreference,
        DEF.imagePreference,
      ) ?? DEF.imagePreference;
    // 语义拆分（根治）：渲染链路中的 backgroundEnabled 仅代表用户「自动生成背景图」开关
    // （来自 base / UserSettings，即 01-request-config.json 的 backgroundEnabled）。
    // 它**不继承**参考图解析出的 style.backgroundEnabled——后者仅描述「参考图/HTML 是否自带背景」，
    // 属于版面风格属性，曾被 resolveAttrForPage 的「参考优先」误取，导致参考图「有背景」反手否决自身 hero 注入。
    // 故此处直接取用户值，跳过 resolveAttrForPage，确保两个语义彻底分离。
    const backgroundEnabled = base.backgroundEnabled ?? DEF.backgroundEnabled;
    const pageHints = resolveAttrForPage('pageHints', rva, cat, base.pageHints, undefined);
    const slideCount = resolveAttrForPage('slideCount', rva, cat, base.slideCount, undefined);
    return {
      primaryColor,
      primaryColorDarker: darkenColor(primaryColor, 20),
      fontFamily,
      iconStyle,
      style,
      density,
      imagePreference,
      backgroundEnabled,
      pageHints,
      slideCount,
    };
  }

  /**
   * L0 定量硬校验接入（Task5 / FR-4 底线）：将 l0ValidateSlide 的违规项并入 critique 结果。
   * - 致命项（如正文字号 < 12px）直接判不通过（passed=false），从而触发 critique 重试循环重新生成。
   * - 重要项（如对比度 < 4.5:1）作为 issue 记录，但不强制否决。
   * 该函数就地修改 critique 对象，调用时机应在每次 critiqueSlide 返回后。
   */
  private applyL0ToCritique(critique: SlideCritique, html: string, pageType: string): void {
    const l0 = l0ValidateSlide(html, pageType);
    if (l0.length === 0) return;
    for (const issue of l0) {
      critique.issues.push({
        severity: issue.severity,
        title: `L0硬校验·${issue.rule}`,
        current: issue.detail,
        problem: issue.detail,
        fix: '请修正该 L0 底线违规（正文字号 ≥ 12px，文本与背景对比度 ≥ 4.5:1）',
      });
    }
    if (l0.some((i) => i.severity === 'fatal')) {
      critique.passed = false;
      critique.overallScore = Math.min(critique.overallScore, 4.5);
    }
  }

  /**
   * 损坏 inline CSS 消毒（幂等）：只处理 `style="..."` / `style='...'` 内部。
   * 只补分隔符（`;` 粘接），不改任何数值/视图值，因此对已规范输入重复应用结果不变。
   * 处理三类已知 bug 拼接（LLM 丢掉属性间 `;`）：
   *   ① 值(px/em/rem/%)紧贴下一个属性名：    `padding:24px 24pxborder-radius` → `padding:24px 24px;border-radius`
   *   ② px 后直接 属性名+:  （②① 兜底后）   `gap:16pxoverflow-wrap` → `gap:16px;overflow-wrap`
   *   ③ rgba(...)//var(...) `)` 后直接下一属性 `rgba(...)color:#fff` → `rgba(...);color:#fff`
   * 视图值不变：`0 0 20px 0` 中带空格的 `20px 0` 不受影响（① 要求数字后紧邻无空格属性名）。
   */
  private sanitizeStyleSyntax(html: string): string {
    // 1) 常规闭合 style 属性处理（幂等：只补分隔符）
    const processed = html.replace(
      /(style=)(['"])([\s\S]*?)\2/gi,
      (whole, _k: string, _q: string, styleBody: string) => {
        let fixed = styleBody;
        // ① 值→下一属性名粘接（仅当值末尾无空格且下一字符为字母/连字符）
        fixed = fixed.replace(/([0-9.]+(?:px|em|rem|%))(?![0-9.\s;"'])([A-Za-z-])/g, '$1;$2');
        // ② px 后直接 属性名+:  (第一规则可能因数字带小数点未覆盖，此处兜底)
        fixed = fixed.replace(/(\d+px)([A-Za-z-]{2,}:)/g, '$1;$2');
        // ③ rgba(...)/var(...) 的 ) 后直接下一属性名:
        fixed = fixed.replace(/(\))([A-Za-z-]{2,}:)/g, '$1;$2');
        return fixed === styleBody ? whole : whole.replace(styleBody, fixed);
      },
    );

    // 2) 未闭合引号检测（到下一个 > 前无配对引号）→ 不做强拆，仅告警
    processed.replace(
      /(style=)(['"])((?:[^"'>]|(?!\2))*?)(>)/gi,
      (whole, _k: string, q: string, inner: string) => {
        console.warn('[STYLE] 未闭合引号，跳过整形:', `${q}${inner.slice(0, 60)}`);
        return whole;
      },
    );

    return processed;
  }

  /**
   * 终局消毒入口：对任意已生成 html 重放完整后处理链（幂等），供 server 写盘前兜底。
   * 仅需主色/暗色（可省略，自动推导）与 slide 画布尺寸；slidePlan 以占位 `{ pageType: '' }` 传入，
   * 链内依赖 pageType 的环节（postProcessLayout 忽略参数、ensureImageRatio 在 pageType='' 时跳过）均安全。
   */
  public postProcessHtmlSnapshot(
    html: string,
    opts: {
      primaryColor?: string;
      primaryColorDarker?: string;
      slideWidth?: number;
      slideHeight?: number;
      backgroundEnabled?: boolean;
      fontFamily?: 'sans' | 'serif' | 'mono';
      referenceVisualAttributes?: ReferenceVisualAttributes;
      pageType?: string;
    } = {},
  ): string {
    const primaryColor = (
      opts.primaryColor && /^#[0-9a-fA-F]{6}$/.test(opts.primaryColor)
        ? opts.primaryColor
        : '#2563eb'
    ).toLowerCase();
    const primaryColorDarker = opts.primaryColorDarker || darkenColor(primaryColor, 20);
    const slideWidth = opts.slideWidth || 1280;
    const slideHeight = opts.slideHeight || 720;
    const backgroundEnabled = opts.backgroundEnabled ?? false;
    const fontFamily = opts.fontFamily || 'sans';
    const slidePlan = { pageType: opts.pageType || '' } as unknown as SlidePlan;
    return this.postProcessSlideHtml(
      html,
      slidePlan,
      primaryColor,
      primaryColorDarker,
      slideWidth,
      slideHeight,
      backgroundEnabled,
      fontFamily,
      opts.referenceVisualAttributes,
    );
  }

  private postProcessSlideHtml(
    html: string,
    slidePlan: SlidePlan,
    primaryColor: string,
    primaryColorDarker: string,
    slideWidth: number,
    slideHeight: number,
    backgroundEnabled: boolean,
    fontFamily: 'sans' | 'serif' | 'mono' = 'sans',
    referenceVisualAttributes?: ReferenceVisualAttributes,
    colorPolicy?: SlideColorPolicy,
  ): string {
    console.log(`[POST] v4 sig=${POST_VERSION_SIG}`);
    let result = html;
    const steps: string[] = [];
    // 配色策略（后处理唯一颜色真源）：把参考撞色板 / 标题色 / 正文色 / 描边色作为显式白名单。
    // 未显式传入时由参考视觉属性按页推导；无参考则回落主色系（与历史行为一致）。
    const cp: SlideColorPolicy =
      colorPolicy ||
      resolveColorPolicyForPage(
        referenceVisualAttributes,
        slidePlan.pageType,
        primaryColor,
        primaryColorDarker,
      );
    try {
      result = this.sanitizeSlideHtml(result);
      steps.push('sanitizeSlideHtml');
      result = this.sanitizeStyleSyntax(result);
      steps.push('sanitizeStyleSyntax');
      // FR-B（回归修复）：配色自洽检测。若 HTML 已形成单一色相族 + 中性灰阶的自洽配色
      // （参考图驱动生成的红色系页面即属此类），则整体跳过 sanitizeGradientColors / enforceSinglePalette
      // 的颜色重写，仅在确属多色相混杂（"脏"页面）时才执行归一。这样即使终局重放取色失源
      // （finalMainColor 回落默认蓝），也只"不美化"而绝不"毁容"。
      // 向后兼容：无彩色 / 纯中性 / 单色族页面历史重写本为 no-op，跳过后逐字节一致。
      // —— 参考克隆·撞色豁免：本页存在 accent 撞色板（参考明确上传的撞色风格）时直接判为自洽，
      //    跳过单色系红线重写，使参考撞色 1:1 保真落地。
      const paletteHarmonious = cp.isMultiColor || this.detectHarmonizedPalette(result);
      if (paletteHarmonious) {
        steps.push(`palette-harmonious(skip${cp.isMultiColor ? '/reference-multicolor' : ''})`);
      } else {
        result = this.sanitizeGradientColors(result, primaryColor, primaryColorDarker, cp);
        steps.push('sanitizeGradientColors');
        result = this.enforceSinglePalette(result, primaryColor, primaryColorDarker, cp);
        steps.push('enforceSinglePalette');
      }
      result = this.enforceBodyFontSize(result);
      steps.push('enforceBodyFontSize');
      result = this.enforce8ptGrid(result);
      steps.push('enforce8ptGrid');
      result = this.fixRowImageMargins(result);
      steps.push('fixRowImageMargins');
      result = this.wrapTextNodes(result);
      steps.push('wrapTextNodes');
      result = this.flattenMeaninglessNesting(result);
      steps.push('flattenMeaninglessNesting');
      result = this.ensureSemanticWrapping(result);
      steps.push('ensureSemanticWrapping');
      // FR-4: 图片包裹完整性兜底。若前两步 flatten/semanticWrap 之后 img 仍裸奔在 flex:column 根下，强制重包。
      result = this.ensureImageProperWrapper(result);
      steps.push('ensureImageProperWrapper');
      const postTitleColor = this.resolveReferenceTextColors(
        referenceVisualAttributes,
        slidePlan.pageType,
      ).titleColor;
      const composition = resolveReferenceComposition(
        referenceVisualAttributes,
        slidePlan.pageType,
      );
      result = this.postProcessLayout(
        result,
        slidePlan.pageType,
        slideWidth,
        slideHeight,
        primaryColor,
        fontFamily,
        postTitleColor,
        cp,
        composition,
      );
      steps.push('postProcessLayout');
      result = this.ensureImageRatio(result, slidePlan);
      steps.push('ensureImageRatio');
      result = this.enforceSingleColumn(result, slidePlan.pageType || '');
      steps.push('enforceSingleColumn');
      if (backgroundEnabled && slidePlan.backgroundPrompt) {
        result = this.injectBackgroundPlaceholder(result);
      }
      steps.push('injectBackgroundPlaceholder');
      result = this.assertGrid8pt(result); // 最终防线：8pt 网格规整兜底自检
      steps.push('assertGrid8pt');
      // FR-18 §18.5：按 chart/architecture 注入受控内联 SVG（Q12/Q13；NFR-2 静默降级）
      result = this.injectStructuredGraphics(result, slidePlan, primaryColor, primaryColorDarker);
      steps.push('injectStructuredGraphics');
    } catch (e) {
      console.warn(
        `[POST] 链异常（已执行 ${steps.join('>') || '无'}），保留已处理产物:`,
        e instanceof Error ? e.message : e,
      );
    }
    return result;
  }

  /**
   * FR-18 §18.5 · 受控 SVG 注入（Q12 内联 / Q13 复用分层渲染）
   *
   * 定位 LLM 生成的图形占位符 `<div class="structured-graphic" data-graphic-slot="...">`
   * 并用对应渲染器产出的受控内联 SVG 替换其 innerHTML：
   *   - chart / bar / line / pie / donut  → renderChartSvg(slidePlan.chart)
   *   - cycle                            → renderCycleSvg(slidePlan.keyPoints)
   *   - dashboard                        → renderDashboardSvg(showcaseMetrics, chart?)
   *   - architecture                     → renderArchitectureSvg(slidePlan.architecture)
   *
   * 约束（NFR-2 降级安全）：
   *   - 任一渲染异常 / 无占位符 / 无对应结构化数据 → 静默跳过，原 HTML 原样返回，绝不抛错阻塞主流程；
   *   - 仅替换占位符内部，不改动其他 DOM；占位符缺失时不强制改写页面。
   */
  private injectStructuredGraphics(
    html: string,
    slidePlan: SlidePlan,
    primaryColor: string,
    primaryColorDarker: string,
  ): string {
    if (!html || !slidePlan) return html;
    try {
      const opts = { primaryColor, primaryColorDarker };
      // 顺序无关：用 lookahead 同时要求 class 含 structured-graphic 且存在 data-graphic-slot
      const slotRe =
        /<div\b(?=[^>]*\bclass="[^"]*structured-graphic)(?=[^>]*\bdata-graphic-slot="([^"]*)")[^>]*>([\s\S]*?)<\/div>/g;
      let injected = false;
      const out = html.replace(slotRe, (full, slot: string, _inner: string) => {
        let svg = '';
        const pt = slidePlan.pageType;
        try {
          if (slot === 'architecture' && slidePlan.architecture) {
            svg = renderArchitectureSvg(slidePlan.architecture, opts);
          } else if (slot === 'cycle' && pt === 'content-cycle') {
            svg = renderCycleSvg(slidePlan.keyPoints || [], opts);
          } else if (slot === 'dashboard' && pt === 'content-dashboard') {
            svg = renderDashboardSvg(slidePlan.showcaseMetrics || [], opts, slidePlan.chart);
          } else if (
            slidePlan.chart &&
            (slot === 'chart' ||
              slot === 'bar' ||
              slot === 'line' ||
              slot === 'pie' ||
              slot === 'donut')
          ) {
            svg = renderChartSvg(slidePlan.chart, opts);
          }
        } catch {
          svg = '';
        }
        if (!svg) return full; // 无对应 SVG：保持占位符原样，不破坏页面
        injected = true;
        return `<div class="structured-graphic" data-graphic-slot="${slot}">${svg}</div>`;
      });
      if (injected) {
        console.log(
          '[POST][injectStructuredGraphics] 已注入受控 SVG 图形（pageType=' +
            (slidePlan.pageType || '?') +
            '）',
        );
      }
      return out;
    } catch (e) {
      console.warn(
        `[POST][injectStructuredGraphics] 注入失败，降级跳过:`,
        e instanceof Error ? e.message : e,
      );
      return html;
    }
  }

  /**
   * 单列兜底：对图片侧栏页（content-image-left/right）强制所有 <ul>/<ol> 列表单列 flex-column，
   * 消除模型偶发仍生成的双列 grid 布局。仅对这两种 pageType 生效，其余 pageType 原样返回。幂等（二次调用结果不变）。
   */
  private enforceSingleColumn(html: string, pageType: string): string {
    if (pageType !== 'content-image-left' && pageType !== 'content-image-right') {
      return html;
    }
    return html.replace(/<(ul|ol)\b([^>]*)/gi, (whole, tag: string, attrs: string) => {
      const sm = /style\s*=\s*(['"])([\s\S]*?)\1/gi.exec(attrs);
      if (!sm) return whole;
      const styleAttrWhole = sm[0];
      const quote = sm[1];
      const styleBody = sm[2];
      // 仅当 style 含 grid/repeat/minmax/column-count 时才需要重构
      if (!/(grid|\brepeat\b|\bminmax|column-count)/i.test(styleBody)) {
        return whole;
      }
      let fixed = styleBody;
      // a) display:grid → display:flex
      fixed = fixed.replace(/display\s*:\s*grid/gi, 'display:flex');
      // b) grid-template-columns:repeat(2|3,1fr) → flex-direction:column
      fixed = fixed.replace(
        /grid-template-columns\s*:\s*repeat\(\s*[23]\s*,\s*1fr\s*\)/gi,
        'flex-direction:column',
      );
      // c) 双值 gap（空格分隔）→ gap:24px
      fixed = fixed.replace(/gap\s*:\s*\d+(?:\.\d+)?px\s+\d+(?:\.\d+)?px/gi, 'gap:24px');
      // d) 其余 grid-template-columns 变体（repeat(3,..) / repeat(auto-fill|auto-fit|minmax(...,...)) 等）→ 删除该属性
      fixed = fixed.replace(/grid-template-columns\s*:\s*[^;"']*?;?/gi, '');
      // 保证 flex-direction:column 在场（b/d 已写入；a 只改 display）
      if (!/flex-direction\s*:\s*column/i.test(fixed)) {
        fixed = fixed.replace(/;\s*$/, '') + (fixed ? ';' : '') + 'flex-direction:column;';
      }
      if (fixed === styleBody) return whole;
      const newAttrs = attrs.replace(styleAttrWhole, `style=${quote}${fixed}${quote}`);
      return `<${tag}${newAttrs}`;
    });
  }

  /**
   * 重生成外部反馈规范化：把用户/评审反馈里的“要双列”“要改某个具体 #hex 色”等与模板固定红线冲突的指令，
   * 软化为“保持本页单列 / 使用当前主题主色”的指导句。采用“追加规范化句 + 软化冲突子串”，不激进删句（保语义）。
   */
  private sanitizeRegenerationFeedback(
    feedback: string,
    pageType: string,
    primaryColor: string,
    allowedColors: string[] = [],
  ): string {
    if (!feedback) return feedback;
    let text = feedback;

    // 1) 图片侧栏页禁止双列建议：把冲突子串软化为“保持单列”，再追加规范化句
    if (
      (pageType === 'content-image-left' || pageType === 'content-image-right') &&
      /双列|两列|加一列|增列|铺两列|grid/i.test(text)
    ) {
      text = text
        .replace(/建议\s*(?:双列|两列|grid|Grid)/gi, '（建议保持本页单列）')
        .replace(/改用\s*(?:双列|两列|grid|Grid)/gi, '（改用单列）')
        .replace(/(?:铺\s*两列|加一列|增列|双列|两列)/gi, '（保持单列）')
        .replace(/\bgrid\b/gi, '（单列）');
      text = `${text}\n【保持本页单列】本页为图片侧栏布局，列表必须单列 flex-column，禁止双列 Grid。`;
    }

    // 2) 颜色建议：出现具体 #hex 且非“已修复”描述语境 → 软化为主题主色
    if (/#[0-9a-fA-F]{6}/.test(text) && !/已修复/i.test(text)) {
      const allowed = new Set(allowedColors.map((c) => (c || '').toLowerCase()));
      text = text.replace(/#[0-9a-fA-F]{6}/gi, (m) =>
        allowed.has(m.toLowerCase()) ? m : `${primaryColor || '{{PRIMARY_COLOR}}'}`,
      );
      const darker = primaryColor ? darkenColor(primaryColor, 20) : '{{PRIMARY_COLOR_DARKER}}';
      text = `${text}\n【使用当前主题主色】不要引入其他十六进制色，仅用 ${primaryColor || '{{PRIMARY_COLOR}}'}/${darker} 与中性灰阶。`;
    }

    // 3) 字号类反馈 tie-break（2025-07 R2 修复）：
    //    当 critique 反馈 H2/H3 字号违规，而 fixedConstraints 又写了「li/p 18/19/20px」时，
    //    LLM 会把后者解释成全局 20px 上限，造成 regenerate 永远生成 20px 的 H2。
    //    本段显式把标题/metric 的合法白名单写在 safeFeedback 末尾（LLM 对末段服从度更高）。
    if (/字号|font-size|font-weight|H1|H2|H3|标题|层级|过小|过大|违规/.test(text)) {
      text =
        `${text}\n⚠️ 【最高优先级兜底】无论上面的反馈或建议如何描述，以下字号层级白名单必须严格遵守，不得混淆、不得降格：\n` +
        `· H1 封面主标题：font-size 必须 = 88~92px；\n` +
        `· H2 页面标题：font-size 必须 = 50 或 52px（绝对禁止 H2 ≤ 20px，会被审核 fatal）；\n` +
        `· H3 卡片标题：font-size 必须 = 28~32px（绝对禁止 H3 ≤ 20px）；\n` +
        `· Metric 大字徽章（数值 +0.5℃ / +1.2℃ / 百分比 等单独 span 的大号数字）：font-size 必须 ≥ 48px 且通常为 56px，伴随 font-weight:900 与 line-height:1；\n` +
        `· 封面海报副标题 / 内容强调小标题：32~36px 或 26~28px 二选一；\n` +
        `· 正文 li/p/span：**仅限 18 / 19 / 20px 三种**（仅此三种属于「正文大字上限 20px」规则）；\n` +
        `· 辅助文字 / badge 胶囊：16~18px。\n` +
        `若 critique 反馈「H2/H3 过小 → 请增大到白名单指定数值」，绝对不要为了满足『li/p 上限 20px』而把 H2/H3 改成 20px。`;
    }

    return text;
  }

  /**
   * 判断 HTML 开标签 attrs 字符串是否命中「标题类豁免」：
   *  1) role="heading"（ARIA 标题，等价 H1-6）
   *  2) class 中包含 hero-title / page-title / slide-title / cover-title 关键词
   */
  private isHeadingExempt(attrs: string): boolean {
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
  private isMetricExempt(styleBody: string, upper: string, fontSizePx: number): boolean {
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
  private clampStyleFontSize(
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
      if (extraAttrs && this.isHeadingExempt(extraAttrs)) return full;
      // Metric 大字豁免（数值徽章类 span/div/p，详见 isMetricExempt）
      if (this.isMetricExempt(styleBody, tagHint, v)) return full;

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
  private clampAllStylesByTag(
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
        const newBody = this.clampStyleFontSize(styleBody, upper, modifiedRef, attrsFull);
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
  private enforceBodyFontSize(html: string, options?: { round?: 1 | 2 }): string {
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
        if (BODY_FONT_SIZE_EXEMPT_TAGS.has(upper) || this.isHeadingExempt(attrs)) return m;
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
          return `style=${q}${this.clampStyleFontSize(body, upper, modifiedRef, attrs)}${q}`;
        });
        // 2) 内部所有 style：逐个定位到所属子标签名 clamp（不再传 '*'，修复 R1）
        const newInner = this.clampAllStylesByTag(inner, modifiedRef);
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
  private enforce8ptGrid(html: string): string {
    // 决策 4 间距豁免：封面页 h1 之后、font-size ≥ 24px 的副标题 p 跳过 8pt 规整，保留封面排版间距。
    const skip = this.buildCoverSubtitleSpacingSkip(html);
    return normalizeSpacing8pt(html, skip);
  }

  /** 8pt 网格兜底自检：整条后处理链末尾运行；若 style 内 margin/padding/gap 仍发现非 8 倍数，
   *  console.warn 并自动规整，无违规则返回原串。作为最终防线修复前面步骤引入的间距。
   *  同样接入决策 4 间距豁免谓词：Step6 写入的封面副标题 margin 由本函数在链末规整，必须同步跳过。 */
  private assertGrid8pt(html: string): string {
    const skip = this.buildCoverSubtitleSpacingSkip(html);
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
  private buildCoverSubtitleSpacingSkip(html: string): SpacingSkipPredicate {
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
  private fixRowImageMargins(html: string): string {
    return html.replace(
      /(<div[^>]*style=")([^"]*)("[^>]*>\s*<img[^>]*data-image-ratio)/gi,
      (full, pre: string, styleBody: string, rest: string) => {
        const bm = /flex:\s*0\s+0\s+(\d{1,3})%/.exec(styleBody);
        const pct = bm ? parseInt(bm[1], 10) : 0;
        if (!(pct === 45 || pct === 50 || pct === 55)) return full; // 仅 row 两列切分
        const next = styleBody.replace(/(\s*(?:margin-top|margin-bottom)\s*:\s*[^;"']*?;?)/gi, '');
        if (next === styleBody) return full;
        return `${pre}${next}${rest}`;
      },
    );
  }

  async generatePresentation(
    topic: string,
    options?: PresentationGenerationOptions,
  ): Promise<HTMLPresentation> {
    const startBeijingTime = formatBeijingTime();
    let timestamp = formatBeijingTime();
    console.log(
      `\n[${timestamp}] [AGENT] ========== Starting presentation generation (v2 two-phase) ==========`,
    );
    console.log(`[${timestamp}] [AGENT] Start time (Beijing): ${startBeijingTime}`);
    console.log(`[${timestamp}] [AGENT] Topic: ${topic}`);
    console.log(
      `[${timestamp}] [AGENT] Planning model: ${this.planningProvider.name}/${this.planningProvider.config.model}`,
    );
    console.log(
      `[${timestamp}] [AGENT] Content model: ${this.contentProvider.name}/${this.contentProvider.config.model}`,
    );
    console.log(
      `[${timestamp}] [AGENT] Editing model: ${this.editingProvider.name}/${this.editingProvider.config.model}`,
    );

    const style = options?.style || 'business';
    const audience = options?.audience || '';
    const density = options?.density || 'normal';
    const imagePreference = options?.imagePreference || 'content-only';
    // 归一化iconStyle：将旧值checkmark/minimal映射到bullet（向后兼容本地存储旧值）
    const rawIconStyle = (options?.iconStyle || 'auto') as string;
    const iconStyle: IconStyle =
      rawIconStyle === 'checkmark' || rawIconStyle === 'minimal'
        ? 'bullet'
        : (rawIconStyle as IconStyle);
    const fontFamily = options?.fontFamily || 'sans';
    const referenceHtml = options?.referenceHtml || '';
    const colorTheme = options?.colorTheme;
    this.language = options?.language === 'en' ? 'en' : 'zh';

    // 三级优先级解析：slideCountSpec (exact | range)
    // 1. 前端显式范围
    // 2. 前端显式单值
    // 3. 从主题智能提取（新 extractSlideCountSpec）
    // 4. 兜底：{ exact: 8 }
    let slideSpec: SlideCountSpec;
    if (typeof options?.slideCountMin === 'number' && typeof options?.slideCountMax === 'number') {
      const min = Math.max(1, Math.min(options.slideCountMin, options.slideCountMax));
      const max = Math.max(1, Math.max(options.slideCountMin, options.slideCountMax));
      slideSpec = { min, max };
    } else if (typeof options?.slideCount === 'number') {
      slideSpec = { exact: Math.max(1, options.slideCount) };
    } else {
      const topicSpec = extractSlideCountSpec(topic);
      slideSpec = topicSpec || { exact: 8 };
    }

    // 从主题中提取用户显式的结构禁用指令（高优先级覆盖页数策略）
    const pageStructureHints = extractPageStructureHints(topic);

    // S5：检测 topic 中与高级选项冲突的描述（仅日志，不删除不修改）
    this.sanitizeTopicSettingsConflict(topic, {
      slideCount: slideSpec,
      colorTheme,
      style,
      imagePreference,
    });

    const primaryColor = this.getPrimaryColor(style, colorTheme, options?.primaryColor);
    const imageEnabled = options?.imageOptions?.enabled && imagePreference !== 'none';
    const backgroundEnabled = options?.backgroundEnabled || false;

    // S1：生成 referenceHtml 摘要（≤500 字符），两侧 prompt 都注入
    const referenceHtmlBrief =
      options?.referenceHtmlBrief || this.summarizeReferenceHtmlBrief(referenceHtml);
    const referenceVisualAttributes = options?.referenceVisualAttributes;

    const slideDesc =
      'exact' in slideSpec ? `${slideSpec.exact} 页` : `${slideSpec.min}-${slideSpec.max} 页`;
    console.log(
      `[${timestamp}] [AGENT] Params: style=${style}, density=${density}, imagePref=${imagePreference}, slides=${slideDesc} (slideSpec=${JSON.stringify(slideSpec)}), primaryColor=${primaryColor}, fontFamily=${fontFamily}, iconStyle=${iconStyle}, audience=${audience || '(empty)'}, colorTheme=${colorTheme || '(none)'}, refHtmlLen=${referenceHtml.length}, bg=${backgroundEnabled}`,
    );
    console.log(
      `[${timestamp}] [AGENT] Image generation: ${imageEnabled ? 'enabled' : 'disabled'}, Background: ${backgroundEnabled ? 'enabled' : 'disabled'}, pageHints=${JSON.stringify(pageStructureHints)}`,
    );
    if (imageEnabled && options?.imageOptions) {
      console.log(
        `[${timestamp}] [AGENT] Image model: ${options.imageOptions.model}, defaultSize: ${options.imageOptions.size}`,
      );
    }

    const onProgress = options?.onProgress;

    // 打开 trace session 以捕获 planning 阶段的 trace
    // 如果调用方（如服务端）已经在 provider 上设置了 activeTraceSessionId，则复用它，
    // 避免覆盖后导致调用方用旧 sessionId 取不到 traces。
    let traceSessionId = (this.planningProvider as TraceableProvider).activeTraceSessionId;
    let ownTraceSession = false;
    if (!traceSessionId) {
      traceSessionId = `trace_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      openTraceSession(traceSessionId);
      (this.planningProvider as TraceableProvider).activeTraceSessionId = traceSessionId;
      ownTraceSession = true;
    }
    // 每页重生成熔断计数在本次生成开始时清零，保证按次生成独立
    resetRetryCount(keyOf(traceSessionId));

    const plan = await this.generatePlan(
      topic,
      style,
      audience,
      slideSpec,
      density,
      imagePreference,
      primaryColor,
      onProgress,
      backgroundEnabled,
      pageStructureHints,
      iconStyle,
      fontFamily,
      colorTheme,
      referenceHtmlBrief,
      // generatePlan 内的 normalizePlanByImagePreference 需要判断开关是否开启
      // （注意：imageOptions.enabled 是布尔 + imagePreference !== 'none' 的逻辑组合在调用方已处理，
      //       这里只传 imageOptions.enabled 本身即可）
      options?.imageOptions?.enabled ?? false,
      referenceVisualAttributes,
      options?.referenceText || '',
    );
    timestamp = formatBeijingTime();
    console.log(
      `[${timestamp}] [AGENT] Plan generated: ${plan.slides.length} slides, title: "${plan.title}", primaryColor: ${plan.primaryColor}`,
    );

    try {
      return await this.generateFromPlan(topic, plan, options, traceSessionId);
    } finally {
      if (ownTraceSession && traceSessionId) {
        closeTraceSession(traceSessionId);
      }
    }
  }

  async generateFromPlan(
    topic: string,
    plan: PresentationPlan,
    options?: PresentationGenerationOptions,
    traceSessionId?: string,
  ): Promise<HTMLPresentation> {
    const style = options?.style || 'business';
    const density = options?.density || 'normal';
    // 归一化iconStyle：将旧值checkmark/minimal映射到bullet（向后兼容本地存储旧值）
    const rawIconStyle = (options?.iconStyle || 'auto') as string;
    const iconStyle: IconStyle =
      rawIconStyle === 'checkmark' || rawIconStyle === 'minimal'
        ? 'bullet'
        : (rawIconStyle as IconStyle);
    const fontFamily = options?.fontFamily || 'sans';
    const colorTheme = options?.colorTheme;

    const primaryColor = this.getPrimaryColor(style, colorTheme, options?.primaryColor);
    // 主色单源：planning LLM 可能返回"猜蓝"等任意合法 hex，这里强制以 theme/用户显式色为准，
    // 杜绝 plan.primaryColor 与 effective 主色不一致（曾导致 regenerate 通道整页变蓝）
    plan.primaryColor = primaryColor;

    const design: DesignProposal = {
      id: 'default',
      name: 'Default',
      description: '',
      primaryColor,
      colorTheme: colorTheme || undefined,
      fontFamily: fontFamily as 'sans' | 'serif' | 'mono',
      styleTheme: 'mixed',
      density: density as ContentDensity,
      iconStyle: iconStyle as IconStyle,
      coverHtml: '',
    };

    let ownTraceSession = false;
    if (!traceSessionId) {
      traceSessionId = `trace_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      openTraceSession(traceSessionId);
      ownTraceSession = true;
    }

    try {
      const rendered = await this.renderSlides(topic, plan, design, options, traceSessionId);
      const assembled = await this.assembleImages(
        topic,
        rendered,
        plan,
        design,
        options,
        traceSessionId,
      );
      const presentation = await this.finalizePresentation(
        topic,
        assembled,
        plan,
        design,
        options,
        traceSessionId,
      );
      presentation.plan = plan;
      presentation.design = design;
      return presentation;
    } finally {
      if (ownTraceSession && traceSessionId) {
        closeTraceSession(traceSessionId);
      }
    }
  }

  async renderSlides(
    _topic: string,
    plan: PresentationPlan,
    design: DesignProposal,
    options?: PresentationGenerationOptions,
    traceSessionId?: string,
  ): Promise<RenderedSlide[]> {
    const style = options?.style || 'business';
    const audience = options?.audience || '';
    const density = design.density;
    const imagePreference = options?.imagePreference || 'content-only';
    // 归一化iconStyle：将旧值checkmark/minimal映射到bullet（向后兼容本地存储旧值）
    const finalIconStyle = (options?.iconStyle || design.iconStyle || 'auto') as string;
    const iconStyle: IconStyle =
      finalIconStyle === 'checkmark' || finalIconStyle === 'minimal'
        ? 'bullet'
        : (finalIconStyle as IconStyle);
    const fontFamily = options?.fontFamily || design.fontFamily;
    const referenceHtml = options?.referenceHtml || '';
    const colorTheme = options?.colorTheme || design.colorTheme;
    // 参考视觉属性前置读取，供主色裁决使用（原位于 2712 处，后移至此，避免逐页后处理引用时尚未定义）
    const referenceVisualAttributes = options?.referenceVisualAttributes;

    // FR-0/FR-4：参考主色前置裁决（参考 > 用户显式 > 主题 > 默认蓝）。
    // 无参考时 refDeckPrimary 为 undefined，完整回落原 5 级链，行为与改造前逐字节一致。
    const refDeckPrimary = resolveDeckReferencePrimaryColor(referenceVisualAttributes);
    const primaryColor = refDeckPrimary ?? resolveEffectivePrimaryColor(options, design, '#2563eb');

    // 设计参数生效日志：展示 renderSlides 实际使用的 effective 参数
    console.log(
      `[DESIGN] effective: style=${style} colorTheme=${colorTheme} primaryColor=${primaryColor}(single-source${refDeckPrimary ? ', reference-first' : ''}) iconStyle=${iconStyle} fontFamily=${fontFamily} audience=${audience || ''}`,
    );
    // 一致性告警（防线）：用户显式给了 colorTheme 但未显式给 primaryColor 时，effective 主色应等于 theme 色。
    // 参考主色生效属预期不一致（参考 > 用户全局设置），跳过以避免噪音掩盖真实问题。
    if (
      !refDeckPrimary &&
      options?.colorTheme &&
      !options?.primaryColor &&
      primaryColor.toLowerCase() !== (COLOR_THEMES[options.colorTheme] || '').toLowerCase()
    ) {
      console.warn(
        `[DESIGN] primaryColor(${primaryColor}) 与 colorTheme(${options.colorTheme}) 不一致，应为 ${COLOR_THEMES[options.colorTheme]}（用户未显式指定主色时）。`,
      );
    }

    const imgProvider = (options?.imageProvider || this.provider) as AIModelProvider;
    const imageEnabled = options?.imageOptions?.enabled && imagePreference !== 'none';
    const backgroundEnabled = options?.backgroundEnabled || false;
    const slideWidth = options?.slideWidth || 1280;
    const slideHeight = options?.slideHeight || 720;

    // S1：生成 referenceHtml 摘要（≤500 字符），两侧 prompt 都注入
    const referenceHtmlBrief =
      options?.referenceHtmlBrief || this.summarizeReferenceHtmlBrief(referenceHtml);

    const onProgress = options?.onProgress;

    // Trace session：若外部已传入则复用；否则自行打开并在结束时关闭
    let ownTraceSession = false;
    if (!traceSessionId) {
      traceSessionId = `trace_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      openTraceSession(traceSessionId);
      ownTraceSession = true;
    }
    (this.contentProvider as TraceableProvider).activeTraceSessionId = traceSessionId;
    (this.editingProvider as TraceableProvider).activeTraceSessionId = traceSessionId;
    if (imgProvider && typeof imgProvider === 'object') {
      (imgProvider as TraceableProvider).activeTraceSessionId = traceSessionId;
    }

    try {
      const startIdx = Math.max(0, options?.startIndex ?? 0);
      const endIdx = Math.min(plan.slides.length, options?.endIndex ?? plan.slides.length);
      const indicesToRender: number[] = [];
      for (let i = startIdx; i < endIdx; i++) indicesToRender.push(i);
      const renderCount = indicesToRender.length;

      const limit = pLimit(Math.min(3, Math.max(1, renderCount)));
      const critiqueEnabled = options?.critique?.enabled ?? false;
      const critiqueThreshold = options?.critique?.threshold ?? DEFAULT_THRESHOLD;
      const critiqueMaxRetries = options?.critique?.maxRetries ?? DEFAULT_MAX_RETRIES;
      const llmCritiqueEnabled = critiqueEnabled && (options?.critique?.llmCritique ?? true);
      onProgress?.({
        phase: 'content',
        current: 0,
        total: renderCount,
        message: '正在生成幻灯片内容...',
      });
      const htmlResults = await Promise.all(
        indicesToRender.map((originalIdx) =>
          limit(async () => {
            const slidePlan = plan.slides[originalIdx];
            const baseCat: PageCategory = pageTypeToCategory(slidePlan.pageType);
            // 计算本页在所属分类内的序号（第 0 页才克隆参考结构），供布局映射与逐页参考指令复用（共享函数：等价内联）
            const pageIndexInCategory = computePageIndexInCategory(plan.slides, originalIdx);
            const referenceContext: ReferenceContext =
              buildReferenceContext(referenceVisualAttributes);
            let master: ReferenceMaster | undefined = referenceVisualAttributes
              ? resolveMasterForPage(referenceVisualAttributes, baseCat)
              : undefined;
            // FR-0：把参考原图作为整页背景（CSS 开窗），封面/总结页强制插图
            if (slidePlan.referenceHeroImage?.src) {
              master = {
                ...(master ?? {}),
                heroImage: {
                  src: slidePlan.referenceHeroImage.src,
                  ...(slidePlan.referenceHeroImage.bbox ?? {}),
                },
              } as ReferenceMaster;
            }
            // FR-0/FR-4：逐页用参考主色覆盖（参考 > deck 级兜底），与内容阶段 formatReferenceOverrideForPage 逐页语义一致
            const pageRefPrimary = resolveReferencePrimaryColor(
              referenceVisualAttributes,
              String(slidePlan.pageType ?? ''),
            );
            const pagePrimary = pageRefPrimary ?? primaryColor;
            const rp = this.resolvePageReferenceStyleAttrs(slidePlan, referenceVisualAttributes, {
              primaryColor: pagePrimary,
              fontFamily,
              iconStyle,
              style,
              density,
              imagePreference,
              backgroundEnabled,
            });
            // Q4（FR-0 兜底配图）：用户关闭 AI 生图（imagePreference==='none'）且参考图含图时，
            // 把该分类参考原图作为「兜底配图」挂到本页（复用现有 hero 注入链路，带蒙版），
            // 避免内容页全篇无图。可被 options.referenceFallbackImage=false 关闭。
            const fallbackEnabled =
              ((options as any)?.referenceFallbackImage ?? true) && rp.imagePreference === 'none';
            if (fallbackEnabled && !slidePlan.referenceHeroImage?.src) {
              const refHero = resolveHeroImageForPage(
                referenceVisualAttributes,
                slidePlan.pageType,
              );
              if (refHero?.src) {
                slidePlan.referenceHeroImage = { src: refHero.src, ...(refHero.bbox ?? {}) };
                master = {
                  ...(master ?? {}),
                  heroImage: { src: refHero.src, ...(refHero.bbox ?? {}) },
                } as ReferenceMaster;
              }
            }
            // Task5 · 布局字段写入（FR-18 §18.2）：参考 layout 1:1 映射为内置 pageType，按分类作用域生效（复用 pageIndexInCategory）
            if (referenceVisualAttributes) {
              const resolvedLayout = resolveLayoutForPage(
                referenceVisualAttributes,
                baseCat,
                pageIndexInCategory,
                slidePlan.pageType,
              );
              if (resolvedLayout) slidePlan.pageType = resolvedLayout;
            }
            // FR-0/FR-4 兜底：保证 slidePlan.pageType 非空，使生成结果与终局防线能按页取到正确分类
            // （空 pageType 会让 pageTypeToCategory 回落 'content'，封面/总结无法取到各自参考色；且 undefined 不会落盘）。
            if (!slidePlan.pageType) {
              slidePlan.pageType =
                originalIdx === 0
                  ? 'cover'
                  : originalIdx === plan.slides.length - 1
                    ? 'summary'
                    : 'content-no-image';
            }
            const designContext = {
              style: rp.style,
              primaryColor: rp.primaryColor,
              fontFamily: rp.fontFamily,
              iconStyle: rp.iconStyle,
            };
            const t0 = formatBeijingTime();
            console.log(
              `[${t0}] [AGENT] Generating HTML for slide ${originalIdx + 1} (${slidePlan.pageType}): "${slidePlan.title}"`,
            );
            try {
              let html = await this.generateSlideHtmlSafe(
                slidePlan,
                rp,
                slideWidth,
                slideHeight,
                audience,
                colorTheme,
                referenceHtmlBrief,
                undefined,
                referenceVisualAttributes,
                pageIndexInCategory,
              );
              html = this.postProcessSlideHtml(
                html,
                slidePlan,
                rp.primaryColor,
                rp.primaryColorDarker,
                slideWidth,
                slideHeight,
                rp.backgroundEnabled,
                rp.fontFamily,
                referenceVisualAttributes,
              );

              let critiqueResult: SlideCritique | null = null;
              let attempts = 1;

              if (llmCritiqueEnabled) {
                critiqueResult = await critiqueSlide(
                  this.contentProvider,
                  slidePlan.title || `幻灯片 ${originalIdx + 1}`,
                  html,
                  slidePlan.pageType || 'content-no-image',
                  designContext,
                  {
                    threshold: critiqueThreshold,
                    maxRetries: critiqueMaxRetries,
                    slideWidth,
                    slideHeight,
                    referenceContext,
                  },
                );
                if (critiqueResult)
                  this.applyL0ToCritique(
                    critiqueResult,
                    html,
                    slidePlan.pageType || 'content-no-image',
                  );
                attempts = 1;

                while (!critiqueResult.passed && attempts <= critiqueMaxRetries) {
                  const st = incRetryCount(keyOf(traceSessionId), originalIdx, 'critique');
                  console.log(
                    `[RETRY] page=${originalIdx + 1} stage=critique attempt=${st.channelCount} total=${st.total} score=${critiqueResult.overallScore}`,
                  );
                  if (st.channelCount > CHANNEL_BUDGET.critique) {
                    console.warn(
                      `[RETRY] 通道 critique 配额已尽（${CHANNEL_BUDGET.critique}），页 ${originalIdx + 1} 保留当前版本不再重试（regenerationLimited）`,
                    );
                    break;
                  }
                  if (st.total >= MAX_RETRY_PER_SLIDE) {
                    console.warn(
                      `[RETRY] 页 ${originalIdx + 1} 已达重试上限 ${MAX_RETRY_PER_SLIDE}，保留当前版本不再重试（regenerationLimited）`,
                    );
                    break;
                  }
                  attempts++;
                  onProgress?.({
                    phase: 'critique',
                    current: originalIdx,
                    total: renderCount,
                    message: `第 ${originalIdx + 1} 页评审未通过（${critiqueResult.overallScore}分），第 ${attempts} 次重新生成...`,
                    critique: {
                      slideIndex: originalIdx,
                      slideTitle: slidePlan.title || `幻灯片 ${originalIdx + 1}`,
                      attempt: attempts,
                      maxAttempts: critiqueMaxRetries + 1,
                      score: critiqueResult.overallScore,
                      passed: false,
                      issues: critiqueResult.issues.map((i) => i.title),
                    },
                  });
                  console.log(
                    `[${formatBeijingTime()}] [CRITIQUE] Slide ${originalIdx + 1} score=${critiqueResult.overallScore}, retry ${attempts}/${critiqueMaxRetries + 1}. Issues: ${critiqueResult.issues.map((i) => i.title).join('; ')}`,
                  );

                  const feedback = buildCritiqueFeedback(critiqueResult);

                  html = await this.generateSlideHtmlSafe(
                    slidePlan,
                    rp,
                    slideWidth,
                    slideHeight,
                    audience,
                    colorTheme,
                    referenceHtmlBrief,
                    feedback,
                    referenceVisualAttributes,
                    pageIndexInCategory,
                  );
                  html = this.postProcessSlideHtml(
                    html,
                    slidePlan,
                    rp.primaryColor,
                    rp.primaryColorDarker,
                    slideWidth,
                    slideHeight,
                    backgroundEnabled,
                    rp.fontFamily,
                    referenceVisualAttributes,
                  );

                  critiqueResult = await critiqueSlide(
                    this.contentProvider,
                    slidePlan.title || `幻灯片 ${originalIdx + 1}`,
                    html,
                    slidePlan.pageType || 'content-no-image',
                    designContext,
                    {
                      threshold: critiqueThreshold,
                      maxRetries: critiqueMaxRetries,
                      slideWidth,
                      slideHeight,
                      referenceContext,
                    },
                  );
                  if (critiqueResult)
                    this.applyL0ToCritique(
                      critiqueResult,
                      html,
                      slidePlan.pageType || 'content-no-image',
                    );
                }

                if (critiqueResult.passed) {
                  console.log(
                    `[${formatBeijingTime()}] [CRITIQUE] Slide ${originalIdx + 1} PASSED with score=${critiqueResult.overallScore} after ${attempts} attempt(s)`,
                  );
                } else {
                  console.warn(
                    `[${formatBeijingTime()}] [CRITIQUE] Slide ${originalIdx + 1} still failing after ${attempts} attempts (score=${critiqueResult.overallScore}), using best available version`,
                  );
                }

                onProgress?.({
                  phase: 'critique',
                  current: originalIdx,
                  total: renderCount,
                  message: `第 ${originalIdx + 1} 页评审${critiqueResult.passed ? '通过' : '未通过'}（${critiqueResult.overallScore}分）`,
                  critique: {
                    slideIndex: originalIdx,
                    slideTitle: slidePlan.title || `幻灯片 ${originalIdx + 1}`,
                    attempt: attempts,
                    maxAttempts: critiqueMaxRetries + 1,
                    score: critiqueResult.overallScore,
                    passed: critiqueResult.passed,
                    issues: critiqueResult.issues.map((i) => i.title),
                  },
                });
              }

              console.log(
                `[${formatBeijingTime()}] [AGENT] Slide ${originalIdx + 1} HTML generated (${html.length} chars, critique=${critiqueResult?.overallScore ?? 'N/A'})`,
              );
              onProgress?.({
                phase: 'content',
                current: originalIdx + 1,
                total: renderCount,
                message: `已生成 ${originalIdx + 1}/${plan.slides.length} 页内容`,
              });
              // Task5 · 母版 DOM 硬注入（FR-3）：critique 之后、return 之前
              html = applyMasterToSlideHtml(html, master);
              return {
                success: true as const,
                html,
                plan: slidePlan,
                originalIdx,
                imagePreference: rp.imagePreference,
                backgroundEnabled: rp.backgroundEnabled,
                critique: critiqueResult
                  ? {
                      score: critiqueResult.overallScore,
                      passed: critiqueResult.passed,
                      attempts,
                      issues: critiqueResult.issues.map((i) => i.title),
                    }
                  : undefined,
              };
            } catch (e) {
              console.warn(
                `[${formatBeijingTime()}] [AGENT] Failed to generate slide ${originalIdx + 1}, using fallback:`,
                e,
              );
              const fallback = this.generateFallbackSlide(
                slidePlan,
                rp.primaryColor,
                slideWidth,
                slideHeight,
                rp.fontFamily,
                rp.iconStyle,
              );
              // Task5 · fallback 分支同样注入母版（AC-18 五页全覆盖）
              return {
                success: true as const,
                html: applyMasterToSlideHtml(fallback, master),
                plan: slidePlan,
                originalIdx,
              };
            }
          }),
        ),
      );

      const slides: HTMLSlide[] = htmlResults.map((r) => {
        // 统一出口幂等兜底：确保每一页都注入母版层 / 背景（覆盖任何绕过逐页注入的支路，如历史样本 slide-03）。
        // 同一份 html 上重复 applyMasterToSlideHtml 是幂等的（已含 data-master / noppt-master-layer 则跳过）。
        const sp = r.plan;
        const cat = pageTypeToCategory(sp.pageType || 'content');
        let m: ReferenceMaster | undefined = referenceVisualAttributes
          ? resolveMasterForPage(referenceVisualAttributes, cat)
          : undefined;
        if (m && sp.referenceHeroImage?.src) {
          m = {
            ...m,
            heroImage: { src: sp.referenceHeroImage.src, ...(sp.referenceHeroImage.bbox ?? {}) },
          } as ReferenceMaster;
        }
        let html = r.html;
        if (m) html = applyMasterToSlideHtml(html, m);
        return {
          title: sp.title || plan.slides[r.originalIdx]?.title || `幻灯片 ${r.originalIdx + 1}`,
          html,
          pageType: sp.pageType,
          imagePrompt: sp.imagePrompt,
          imageRatio: sp.imageRatio || PAGE_TYPE_DEFAULT_IMAGE_RATIO[sp.pageType] || undefined,
          notes: undefined,
          critique: (r as any).critique,
          imagePreference: (r as any).imagePreference,
          backgroundEnabled: (r as any).backgroundEnabled,
          _originalIdx: r.originalIdx,
        };
      });

      // ========== 兜底 1：当用户明确偏好配图时，将"纯文字/非带图类型 slide"升级为带图布局 ==========
      if (imageEnabled && (imagePreference === 'content-only' || imagePreference === 'all')) {
        for (const s of slides) {
          const originalIdx = (s as any)._originalIdx as number;
          const sp = plan.slides[originalIdx];
          const pt = s.pageType || 'content-no-image';
          const alreadyHasImg = /<img\b/i.test(s.html);
          if (alreadyHasImg) continue;
          const isImageType =
            pt === 'content-image-left' ||
            pt === 'content-image-right' ||
            pt === 'content-image-top';
          const isStructure = pt === 'cover' || pt === 'toc' || pt === 'summary';
          const slideImgPref: ImagePreference = (s as any).imagePreference || imagePreference;
          let shouldUpgrade = false;
          if (slideImgPref === 'all') {
            shouldUpgrade = !isImageType;
          } else {
            shouldUpgrade = !isStructure && !isImageType;
          }
          if (!shouldUpgrade) continue;
          // ——— FR-1 (fix-slide-comparison-image-disaster)：L1 高级版式（含 cards/compare/timeline）一律不升级为带图布局 ———
          const NEVER_UPGRADE_FOR_IMAGE: ReadonlySet<string> = new Set([
            'comparison-deep-dive',
            'content-value-showcase',
            'content-stats-highlight',
            'content-image-background',
            'content-zigzag',
            'content-cards',
            'content-compare',
            'content-timeline',
            'content-table',
            // ===== FR-18 扩展（全部 needsImage=false，禁止强制升带图）=====
            'content-flowchart',
            'content-org-chart',
            'content-pyramid',
            'content-matrix',
            'content-quote',
            'content-three-section',
            'content-process-steps',
            'content-icon-grid',
            'content-section-divider',
            'content-testimonial',
            'content-chart-bar',
            'content-chart-line',
            'content-chart-pie',
            'content-chart-donut',
            'content-cycle',
            'content-dashboard',
          ]);
          if (NEVER_UPGRADE_FOR_IMAGE.has(pt)) continue;
          const meaningfulBody = isStructure
            ? this.slideHasMeaningfulBody(s.html) || Boolean(s.title)
            : this.slideHasMeaningfulBody(s.html);
          if (!meaningfulBody) continue;

          let layoutPageType: 'content-image-left' | 'content-image-top' = 'content-image-left';
          let targetImageRatio: '4:3' | '16:9' = '4:3';
          if (pt === 'cover' || pt === 'summary') {
            layoutPageType = 'content-image-top';
            targetImageRatio = '16:9';
          } else if (pt === 'toc') {
            layoutPageType = 'content-image-top';
            targetImageRatio = '16:9';
          } else {
            // ——— FR-1 双锁：保护版式本不该进这里，再判一次避免被绕过 ———
            const NEVER_UPGRADE_FOR_IMAGE2: ReadonlySet<string> = new Set([
              'comparison-deep-dive',
              'content-value-showcase',
              'content-stats-highlight',
              'content-image-background',
              'content-zigzag',
              'content-cards',
              'content-compare',
              'content-timeline',
              'content-table',
            ]);
            if (NEVER_UPGRADE_FOR_IMAGE2.has(pt)) continue;
            layoutPageType = 'content-image-left';
            targetImageRatio = '4:3';
          }

          const upgraded = this.injectImagePlaceholderForContentSlide(
            s.html,
            layoutPageType,
            plan.primaryColor,
          );
          if (upgraded !== s.html) {
            console.log(
              `[${formatBeijingTime()}] [AGENT] Slide ${originalIdx + 1} "${s.title}" (${pt}): upgrading → ${layoutPageType} (placeholder injected, imagePref=${imagePreference})`,
            );
            s.html = upgraded;
            if (!s.imageRatio) s.imageRatio = targetImageRatio;
            s.pageType = layoutPageType;
            if (sp) {
              sp.pageType = layoutPageType;
              sp.needsImage = true;
              if (!sp.imageRatio) sp.imageRatio = targetImageRatio;
            }
          }
        }
      }

      // ========== 兜底 2：占位符一致性强制校验 ==========
      if (imageEnabled && imgProvider.generateImage) {
        for (const s of slides) {
          const originalIdx = (s as any)._originalIdx as number;
          const sp = plan.slides[originalIdx];
          const needsPerPlan =
            sp?.needsImage && sp?.pageType && PAGE_TYPE_DEFAULT_IMAGE_RATIO[sp.pageType] !== null;
          const hasImageInHtml = /<img\b/i.test(s.html);
          const hasPlaceholder = s.html.includes(IMAGE_PLACEHOLDER);
          // 参考逐页 imagePreference='none' 的页面不应被强制注入占位符
          const slideImgPref2: ImagePreference = (s as any).imagePreference || imagePreference;
          if (
            needsPerPlan &&
            slideImgPref2 !== 'none' &&
            !hasImageInHtml &&
            !hasPlaceholder &&
            sp?.pageType
          ) {
            const injected = this.injectImagePlaceholderForContentSlide(
              s.html,
              sp.pageType,
              plan.primaryColor,
            );
            if (injected !== s.html) {
              console.log(
                `[${formatBeijingTime()}] [AGENT] Slide ${originalIdx + 1} "${s.title}": pre-image-gen check FAIL → placeholder injected (pageType=${sp.pageType})`,
              );
              s.html = injected;
              if (!s.imageRatio) s.imageRatio = PAGE_TYPE_DEFAULT_IMAGE_RATIO[sp.pageType] || '4:3';
            } else {
              console.warn(
                `[${formatBeijingTime()}] [AGENT] Slide ${originalIdx + 1} "${s.title}": pre-image-gen placeholder injection FAILED (layout irregular), will fallback to orphan rescue on server side`,
              );
            }
          }
        }
      }

      let rendered: RenderedSlide[] = slides.map((s) => {
        const originalIdx = (s as any)._originalIdx as number;
        return {
          title: s.title,
          html: s.html,
          pageType: s.pageType!,
          imagePrompt: s.imagePrompt,
          imageRatio: s.imageRatio,
          backgroundPrompt: plan.slides[originalIdx]?.backgroundPrompt,
          critique: s.critique,
        };
      });

      if (options?.postHtmlAuditHook) {
        try {
          rendered = await options.postHtmlAuditHook(rendered, { plan, design, traceSessionId });
        } catch (e) {
          console.warn(
            `[${formatBeijingTime()}] [AGENT] postHtmlAuditHook failed, fallback to original slides:`,
            e instanceof Error ? e.message : e,
          );
        }
      }

      return rendered;
    } finally {
      if (ownTraceSession && traceSessionId) {
        closeTraceSession(traceSessionId);
      }
    }
  }

  async regenerateSingleSlide(
    _topic: string,
    plan: PresentationPlan,
    design: DesignProposal,
    slideIndex: number,
    options?: PresentationGenerationOptions,
    traceSessionId?: string,
    externalFeedback?: string,
    channel: string = 'placeholder',
    originalHtml?: string,
  ): Promise<RenderedSlide> {
    const style = options?.style || 'business';
    const audience = options?.audience || '';
    const density = design.density;
    const imagePreference = options?.imagePreference || 'content-only';
    const rawIconStyle = (design.iconStyle || 'auto') as string;
    const iconStyle: IconStyle =
      rawIconStyle === 'checkmark' || rawIconStyle === 'minimal'
        ? 'bullet'
        : (rawIconStyle as IconStyle);
    const fontFamily = design.fontFamily;
    const referenceHtml = options?.referenceHtml || '';
    const colorTheme = design.colorTheme;
    // 参考视觉属性前置读取，供主色裁决使用
    const referenceVisualAttributes = options?.referenceVisualAttributes;
    // FR-0/FR-4：参考主色前置裁决（参考 > 用户显式 > 主题 > 默认蓝）
    const refDeckPrimary = resolveDeckReferencePrimaryColor(referenceVisualAttributes);
    const primaryColor = refDeckPrimary ?? resolveEffectivePrimaryColor(options, design, '#2563eb');
    const primaryColorDarker = darkenColor(primaryColor, 20);
    console.log(
      `[DESIGN] effective: style=${style} colorTheme=${colorTheme} primaryColor=${primaryColor}(single-source${refDeckPrimary ? ', reference-first' : ''})`,
    );
    const backgroundEnabled = options?.backgroundEnabled || false;
    const slideWidth = options?.slideWidth || 1280;
    const slideHeight = options?.slideHeight || 720;
    const referenceHtmlBrief =
      options?.referenceHtmlBrief || this.summarizeReferenceHtmlBrief(referenceHtml);
    const critiqueEnabled = options?.critique?.enabled ?? false;
    const critiqueThreshold = options?.critique?.threshold ?? DEFAULT_THRESHOLD;
    const critiqueMaxRetries = options?.critique?.maxRetries ?? DEFAULT_MAX_RETRIES;
    const llmCritiqueEnabled = critiqueEnabled && (options?.critique?.llmCritique ?? true);
    const slidePlan = plan.slides[slideIndex];
    const baseCat: PageCategory = pageTypeToCategory(slidePlan.pageType);
    const referenceContext: ReferenceContext = buildReferenceContext(referenceVisualAttributes);
    let master: ReferenceMaster | undefined = referenceVisualAttributes
      ? resolveMasterForPage(referenceVisualAttributes, baseCat)
      : undefined;
    // FR-0：把参考原图作为整页背景（CSS 开窗），封面/总结页强制插图
    if (slidePlan.referenceHeroImage?.src) {
      master = {
        ...(master ?? {}),
        heroImage: {
          src: slidePlan.referenceHeroImage.src,
          ...(slidePlan.referenceHeroImage.bbox ?? {}),
        },
      } as ReferenceMaster;
    }
    // FR-0/FR-4：逐页用参考主色覆盖（参考 > deck 级兜底）
    const pageRefPrimary = resolveReferencePrimaryColor(
      referenceVisualAttributes,
      String(slidePlan.pageType ?? ''),
    );
    const pagePrimary = pageRefPrimary ?? primaryColor;
    const rp = this.resolvePageReferenceStyleAttrs(slidePlan, referenceVisualAttributes, {
      primaryColor: pagePrimary,
      fontFamily,
      iconStyle,
      style,
      density,
      imagePreference,
      backgroundEnabled,
    });
    // 计算本页在所属分类内的序号（第 0 页才克隆参考结构），供布局映射与逐页参考指令复用（共享函数：等价内联，置于 if 块外对下方 generateSlideHtml 可见）
    const pageIndexInCategory = computePageIndexInCategory(plan.slides, slideIndex);
    // Task5 · 布局字段写入（FR-18 §18.2）：参考 layout 1:1 映射为内置 pageType，单页按分类作用域生效
    if (referenceVisualAttributes) {
      const resolvedLayout = resolveLayoutForPage(
        referenceVisualAttributes,
        baseCat,
        pageIndexInCategory,
        slidePlan.pageType,
      );
      if (resolvedLayout) slidePlan.pageType = resolvedLayout;
    }
    const designContext = {
      style: rp.style,
      primaryColor: rp.primaryColor,
      fontFamily: rp.fontFamily,
      iconStyle: rp.iconStyle,
    };

    if (!slidePlan) {
      throw new Error(`Slide index ${slideIndex} not found in plan`);
    }

    let ownTraceSession = false;
    if (!traceSessionId) {
      traceSessionId = `trace_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      openTraceSession(traceSessionId);
      ownTraceSession = true;
    }
    (this.contentProvider as TraceableProvider).activeTraceSessionId = traceSessionId;

    try {
      // 每页重生成熔断（与 renderSlides critique 循环 / generatePresentation 共享预算；按通道独立配额限流）
      const st = incRetryCount(keyOf(traceSessionId), slideIndex, channel);
      console.log(
        `[RETRY] page=${slideIndex + 1} stage=${channel} attempt=${st.channelCount} total=${st.total}`,
      );
      const channelBudget = CHANNEL_BUDGET[channel] ?? 1;
      const limitedResult = (limitedHtml: string): RenderedSlide => ({
        title: slidePlan.title || `幻灯片 ${slideIndex + 1}`,
        html: limitedHtml,
        pageType: slidePlan.pageType,
        imagePrompt: slidePlan.imagePrompt,
        imageRatio:
          slidePlan.imageRatio || PAGE_TYPE_DEFAULT_IMAGE_RATIO[slidePlan.pageType] || undefined,
        backgroundPrompt: plan.slides[slideIndex]?.backgroundPrompt,
      });
      if (st.channelCount > channelBudget) {
        console.warn(
          `[RETRY] 通道 ${channel} 配额已尽（${channelBudget}），页 ${slideIndex + 1} 跳过本次重生成（regenerationLimited）`,
        );
        // AC-6 / Task6 / FR-5: budget 超支时保留 originalHtml（如果有）作为最优可用形态，
        // 而不是替换为 generateFallbackSlide（纯文本极简），否则会与 VLM warn 叠加触发 finalGuard 再降级到灰药丸（灾难级）。
        if (originalHtml && typeof originalHtml === 'string' && originalHtml.trim().length > 0) {
          console.log(
            `[RETRY] 页 ${slideIndex + 1} 命中 originalHtml，保留原始 HTML（放弃 generateFallbackSlide 降级）。`,
          );
          return limitedResult(applyMasterToSlideHtml(originalHtml, master));
        }
        console.warn(
          `[RETRY] 页 ${slideIndex + 1} originalHtml 未传，被迫使用 generateFallbackSlide（请补齐调用方 originalHtml）。`,
        );
        return limitedResult(
          applyMasterToSlideHtml(
            this.generateFallbackSlide(
              slidePlan,
              rp.primaryColor,
              slideWidth,
              slideHeight,
              rp.fontFamily,
              rp.iconStyle,
            ),
            master,
          ),
        );
      }
      if (st.total >= MAX_RETRY_PER_SLIDE) {
        console.warn(
          `[RETRY] 页 ${slideIndex + 1} 已达上限，跳过本次重生成（regenerationLimited）`,
        );
        if (originalHtml && typeof originalHtml === 'string' && originalHtml.trim().length > 0) {
          console.log(
            `[RETRY] 页 ${slideIndex + 1} 命中 originalHtml，保留原始 HTML（MAX_RETRY_PER_SLIDE 熔断）。`,
          );
          return limitedResult(applyMasterToSlideHtml(originalHtml, master));
        }
        console.warn(
          `[RETRY] 页 ${slideIndex + 1} originalHtml 未传，被迫使用 generateFallbackSlide（MAX_RETRY_PER_SLIDE）。`,
        );
        return limitedResult(
          applyMasterToSlideHtml(
            this.generateFallbackSlide(
              slidePlan,
              rp.primaryColor,
              slideWidth,
              slideHeight,
              rp.fontFamily,
              rp.iconStyle,
            ),
            master,
          ),
        );
      }

      // 重生成外部反馈规范化 + 固定约束块（始终在场）
      // 2025-07 R2 修复：把「正文li/p 仅限 18/19/20px」升级为【完整字号层级白名单】。
      //   - 旧写法会让 LLM 误解为「所有字号上限 20px」，导致 H2/metric 合法大字被降为 20px；
      //   - 新写法显式给出 H1/H2/H3/metric 大字的合法范围及绝对禁止项，并明确「仅 li/p/span 正文限 18~20px」。
      const regenPageType = slidePlan.pageType || '';
      const refText = this.resolveReferenceTextColors(referenceVisualAttributes, regenPageType);
      const safeFeedback = externalFeedback
        ? this.sanitizeRegenerationFeedback(
            externalFeedback,
            regenPageType,
            primaryColor,
            [refText.titleColor, refText.bodyColor].filter((c): c is string => !!c),
          )
        : '';
      const fixedConstraints =
        `[本页固定约束] pageType=${regenPageType} | 列数=图片页单列(flex-column) | 主色=${primaryColor} / darker=${primaryColorDarker}\n` +
        `· 字号层级（严格遵守，不得相互混淆；H1/H2/H3/metric 不适用「正文 20px 上限」）：\n` +
        `  ① H1 封面主标题 88~92px；② H2 页面标题 50~52px（H2 绝对禁止 ≤ 20px）；③ H3 卡片标题 28~32px；\n` +
        `  ④ Metric 数值大字徽章（单 span 展示的 +N℃ / 百分比）：≥ 48px，常为 56px，font-weight:900 + line-height:1；\n` +
        `  ⑤ 正文 li/p/span：仅允许 18 / 19 / 20px 三种（仅此三种适用 20px 上限）；\n` +
        `  ⑥ 辅助文字 / badge 胶囊：16~18px。`;
      const regenerationGuidance = safeFeedback
        ? `${fixedConstraints}\n\n${safeFeedback}`
        : fixedConstraints;

      let html = await this.generateSlideHtml(
        slidePlan,
        rp.primaryColor,
        rp.primaryColorDarker,
        rp.density,
        rp.iconStyle,
        slideWidth,
        slideHeight,
        rp.style,
        audience,
        colorTheme,
        rp.fontFamily,
        rp.imagePreference,
        rp.backgroundEnabled,
        referenceHtmlBrief,
        regenerationGuidance,
        referenceVisualAttributes,
        pageIndexInCategory,
      );
      html = this.postProcessSlideHtml(
        html,
        slidePlan,
        rp.primaryColor,
        rp.primaryColorDarker,
        slideWidth,
        slideHeight,
        rp.backgroundEnabled,
        rp.fontFamily,
        referenceVisualAttributes,
      );

      let critiqueResult: SlideCritique | null = null;
      let attempts = 1;

      if (llmCritiqueEnabled) {
        const combinedFeedback = (base: string) =>
          externalFeedback ? `${externalFeedback}\n\n【文本评审反馈】\n${base}` : base;
        critiqueResult = await critiqueSlide(
          this.contentProvider,
          slidePlan.title || `幻灯片 ${slideIndex + 1}`,
          html,
          slidePlan.pageType || 'content-no-image',
          designContext,
          {
            threshold: critiqueThreshold,
            maxRetries: critiqueMaxRetries,
            slideWidth,
            slideHeight,
            referenceContext,
          },
        );
        if (critiqueResult)
          this.applyL0ToCritique(critiqueResult, html, slidePlan.pageType || 'content-no-image');

        while (!critiqueResult.passed && attempts <= critiqueMaxRetries) {
          attempts++;
          const feedback = combinedFeedback(buildCritiqueFeedback(critiqueResult));
          html = await this.generateSlideHtml(
            slidePlan,
            rp.primaryColor,
            rp.primaryColorDarker,
            rp.density,
            rp.iconStyle,
            slideWidth,
            slideHeight,
            rp.style,
            audience,
            colorTheme,
            rp.fontFamily,
            rp.imagePreference,
            rp.backgroundEnabled,
            referenceHtmlBrief,
            feedback,
            referenceVisualAttributes,
            pageIndexInCategory,
          );
          html = this.postProcessSlideHtml(
            html,
            slidePlan,
            rp.primaryColor,
            rp.primaryColorDarker,
            slideWidth,
            slideHeight,
            rp.backgroundEnabled,
            rp.fontFamily,
            referenceVisualAttributes,
          );
          critiqueResult = await critiqueSlide(
            this.contentProvider,
            slidePlan.title || `幻灯片 ${slideIndex + 1}`,
            html,
            slidePlan.pageType || 'content-no-image',
            designContext,
            {
              threshold: critiqueThreshold,
              maxRetries: critiqueMaxRetries,
              slideWidth,
              slideHeight,
              referenceContext,
            },
          );
          if (critiqueResult)
            this.applyL0ToCritique(critiqueResult, html, slidePlan.pageType || 'content-no-image');
        }
      }

      // Task5 · 母版 DOM 硬注入（FR-3）：critique 之后、return 之前
      html = applyMasterToSlideHtml(html, master);
      return {
        title: slidePlan.title || plan.slides[slideIndex]?.title || `幻灯片 ${slideIndex + 1}`,
        html,
        pageType: slidePlan.pageType,
        imagePrompt: slidePlan.imagePrompt,
        imageRatio:
          slidePlan.imageRatio || PAGE_TYPE_DEFAULT_IMAGE_RATIO[slidePlan.pageType] || undefined,
        backgroundPrompt: plan.slides[slideIndex]?.backgroundPrompt,
        critique: critiqueResult
          ? {
              score: critiqueResult.overallScore,
              passed: critiqueResult.passed,
              attempts,
              issues: critiqueResult.issues.map((i) => i.title),
            }
          : undefined,
      };
    } finally {
      if (ownTraceSession && traceSessionId) {
        closeTraceSession(traceSessionId);
      }
    }
  }

  async assembleImages(
    topic: string,
    renderedSlides: RenderedSlide[],
    plan: PresentationPlan,
    _design: DesignProposal,
    options?: PresentationGenerationOptions,
    traceSessionId?: string,
  ): Promise<RenderedSlide[]> {
    const slides: HTMLSlide[] = renderedSlides.map((s) => ({
      title: s.title,
      html: s.html,
      pageType: s.pageType,
      imagePrompt: s.imagePrompt,
      imageRatio: s.imageRatio as ImageRatio | undefined,
      notes: undefined,
      critique: (s as any).critique,
    }));

    const imgProvider = (options?.imageProvider || this.provider) as AIModelProvider;
    const imagePreference = options?.imagePreference || 'content-only';
    const imageEnabled = options?.imageOptions?.enabled && imagePreference !== 'none';
    const backgroundEnabled = options?.backgroundEnabled || false;
    const onProgress = options?.onProgress;

    let ownTraceSession = false;
    if (!traceSessionId) {
      traceSessionId = `trace_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      openTraceSession(traceSessionId);
      ownTraceSession = true;
    }
    (this.contentProvider as TraceableProvider).activeTraceSessionId = traceSessionId;
    (this.editingProvider as TraceableProvider).activeTraceSessionId = traceSessionId;
    if (imgProvider && typeof imgProvider === 'object') {
      (imgProvider as TraceableProvider).activeTraceSessionId = traceSessionId;
    }

    try {
      if (imageEnabled && imgProvider.generateImage) {
        // 切换 LLM trace 阶段标签为 images，便于后续日志分离
        switchStage(imgProvider, 'images');
        const timestamp = formatBeijingTime();
        console.log(`[${timestamp}] [AGENT] Starting parallel image generation...`);
        onProgress?.({
          phase: 'images',
          current: 0,
          total: slides.length,
          message: '正在生成配图...',
        });

        const imgLimit = pLimit(2);
        let successCount = 0;
        let failCount = 0;

        await Promise.all(
          slides.map((slide, idx) =>
            imgLimit(async () => {
              const slidePlan = plan.slides[idx];
              const needsImagePerPlan =
                slidePlan?.needsImage &&
                slidePlan.pageType &&
                PAGE_TYPE_DEFAULT_IMAGE_RATIO[slidePlan.pageType] !== null;
              let hasPlaceholder = slide.html.includes(IMAGE_PLACEHOLDER);
              // 兜底 A：计划明确说要配图，但 LLM 生成 HTML 时漏写占位符 → 现在注入后继续生成
              if (needsImagePerPlan && !hasPlaceholder && slidePlan?.pageType) {
                const injected = this.injectImagePlaceholderForContentSlide(
                  slide.html,
                  slidePlan.pageType,
                  plan.primaryColor,
                );
                if (injected !== slide.html) {
                  console.log(
                    `[${formatBeijingTime()}] [AGENT] Slide ${idx + 1} "${slide.title}": plan needs image but placeholder missing → injected, will generate`,
                  );
                  slide.html = injected;
                  hasPlaceholder = true;
                }
              }
              // 兜底 B：即便计划没说要，但 HTML 里已经有了占位符（来自升级逻辑或 LLM 自发）→ 也生成
              const shouldGenerate = (needsImagePerPlan || hasPlaceholder) && hasPlaceholder;
              if (!shouldGenerate) {
                onProgress?.({
                  phase: 'images',
                  current: idx + 1,
                  total: slides.length,
                  message: `配图进度 ${idx + 1}/${slides.length}`,
                });
                return;
              }
              const ratio =
                slide.imageRatio ||
                slidePlan?.imageRatio ||
                PAGE_TYPE_DEFAULT_IMAGE_RATIO[slidePlan.pageType!] ||
                '4:3';
              const allModels = options?.imageOptions?.allModels || [];
              const routing = options?.imageOptions?.routing;
              const defaultModel = options?.imageOptions?.model || imgProvider.config.model;
              const { modelName: selectedModel } = selectImageModel(
                allModels.map((m, i) => ({ ...m, index: i })),
                slidePlan.pageType!,
                ratio as ImageRatio,
                routing,
                defaultModel,
              );
              const selectedModelObj = allModels.find((m) => m.modelName === selectedModel);
              const selectedModelSizes = selectedModelObj?.sizes;
              const selectedModelPixelRanges = selectedModelObj?.pixelRanges;
              // —— 运行时诊断：用户现在看到 size=2048x2048 时到底卡在哪一步了 ——
              // —— 核心原则（用户要求 "严格以 ratio 优先，无法确定才用默认尺寸"）：
              //    当 ratio 明确存在（非 1:1 或 任意已确定的 ImageRatio），一律信任 ratio，
              //    除非 ratio=1:1 或 ratio 完全拿不到（plan+HTML 都没写）才用 imageOptions.size。
              //    这样：imageOptions.size 只是"方形兜底默认尺寸"，不再作为全局覆盖一切的强约束。
              const __beforeTargetSize = options?.imageOptions?.size as ImageSize | undefined;
              // 分析配置 size 本身的比例（如果存在）
              const cfgW =
                __beforeTargetSize && /^(\d+)x(\d+)$/.test(__beforeTargetSize)
                  ? parseInt(__beforeTargetSize.match(/^(\d+)x(\d+)$/)![1], 10)
                  : 0;
              const cfgH =
                __beforeTargetSize && /^(\d+)x(\d+)$/.test(__beforeTargetSize)
                  ? parseInt(__beforeTargetSize.match(/^(\d+)x(\d+)$/)![2], 10)
                  : 0;
              const cfgIsSquare = cfgW > 0 && cfgH > 0 && cfgW === cfgH;
              // 判断"ratio 是否明确可信任"：只有 ratio=1:1 或 ratio 根本取不到才尊重配置 size
              const ratioKnown: boolean =
                ratio === '1:1' ||
                ratio === '4:3' ||
                ratio === '3:4' ||
                ratio === '16:9' ||
                ratio === '9:16' ||
                ratio === '3:2' ||
                ratio === '2:3' ||
                ratio === '21:9';
              // 尊重配置 size 的条件：
              //   a) ratio=1:1 且 cfg 是方形 → cfg 就是 1:1 尺寸的精确指定；
              //   b) ratio 未知 → cfg 是默认尺寸。
              // 其他情况：ratio 明确，一律交给 getImageSizeForRatio，不被 cfg 覆盖
              let effectiveFixedSize: ImageSize | undefined;
              let whyIgnoredCfg = '';
              if (ratio === '1:1') {
                if (cfgIsSquare) {
                  effectiveFixedSize = __beforeTargetSize; // ratio=1:1 且 cfg 方形 → 尊重
                } else {
                  effectiveFixedSize = undefined; // ratio=1:1 但 cfg 非方形 → 信任 ratio=1:1，忽略 cfg
                  whyIgnoredCfg = `ratio=1:1 但 cfgSize(${__beforeTargetSize}) 非方形，忽略cfg`;
                }
              } else if (!ratioKnown) {
                effectiveFixedSize = __beforeTargetSize; // ratio 拿不到 → cfg 做默认
              } else {
                // ratio 已知且非 1:1 → 严格以 ratio 为准，不管 cfg size 是什么
                effectiveFixedSize = undefined;
                whyIgnoredCfg = `ratio=${ratio}，严格按ratio计算尺寸，忽略cfgSize=${__beforeTargetSize ?? '<none>'}`;
              }
              // 本地调试时，只要有机会走智能尺寸就打完整链路诊断日志
              if (!effectiveFixedSize || /^(\d+)x(\d+)$/.test(effectiveFixedSize)) {
                const msg = (() => {
                  const hasSizes = !!(selectedModelSizes && selectedModelSizes.length);
                  const hasRanges = !!(selectedModelPixelRanges && selectedModelPixelRanges.length);
                  const sizeList = hasSizes
                    ? selectedModelSizes!.map((s) => `${s.width}x${s.height}`).join(',')
                    : '<empty>';
                  const rangeList = hasRanges
                    ? selectedModelPixelRanges!
                        .map(
                          (r) =>
                            `${(r.minPixels / 1048576).toFixed(2)}-${(r.maxPixels / 1048576).toFixed(2)}M`,
                        )
                        .join(',')
                    : '<empty>';
                  return `seedSize-dbg slide=${idx + 1} model=${selectedModel} ratio=${ratio} hasSizes=${hasSizes}(${sizeList}) hasRanges=${hasRanges}(${rangeList}) cfgSize=${__beforeTargetSize ?? '<none>'} useCfgAsIs=${Boolean(effectiveFixedSize)} whyIgnored=${whyIgnoredCfg || '<ratio respected>'}`;
                })();
                console.log(`[${formatBeijingTime()}] [AGENT] ${msg}`);
              }
              const targetSize =
                effectiveFixedSize ||
                getImageSizeForRatio(
                  selectedModel,
                  ratio as ImageRatio,
                  selectedModelSizes,
                  selectedModelPixelRanges,
                );
              const rawImagePrompt =
                slidePlan?.imagePrompt ||
                `${topic} - ${slide.title}，商务级专业插画品质，细腻细节，高完成度画面，整体配色与主题协调`;
              const imagePrompt = this.sanitizeImagePrompt(rawImagePrompt, plan.primaryColor);
              try {
                const images = await imgProvider.generateImage!(imagePrompt, {
                  model: selectedModel,
                  size: targetSize,
                  quality: options?.imageOptions?.quality,
                  n: 1,
                  referenceImage: options?.referenceImage,
                  // FR-15：按 slide pageType 选取对应分类的参考图作为 img2img seed（provider 内部按分类选取）
                  referenceImageByCategory: this.buildReferenceSeedMap(options),
                  referenceCategory: slide.pageType,
                  // 扩展字段：给 imageProvider 的 trace 使用，便于日志定位 slide 页号和标题
                  ...({
                    scene: `slide-${idx + 1} "${slide.title}" (primary, ratio=${ratio})`,
                  } as any),
                });
                if (images && images.length > 0 && images[0].url) {
                  slide.html = replaceImagePlaceholderWithRealSrc(
                    slide.html,
                    images[0].url,
                    ratio as ImageRatio,
                  );
                  successCount++;
                  console.log(
                    `[${formatBeijingTime()}] [AGENT] Slide ${idx + 1}: image generated with ${selectedModel} (targetSize=${targetSize}, ratio=${ratio})`,
                  );
                } else {
                  failCount++;
                  this.removeImagePlaceholder(slide);
                }
              } catch (e) {
                failCount++;
                console.warn(
                  `[${formatBeijingTime()}] [AGENT] Slide ${idx + 1} image generation failed (${selectedModel}), removing placeholder:`,
                  e,
                );
                this.removeImagePlaceholder(slide);
              }
              onProgress?.({
                phase: 'images',
                current: idx + 1,
                total: slides.length,
                message: `配图进度 ${idx + 1}/${slides.length}`,
              });
            }),
          ),
        );
        console.log(
          `[${formatBeijingTime()}] [AGENT] Image generation complete: ${successCount} succeeded, ${failCount} failed`,
        );
      } else if (!imageEnabled) {
        for (const slide of slides) {
          this.removeImagePlaceholder(slide);
        }
      }

      // ========== 兜底 2+（B-2）：imagePreference 终局校验 —— 图片生成后扫描漏网之鱼，重新注入+再生成 ==========
      // 修复：LLM HTML 既没有 <img>，也没有占位符，即使 A-3/B-1 都过了也有可能在极端情况下（占位符替换时 remove 掉了）出现裸文本 slide
      // 扫描范围：imagePreference=all 时所有 slide；content-only 时非结构页的 slide
      if (
        (imagePreference === 'all' || imagePreference === 'content-only') &&
        imgProvider.generateImage
      ) {
        const toReInject: Array<{
          slide: HTMLSlide;
          sp: SlidePlan;
          idx: number;
          layout: 'content-image-left' | 'content-image-top';
        }> = [];
        const finalNeedImage = (
          pt: SlidePageType | undefined,
          _idx2: number,
        ): 'content-image-left' | 'content-image-top' | null => {
          // ——— FR-1 (fix-slide-comparison-image-disaster)：L1 高级版式 + cards/compare/timeline/table 一概不补图 ———
          const NEVER_UPGRADE_FOR_IMAGE: ReadonlySet<string> = new Set([
            'comparison-deep-dive',
            'content-value-showcase',
            'content-stats-highlight',
            'content-image-background',
            'content-zigzag',
            'content-cards',
            'content-compare',
            'content-timeline',
            'content-table',
            // ===== FR-18 扩展（全部 needsImage=false，禁止强制升带图）=====
            'content-flowchart',
            'content-org-chart',
            'content-pyramid',
            'content-matrix',
            'content-quote',
            'content-three-section',
            'content-process-steps',
            'content-icon-grid',
            'content-section-divider',
            'content-testimonial',
            'content-chart-bar',
            'content-chart-line',
            'content-chart-pie',
            'content-chart-donut',
            'content-cycle',
            'content-dashboard',
          ]);
          if (pt && NEVER_UPGRADE_FOR_IMAGE.has(pt)) return null;
          if (imagePreference === 'all') {
            // all → 封面/总结/目录用 top；其余默认 left
            return pt === 'cover' || pt === 'summary' || pt === 'toc'
              ? 'content-image-top'
              : 'content-image-left';
          }
          // content-only → 非结构页
          const isStructure = pt === 'cover' || pt === 'toc' || pt === 'summary';
          if (isStructure) return null;
          return 'content-image-left';
        };
        for (let i = 0; i < slides.length; i++) {
          const s = slides[i];
          const sp = plan.slides[i];
          const hasImg = /<img\b[^>]*src\s*=\s*["'](?!.*NOPPT_IMAGE_PLACEHOLDER)[^"']+["']/i.test(
            s.html,
          );
          if (hasImg) continue;
          const layout = finalNeedImage(s.pageType || sp?.pageType, i);
          if (!layout) continue;
          // 这张 slide 在终局没有有效 <img src>
          const meaningfulB =
            s.pageType === 'cover' || s.pageType === 'toc' || s.pageType === 'summary'
              ? Boolean(s.title) || this.slideHasMeaningfulBody(s.html)
              : this.slideHasMeaningfulBody(s.html);
          if (!meaningfulB) continue;
          toReInject.push({ slide: s, sp, idx: i, layout });
        }
        if (toReInject.length > 0) {
          console.log(
            `[${formatBeijingTime()}] [AGENT] B-2 FINAL CHECK: found ${toReInject.length} slide(s) without image, re-injecting & re-generating...`,
          );
          onProgress?.({
            phase: 'images',
            current: slides.length,
            total: slides.length + toReInject.length,
            message: `发现 ${toReInject.length} 张漏网无图页，正在补图...`,
          });
          const imgLimit2 = pLimit(2);
          await Promise.all(
            toReInject.map((entry) =>
              imgLimit2(async () => {
                const { slide, sp, idx, layout } = entry;
                const injected = this.injectImagePlaceholderForContentSlide(
                  slide.html,
                  layout,
                  plan.primaryColor,
                );
                slide.html = injected;
                if (!slide.imageRatio)
                  slide.imageRatio = layout === 'content-image-top' ? '21:9' : '4:3';
                slide.pageType = layout;
                if (sp) {
                  sp.pageType = layout;
                  sp.needsImage = true;
                  if (!sp.imageRatio) sp.imageRatio = slide.imageRatio;
                }
                // 再跑一次生成
                const ratio =
                  slide.imageRatio ||
                  sp?.imageRatio ||
                  (layout === 'content-image-top' ? '21:9' : '4:3');
                const allModels = options?.imageOptions?.allModels || [];
                const routing = options?.imageOptions?.routing;
                const defaultModel = options?.imageOptions?.model || imgProvider.config.model;
                const { modelName: selectedModel } = selectImageModel(
                  allModels.map((m, i) => ({ ...m, index: i })),
                  layout,
                  ratio as ImageRatio,
                  routing,
                  defaultModel,
                );
                const selectedModelObj = allModels.find((m) => m.modelName === selectedModel);
                const selectedModelSizes = selectedModelObj?.sizes;
                const selectedModelPixelRanges = selectedModelObj?.pixelRanges;
                // —— B-2 补图路径：严格按 ratio 优先（与主配图路径规则完全一致）
                const __beforeTargetSizeB2 = options?.imageOptions?.size as ImageSize | undefined;
                const cfgWB2 =
                  __beforeTargetSizeB2 && /^(\d+)x(\d+)$/.test(__beforeTargetSizeB2)
                    ? parseInt(__beforeTargetSizeB2.match(/^(\d+)x(\d+)$/)![1], 10)
                    : 0;
                const cfgHB2 =
                  __beforeTargetSizeB2 && /^(\d+)x(\d+)$/.test(__beforeTargetSizeB2)
                    ? parseInt(__beforeTargetSizeB2.match(/^(\d+)x(\d+)$/)![2], 10)
                    : 0;
                const cfgIsSquareB2 = cfgWB2 > 0 && cfgHB2 > 0 && cfgWB2 === cfgHB2;
                const ratioKnownB2: boolean =
                  ratio === '1:1' ||
                  ratio === '4:3' ||
                  ratio === '3:4' ||
                  ratio === '16:9' ||
                  ratio === '9:16' ||
                  ratio === '3:2' ||
                  ratio === '2:3' ||
                  ratio === '21:9';
                let effectiveFixedSizeB2: ImageSize | undefined;
                let whyIgnoredCfgB2 = '';
                if (ratio === '1:1') {
                  if (cfgIsSquareB2) effectiveFixedSizeB2 = __beforeTargetSizeB2;
                  else {
                    effectiveFixedSizeB2 = undefined;
                    whyIgnoredCfgB2 = `ratio=1:1但cfgSize非方形，忽略cfg`;
                  }
                } else if (!ratioKnownB2) {
                  effectiveFixedSizeB2 = __beforeTargetSizeB2;
                } else {
                  effectiveFixedSizeB2 = undefined;
                  whyIgnoredCfgB2 = `ratio=${ratio}，严格按ratio计算尺寸，忽略cfgSize=${__beforeTargetSizeB2 ?? '<none>'}`;
                }
                if (!effectiveFixedSizeB2 || /^(\d+)x(\d+)$/.test(effectiveFixedSizeB2)) {
                  const msg = (() => {
                    const hasSizes = !!(selectedModelSizes && selectedModelSizes.length);
                    const hasRanges = !!(
                      selectedModelPixelRanges && selectedModelPixelRanges.length
                    );
                    const sizeList = hasSizes
                      ? selectedModelSizes!.map((s) => `${s.width}x${s.height}`).join(',')
                      : '<empty>';
                    const rangeList = hasRanges
                      ? selectedModelPixelRanges!
                          .map(
                            (r) =>
                              `${(r.minPixels / 1048576).toFixed(2)}-${(r.maxPixels / 1048576).toFixed(2)}M`,
                          )
                          .join(',')
                      : '<empty>';
                    return `seedSize-dbg(B-2) slide=${idx + 1} model=${selectedModel} ratio=${ratio} layout=${layout} hasSizes=${hasSizes}(${sizeList}) hasRanges=${hasRanges}(${rangeList}) cfgSize=${__beforeTargetSizeB2 ?? '<none>'} useCfgAsIs=${Boolean(effectiveFixedSizeB2)} whyIgnored=${whyIgnoredCfgB2 || '<ratio respected>'}`;
                  })();
                  console.log(`[${formatBeijingTime()}] [AGENT] ${msg}`);
                }
                const targetSize =
                  effectiveFixedSizeB2 ||
                  getImageSizeForRatio(
                    selectedModel,
                    ratio as ImageRatio,
                    selectedModelSizes,
                    selectedModelPixelRanges,
                  );
                const rawImagePrompt =
                  sp?.imagePrompt ||
                  `${topic} - ${slide.title}，商务级专业插画品质，细腻细节，高完成度画面，整体配色与主题协调`;
                const imagePrompt = this.sanitizeImagePrompt(rawImagePrompt, plan.primaryColor);
                try {
                  const images = await imgProvider.generateImage!(imagePrompt, {
                    model: selectedModel,
                    size: targetSize,
                    quality: options?.imageOptions?.quality,
                    n: 1,
                    referenceImage: options?.referenceImage,
                    // FR-15：按 slide pageType 选取对应分类的参考图作为 img2img seed
                    referenceImageByCategory: this.buildReferenceSeedMap(options),
                    referenceCategory: slide.pageType,
                    ...({
                      scene: `slide-${idx + 1} "${slide.title}" (B-2-rescue, layout=${layout})`,
                    } as any),
                  });
                  if (images && images.length > 0 && images[0].url) {
                    slide.html = replaceImagePlaceholderWithRealSrc(
                      slide.html,
                      images[0].url,
                      ratio as ImageRatio,
                    );
                    console.log(
                      `[${formatBeijingTime()}] [AGENT] Slide ${idx + 1} B-2 补图成功 (${selectedModel}, targetSize=${targetSize}, ratio=${ratio})`,
                    );
                  } else {
                    // 再失败：移除 placeholder，交给 server 端孤儿救援（它会把其他生成的孤儿图片塞进来）
                    this.removeImagePlaceholder(slide);
                    console.warn(
                      `[${formatBeijingTime()}] [AGENT] Slide ${idx + 1} B-2 补图无结果，等待 server 端孤儿救援...`,
                    );
                  }
                } catch (e) {
                  this.removeImagePlaceholder(slide);
                  console.warn(
                    `[${formatBeijingTime()}] [AGENT] Slide ${idx + 1} B-2 补图异常，等待 server 端孤儿救援:`,
                    e,
                  );
                }
                onProgress?.({
                  phase: 'images',
                  current: slides.length + (idx + 1),
                  total: slides.length + toReInject.length,
                  message: `补图进度 ${entry.idx + 1}/${toReInject.length}`,
                });
              }),
            ),
          );
        }
      }

      if (backgroundEnabled && imgProvider.generateImage) {
        const timestamp = formatBeijingTime();
        console.log(`[${timestamp}] [AGENT] Starting background image generation...`);
        onProgress?.({ phase: 'images', current: 0, total: 4, message: '正在生成背景图...' });

        const BG_PLACEHOLDER = 'https://NOPPT_BG_PLACEHOLDER';
        //【缺陷修复 1】cover/toc/summary 也必须 HTML 里真正存在 BG_PLACEHOLDER 才入队，
        // 否则即使 pageType 匹配也会白白调用 generateImage，再 replace 时 0 命中，导致"打了 trace 但图片没注入"的假象
        const coverSlide = slides.find(
          (s) => s.pageType === 'cover' && s.html.includes(BG_PLACEHOLDER),
        );
        const tocSlide = slides.find(
          (s) => s.pageType === 'toc' && s.html.includes(BG_PLACEHOLDER),
        );
        const contentSlide = slides.find(
          (s) => s.pageType && s.pageType.startsWith('content-') && s.html.includes(BG_PLACEHOLDER),
        );
        const summarySlide = slides.find(
          (s) => s.pageType === 'summary' && s.html.includes(BG_PLACEHOLDER),
        );

        const bgTasks: { label: string; slide: HTMLSlide; prompt: string }[] = [];
        const contentPrompt = plan.slides.find((s) =>
          s.pageType?.startsWith('content-'),
        )?.backgroundPrompt;

        if (coverSlide) {
          const p = plan.slides.find((s) => s.pageType === 'cover')?.backgroundPrompt;
          if (p) bgTasks.push({ label: '封面', slide: coverSlide, prompt: p });
        }
        if (tocSlide) {
          const p = plan.slides.find((s) => s.pageType === 'toc')?.backgroundPrompt;
          if (p) bgTasks.push({ label: '目录', slide: tocSlide, prompt: p });
        }
        //【缺陷修复 2】内容背景：contentPrompt 存在但没有任何 content 页含 BG_PLACEHOLDER 时，
        // 之前整个"内容"任务被跳过（连 generateImage 都不打 trace），用户以为没执行。
        // 改为：找任意 content 页当"主落点 slide"，后续 replace 仍遍历所有 content 页。
        if (contentPrompt) {
          if (contentSlide) {
            bgTasks.push({ label: '内容', slide: contentSlide, prompt: contentPrompt });
          } else {
            const fallbackContentSlide = slides.find(
              (s) => s.pageType && s.pageType.startsWith('content-'),
            );
            if (fallbackContentSlide) {
              console.warn(
                `[${formatBeijingTime()}] [AGENT] Background(content): contentPrompt 存在但没有 content 页包含 BG_PLACEHOLDER，仍然尝试生成背景图，后续将遍历所有 content 页用 background-image 注入`,
              );
              bgTasks.push({ label: '内容', slide: fallbackContentSlide, prompt: contentPrompt });
            } else {
              console.warn(
                `[${formatBeijingTime()}] [AGENT] Background(content): contentPrompt 存在，但没有 pageType=content-* 的 slide，跳过内容背景`,
              );
            }
          }
        } else {
          //【缺陷修复 3】planning 没输出 backgroundPrompt 时给出显性日志
          console.warn(
            `[${formatBeijingTime()}] [AGENT] Background(content): plan.slides 中所有 content-* 页均没有 backgroundPrompt，请检查 planning 输出是否包含 backgroundPrompt`,
          );
        }
        if (summarySlide) {
          const p = plan.slides.find((s) => s.pageType === 'summary')?.backgroundPrompt;
          if (p) bgTasks.push({ label: '总结', slide: summarySlide, prompt: p });
        }

        //【缺陷修复 4】最终入队 0 条时，给出"为什么没生成"的汇总日志 + progress 更新，避免一条 trace 都没有、
        // 用户就像本 issue 一样困惑："为什么 ai-log 里找不到背景图报文"
        if (bgTasks.length === 0) {
          console.warn(
            `[${formatBeijingTime()}] [AGENT] Background: 最终入队 bgTasks=0，以下均为可能原因：① slide HTML 里没有 NOPPT_BG_PLACEHOLDER；② planning 没输出 backgroundPrompt；③ 没有 cover/toc/content-*/summary 等目标 pageType。请逐一核实`,
          );
          onProgress?.({
            phase: 'images',
            current: 1,
            total: 1,
            message: '背景图无需生成（无 BG_PLACEHOLDER 或未规划 backgroundPrompt）',
          });
        } else {
          let bgIdx = 0;
          for (const task of bgTasks) {
            try {
              const bgImgPrompt = this.sanitizeImagePrompt(task.prompt, plan.primaryColor);
              const allModels = options?.imageOptions?.allModels || [];
              const defaultModel = options?.imageOptions?.model || imgProvider.config.model;
              let selectedModel = defaultModel;
              let selectedModelSizes = allModels.find((m) => m.modelName === selectedModel)?.sizes;
              const bgSize: ImageSize = '1792x1024';
              const actualSize = selectedModelSizes?.some(
                (s) => `${s.width}x${s.height}` === bgSize,
              )
                ? bgSize
                : (options?.imageOptions?.size as ImageSize) || '1792x1024';

              const images = await imgProvider.generateImage!(bgImgPrompt, {
                model: selectedModel,
                size: actualSize,
                quality: options?.imageOptions?.quality,
                n: 1,
                ...({ scene: `background-${task.label}` } as any),
              });
              if (images && images.length > 0 && images[0].url) {
                const hitsBefore =
                  task.label === '内容'
                    ? slides
                        .filter((s) => s.pageType?.startsWith('content-'))
                        .reduce(
                          (acc, s) => acc + (s.html.match(/NOPPT_BG_PLACEHOLDER/gi)?.length ?? 0),
                          0,
                        )
                    : (task.slide.html.match(/NOPPT_BG_PLACEHOLDER/gi)?.length ?? 0);
                if (task.label === '内容') {
                  for (const slide of slides) {
                    if (slide.pageType?.startsWith('content-')) {
                      slide.html = slide.html.replace(
                        /url\(['"]?https:\/\/NOPPT_BG_PLACEHOLDER['"]?\)/gi,
                        `url('${images[0].url}')`,
                      );
                    }
                  }
                } else {
                  task.slide.html = task.slide.html.replace(
                    /url\(['"]?https:\/\/NOPPT_BG_PLACEHOLDER['"]?\)/gi,
                    `url('${images[0].url}')`,
                  );
                }
                const hitsAfter =
                  task.label === '内容'
                    ? slides
                        .filter((s) => s.pageType?.startsWith('content-'))
                        .reduce(
                          (acc, s) => acc + (s.html.match(/NOPPT_BG_PLACEHOLDER/gi)?.length ?? 0),
                          0,
                        )
                    : (task.slide.html.match(/NOPPT_BG_PLACEHOLDER/gi)?.length ?? 0);
                // 若没有 placeholder 命中，退一步尝试把首屏的 background-image 注入到 slide 的最外层 div 背景样式里
                if (hitsBefore - hitsAfter === 0) {
                  const inj = this.injectBackgroundImageToDiv(
                    task.label === '内容'
                      ? slides.filter((s) => s.pageType?.startsWith('content-'))
                      : [task.slide],
                    images[0].url,
                  );
                  console.log(
                    `[${formatBeijingTime()}] [AGENT] Background (${task.label}) generated successfully, placeholder hit=${hitsBefore - hitsAfter}/${hitsBefore}, fallback injectBackgroundImageToDiv=${inj.attempted}, injected=${inj.injected}`,
                  );
                } else {
                  console.log(
                    `[${formatBeijingTime()}] [AGENT] Background (${task.label}) generated successfully, replaced ${hitsBefore - hitsAfter}/${hitsBefore} placeholder(s)`,
                  );
                }
              } else {
                console.warn(
                  `[${formatBeijingTime()}] [AGENT] Background (${task.label}) 调用成功但 images[0].url 为空，触发 removeBackgroundPlaceholder`,
                );
                this.removeBackgroundPlaceholder(task.slide);
              }
            } catch (e) {
              console.warn(
                `[${formatBeijingTime()}] [AGENT] Background (${task.label}) generation failed:`,
                e,
              );
              this.removeBackgroundPlaceholder(task.slide);
            }
            bgIdx++;
            onProgress?.({
              phase: 'images',
              current: bgIdx,
              total: bgTasks.length,
              message: `背景图进度 ${bgIdx}/${bgTasks.length}`,
            });
          }
        }

        for (const slide of slides) {
          if (slide.html.includes('NOPPT_BG_PLACEHOLDER')) {
            this.removeBackgroundPlaceholder(slide);
          }
        }
      } else if (!backgroundEnabled) {
        //【缺陷修复 4 补充】backgroundEnabled=false 时也给出显性日志。
        // 这正是本次用户 issue 的直接原因：pres_mse1kl5x_urnm2gj 的 Background=关 → 完全跳过了 generateImage → imageGenerationCalls 里没有 background-* 记录
        console.log(
          `[${formatBeijingTime()}] [AGENT] Background generation skipped: backgroundEnabled=false（当前请求未开启自动背景图；imageGenerationCalls 中将只有 slide 配图的 5 次记录，没有 background-* 记录）`,
        );
        for (const slide of slides) {
          if (slide.html.includes('NOPPT_BG_PLACEHOLDER')) {
            this.removeBackgroundPlaceholder(slide);
          }
        }
      }

      return slides.map((s, i) => ({
        title: s.title,
        html: s.html,
        pageType: (s.pageType || renderedSlides[i]?.pageType)!,
        imagePrompt: s.imagePrompt,
        imageRatio: s.imageRatio,
        backgroundPrompt: renderedSlides[i]?.backgroundPrompt,
      }));
    } finally {
      if (ownTraceSession && traceSessionId) {
        closeTraceSession(traceSessionId);
      }
    }
  }

  async finalizePresentation(
    topic: string,
    renderedSlides: RenderedSlide[],
    plan: PresentationPlan,
    _design: DesignProposal,
    options?: PresentationGenerationOptions,
    traceSessionId?: string,
  ): Promise<HTMLPresentation> {
    const slides: HTMLSlide[] = renderedSlides.map((s) => ({
      title: s.title,
      html: s.html,
      pageType: s.pageType,
      imagePrompt: s.imagePrompt,
      imageRatio: s.imageRatio as ImageRatio | undefined,
      notes: undefined,
      critique: (s as any).critique,
    }));

    const imagePreference = options?.imagePreference || 'content-only';
    const slideWidth = options?.slideWidth || 1280;
    const slideHeight = options?.slideHeight || 720;

    let ownTraceSession = false;
    if (!traceSessionId) {
      traceSessionId = `trace_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      openTraceSession(traceSessionId);
      ownTraceSession = true;
    }

    try {
      const startTime = Date.now();
      const startBeijingTime = formatBeijingTime();

      const totalDuration = Date.now() - startTime;
      const endBeijingTime = formatBeijingTime();
      console.log(
        `[${endBeijingTime}] [AGENT] End time: ${endBeijingTime}, Duration: ${formatDuration(totalDuration)}`,
      );
      console.log(
        `[${endBeijingTime}] [AGENT] ========== Presentation generation complete ==========\n`,
      );

      const onProgress = options?.onProgress;
      onProgress?.({
        phase: 'complete',
        current: slides.length,
        total: slides.length,
        message: '生成完成',
      });

      // ========== AI 包终局兜底（防线 4）==========
      //   - 每一张 slide 再过一遍 wrapTextNodes + ensureSemanticWrapping 双保险
      //   - 检测并记录是否仍存在裸文本（用于问题复现、告警）
      //   - 确保 slides 输出时，imagePreference 已经跟每一张 slide 的 needsImage/pageType 保持一致
      for (let sIdx = 0; sIdx < slides.length; sIdx++) {
        const slide = slides[sIdx];
        const preLen = slide.html.length;
        try {
          slide.html = this.wrapTextNodes(slide.html);
          slide.html = this.flattenMeaninglessNesting(slide.html);
          slide.html = this.ensureSemanticWrapping(slide.html);
        } catch (finalFixErr) {
          console.warn(
            `[${formatBeijingTime()}] [AGENT] [FINAL-FIX] slide ${sIdx + 1} "${slide.title}" final fix skipped due to:`,
            (finalFixErr as Error).message,
          );
        }
        if (slide.html.length !== preLen) {
          console.log(
            `[${formatBeijingTime()}] [AGENT] [FINAL-FIX] slide ${sIdx + 1} "${slide.title}" bare-text fixed in AI finalizer (${preLen} → ${slide.html.length})`,
          );
        }
      }

      return {
        title: plan.title || topic,
        description: plan.description,
        primaryColor: plan.primaryColor,
        transition: 'none',
        slides,
        width: slideWidth,
        height: slideHeight,
        imagePreference,
        timing: { startTime: startBeijingTime, endTime: endBeijingTime, durationMs: totalDuration },
      };
    } finally {
      if (ownTraceSession && traceSessionId) {
        closeTraceSession(traceSessionId);
      }
    }
  }

  async generateDesignProposals(
    topic: string,
    plan: PresentationPlan,
    options?: PresentationGenerationOptions,
    traceSessionId?: string,
  ): Promise<DesignProposal[]> {
    // === proposalCount 规范化（F-2 + C-1 约束）
    const rawCount: unknown = options?.proposalCount;
    const proposalCount = (() => {
      // 仅接受「正整数」才做规范化；NaN / 非整数（如 1.7）/ 负数 / 0 / 非 number 类型 → 默认 3
      if (typeof rawCount === 'number' && Number.isInteger(rawCount) && rawCount >= 1) {
        return Math.max(1, Math.min(20, rawCount));
      }
      return 3; // 默认或非法值
    })();
    console.log(`[DESIGN] proposalCount=${proposalCount} request=${JSON.stringify(rawCount)}`); // Spec C-3 字段可观察

    const style = options?.style || 'business';
    const audience = options?.audience || '';
    const userColorTheme = options?.colorTheme;
    const userPrimaryColor = options?.primaryColor;
    const userFontFamily = options?.fontFamily;
    const userIconStyle = options?.iconStyle;
    // FR-2.x：参考主色纳入提案单源链（参考 > 用户 > 默认蓝），与规划/renderSlides 一致（html-presentation-agent.ts:1894/2822）
    const refDeckPrimary = resolveDeckReferencePrimaryColor(options?.referenceVisualAttributes);

    let ownTraceSession = false;
    if (!traceSessionId) {
      traceSessionId = `trace_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      openTraceSession(traceSessionId);
      ownTraceSession = true;
    }
    (this.planningProvider as TraceableProvider).activeTraceSessionId = traceSessionId;

    const resolveThemeColor = (): string =>
      resolveProposalPrimaryColor({
        referenceVisualAttributes: options?.referenceVisualAttributes,
        userColorTheme,
        userPrimaryColor,
      });

    // === 子项 D：style → styleTheme 映射函数
    const recommendStyleThemeByStyle = (s: string): StyleTheme[] => {
      switch (s) {
        case 'business':
        case 'formal':
          return ['glass', 'colored-cards', 'mixed'];
        case 'creative':
        case 'playful':
          return ['gradient', 'mixed', 'colored-cards'];
        case 'minimal':
        case 'minimalist':
          return ['none', 'mixed', 'badges'];
        case 'tech':
        case 'technology':
          return ['progress-bars', 'badges', 'mixed'];
        default:
          return ['mixed', 'gradient', 'glass'];
      }
    };

    const rawDensity = options?.density;
    const validDensity: 'compact' | 'normal' | 'spacious' | undefined =
      rawDensity === 'compact' || rawDensity === 'normal' || rawDensity === 'spacious'
        ? rawDensity
        : undefined;

    const validFontFamily: 'sans' | 'serif' | 'mono' | undefined =
      userFontFamily === 'sans' || userFontFamily === 'serif' || userFontFamily === 'mono'
        ? userFontFamily
        : undefined;

    const buildFallbackProposals = (): DesignProposal[] => {
      const baseColor = resolveThemeColor();
      const baseTheme = userColorTheme || 'blue';
      const styleThemes = recommendStyleThemeByStyle(style);
      const originalStyleThemes: StyleTheme[] = ['glass', 'gradient', 'none'];
      const originalDensities: ('compact' | 'normal' | 'spacious')[] = [
        'normal',
        'normal',
        'spacious',
      ];
      const originalFonts: ('sans' | 'serif' | 'mono')[] = ['sans', 'sans', 'sans'];
      const originalIcons: Array<
        'auto' | 'line' | 'filled' | 'numbered' | 'bullet' | 'lettered' | 'emoji' | 'none'
      > = ['line', 'filled', 'none'];
      return ([0, 1, 2] as const).map((idx) => ({
        id: `proposal-${idx + 1}`,
        name: idx === 0 ? '专业稳重' : idx === 1 ? '现代活力' : '极简克制',
        description:
          idx === 0
            ? '毛玻璃质感搭配主色，专业大气'
            : idx === 1
              ? '渐变与卡片层次，现代动感'
              : '大量留白与细线分隔，简约克制',
        primaryColor: baseColor,
        colorTheme: baseTheme,
        fontFamily: validFontFamily || originalFonts[idx],
        styleTheme: styleThemes[idx] || styleThemes[0] || originalStyleThemes[idx],
        density: validDensity || originalDensities[idx],
        iconStyle: userIconStyle || originalIcons[idx],
        coverHtml: '',
      })) as DesignProposal[];
    };

    const fallbackProposals = buildFallbackProposals().slice(0, proposalCount);

    try {
      const slideSummary = plan.slides
        .map((s, i) => `${i + 1}. [${s.pageType}] ${s.title}`)
        .join('\n');

      const countOnly1 = proposalCount === 1;

      const colorConstraint =
        userColorTheme || userPrimaryColor
          ? countOnly1
            ? `\n用户已指定配色主题：${userColorTheme || '自定义'}（主色：${resolveThemeColor()}）。\n重要约束：1 个方案的 colorTheme 必须为 "${userColorTheme || 'blue'}"，primaryColor 必须使用 "${resolveThemeColor()}"。\n该方案仅需在 styleTheme / name / description 维度体现创意（若用户未显式指定 styleTheme / density / iconStyle / fontFamily，可自由体现）。\n另外：用户已显式指定 fontFamily=${validFontFamily || '由你决定'}、iconStyle=${userIconStyle || '由你决定'}。若用户已显式指定，对应维度你无权改动。`
            : `\n用户已指定配色主题：${userColorTheme || '自定义'}（主色：${resolveThemeColor()}）。\n重要约束：3 个方案的 colorTheme 必须为 "${userColorTheme || 'blue'}"，primaryColor 必须使用 "${resolveThemeColor()}"。\n方案之间的差异应通过 styleTheme、density、iconStyle 等维度体现，而非切换色相。\n另外：用户已显式指定 fontFamily=${validFontFamily || '由你决定'}、iconStyle=${userIconStyle || '由你决定'}。若用户已显式指定，对应维度你无权改动，只能在 styleTheme / density / name / description 维度差异化。`
          : '';
      // === 子项 A：countOnly1 的 head 动态化（按 style / density / fontFamily / iconStyle）
      const styleDescription = ((): string => {
        switch (style) {
          case 'creative':
          case 'playful':
            return '活泼创意和谐';
          case 'business':
          case 'formal':
            return '专业稳健大气';
          case 'minimal':
          case 'minimalist':
            return '简约克制留白充足';
          case 'tech':
          case 'technology':
            return '科技感信息密度高';
          default:
            return '专业美观大气';
        }
      })();
      const countOnly1HeadLines: string[] = [
        `基于以下演示文稿主题和幻灯片规划，提出 1 个正式视觉设计方向。`,
        '',
        styleDescription + '。',
      ];
      if (validDensity) {
        countOnly1HeadLines.push(
          `密度：用户已显式指定 density=${validDensity}，必须使用该值，不得切换。`,
        );
      }
      if (validFontFamily) {
        countOnly1HeadLines.push(
          `字体族：用户已显式指定 fontFamily=${validFontFamily}，方案中必须使用该值。`,
        );
      }
      if (userIconStyle) {
        countOnly1HeadLines.push(
          `图标风格：用户已显式指定 iconStyle=${userIconStyle}，方案中必须使用该值，不得建议其他值。`,
        );
      }
      countOnly1HeadLines.push(
        `风格主题 styleTheme：建议从以下子集中自由选择：[${recommendStyleThemeByStyle(style).join(' / ')}]。无需与其他方案比较。`,
      );
      const head = countOnly1
        ? countOnly1HeadLines.join('\n')
        : `基于以下演示文稿主题和幻灯片规划，提出 3 个视觉上差异明显的设计方向。`;
      const idConstraint = countOnly1
        ? `- id: 固定写 "proposal-1"`
        : `- id: "proposal-1" / "proposal-2" / "proposal-3"`;
      const returnIntro = countOnly1
        ? `请返回 1 个设计方案，每个方案包含：`
        : `请返回 3 个设计方案，每个方案包含：`;
      const countOnly1HasUserConstraints = Boolean(
        validFontFamily || userIconStyle || validDensity,
      );
      const countOnly1TailLines: string[] = [];
      if (countOnly1HasUserConstraints) {
        countOnly1TailLines.push('请严格遵守上方列出的所有"用户已显式指定"的维度。');
      }
      countOnly1TailLines.push(
        '只返回长度为 1 的 JSON 数组，不要任何其他文字或 Markdown 代码块标记。',
      );
      const tail = countOnly1
        ? countOnly1TailLines.join('\n')
        : `要求 3 个方案视觉上明显区分（通过风格质感、密度、图标风格等维度变化）。\n只返回 JSON 数组，不要任何其他文字或 Markdown 代码块标记。`;

      const categoryReferenceSummary = options?.referenceVisualAttributes
        ? '【参考文件提取属性 · 绝对最高优先级 · 覆盖用户显式参数】\n' +
          formatReferenceOverrideOverview(options.referenceVisualAttributes)
        : '';
      // 参考主色硬约束（优先级高于用户 colorTheme=blue）：确保 LLM 不会在「用户蓝」与「参考红」间选错
      const referencePrimaryConstraint = refDeckPrimary
        ? `\n【参考文件主色 · 绝对最高优先级】已解析到参考文件主色 ${refDeckPrimary}，该色优先级高于用户配色主题（含 blue），所有方案的 primaryColor 必须使用 "${refDeckPrimary}"。`
        : '';

      const prompt = `${head}

主题：${topic}
受众：${audience || '通用'}
风格：${style}
${colorConstraint}
${referencePrimaryConstraint}
${categoryReferenceSummary}
幻灯片规划：
${slideSummary}

${returnIntro}
${idConstraint}
- name: 中文名称
- description: 中文一句话描述
- primaryColor: HEX 主色（如 #2563eb）
- colorTheme: 配色主题，取值之一：blue / purple / green / orange / teal / gray
- fontFamily: 字体族，取值之一：sans / serif / mono
- styleTheme: 风格主题，取值之一：none / glass / gradient / progress-bars / badges / colored-cards / mixed
- density: 内容密度，取值之一：compact / normal / spacious
- iconStyle: 图标风格，取值之一：auto / line / filled / numbered / bullet / lettered / emoji / none
  - 选择原则：B端/技术/正式场景优先 line（线性描边）；封面/重点/创意/渐变风格优先 filled（面性填充）；
    步骤流程用 numbered；分类维度用 lettered；特性优势用 bullet；内部轻松/C端可用 emoji；正式商务汇报禁止 emoji。

${tail}`;

      let proposals: DesignProposal[] = fallbackProposals;
      let lastProposalErr: unknown;
      const PROPOSAL_MAX_RETRIES = 2;
      // 补遗1：LLM 调用（网络抖动 / 单侧超时 / 偶发返回非合法数组）先有限重试（默认 2 次），
      // 全部失败再回落 fallbackProposals，避免「一次出错直接降级」摧毁整轮方案多样性。
      for (let proposalAttempt = 0; proposalAttempt <= PROPOSAL_MAX_RETRIES; proposalAttempt++) {
        try {
          switchStage(this.planningProvider, 'design-proposals');
          const response = await this.planningProvider.chat([{ role: 'user', content: prompt }], {
            temperature: 0.5,
            maxTokens: 8192,
          });
          const raw = response.content || '';
          const arrayMatch = raw.match(/\[[\s\S]*\]/);
          if (arrayMatch) {
            let parsed = JSON.parse(arrayMatch[0]);
            if (Array.isArray(parsed) && parsed.length > 0) {
              parsed = parsed.slice(0, proposalCount);
              // T20 · G0-U-17b：3 套方案主色/配色主题必须统一到用户选择（若显式给了）。
              // 单源顺序：userPrimaryColor(合法) > COLOR_THEMES[userColorTheme] > fallbackProposal.baseColor
              const enforcedTheme: ColorTheme | undefined =
                userColorTheme && COLOR_THEMES[userColorTheme] ? userColorTheme : undefined;
              const unifiedColor: string = resolveProposalPrimaryColor({
                referenceVisualAttributes: options?.referenceVisualAttributes,
                userColorTheme,
                userPrimaryColor,
              });
              const proposalsBefore = parsed.map((p: any) => ({
                id: p.id,
                primaryColor: p.primaryColor,
                colorTheme: p.colorTheme,
              }));
              proposals = parsed.map((p: any, idx: number) => {
                const fb = fallbackProposals[idx] || fallbackProposals[0];
                return {
                  id: p.id || `proposal-${idx + 1}`,
                  name: String(p.name || fb.name || `方案 ${idx + 1}`),
                  description: String(p.description || ''),
                  primaryColor: unifiedColor, // 三套统一（即便 LLM 写了不同的也强制覆盖）
                  colorTheme:
                    enforcedTheme ||
                    (COLOR_THEMES[p.colorTheme as ColorTheme]
                      ? p.colorTheme
                      : fb.colorTheme || 'blue'),
                  fontFamily:
                    userFontFamily ||
                    (p.fontFamily === 'serif' || p.fontFamily === 'mono' ? p.fontFamily : 'sans'),
                  styleTheme: p.styleTheme || 'mixed',
                  density:
                    p.density === 'compact' || p.density === 'spacious' ? p.density : 'normal',
                  iconStyle: userIconStyle || p.iconStyle || 'auto',
                  coverHtml: '',
                };
              });
              const proposalsAfter = proposals.map((p) => ({
                id: p.id,
                primaryColor: p.primaryColor,
                colorTheme: p.colorTheme,
              }));
              console.log(
                `[DESIGN] proposals 主色统一：LLM 返回=${JSON.stringify(proposalsBefore)}，强制统一后=${JSON.stringify(proposalsAfter)}（unifiedColor=${unifiedColor} enforcedTheme=${enforcedTheme || '(none)'} refDeckPrimary=${refDeckPrimary || '(none)'}${refDeckPrimary ? ' reference-first' : ''}）`,
              );
              break; // 解析成功，跳出重试循环
            }
          }
          // 到达此处说明 LLM 返回了但无合法提案数组：计入错误并触发重试（最后一次则回落兜底）
          lastProposalErr = new Error('LLM 未返回合法提案数组');
          if (proposalAttempt < PROPOSAL_MAX_RETRIES) {
            console.warn(
              `[RETRY] generateDesignProposals 解析为空（attempt ${proposalAttempt + 1}/${PROPOSAL_MAX_RETRIES + 1}），重试...`,
            );
            continue;
          }
        } catch (parseErr) {
          lastProposalErr = parseErr;
          if (proposalAttempt < PROPOSAL_MAX_RETRIES) {
            console.warn(
              `[RETRY] generateDesignProposals 失败（attempt ${proposalAttempt + 1}/${PROPOSAL_MAX_RETRIES + 1}），重试...`,
              parseErr,
            );
            continue;
          }
          console.warn(
            `[${formatBeijingTime()}] [AGENT] generateDesignProposals 重试耗尽，使用兜底:`,
            parseErr,
          );
        }
      }
      if (lastProposalErr) {
        proposals = fallbackProposals;
      }

      const referenceHtml = options?.referenceHtml || '';
      const backgroundEnabled = options?.backgroundEnabled || false;
      const imagePreference = options?.imagePreference || 'content-only';
      const slideWidth = options?.slideWidth || 1280;
      const slideHeight = options?.slideHeight || 720;

      if (plan.slides.length === 0) return proposals;

      const renderOptionsBase: PresentationGenerationOptions = {
        ...options,
        style,
        audience,
        imagePreference,
        backgroundEnabled,
        referenceHtml,
        slideWidth,
        slideHeight,
        startIndex: 0,
        endIndex: 1,
        imageProvider: undefined,
        imageOptions: undefined,
      };

      const renderedProposals = await Promise.all(
        proposals.map(async (proposal) => {
          const renderOptions: PresentationGenerationOptions = {
            ...renderOptionsBase,
            density: proposal.density,
            colorTheme: proposal.colorTheme,
            primaryColor: proposal.primaryColor,
            fontFamily: proposal.fontFamily,
            iconStyle: proposal.iconStyle,
          };
          try {
            const firstSlideArr = await this.renderSlides(
              topic,
              plan,
              proposal,
              renderOptions,
              traceSessionId,
            );
            const firstSlide = firstSlideArr[0];
            if (firstSlide) {
              proposal.coverHtml = this.sanitizeSlideHtml(firstSlide.html);
              proposal.slides = [firstSlide];
            } else {
              proposal.coverHtml = '';
              proposal.slides = [];
            }
          } catch (renderErr) {
            console.warn(
              `[${formatBeijingTime()}] [AGENT] generateDesignProposals first-slide render failed for ${proposal.id}:`,
              renderErr,
            );
            proposal.coverHtml = '';
            proposal.slides = [];
          }
          return proposal;
        }),
      );

      for (const p of renderedProposals) {
        console.log(
          `[DESIGN] proposal ${p.id}: primary=${p.primaryColor} theme=${p.colorTheme} font=${p.fontFamily} icon=${p.iconStyle} styleTheme=${p.styleTheme}`,
        );
      }

      return renderedProposals;
    } finally {
      if (ownTraceSession && traceSessionId) {
        closeTraceSession(traceSessionId);
      }
    }
  }

  private removeImagePlaceholder(slide: HTMLSlide) {
    const imgRegex =
      /<div[^>]*style="[^"]*"[^>]*>\s*<img[^>]*src=["']https:\/\/NOPPT_IMAGE_PLACEHOLDER["'][^>]*>\s*<\/div>/gi;
    const singleImgRegex = /<img[^>]*src=["']https:\/\/NOPPT_IMAGE_PLACEHOLDER["'][^>]*>/gi;
    let newHtml = slide.html.replace(imgRegex, '');
    newHtml = newHtml.replace(singleImgRegex, '');
    // 删图后收起「仅用于放图的定宽列」：flex:0 0 N% 的空容器直接移除，避免右侧大块空白；
    // 其兄弟内容列（flex:1）随之占满宽度，构图不再被空洞破坏。
    newHtml = newHtml.replace(
      /<div([^>]*?style="[^"]*flex\s*:\s*0\s+0\s+\d+%[^"]*"[^>]*)>\s*<\/div>/gi,
      '',
    );
    slide.html = newHtml;
  }

  /**
   * 判断 slide HTML 是否有足够有意义的正文内容（用于 content-no-image → 带图 升级判定）
   * 与 server 端保持一致：不强制要求 ul/ol/li，只要去除标题/标签后剩余纯文本长度 ≥ 6 个字符即可
   */
  private slideHasMeaningfulBody(html: string): boolean {
    if (!html) return false;
    let stripped = html.replace(/^<div\b[^>]*>/i, '').replace(/<\/div>\s*$/i, '');
    stripped = stripped.replace(/<h[12]\b[^>]*>[\s\S]*?<\/h[12]>/gi, '');
    const textOnly = stripped
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .trim();
    return textOnly.length >= 6;
  }

  /**
   * 将 h2 后的混合内容规整：把每行裸文本（非空、非纯注释、非已有块级标签包裹）包装成
   * 带样式的 <p> 段落，保证左图右文布局下文字整齐可读（与 server 端 normalizeBodyLinesToParagraphs 对齐）
   */
  private normalizeBodyLinesToParagraphs(raw: string): string {
    if (!raw) return '';
    const cleaned = raw.replace(/<!--[\s\S]*?-->/g, '');
    const BLOCK_TAG_RE = /^\s*<(p|ul|ol|div|h[3-6]|table|blockquote|pre|section|article)\b/i;
    // 图标/圆标行识别：整行是单独 <span...>...</span>，含 inline-flex|flex + 宽高（图标容器），不包 <p>
    const ICON_SPAN_RE =
      /^\s*<span\b(?=[^>]*\bdisplay\s*:\s*(?:-webkit-)?inline-flex\b|[^>]*\bdisplay\s*:\s*flex\b)(?=[^>]*\bwidth\s*:)[^>]*\bheight\s*:[^>]*>[\s\S]*?<\/span>\s*$/i;
    const lines = cleaned.split(/\r?\n/);
    const parts: string[] = [];
    let bufferLines: string[] = [];
    const flushBuffer = () => {
      if (bufferLines.length === 0) return;
      const joined = bufferLines.join(' ').trim();
      if (joined) {
        parts.push(
          `<p style="font-size:24px;color:#374151;margin:0;font-weight:600;line-height:1.5;overflow-wrap:break-word;word-break:break-word;">${joined}</p>`,
        );
      }
      bufferLines = [];
    };
    for (const line of lines) {
      const t = line.trim();
      if (!t) {
        flushBuffer();
        continue;
      }
      if (BLOCK_TAG_RE.test(t) || ICON_SPAN_RE.test(t)) {
        flushBuffer();
        parts.push(line);
      } else {
        const strippedLine = t.replace(/^<p(\s[^>]*)?>\s*<\/p>$/i, '').trim();
        if (strippedLine) bufferLines.push(strippedLine);
      }
    }
    flushBuffer();
    return parts.join('\n');
  }

  /**
   * 兜底：将"纯文字内容页"重构为左图右文 / 右图左文的带图布局，并注入 IMAGE_PLACEHOLDER。
   * 场景：
   *  1) LLM 规划阶段把本该配图的页标成 content-no-image（过度保守）
   *  2) LLM 生成 HTML 时，对 content-image-* 页漏写占位符
   * 策略：
   *  - 保留原有的标题 <h2>
   *  - 把原有的正文内容（列表/段落/裸文本）提取出来作为右/左侧的文字区（裸文本会自动包装成 <p> 保证可读性）
   *  - 在另一侧插入 45% 宽度的图片容器 + 占位符
   */
  private injectImagePlaceholderForContentSlide(
    html: string,
    pageType: SlidePageType,
    _primaryColor: string = '#2563eb',
  ): string {
    if (!html || html.includes(IMAGE_PLACEHOLDER) || /<img\b/i.test(html)) return html;
    // ——— FR-2 (fix-slide-comparison-image-disaster)：保护版式有固定结构，绝不重建左图右文/上图下文 ———
    const PROTECTED_LAYOUT_FOR_INJECT: ReadonlySet<string> = new Set([
      'comparison-deep-dive',
      'content-value-showcase',
      'content-stats-highlight',
      'content-compare',
      'content-timeline',
      'content-table',
    ]);
    const layoutFromHtml = (html.match(
      /<\s*(?:div|section|article)\b[^>]*\bdata-layout\s*=\s*["']?([a-z0-9-]+)["']?[^>]*>/i,
    ) || [])[1]?.toLowerCase();
    if (
      PROTECTED_LAYOUT_FOR_INJECT.has(pageType) ||
      (layoutFromHtml && PROTECTED_LAYOUT_FOR_INJECT.has(layoutFromHtml))
    ) {
      return html;
    }
    // 取最外层 <div ... > 到末尾闭合的 </div>
    const outerOpen = html.match(/^(<div[^>]*>)/i);
    if (!outerOpen) return html;
    const closeIdx = html.lastIndexOf('</div>');
    if (closeIdx < outerOpen[1].length) return html;
    const innerRaw = html.substring(outerOpen[1].length, closeIdx);
    // 提取标题
    const h2Match = innerRaw.match(/<h2\b[^>]*>[\s\S]*?<\/h2>/i);
    const h2Part = h2Match ? h2Match[0] : '';
    const afterH2 = h2Match ? innerRaw.substring(h2Match.index! + h2Match[0].length) : innerRaw;
    // 正文内容（裸文本 → <p> 段落）
    let contentRaw = afterH2.trim();
    if (contentRaw) {
      contentRaw = this.normalizeBodyLinesToParagraphs(contentRaw);
    }
    if (!contentRaw) return html;

    const imageOnLeft = pageType !== 'content-image-right';
    const ratio = pageType === 'content-image-top' ? '21:9' : '4:3';

    let row: string;
    if (pageType === 'content-image-top') {
      // ===== 顶部横幅图布局（三段式 column：h2 → 横幅图 → 正文100%宽度保留） =====
      // 横幅图：16:9 横向铺满，最大高度 200px（避免占太多垂直空间挤掉正文）
      const bannerWrap = `<div style="width:100%;max-height:200px;min-height:0;display:flex;overflow:hidden;border-radius:16px;"><img src="${IMAGE_PLACEHOLDER}" data-image-ratio="${ratio}" style="width:100%;height:100%;min-height:120px;object-fit:cover;border-radius:16px;display:block;flex-shrink:0;"></div>`;
      // 正文容器：保留 100% 宽度（不压缩！），只加 gap 和可拉伸属性
      const contentWrap = `<div style="flex:1;display:flex;flex-direction:column;gap:16px;min-height:0;min-width:0;justify-content:space-evenly;overflow:hidden;">${contentRaw}</div>`;
      // 整体 column：h2Part 在 row 外部已经单独放置，这里只放 图 + 正文（h2 之外的全部内容）
      row = `<div style="flex:1;display:flex;flex-direction:column;gap:24px;align-items:stretch;min-height:0;min-width:0;">${bannerWrap}${contentWrap}</div>`;
    } else {
      // ===== 左右分栏布局（image-left / image-right，原逻辑保留） =====
      const imageCol = `<div style="flex:0 0 45%;display:flex;align-items:stretch;min-height:0;min-width:0;overflow:hidden;border-radius:16px;"><img src="${IMAGE_PLACEHOLDER}" data-image-ratio="${ratio}" style="width:100%;height:100%;object-fit:cover;border-radius:16px;display:block;"></div>`;
      // 正文容器：统一包装成可拉伸、最小高度为0的 flex 列，并且增加 gap 让 <p> 之间更舒服
      const contentCol = `<div style="flex:0 0 55%;display:flex;flex-direction:column;gap:16px;min-height:0;min-width:0;overflow:hidden;justify-content:space-evenly;">${contentRaw}</div>`;
      row = imageOnLeft
        ? `<div style="flex:1;display:flex;gap:40px;align-items:stretch;min-height:0;min-width:0;">${imageCol}${contentCol}</div>`
        : `<div style="flex:1;display:flex;gap:40px;align-items:stretch;min-height:0;min-width:0;">${contentCol}${imageCol}</div>`;
    }

    // 重建：外层容器 + 标题 + 新行 + 闭合
    const left = outerOpen[1];
    const right = '</div>';
    const rebuilt = `${left}${h2Part}${row}${right}`;

    // 简单校验：占位符确实注入了才返回重建值，否则返回原 HTML 避免破坏
    if (!rebuilt.includes(IMAGE_PLACEHOLDER)) return html;
    return rebuilt;
  }

  private injectBackgroundPlaceholder(html: string): string {
    const firstDivMatch = html.match(/^(<div\b[^>]*>)/i);
    if (!firstDivMatch) return html;
    const openTag = firstDivMatch[1];
    const styleMatch = openTag.match(/style="([^"]*)"/i);
    const bgStyle =
      "background-image:linear-gradient(rgba(255,255,255,0.88),rgba(255,255,255,0.88)),url('https://NOPPT_BG_PLACEHOLDER');background-size:cover;background-position:center;background-repeat:no-repeat;";
    if (!styleMatch) {
      return html.replace(/^<div\b/i, `<div style="${bgStyle}"`);
    }
    const style = styleMatch[1];
    if (style.includes('NOPPT_BG_PLACEHOLDER') || style.includes('background-image')) {
      return html;
    }
    const cleanedStyle = style
      .replace(/background-color\s*:[^;]*;?/gi, '')
      .replace(/background\s*:[^;]*;?/gi, '');
    const newStyle = bgStyle + cleanedStyle;
    return html.replace(/style="[^"]*"/i, `style="${newStyle}"`);
  }

  private removeBackgroundPlaceholder(slide: HTMLSlide) {
    slide.html = slide.html
      .replace(
        /background-image:\s*linear-gradient\([^)]*\)\s*,\s*url\(['"]?https:\/\/NOPPT_BG_PLACEHOLDER['"]?\)[^;]*;?/gi,
        '',
      )
      .replace(/background-image:\s*url\(['"]?https:\/\/NOPPT_BG_PLACEHOLDER['"]?\)[^;]*;?/gi, '')
      .replace(/background-size:\s*cover[^;]*;?/gi, '')
      .replace(/background-position:\s*center[^;]*;?/gi, '')
      .replace(/background-repeat:\s*no-repeat[^;]*;?/gi, '');
  }

  /**
   * 配色"自洽性"检测（FR-B）：判断 HTML 是否已形成单一色相族 + 中性灰阶的自洽配色。
   * 自洽 → 返回 true，调用方应跳过 sanitizeGradientColors / enforceSinglePalette 的颜色重写，
   * 避免把参考图驱动生成的红色系页面（或其它任何单一色系页面）被重染成传入的 primaryColor。
   *
   * 判定：
   *   1. 收集 style 内与 svg fill/stroke 中出现的所有颜色 token；
   *   2. 过滤中性色（灰/白/黑/transparent/currentColor/none/url(#...)/命名色）；
   *   3. 剩余"彩色"色相，若其环形最大空隙 >= 360 - HUE_WINDOW（即全部色相落在某个 ≤HUE_WINDOW 的窗口内），
   *      视为单一色系 → 自洽。
   * 无彩色 token（纯中性/无彩色页面）一律视为自洽（历史重写本为 no-op）。
   */
  private detectHarmonizedPalette(html: string): boolean {
    const tokens: string[] = [];
    const styleRe = /<[a-z][^>]*style="([^"]*)"/gi;
    let sm: RegExpExecArray | null;
    while ((sm = styleRe.exec(html)) !== null) {
      const m2 = sm[1].match(/#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)/g);
      if (m2) tokens.push(...m2);
    }
    const svgRe =
      /<(?:svg|path|circle|rect|line|polyline|polygon|ellipse|use)\b[^>]*?\s+(?:stroke|fill)\s*=\s*["']([^"']*?)["']/gi;
    let vm: RegExpExecArray | null;
    while ((vm = svgRe.exec(html)) !== null) tokens.push(vm[1]);

    const HUE_WINDOW = 40;
    const chromaHues: number[] = [];
    for (const raw of tokens) {
      const low = raw.trim().toLowerCase();
      if (low === 'transparent' || low === 'currentcolor' || low === 'none') continue;
      if (/^url\(#/.test(low)) continue;
      let hex: string | null = null;
      if (low.charAt(0) === '#') hex = this.normalizeHex(low);
      else if (/^rgba?\(/i.test(low)) hex = this.rgbStringToHex(low);
      if (!hex) continue; // 命名色等无法解析 → 跳过
      const hsl = hexToHsl(hex);
      if (!hsl) continue;
      // 中性（低饱和或极亮/暗）不算彩色色相分布。
      // 注意：正文常用灰阶（Tailwind gray-400~800 等）虽带轻微蓝/暖色相偏（饱和度约 0.10~0.30），
      // 但人眼视为中性。阈值若过低（0.12），参考红页的正文灰字会被误判为「第二色相」→ 整页判为
      // 多色相混杂（脏色）→ 配色重写把参考红全量重染成默认蓝（根因 B 的失败模式）。
      // 因此把中性饱和度阈值提到 0.30：仅饱和度 ≥0.30 的鲜亮色才计入色相分布，
      // 灰阶一律视为中性 → 参考红（单一鲜亮色相）+ 灰阶 → 自洽 → 跳过重写（不毁容）。
      // 真多色相页（如红 + 鲜绿 #16a34a s≈0.7）仍会因两色均 ≥0.30 而判定混杂 → 走原重写逻辑。
      if (hsl.s < 0.3 || hsl.l < 0.06 || hsl.l > 0.95) continue;
      chromaHues.push(hsl.h);
    }
    if (chromaHues.length === 0) return true; // 仅中性/无彩色 → 自洽
    const sorted = [...chromaHues].sort((a, b) => a - b);
    let largestGap = 360 - (sorted[sorted.length - 1] - sorted[0]); // 跨 0° 环隙
    for (let i = 1; i < sorted.length; i++) {
      largestGap = Math.max(largestGap, sorted[i] - sorted[i - 1]);
    }
    // 若最大空隙 >= 360 - 窗口，则所有色相可容纳在一个 ≤HUE_WINDOW 的色相窗口内 → 单一色系
    return largestGap >= 360 - HUE_WINDOW;
  }

  private sanitizeGradientColors(
    html: string,
    primaryColor: string,
    primaryColorDarker: string,
    colorPolicy?: SlideColorPolicy,
  ): string {
    const primaryHex = (primaryColor || '').toLowerCase();
    const darkerHex = (primaryColorDarker || '').toLowerCase();
    const allowed = new Set([
      primaryHex,
      darkerHex,
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
      '#fff',
      '#000000',
      '#000',
      'transparent',
    ]);
    // 参考撞色板 / 标题色 / 正文色 / 描边色作为显式白名单放行（参考克隆·色彩红线豁免）
    if (colorPolicy) {
      for (const c of [
        colorPolicy.titleColor,
        colorPolicy.bodyColor,
        colorPolicy.strokeColor,
        ...colorPolicy.accents,
      ]) {
        if (c) allowed.add(c.toLowerCase());
      }
    }
    const pHsl = hexToHsl(primaryHex);
    const dHsl = hexToHsl(darkerHex);
    // FR-8：色相宽松白名单（≤32°）允许同色系自然明暗变化，跨色相渐变直接归一成 primary→darker
    const hueTolerantAllowed = (hex: string): boolean => {
      const low = hex.toLowerCase();
      if (allowed.has(low)) return true;
      const hsl = hexToHsl(low);
      if (!hsl) return false;
      if (hsl.s < 0.12 || hsl.l < 0.06 || hsl.l > 0.95) return true;
      if (pHsl && hueDeltaDeg(hsl.h, pHsl.h) <= 32) return true;
      if (dHsl && hueDeltaDeg(hsl.h, dHsl.h) <= 32) return true;
      return false;
    };
    const remapStopColor = (hex: string): string => {
      const hsl = hexToHsl(hex.toLowerCase());
      if (!hsl) return darkerHex;
      const midL = dHsl && pHsl ? (dHsl.l + pHsl.l) / 2 : 0.45;
      return hsl.l <= midL ? darkerHex : primaryHex;
    };

    return (
      html
        .replace(/linear-gradient\(\s*([^)]+)\)/gi, (_fullMatch: string, inner: string) => {
          const angleMatch = inner.match(/^(\d+deg|to\s+\w+(?:\s+\w+)?)\s*,?/i);
          const prefix = angleMatch ? angleMatch[1] + ', ' : '';
          const stopsPart = angleMatch ? inner.substring(angleMatch[0].length) : inner;
          const stops = stopsPart.split(/\s*,\s*(?![^()]*\))/);
          const stopHexes = stops
            .map((s) => {
              const m = s.match(/#(?:[0-9a-f]{3,8})/i);
              return m ? this.normalizeHex(m[0]) : null;
            })
            .filter((x): x is string => !!x);
          const hasCrossHueStop = stopHexes.some((h) => !hueTolerantAllowed(h));
          const unique = stopHexes.filter(
            (h, i, arr) => i === arr.findIndex((x) => x?.toLowerCase() === h.toLowerCase()),
          );
          if (hasCrossHueStop || unique.length > 2) {
            return `linear-gradient(${prefix}${primaryHex}, ${darkerHex})`;
          }
          const sanitizedStops = stops.map((stop) => {
            const hexMatch = stop.match(/#(?:[0-9a-f]{3,8})/i);
            if (!hexMatch) return stop;
            const hex = this.normalizeHex(hexMatch[0]);
            if (!hex) return stop;
            if (hueTolerantAllowed(hex)) return stop;
            return stop.replace(
              new RegExp(hexMatch[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'),
              remapStopColor(hex),
            );
          });
          return `linear-gradient(${prefix}${sanitizedStops.join(', ')})`;
        })
        // SVG <stop stop-color>
        .replace(
          /(<stop\b[^>]*?stop-color\s*=\s*["'])(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\))(["'])/gi,
          (full, pre: string, col: string, end: string) => {
            const token = col.trim();
            const hex =
              token.charAt(0) === '#' ? this.normalizeHex(token) : this.rgbStringToHex(token);
            if (!hex) return full;
            if (hueTolerantAllowed(hex)) return full;
            return pre + remapStopColor(hex) + end;
          },
        )
    );
  }

  private normalizeHex(hex: string): string | null {
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
  private hexToRgba(hex: string, alpha: number): string {
    const rgb = this.hexToRgb(hex);
    if (!rgb) return `rgba(0, 0, 0, ${alpha})`;
    return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
  }

  /** rgb()/rgba() 字符串只看 rgb 三通道 → #rrggbb（alpha 仅用于判断透明度，不影响色相）。 */
  private rgbStringToHex(str: string): string | null {
    const m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(str);
    if (!m) return null;
    const clamp = (n: number): string =>
      Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0');
    return `#${clamp(parseInt(m[1], 10))}${clamp(parseInt(m[2], 10))}${clamp(parseInt(m[3], 10))}`;
  }

  private hexToRgb(hex: string): { r: number; g: number; b: number } | null {
    const h = this.normalizeHex(hex);
    if (!h) return null;
    return {
      r: parseInt(h.substring(1, 3), 16),
      g: parseInt(h.substring(3, 5), 16),
      b: parseInt(h.substring(5, 7), 16),
    };
  }

  /**
   * 单一配色约束：把 style 内 color/background/background-color/border 系属性与
   * outline、box-shadow 处出现的
   * 非白名单颜色（hex 与 rgb()/rgba()）按所在属性规整到品牌主色或中性灰阶，保证 H1/H2/H3 渐变只能
   * primary→darker、正文文字只用中性深灰。
   * 语义色（进度条/胜出徽章/警告背景）仅允许出现在 background 或 border 属性值中；出现在 color/box-shadow 时会被替换。
   */
  private enforceSinglePalette(
    html: string,
    primaryColor: string,
    primaryColorDarker: string,
    colorPolicy?: SlideColorPolicy,
  ): string {
    const primary = (primaryColor || '').toLowerCase();
    const darker = (primaryColorDarker || '').toLowerCase();
    const graySet = new Set([
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
      '#fff',
      '#000000',
      '#000',
    ]);
    const semanticSet = new Set(['#10b981', '#059669', '#ef4444', '#dc2626', '#f59e0b']);
    const colorTokenRe = /#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)/g;
    const relevantPropRe =
      /^(?:color|background|background-color|border(?:-(?:top|right|bottom|left))?|border-color|border-(?:top|right|bottom|left)-color|outline|outline-color|box-shadow)$/;
    let unknownPreserved = 0;

    const pHsl = hexToHsl(primary);
    const dHsl = hexToHsl(darker);

    // 参考撞色板 / 标题色 / 正文色 / 描边色作为显式白名单（参考克隆·色彩红线豁免）
    const refExtra = new Set<string>();
    if (colorPolicy) {
      for (const c of [
        colorPolicy.titleColor,
        colorPolicy.bodyColor,
        colorPolicy.strokeColor,
        ...colorPolicy.accents,
      ]) {
        if (c) refExtra.add(c.toLowerCase());
      }
    }

    const isBackgroundish = (prop: string): boolean =>
      prop === 'background' || prop === 'background-color';

    const colorToHex = (token: string): string | null => {
      const t = token.trim();
      if (t.charAt(0) === '#') return this.normalizeHex(t);
      return this.rgbStringToHex(t); // rgba 只看 (r,g,b) 三通道是否白名单
    };

    const isSameHueFamily = (baseHex: string): boolean => {
      const hsl = hexToHsl(baseHex.toLowerCase());
      if (!hsl) return false;
      if (hsl.s < 0.12 || hsl.l < 0.06 || hsl.l > 0.95) return true; // 灰度/纯黑白算同家族放行
      if (pHsl && hueDeltaDeg(hsl.h, pHsl.h) <= 32) return true;
      if (dHsl && hueDeltaDeg(hsl.h, dHsl.h) <= 32) return true;
      return false;
    };

    const isAllowed = (baseHex: string, prop: string): boolean => {
      const h = baseHex.toLowerCase();
      if (h === primary || h === darker || h === 'transparent') return true;
      if (graySet.has(h)) return true;
      if (refExtra.has(h)) return true; // 参考撞色 / 标题色 / 正文色 / 描边色放行
      // FR-8/FR-6：色相接近（≤32°）或灰度，判为同色系合法色调变化，放行
      if (isSameHueFamily(h)) return true;
      if (
        isBackgroundish(prop) ||
        prop === 'border' ||
        prop === 'border-color' ||
        prop.startsWith('border-')
      ) {
        if (semanticSet.has(h)) return true;
      }
      if (prop === 'outline' && semanticSet.has(h)) return true;
      return false;
    };

    const replaceSolidToken = (token: string, prop: string, styleBody: string): string => {
      const t = token.trim();
      if (t.toLowerCase() === 'transparent') return token;
      const baseHex = colorToHex(t);
      if (!baseHex) {
        unknownPreserved++;
        return token;
      }
      if (isAllowed(baseHex, prop)) return token;
      if (prop === 'color') {
        // 头部大标题（font-size>=40px）用参考标题色（若有），否则近黑；正文用深灰。
        const headline = /font-size\s*:\s*(?:4\d|[5-9]\d|\d{3,})\s*px/i.test(styleBody);
        if (headline && colorPolicy?.titleColor) return colorPolicy.titleColor;
        return headline ? '#111827' : '#374151';
      }
      if (prop === 'box-shadow') {
        return primary ? `${primary}40` : token;
      }
      if (isBackgroundish(prop)) {
        const am = /rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*([\d.]+)\s*\)/i.exec(t);
        if (am && parseFloat(am[1]) <= 0.2) {
          return primary ? this.hexToRgba(primary, 0.08) : '#F3F4F6';
        }
        return '#F3F4F6';
      }
      // border*/outline → 主色
      return primary || '#111827';
    };

    const replaceGradientToken = (token: string): string => {
      const baseHex = colorToHex(token);
      if (baseHex) {
        const h = baseHex.toLowerCase();
        if (h === primary || h === darker || graySet.has(h) || refExtra.has(h)) return token;
      } else {
        unknownPreserved++;
        return token;
      }
      return darker;
    };

    const result = html.replace(
      /(<[a-z][^>]*style=")([^"]*)(")/gi,
      (full, pre: string, styleBody: string, quote: string) => {
        const nextStyle = styleBody
          .split(';')
          .map((decl) => {
            const mm = /^\s*([a-zA-Z-]+)\s*:\s*([\s\S]*)$/.exec(decl);
            if (!mm) return decl;
            const prop = mm[1].toLowerCase();
            if (!relevantPropRe.test(prop)) return decl;
            const value = mm[2];
            const newValue = /linear-gradient/i.test(value)
              ? value.replace(colorTokenRe, replaceGradientToken)
              : value.replace(colorTokenRe, (tok) => replaceSolidToken(tok, prop, styleBody));
            return newValue === value ? decl : decl.replace(value, newValue);
          })
          .join(';');
        if (nextStyle === styleBody) return full;
        return `${pre}${nextStyle}${quote}`;
      },
    );
    if (unknownPreserved > 0) {
      console.warn(
        `[PALETTE] 存在无法可靠判定的颜色，已保持原值（debug），count=${unknownPreserved}`,
      );
    }

    // ---- SVG 元素级 stroke/fill 属性纳入单色系 ----
    // 白名单：primary/darker/灰阶/白/黑/transparent/currentColor/none/url(#...)；
    // 非白名单的 hex/rgb()/rgba() → primary；rgba alpha<=0.15 的浅底 → primary@0.08。
    const isSvgAllowed = (token: string): boolean => {
      const t = token.trim().toLowerCase();
      if (t === 'transparent' || t === 'currentcolor' || t === 'none') return true;
      if (/^url\(#/.test(t)) return true; // url(#梯度id)
      if (t.charAt(0) === '#') {
        const hex = this.normalizeHex(t);
        if (!hex) return true; // 无法解析 → 保持原值
        const h = hex.toLowerCase();
        return h === primary || h === darker || graySet.has(h) || refExtra.has(h);
      }
      if (/^rgba?\(/i.test(t)) {
        const baseHex = this.rgbStringToHex(t);
        if (!baseHex) return true;
        const h = baseHex.toLowerCase();
        return h === primary || h === darker || graySet.has(h) || refExtra.has(h);
      }
      return true; // 非颜色 token（命名色等）→ 保持原值
    };
    const resolveSvgColor = (token: string): string | null => {
      const t = token.trim();
      if (t.charAt(0) === '#') return primary;
      if (/^rgba\(/i.test(t)) {
        const am = /rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*([\d.]+)\s*\)/i.exec(t);
        if (am && parseFloat(am[1]) <= 0.15)
          return primary ? this.hexToRgba(primary, 0.08) : '#F3F4F6';
        return primary;
      }
      if (/^rgb\(/i.test(t)) return primary;
      return null; // 其它 token 已由 isSvgAllowed 兜底保持原值
    };
    const svgPropRe =
      /(<(?:svg|path|circle|rect|line|polyline|polygon|ellipse|use)\b[^>]*?)\s+(stroke|fill)\s*=\s*(["'])([^"']*?)\3/gi;
    const resultWithSvg = result.replace(
      svgPropRe,
      (full, tagPrefix: string, attrName: string, q: string, tokenVal: string) => {
        if (isSvgAllowed(tokenVal)) return full;
        const replacement = resolveSvgColor(tokenVal);
        if (replacement === null) return full;
        return `${tagPrefix} ${attrName}=${q}${replacement}${q}`;
      },
    );

    return resultWithSvg;
  }

  /**
   * 背景图兜底注入：当 slide HTML 里没有预先写好 BG_PLACEHOLDER 时（内容 LLM 没按模板写背景样式），
   * 退一步直接把图片 url 作为 background-image 插入到 slide 最外层 <div style="..."> 的 style 属性里。
   * 是 Defect Fix 2/4 的配套 helper。
   * 返回 { attempted: 是否尝试过注入, injected: 成功注入的 slide 数量 }
   */
  private injectBackgroundImageToDiv(
    slides: HTMLSlide[],
    bgImageUrl: string,
  ): { attempted: boolean; injected: number } {
    if (!slides || !slides.length || !bgImageUrl) return { attempted: false, injected: 0 };
    const escapedUrl = String(bgImageUrl).replace(/"/g, '&quot;');
    const inlineStyle = `background-image:url('${escapedUrl}');background-size:cover;background-position:center;background-repeat:no-repeat;`;
    let injected = 0;
    for (const slide of slides) {
      if (!slide || !slide.html) continue;
      // 命中最外层 <div style="..."> 的 style 属性；若没 style 属性就不注入（避免复杂的 HTML 插入，出错概率低）
      if (/style="[^"]*"/i.test(slide.html)) {
        const before = slide.html;
        // 在现有 style 开头插入背景样式，避免被可能存在的末尾 overflow:hidden 等截断问题影响
        slide.html = slide.html.replace(/style="/i, `style="${inlineStyle}`);
        if (slide.html !== before) injected++;
      }
    }
    return { attempted: true, injected };
  }

  /** 旧代码硬编码的 FULL_FONT_FAMILY sans 常量：与 ensureOuterContainer 曾经写死的、finalGuard 老 HTML 中的系统默认 sans 栈逐字节相等。
   *  仅当 font-family 与此串逐字节匹配（或其历史短版子集）时，才视为"老默认占位值"而允许被 fontFamily 选项覆盖。
   *  任何真实定制（mono、带引号的 serif、LLM 自写栈、带本地字体名等）都不会命中此串，因此保持 addIfMissing 的绝对幂等性。
   */
  private readonly DEFAULT_HARDCODED_SANS =
    "system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,'Noto Sans SC','PingFang SC','Microsoft YaHei',sans-serif";

  /** 老生成链路遗留 6 项 mono 占位全集白名单（旧 PAGE_TEMPLATES 示例字面量、及其衍生的老 presentation.json）：
   *  仅用于 isDefaultLegacyMonoPlaceholder 的子集宽松判定，**不得**作为新栈返回值；新栈统一走 getFontStack('mono')。
   */
  private readonly DEFAULT_HARDCODED_MONO_LEGACY =
    "'JetBrains Mono', ui-monospace, 'Cascadia Code', Consolas, 'Noto Sans Mono CJK SC', monospace";

  /** 单个字体名归一化：去全部空格、统一引号→去引号、去分号等垃圾字符、转小写。
   *  用于「子集白名单」判定。对 parseStyleDeclarations 解析遗留的末尾分号等脏字符做纵深防御。
   */
  private normalizeFontName(name: string): string {
    return name.replace(/\s+/g, '').replace(/["';]/g, '').toLowerCase();
  }

  /** 「老默认 sans 占位」宽松判定：
   *  当前值拆分为字体名列表后，**每一项**都出现在 DEFAULT_HARDCODED_SANS 的白名单里（子集判定）。
   *  → 兼容历史短版 sans（如 slide-08 场景：缺 Noto Sans SC / PingFang SC / Microsoft YaHei），
   *  → 同时绝对保证 NFR-2 幂等：任何真实定制（JetBrains Mono / Georgia / Cascadia Code / ui-monospace 等）
   *    都不可能"每一项都在 sans 白名单里"，因此 100% 不会被误覆盖。
   *  输入前置清洗：对 Map 重写分支 parseStyleDeclarations 可能遗留的首尾空白、末尾分号等做剥离。
   */
  private isDefaultSansPlaceholder(current: string): boolean {
    if (!current) return false;
    const cleaned = current.trim().replace(/;+$/g, '');
    if (!cleaned) return false;
    const normalizeName = (s: string) => this.normalizeFontName(s);
    const currentParts = cleaned.split(',').map(normalizeName).filter(Boolean);
    if (currentParts.length === 0) return false;
    const defaultSansNames = new Set(
      this.DEFAULT_HARDCODED_SANS.split(',').map(normalizeName).filter(Boolean),
    );
    return currentParts.every((p) => defaultSansNames.has(p));
  }

  /** 「老遗留 6 项 mono 占位」宽松判定（与 isDefaultSansPlaceholder 对称）：
   *  当前值拆分为字体名列表后，**每一项**都出现在 DEFAULT_HARDCODED_MONO_LEGACY 的白名单里（子集判定）。
   *  → 兼容历史缺项版本（如缺 ui-monospace、或缺 Consolas；顺序变化），保证老 HTML 能透明升级。
   *  → 同时保证 NFR-2：任何真实定制栈（带 PingFang / Microsoft YaHei / system-ui / Georgia 等）必然有外项，判定 false。
   *  输入前置清洗：对 Map 重写分支 parseStyleDeclarations 可能遗留的首尾空白、末尾分号等做剥离。
   *  —— Fix A (vitest FAIL 修复)：额外要求当前拆分项 ≥ 5 项。老代码写的 6 项全集 / 历史缺 1 项（5/6）必然满足；
   *     任何用户/LLM 真实定制短版（如 3 项 JetBrains Mono + ui-monospace + monospace）长度不足 5 必然判 false，
   *     不再被误判为"可升级占位"，保证 NFR-2 幂等。
   */
  private isDefaultLegacyMonoPlaceholder(current: string): boolean {
    if (!current) return false;
    const cleaned = current.trim().replace(/;+$/g, '');
    if (!cleaned) return false;
    const normalizeName = (s: string) => this.normalizeFontName(s);
    const currentParts = cleaned.split(',').map(normalizeName).filter(Boolean);
    if (currentParts.length === 0) return false;
    // Fix A: 老遗留 mono 占位至少需要 5 项（仅允许缺 1 项），3 项短栈必然是真实定制
    if (currentParts.length < 5) return false;
    const legacyMonoNames = new Set(
      this.DEFAULT_HARDCODED_MONO_LEGACY.split(',').map(normalizeName).filter(Boolean),
    );
    return currentParts.every((p) => legacyMonoNames.has(p));
  }

  /** 通用「默认占位 font-family」判定（老默认 sans 占位 OR 老遗留 mono 占位，任一命中即可允许升级）。
   *  由 ensureOuterContainer 三分支统一调用，替代原先分散调用 isDefaultSansPlaceholder 的逻辑。
   */
  private isPlaceholderFontFamily(current: string): boolean {
    return this.isDefaultSansPlaceholder(current) || this.isDefaultLegacyMonoPlaceholder(current);
  }

  /**
   * 生成调用封装：在真正降级为极简 fallback 之前，对 LLM 调用失败（fetch failed / 超时等）
   * 进行有限次重试（默认 2 次）。这样网络抖动 / 单侧超时不再直接摧毁整页版式。
   */
  private async generateSlideHtmlSafe(
    slidePlan: SlidePlan,
    rp: {
      primaryColor: string;
      primaryColorDarker: string;
      fontFamily: 'sans' | 'serif' | 'mono';
      iconStyle: IconStyle;
      style: string;
      density: ContentDensity;
      imagePreference: ImagePreference;
      backgroundEnabled: boolean;
      pageHints?: ReferencePageHints;
      slideCount?: number;
    },
    slideWidth: number,
    slideHeight: number,
    audience: string,
    colorTheme: ColorTheme | undefined,
    referenceHtmlBrief: string,
    feedback: string | undefined,
    referenceVisualAttributes: ReferenceVisualAttributes | undefined,
    pageIndexInCategory = 0,
    maxRetries = 2,
  ): Promise<string> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await this.generateSlideHtml(
          slidePlan,
          rp.primaryColor,
          rp.primaryColorDarker,
          rp.density,
          rp.iconStyle,
          slideWidth,
          slideHeight,
          rp.style,
          audience,
          colorTheme,
          rp.fontFamily,
          rp.imagePreference,
          rp.backgroundEnabled,
          referenceHtmlBrief,
          feedback,
          referenceVisualAttributes,
          pageIndexInCategory,
        );
      } catch (e) {
        lastErr = e;
        if (attempt < maxRetries) {
          console.warn(
            `[RETRY] 页「${slidePlan.title}」HTML 生成失败（attempt ${attempt + 1}/${maxRetries + 1}），准备重试...`,
            e,
          );
        }
      }
    }
    throw lastErr;
  }

  /** ★ 修改同步点（与 templates/generate-html-presentation.ts#getFontStackLocal 逐字节全等）：
   *   - ai: packages/ai/src/agents/html-presentation-agent.ts#getFontStack
   *   - templates: packages/ai/src/templates/generate-html-presentation.ts#getFontStackLocal
   *   CI 约束：fontstack-dual-source-sync.test.ts 保证两份内容 normalize 后全等
   */
  private getFontStack(fontFamily: 'sans' | 'serif' | 'mono' = 'sans'): string {
    switch (fontFamily) {
      case 'serif':
        return "Georgia, 'Times New Roman', 'Noto Serif SC', 'Source Han Serif SC', 'SimSun', 'Songti SC', serif";
      // NOTE: FONT_STACK_MONO —— 若修改请同步：
      //   - ai: packages/ai/src/agents/html-presentation-agent.ts#getFontStack('mono')
      //   - templates: packages/ai/src/templates/generate-html-presentation.ts#getFontStackLocal('mono')
      //   - web: packages/web/src/components/AIGenerateModal.tsx L1111 mono 预览 style
      //   目的：为 CJK 字符在 Windows 下回退时命中微软雅黑(PingFangSC)而不是 SimSun(衬线宋)。
      case 'mono':
        return "'JetBrains Mono', ui-monospace, 'Cascadia Code', Consolas, 'PingFang SC', 'Microsoft YaHei', '微软雅黑', 'Noto Sans SC', 'Noto Sans Mono CJK SC', monospace";
      case 'sans':
      default:
        return "system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,'Noto Sans SC','PingFang SC','Microsoft YaHei',sans-serif";
    }
  }

  private generateFallbackSlide(
    plan: SlidePlan,
    primaryColor: string,
    slideWidth: number = 1280,
    slideHeight: number = 720,
    fontFamily: 'sans' | 'serif' | 'mono' = 'sans',
    iconStyle?: string,
  ): string {
    const marker = iconStyle === 'checkmark' ? '✔' : iconStyle === 'number' ? '' : '●';
    const keyPointsHtml = (plan.keyPoints || [])
      .map((p, i) => {
        const prefix =
          iconStyle === 'number'
            ? `<span style="color:${primaryColor};font-weight:700;margin-right:10px;">${i + 1}.</span>`
            : `<span style="color:${primaryColor};margin-right:10px;">${marker}</span>`;
        return `<li style="list-style:none;display:flex;align-items:flex-start;font-size:18px;line-height:2;color:#374151;">${prefix}<span style="flex:1;">${p}</span></li>`;
      })
      .join('');
    const padX = Math.max(32, Math.round((64 * slideWidth) / 1280 / 8) * 8);
    const padY = Math.max(24, Math.round((48 * slideHeight) / 720 / 8) * 8);
    const primaryColorDarker = darkenColor(primaryColor, 20);
    const fontStack = this.getFontStack(fontFamily);
    const h2Style = `font-size:48px;font-weight:700;margin:0 0 32px 0;line-height:1.25;background:linear-gradient(135deg,${primaryColor},${primaryColorDarker});-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;`;
    // data-degraded="true"：标记该页为「大模型生成失败后的极简兜底」，供前端识别并提示「单页重新生成」。
    return `<div data-degraded="true" style="width:100%;height:100%;overflow:hidden;position:relative;box-sizing:border-box;padding:${padY}px ${padX}px;display:flex;flex-direction:column;background-color:#fff;font-family:${fontStack};">
  <h2 style="${h2Style}">${plan.title}</h2>
  <div style="flex:1;display:flex;flex-direction:column;gap:16px;min-height:0;overflow:hidden;justify-content:center;">
    ${keyPointsHtml ? `<ul style="font-size:18px;line-height:2;color:#374151;margin:0;padding-left:0;">${keyPointsHtml}</ul>` : ''}
  </div>
</div>`;
  }

  async generatePresentationFromReference(
    topic: string,
    _referenceHtml: string,
    options?: PresentationGenerationOptions,
  ): Promise<HTMLPresentation> {
    return this.generatePresentation(topic, options);
  }

  async modifySlide(
    currentHtml: string,
    userRequest: string,
    primaryColor: string = '#2563eb',
  ): Promise<string> {
    const timestamp = formatBeijingTime();
    const startTime = Date.now();
    console.log(`\n[${timestamp}] [AGENT] ========== modifySlide 开始 ==========`);
    console.log(
      `[${timestamp}] [AGENT] 用户指令: ${userRequest.length > 200 ? userRequest.substring(0, 200) + '...' : userRequest}`,
    );
    console.log(
      `[${timestamp}] [AGENT] 当前HTML长度: ${currentHtml.length} chars, primaryColor: ${primaryColor}`,
    );
    console.log(
      `[${timestamp}] [AGENT] 编辑模型: ${this.editingProvider.name}/${this.editingProvider.config.model}`,
    );

    const prompt = HTML_SLIDE_MODIFICATION_PROMPT.replace(/\{\{PRIMARY_COLOR\}\}/g, primaryColor)
      .replace(/\{\{TITLE_TEXT_COLOR\}\}/g, '#111827')
      .replace(/\{\{BODY_TEXT_COLOR\}\}/g, '#374151')
      .replace('{{CURRENT_HTML}}', currentHtml)
      .replace('{{USER_REQUEST}}', userRequest)
      .replace('{{SCOPE_NOTE}}', '只修改当前这一页的内容，保持其他页面不变。');
    const messages: ChatMessage[] = [
      { role: 'system', content: '你是一个专业的前端设计师，严格遵守8pt网格和设计规范。' },
      { role: 'user', content: prompt },
    ];
    switchStage(this.editingProvider, 'editing');
    const response = await this.editingProvider.chat(messages, {
      temperature: 0.7,
      maxTokens: 8000,
    });
    let html = this.extractHtml(response.content);
    const rawLen = html.length;
    html = this.sanitizeSlideHtml(html);
    html = this.sanitizeGradientColors(html, primaryColor, darkenColor(primaryColor, 20));
    html = this.wrapTextNodes(html);
    html = this.flattenMeaninglessNesting(html);
    html = this.ensureSemanticWrapping(html);

    const duration = Date.now() - startTime;
    const endTimestamp = formatBeijingTime();
    console.log(
      `[${endTimestamp}] [AGENT] modifySlide 完成: raw=${rawLen} chars → final=${html.length} chars, 耗时=${formatDuration(duration)}, tokens=${response.usage?.totalTokens ?? 'N/A'}`,
    );
    console.log(`[${endTimestamp}] [AGENT] ========== modifySlide 结束 ==========\n`);
    return html;
  }

  async modifyElement(elementHtml: string, userRequest: string): Promise<string> {
    const timestamp = formatBeijingTime();
    const startTime = Date.now();
    const tagMatch = elementHtml.match(/^<([a-zA-Z0-9]+)/);
    const tagName = tagMatch ? tagMatch[1] : 'unknown';
    console.log(`\n[${timestamp}] [AGENT] ========== modifyElement 开始 ==========`);
    console.log(
      `[${timestamp}] [AGENT] 用户指令: ${userRequest.length > 200 ? userRequest.substring(0, 200) + '...' : userRequest}`,
    );
    console.log(
      `[${timestamp}] [AGENT] 元素类型: <${tagName}>, HTML长度: ${elementHtml.length} chars`,
    );
    console.log(
      `[${timestamp}] [AGENT] 编辑模型: ${this.editingProvider.name}/${this.editingProvider.config.model}`,
    );

    const prompt = `你是一个专业的前端设计师。请根据用户的要求，修改指定的 HTML 元素。

## 要求
1. 只输出修改后的完整 HTML 元素，不要输出其他解释
2. 保持整体设计风格一致
3. 所有样式使用 inline style
4. 保持元素的 position、left、top、width、height 等定位属性不变
5. 只修改用户要求修改的部分
6. 图片必须设置 max-width:100%;max-height:100%;object-fit:contain;
7. 确保修改后的元素大小和位置不变

## 当前元素 HTML
\`\`\`html
{{ELEMENT_HTML}}
\`\`\`

## 用户修改要求
{{USER_REQUEST}}

请输出修改后的完整 HTML 元素：
`
      .replace('{{ELEMENT_HTML}}', elementHtml)
      .replace('{{USER_REQUEST}}', userRequest);
    const messages: ChatMessage[] = [
      { role: 'system', content: '你是一个专业的前端设计师。' },
      { role: 'user', content: prompt },
    ];
    switchStage(this.editingProvider, 'editing');
    const response = await this.editingProvider.chat(messages, {
      temperature: 0.7,
      maxTokens: 4000,
    });
    let html = this.extractHtml(response.content);
    const rawLen = html.length;
    html = this.sanitizeSlideHtml(html);
    html = this.sanitizeGradientColors(html, '#2563eb', '#1e4fbc');

    const duration = Date.now() - startTime;
    const endTimestamp = formatBeijingTime();
    console.log(
      `[${endTimestamp}] [AGENT] modifyElement 完成: raw=${rawLen} chars → final=${html.length} chars, 耗时=${formatDuration(duration)}, tokens=${response.usage?.totalTokens ?? 'N/A'}`,
    );
    console.log(`[${endTimestamp}] [AGENT] ========== modifyElement 结束 ==========\n`);
    return html;
  }

  async modifyGlobal(
    presentation: HTMLPresentation,
    currentSlideIndex: number,
    userRequest: string,
  ): Promise<HTMLPresentation> {
    const timestamp = formatBeijingTime();
    const startTime = Date.now();
    const totalHtmlLen = presentation.slides.reduce((sum, s) => sum + s.html.length, 0);
    console.log(`\n[${timestamp}] [AGENT] ========== modifyGlobal 开始 ==========`);
    console.log(
      `[${timestamp}] [AGENT] 用户指令: ${userRequest.length > 200 ? userRequest.substring(0, 200) + '...' : userRequest}`,
    );
    console.log(
      `[${timestamp}] [AGENT] 演示文稿: "${presentation.title}", 共 ${presentation.slides.length} 页, 总HTML长度: ${totalHtmlLen} chars`,
    );
    console.log(
      `[${timestamp}] [AGENT] 当前页: 第 ${currentSlideIndex + 1} 页 "${presentation.slides[currentSlideIndex]?.title || ''}"`,
    );
    console.log(
      `[${timestamp}] [AGENT] 编辑模型: ${this.editingProvider.name}/${this.editingProvider.config.model}`,
    );

    const currentSlide = presentation.slides[currentSlideIndex];
    const extractedCount = extractSlideCount(userRequest);
    let enhancedRequest = userRequest;
    if (extractedCount) {
      enhancedRequest += `\n\n【重要】幻灯片数量要求：严格只有 ${extractedCount} 页`;
      console.log(`[${timestamp}] [AGENT] 检测到页数要求: ${extractedCount} 页`);
    }
    const primaryColor = presentation.primaryColor || '#2563eb';
    const prompt = HTML_GLOBAL_MODIFICATION_PROMPT.replace(/\{\{PRIMARY_COLOR\}\}/g, primaryColor)
      .replace(/\{\{TITLE_TEXT_COLOR\}\}/g, '#111827')
      .replace(/\{\{BODY_TEXT_COLOR\}\}/g, '#374151')
      .replace('{{PRESENTATION_TITLE}}', presentation.title)
      .replace('{{SLIDE_COUNT}}', String(presentation.slides.length))
      .replace('{{CURRENT_SLIDE_INDEX}}', String(currentSlideIndex + 1))
      .replace('{{CURRENT_SLIDE_TITLE}}', currentSlide?.title || '')
      .replace('{{CURRENT_HTML}}', currentSlide?.html || '')
      .replace('{{USER_REQUEST}}', enhancedRequest);
    const messages: ChatMessage[] = [
      { role: 'system', content: '你是一个专业的演示文稿设计总监，遵循8pt网格和统一设计规范。' },
      { role: 'user', content: prompt },
    ];
    switchStage(this.editingProvider, 'editing');
    const response = await this.editingProvider.chat(messages, {
      temperature: 0.7,
      maxTokens: 16000,
    });
    const result = this.parsePresentation(response.content, primaryColor);

    const duration = Date.now() - startTime;
    const endTimestamp = formatBeijingTime();
    const resultHtmlLen = result.slides.reduce((sum, s) => sum + s.html.length, 0);
    console.log(
      `[${endTimestamp}] [AGENT] modifyGlobal 完成: 返回 ${result.slides.length} 页, 总HTML长度: ${resultHtmlLen} chars, 耗时=${formatDuration(duration)}, tokens=${response.usage?.totalTokens ?? 'N/A'}`,
    );
    if (result.slides.length !== presentation.slides.length) {
      console.log(
        `[${endTimestamp}] [AGENT] 页数变化: ${presentation.slides.length} → ${result.slides.length}`,
      );
    }
    console.log(`[${endTimestamp}] [AGENT] ========== modifyGlobal 结束 ==========\n`);
    return result;
  }

  private parsePlan(content: string): PresentationPlan {
    const jsonStr = this.extractJson(content);
    try {
      const data = JSON.parse(jsonStr);
      const slides: SlidePlan[] = Array.isArray(data.slides)
        ? data.slides.map((s: any) => {
            const pageType = (s.pageType as SlidePageType) || 'content-no-image';
            const needsImage =
              !!s.needsImage &&
              ['content-image-left', 'content-image-right', 'content-image-top'].includes(pageType);
            return {
              pageType,
              title: s.title || '',
              keyPoints: Array.isArray(s.keyPoints) ? s.keyPoints.filter(Boolean) : [],
              imagePrompt: typeof s.imagePrompt === 'string' ? s.imagePrompt : undefined,
              imageRatio:
                (s.imageRatio as ImageRatio) ||
                PAGE_TYPE_DEFAULT_IMAGE_RATIO[pageType] ||
                undefined,
              needsImage,
              backgroundPrompt:
                typeof s.backgroundPrompt === 'string' && s.backgroundPrompt
                  ? s.backgroundPrompt
                  : undefined,
            };
          })
        : [];
      return {
        title: data.title || '演示文稿',
        description: data.description,
        primaryColor: data.primaryColor || '#2563eb',
        slides:
          slides.length > 0
            ? slides
            : [
                {
                  pageType: 'cover',
                  title: data.title || '演示文稿',
                  keyPoints: [],
                  needsImage: false,
                },
                { pageType: 'content-no-image', title: '内容', keyPoints: [], needsImage: false },
              ],
      };
    } catch (e) {
      console.error('Failed to parse presentation plan JSON:', e);
      return {
        title: '演示文稿',
        primaryColor: '#2563eb',
        slides: [
          { pageType: 'cover', title: '演示文稿', keyPoints: [], needsImage: false },
          { pageType: 'content-no-image', title: '内容', keyPoints: [], needsImage: false },
        ],
      };
    }
  }

  private parsePresentation(content: string, primaryColor: string = '#2563eb'): HTMLPresentation {
    const jsonStr = this.extractJson(content);
    const primaryColorDarker = darkenColor(primaryColor, 20);
    try {
      const data = JSON.parse(jsonStr);
      const slides = Array.isArray(data.slides)
        ? data.slides.map((s: any) => {
            let html = this.sanitizeSlideHtml(s.html || '');
            html = this.sanitizeGradientColors(html, primaryColor, primaryColorDarker);
            html = this.wrapTextNodes(html);
            html = this.flattenMeaninglessNesting(html);
            html = this.ensureSemanticWrapping(html);
            return {
              title: s.title || '',
              html,
              notes: s.notes || undefined,
            };
          })
        : [];
      return {
        title: data.title || '演示文稿',
        description: data.description || '',
        primaryColor,
        transition: data.transition || 'none',
        slides,
      };
    } catch (e) {
      console.error('Failed to parse presentation JSON:', e);
      throw new Error('Failed to parse AI response');
    }
  }

  private postProcessLayout(
    html: string,
    _pageType?: SlidePageType,
    slideWidth: number = 1280,
    slideHeight: number = 720,
    primaryColor: string = '#2563eb',
    fontFamily?: 'sans' | 'serif' | 'mono',
    titleColor?: string,
    colorPolicy?: SlideColorPolicy,
    composition?: ReferenceComposition,
  ): string {
    // —— Fix C (vitest FAIL 修复)：当调用方未显式传 fontFamily，则按 _pageType 推导默认字体家族。
    //    代码密集型版式：summary（归纳摘要页典型等宽字摘要表）/ content-table（数据表格页横向对齐数值）默认走 mono，
    //    与 LLM 为这些 layout 写出的 JetBrains Mono 老占位保持同方向，避免默认 sans 把老遗留 mono 占位跨家族升级。
    if (!fontFamily) {
      fontFamily = _pageType === 'summary' || _pageType === 'content-table' ? 'mono' : 'sans';
    }
    let result = html;
    // 参考撞色板 / 标题色 / 正文色 / 描边色作为显式白名单：对比度兜底时豁免这些参考色，
    // 避免「参考克隆·撞色保真」被终局对比度重写（#118ab2 等参考色被改写成 #111827）。
    const refColorSet = new Set<string>();
    if (colorPolicy) {
      for (const c of [
        colorPolicy.titleColor,
        colorPolicy.bodyColor,
        colorPolicy.strokeColor,
        ...colorPolicy.accents,
      ]) {
        if (c) refColorSet.add(this.normalizeHex(c) || c.toLowerCase());
      }
    }
    // 主色 / 深色变体也纳入豁免：避免终局对比度把参考 accent 高亮（如 #ff4d6d）误改写成 #111827
    for (const c of [primaryColor, this.darkenPrimaryColor(primaryColor, 0.75)]) {
      if (c) refColorSet.add(this.normalizeHex(c) || c.toLowerCase());
    }
    result = result.replace(/<script[\s\S]*?<\/script>/gi, '');
    result = result.replace(/<style[\s\S]*?<\/style>/gi, '');
    result = result.replace(/on\w+="[^"]*"/gi, '');
    result = result.replace(/on\w+='[^']*'/gi, '');
    result = this.ensureOuterContainer(result, slideWidth, slideHeight, fontFamily);
    result = enforceFlatStructure(result);
    result = this.enforceImageContainerStyles(result);
    result = enforceImageStyles(result, { borderRadius: '12px', addDataImageRatio: true });
    result = enforceFlexChildrenMinWidth(result);
    result = enforceTextWrapping(result);
    // 渐变文字顺序修复：black-block 防御（background 简写覆盖 clip → 黑块 + 透明字）
    result = fixGradientTextDeclarationOrder(result, {
      titleColor,
      primaryColor,
      allowedAccents: colorPolicy?.accents,
      backgroundTone: 'light',
    });
    result = this.enforceTextContainerStyles(result);
    result = this.enforceStretchAlignment(result);
    result = enforceGridLayout(result);
    result = enforceMinFontSize(result, 14);
    // === 列表图标与文字对齐强制修复（兜底，不依赖大模型遵循提示词） ===
    result = this.removeIconMarginTop(result);
    result = this.enforceLiAlignmentCenter(result);
    result = this.enforceListAndTextSpanStyles(result);
    // === 本轮新增 3 个视觉缺陷兜底 ===
    result = this.removeColorCodeWatermark(result); // 缺陷1：背景水印 "#2563b" 类 div 直接删除
    result = this.enforceDarkBgTextContrast(result, primaryColor, colorPolicy); // 缺陷2：深色/主色背景 → 文字强制白色（豁免参考色）
    result = this.fixVerticalWritingLists(result); // 缺陷3：装饰性竖排 writing-mode → 强制改回横排 + 水平列表结构
    // === 本轮新增 4 个 4 建议兜底 ===
    result = this.enforceLightBgTextContrast(result, primaryColor, colorPolicy); // 建议4 C步：浅底/极浅主色禁白字（严重）
    result = this.enforceHeadingColorOnLightBg(result, {
      primaryColor,
      primaryColorDarker: this.darkenPrimaryColor(primaryColor, 0.75),
      titleColor,
    }); // Bug-4 FR-8：浅底 heading 中性色→主色（或参考标题色）；深底 heading →白（双防线代码级兜底）
    result = this.enforceCoverPosterArtStyles(
      result,
      primaryColor,
      slideWidth,
      slideHeight,
      titleColor,
      composition,
    ); // 建议1：封面海报级艺术字兜底
    result = this.enforceLeftRight5545AndCardBar(result, primaryColor); // 建议2：左文右图 55:45 + 卡片条化
    result = this.enforceCardTextProportion(result); // 建议3：卡片文字/图标比例修正
    result = this.enforceFinalTextContrast(result, primaryColor, colorPolicy); // 终局对比度兜底：深底容器强制白字，覆盖全部页型（豁免参考色）
    // 构图护栏：参考为左对齐（或内容页被误居中）时移除根容器居中三件套
    result = applyCompositionGuard(result, composition);
    result = this.cleanupEmptyContainers(result);
    // B1：这里不再重复调用 wrapTextNodes / flattenMeaninglessNesting / ensureSemanticWrapping
    // 因为外层 sanitizeSlideHtml 的 L1412-L1415 已经在 postProcessLayout 前后分别跑了一遍
    // 重复调用会导致 style 属性字符串被多次重建、flex 等默认值反复打架
    // —— Task-6 FR-4 第二轮字号 Clamp 兜底：防止上面 建议1/2/3 兜底函数又把卡片/正文字号写回 28px ——
    //    2025-07 R1 修复：以 round=2 调用，若 modifiedRef.count>0 会打印 round2 专属 warn，便于复核豁免遗漏。
    result = this.enforceBodyFontSize(result, { round: 2 });

    // =====================================================================
    // —— FR-5 最终兜底（子项 C）：非封面（含 <h2>/<h3>/<ul>/<ol>/<img>/<table> 内容标记）
    //    的外层根 flex:column 容器，如 LLM 原 HTML 就没有三件套，绝不允许任何后处理步骤添上三件套。
    //    最后一步正则再清一次，确保 Bug-3 100% 不复发。（即使上面 A/B/C/D 任何遗漏也能兜住）
    // =====================================================================
    const outerMatch = result.match(/^<div([^>]*)>([\s\S]*)<\/div>$/i);
    if (outerMatch) {
      const [, attrsB, innerB] = outerMatch;
      const hasContentSignB = /<h[23]\b|<(ul|ol)\b|<img[\s>]|<table\b/i.test(innerB);
      if (
        hasContentSignB &&
        /display\s*:\s*flex\s*(?:;|$)/i.test(attrsB) &&
        /flex-direction\s*:\s*column/i.test(attrsB)
      ) {
        const newAttrsB = attrsB.replace(/style="([^"]*)"/i, (_ma: string, s: string) => {
          let ns = s;
          // 只清除三件套的 =center 取值（flex-start/其他合法取值不碰）
          ns = ns.replace(/(?:^|;)\s*justify-content\s*:\s*center\s*(?:;|$)/gi, (_mm: string) =>
            _mm.endsWith(';') ? ';' : '',
          );
          ns = ns.replace(/(?:^|;)\s*align-items\s*:\s*center\s*(?:;|$)/gi, (_mm: string) =>
            _mm.endsWith(';') ? ';' : '',
          );
          ns = ns.replace(/(?:^|;)\s*text-align\s*:\s*center\s*(?:;|$)/gi, (_mm: string) =>
            _mm.endsWith(';') ? ';' : '',
          );
          ns = ns.replace(/^;+|;+$/g, '').replace(/;;+/g, ';');
          return `style="${ns}"`;
        });
        result = `<div${newAttrsB}>${innerB}</div>`;
      }
    }

    return result;
  }

  private enforceImageContainerStyles(html: string): string {
    const imgContainerRegex = /<div([^>]*style="[^"]*"[^>]*)>[\s\S]*?<img[^>]*>[\s\S]*?<\/div>/gi;
    return html.replace(imgContainerRegex, (match) => {
      const openTagEnd = match.indexOf('>');
      const openTag = match.substring(0, openTagEnd + 1);
      if (!/style="[^"]*"/i.test(openTag)) return match;
      // B3：改用 Map 精确控制"缺省才补"，不再用 includes 粗判（容易误伤复合属性名）
      const styleMatchInner = openTag.match(/style="([^"]*)"/i);
      if (!styleMatchInner) return match;
      const props = new Map<string, string>();
      for (const d of parseStyleDeclarations(styleMatchInner[1])) props.set(d.key, d.value);
      // —— T6-FR6 防误伤：跳过 width:100% + height:100% 的外层画布根容器 ——
      // 该函数只应为 "紧包 <img> 的图片列" 注入 display:flex 与居中对齐；
      // 外层根容器被误加 justify-content:center 会把 <h2> 强制挤到页面中部，造成大面积空白。
      const w = (props.get('width') || '').trim();
      const h = (props.get('height') || '').trim();
      if (w === '100%' && h === '100%') return match;
      if (!props.has('overflow')) props.set('overflow', 'hidden');
      if (!props.has('min-height')) props.set('min-height', '0');
      if (!props.has('max-height')) props.set('max-height', '100%');
      const hadDisplay = props.has('display');
      if (!hadDisplay) props.set('display', 'flex');
      // 只有显式注入了 display:flex 且没指定对齐的情况下，才给居中对齐默认值；AI 原本就有 display 或已有对齐则完全保留
      if ((props.get('display') || '').trim() === 'flex') {
        if (!props.has('align-items')) props.set('align-items', 'center');
        if (!props.has('justify-content')) props.set('justify-content', 'center');
      }
      const ns = Array.from(props.entries())
        .map(([k, v]) => `${k}:${v}`)
        .join(';');
      const newOpen = openTag.replace(/style="[^"]*"/i, `style="${ns}"`);
      return newOpen + match.substring(openTagEnd + 1);
    });
  }

  private ensureOuterContainer(
    html: string,
    slideWidth: number = 1280,
    slideHeight: number = 720,
    fontFamily: 'sans' | 'serif' | 'mono' = 'sans',
  ): string {
    let result = html.trim();
    // === 修复 C：padding 不能为 0，内容贴边会严重溢出 ===
    const padX = Math.max(32, Math.round((64 * slideWidth) / 1280 / 8) * 8);
    const padY = Math.max(24, Math.round((48 * slideHeight) / 720 / 8) * 8);
    const defaultPadding = `${padY}px ${padX}px`;
    const fullFontFamily = this.getFontStack(fontFamily);
    const outerDivMatch = result.match(/^<div([^>]*)>([\s\S]*)<\/div>$/i);
    if (!outerDivMatch) {
      return `<div style="width:100%;height:100%;overflow:hidden;position:relative;box-sizing:border-box;padding:${defaultPadding};display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;background-color:#fff;font-family:${fullFontFamily};">${result}</div>`;
    }
    const attrs = outerDivMatch[1] || '';
    const inner = outerDivMatch[2] || '';
    const styleMatch = attrs.match(/style="([^"]*)"/i);
    const existingStyle = (styleMatch ? styleMatch[1] : '').trim();

    // ============================================================
    // 🛡️ 根本修复（强信任第一道防线）：如果 AI 写的外层 style 本身就是"合规的完整容器"，
    // 直接 return 原始 HTML，根本不进 parser / required 重写 / Map 合并流程，
    // 任何解析错误、合并错误、fallback 错误都不可能发生。
    // ============================================================
    // —— T6-FR6：非海报/封面页（存在 <h2> / <h3> 或多个 <section/div 结构）禁止"完美居中三件套"——
    // 把外层 column 容器强设 justify-content:center / align-items:center / text-align:center
    // 会导致 H2 居中 + 列表整体顶部留白极大，和作者"标题顶、内容随 H2 下方流"意图冲突。
    // 只有"极简封面"（H1-only，无 H2/H3/UL/IMG）才用居中。
    // —— Bug-3 加固 A：isCoverLike 先剥 HTML 注释再判；大小写不敏感（正则已 /i，内部再 toLowerCase 兜底）
    const stripHtmlComments = (s: string): string => s.replace(/<!--[\s\S]*?-->/g, '');
    const CONTENT_SIGN_RE = /<h[23]\b|<(ul|ol)\b|<img[\s>]|<table\b/i;
    // 复用 core 的居中护栏单一真源（已含多列/分栏结构识别，避免左对齐双列封面被误居中）
    const isCoverLike = (s: string): boolean => isCoverLikeHtml(s);
    let layoutShouldCenter = isCoverLike(inner);
    if (existingStyle) {
      // 用纯字符串检查 8 个必需容器特征（AI 每次都写的一模一样）：
      //   ① width:100%  ② height:100%  ③ overflow:hidden  ④ position:relative
      //   ⑤ box-sizing:border-box  ⑥ padding（非空且非 0）  ⑦ display:flex  ⑧ flex-direction
      //   （background / font-family / justify / align / text-align 缺失了后面再用正则补，不破坏原有）
      const has = (r: RegExp) => r.test(existingStyle);
      const ok8 =
        has(/(?:^|;)\s*width\s*:\s*100%\s*(?:;|$)/i) &&
        has(/(?:^|;)\s*height\s*:\s*100%\s*(?:;|$)/i) &&
        has(/(?:^|;)\s*overflow\s*:\s*hidden\s*(?:;|$)/i) &&
        has(/(?:^|;)\s*position\s*:\s*relative\s*(?:;|$)/i) &&
        has(/(?:^|;)\s*box-sizing\s*:\s*border-box\s*(?:;|$)/i) &&
        has(/(?:^|;)\s*padding\s*:/i) &&
        !/(?:^|;)\s*padding\s*:\s*0(?:px)?\s*(?:;|$)/i.test(existingStyle) &&
        has(/(?:^|;)\s*display\s*:\s*flex\s*(?:;|$)/i) &&
        has(/(?:^|;)\s*flex-direction\s*:\s*(?:column|row)\s*(?:;|$)/i);
      if (ok8) {
        // AI 已经写好了完整的 8 大基础容器属性 → 不进解析重写流程，
        // 只用字符串正则"缺什么补什么"，已有的值一字不改。
        let safeStyle = existingStyle;
        const addIfMissing = (prop: string, fallback: string) => {
          if (
            !new RegExp(`(?:^|;)\\s*${prop.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:`, 'i').test(
              `;${safeStyle}`,
            )
          ) {
            safeStyle = safeStyle.endsWith(';')
              ? `${safeStyle}${prop}:${fallback}`
              : `${safeStyle};${prop}:${fallback}`;
          }
        };
        // padding 为 0 的兜底（虽然 ok8 已经排除了 padding:0，但 8 特征都对时再防一次）
        if (/(?:^|;)\s*padding\s*:\s*0(?:px)?\s*(?:;|$)/i.test(safeStyle)) {
          safeStyle = safeStyle.replace(
            /(padding\s*:\s*)0(?:px)?\s*(;|$)/i,
            (_m, p, s) => `${p}${defaultPadding}${s || ';'}`,
          );
        }
        if (!/(?:^|;)\s*background(?:-color)?\s*:/i.test(`;${safeStyle}`))
          safeStyle += `;background-color:#fff`;
        // font-family 特殊处理：不存在 → 补；存在但命中通用占位（老默认 sans OR 老遗留 mono 占位，精确/历史短版子集）→ 允许覆盖为动态栈；其他真实定制 → 绝对不碰（NFR-2 幂等）
        // （Fix A 已在 isDefaultLegacyMonoPlaceholder 收紧 ≥5 项门槛：3 项短版真实定制不会被误判为占位，天然满足幂等）
        {
          const ffMatch = safeStyle.match(/(?:^|;)\s*font-family\s*:\s*([^;]+)/i);
          const currentFF = ffMatch ? ffMatch[1].trim() : '';
          if (!currentFF) {
            safeStyle = safeStyle.endsWith(';')
              ? `${safeStyle}font-family:${fullFontFamily}`
              : `${safeStyle};font-family:${fullFontFamily}`;
          } else if (this.isPlaceholderFontFamily(currentFF)) {
            // 命中通用占位 → 替换为动态栈：允许跨家族升级（old-sans→mono、old-mono→sans 等，AC-1/AC-3）
            safeStyle = safeStyle.replace(
              /(^|;)\s*font-family\s*:\s*[^;]+/i,
              (_m, prefix) => `${prefix}font-family:${fullFontFamily}`,
            );
          }
        }
        // —— Bug-3 加固 A(续)：ok8 分支三件套注入前再次 isCoverLike + hasAnyContentSign 双重确认
        const ok8HasContentSign = CONTENT_SIGN_RE.test(stripHtmlComments(inner));
        if (layoutShouldCenter && ok8HasContentSign) {
          console.warn(
            '[FIX-BUG3:A] ok8 布局判定与内容标记冲突（存在 h2/h3/ul/ol/img/table），强制降级 layoutShouldCenter=false',
          );
          layoutShouldCenter = false;
        }
        if (layoutShouldCenter) {
          addIfMissing('justify-content', 'center');
          addIfMissing('align-items', 'center');
          addIfMissing('text-align', 'center');
        }
        const newAttrs = styleMatch
          ? attrs.replace(/style="[^"]*"/i, `style="${safeStyle}"`)
          : `${attrs} style="${safeStyle}"`;
        return `<div${newAttrs}>${inner}</div>`;
      }
    }

    const styles: Record<string, string> = {};
    const parsed = existingStyle ? parseStyleDeclarations(existingStyle) : [];
    for (const { key, value } of parsed) {
      styles[key] = value;
    }

    // === 修复 B：解析有效性校验 ===
    // 原 style 中大概有多少个 declaration（按非引号内的 ; 数量 +1 估算），若 parsed 数量 < 估算的 70% 或 关键键（display/flex-direction）丢失 → 判定解析失败，
    // 回退为「保留原 existingStyle 字符串 + 用正则 replace 注入缺失的必要字段」，绝不破坏 AI 写的 padding/font-family 等已有字段
    const estimateDeclCount = (() => {
      let n = 1;
      let inQ: 0 | 1 | 2 = 0;
      let dep = 0;
      for (let k = 0; k < existingStyle.length; k++) {
        const c = existingStyle[k];
        if (dep === 0) {
          if (c === "'" && inQ !== 2) inQ = inQ === 1 ? 0 : 1;
          else if (c === '"' && inQ !== 1) inQ = inQ === 2 ? 0 : 2;
        }
        if (inQ === 0) {
          if (c === '(') dep++;
          else if (c === ')') dep--;
          else if (c === ';' && dep === 0) n++;
        }
      }
      return n;
    })();
    const parseFailed =
      existingStyle &&
      parsed.length > 0 &&
      (parsed.length < Math.ceil(estimateDeclCount * 0.7) ||
        !(styles['display'] || '').trim() ||
        !(styles['width'] || '').trim() ||
        !(styles['height'] || '').trim());

    if (parseFailed) {
      // 回退：保留原 existingStyle 字符串，用 String.replace 缺省补必要字段（不破坏任何已有的值）
      let safeStyle = existingStyle;
      const ensureHas = (prop: string, fallback: string) => {
        if (
          !new RegExp(`(?:^|;)\\s*${prop.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:`, 'i').test(
            `;${safeStyle}`,
          )
        ) {
          safeStyle = safeStyle.endsWith(';')
            ? `${safeStyle}${prop}:${fallback}`
            : `${safeStyle};${prop}:${fallback}`;
        }
      };
      ensureHas('width', '100%');
      ensureHas('height', '100%');
      ensureHas('overflow', 'hidden');
      ensureHas('position', 'relative');
      ensureHas('box-sizing', 'border-box');
      if (!/padding\s*:/i.test(`;${safeStyle}`))
        safeStyle = `${safeStyle};padding:${defaultPadding}`;
      // padding 值为 0 的兜底（即使解析成功了也防一手）
      if (/padding\s*:\s*0(?:px)?\s*(?:;|$)/i.test(safeStyle)) {
        safeStyle = safeStyle.replace(
          /(padding\s*:\s*)0(?:px)?\s*(;|$)/i,
          (_m, p, s) => `${p}${defaultPadding}${s || ';'}`,
        );
      }
      ensureHas('display', 'flex');
      if (!/flex-direction\s*:/i.test(`;${safeStyle}`))
        safeStyle = `${safeStyle};flex-direction:column`;
      // font-family 特殊处理：不存在 → 补；存在但命中通用占位 → 替换为动态栈；其他真实定制 → 绝对不碰（NFR-2 幂等）
      // （Fix A 已收紧 mono 占位 ≥5 项门槛）
      {
        const ffMatch = safeStyle.match(/(?:^|;)\s*font-family\s*:\s*([^;]+)/i);
        const currentFF = ffMatch ? ffMatch[1].trim() : '';
        if (!currentFF) {
          safeStyle = `${safeStyle};font-family:${fullFontFamily}`;
        } else if (this.isPlaceholderFontFamily(currentFF)) {
          // 命中通用占位 → 允许跨家族升级（AC-3 old-mono→sans）、同家族新版栈升级
          safeStyle = safeStyle.replace(
            /(^|;)\s*font-family\s*:\s*[^;]+/i,
            (_m, prefix) => `${prefix}font-family:${fullFontFamily}`,
          );
        }
      }
      // flex 容器时：仅极简封面才追加完美居中三件套；内容页默认按"从上往下流"不居中
      // —— Bug-3 加固 B：parseFailed 分支三件套注入前再显式双重确认（防 fallback 行为误判）
      let pfShouldCenter = layoutShouldCenter;
      if (pfShouldCenter) {
        const pfCleanInner = stripHtmlComments(inner);
        if (CONTENT_SIGN_RE.test(pfCleanInner)) {
          console.warn(
            '[FIX-BUG3:B] parseFailed 分支检测到 h2/h3/ul/ol/img/table 内容标记，layoutShouldCenter 强制降级为 false',
          );
          pfShouldCenter = false;
        }
      }
      if (pfShouldCenter && /display\s*:\s*flex/i.test(`;${safeStyle}`)) {
        if (!/justify-content\s*:|align-items\s*:|text-align\s*:/i.test(safeStyle)) {
          // 三件套缺失才追加（已有任何一项表明 LLM 可能想手动对齐，不再强写三件套以防覆盖 flex-start 等合理取值）
          if (!/justify-content\s*:/i.test(`;${safeStyle}`))
            safeStyle = `${safeStyle};justify-content:center`;
          if (!/align-items\s*:/i.test(`;${safeStyle}`))
            safeStyle = `${safeStyle};align-items:center`;
          if (!/text-align\s*:/i.test(`;${safeStyle}`))
            safeStyle = `${safeStyle};text-align:center`;
        }
      }
      if (!/background(?:-color)?\s*:/i.test(`;${safeStyle}`))
        safeStyle = `${safeStyle};background-color:#fff`;
      const newAttrs = styleMatch
        ? attrs.replace(/style="[^"]*"/i, `style="${safeStyle}"`)
        : `${attrs} style="${safeStyle}"`;
      return `<div${newAttrs}>${inner}</div>`;
    }

    // === 解析成功：用 Map 重写（更精确） ===
    const required: Record<string, string> = {
      width: '100%',
      height: '100%',
      overflow: 'hidden',
      position: 'relative',
      'box-sizing': 'border-box',
      padding: styles['padding'] || defaultPadding,
      display: styles['display'] || 'flex',
      'flex-direction': styles['flex-direction'] || 'column',
      // font-family 特殊处理：不存在或命中通用占位（老默认 sans OR 老遗留 mono 占位）→ 用动态栈；其他真实定制 → 绝对不碰（NFR-2 幂等）
      // （Fix A 已在 isDefaultLegacyMonoPlaceholder 收紧 ≥5 项门槛，防止 3 项短版真实定制被误判）
      'font-family': ((cur) => (!cur || this.isPlaceholderFontFamily(cur) ? fullFontFamily : cur))(
        styles['font-family'],
      ),
    };
    // 修复 C：padding 不能为 0（空字符串 或 0 值统一兜底 defaultPadding）
    if (!required.padding || /^0(?:px)?$/.test(required.padding.trim())) {
      required.padding = defaultPadding;
    }
    if ((required.display || styles['display'] || '').trim() === 'flex') {
      // T6-FR6：仅极简封面才三件套居中；内容页按自然流不做水平/垂直居中
      // —— Bug-3 加固 C：Map 重写分支显式 hasAnyContentSign 守卫 + 双重保险降级
      let mapShouldCenter = layoutShouldCenter;
      const hasAnyContentSign = CONTENT_SIGN_RE.test(stripHtmlComments(inner));
      if (mapShouldCenter && hasAnyContentSign) {
        console.warn(
          '[FIX-BUG3:C] Map 重写分支 layoutShouldCenter 与内容标记冲突（h2/h3/ul/ol/img/table 存在），强制降级为不居中以便排查',
        );
        mapShouldCenter = false;
      }
      if (mapShouldCenter) {
        // —— Task 5 最小修复（纵深防御）：三件套注入块内部再嵌套 CONTENT_SIGN_RE 守卫——
        // 即使未来外层 mapShouldCenter 降级逻辑被移除/误改，这里也能独立兜底：
        // 只要 inner 含 h2/h3/ul/ol/img/table 任一内容标记，三件套一律不写。
        if (!CONTENT_SIGN_RE.test(stripHtmlComments(inner))) {
          if (!styles['justify-content']) required['justify-content'] = 'center';
          if (!styles['align-items']) required['align-items'] = 'center';
          if (!styles['text-align']) required['text-align'] = 'center';
        }
      }
    }
    if (!styles['background-color'] && !styles['background'] && !styles['background-image']) {
      required['background-color'] = '#fff';
    }
    for (const [k, v] of Object.entries(required)) {
      if (!styles[k]) styles[k] = v;
    }
    // ★ 占位升级强制覆盖（修复 Map 分支 font-family 升级失效 Bug）：
    //   required['font-family'] 已包含 isPlaceholderFontFamily 判定——若命中占位则是新 fullFontFamily，
    //   若原值真实定制则与 styles['font-family'] 相等。只有两者不等时才强制写回（跨家族升级等场景）。
    //   上面 `if (!styles[k])` 的"缺失才补"无法覆盖这种"原值存在但被判定为占位需要替换"的情况。
    if (required['font-family'] && required['font-family'] !== styles['font-family']) {
      styles['font-family'] = required['font-family'];
    }
    // 再次兜底：padding 仍然是 0 就强制盖掉
    if (!styles.padding || /^0(?:px)?$/.test(styles.padding.trim()))
      styles.padding = defaultPadding;
    const newStyle = Object.entries(styles)
      .map(([k, v]) => `${k}:${v}`)
      .join(';');
    let newAttrs: string;
    if (styleMatch) {
      newAttrs = attrs.replace(/style="[^"]*"/i, `style="${newStyle}"`);
    } else {
      newAttrs = `${attrs} style="${newStyle}"`;
    }
    return `<div${newAttrs}>${inner}</div>`;
  }

  private enforceTextContainerStyles(html: string): string {
    return html.replace(/<div([^>]*style="[^"]*flex:\s*1[^"]*"[^>]*)>/gi, (match) => {
      // FR-3: 豁免 display:grid 的 flex:1 容器（4/2 卡片网格、对比卡片等，子元素是卡片而非可滚动正文）
      //       带 data-layout=xxxx（白名单版式，如 content-stats-highlight）也同样豁免
      //       这两类容器加 overflow:hidden/clip 只会默默裁掉卡片底部重要信息（胶囊标签、进度条）
      if (/display\s*:\s*grid/i.test(match)) return match;
      if (/data-layout\s*=\s*["']?[a-z0-9-]+/i.test(match)) return match;
      if (/style="[^"]*"/i.test(match)) {
        return match.replace(/style="([^"]*)"/i, (_s, style: string) => {
          let newStyle = style;
          if (!newStyle.includes('min-height')) {
            newStyle += ';min-height:0';
          }
          if (!newStyle.includes('overflow')) {
            // FR-3: overflow:hidden → overflow:clip（更温和，不创建滚动容器、不干扰 overflow-x/y 独立设置）
            newStyle += ';overflow:clip';
          }
          if (!newStyle.includes('min-width')) {
            newStyle += ';min-width:0';
          }
          return `style="${newStyle}"`;
        });
      }
      return match;
    });
  }

  /**
   * FR-4: 图片包裹完整性兜底（flattenMeaninglessNesting 之后的最后一道防线）
   *
   * 触发条件：<img> 是 flex:column 根容器的直接子节点（紧邻 `</div>`/`</section>`/`</article>` 关闭标签之前）
   *   且前一个兄弟不是包裹 div（不是刚被包好的情况，通过"匹配到的 img 前不是 `…></div>\s*<img…>"` 来判断不重套）
   * 处理：给 img 包一层标准容器——
   *   margin-top:24px  保证与上方卡片/列表拉开垂直距离
   *   overflow:hidden  防止 object-fit:cover 时图片溢出圆角
   *   display:flex; align-items:stretch  使图片高度由容器弹性计算而非 height:100%
   *   min-height:0  flex 子容器溢出不蔓延到父级
   *   flex:0 0 auto  容器高度按内容（aspect-ratio 决定的图片高度）自然撑开而非扩张
   */
  private ensureImageProperWrapper(html: string): string {
    if (!html) return html;
    // 匹配：块级关闭标签 → 裸 img → 根容器关闭标签
    // 例：</div> → <img...> → </div>
    // 注意：不匹配 </div><div style="margin-top:…"><img> → </div>（即 img 已有包裹时不重套）
    const bareImgRe =
      /(<\/(?:div|h[1-6]|ul|ol|p|table|section|article)\s*>)(\s*)(<img\b[^>]*>)(\s*)(?=<\/(?:div|section|article)\s*>)/gi;
    let changed = false;
    const output = html.replace(
      bareImgRe,
      (_full, prevClose: string, ws1: string, imgTag: string, ws2: string) => {
        changed = true;
        const wrap =
          '<div style="margin-top:24px;overflow:hidden;display:flex;align-items:stretch;min-height:0;flex:0 0 auto;">' +
          imgTag +
          '</div>';
        return prevClose + ws1 + wrap + ws2;
      },
    );
    if (changed) return output;
    // === 兜底 B：没有命中根容器关闭标签模式？再看 "根容器内 img 是第一个孩子"的情况（少见，但仍防御）
    const firstBareImgRe =
      /(<(?:div|section|article)\b[^>]*style\s*=\s*"[^"]*flex-direction\s*:\s*column[^"]*"[^>]*>\s*(?:<!--[\s\S]*?-->\s*)*)(<img\b[^>]*>)/gi;
    return html.replace(firstBareImgRe, (_full, opener: string, imgTag: string) => {
      return (
        opener +
        '<div style="margin-bottom:24px;overflow:hidden;display:flex;align-items:stretch;min-height:0;flex:0 0 auto;">' +
        imgTag +
        '</div>'
      );
    });
  }

  private enforceStretchAlignment(html: string): string {
    return html.replace(/<div([^>]*style="[^"]*display:\s*flex[^"]*"[^>]*)>/gi, (match) => {
      if (/style="[^"]*"/i.test(match)) {
        const styleMatch = match.match(/style="([^"]*)"/i);
        if (!styleMatch) return match;
        const style = styleMatch[1];
        if (style.includes('position:absolute') || style.includes('flex-direction:column'))
          return match;
        if (style.includes('align-items')) return match;
        return match.replace(/style="([^"]*)"/i, `style="${style};align-items:stretch"`);
      }
      return match;
    });
  }

  // =========================================================================
  // 图像生成 Prompt 清洗：
  //   1. 避免颜色代码、比例（16:9）、风格标签、比例/风格/主色调 等元信息
  //      被图像模型 LITERALLY 渲染为画面中的文字（如左上角 #0891b2、右上角 16:9、中间 空与静）
  //   2. [新增] 去除/改写「画面主体偏X 留出Y侧 文字排版空间」这类会导致"半边图像、半边纯色空白"的语义
  //   3. [新增] 压缩末尾英文强约束（原 280+ chars → 80 chars），避免冲淡主 prompt 权重，并补充色系锚定、全画布无大面积纯色负约束
  // =========================================================================
  /**
   * FR-15：从 options.referenceVisualAttributes 抽取「分类 → 参考图地址」映射，
   * 供 qwen-image provider 按 slide pageType 选取 img2img seed。
   * 若 options 未携带 referenceVisualAttributes，返回 undefined（provider 回退到旧字段 referenceImage）。
   */
  private buildReferenceSeedMap(
    options: any,
  ): Partial<Record<'cover' | 'content' | 'summary' | 'global', string>> | undefined {
    const rva = options?.referenceVisualAttributes;
    if (!rva || !rva.byCategory) return undefined;
    return {
      cover: rva.byCategory.cover?.referenceImageUrl,
      content: rva.byCategory.content?.referenceImageUrl,
      summary: rva.byCategory.summary?.referenceImageUrl,
      global: rva.global?.referenceImageUrl,
    };
  }

  // =========================================================================
  private sanitizeImagePrompt(rawPrompt: string, primaryColor?: string): string {
    if (!rawPrompt) return '';
    let p = rawPrompt;

    // ---- Step 0（最高优先级）：彻底清除「留出X侧文字排版空间」等导致"半边图像"的高危语义 ----
    // 【为什么要"彻底删除"而不是"替换成X侧渐变背景"？
    //   1. 文字根本不在图片上！HTML 布局中 <img> 和文字是并排兄弟节点，图片本身不需要任何"留空"
    //   2. LLM 规划时频繁把左右搞反（content-image-left 页面反而写"主体偏右留出左侧"，完全错位）
    //   3. "X侧保持简洁渐变背景"这种描述仍然会让模型把 X 侧渲染得很空=观感仍是半边图像
    //   4. 所以最佳策略：不论 LLM 写了"主体偏X+留出Y侧"，一律把这整段"构图位置+留空"描述删除，
    //      只保留正向的"构图饱满、全画布填充、严禁大面积纯色空白"的强约束。
    const replaceReserveSpace = (s: string): string => {
      // ---------- 0.1 最宽泛匹配：【画面主体偏X / 居中偏X】+【留出Y侧 ... 文字...空间】整段删除 ----------
      // 匹配从"画面?主体"开始，到"文字/排版/内容...空间/位置/空白/..."结束的整段，
      // 中间允许任何字符（逗号、停顿、LLM 乱写的连接词），一次性吃掉整段偏置+留空描述。
      // （用 [\s\S]{0,80} 限制跨度，避免误伤过长的正常描述）
      let result = s.replace(
        /[，,。、\s]*画面?主体(?:自然)?(?:居中)?(?:偏[上下左右中])?[\s\S]{0,80}?(?:文字|排版|文本|文案|内容|标题|说明|注解|字幕|批注)[^，,。、;；]{0,40}?(?:位置|空间|地方|区域|面积|空白|空位|地盘)[\s,，。、;；]*/gi,
        '，整体构图饱满充实、全画布四角及边缘均有合理图像内容与细腻层次，严禁大面积纯色空白、严禁未渲染纯色区域、严禁半图半空白，',
      );
      // ---------- 0.2 兜底匹配（上面没命中时）：独立出现的"留出/预留/空出 + ... + 文字类 + ... + 空间类"整段删除 ----------
      // 允许顺序颠倒或拆分表达，例如"给左侧留文字位置"、"右侧作为文字排版区域"
      result = result.replace(
        /[，,。、\s]*(?:留[出下给为生]|腾[出下给]|预[留备下]|空[出给下]|让[出给]|给[予]?|把[将]?|作为)[\s\S]{0,60}?(?:文字|排版|文本|文案|内容|标题|说明|注解|字幕|批注)[^，,。、;；]{0,30}?(?:位置|空间|地方|区域|面积|空白|空位|地盘|面积)[\s,，。、;；]*/gi,
        '，整体构图饱满充实，画面四角均有合理图像内容与细腻层次，严禁大面积纯色空白，',
      );
      // ---------- 0.3 反向匹配："X侧/半边/半部分/... + 用/放/作为 + 文字/排版..." （无"留出"字样但语义相同）
      result = result.replace(
        /[，,。、\s]*[上下左右两][侧边方半部分段区域][\s,，。、;；]*(?:用来?|放|作为|充当)[^，,。、;；]{0,30}?(?:文字|排版|文本|文案|内容|标题|说明|注解)[\s,，。、;；]*/gi,
        '，整体构图平衡饱满，严禁大面积纯色空白，全画布填充完整，',
      );
      // ---------- 0.4 英文近似表达留空语义 ----------
      result = result.replace(
        /[,.\s]+(?:leave|save|reserve|keep|make|set\s*aside)\s+(?:some\s+)?(?:space|room|area|region|margin)\s+(?:on\s+the\s+)?(?:left|right|top|bottom|both\s+sides|side)?\s*(?:for\s+)?(?:text|copy|words|content|caption|subtitle|labels|annotations)[\s,.]*/gi,
        '. Full balanced composition. DO NOT LEAVE LARGE SOLID COLOR EMPTY AREAS anywhere. Every canvas corner and edge has imagery with fine texture and detail. ',
      );
      // ---------- 0.5 "留白"关键词（背景图里经常出现）替换成柔和描述，不能写"空/白"字样 ----------
      // 注：这一步放在 Step 0 而不是 Step 3，因为"留白"对图像生成危害远大于普通元信息
      result = result.replace(
        /(画面|整体|中心|区域|画面中心|中心区域|四周|边缘)?[,，\s]*(干净|大面积|适当|合理|适度|足够|较多)?[,，\s]*留白/gi,
        (_m, area: string | undefined, _degree: string | undefined) => {
          const prefix = area ? `${area}柔和渐变过渡带细腻微纹理与层次` : '柔和渐变与细腻微纹理';
          return prefix;
        },
      );
      // 孤立的"留白"二字
      result = result.replace(/\b留白\b/g, '柔和渐变细腻纹理');
      return result;
    };
    p = replaceReserveSpace(p);
    // 两遍扫描，因为相邻组合或嵌套的表达有时需要两次才能吃干净
    p = replaceReserveSpace(p);

    // ---- Step 1：去除「纯标签式」元信息片段 ----
    // 形如： 风格：空与静 / 风格:极简 / 【风格】xxx
    p = p.replace(
      /[（\(\s,，、。;；]*?(?:风格|画风|样式|设计风格)[：:\s】\]]*[^\s,，。、;；]{1,20}/gi,
      ' ',
    );
    // 形如： 比例要求 16:9 / 比例 4:3 / 宽屏比例16:9 / 画面比例 16:9
    p = p.replace(
      /[（\(\s,，、。;；]*?(?:比例|画面比例|构图比例|图片比例|比例要求)[：:\s]*\d+\s*[:：]\s*\d+/gi,
      ' ',
    );
    // 形如： 16:9宽屏构图 / 16:9横屏 / 4:3竖屏 （直接带数字冒号数字+描述 → 删除）
    p = p.replace(
      /\b\d+\s*[:：]\s*\d+(?:\s*[\u4e00-\u9fa5A-Za-z]{0,12}(?:构图|画面|比例|横屏|宽屏|竖屏|尺寸))?/g,
      ' ',
    );
    // 形如： 颜色代码 #0891b2 / 主色调#FFFFFF / 主色: #2563eb / PRIMARY #FFFFFF / 色值 #xxx
    p = p.replace(
      /[（\(\s,，、。;；]*?(?:颜色代码|主色调?|primary(?:\s*color)?|PRIMARY(?:\s*COLOR)?|色值|十六进制|hex|HEX|COLOR|RGB(?:\s*值)?|配色)[：:\s]*#([0-9a-fA-F]{3,8})\b/gi,
      ' ',
    );
    // 形如： 蓝色调(#2563eb) / 青蓝色(#0891b2) - 注意括号内的 hex
    p = p.replace(/\(\s*#([0-9a-fA-F]{3,8})\s*\)/g, ' ');
    // 形如： （#FFFFFF） / 【#2563eb】
    p = p.replace(/[\(\[（【]\s*#([0-9a-fA-F]{3,8})\s*[\)\]）】]/g, ' ');
    // 形如： standalone RGB(...) / rgba(...) 标签（不是在描述性语句里的那种，而是孤立色值）
    p = p.replace(
      /[,，\s]rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+(?:\s*,\s*[0-9.]+\s*)?\)[\s,，。]*/gi,
      ' ',
    );

    // ---- Step 2：去除孤立、短的纯 hex 颜色代码（但避免误伤像 C4D、B2B 这种正常英文词）----
    // 我们用更保守的规则：只删前后是中文/标点/空白 或行首行尾 场景下的 #HEX，且 HEX 恰好 3、6、8 位
    const hexBoundary = (s: string): string =>
      s.replace(
        /(^|[\u4e00-\u9fa5\s,，。、;；:：\(\)\[\]（）【】"'`])#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})(?=$|[\u4e00-\u9fa5\s,，。、;；:：\(\)\[\]（）【】"'`])/g,
        '$1 ',
      );
    p = hexBoundary(hexBoundary(p)); // 两遍处理（有些相邻需要两轮）

    // ---- Step 3：去除孤立的纯元关键词（2-6字，没有正常画面描述语义）----
    // 【重要】绝对不要把「无文字/NO TEXT/无LOGO/无水印」等要传给图像模型的正向约束删掉！
    // 这些词是图像模型防画文字/水印的关键指令，要保留在 prompt 里强化效果；
    // Step 3 只清理「淡雅背景/高分辨率」这种与画面内容无关、又会稀释权重的元形容词。
    const metaKeywords = [
      '淡雅背景',
      '低饱和度',
      '高质量',
      '专业',
      '高清',
      '超清',
      '4k',
      '8K',
      '4K',
      '高分辨率',
      '像素级',
      '构图',
      '宽屏',
      '横屏',
      '竖屏',
      '留出空间',
      '留空',
      '排版空间',
      '文字空间',
      '文字位置',
      '空白区域',
      '文本区域',
      '文字区',
      '排版区',
      '文字占位',
    ];
    for (const kw of metaKeywords) {
      const regex = new RegExp(
        `(^|[\\s,，。、;；])${kw.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}(?=$|[\\s,，。、;；])`,
        'gi',
      );
      p = p.replace(regex, '$1 ');
    }

    // ---- Step 4：把 主色/primary color 重写为自然语言色感描述（不写代码）----
    // 返回值：[色系中文描述, 色系英文锚定词] — 英文锚定词用于 Step 7 末尾强约束，防止 prompt_extend 改写时色系漂移（绿→蓝）
    let toneEnAnchor: string | null = null;
    if (primaryColor) {
      const pc = primaryColor.replace('#', '').toLowerCase();
      // 简单色感映射：按 R 分量、G 分量、B 分量判断大致色系
      const r = parseInt(pc.substring(0, 2), 16);
      const g = parseInt(pc.substring(2, 4), 16);
      const b = parseInt(pc.substring(4, 6), 16);
      const maxC = Math.max(r, g, b);
      const minC = Math.min(r, g, b);
      const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      let tone = '';
      if (maxC - minC < 30) {
        tone = lum > 0.6 ? '浅灰白色系' : lum > 0.35 ? '中灰色系' : '深灰色系';
        toneEnAnchor = 'NEUTRAL GRAY / MONOCHROME FAMILY ONLY';
      } else if (r === maxC && g > b * 1.5) {
        tone = lum > 0.55 ? '暖橙黄色系' : '温暖红棕色调';
        toneEnAnchor = 'WARM ORANGE-AMBER COLOR PALETTE — DO NOT SWITCH TO BLUE';
      } else if (r === maxC) {
        tone = lum > 0.5 ? '温暖玫粉色系' : '深邃酒红紫色调';
        toneEnAnchor = 'WARM RED-ROSE-PINK / REDDISH VIOLET PALETTE ONLY';
      } else if (g === maxC && r > b) {
        tone = lum > 0.55 ? '清新嫩黄绿色系' : '自然森林深绿色调';
        toneEnAnchor =
          'GREEN FAMILY DOMINANT (lime / yellow-green / forest). DO NOT SWITCH TO BLUE/INDIGO FAMILY';
      } else if (g === maxC) {
        tone = lum > 0.55 ? '清爽青绿色系' : '高级深青碧色调';
        toneEnAnchor =
          'GREEN-EMERALD-TEAL (CYAN-GREEN) FAMILY. KEEP GREEN TONES PROMINENT — DO NOT SHIFT TO PURE BLUE';
      } else if (b === maxC && g > r * 0.8) {
        tone = lum > 0.55 ? '清澈青蓝色系' : '商务海蓝深青色调';
        toneEnAnchor = 'CYAN / TEAL / LIGHT SEA BLUE FAMILY';
      } else {
        tone = lum > 0.55 ? '优雅蓝紫色系' : '沉稳深邃靛蓝紫色调';
        toneEnAnchor = 'INDIGO / VIOLET / ROYAL BLUE PALETTE';
      }
      // 把 prompt 里所有提到主色相关的位置替换成色系描述
      p = p.replace(
        /(整体(?:的|色调|配色|视觉)?|配色(?:方案|整体)?|(?:主色调?|整体色彩|色彩基调|色系统一)[，,\s]*)以?(?:[为是]|统一(?:为|使用)?)?\s*[#＃]?[0-9a-fA-F]{3,8}\b/gi,
        `整体${tone}氛围`,
      );
      // 如果 prompt 里完全没有提到色系（清洗后缺失），则末尾补一句色系描述
      if (
        !/(色系|色调|色彩|颜色|配色|blue|green|red|purple|orange|yellow|pink|gray|grey|cyan|navy|teal|emerald|rose|amber|violet|indigo)/i.test(
          p,
        )
      ) {
        p = p.trim() + `，${tone}统一配色基调`;
      }
    }

    // ---- Step 5：用「宽幅 landscape」替代数字比例（1792x1024 已经是 wide landscape，不需要模型看到「16:9」字符串）----
    // 宽屏/landscape 只保留一个自然词，避免重复
    if (/(16\s*[:：]\s*9|wide|landscape|宽幅|全景|横版)/i.test(p)) {
      // 已经有了就不再重复补（下面统一补 NO TEXT）
    }

    // ---- Step 6：压缩重复空白、重复标点，整理为一行 ----
    p = p
      .replace(/[\s\u3000]+/g, ' ')
      .replace(/[，,]{2,}/g, '，')
      .replace(/[。.]{2,}/g, '。')
      .replace(/\s*[，,。.]\s*[，,。.]/g, '，')
      .trim();
    if (p.endsWith('，') || p.endsWith(',') || p.endsWith('。')) p = p.slice(0, -1);

    // ---- Step 6.5（新增·中文防文字/防颜色代号强约束）：在英文末尾约束之前，用中文明确禁止画面中出现文字/字母/数字/颜色代码 ----
    // 为什么要补这段？因为 qwen-image 的 prompt_extend 对中文语义理解更强，且中段落权重 > 末尾英文权重。
    // 同时：如果 prompt 本身已经有「无文字 / 无颜色代码」等描述，就不重复补，避免稀释。
    const hasNoTextHint =
      /(无文字|无任何文字|不出现文字|不要文字|严禁文字|禁止文字|纯视觉|纯图像|纯插画|没有文字|NO TEXT|no text|No text)/i.test(
        p,
      );
    const hasNoColorCodeHint =
      /(无颜色代码|无颜色代号|不出现颜色代码|不要颜色代码|严禁颜色代码|禁止颜色代码|NO COLOR CODE|no hex|no rgb)/i.test(
        p,
      );
    if (!hasNoTextHint || !hasNoColorCodeHint) {
      const cnConstraints: string[] = [];
      if (!hasNoTextHint)
        cnConstraints.push(
          '画面中严禁出现任何文字、汉字、字母、数字、符号、标签、标题、Logo、水印，纯视觉插画',
        );
      if (!hasNoColorCodeHint)
        cnConstraints.push('画面中严禁出现任何颜色代码、色值编号、HEX色值、RGB函数、十六进制色号');
      const extra = '，' + cnConstraints.join('，') + '，';
      p = p + extra;
    }

    // ---- Step 7：末尾英文强约束（大幅压缩 + 补充构图/色系负约束）----
    // 改进点：
    //   a. 压缩为 ~80 chars，不冲淡主 prompt 权重
    //   b. 加入 FULL CANVAS / NO LARGE SOLID EMPTY AREAS — 防止半边图像
    //   c. 动态加入 toneEnAnchor（色系锚定）— 防止 prompt_extend 改写后颜色漂移（绿→蓝）
    const canvasConstraint =
      ' FULL CANVAS COVERAGE. NO LARGE SOLID COLOR EMPTY AREAS. NO BLANK REGIONS. All 4 corners filled with imagery.';
    const noTextConstraint =
      ' STRICTLY NO TEXT/LETTERS/NUMBERS/WATERMARKS/LOGOS/LABELS. PURE VISUAL ILLUSTRATION ONLY.';
    const colorAnchor = toneEnAnchor ? ` COLOR ANCHOR: ${toneEnAnchor}.` : '';
    const appendix = ` ${canvasConstraint}${colorAnchor}${noTextConstraint}`;
    if (!p.includes('FULL CANVAS COVERAGE')) {
      // 避免重复附加
      p = p + appendix;
    }
    return p;
  }

  // =========================================================================
  // 缺陷 1 兜底：删除「颜色代码水印 div」
  // 匹配 div 纯文本（去掉所有嵌套标签后）是颜色代码（#2563b、#FFFFFF、RGB(...)、主色#...、颜色代码、HEX、COLOR 等）
  // =========================================================================
  private removeColorCodeWatermark(html: string): string {
    const isColorWatermarkText = (plainText: string): boolean => {
      const t = plainText.trim().replace(/\s+/g, '');
      if (!t) return false;
      // 1. # + 3~8 位 hex（支持带透明度，如 #2563eb、#FFF、#2563EB80）
      if (/^#([0-9a-fA-F]{3,8})$/.test(t)) return true;
      // 2. 主色/主色调 + #xxx
      if (/^(主色调?|primary|PRIMARY|色值|颜色)[:：]?#([0-9a-fA-F]{3,8})$/.test(t)) return true;
      // 3. rgb / rgba
      if (/^rgba?\([0-9,.\s%]+\)$/i.test(t)) return true;
      // 4. 只有 HEX / COLOR / RGB / 颜色代码 这种纯关键词
      if (/^(HEX|COLOR|RGB|颜色代码|色值|十六进制)$/i.test(t)) return true;
      // 5. 「#2563b · #ffffff」这种多色代码拼接（中间没有正常的中文语义）
      if (/^(#([0-9a-fA-F]{3,8})[\s·,、|\/\\]+)+#([0-9a-fA-F]{3,8})$/i.test(t)) return true;
      return false;
    };

    const stripTags = (s: string): string => s.replace(/<[^>]+>/g, '');

    let result = html;
    for (let iter = 0; iter < 4; iter++) {
      const before = result;
      // 关键：内层必须**不包含 <div 开头**（(?!<div[\s>])[\s\S]），确保每次只剥最内层叶子 div
      result = result.replace(
        /<div(\s[^>]*)?>((?:(?!<div[\s>])[\s\S])*?)<\/div>/gi,
        (match, _attrs: string | undefined, inner: string) => {
          // 只处理文本内容比较短的 div（水印一般 2-30 字符，不会是大段落）
          const innerLen = stripTags(inner).length;
          if (innerLen > 60) return match;
          const plain = stripTags(inner);
          if (isColorWatermarkText(plain)) {
            return ''; // 删除整个 div
          }
          return match;
        },
      );
      if (result === before) break;
    }
    return result;
  }

  // =========================================================================
  // 缺陷 2 兜底：深色/主色背景区块 → 文字强制改为白色（对比度修复）
  // 识别 div 的 background / background-color 是否包含主色或其 darker 变体
  // 然后对该 div 范围内所有文本标签（h1-h6/p/li/span 等）设置 color:#FFFFFF
  // =========================================================================
  private enforceDarkBgTextContrast(
    html: string,
    primaryColor: string,
    colorPolicy?: SlideColorPolicy,
  ): string {
    // 统一口径：深底判定收敛到共享权威 resolveBgTone（alpha 感知 + 渐变合成），消除与终局兜底口径打架
    const isDarkBackgroundStyle = (style: string): boolean => {
      return this.resolveBgTone(style, primaryColor) === 'dark';
    };

    // 递归处理嵌套标签：外层 li 处理完 → 再递归进入它的 inner 处理 span/strong 等内层
    const processTag = (seg: string, depth: number): string => {
      if (depth > 5) return seg; // 防止无限递归
      return seg.replace(
        /<(h[1-6]|p|li|span|small|a|strong|em|b|i|u|label)(\s[^>]*)?>([\s\S]*?)<\/\1>/gi,
        (tagMatch, tag: string, attrs: string | undefined, _inner: string) => {
          // 如果是图标容器（inline-flex + flex-shrink:0 + 宽高 + border-radius），不修改（SVG/数字本来就是白色）
          if (attrs && /style="[^"]*"/i.test(attrs)) {
            const styleM = attrs.match(/style="([^"]*)"/i);
            if (styleM) {
              const st = styleM[1];
              const hasInlineFlex = /display\s*:\s*inline-flex/i.test(st);
              const hasFlexShrink = /flex-shrink\s*:\s*0/i.test(st);
              const hasSize = /width\s*:\s*\d+px/i.test(st) && /height\s*:\s*\d+px/i.test(st);
              if (hasInlineFlex && hasFlexShrink && hasSize) {
                return tagMatch; // 图标容器跳过（已经白色）
              }
            }
          }
          // 先递归处理内层（让内层 span/strong 先被变白，避免外层包裹内层无法触达）
          const processedInner = processTag(_inner, depth + 1);
          // 再处理/追加 style 里的 color:#FFFFFF
          let newAttrs = attrs || '';
          const styleMatch = newAttrs.match(/style="([^"]*)"/i);
          let styleStr = styleMatch ? styleMatch[1] : '';
          const styles: Record<string, string> = {};
          if (styleStr) {
            for (const { key, value } of parseStyleDeclarations(styleStr)) {
              styles[key] = value;
            }
          }
          // 判断：是否为「有效」渐变文字（按声明顺序，background 简写不覆盖 clip，否则不算渐变文字）
          // 渐变文字本身自带清晰的颜色，不需要强制覆盖，更不能破坏其渐变结构
          const isGradientText = isEffectiveClipText(styleStr);
          if (!isGradientText) {
            // 参考撞色 / 标题色 / 正文色 / 描边色：用户明确上传的风格，深底也不强行改成白色（保真）
            const existingColor = (styles['color'] || '').trim();
            const existingHex = existingColor ? this.normalizeHex(existingColor) : '';
            const isReferenceColor =
              existingHex &&
              (() => {
                for (const c of [
                  colorPolicy?.titleColor,
                  colorPolicy?.bodyColor,
                  colorPolicy?.strokeColor,
                  ...(colorPolicy?.accents || []),
                ]) {
                  if (c && (this.normalizeHex(c) || c.toLowerCase()) === existingHex) return true;
                }
                return false;
              })();
            if (!isReferenceColor) {
              // 非渐变文字：强制白色；如果有残留的渐变裁剪属性，清理掉（避免渐变背景当背景块用）
              delete styles['background-clip'];
              delete styles['-webkit-background-clip'];
              delete styles['-webkit-text-fill-color'];
              styles['color'] = '#FFFFFF';
            }
          }
          const newStyle = Object.entries(styles)
            .map(([k, v]) => `${k}:${v}`)
            .join(';');
          if (styleMatch) {
            newAttrs = newAttrs.replace(/style="[^"]*"/i, `style="${newStyle}"`);
          } else {
            newAttrs = newAttrs ? `${newAttrs} style="${newStyle}"` : ` style="${newStyle}"`;
          }
          return `<${tag}${newAttrs}>${processedInner}</${tag}>`;
        },
      );
    };
    const makeWhiteInSegment = (segment: string): string => processTag(segment, 0);

    // 找到 div 的配对（简单版：按 stack 匹配），对背景为深色的 div 内部文字变白
    let result = html;
    const stack: Array<{ startIdx: number; endOpen: number }> = [];
    const darkRanges: Array<{ start: number; end: number }> = [];
    const divRegex = /<\/?div(\s[^>]*)?>/gi;
    let m: RegExpExecArray | null;
    while ((m = divRegex.exec(result)) !== null) {
      const tag = m[0];
      if (/^<div/i.test(tag)) {
        stack.push({ startIdx: m.index, endOpen: m.index + tag.length });
      } else if (/^<\/div>/i.test(tag)) {
        const open = stack.pop();
        if (!open) continue;
        // 取 open tag 的 style 判断是否深色背景
        const openTagStr = result.substring(open.startIdx, open.endOpen);
        const styleM = openTagStr.match(/style="([^"]*)"/i);
        if (styleM && isDarkBackgroundStyle(styleM[1])) {
          darkRanges.push({ start: open.endOpen, end: m.index });
        }
      }
    }
    if (darkRanges.length === 0) return result;

    // 按范围从后往前修改（避免索引偏移）
    darkRanges.sort((a, b) => b.start - a.start);
    for (const r of darkRanges) {
      const sub = result.substring(r.start, r.end);
      const newSub = makeWhiteInSegment(sub);
      result = result.substring(0, r.start) + newSub + result.substring(r.end);
    }
    return result;
  }

  // =========================================================================
  // 缺陷 3 兜底：装饰性竖排 writing-mode → 强制改回横排 + 水平列表结构
  // =========================================================================
  private fixVerticalWritingLists(html: string): string {
    let result = html;

    // 第一步：全局删除所有 writing-mode 声明（除了 text-orientation，直接粗暴去掉 writing-mode）
    result = result.replace(
      /<(div|ul|ol|li|span|p|section|article|h[1-6])([^>]*style="[^"]*"[^>]*)>/gi,
      (match, _tag, _attrs) => {
        return match.replace(/style="([^"]*)"/i, (_s, style: string) => {
          let newStyle = style;
          // 去掉 writing-mode 相关
          newStyle = newStyle.replace(/writing-mode\s*:\s*[^;]+;?/gi, '');
          newStyle = newStyle.replace(/text-orientation\s*:\s*[^;]+;?/gi, '');
          newStyle = newStyle.replace(/direction\s*:\s*rtl[^;]*;?/gi, '');
          return `style="${newStyle}"`;
        });
      },
    );

    // 第二步：对 ul/ol 做结构修复（若它之前被竖排搞乱了 → 强制 flex column + gap）
    result = result.replace(/<(ul|ol)([^>]*style="[^"]*"[^>]*)>/gi, (match, _tag, _attrs) => {
      return match.replace(/style="([^"]*)"/i, (_s, style: string) => {
        const styles: Record<string, string> = {};
        for (const { key, value } of parseStyleDeclarations(style)) {
          styles[key] = value;
        }
        if (!styles['display']) styles['display'] = 'flex';
        if (styles['display'] === 'flex') {
          if (!styles['flex-direction'] || styles['flex-direction'].startsWith('row')) {
            styles['flex-direction'] = 'column';
          }
        }
        if (!styles['gap']) styles['gap'] = '16px';
        if (!styles['list-style']) styles['list-style'] = 'none';
        // 去掉过大 line-height，避免文字堆叠
        if (styles['line-height']) {
          const n = parseFloat(styles['line-height']);
          if (!Number.isNaN(n) && n > 1.8) delete styles['line-height'];
        }
        const newStyle = Object.entries(styles)
          .map(([k, v]) => `${k}:${v}`)
          .join(';');
        return `style="${newStyle}"`;
      });
    });
    return result;
  }

  /**
   * 建议4 C步：浅底/极浅主色容器 → 禁用白色字（严重对比度问题）
   * 判定：容器 background 为：
   *   - #FFFFFF / #F9FAFB / F3F4F6 / E5E7EB 等浅色
   *   - PRIMARY_COLOR + alpha 末位 ≤ 20（xx08 / xx10 / xx14 / xx20 等极浅透明色）
   *   - 整体亮度 ≥ 0.72
   * 措施：容器内 H1-H6 / p / li / span / div 直接文本 中所有 color:#FFFFFF / F9FAFB / F3F4F6
   *       强制改为 PRIMARY_COLOR_DARKER（深主色或更深 #111827）
   */
  private enforceLightBgTextContrast(
    html: string,
    primaryColor: string,
    _colorPolicy?: SlideColorPolicy,
  ): string {
    const darker = this.darkenPrimaryColor(primaryColor, 0.72);
    let result = html;
    // 扫描叶子 div（不含子 div 的容器卡片）background 为浅底的区块
    const cardPattern = /<div([^>]*style="[^"]*"[^>]*)>((?!<div[\s>])[\s\S]*?)<\/div>/gi;
    let safety = 0;
    while (safety++ < 20) {
      const before = result;
      result = result.replace(cardPattern, (_match, attrs: string, inner: string) => {
        const styleMatch = attrs.match(/style="([^"]*)"/i);
        if (!styleMatch) return _match;
        const style = styleMatch[1];
        // 统一口径：浅底判定收敛到共享权威 resolveBgTone（alpha 感知 + 渐变合成）
        const isLight = this.resolveBgTone(style, primaryColor) === 'light';
        if (!isLight) return _match;
        // 对 inner 里每个文本标签(h1-h6/p/li/span/div直接文本) color 白 → 替换为深主色或 #111827
        const lightColorPattern =
          /color\s*:\s*(#(?:FFFFFF|ffffff|F9FAFB|f9fafb|F3F4F6|f3f4f6|E5E7EB|e5e7eb|FEFEFE|fefefe)\b|white\b|rgba?\(\s*25[0-5]\s*,\s*25[0-5]\s*,\s*25[0-5])/gi;
        const tagsPattern = /<(h[1-6]|p|li|span|div)([^>]*style="[^"]*"[^>]*)>/gi;
        let processedInner = inner;
        // 需要先处理 li 级的 color（li 的 style 里的白）
        processedInner = processedInner.replace(tagsPattern, (_tm, tag: string, tAttrs: string) => {
          const newAttrs = tAttrs.replace(/style="([^"]*)"/i, (_s2, s: string) => {
            if (!lightColorPattern.test(s)) return `style="${s}"`;
            // 渐变文字保护：有效渐变文字（按声明顺序，background 简写不覆盖 clip）不改 color
            if (isEffectiveClipText(s)) return `style="${s}"`;
            // 把浅色的 color 声明替换为深主色，或保留原非浅色声明
            const newStyle = s.replace(lightColorPattern, (_cm) => {
              return `color:${darker}`;
            });
            return `style="${newStyle}"`;
          });
          return `<${tag}${newAttrs}>`;
        });
        // 再检查 span 等嵌套的 style 里的白字（递归最多 3 层避免大正则问题）
        for (let i = 0; i < 2; i++) {
          const before2 = processedInner;
          processedInner = processedInner.replace(
            /(<span[^>]*style=")([^"]+)("[^>]*>)/gi,
            (_m, pre, s, post) => {
              if (!lightColorPattern.test(s)) return _m;
              // 渐变文字保护：有效渐变文字不改 color
              if (isEffectiveClipText(s)) return _m;
              const newStyle = s.replace(lightColorPattern, (_cm: string) => `color:${darker}`);
              return `${pre}${newStyle}${post}`;
            },
          );
          if (processedInner === before2) break;
        }
        return `<div${attrs}>${processedInner}</div>`;
      });
      if (result === before) break;
    }
    return result;
  }

  /**
   * Bug-4 FR-8 颜色兜底（双防线中的代码级层，与 Prompt 修复配合）
   * 行为：只升不降——永远把浅底下 heading 的错误中性色"升"为主色；深底下"升"为白；
   * LLM 已写对（主色/深色变体/渐变字）一律不破坏。
   * @param html 输入幻灯片 HTML（完整外层容器）
   * @param opts.primaryColor 当前页主色 hex（#7c3aed 6 位标准格式）
   * @param opts.primaryColorDarker 当前页主色深色变体 hex（#632ebe）
   * @param opts.pageBgLight 调用方显式传 true 时跳过背景推断，直接按浅底处理（可选）
   * @param opts.pageBgDark 调用方显式传 true 时跳过背景推断，直接按深底处理（可选，优先级高于 pageBgLight）
   */
  private enforceHeadingColorOnLightBg(
    html: string,
    opts: {
      primaryColor: string;
      primaryColorDarker: string;
      titleColor?: string;
      pageBgLight?: boolean;
      pageBgDark?: boolean;
    },
  ): string {
    if (!html) return html;
    const { primaryColor, primaryColorDarker, titleColor } = opts;
    const pLow = (primaryColor || '').toLowerCase();
    const tLow = (titleColor || '').toLowerCase();
    const dLow = (primaryColorDarker || '').toLowerCase();
    if (!/^#[0-9a-f]{6}$/i.test(pLow) && !/^#[0-9a-f]{6}$/i.test(tLow)) return html; // 主色与参考标题色均非法，不兜底

    // =================== 子工具函数 ===================
    const LIGHT_BG_HEX = new Set([
      '#fff',
      '#ffffff',
      '#f9fafb',
      '#f3f4f6',
      '#f8fafc',
      '#f1f5f9',
      '#e5e7eb',
      '#d1d5db',
    ]);
    const DARK_NEUTRAL_HEX = new Set([
      '#111827',
      '#1f2937',
      '#374151',
      '#4b5563',
      '#6b7280',
      '#9ca3af',
      '#000',
      '#000000',
    ]);
    const WHITE_HEX = new Set(['#ffffff', '#fff', '#f9fafb', '#f3f4f6']);

    /** 规范化 hex：#RGB → #RRGGBB；#RRGGBBAA → #RRGGBB；非 #xxx 形式返回原字符串 */
    const normHex = (h: string): string => {
      let s = (h || '').trim().toLowerCase();
      if (!s.startsWith('#')) return s;
      s = s.replace(/^#/, '');
      if (s.length === 3) s = `${s[0]}${s[0]}${s[1]}${s[1]}${s[2]}${s[2]}`;
      if (s.length === 8) s = s.substring(0, 6);
      return '#' + s;
    };

    /** 判断某透明度位（末尾两位 hex alpha）是否 ≤20%（即 00~33；20%=51/255≈0x33） */
    const alphaLowEnough = (hexTail: string): boolean => {
      if (!hexTail || hexTail.length !== 2) return true;
      try {
        return parseInt(hexTail, 16) <= 0x33;
      } catch {
        return true;
      }
    };

    /** 从最外层 <div style="..."> 提取 background-color / background 值，判断浅或深 */
    const detectSlideBg = (): 'light' | 'dark' | 'unknown' => {
      if (opts.pageBgDark) return 'dark';
      if (opts.pageBgLight) return 'light';
      const outer = html.match(/^<div([^>]*)>/i);
      if (!outer) return 'unknown';
      const styleMatch = outer[1].match(/style="([^"]*)"/i);
      if (!styleMatch) return 'light'; // 无 style 默认白底=浅
      const styleStr = styleMatch[1];
      // 从 styleStr 提取 background-color 与 background（不依赖 parseStyleDeclarations，避免字体引号问题）
      const decls: string[] = [];
      let inQ: 0 | 1 | 2 = 0;
      let paren = 0;
      let buf = '';
      for (let i = 0; i < styleStr.length; i++) {
        const c = styleStr[i];
        if (paren === 0) {
          if (c === "'" && inQ !== 2) inQ = inQ === 1 ? 0 : 1;
          else if (c === '"' && inQ !== 1) inQ = inQ === 2 ? 0 : 2;
        }
        if (inQ === 0) {
          if (c === '(') paren++;
          else if (c === ')') paren--;
          else if (c === ';' && paren === 0) {
            decls.push(buf);
            buf = '';
            continue;
          }
        }
        buf += c;
      }
      if (buf.trim()) decls.push(buf);
      let bgColorVal = '';
      let bgVal = '';
      for (const d of decls) {
        const colonIdx = d.indexOf(':');
        if (colonIdx < 0) continue;
        const k = d.substring(0, colonIdx).trim().toLowerCase();
        const v = d.substring(colonIdx + 1).trim();
        if (k === 'background-color') bgColorVal = v.toLowerCase();
        else if (k === 'background') bgVal = v.toLowerCase();
      }
      const probe = bgColorVal || bgVal;
      if (!probe) return 'light'; // 无背景默认白=浅
      // 检查纯色 hex
      const hexM = probe.match(/^#(?:[0-9a-f]{3,8})/i);
      if (hexM) {
        const full = normHex(hexM[0]);
        // 带 alpha 的主色变体：#RRGGBBAA
        const raw = hexM[0].substring(1);
        if (raw.length === 8) {
          const colorPart = '#' + raw.substring(0, 6).toLowerCase();
          const alphaPart = raw.substring(6, 8).toLowerCase();
          // 如果颜色部分 == 主色 或 == 主色 darker，且 alpha ≤ 20% → 浅（视觉几乎白）
          if ((colorPart === pLow || colorPart === dLow) && alphaLowEnough(alphaPart))
            return 'light';
          // 其他深透明色=判 unknown 保守
          return 'unknown';
        }
        if (LIGHT_BG_HEX.has(full)) return 'light';
        if (full === pLow || full === dLow) return 'dark';
        return 'unknown';
      }
      // 浅底关键词
      if (/white|#fff\b|#ffffff\b|#fafafa|#f8fafc|#f1f5f9|#f3f4f6|#f9fafb/i.test(probe))
        return 'light';
      // 深底关键词：linear-gradient 包含主色 hex 或 darker hex → dark
      if (new RegExp(`${pLow.replace(/#/g, '#')}|${dLow.replace(/#/g, '#')}`, 'i').test(probe))
        return 'dark';
      return 'unknown';
    };

    const bg = detectSlideBg();

    /** 给单个 h[123] 标签 style 段 替换/追加 color 属性，返回新的 style 字符串 */
    const applyColorToStyle = (styleStr: string, targetHex: string): string => {
      // 渐变文字豁免：仅当 background-clip:text 声明"实际生效"时才豁免
      // （background 简写写在 clip 之后会把裁剪重置为 border-box，此时不算有效渐变文字，必须纠正）
      if (isEffectiveClipText(styleStr)) {
        return styleStr;
      }
      // 判断当前 color 值
      const colorMatch = styleStr.match(/(^|;)\s*color\s*:\s*([^;]*?)\s*(?=;|$)/i);
      const currentColor = colorMatch ? normHex(colorMatch[2].trim()) : '';
      const currentColorRaw = colorMatch ? colorMatch[2].trim().toLowerCase() : '';
      const targetNorm = normHex(targetHex);
      // 已是目标色（含参考标题色）→ 不写，避免覆盖参考色
      if (currentColor === targetNorm) return styleStr;
      // 当前是白字 → 浅底升级目标色场景不动（避免白字隐形）；深底场景会走 targetHex=#ffffff 分支正常升白
      if (currentColorRaw === 'white' || WHITE_HEX.has(currentColor)) return styleStr;
      // 无 color 或 中性深色 → 升级为目标色（浅底=参考标题色或主色；深底=白字）
      if (
        !colorMatch ||
        DARK_NEUTRAL_HEX.has(currentColor) ||
        DARK_NEUTRAL_HEX.has(currentColor.replace(/^#?/, '#'))
      ) {
        const prop = `color:${targetNorm}`;
        const base = styleStr.trim();
        if (!colorMatch) {
          return base.endsWith(';') ? `${base}${prop}` : `${base};${prop}`;
        }
        return base.replace(
          /(^|;)\s*color\s*:\s*[^;]*?(?=;|$)/i,
          (_m, lead) => `${lead}color:${targetNorm}`,
        );
      }
      return styleStr; // 其他非目标色（如语义绿/红）不干预
    };

    // 对 html 全局替换 <h1 / h2 / h3 标签（闭合带或不带闭合样式均可）
    const headingTagRe = /<h([123])\b([^>]*?)(\/?)>/gi;
    let result = html.replace(
      headingTagRe,
      (_fullMatch, lvl: string, attrs: string, selfClose: string) => {
        const styleRe = /style="([^"]*)"/i;
        const m = attrs.match(styleRe);
        const before = m ? attrs.substring(0, m.index!) : attrs;
        const after = m ? attrs.substring(m.index! + m[0].length) : '';
        let style = m ? m[1] : '';
        // bg=unknown 时保守：不浅不深 → 只升白（若 pageBgDark 未知则不动 primary，避免误伤）
        if (bg === 'light') {
          const lightTarget = tLow && /^#[0-9a-f]{6}$/i.test(tLow) ? tLow : pLow;
          style = applyColorToStyle(style, lightTarget);
        } else if (bg === 'dark') {
          style = applyColorToStyle(style, '#ffffff');
        }
        // bg='unknown' → 不修改，交给 Prompt 规则
        if (!m) {
          if (!style) return _fullMatch; // 既没有 style 也不需加 color → 保持原样（bg=unknown 场景常见）
          return `<h${lvl}${before}style="${style}"${after}${selfClose}>`;
        }
        return `<h${lvl}${before}style="${style}"${after}${selfClose}>`;
      },
    );
    return result;
  }

  /**
   * 建议1：封面海报级艺术字兜底
   * 判定：outer 容器里有 h1（主标题 + 若干 p 副标题）
   * 措施：
   *   1. 如果没居中 → 改 justify-content:center + align-items:center + text-align:center
   *   2. H1 字号 < 80 → 升到 88，font-weight < 900 → 900
   *   3. H1 没 text-shadow / 没 -webkit-text-stroke → 加上 3 层发光 + 描边 1.5px
   *   4. H1 下方缺少装饰粗渐变条 → 插入
   *   5. 没有 2 个装饰 blob/光晕 → 插入右上角+左下角
   *   6. 副标题无分层（都是24px 灰）→ 按顺序分层 36/28/28 + 最后一行作者 badge 胶囊
   */

  /**
   * 语义化统计「纯装饰 blob」数量，替代脆弱的字面正则。
   *
   * 判定标准：一个 <div> 同时满足
   *   ① position:absolute（或 fixed）
   *   ② style 内含 渐变(radial/linear-gradient) 或 clip-path（即它是装饰形状而非内容块）
   *   ③ 其 innerHTML 无可见文本（仅空白/注释/嵌套装饰，无裸文字）
   * 才计入装饰。
   *
   * 之所以不用 `/pointer-events:none|clip-path:polygon/gi` 这类字面匹配：
   * 终局 server 端 sanitizeHtmlServerSide 用 JSDOM 序列化会把 style 规范化为 `key: value`（带空格、
   * 去尾分号），导致紧凑字面 100% 失配 → 误判"无装饰" → enforceCoverPosterArtStyles 重复注入模板装饰。
   * 语义判定只看"绝对定位 + 有渐变/clip + 无文本"的结构特征，对空白差异完全鲁棒。
   */
  private countDecorativeBlobs(html: string): number {
    const divRe = /<div\b([^>]*)>/gi;
    let count = 0;
    let m: RegExpExecArray | null;
    while ((m = divRe.exec(html)) !== null) {
      const attrs = m[1];
      const styleMatch = /\bstyle\s*=\s*["']([^"']*)["']/i.exec(attrs);
      if (!styleMatch) continue;
      const style = styleMatch[1];
      const isAbsolute =
        /position\s*:\s*absolute/i.test(style) || /position\s*:\s*fixed/i.test(style);
      const hasGradOrClip = /radial-gradient|linear-gradient|clip-path/i.test(style);
      if (!isAbsolute || !hasGradOrClip) continue;
      // 该 div 内部无可见文本（去除注释与标签后只剩空白）
      const closeIdx = this.findClosingTagIndex(html.substring(m.index), 'div');
      const innerStart = m.index + m[0].length;
      const innerEnd = closeIdx >= 0 ? m.index + closeIdx : innerStart;
      const inner = html.substring(innerStart, innerEnd);
      const visible = inner
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<[^>]+>/g, '')
        .trim();
      if (!visible) count++;
    }
    return count;
  }

  // —— 背景明暗探测（封面艺术字分叉用）：定位承载文本的实底容器，合成其背景后定整页色调 ——
  // 跳过母版层（data-master-*）与装饰层（绝对定位+无指针），避免被 hero 蒙版 / 装饰光晕误判为深底。
  // 取第一个带实底（合成后非透明）的容器定 tone；都为透明则默认白底画布。
  private detectSlideBackgroundTone(html: string, primaryColor: string): 'light' | 'dark' {
    const divRe = /<div([^>]*)>/gi;
    let m: RegExpExecArray | null;
    while ((m = divRe.exec(html)) !== null) {
      const attrs = m[1];
      if (/data-master/i.test(attrs)) continue; // 跳过母版/hero 层
      const styleMatch = attrs.match(/style="([^"]*)"/i);
      if (!styleMatch) continue;
      const style = styleMatch[1];
      if (this.isDecorativeLayer(style)) continue; // 装饰层不决定整页色调
      const tone = this.resolveBgTone(style, primaryColor);
      if (tone === 'dark') return 'dark';
      if (tone === 'light') return 'light';
      // unknown（背景透明）→ 继续看下一个实底容器
    }
    return 'light'; // 无实底 → 默认白底画布
  }

  // ===== 共享：alpha 感知的颜色 / 对比度工具组 =====
  // 背景真实可见色 = 半透明层按 alpha 叠加到白底画布后的合成结果；8 位 hex 必须保留 alpha。
  // 所有「深浅底判定 / 是否改写文字色」都收敛到这一组，避免各兜底口径打架（浅底白字根因）。

  // alpha 感知的四元组解析
  private parseColorToRgba(token: string): [number, number, number, number] | null {
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
  private compositeOver(
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
  private relativeLuminance(rgb: [number, number, number]): number {
    const lin = (c: number) => {
      const x = c / 255;
      return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
  }

  // WCAG 对比度比
  private contrastRatio(fg: [number, number, number], bg: [number, number, number]): number {
    const lf = this.relativeLuminance(fg);
    const lb = this.relativeLuminance(bg);
    const lighter = Math.max(lf, lb);
    const darker = Math.min(lf, lb);
    return (lighter + 0.05) / (darker + 0.05);
  }

  // 装饰层识别：绝对定位 + 屏蔽指针事件（调用方再配合"无可见文本"判定）；不参与整页色调
  private isDecorativeLayer(styleStr: string): boolean {
    const lower = styleStr.toLowerCase();
    return /position\s*:\s*absolute/.test(lower) && /pointer-events\s*:\s*none/.test(lower);
  }

  // 合成出某个 inline style 的真实可见背景 RGB（白底画布），无背景返回 null（调用方回退到父级/白底）
  private resolveEffectiveBgRgb(styleStr: string): [number, number, number] | null {
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
        const rgba = this.parseColorToRgba(tok);
        if (!rgba) continue;
        const [r, g, b, a] = rgba;
        if (a <= 0.2) continue; // 极浅透明色标不参与（与仓库既有 α≤0x33 口径一致）
        const comp = this.compositeOver([r, g, b, a], [255, 255, 255]);
        sum += this.relativeLuminance(comp);
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
    const rgba = this.parseColorToRgba(bgVal);
    if (rgba) return this.compositeOver(rgba, [255, 255, 255]);
    const rgbaM = bgVal.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/i);
    if (rgbaM)
      return this.compositeOver(
        [+rgbaM[1], +rgbaM[2], +rgbaM[3], rgbaM[4] !== undefined ? parseFloat(rgbaM[4]) : 1],
        [255, 255, 255],
      );
    return null;
  }

  // 统一背景色调权威：alpha 感知 + 合成 + 装饰层豁免；四个兜底函数统一调用
  private resolveBgTone(
    styleStr: string,
    _primaryColor: string,
    opts?: { isDecorative?: boolean },
  ): 'light' | 'dark' | 'unknown' {
    if (opts?.isDecorative) return 'unknown';
    const rgb = this.resolveEffectiveBgRgb(styleStr);
    if (!rgb) return 'unknown';
    const L = this.relativeLuminance(rgb);
    if (L < 0.18) return 'dark';
    if (L > 0.6) return 'light';
    return 'unknown';
  }

  // 按 WCAG 阈值判断是否需改写：正文 ≥4.5、大字(≥24px 或 ≥18.66px 且 bold) ≥3.0，达标不动
  private needsContrastFix(
    fgToken: string,
    bgRgb: [number, number, number],
    fontSizePx: number,
    fontWeight: number,
  ): boolean {
    const fg = this.parseColorToRgba(fgToken);
    if (!fg) return false; // 命名色/var 无法解析 → 保守不动
    const ratio = this.contrastRatio([fg[0], fg[1], fg[2]], bgRgb);
    const isLarge = fontSizePx >= 24 || (fontSizePx >= 18.66 && fontWeight >= 700);
    return ratio < (isLarge ? 3.0 : 4.5);
  }

  private fontSizeOf(props: Map<string, string>): number {
    const v = (props.get('font-size') || '').match(/[\d.]+/);
    return v ? parseFloat(v[0]) : 18;
  }

  private fontWeightOf(props: Map<string, string>): number {
    const v = props.get('font-weight');
    if (!v) return 400;
    if (/bold/i.test(v)) return 700;
    const n = parseInt(v, 10);
    return isNaN(n) ? 400 : n;
  }

  // —— 终局文字对比度兜底（覆盖全部页型）：深底容器内清理渐变裁剪样式并强制白字 ——
  // 置于后处理链尾，确保样式化兜底（含封面艺术字）之后再也不会把文字改暗。
  private enforceFinalTextContrast(
    html: string,
    primaryColor: string,
    colorPolicy?: SlideColorPolicy,
  ): string {
    // 单遍祖先栈：维护"当前生效背景 RGB"，消除非贪婪正则在嵌套 div 下的容器配对错配（根因 D）；
    // 对比度不达标才改写文字色（深底→#FFFFFF，浅底/未知→#111827），终局幂等兜底。
    // 参考撞色板 / 标题色 / 正文色 / 描边色作为显式白名单豁免：用户明确上传的风格色不强行改写。
    const refColorSet = new Set<string>();
    if (colorPolicy) {
      for (const c of [
        colorPolicy.titleColor,
        colorPolicy.bodyColor,
        colorPolicy.strokeColor,
        ...colorPolicy.accents,
      ]) {
        if (c) refColorSet.add(this.normalizeHex(c) || c.toLowerCase());
      }
    }
    // 主色 / 深色变体也纳入豁免，保护参考 accent 高亮（如 #ff4d6d）不被误改写为 #111827
    for (const c of [primaryColor, this.darkenPrimaryColor(primaryColor, 0.75)]) {
      if (c) refColorSet.add(this.normalizeHex(c) || c.toLowerCase());
    }
    const stack: Array<[number, number, number]> = [[255, 255, 255]];
    const re =
      /<(\/?)(div|section|article|body|html)([^>]*)>|<(h[1-6]|p|li|span|small|a|strong|em|b|i|u|label)([^>]*?)style="([^"]*)"([^>]*>)/gi;
    const edits: Array<{ start: number; end: number; text: string }> = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      if (m[2] !== undefined && m[2] !== '') {
        // 容器标签：维护背景栈
        if (m[1] === '/') {
          if (stack.length > 1) stack.pop();
        } else {
          const styleVal = (m[3].match(/style="([^"]*)"/i) || [])[1] || '';
          const bg = this.resolveEffectiveBgRgb(styleVal);
          stack.push(bg || stack[stack.length - 1]);
        }
        continue;
      }
      // 文本标签（groups 4-7）：基于"最近实底祖先"的合成背景判定对比度
      const tag = m[4];
      const pre = m[5];
      const styleVal = m[6];
      const post = m[7];
      const bg = stack[stack.length - 1];
      const props = new Map<string, string>();
      for (const d of parseStyleDeclarations(styleVal)) props.set(d.key, d.value);
      const isGradientText = isEffectiveClipText(styleVal);
      const cur = (props.get('color') || '').trim();
      let newColor: string | null = null;
      if (isGradientText) {
        // 仅深底上的渐变字可能不可读 → 改纯白（浅底保留大模型渐变艺术字）
        if (this.relativeLuminance(bg) < 0.18) {
          newColor = '#FFFFFF';
          props.delete('background');
          props.delete('-webkit-background-clip');
          props.delete('background-clip');
          props.delete('-webkit-text-fill-color');
        }
      } else if (cur) {
        const curHex = this.normalizeHex(cur);
        // 参考撞色 / 标题色 / 正文色 / 描边色：用户明确上传的风格，终局对比度也不改写
        if (curHex && refColorSet.has(curHex)) {
          continue;
        }
        if (this.needsContrastFix(cur, bg, this.fontSizeOf(props), this.fontWeightOf(props))) {
          newColor = this.relativeLuminance(bg) < 0.18 ? '#FFFFFF' : '#111827';
        }
      }
      if (!newColor) continue;
      // 基于已更新的 props（含渐变分支的删除与原色替换）重建样式，保证删除/改写真正生效
      props.set('color', newColor);
      const finalStyle = Array.from(props.entries())
        .map(([k, v]) => `${k}:${v}`)
        .join(';');
      const newTag = `<${tag}${pre}style="${finalStyle}"${post}`;
      edits.push({ start: m.index, end: m.index + m[0].length, text: newTag });
    }
    let out = html;
    for (let i = edits.length - 1; i >= 0; i--) {
      out = out.slice(0, edits[i].start) + edits[i].text + out.slice(edits[i].end);
    }
    return out;
  }

  private enforceCoverPosterArtStyles(
    html: string,
    primaryColor: string,
    _sw: number,
    _sh: number,
    titleColor?: string,
    composition?: ReferenceComposition,
  ): string {
    let result = html;
    // —— Bug-3 加固 D：即使 isCover 判定"应该是封面"，如果检测到 h2/h3/ul/ol/img/table 内容标记也直接退出
    //    （防止极端情况下 isCover 的 h1+/h2- 判定因大小写/注释等原因被绕过，而 Step1 又无条件向最外层写三件套）
    const hasH2OrList = /<h[23]\b|<(ul|ol)\b|<img[\s>]|<table\b/i.test(result);
    if (hasH2OrList) return result;
    const darker = this.darkenPrimaryColor(primaryColor, 0.75);
    // 判断是否封面：最外层 div 里有 <h1 且没有 <h2（cover 特征）
    const isCover = /<h1[^>]*>/i.test(result) && !/<h2[^>]*>/i.test(result);
    if (!isCover) return result;
    // FR-4 幂等守卫：已施加过封面海报艺术字（含 data-noppt-coverart 标记）则整体跳过，
    // 避免 agent 一次处理 + server 重放（postProcessHtmlSnapshot）多次调用下重复注入装饰 / badge、重复覆写字号间距。
    if (/data-noppt-coverart/i.test(result)) return result;
    // 背景明暗探测：深底（含深色渐变）封面 → 白色艺术字；浅底 → 主色渐变艺术字
    const tone = this.detectSlideBackgroundTone(result, primaryColor);
    const GRAD = `linear-gradient(135deg,${primaryColor},${darker})`;
    // 参考左对齐构图时，不强行给容器/H1 加居中，保留参考版式
    const center = composition !== 'left-aligned';

    // Step 1: 调整外层容器居中（找到包含 width:100%;height:100%;overflow:hidden 的 outermost flex 容器）
    if (center) {
      result = result.replace(/<div([^>]*style=")([^"]+)("[^>]*>)/gi, (_m, pre, style, post) => {
        // 必须是外层：style 里同时有 width:100%、height:100%、overflow:hidden、display:flex
        if (!(
          /width\s*:\s*100%/i.test(style) &&
          /height\s*:\s*100%/i.test(style) &&
          /overflow\s*:\s*hidden/i.test(style) &&
          /display\s*:\s*flex/i.test(style)
        ))
          return _m;
        const props = new Map<string, string>();
        for (const d of parseStyleDeclarations(style)) props.set(d.key, d.value);
        props.set('justify-content', 'center');
        props.set('align-items', 'center');
        props.set('text-align', 'center');
        const newStyle = Array.from(props.entries())
          .map(([k, v]) => `${k}:${v}`)
          .join(';');
        return `<div${pre}${newStyle}${post}`;
      });
    }

    // Step 2 + 3: H1 升级为海报级超大艺术字 + 发光 + 描边
    result = result.replace(
      /<h1([^>]*style=")([^"]*)("[^>]*>)([\s\S]*?)<\/h1>/i,
      (_m, pre, style, post, text) => {
        const props = new Map<string, string>();
        for (const d of parseStyleDeclarations(style)) props.set(d.key, d.value);
        // 字号
        let fs = parseFloat(props.get('font-size') || '64');
        if (fs < 80) fs = 88;
        props.set('font-size', `${fs}px`);
        // 字重
        const fw = parseInt(props.get('font-weight') || '700', 10);
        if (fw < 900) props.set('font-weight', '900');
        props.set('line-height', '1.1');
        props.set('letter-spacing', '0.01em');
        props.set('width', '100%');
        props.set('text-align', center ? 'center' : 'left');
        props.set('max-width', center ? 'none' : '58%');
        // 深底/浅底分叉：深底（含深色渐变背景）用白色艺术字；浅底用主色渐变艺术字
        if (tone === 'dark') {
          // 深底：白色艺术字（清理渐变裁剪属性，否则红字压红底不可读），保留描边/发光
          props.set('color', '#FFFFFF');
          props.delete('background');
          props.delete('-webkit-background-clip');
          props.delete('background-clip');
          props.delete('-webkit-text-fill-color');
          props.set(
            'text-shadow',
            `0 4px 30px rgba(0,0,0,0.35),0 0 70px ${primaryColor}30,0 0 140px ${primaryColor}15`,
          );
          props.set('-webkit-text-stroke', `1.5px rgba(255,255,255,0.55)`);
        } else {
          if (titleColor) {
            // 参考标题色存在：标题色收敛——H1 强制纯色 titleColor，删除任何渐变裁剪属性，
            // 改用 text-shadow 多层光晕 + 描边实现海报级冲击力（不注入/不保留渐变填充）。
            const tColor = this.normalizeHex(titleColor) || titleColor;
            props.set('color', tColor);
            props.delete('background');
            props.delete('-webkit-background-clip');
            props.delete('background-clip');
            props.delete('-webkit-text-fill-color');
          } else {
            const hasGradFill =
              props.has('-webkit-text-fill-color') &&
              props.get('-webkit-text-fill-color') === 'transparent';
            if (!hasGradFill) {
              props.set('background', GRAD);
              props.set('-webkit-background-clip', 'text');
              props.set('-webkit-text-fill-color', 'transparent');
              props.set('background-clip', 'text');
            }
          }
          props.set(
            'text-shadow',
            `0 4px 30px ${primaryColor}50,0 0 70px ${primaryColor}30,0 0 140px ${primaryColor}15`,
          );
          props.set('-webkit-text-stroke', `1.5px ${primaryColor}80`);
        }
        props.delete('margin-top');
        props.set('margin-bottom', '32px');
        const ns = Array.from(props.entries())
          .map(([k, v]) => `${k}:${v}`)
          .join(';');
        return `<h1${pre}${ns}${post}${text}</h1>`;
      },
    );

    // Step 4: 如果 H1 之后没有渐变粗装饰条（<div> 6~10px 高度的渐变条），插入
    // 先看 h1 闭合后 1K 字符内有没有 "height:10px" 或 "height:8px"+"background:linear-gradient"
    const hasDecorBar =
      /<\/h1>[\s\S]{0,1000}height:\s*(?:[89]|1[0-2])px[\s\S]{0,150}background:\s*linear-gradient/i.test(
        result,
      );
    if (!hasDecorBar) {
      // H1 后面允许间隔更宽（换行+注释+空格都算）
      result = result.replace(/<\/h1>([\s\S]{0,200}?)(<(?:p|div)\b)/i, (_m, gap, nextTag) => {
        // 如果 gap 里已经有 <div（即已有装饰块）就跳过
        if (/<div/i.test(gap)) return _m;
        const bar = `</h1>${gap}<div style="width:180px;height:10px;background:linear-gradient(90deg,${primaryColor},${darker});border-radius:5px;margin:0 auto 48px auto;box-shadow:0 4px 20px ${primaryColor}45;"></div>${nextTag}`;
        return bar;
      });
    }

    // Step 5: 装饰光晕 blobs 数量 < 2 → 插入 右上 + 左下两个
    // 语义化统计：绝对定位 + 含渐变/clip-path + 内部无可见文本的纯装饰 div。
    // 关键修复：不再依赖紧凑无空格的正则字面（pointer-events:none / clip-path:polygon），
    // 因为终局 server 端 sanitizeHtmlServerSide 用 JSDOM 序列化会把 style 规范化为 "key: value"（带空格），
    // 旧正则 100% 失配 → 误判"无装饰" → 重复注入模板装饰。语义判定对空白差异鲁棒。
    const blobCount = this.countDecorativeBlobs(result);
    if (blobCount < 2) {
      // 外层第一个 <div ...width:100%;height:100%;overflow:hidden...> 之后插入两个装饰 div
      // 宽松匹配：style 里同时有 width:100%、height:100%、overflow:hidden
      result = result.replace(/<div([^>]*style=")([^"]+)("[^>]*>)/i, (_m, pre, style, post) => {
        if (!(
          /width\s*:\s*100%/i.test(style) &&
          /height\s*:\s*100%/i.test(style) &&
          /overflow\s*:\s*hidden/i.test(style) &&
          /display\s*:\s*flex/i.test(style)
        ))
          return _m;
        return `<div${pre}${style}${post}
  <div style="position:absolute;top:-80px;right:-120px;width:520px;height:520px;border-radius:50%;background:radial-gradient(circle,${primaryColor}35 0%,${primaryColor}10 45%,transparent 75%);pointer-events:none;"></div>
  <div style="position:absolute;left:-160px;bottom:-120px;width:480px;height:400px;background:linear-gradient(135deg,${primaryColor}18,${darker}10);clip-path:polygon(0 30%,40% 0,80% 60%,30% 100%);pointer-events:none;"></div>
  <div style="position:absolute;left:80px;top:20%;bottom:20%;width:3px;background:linear-gradient(180deg,transparent,${primaryColor},transparent);border-radius:2px;pointer-events:none;"></div>`;
      });
    }

    // Step 6: 副标题分层（p 标签批量调整顺序）
    // 先收集 H1 之后、外层 </div> 之前的所有 <p ...>...</p>，按顺序处理
    const h1EndIdx = result.search(/<\/h1>/i);
    if (h1EndIdx > 0) {
      // 跳过装饰条 div，取正文 p 序列
      const afterH1 = result.slice(h1EndIdx + 5);
      const pMatches = [...afterH1.matchAll(/<p([^>]*style=")([^"]*)("[^>]*>)([\s\S]*?)<\/p>/gi)];
      const totalPs = pMatches.length;
      if (totalPs > 0) {
        pMatches.forEach((m, idx) => {
          const full = m[0] as string;
          const pre = m[1] as string;
          const style = m[2] as string;
          const post = m[3] as string;
          const textPart = m[4] as string;
          const props = new Map<string, string>();
          for (const d of parseStyleDeclarations(style)) props.set(d.key, d.value);
          // === 修复 E：查找外层直接包裹容器（afterH1 里这个 p 前面最近的一个未闭合的 div）是不是 Badge 容器 ===
          // 找到 full 在 afterH1 中的绝对起始偏移
          const startInAfter = m.index ?? 0;
          // 往回看最多 400 字符，找最近一个 <div...> 且匹配到 </div> 要在 startInAfter+full.length 之后
          let parentIsBadge = false;
          const tail = afterH1.slice(Math.max(0, startInAfter - 500), startInAfter);
          // 压栈式检查：从 tail 末尾往回找所有 <div> / </div>，平衡后找到最后一个未闭合的 <div（要求匹配的 </div> 必须在 p 之后出现 且 距离 p 结束只有 whitespace）
          const tailRe = /<(\/)?div\b([^>]*)>/gi;
          const hits: Array<{ close: boolean; attrs: string; pos: number }> = [];
          let mm: RegExpExecArray | null;
          while ((mm = tailRe.exec(tail)) !== null) {
            hits.push({ close: mm[1] === '/', attrs: mm[2] || '', pos: mm.index });
          }
          let bal = 0;
          let unclosed: (typeof hits)[number] | null = null;
          for (let k = hits.length - 1; k >= 0; k--) {
            bal += hits[k].close ? -1 : +1;
            if (bal > 0 && !hits[k].close) {
              unclosed = hits[k];
              break;
            }
          }
          if (unclosed) {
            // 检查 p 之后是否立即出现外层 </div>（间隔只有空白/换行），说明这个 div 刚好包着这个 p
            const afterP = afterH1.slice(startInAfter + full.length);
            if (/^\s*<\/div>/i.test(afterP)) {
              // 用 isBadgeStyle 相同的 4 特征 3/4 判定
              const attrs = unclosed.attrs;
              const sm = attrs.match(/style="([^"]*)"/i);
              if (sm) {
                const s = sm[1];
                const has = (r: RegExp) => r.test(s);
                const score = [
                  has(/display\s*:\s*(?:inline-flex|flex)\b/i),
                  has(/padding\s*:[^;]*(?:1[0-9]px\s+2[0-9]px|10px\s+28px|12px\s+24px)\b/i),
                  has(/border-radius\s*:[^;]*999px/i),
                  has(
                    /background\s*:[^;]*(?:#[0-9a-f]{6,8}1[0-9a-f]|rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*0\.0[5-9])/i,
                  ),
                ].filter(Boolean).length;
                if (score >= 3) parentIsBadge = true;
              }
            }
          }
          // 副标题分层：仅当对比度不达标时才修正颜色，保留大模型原始字号 / 字重 / 渐变艺术字（保守策略）
          const pageBg: [number, number, number] = tone === 'dark' ? [30, 30, 30] : [255, 255, 255];
          const isGradText = (p: Map<string, string>): boolean =>
            (p.get('-webkit-text-fill-color') || '').toLowerCase() === 'transparent' &&
            /text/.test(p.get('background-clip') || p.get('-webkit-background-clip') || '');
          const fixColorIfNeeded = (): void => {
            const cur = (props.get('color') || '').trim();
            if (isGradText(props)) {
              // 渐变艺术字：仅深底可能不可读 → 改纯白；浅底保留大模型渐变艺术字
              if (this.relativeLuminance(pageBg) < 0.18) {
                props.set('color', '#FFFFFF');
                props.delete('background');
                props.delete('-webkit-background-clip');
                props.delete('background-clip');
                props.delete('-webkit-text-fill-color');
              }
              return;
            }
            if (
              cur &&
              this.needsContrastFix(cur, pageBg, this.fontSizeOf(props), this.fontWeightOf(props))
            ) {
              props.set('color', tone === 'dark' ? '#FFFFFF' : '#1F2937');
            }
          };
          if (totalPs === 1) {
            fixColorIfNeeded();
          } else if (idx === 0) {
            // 第一行：不强制字号/字重；保留大模型（含渐变艺术字），仅在不达标时修正颜色
            fixColorIfNeeded();
          } else if (idx < totalPs - 1) {
            // 中间行：保留模型字号/字重；仅在不达标时修正颜色（修复 slide-01 副标题 24px/#1F2937 → 28px/#F3F4F6 的误改）
            fixColorIfNeeded();
            // 外层是 Badge：清掉 wrapTextNodes 可能带进的 DEFAULT_P_STYLE 脏值，避免和外层 badge 样式冲突
            if (parentIsBadge) {
              props.delete('padding');
              props.delete('box-shadow');
              props.delete('background');
              props.delete('border-radius');
              props.delete('letter-spacing');
              props.delete('display');
              props.delete('align-items');
              props.delete('overflow-wrap');
              props.delete('word-break');
            }
          } else {
            // 最后一行：胶囊 badge（保留容器装饰，仅保证文字对比）
            const hasDisplayBadge = /inline-flex|^flex$/i.test((props.get('display') || '').trim());
            const hasPaddingBadge = /1[0-9]px\s+2[0-9]px|^\s*10px\s+28px/.test(
              props.get('padding') || '',
            );
            const hasRadiusBadge = /999px/.test(props.get('border-radius') || '');
            const pSelfBadge = hasDisplayBadge && hasPaddingBadge && hasRadiusBadge;
            if (!parentIsBadge && !pSelfBadge) {
              props.set('display', 'inline-flex');
              props.set('align-items', 'center');
              props.set('padding', '10px 28px');
              props.set('border-radius', '999px');
              props.set(
                'background',
                tone === 'dark' ? 'rgba(255,255,255,0.14)' : `${primaryColor}12`,
              );
              props.set('letter-spacing', '0.02em');
              props.set('box-shadow', `0 2px 10px ${primaryColor}20`);
            } else {
              // 外层/自身已是 Badge：清理 DEFAULT_P_STYLE 脏值
              props.delete('overflow-wrap');
              props.delete('word-break');
              props.delete('color');
              props.delete('line-height');
              if (parentIsBadge) {
                props.delete('padding');
                props.delete('background');
                props.delete('border-radius');
                props.delete('box-shadow');
                props.delete('letter-spacing');
                props.delete('display');
                props.delete('align-items');
              }
            }
            // 文本相关属性（badge 容器背景由我们设定，颜色按对比安全设置）
            props.set('color', tone === 'dark' ? '#FFFFFF' : primaryColor);
            props.set('font-size', '20px');
            props.set('font-weight', '600');
            props.set('margin', '0');
          }
          const ns = Array.from(props.entries())
            .map(([k, v]) => `${k}:${v}`)
            .join(';');
          const replacement = `<p${pre}${ns}${post}${textPart}</p>`;
          result = result.replace(full, replacement);
        });
      }
    }
    // FR-4 幂等标记：标记已施加封面艺术字，确保后续重放（postProcessHtmlSnapshot）整体跳过，
    // 避免因 agent 一次处理 + server 多次重放导致装饰 / badge 被重复注入。
    if (!/data-noppt-coverart/i.test(result)) {
      result = result.replace(
        /<div([^>]*style=")([^"]*width:100%[^"]*height:100%[^"]*overflow:hidden[^"]*)("[^>]*>)/i,
        (_m, pre, style, post) =>
          `<div${pre}${style}${post.replace(/>$/, ' data-noppt-coverart>')}`,
      );
    }
    return result;
  }

  /**
   * 建议2：左文右图 55:45 + 文字 li 卡片条化
   * 判定：外层有 flex:1 两列，一列 ul 文字，一列 img（content-image-right/left）
   * 措施：
   *   1. 图片列 45% 文字列 55%（无论 left/right 文字都 > 图片）
   *   2. 每个 li 增加 padding:20px 24px;border-radius:14px;background:linear-gradient(135deg,P08,P10);
   *      border-left:5px solid P; box-shadow:0 4px 16px P15;
   *   3. li 里的图标 span width:28 → 40px，height:40
   *   4. 文字 span font-size:22 → 28px, font-weight:600, color:#111827
   *   5. 文字列 justify-content: space-evenly
   */
  private enforceLeftRight5545AndCardBar(html: string, primaryColor: string): string {
    let result = html;
    // 判定：不是对比页（没有 content-compare）：有 > div style="flex:0 0 45%" 里是 img
    const hasFlexSplit = /flex:\s*0\s+0\s+45%/i.test(result) && /<img[\s>]/i.test(result);
    const hasCompareGrid =
      /border:\s*2px\s+solid\s+(?:#E5E7EB|[^";]*{[^}]*})/i.test(result) &&
      /background:\s*#[0-9A-Fa-f]{6}08/i.test(result);
    if (!hasFlexSplit || hasCompareGrid) return result;
    const darker = this.darkenPrimaryColor(primaryColor, 0.78);
    const CARD_BG = `linear-gradient(135deg,${primaryColor}08,${primaryColor}10)`;
    const CARD_SHADOW = `0 4px 16px ${primaryColor}15`;

    // 1. 比例修正（防双重嵌套）：
    //    - 判定：横排父容器（display:flex 且无 flex-direction:column，且子节点同时含 55%/45% 两列或 ul+img）→ 设为 flex:1 1 0%（占满 H2 下方剩余宽度）
    //    - 文字列 div（display:flex flex-direction:column 且包 ul）→ 设为 flex:0 0 55%
    //    - 图片列 div（包 img）→ 设为 flex:0 0 45%
    // 修复 A1/A2/B2：精确扫描直接子节点（避免孙节点干扰）、保护已有正确 flex 值不被覆盖、移除多余标签前缀
    const splitRegex = /(<div[^>]*style=")([^"]*)("[^>]*>)/gi;
    // 关键：用 replace 回调的 offset（第 5 个参数）精准定位当前匹配位置，避免 indexOf 命中相同字符串的旧位置
    result = result.replace(
      splitRegex,
      (_m: string, pre: string, style: string, post: string, offset: number, _src: string) => {
        const props = new Map<string, string>();
        for (const d of parseStyleDeclarations(style)) props.set(d.key, d.value);
        const display = (props.get('display') || '').trim();
        const flexDir = (props.get('flex-direction') || '').trim();
        if (display !== 'flex') return _m;

        // —— T5-FR5 防误伤：跳过「1280×720 画布根容器」——
        // 根容器特征（缺一不可）：width:100% + height:100%，且没有明确的百分比 flex-basis（0 0 55% / 0 0 45%）。
        // 把根容器当「文字列」改 flex:0 0 55% 会把图片列挤出可见区域（整页只剩 55% 宽）。
        const w = (props.get('width') || '').trim();
        const h = (props.get('height') || '').trim();
        const curFlex = (props.get('flex') || '').trim();
        const isCanvasRoot = w === '100%' && h === '100%' && !/0\s+0\s+(?:\d+)%/.test(curFlex);
        if (isCanvasRoot) return _m;

        // —— B2：使用栈式精确扫描直接子节点，不包含孙节点 ——
        const contentStart = offset + _m.length;
        const closeIdx = this.findClosingTagIndex(result.substring(offset), 'div');
        const containerInner =
          closeIdx >= 0
            ? result.substring(contentStart, offset + closeIdx)
            : result.substring(contentStart, contentStart + 8000);
        const directChildren = this.findDirectChildElements(containerInner);

        const childFlexes = directChildren
          .filter((c) => c.tagName === 'div' && c.styleAttr)
          .slice(0, 10)
          .map((c) => {
            const childProps = new Map<string, string>();
            for (const d of parseStyleDeclarations(c.styleAttr!)) childProps.set(d.key, d.value);
            return {
              flex: childProps.get('flex') || '',
              childDir: childProps.get('flex-direction') || '',
            };
          });
        const hasChildUl =
          directChildren.some((c) => c.tagName === 'ul' || c.tagName === 'ol') ||
          directChildren.some(
            (c) => c.tagName === 'div' && /<(ul|ol)[\s>]/i.test(c.innerPreview || ''),
          );
        const hasChildImg =
          directChildren.some((c) => c.tagName === 'img' || c.tagName === 'picture') ||
          directChildren.some(
            (c) => c.tagName === 'div' && /<(img|picture)[\s>]/i.test(c.innerPreview || ''),
          );
        const hasChild55 = childFlexes.some(
          (c) => /0\s+0\s+55%/.test(c.flex) || c.childDir === 'column',
        );
        const hasChild45 = childFlexes.some((c) => /0\s+0\s+45%/.test(c.flex));

        // ========== 外层横排父容器（左右两列布局的 wrapper）→ flex:1 1 0% 占满 H2 下方剩余宽度 ==========
        const isRowWrapper =
          (!flexDir || flexDir === 'row') &&
          ((hasChildUl && hasChildImg) || (hasChild55 && hasChild45));
        if (isRowWrapper) {
          // A2：若已经存在合理 flex 值（1 / 1 1 0% / 1 1 auto）则不覆盖
          const curFlex = (props.get('flex') || '').trim();
          const flexAlreadyOk = /^(1|flex|auto)\b/.test(curFlex) || /^1\s+1\s+/.test(curFlex);
          if (!flexAlreadyOk) props.set('flex', '1 1 0%');
          if (!props.has('min-height')) props.set('min-height', '0');
          if (!props.has('min-width')) props.set('min-width', '0');
          if (!props.has('gap')) props.set('gap', '40px');
          if (!props.has('align-items')) props.set('align-items', 'stretch');
          props.delete('overflow');
          const ns = Array.from(props.entries())
            .map(([k, v]) => `${k}:${v}`)
            .join(';');
          return `${pre}${ns}${post}`; // A1 修复：pre 已含 <div，不再重复拼
        }

        // ========== 文字列（column 且包 ul，内部无大 img 列）→ flex:0 0 55% ==========
        if (flexDir === 'column' && hasChildUl && !hasChildImg && !hasChild45) {
          // A2：已有 0 0 55% 则不覆盖；若 flex 非空但不符合目标也不强制（保留 AI 原值）
          const curFlex = (props.get('flex') || '').trim();
          if (!curFlex || /0\s+0\s+55%/.test(curFlex)) {
            props.set('flex', '0 0 55%');
          }
          if (!props.has('min-height')) props.set('min-height', '0');
          if (!props.has('min-width')) props.set('min-width', '0');
          props.delete('overflow');
          if (!props.has('justify-content')) props.set('justify-content', 'space-evenly');
          if (!props.has('align-items')) props.set('align-items', 'stretch');
          const ns = Array.from(props.entries())
            .map(([k, v]) => `${k}:${v}`)
            .join(';');
          return `${pre}${ns}${post}`; // A1 修复
        }

        // ========== 图片列（包含 <img 或 picture）→ flex:0 0 45% ==========
        if ((!flexDir || flexDir === 'row') && hasChildImg && !hasChildUl && !hasChild55) {
          // A2：已有 0 0 45% 则不覆盖
          const curFlex = (props.get('flex') || '').trim();
          if (!curFlex || /0\s+0\s+45%/.test(curFlex)) {
            props.set('flex', '0 0 45%');
          }
          if (!props.has('min-height')) props.set('min-height', '0');
          if (!props.has('min-width')) props.set('min-width', '0');
          const ns = Array.from(props.entries())
            .map(([k, v]) => `${k}:${v}`)
            .join(';');
          return `${pre}${ns}${post}`; // A1 修复
        }

        return _m;
      },
    );

    // 2. 兜底清除：所有 <ul> 上被编辑器附加的固定 height/width/max-height/max-width（会导致最后一行被裁剪）
    // A3：父列已有正确比例（0 0 55%）下的 ul、或当前 ul 的 flex 已正确时，仅删坏属性不设 flex:1 1 auto
    result = result.replace(
      /(<ul[^>]*style=")([^"]*)("[^>]*>)/gi,
      (_m: string, pre: string, style: string, post: string) => {
        const props = new Map<string, string>();
        for (const d of parseStyleDeclarations(style)) props.set(d.key, d.value);
        props.delete('height');
        props.delete('width');
        props.delete('max-height');
        props.delete('max-width');
        props.delete('left');
        props.delete('top');
        props.delete('position');
        props.delete('transform');
        if (!props.has('min-height')) props.set('min-height', '0');
        // A3：仅当 flex 为空或明显无效（纯数字无单位的异常值）时才设为 1 1 auto
        const curFlex = (props.get('flex') || '').trim();
        if (!curFlex) {
          props.set('flex', '1 1 auto');
        }
        const ns = Array.from(props.entries())
          .map(([k, v]) => `${k}:${v}`)
          .join(';');
        return `${pre}${ns}${post}`; // A1 修复：pre 已含 <ul
      },
    );

    // 2~4. 把每个 li 变成卡片条（非对比页，li 里有图标+文字 span 对）
    // B3：所有属性缺失时才补默认值，已有值保留不覆盖
    const liPattern =
      /<li([^>]*style=")([^"]*)("[^>]*>\s*)(<span[^>]*style="[^"]*display\s*:\s*inline-flex[^"]*"[^>]*>[\s\S]*?<\/span>)\s*(<span[^>]*style=")([^"]*)("[^>]*>[\s\S]*?<\/span>\s*<\/li>)/gi;
    let safety = 0;
    while (safety++ < 8) {
      const before = result;
      result = result.replace(
        liPattern,
        (_m, liPre, liStyle, liMid, iconSpan, txtPre, txtStyle, txtRest) => {
          // 升级 li 样式：卡片条（B3：已有值优先，缺失才补默认）
          const liProps = new Map<string, string>();
          for (const d of parseStyleDeclarations(liStyle)) liProps.set(d.key, d.value);
          if (!liProps.has('padding')) liProps.set('padding', '20px 24px');
          if (!liProps.has('border-radius')) liProps.set('border-radius', '14px');
          if (!liProps.has('background')) liProps.set('background', CARD_BG);
          if (!liProps.has('border-left')) liProps.set('border-left', `5px solid ${primaryColor}`);
          if (!liProps.has('box-shadow')) liProps.set('box-shadow', CARD_SHADOW);
          if (!liProps.has('gap')) liProps.set('gap', '18px');
          if (!liProps.has('min-width')) liProps.set('min-width', '0');
          const liNew = Array.from(liProps.entries())
            .map(([k, v]) => `${k}:${v}`)
            .join(';');

          // 升级图标 span：28 → 40px（B3：只有值偏小才升级，background / box-shadow 仅缺失才补）
          let newIconSpan = iconSpan.replace(/style="([^"]*)"/i, (_sm: string, is: string) => {
            const ip = new Map<string, string>();
            for (const d of parseStyleDeclarations(is)) ip.set(d.key, d.value);
            let w = parseFloat(ip.get('width') || '0');
            let h = parseFloat(ip.get('height') || '0');
            if (!w || w < 36) ip.set('width', '40px');
            if (!h || h < 36) ip.set('height', '40px');
            if (!ip.has('background'))
              ip.set('background', `linear-gradient(135deg,${primaryColor},${darker})`);
            if (!ip.has('box-shadow')) ip.set('box-shadow', `0 2px 8px ${primaryColor}40`);
            const ni = Array.from(ip.entries())
              .map(([k, v]) => `${k}:${v}`)
              .join(';');
            return `style="${ni}"`;
          });
          // 升级 svg 宽高 15→22px（如果在 20 以下）
          newIconSpan = newIconSpan.replace(
            /svg\s+width="(\d+)"\s+height="(\d+)"/gi,
            (_svm: string, w: string, h: string) => {
              const nw = parseInt(w, 10) < 20 ? 22 : parseInt(w, 10);
              const nh = parseInt(h, 10) < 20 ? 22 : parseInt(h, 10);
              return `svg width="${nw}" height="${nh}"`;
            },
          );

          // 升级文字 span（B3：已有值优先）
          const txtProps = new Map<string, string>();
          for (const d of parseStyleDeclarations(txtStyle)) txtProps.set(d.key, d.value);
          const fs = parseFloat(txtProps.get('font-size') || '0');
          if (!fs || fs < 26) txtProps.set('font-size', '28px');
          if (!txtProps.has('font-weight')) txtProps.set('font-weight', '600');
          if (!txtProps.has('color')) txtProps.set('color', '#111827');
          if (!txtProps.has('line-height')) txtProps.set('line-height', '1.4');
          if (!txtProps.has('flex')) txtProps.set('flex', '1');
          if (!txtProps.has('min-width')) txtProps.set('min-width', '0');
          const txtNew = Array.from(txtProps.entries())
            .map(([k, v]) => `${k}:${v}`)
            .join(';');

          // —— 捕获组复核（FIX-1：2026-08-03 灾难修复）——
          // liPattern = /<li([^>]*style=")([^"]*)("[^>]*>\s*)(<span...inline-flex...>...<\/span>)\s*(<span[^>]*style=")([^"]*)("[^>]*>...<\/span>\s*<\/li>)/
          // 组 1(liPre)   = [^>]*style="     → 例： style=" 或  data-x="y" style="  —— ⚠️不含字面量 <li
          // 组 2(liStyle) = style 内部值
          // 组 3(liMid)   = "[^>]*>\s*       → 例：">
          // 组 4(iconSpan)= 图标 span 全段（含 <span 开标签）
          // 组 5(txtPre)  = <span[^>]*style=" → ⚠️这里又含 <span（字面量在括号里）
          // 组 6(txtStyle)= 文字 span style 值
          // 组 7(txtRest) = "[^>]*>...<\/span>\s*<\/li>
          return `<li${liPre}${liNew}${liMid}${newIconSpan}${txtPre}${txtNew}${txtRest}`;
        },
      );
      if (result === before) break;
    }

    // 5. 文字列容器 justify-content: center → space-evenly
    result = result.replace(
      /(<div[^>]*style="[^"]*display\s*:\s*flex[^"]*flex-direction\s*:\s*column[^"]*min-width\s*:\s*0[^"]*overflow\s*:\s*hidden[^"]*)justify-content\s*:\s*center([^"]*"[^>]*>[\s\S]{0,200}?<ul)/gi,
      (_m, pre, post) => `${pre}justify-content:space-evenly${post}`,
    );

    // 额外：ul gap: 16 → 24
    result = result.replace(
      /(<ul[^>]*style="[^"]*display\s*:\s*flex[^"]*flex-direction\s*:\s*column[^"]*)gap\s*:\s*16px([^"]*")/gi,
      (_m, pre, post) => `${pre}gap:24px${post}`,
    );

    // ===== 新增：卡片条化后自适应压缩，防最后一行裁剪
    // 统计 <li 数量 ≥4 时略微收紧 li padding 和 ul gap
    // 统计 <li 数量 ≥5 时再缩 li 字号 28→25、图标 40→36
    const countMatches = result.match(/<li\s[^>]*style="[^"]*padding\s*:\s*20px\s+24px/gi);
    const liCount = countMatches ? countMatches.length : 0;
    if (liCount >= 4) {
      // padding: 20px 24px → 16px 20px
      result = result.replace(/<li([^>]*style="[^"]*)padding\s*:\s*20px\s+24px\s*;?/gi, (_m, pre) =>
        `${_m.startsWith('<li') ? `<li${pre}padding:16px 20px;` : `${pre}padding:16px 20px;`}`.replace(
          /padding:16px 20px;{2,}/g,
          'padding:16px 20px;',
        ),
      );
      // 修正：直接替换 style 里的 padding 值
      result = result.replace(
        /(<li[^>]*style=")([^"]*?padding\s*:\s*)20px\s+24px\s*;?([^"]*"[^>]*>)/gi,
        (_m, pre, padPre, padPost: string) => `${pre}${padPre}16px 20px;${padPost}`,
      );
      // ul gap 24 → 20
      result = result.replace(
        /(<ul[^>]*style="[^"]*display\s*:\s*flex[^"]*flex-direction\s*:\s*column[^"]*)gap\s*:\s*24px\s*;?([^"]*")/gi,
        (_m, pre, post) => `${pre}gap:20px;${post}`.replace(/gap:20px;{2,}/g, 'gap:20px;'),
      );
    }
    if (liCount >= 5) {
      // li 文字字号 28 → 25
      result = result.replace(
        /(<li[^>]*>[\s\S]{0,400}?<span[^>]*style=")([^"]*?)font-size\s*:\s*28px\s*;?([^"]*"[^>]*>)/gi,
        (_m, pre, _szPre, szPost: string) => `${pre}${_szPre}font-size:25px;${szPost}`,
      );
      // 图标 40 → 36
      result = result.replace(
        /(<li[^>]*>[\s\S]{0,200}?<span[^>]*style=")([^"]*?)width\s*:\s*40px\s*;\s*height\s*:\s*40px\s*;?([^"]*"[^>]*>)/gi,
        (_m, pre, _szPre, szPost: string) => `${pre}${_szPre}width:36px;height:36px;${szPost}`,
      );
    }
    return result;
  }

  /**
   * 建议3：卡片网格页文字/图标比例修正
   * 判定：grid-template-columns:repeat(2或3,1fr) + 4-6 个圆标+h3+p 结构卡片
   * 措施：
   *   1. 圆标 56 → 48px，字号 24→22
   *   2. H3 22→32px，700→800，加渐变文字
   *   3. p 18→24px，400→500，line-height 1.8→1.6
   *   4. padding 32→36
   */
  private enforceCardTextProportion(html: string): string {
    let result = html;
    const hasCardGrid = /grid-template-columns:\s*repeat\(\s*(?:2|3)\s*,\s*1fr\s*\)/i.test(result);
    if (!hasCardGrid) return result;
    const GRAD_TEXT_ANY =
      'background:linear-gradient(135deg,#7c3aed,#5b21b6);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;';

    // 1. 圆标：56x56 → 48x48，字号 24→22
    result = result.replace(
      /<span([^>]*style="[^"]*width\s*:\s*)56px([^"]*height\s*:\s*)56px([^"]*font-size\s*:\s*)24px([^"]*)"/gi,
      (_m, pre, p2, p3, p4) => `<span${pre}48px${p2}48px${p3}22px${p4}"`,
    );

    // 2. H3：22→32，700→800，color 主色改渐变
    result = result.replace(
      /<h3([^>]*style=")([^"]*)("[^>]*>)([\s\S]*?)<\/h3>/gi,
      (_m, pre, style, post, txt) => {
        const props = new Map<string, string>();
        for (const d of parseStyleDeclarations(style)) props.set(d.key, d.value);
        const fs = parseFloat(props.get('font-size') || '22');
        if (fs < 28) props.set('font-size', '32px');
        const fw = parseInt(props.get('font-weight') || '700', 10);
        if (fw < 800) props.set('font-weight', '800');
        props.set('line-height', '1.35');
        // 如有明确的 color:主色 或者没有渐变 fill → 替换成渐变 fill 文字
        const hasGradFill = props.get('-webkit-text-fill-color') === 'transparent';
        const curColor = props.get('color');
        if (!hasGradFill && curColor) {
          // 解析颜色构建渐变
          const cleanCol = curColor.trim();
          const darker = /^#[0-9A-Fa-f]{6}$/.test(cleanCol)
            ? this.darkenPrimaryColor(cleanCol, 0.75)
            : this.darkenPrimaryColor('#7c3aed', 0.75);
          const base = /^#[0-9A-Fa-f]{6}$/.test(cleanCol) ? cleanCol : '#7c3aed';
          props.set('background', `linear-gradient(135deg,${base},${darker})`);
          props.set('-webkit-background-clip', 'text');
          props.set('-webkit-text-fill-color', 'transparent');
          props.set('background-clip', 'text');
          props.delete('color');
        } else if (!hasGradFill && !curColor) {
          // 默认紫渐变
          result.replace(GRAD_TEXT_ANY, () => '');
          props.set('background', 'linear-gradient(135deg,#7c3aed,#5b21b6)');
          props.set('-webkit-background-clip', 'text');
          props.set('-webkit-text-fill-color', 'transparent');
          props.set('background-clip', 'text');
        }
        const ns = Array.from(props.entries())
          .map(([k, v]) => `${k}:${v}`)
          .join(';');
        return `<h3${pre}${ns}${post}${txt}</h3>`;
      },
    );

    // 3. p 18→24，400→500，1.8→1.6
    result = result.replace(
      /<p([^>]*style=")([^"]*)("[^>]*>)([\s\S]*?)<\/p>/gi,
      (_m, pre, style, post, txt) => {
        const props = new Map<string, string>();
        for (const d of parseStyleDeclarations(style)) props.set(d.key, d.value);
        const fs = parseFloat(props.get('font-size') || '18');
        if (fs < 22) props.set('font-size', '24px');
        const fw = parseInt(props.get('font-weight') || '400', 10);
        if (fw < 500) props.set('font-weight', '500');
        const lh = parseFloat(props.get('line-height') || '1.8');
        if (lh >= 1.8 || Number.isNaN(lh)) props.set('line-height', '1.6');
        // color #6B7280 → #374151（更深点）
        if (props.get('color')?.toLowerCase() === '#6b7280') props.set('color', '#374151');
        const ns = Array.from(props.entries())
          .map(([k, v]) => `${k}:${v}`)
          .join(';');
        return `<p${pre}${ns}${post}${txt}</p>`;
      },
    );

    // 4. 卡片 padding:32px → 36px
    result = result.replace(
      /(<div[^>]*style="[^"]*padding\s*:\s*)32px([^"]*border-radius\s*:\s*16px[^"]*grid|grid-template[^"]*padding\s*:\s*)32px/gi,
      (_m, pre, rest) => `${pre}36px${rest}`,
    );
    // 再次：对卡片容器 padding:32 → 36（用更宽松正则）
    result = result.replace(
      /(<div[^>]*style="[^"]*background\s*:\s*#F9FAFB[^"]*border-radius\s*:\s*16px[^"]*)padding\s*:\s*32px([^"]*")/gi,
      (_m, pre, post) => `${pre}padding:36px${post}`,
    );
    // 卡片 gap:16 → 20
    result = result.replace(
      /(<div[^>]*style="[^"]*background\s*:\s*#F9FAFB[^"]*)gap\s*:\s*16px([^"]*")/gi,
      (_m, pre, post) => `${pre}gap:20px${post}`,
    );
    return result;
  }

  private cleanupEmptyContainers(html: string): string {
    let result = html;
    // ============================================================
    // 🛡️ 根本修复（无罪推定）：AI 写了 style 属性的空 div 一律不删。
    // （装饰块/分隔线/绝对定位视觉元素 100% 都带 style，误删概率为 0）
    // 只删除完全无 style 属性或 style 空字符串的空 div（flatten 过程产生的垃圾空容器）
    // ============================================================
    for (let i = 0; i < 3; i++) {
      const before = result;
      result = result.replace(
        /<div(\s+[^>]*)?>\s*<\/div>/gi,
        (match: string, attrs: string | undefined) => {
          const a = (attrs || '').trim();
          // 如果没有 style 属性 → 可以删
          const styleIdx = a.search(/style\s*=/i);
          if (styleIdx === -1) return '';
          // 有 style 属性，提取值；如果值本身是空字符串 → 可以删（垃圾空容器）
          // 允许 style="   " 这种只有空格的空 style
          const styleValMatch =
            a.slice(styleIdx).match(/^style\s*=\s*"([^"]*)"/i) ||
            a.slice(styleIdx).match(/^style\s*=\s*'([^']*)'/i);
          if (!styleValMatch || styleValMatch[1].trim() === '') return '';
          // 否则：有真实 style 内容 → 100% 保留（AI 既然写了 style 就必然有它的用意）
          return match;
        },
      );
      if (result === before) break;
    }
    return result;
  }

  /**
   * 兜底修复1：移除所有列表图标容器上的 margin-top "补丁"
   * 识别特征：inline-flex + flex-shrink:0 + 固定 width/height + border-radius 的组合 span
   * 这些就是列表项的圆形/方形图标容器
   */
  private removeIconMarginTop(html: string): string {
    // 匹配包含核心图标特征的 <span>：inline-flex + flex-shrink:0 + 尺寸/圆角
    return html.replace(/<span([^>]*style="[^"]*"[^>]*)>/gi, (match, attrs) => {
      const styleMatch = attrs.match(/style="([^"]*)"/i);
      if (!styleMatch) return match;
      const style = styleMatch[1];
      // 判断是否为图标容器：必须同时具备 inline-flex + flex-shrink + 宽高/圆角
      const hasInlineFlex =
        /display\s*:\s*inline-flex/i.test(style) || /display\s*:\s*inline-flex/i.test(style);
      const hasFlexShrink = /flex-shrink\s*:\s*0/i.test(style);
      const hasSize = /width\s*:\s*\d+px/i.test(style) && /height\s*:\s*\d+px/i.test(style);
      const hasRadius =
        /border-radius\s*:\s*\d+px/i.test(style) || /border-radius\s*:\s*50%/i.test(style);
      if (!(hasInlineFlex && hasFlexShrink && hasSize && hasRadius)) {
        return match;
      }
      // 是图标容器，移除所有 margin-top 声明
      const styles: Record<string, string> = {};
      for (const { key, value } of parseStyleDeclarations(style)) {
        styles[key] = value;
      }
      delete styles['margin-top'];
      const newStyle = Object.entries(styles)
        .map(([k, v]) => `${k}:${v}`)
        .join(';');
      return match.replace(/style="[^"]*"/i, `style="${newStyle}"`);
    });
  }

  /**
   * 兜底修复2：所有列表项 <li> 的 flex 对齐方式强制改为 align-items:center
   * 不再依赖 align-items:flex-start + margin-top 的"打补丁"方式
   */
  private enforceLiAlignmentCenter(html: string): string {
    return html.replace(/<li([^>]*style="[^"]*"[^>]*)>/gi, (match, attrs) => {
      const styleMatch = attrs.match(/style="([^"]*)"/i);
      if (!styleMatch) return match;
      const style = styleMatch[1];
      // 仅处理用了 flex 布局的 li（即我们的带图标列表）
      if (!/display\s*:\s*flex/i.test(style)) {
        return match;
      }
      const styles: Record<string, string> = {};
      for (const { key, value } of parseStyleDeclarations(style)) {
        styles[key] = value;
      }
      // T6-FR6：作者显式指定 align-items（≠空/≠stretch 默认）时尊重原值，
      // 仅在缺失或 inherit/initial/normal 无意义默认时才补 center，避免把 flex-start 顶对齐的大图标垂直关系打坏。
      const rawAlign = (styles['align-items'] || '').trim().toLowerCase();
      const explicitAlignMeaningful = [
        'flex-start',
        'flex-end',
        'start',
        'end',
        'center',
        'baseline',
        'self-start',
        'self-end',
      ].includes(rawAlign);
      if (!explicitAlignMeaningful) styles['align-items'] = 'center';
      if (!styles['gap']) {
        styles['gap'] = '14px';
      }
      if (!styles['list-style']) {
        styles['list-style'] = 'none';
      }
      const newStyle = Object.entries(styles)
        .map(([k, v]) => `${k}:${v}`)
        .join(';');
      return match.replace(/style="[^"]*"/i, `style="${newStyle}"`);
    });
  }

  /**
   * 兜底修复3：
   *  a) <ul> 移除过大的 line-height(>1.6)，改用 flex-direction:column + gap 控制间距
   *  b) <li> 内的文字 span（紧跟图标 span 之后）强制 line-height:1.4 + flex:1
   * 这样不管大模型怎么写，最终 li 内的图标和文字都能水平中心对齐
   */
  private enforceListAndTextSpanStyles(html: string): string {
    let result = html;

    // (a) 处理 ul：移除过大 line-height，添加 flex column gap
    result = result.replace(/<ul([^>]*style="[^"]*"[^>]*)>/gi, (match, attrs) => {
      const styleMatch = attrs.match(/style="([^"]*)"/i);
      if (!styleMatch) {
        // 没有 style，补一个标准的
        return `<ul${attrs} style="margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:16px;min-width:0;">`;
      }
      const style = styleMatch[1];
      const styles: Record<string, string> = {};
      for (const { key, value } of parseStyleDeclarations(style)) {
        styles[key] = value;
      }
      // 清理过大的 line-height
      if (styles['line-height']) {
        const lh = parseFloat(styles['line-height']);
        if (!isNaN(lh) && lh > 1.6) {
          delete styles['line-height'];
        }
      }
      // 统一 list style 和 flex 布局间距
      if (!styles['list-style']) styles['list-style'] = 'none';
      if (!styles['margin']) styles['margin'] = '0';
      if (!styles['padding']) styles['padding'] = '0';
      if (!styles['display']) {
        styles['display'] = 'flex';
        styles['flex-direction'] = 'column';
        styles['gap'] = '16px';
      }
      if (!styles['min-width']) styles['min-width'] = '0';
      const newStyle = Object.entries(styles)
        .map(([k, v]) => `${k}:${v}`)
        .join(';');
      return match.replace(/style="[^"]*"/i, `style="${newStyle}"`);
    });

    // (b) 处理 li 内：紧跟图标 span 之后的文字 span
    // 图标 span 的识别特征（不依赖 CSS 属性顺序）：
    //   - 存在 display:inline-flex
    //   - 存在 flex-shrink:0
    //   - 有 width/height 尺寸（配合 removeIconMarginTop 的特征）
    const iconSpanPattern = (flags: string = '') =>
      new RegExp(
        '<span([^>]*style="(?=[^"]*display\\s*:\\s*inline-flex)(?=[^"]*flex-shrink\\s*:\\s*0)[^"]*"[^>]*)>[\\s\\S]*?</span>',
        flags,
      );

    // 先用完整模式（li > iconSpan + textSpan）匹配
    // 捕获分组：
    //   $1 = liAttrs
    //   $2 = 整个 iconSpan（含前后空白）
    //   $3 = iconSpanAttrs（iconSpan 内部的捕获组，我们不需要）
    //   $4 = textSpanAttrs（真正的文字 span 属性，必须取这个）
    const combinedPattern = new RegExp(
      '<li([^>]*)>(\\s*' + iconSpanPattern().source + ')\\s*<span([^>]*)>',
      'gi',
    );
    result = result.replace(
      combinedPattern,
      (_match, liAttrs, iconSpan, _iconSpanAttrsUnused, textSpanAttrs) => {
        // 给文字 span 补 style：line-height:1.4 和 flex:1
        let newTextSpanAttrs = textSpanAttrs;
        const styleMatch = newTextSpanAttrs.match(/style="([^"]*)"/i);
        const styles: Record<string, string> = {};
        if (styleMatch) {
          for (const { key, value } of parseStyleDeclarations(styleMatch[1])) {
            styles[key] = value;
          }
        }
        if (!styles['line-height']) styles['line-height'] = '1.4';
        if (!styles['flex']) styles['flex'] = '1';
        const newStyle = Object.entries(styles)
          .map(([k, v]) => `${k}:${v}`)
          .join(';');
        if (styleMatch) {
          newTextSpanAttrs = newTextSpanAttrs.replace(/style="[^"]*"/i, `style="${newStyle}"`);
        } else {
          newTextSpanAttrs = `${newTextSpanAttrs} style="${newStyle}"`;
        }
        return `<li${liAttrs}>${iconSpan}<span${newTextSpanAttrs}>`;
      },
    );

    return result;
  }

  private ensureImageRatio(html: string, plan: SlidePlan): string {
    const expectedRatio = plan.imageRatio || PAGE_TYPE_DEFAULT_IMAGE_RATIO[plan.pageType];
    if (!expectedRatio) return html;
    return html.replace(/<img([^>]*)>/gi, (match, attrs) => {
      if (attrs.includes('data-image-ratio')) return match;
      return `<img${attrs} data-image-ratio="${expectedRatio}">`;
    });
  }

  private sanitizeSlideHtml(html: string): string {
    if (!html || !html.trim()) {
      return '<div style="width:100%;height:100%;overflow:hidden;position:relative;box-sizing:border-box;padding:48px 60px;display:flex;align-items:center;justify-content:center;"><p style="font-size:24px;color:#999;">空幻灯片</p></div>';
    }
    let result = html.trim();
    result = result.replace(/<script[\s\S]*?<\/script>/gi, '');
    result = result.replace(/<style[\s\S]*?<\/style>/gi, '');
    result = result.replace(/on\w+="[^"]*"/gi, '');
    result = result.replace(/on\w+='[^']*'/gi, '');
    result = this.wrapTextNodes(result);
    result = this.flattenMeaninglessNesting(result);
    result = this.ensureSemanticWrapping(result);
    return result;
  }

  private flattenMeaninglessNesting(html: string): string {
    const self = this;
    let result = html;
    let iterations = 0;
    const maxIterations = 10;
    // FR-1a: 扩展为"视觉属性 + 布局约束"双重判定——margin/overflow/flex/显式宽高/padding
    // 等布局关键属性存在时，容器不可被 flatten 错误剥离（slide-04 图片容器 margin-top:32px 被吞的直接修复）
    const hasVisualStyleOrLayoutConstraint = (styleAttr: string): boolean => {
      const lower = styleAttr.toLowerCase();
      // --- 原有视觉属性判定（完全保留）---
      const hasVisual =
        (lower.includes('background') &&
          (lower.includes('color') || lower.includes('image') || lower.includes('gradient'))) ||
        lower.includes('border') ||
        lower.includes('box-shadow') ||
        lower.includes('border-radius');
      if (hasVisual) return true;
      // --- 新增：影响布局/间距/溢出的关键约束（RC-1 修复）---
      const hasMargin =
        /(^|;)\s*margin\s*:\s*[^;]*\d/i.test(lower) ||
        /(^|;)\s*margin-(top|bottom|left|right)\s*:/i.test(lower);
      const hasPadding =
        /(^|;)\s*padding\s*:\s*[^;]*\d/i.test(lower) ||
        /(^|;)\s*padding-(top|bottom|left|right)\s*:/i.test(lower);
      const hasOverflow = /(^|;)\s*overflow(-[xy])?\s*:/i.test(lower);
      const hasFlex = /(^|;)\s*flex(-(grow|shrink|basis))?\s*:/i.test(lower);
      const hasAspectRatio = /(^|;)\s*aspect-ratio\s*:/i.test(lower);
      const sizeRe = /(^|;)\s*(width|height)\s*:\s*([^;]+)/gi;
      let hasExplicitSize = false;
      let sm: RegExpExecArray | null;
      while ((sm = sizeRe.exec(lower)) !== null) {
        const v = (sm[3] || '').trim().toLowerCase();
        if (!v) continue;
        if (
          v === 'auto' ||
          v === 'inherit' ||
          v === 'initial' ||
          v === 'unset' ||
          v === 'fit-content' ||
          v === 'max-content' ||
          v === 'min-content'
        )
          continue;
        if (/\d/.test(v)) {
          hasExplicitSize = true;
          break;
        }
      }
      return hasMargin || hasPadding || hasOverflow || hasFlex || hasAspectRatio || hasExplicitSize;
    };
    const getStyleAttr = (tag: string): string => {
      const match = tag.match(/style="([^"]*)"/i);
      return match ? match[1] : '';
    };
    const hasOnlyOneChild = (
      innerContent: string,
    ): { onlyChild: boolean; childTag?: string; childFull?: string } => {
      const trimmed = innerContent.trim();
      if (!trimmed) return { onlyChild: false };
      const firstTagMatch = trimmed.match(/^<([a-zA-Z0-9]+)(\s[^>]*)?>/);
      if (!firstTagMatch) return { onlyChild: false };
      const childTag = firstTagMatch[1].toLowerCase();
      const isSelfClosing =
        firstTagMatch[0].endsWith('/>') || ['br', 'img', 'hr', 'input'].includes(childTag);
      if (isSelfClosing) {
        const rest = trimmed.slice(firstTagMatch[0].length).trim();
        return { onlyChild: rest.length === 0, childTag, childFull: firstTagMatch[0] };
      }
      const closingTag = `</${childTag}>`;
      const closingIndex = self.findClosingTagIndex(trimmed, childTag);
      if (closingIndex === -1) return { onlyChild: false };
      const before = trimmed.slice(0, firstTagMatch.index).trim();
      const after = trimmed.slice(closingIndex + closingTag.length).trim();
      if (before.length === 0 && after.length === 0) {
        return {
          onlyChild: true,
          childTag,
          childFull: trimmed.slice(0, closingIndex + closingTag.length),
        };
      }
      return { onlyChild: false };
    };
    const flattenOnce = (htmlStr: string): string => {
      const divRegex = /<(div|section|article)(\s[^>]*)?>([\s\S]*?)<\/\1>/gi;
      return htmlStr.replace(divRegex, (match, tag, attrs, innerContent) => {
        // F6：母版层（class="noppt-master-layer"）整体豁免 flatten，避免 header/logo 容器被折叠裸出
        if (/class\s*=\s*["'][^"']*noppt-master-layer/i.test(attrs || '')) return match;
        const styleAttr = getStyleAttr(match);
        if (hasVisualStyleOrLayoutConstraint(styleAttr)) {
          const innerFlattened = flattenOnce(innerContent);
          return innerFlattened === innerContent
            ? match
            : `<${tag}${attrs || ''}>${innerFlattened}</${tag}>`;
        }
        const childInfo = hasOnlyOneChild(innerContent);
        if (!childInfo.onlyChild || !childInfo.childTag) {
          const innerFlattened = flattenOnce(innerContent);
          return innerFlattened === innerContent
            ? match
            : `<${tag}${attrs || ''}>${innerFlattened}</${tag}>`;
        }
        // FR-1b: 图片包裹保护——直接子代是 <img> 时，无论容器是否有样式，均不剥离外层
        // （图片包裹对 flex:column / grid 等布局至关重要，丢掉外层会让 height:100% 挤爆画布）
        if (childInfo.childTag === 'img') {
          const innerFlattened = flattenOnce(innerContent);
          return innerFlattened === innerContent
            ? match
            : `<${tag}${attrs || ''}>${innerFlattened}</${tag}>`;
        }
        if (
          ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'span', 'ul', 'ol', 'table'].includes(
            childInfo.childTag,
          )
        ) {
          return childInfo.childFull!;
        }
        const innerFlattened = flattenOnce(innerContent);
        return innerFlattened === innerContent
          ? match
          : `<${tag}${attrs || ''}>${innerFlattened}</${tag}>`;
      });
    };
    do {
      const before = result;
      result = flattenOnce(result);
      iterations++;
      if (result === before) break;
    } while (iterations < maxIterations);
    return result;
  }

  /**
   * ensureSemanticWrapping —— 裸文本兜底 · 终极防线（基于栈的深度优先扫描）
   *
   * 处理对象：wrapTextNodes / flattenMeaninglessNesting 之后仍残留的裸文本。
   * 典型触发路径：
   *   - 容器内的文本行直接出现在 h2 之后、且没有任何 <div> 包裹（正则 replaceTextInDiv 无法触及）
   *   - <ul> 同级兄弟裸文本
   *   - 深度嵌套后被 flatten 露出来的裸文本
   *
   * 算法思路：
   *   1. 建立"文本容器"集合 textTags（进入后，内部字符一律视为安全，不再扫描是否裸文本）
   *   2. 建立"布局容器"集合 containerTags（进入后，内部的直接文本字符视为"裸文本"需要处理）
   *   3. 逐字符扫描 + 栈。每遇到开/关标签压/弹栈；遇到字符时，若当前顶层是 container → 进入裸文本缓冲，
   *      否则直接拼入输出。当遇到下一个子标签或当前 container 关标签时，flush 裸文本缓冲 → 按换行拆分成多行 <p>。
   */
  /**
   * 裸文本兜底时构造 <p> 的 style：优先从父容器 openTagFull/style 继承字号/颜色/字距/行高/字重，
   * 仅当父容器无任何可继承排版属性时才回落 DEFAULT_P_STYLE（font-size:24px;color:#374151;...），
   * 避免写死默认值覆盖 LLM 设定的设计（如 kicker 的 16px / 参考色 / letter-spacing）。
   */
  private composeInheritedPStyle(parentStyle?: string): string {
    if (!parentStyle)
      return 'font-size:24px;color:#374151;font-weight:600;line-height:2.0;overflow-wrap:break-word;word-break:break-word;';
    const grab = (re: RegExp): string | undefined => {
      const m = re.exec(parentStyle);
      return m ? m[1].trim() : undefined;
    };
    const fs = grab(/font-size\s*:\s*([^;"}]+)/i);
    const fc = grab(/(?:^|[^-])color\s*:\s*([^;"}]+)/i);
    const ls = grab(/letter-spacing\s*:\s*([^;"}]+)/i);
    const lh = grab(/line-height\s*:\s*([^;"}]+)/i);
    const fw = grab(/font-weight\s*:\s*([^;"}]+)/i);
    const parts = ['margin:0;'];
    if (fs) parts.push(`font-size:${fs};`);
    if (fc) parts.push(`color:${fc};`);
    if (ls) parts.push(`letter-spacing:${ls};`);
    if (lh) parts.push(`line-height:${lh};`);
    if (fw) parts.push(`font-weight:${fw};`);
    return parts.length > 1
      ? parts.join('')
      : 'font-size:24px;color:#374151;font-weight:600;line-height:2.0;overflow-wrap:break-word;word-break:break-word;';
  }

  private ensureSemanticWrapping(html: string): string {
    if (!html) return html;
    // "文本安全容器"——进入这些标签内部后，内部字符不再视为裸文本。
    // 注意：这里不包含 span/a/strong 等 inline，因为它们作为"裸文本字符"处理时，
    // inline 标签本身会被拼入裸文本缓冲（和相邻字符一起包一层 p）。
    const TEXT_TAGS = new Set([
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'p',
      'li',
      'figcaption',
      'td',
      'th',
      'label',
      'button',
      'pre',
      'code',
      'blockquote',
      'sup',
      'sub',
      'textarea',
      'option',
      'title',
      'style',
      'script',
      'noscript',
    ]);
    // "布局容器"——它们的**直接子节点中出现的可见字符** = 裸文本，必须处理
    const CONTAINER_TAGS = new Set([
      'div',
      'section',
      'article',
      'aside',
      'nav',
      'main',
      'header',
      'footer',
      'body',
      'figure',
      'ul',
      'ol',
      'table',
      'thead',
      'tbody',
      'tfoot',
      'tr',
      'form',
      'details',
      'summary',
    ]);

    interface StackFrame {
      tagName: string;
      openTagFull: string; // 原始的开标签字符串（含属性），最后拼回去
      inTextContext: boolean; // 该 frame 本身或其祖先中存在 text 标签 → 全局 text 上下文
      pendingBare: string; // 累积的裸文本缓冲（仅当 frame.isContainer 时有用）
      isContainer: boolean; // 是否 CONTAINER_TAGS 之一（决定是否要在弹栈时处理 pendingBare）
      innerBuffer: string; // 已经处理完的子内容（用于在弹栈时一次性组装：openTag + processedContent + closeTag）
      isBadgeContainer: boolean; // === 修复 D：该容器本身就是 Badge/胶囊（inline-flex+padding+radius 999px），内部字符视为安全文本，不包 p
    }

    // 判断：一个开标签里的 style 是否足以证明它就是"Badge/胶囊 容器"
    const isBadgeStyle = (openTagFull: string): boolean => {
      const sm = openTagFull.match(/style="([^"]*)"/i);
      if (!sm) return false;
      const s = sm[1];
      const hasInlineFlex = /display\s*:\s*(?:inline-flex|flex)\b/i.test(s);
      const hasBadgePadding =
        /padding\s*:[^;]*(?:1[0-9]px\s+2[0-9]px|10px\s+28px|12px\s+24px)\b/i.test(s);
      const hasRadius999 = /border-radius\s*:[^;]*999px/i.test(s);
      const hasBgTint =
        /background\s*:[^;]*(?:#[0-9a-f]{6,8}1[0-9a-f]|rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*0\.0[5-9])/i.test(
          s,
        );
      // 命中 3/4 以上特征，认定是 Badge 容器（避免误判普通 flex div）
      const score = [hasInlineFlex, hasBadgePadding, hasRadius999, hasBgTint].filter(
        Boolean,
      ).length;
      return score >= 3;
    };

    // 准备栈，先塞一个"根虚拟帧"
    const stack: StackFrame[] = [
      {
        tagName: '__root__',
        openTagFull: '',
        inTextContext: false,
        pendingBare: '',
        isContainer: false,
        innerBuffer: '',
        isBadgeContainer: false,
      },
    ];

    // flushBare: 把当前帧的 pendingBare 处理成若干 <p>，append 到当前帧的 innerBuffer
    // 保真度修复：<p> 从父容器继承字号/颜色/字距/行高/字重（若父容器带显式排版属性），
    // 仅在无任何可继承信息时回落 DEFAULT_P_STYLE，避免写死 24px/2.0/#374151 覆盖原设计。
    const flushBare = (frame: StackFrame) => {
      if (!frame.pendingBare) return;
      // 拆分：按换行；每行 trim 后非空 → 包一层 <p>；空行丢弃（视觉上等于没内容）
      const lines = frame.pendingBare.split(/\r?\n/);
      const pStyle = this.composeInheritedPStyle(frame.openTagFull);
      let generated = '';
      for (const raw of lines) {
        const t = raw.trim();
        if (!t) continue;
        // 如果这一行里本身就带 <img>/<span>/<strong> 等 inline 元素，直接整行拼进 <p> 内部
        generated += `<p style="${pStyle}">${t}</p>`;
      }
      frame.innerBuffer += generated;
      frame.pendingBare = '';
    };

    let i = 0;
    const n = html.length;
    while (i < n) {
      if (html[i] === '<') {
        // ———— 分支 A：HTML 标签 / 注释 / CDATA / DOCTYPE ————
        // A0. 2025-07 R3 P2 修复：<svg...> 整块视为「原始保留区」，不入栈、不包 p、不做裸文本处理。
        //     SVG 子元素（<line>/<path>/<circle> 等）如果被 ensureSemanticWrapping 按容器裸文本
        //     判定 → 会被包一层 DEFAULT_P_STYLE <p>，Slide-03 卡片会因此出现大量畸形嵌套 + 空节点。
        //     直接取 `</svg>` 闭位置，整段原样 append 到当前帧 innerBuffer 后 i 跳过去。
        if (/^<svg[\s>]/i.test(html.slice(i, i + 20))) {
          const lower = html.toLowerCase();
          const openTagEnd = lower.indexOf('>', i);
          if (openTagEnd === -1) {
            i++;
            continue;
          }
          // self-closing <svg ... />（极少见，但防御）
          if (html[openTagEnd - 1] === '/') {
            const top = stack[stack.length - 1];
            if (!top.inTextContext && !top.isBadgeContainer && top.isContainer) flushBare(top);
            top.innerBuffer += html.slice(i, openTagEnd + 1);
            i = openTagEnd + 1;
            continue;
          }
          const closeTag = '</svg>';
          let depth = 1;
          let pos = openTagEnd + 1;
          while (pos < lower.length && depth > 0) {
            const nextOpen = lower.indexOf('<svg', pos);
            const nextClose = lower.indexOf(closeTag, pos);
            if (nextClose === -1) break;
            if (nextOpen !== -1 && nextOpen < nextClose) {
              const after = lower.indexOf('>', nextOpen);
              if (after !== -1 && lower[after - 1] !== '/') depth++;
              pos = after === -1 ? nextClose + closeTag.length : after + 1;
            } else {
              depth--;
              if (depth === 0) {
                const blockEnd = nextClose + closeTag.length;
                const top = stack[stack.length - 1];
                if (!top.inTextContext && !top.isBadgeContainer && top.isContainer) flushBare(top);
                top.innerBuffer += html.slice(i, blockEnd);
                i = blockEnd;
                break;
              }
              pos = nextClose + closeTag.length;
            }
          }
          // 没找到配对（depth 还 >0）兜底：只把开标签当文本字符处理（避免死循环）
          if (depth > 0) {
            const top = stack[stack.length - 1];
            if (top.inTextContext || !top.isContainer) top.innerBuffer += html[i];
            else top.pendingBare += html[i];
            i++;
          }
          continue;
        }
        // A1. 注释 <!-- -->
        if (html.startsWith('<!--', i)) {
          const end = html.indexOf('-->', i);
          const j = end === -1 ? n : end + 3;
          const top = stack[stack.length - 1];
          if (top.inTextContext || !top.isContainer) {
            top.innerBuffer += html.slice(i, j);
          } else {
            // 容器内的注释：先 flush 累积的裸文本，注释作为 block 直接 append 到 innerBuffer
            flushBare(top);
            top.innerBuffer += html.slice(i, j);
          }
          i = j;
          continue;
        }
        // A2. CDATA
        if (html.startsWith('<![CDATA[', i)) {
          const end = html.indexOf(']]>', i);
          const j = end === -1 ? n : end + 3;
          stack[stack.length - 1].innerBuffer += html.slice(i, j);
          i = j;
          continue;
        }
        // A3. <!DOCTYPE / <?xml 等
        if (html.startsWith('<!', i) || html.startsWith('<?', i)) {
          const end = html.indexOf('>', i);
          const j = end === -1 ? n : end + 1;
          stack[stack.length - 1].innerBuffer += html.slice(i, j);
          i = j;
          continue;
        }
        // A4. 正规标签：找到 tagEnd，解析 tagName、isClosing、isSelfClosing
        const tagEnd = html.indexOf('>', i);
        if (tagEnd === -1) {
          // 无结尾 '>'，视为普通字符
          const top = stack[stack.length - 1];
          if (top.inTextContext || !top.isContainer) top.innerBuffer += html[i];
          else top.pendingBare += html[i];
          i++;
          continue;
        }
        const tagFull = html.slice(i, tagEnd + 1);
        const tagMatch = tagFull.match(/^<\/?([a-zA-Z0-9]+)/);
        if (!tagMatch) {
          // 不认识的 <xxx>（非正常 tag 名字）→ 视为文本
          const top = stack[stack.length - 1];
          if (top.inTextContext || !top.isContainer) top.innerBuffer += tagFull;
          else top.pendingBare += tagFull;
          i = tagEnd + 1;
          continue;
        }
        const tagName = tagMatch[1].toLowerCase();
        const isClosing = tagFull[1] === '/';
        // self-closing：显式写成 />，或单例标签
        const selfClosingSingleton = new Set([
          'br',
          'img',
          'hr',
          'input',
          'meta',
          'link',
          'wbr',
          'area',
          'base',
          'col',
          'embed',
          'source',
          'track',
        ]);
        const isSelfClosing = tagFull.endsWith('/>') || selfClosingSingleton.has(tagName);

        if (isSelfClosing) {
          const top = stack[stack.length - 1];
          // self-closing：若在容器内，先把已有的裸文本 flush，再追加该元素
          if (!top.inTextContext && top.isContainer) {
            flushBare(top);
          }
          top.innerBuffer += tagFull;
          i = tagEnd + 1;
          continue;
        }

        if (!isClosing) {
          // ———— 开标签：压栈 ————
          const top = stack[stack.length - 1];
          // 进入新标签前：如当前处于"容器内且有裸文本"，先 flush
          if (!top.inTextContext && !top.isBadgeContainer && top.isContainer) {
            flushBare(top);
          }
          // === 修复 D：Badge 容器本身视作 text 上下文（不包 p），且也不是"需处理裸文本的容器" ===
          const badged = isBadgeStyle(tagFull);
          const inTextContext =
            top.inTextContext || TEXT_TAGS.has(tagName) || badged || top.isBadgeContainer;
          const isContainer = !inTextContext && CONTAINER_TAGS.has(tagName);
          const frame: StackFrame = {
            tagName,
            openTagFull: tagFull,
            inTextContext,
            pendingBare: '',
            isContainer,
            innerBuffer: '',
            isBadgeContainer: badged || top.isBadgeContainer, // 子节点也继承 Badge 上下文（防 badge 内再嵌套容器又误包 p）
          };
          stack.push(frame);
          i = tagEnd + 1;
          continue;
        } else {
          // ———— 关标签：弹栈并组装内容 ————
          // 找到匹配的栈帧（最近的 tagName 相同的 frame；若没找到就只跳过当前 tagFull）
          let popIdx = -1;
          for (let k = stack.length - 1; k >= 1; k--) {
            if (stack[k].tagName === tagName) {
              popIdx = k;
              break;
            }
          }
          if (popIdx === -1) {
            // 无匹配的开标签：把关标签当作普通字符处理
            const top = stack[stack.length - 1];
            if (top.inTextContext || !top.isContainer) top.innerBuffer += tagFull;
            else top.pendingBare += tagFull;
            i = tagEnd + 1;
            continue;
          }
          // 弹出 popIdx 之后的所有 frame（嵌套不一致时尽力而为保留内容）
          const popped = stack.splice(popIdx)[0];
          // 弹栈前先 flush 该 frame 里累积的裸文本
          if (popped.isContainer && !popped.isBadgeContainer) flushBare(popped);
          // 组装：openTagFull + 已处理的 innerBuffer + 关标签
          const closing = `</${popped.tagName}>`;
          const assembled = popped.openTagFull + popped.innerBuffer + closing;
          // 把组装结果 append 到新的栈顶
          const newTop = stack[stack.length - 1];
          if (!newTop.inTextContext && !newTop.isBadgeContainer && newTop.isContainer) {
            // 上层也是容器：裸文本先 flush 再 append block
            flushBare(newTop);
          }
          newTop.innerBuffer += assembled;
          i = tagEnd + 1;
          continue;
        }
      } else {
        // ———— 分支 B：普通文本字符 ————
        const top = stack[stack.length - 1];
        // === 修复 D：Badge 容器内的字符永远当安全文本（不进 pendingBare，不包 p） ===
        if (top.inTextContext || top.isBadgeContainer || !top.isContainer) {
          top.innerBuffer += html[i];
        } else {
          // 当前帧是"容器"且不在 text 上下文 → 字符视为裸文本
          top.pendingBare += html[i];
        }
        i++;
      }
    }
    // 循环结束：还留在栈里的 frame（标签匹配不完整时的兜底）→ 全部逐级合入根
    while (stack.length > 1) {
      const popped = stack.pop()!;
      if (popped.isContainer) flushBare(popped);
      const assembled =
        popped.openTagFull +
        popped.innerBuffer +
        (popped.tagName !== '__root__' ? `</${popped.tagName}>` : '');
      stack[stack.length - 1].innerBuffer += assembled;
    }
    // 最后处理 root 的残余裸文本（理论上不该发生，但兜底以防万一）
    if (stack[0].isContainer) flushBare(stack[0]);
    return stack[0].innerBuffer;
  }

  private findClosingTagIndex(html: string, tagName: string): number {
    const lower = html.toLowerCase();
    const openTag = `<${tagName.toLowerCase()}`;
    const closeTag = `</${tagName.toLowerCase()}>`;
    let depth = 0;
    const firstOpen = lower.indexOf(openTag);
    if (firstOpen === -1) return -1;
    let i = lower.indexOf('>', firstOpen) + 1;
    depth = 1;
    while (i < lower.length && depth > 0) {
      const nextOpen = lower.indexOf(openTag, i);
      const nextClose = lower.indexOf(closeTag, i);
      if (nextClose === -1) break;
      if (nextOpen !== -1 && nextOpen < nextClose) {
        const tagEnd = lower.indexOf('>', nextOpen);
        if (lower[tagEnd - 1] !== '/') depth++;
        i = tagEnd + 1;
      } else {
        depth--;
        if (depth === 0) return nextClose;
        i = nextClose + closeTag.length;
      }
    }
    return -1;
  }

  /**
   * B2：栈式扫描，获取某 HTML 片段的「第一层直接子元素」（不含孙节点、不含文本、不含注释）。
   * 用于 enforceLeftRight5545AndCardBar 的角色判定，避免 rawTail.substring(0,N) 粗扫描
   * 把孙节点的 <ul>/<img> 误判成当前 div 的直接子节点，从而错判列归属角色。
   */
  private findDirectChildElements(
    html: string,
  ): Array<{ tagName: string; styleAttr: string | null; innerPreview: string | null }> {
    const result: Array<{
      tagName: string;
      styleAttr: string | null;
      innerPreview: string | null;
    }> = [];
    if (!html) return result;
    const SINGLETON = new Set([
      'br',
      'img',
      'hr',
      'input',
      'meta',
      'link',
      'wbr',
      'area',
      'base',
      'col',
      'embed',
      'source',
      'track',
    ]);
    const n = html.length;
    let i = 0;
    while (i < n) {
      if (html[i] !== '<') {
        i++;
        continue;
      }
      // 跳过注释
      if (html.startsWith('<!--', i)) {
        const end = html.indexOf('-->', i);
        i = end === -1 ? n : end + 3;
        continue;
      }
      // 跳过 CDATA / DOCTYPE / <?xml 等
      if (html.startsWith('<![CDATA[', i) || html.startsWith('<!', i) || html.startsWith('<?', i)) {
        const end = html.indexOf('>', i);
        i = end === -1 ? n : end + 1;
        continue;
      }
      const tagEnd = html.indexOf('>', i);
      if (tagEnd === -1) break;
      const tagFull = html.slice(i, tagEnd + 1);
      // 只处理顶层打开标签（闭合标签直接跳过不加入 result）
      if (tagFull[1] === '/') {
        i = tagEnd + 1;
        continue;
      }
      const tagMatch = tagFull.match(/^<\s*([a-zA-Z0-9]+)/);
      if (!tagMatch) {
        i = tagEnd + 1;
        continue;
      }
      const tagName = tagMatch[1].toLowerCase();
      const isSelfClosing = tagFull.endsWith('/>') || SINGLETON.has(tagName);
      // 提取 style 属性（若无则 null）
      const styleMatch = tagFull.match(/\sstyle\s*=\s*"([^"]*)"/i);
      const styleAttr = styleMatch ? styleMatch[1] : null;
      let innerPreview: string | null = null;
      if (isSelfClosing) {
        result.push({ tagName, styleAttr, innerPreview: null });
        i = tagEnd + 1;
        continue;
      }
      // 找匹配闭合（只截取内部 preview，不遍历孙节点）
      // 使用 findClosingTagIndex 的思路，但从 i 开始，depth=1
      const openTagSeq = `<${tagName}`;
      const closeTagSeq = `</${tagName}>`;
      const lower = html.toLowerCase();
      let depth = 1;
      let j = tagEnd + 1;
      let closeIdx = -1;
      const previewStart = tagEnd + 1;
      while (j < n && depth > 0) {
        const no = lower.indexOf(openTagSeq, j);
        const nc = lower.indexOf(closeTagSeq, j);
        if (nc === -1) break;
        if (no !== -1 && no < nc) {
          const te = lower.indexOf('>', no);
          if (te !== -1 && lower[te - 1] !== '/' && !SINGLETON.has(tagName)) {
            // 必须是与 tagName 完全相同的（用 <tagName xxx> 精确匹配，非子串）
            const reExact = new RegExp(`^<${tagName.toLowerCase()}(\\s|>|/)`, 'i');
            if (reExact.test(lower.substring(no))) depth++;
          }
          j = te === -1 ? nc : te + 1;
        } else {
          depth--;
          if (depth === 0) {
            closeIdx = nc;
            break;
          }
          j = nc + closeTagSeq.length;
        }
      }
      if (closeIdx >= 0) {
        const innerLen = Math.min(closeIdx - previewStart, 300);
        innerPreview = innerLen > 0 ? html.substring(previewStart, previewStart + innerLen) : '';
        // 直接子节点处理完成，跳到闭合之后继续处理下一个兄弟
        i = closeIdx + closeTagSeq.length;
      } else {
        // 找不到闭合，兜底：截取 previewStart 后 300 字符作为预览
        innerPreview = html.substring(previewStart, Math.min(previewStart + 300, n));
        i = tagEnd + 1;
      }
      result.push({ tagName, styleAttr, innerPreview });
    }
    return result;
  }

  private wrapTextNodes(html: string): string {
    let result = html;
    const processContainer = (content: string, parentStyle?: string): string => {
      const segments: Array<{ type: 'text' | 'block' | 'inline'; content: string }> = [];
      let buffer = '';
      let i = 0;
      while (i < content.length) {
        if (content[i] === '<') {
          // ===== 新增：优先识别注释块 <!---->、CDATA <![CDATA[...]]>、DOCTYPE/XML 声明 <!...> =====
          // 这些"非正规 tag"被识别为独立 block segment，不进入文本缓冲，避免污染/打断裸文本行
          if (content.startsWith('<!--', i)) {
            const endIdx = content.indexOf('-->', i);
            const j = endIdx === -1 ? content.length : endIdx + 3;
            if (buffer.trim()) {
              segments.push({ type: 'text', content: buffer });
              buffer = '';
            }
            segments.push({ type: 'block', content: content.slice(i, j) });
            i = j;
            continue;
          }
          if (content.startsWith('<![CDATA[', i)) {
            const endIdx = content.indexOf(']]>', i);
            const j = endIdx === -1 ? content.length : endIdx + 3;
            if (buffer.trim()) {
              segments.push({ type: 'text', content: buffer });
              buffer = '';
            }
            segments.push({ type: 'block', content: content.slice(i, j) });
            i = j;
            continue;
          }
          if (content.startsWith('<!', i)) {
            const endIdx = content.indexOf('>', i);
            const j = endIdx === -1 ? content.length : endIdx + 1;
            if (buffer.trim()) {
              segments.push({ type: 'text', content: buffer });
              buffer = '';
            }
            segments.push({ type: 'block', content: content.slice(i, j) });
            i = j;
            continue;
          }
          // ===== 注释识别结束 =====
          const tagEnd = content.indexOf('>', i);
          if (tagEnd === -1) {
            buffer += content.slice(i);
            break;
          }
          const tagFull = content.slice(i, tagEnd + 1);
          const tagMatch = tagFull.match(/^<\/?([a-zA-Z0-9]+)/);
          if (!tagMatch) {
            buffer += content[i];
            i++;
            continue;
          }
          const tagName = tagMatch[1].toLowerCase();
          const isClosing = tagFull[1] === '/';
          const isSelfClosing =
            tagFull[tagFull.length - 2] === '/' || ['br', 'img', 'hr', 'input'].includes(tagName);
          const isInline = [
            'span',
            'strong',
            'em',
            'b',
            'i',
            'u',
            'a',
            'br',
            'sup',
            'sub',
            'font',
          ].includes(tagName);
          const isBlock = [
            'h1',
            'h2',
            'h3',
            'h4',
            'h5',
            'h6',
            'p',
            'ul',
            'ol',
            'li',
            'div',
            'section',
            'article',
            'table',
            'blockquote',
            'img',
            'video',
            'figure',
            'figcaption',
            'pre',
            'code',
          ].includes(tagName);
          if (isInline || isSelfClosing) {
            if (isSelfClosing && !isInline) {
              if (buffer.trim()) {
                segments.push({ type: 'text', content: buffer });
                buffer = '';
              }
              segments.push({ type: 'block', content: tagFull });
            } else {
              buffer += tagFull;
            }
            i = tagEnd + 1;
          } else if (isBlock && !isClosing) {
            let depth = 1,
              j = tagEnd + 1;
            while (j < content.length && depth > 0) {
              if (content[j] === '<') {
                // ===== 新增：嵌套匹配时也要跳过注释 =====
                if (content.startsWith('<!--', j)) {
                  const endIdx = content.indexOf('-->', j);
                  j = endIdx === -1 ? content.length : endIdx + 3;
                  continue;
                }
                const nt = content.indexOf('>', j);
                if (nt === -1) break;
                const nm = content.slice(j, nt + 1).match(/^<\/?([a-zA-Z0-9]+)/);
                if (nm && nm[1].toLowerCase() === tagName) {
                  if (content[j + 1] === '/') depth--;
                  else if (content[nt - 1] !== '/') depth++;
                }
                j = nt + 1;
              } else j++;
            }
            if (buffer.trim()) {
              segments.push({ type: 'text', content: buffer });
              buffer = '';
            }
            segments.push({ type: 'block', content: content.slice(i, j) });
            i = j;
          } else if (isBlock && isClosing) {
            if (buffer.trim()) {
              segments.push({ type: 'text', content: buffer });
              buffer = '';
            }
            segments.push({ type: 'block', content: tagFull });
            i = tagEnd + 1;
          } else {
            buffer += tagFull;
            i = tagEnd + 1;
          }
        } else {
          buffer += content[i];
          i++;
        }
      }
      if (buffer.trim()) segments.push({ type: 'text', content: buffer });
      // ===== 增强：裸文本缓冲按换行拆分，每行独立包裹 <p> =====
      // 原来：多行裸文本合并成一个 <p> → 内部换行丢失，视觉上堆叠在一起
      // 现在：每行（trim 后非空）单独生成一个 <p>，模拟"每行要点"的呈现效果
      return segments
        .map((seg) => {
          if (seg.type === 'text' && seg.content.trim()) {
            const lines = seg.content.split(/\r?\n/);
            const wrapped: string[] = [];
            for (const rawLine of lines) {
              const line = rawLine.trim();
              if (!line) continue;
              wrapped.push(`<p style="${this.composeInheritedPStyle(parentStyle)}">${line}</p>`);
            }
            return wrapped.join('');
          }
          return seg.content;
        })
        .join('');
    };
    const replaceTextInDiv = (htmlStr: string): string => {
      const divRegex = /<(div|section|article)(\s[^>]*)?>([\s\S]*?)<\/\1>/gi;
      let iterations = 0;
      do {
        const before = htmlStr;
        htmlStr = htmlStr.replace(divRegex, (match, tag, attrs, innerContent) => {
          const styleAttr = (attrs || '').match(/style="([^"]*)"/i);
          const parentStyle = styleAttr ? styleAttr[1] : undefined;
          const hasOuterDiv = /<(div|section|article)[\s>]/i.test(innerContent);
          if (hasOuterDiv) {
            // Step 1: 递归处理嵌套的子容器内部（深度优先，先内层）
            let pi = replaceTextInDiv(innerContent);
            // Step 2: 对当前层级的内容也执行包裹，防止嵌套 div 周围的兄弟裸文本被遗漏
            const processed = processContainer(pi, parentStyle);
            if (processed !== innerContent) return `<${tag}${attrs || ''}>${processed}</${tag}>`;
            return match;
          }
          const p = processContainer(innerContent, parentStyle);
          return p === innerContent ? match : `<${tag}${attrs || ''}>${p}</${tag}>`;
        });
        iterations++;
        if (htmlStr === before) break;
      } while (iterations < 10);
      return htmlStr;
    };
    result = replaceTextInDiv(result);
    return result;
  }

  private extractJson(content: string): string {
    const trimmed = content.trim();
    if (trimmed.startsWith('{')) return trimmed;
    const match = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (match) return match[1].trim();
    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      return trimmed.slice(firstBrace, lastBrace + 1);
    }
    return trimmed;
  }

  private extractHtml(content: string): string {
    const trimmed = content.trim();
    const match = trimmed.match(/```(?:html)?\s*([\s\S]*?)```/i);
    if (match) return match[1].trim();
    const firstDiv = trimmed.indexOf('<div');
    const lastDiv = trimmed.lastIndexOf('</div>');
    if (firstDiv !== -1 && lastDiv !== -1 && lastDiv > firstDiv) {
      return trimmed.slice(firstDiv, lastDiv + 6);
    }
    return trimmed;
  }
}

/**
 * 由 primaryColor（主色 hex，一般是 tailwind 500/600 档，如 #3b82f6 蓝、#10b981 绿、#f97316 橙）
 * 推导出「同色系浅一档 PRIMARY_COLOR_LIGHTER」，用于 3 段式进度条渐变首段（0%~45% 过渡起点）。
 *   - 已知颜色 → 直接映射到 Tailwind -300 / -400 档（与原 PRIMARY_COLOR_LIGHTER→#60a5fa 蓝-400 档历史值一致，蓝 #3b82f6-500 → #60a5fa-400）
 *   - 未知颜色 → 兜底：RGB 线性向白色(255,255,255) 按 40% 比例混合，得到视觉和谐的浅一档
 */
function derivePrimaryColorLighter(primaryHex: string): string {
  const c = primaryHex.trim().toLowerCase().replace(/^#/, '');
  const hex =
    c.length === 3
      ? c
          .split('')
          .map((x) => x + x)
          .join('')
      : c;
  // 已知色表：primary(500/600) → lighter(-300/-400)，与之前 #3b82f6→#60a5fa (blue-500→blue-400) 一致的档级差
  const known: Record<string, string> = {
    // 蓝系（历史默认）
    '3b82f6': '60a5fa',
    '2563eb': '60a5fa',
    '1d4ed8': '3b82f6',
    // 绿系
    '10b981': '6ee7b7',
    '059669': '34d399',
    '047857': '10b981',
    // 橙系
    f97316: 'fdba74',
    ea580c: 'fb923c',
    c2410c: 'f97316',
    // 紫系（violet）
    '8b5cf6': 'c4b5fd',
    '7c3aed': 'a78bfa',
    '6d28d9': '8b5cf6',
    // 青系（cyan）
    '06b6d4': '67e8f9',
    '0891b2': '22d3ee',
    '0e7490': '06b6d4',
    // 靛系（indigo）
    '6366f1': 'a5b4fc',
    '4f46e5': '818cf8',
    '4338ca': '6366f1',
    // 玫红系（pink）
    ec4899: 'f9a8d4',
    db2777: 'f472b6',
    be185d: 'ec4899',
    // 红系
    ef4444: 'fca5a5',
    dc2626: 'f87171',
    b91c1c: 'ef4444',
    // 黄系
    eab308: 'fde047',
    ca8a04: 'facc15',
    a16207: 'eab308',
    // 灰系
    '6b7280': 'd1d5db',
    '4b5563': '9ca3af',
    '374151': '6b7280',
  };
  if (hex in known) return '#' + known[hex];
  if (!/^[0-9a-f]{6}$/.test(hex)) return '#60a5fa'; // 完全非法 hex → 兜底浅蓝
  // 兜底：RGB 线性与白色 40% 混合（向 255 靠 40%）
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const mix = (v: number) => Math.round(v + (255 - v) * 0.4);
  const to2 = (v: number) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0');
  return '#' + to2(mix(r)) + to2(mix(g)) + to2(mix(b));
}

/**
 * 自然语言 → comparison-deep-dive 意图识别（关键词正则，中文+英文 25+ 同义词）
 * 命中规则（任一即 true）：
 *   1. 包含完整"对比核心词"：深度对比 / 全面对比 / 参数对比 / 性能对比 / 功能对比 / 规格对比 / 差异对比 / 横向对比 / 纵向对比
 *      / 竞品对比 / 方案对比 / 对比分析 / 新旧方案 / 升级前后 / Before & After / 优势劣势 / 评测 / 测评 / 横评 / A/B 对比 / AB 测试
 *   2. 包含"对比 / PK / vs / benchmark"这类核心字（更宽松，如"AI对比工作伙伴"、"两款产品PK"）
 *   3. 典型二分式结构：「XX 和/跟/与/同 XX [做][一个][深度/全面/详细] 对比/比较/评测/PK」
 * 返回：{ isComparison, triggerWords } → 供下游决定是否强制使用 comparison-deep-dive 版式
 */
function detectComparisonIntent(topic: string): { isComparison: boolean; triggerWords: string[] } {
  const text = topic.trim().toLowerCase();
  const triggers: Array<{ word: string; re: RegExp }> = [
    // 第 1 组：强对比词（100% 命中）
    { word: '深度对比', re: /深度\s*对比/ },
    { word: '全面对比', re: /全面\s*对比/ },
    { word: '参数对比', re: /参数\s*对比/ },
    { word: '性能对比', re: /性能\s*对比/ },
    { word: '功能对比', re: /功能\s*对比/ },
    { word: '规格对比', re: /规格\s*对比/ },
    { word: '差异对比', re: /差异\s*对比/ },
    { word: '横向对比', re: /横向\s*对比/ },
    { word: '纵向对比', re: /纵向\s*对比/ },
    { word: '竞品对比', re: /竞品\s*对比/ },
    { word: '方案对比', re: /方案\s*对比/ },
    { word: '对比分析', re: /对比\s*分析/ },
    { word: '新旧方案', re: /新旧\s*方案/ },
    { word: '升级前后', re: /升级\s*前后/ },
    { word: 'before&after', re: /before\s*[&\-]\s*after/ },
    { word: '优势劣势', re: /优势\s*劣势|优\s*劣\s*势|优缺点/ },
    { word: '评测', re: /评测/ },
    { word: '测评', re: /测评/ },
    { word: '横评', re: /横评/ },
    { word: 'A/B对比', re: /a\s*\/?\s*b\s*(测试|对比|实验)/ },
    // 第 2 组：通用核心字（需避免"对比"被"对比色""对比度"这类无关词命中 → 后面不含"色""度"）
    { word: '对比', re: /对比(?![色度])/ },
    { word: 'PK', re: /\bpk\b/ },
    { word: 'vs', re: /\bvs\.?\b|[vs]\s[vs]\s/ }, // "A vs B" / "A vs. B"
    { word: 'benchmark', re: /\bbenchmark(ing)?\b/ },
    // 第 3 组：典型二分式结构 "X 和 Y 比较/评测"
    {
      word: 'X和Y比较',
      re: /(.+?)(和|跟|与|同|vs\.?|pk)\s*(.+?)(做|做一个|做个|做一次|进行)?\s*(深度|全面|详细)?\s*(对比|比较|评测|测评|横评|pk)/,
    },
  ];
  const hits: string[] = [];
  for (const t of triggers) if (t.re.test(text)) hits.push(t.word);
  return { isComparison: hits.length >= 1, triggerWords: Array.from(new Set(hits)) };
}

/**
 * 自动补齐 comparison-deep-dive 缺失字段（硬兜底：LLM 没填也给合理默认值）
 *   - pageType → 强制 'comparison-deep-dive'
 *   - styleTheme → 默认 'mixed'（progress-bars+badges+colored-cards 全有，比纯 progress-bars 更有表现力）
 *   - layoutParams → 默认 gridCols:2（双栏）、contentDirection:'row'、contentAlignment:'left'、titlePosition:'top'
 *   - metricValues → 根据 keyPoints 长度 N 生成：右栏普遍比左栏高（默认 [92, 78, 86, 95, 89]，至少 3 项、最多 5 项），避免全 60 这种无差别值
 *   - advantageIndices → 挑 metricValues[i] >= 85 的那些索引（至少保证 1 项；若全 < 85 则取第 0 个）
 *   - needsImage → false（对比页不配图，文字为主）
 */
function autoCompleteComparisonPage<
  T extends {
    pageType: string;
    keyPoints?: unknown[] | string;
    styleTheme?: unknown;
    layoutParams?: unknown;
    metricValues?: unknown;
    advantageIndices?: unknown;
    needsImage?: unknown;
  },
>(page: T): T {
  const kps = Array.isArray(page.keyPoints) ? page.keyPoints : [];
  const N = Math.min(5, Math.max(3, kps.length || 4)); // 默认 4 项，最少 3，最多 5
  // metricValues 预设：有层次感（非全同），默认值 92/78/86/95/89，取前 N 个
  const defaultMetrics: number[] = [92, 78, 86, 95, 89].slice(0, N);
  const rawMetrics: unknown = (page as any).metricValues;
  const metrics: number[] = (
    Array.isArray(rawMetrics) && rawMetrics.length >= N
      ? rawMetrics.map((x) => (typeof x === 'number' ? x : parseInt(String(x), 10) || 0))
      : defaultMetrics
  ) as number[];
  // advantageIndices：挑 >= 85 的索引；若一个都没有就 [0]
  const rawAdv: unknown = (page as any).advantageIndices;
  let advIdx: number[];
  if (Array.isArray(rawAdv) && rawAdv.length > 0) {
    advIdx = rawAdv
      .map((x) => (typeof x === 'number' ? x : parseInt(String(x), 10) || -1))
      .filter((x: number) => Number.isFinite(x));
  } else {
    advIdx = metrics
      .map((v: number, i: number) => (v >= 85 ? i : -1))
      .filter((i: number) => i >= 0);
  }
  if (advIdx.length === 0) advIdx = [0];
  // layoutParams 补齐（合并现有不覆盖）
  const baseLP = {
    titlePosition: 'top' as const,
    contentDirection: 'row' as const,
    imageAnchor: 'none' as const,
    cardShape: 'rounded' as const,
    contentAlignment: 'left' as const,
    gridCols: 2 as const,
  };
  const lp =
    typeof page.layoutParams === 'object' && page.layoutParams !== null
      ? { ...baseLP, ...(page.layoutParams as any) }
      : baseLP;

  return {
    ...page,
    pageType: 'comparison-deep-dive',
    styleTheme:
      page.styleTheme && typeof page.styleTheme === 'string' && page.styleTheme !== 'none'
        ? page.styleTheme
        : 'mixed',
    layoutParams: lp,
    metricValues: metrics,
    advantageIndices: Array.from(new Set<number>(advIdx)).filter(
      (i: number) => i >= 0 && i < metrics.length,
    ),
    needsImage: false,
  } as any;
}

// ================================================================
// U-17 · 规划阶段主色单源公式（纯函数）
// 与 generatePlan() 内部 U-17 强制覆盖逻辑完全对齐：
//   ① 用户显式选了 colorTheme → primaryColor 必须 = COLOR_THEMES[colorTheme]
//   ② colorTheme=自动（未显式）→ 必须等于按 style 自动匹配的 hex（business→#2563eb 等）
//   ③ 否则：用传入 primaryColor（合法 6 位 hex），仍无效则 fallback #2563eb
// 用法：在进入 LLM 之前预计算最终主色，确保
//   buildPlanningPrompt / user message / U-17 强制覆盖 三处使用同一个值，
//   彻底消除 LLM 输入中的 primaryColor 指令冲突（用户报告 bug）。
// ================================================================
export function computeU17EffectivePrimaryColor(
  style: string,
  colorTheme: ColorTheme | undefined,
  primaryColor: string,
): string {
  const forced =
    colorTheme && COLOR_THEMES[colorTheme]
      ? COLOR_THEMES[colorTheme]
      : COLOR_THEMES[style] || primaryColor || '#2563eb';
  // 兜底：若走到 || primaryColor 分支但其值非法 → 返回默认蓝
  return /^#[0-9a-fA-F]{6}$/.test(forced) ? forced : '#2563eb';
}

// ================================================================
// 测试用：构造 generatePlan 发给 LLM 的 system+user messages。
// 真实 generatePlan() 流程内构造逻辑的镜像实现，保证二者一致。
// ================================================================
export function buildPlanningMessagesForTest(params: {
  topic: string;
  style: string;
  audience: string;
  slideSpec: { exact?: number; min?: number; max?: number };
  density: ContentDensity;
  imagePreference: ImagePreference;
  primaryColor: string;
  backgroundEnabled: boolean;
  pageHints: {
    contentOnly: boolean;
    disableCover: boolean;
    disableToc: boolean;
    disableConclusion: boolean;
  };
  iconStyle: IconStyle;
  fontFamily: 'sans' | 'serif' | 'mono';
  colorTheme?: ColorTheme;
  referenceHtmlBrief?: string;
  userSettingsOverride?: string;
}): ChatMessage[] {
  const agent = new HTMLPresentationAgent({
    name: 'stub',
    config: {} as any,
    chat: async () => ({
      content: '',
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    }),
  } as any);
  const effectiveColor = computeU17EffectivePrimaryColor(
    params.style,
    params.colorTheme,
    params.primaryColor,
  );
  const userOverride =
    (agent as any).buildUserSettingsPriorityOverridePrompt?.({
      slideCount: params.slideSpec,
      style: params.style,
      density: params.density,
      imagePreference: params.imagePreference,
      colorTheme: params.colorTheme,
      iconStyle: params.iconStyle,
      fontFamily: params.fontFamily,
      backgroundEnabled: params.backgroundEnabled,
      audience: params.audience,
    }) ||
    params.userSettingsOverride ||
    '';
  const systemPrompt = (agent as any).buildPlanningPrompt(
    params.topic,
    params.style,
    params.audience,
    params.slideSpec,
    params.density,
    params.imagePreference,
    params.backgroundEnabled,
    params.pageHints,
    params.iconStyle,
    params.fontFamily,
    params.colorTheme,
    params.referenceHtmlBrief || '',
    userOverride,
    effectiveColor,
  );
  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `请规划这个演示文稿，主色调使用：${effectiveColor}` },
  ];
}

// ================================================================
// TEST HARNESS EXPORT（仅用于 vitest 单元测试，业务代码不应 import 本块）
// 对应单测文件：primary-color.test.ts / gradient.test.ts
// ================================================================
// 注：本文件顶层使用 `function` 和 `const`，不会与业务类 export 冲突。
// 单独导出常量/纯函数，避免依赖 HTMLPresentationAgent 类实例。
// computeU17EffectivePrimaryColor / buildPlanningMessagesForTest 已经使用
// export function 单独导出，不再在对象里重复写以免同名冲突。
export {
  COLOR_THEMES,
  darkenColor,
  hexToHsl,
  hslToHex,
  hueDelta,
  assertHueClose,
  resolveEffectivePrimaryColor,
};
