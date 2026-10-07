import {
  DECK_IMAGE_PLACEHOLDER,
  SLIDE_H_PX,
  SLIDE_W_PX,
  normalizeColor,
  splitH,
  splitV,
  type DeckChartKind,
  type DeckChartSpec,
  type DeckColor,
  type DeckFill,
  type DeckNode,
  type DeckParagraph,
  type DeckRect,
  type DeckShapeType,
  type DeckTextRun,
} from '@noppt/core/deck';
import { resolveDeckChartKind } from '../../../templates/structured-graphics';
import type { ChartSpec, SlidePageType, SlidePlan, StyleTheme } from '../../../types';

// ---------------------------------------------------------------------------
// Shared layout geometry and node primitives
// ---------------------------------------------------------------------------

export const DECK_PAD_X = 64;
export const DECK_PAD_Y = 48;
export const DECK_GAP = 24;

/** 正文安全区（含标题）。 */
export const DECK_CONTENT_RECT: DeckRect = {
  x: DECK_PAD_X,
  y: DECK_PAD_Y,
  w: SLIDE_W_PX - DECK_PAD_X * 2,
  h: SLIDE_H_PX - DECK_PAD_Y * 2,
};

/** 标题区高度（H2 50px × 1.25 + 8 留白）。 */
export const DECK_TITLE_H = 72;

/** 标题下的正文区。 */
export const DECK_BODY_RECT: DeckRect = {
  x: DECK_CONTENT_RECT.x,
  y: DECK_CONTENT_RECT.y + DECK_TITLE_H,
  w: DECK_CONTENT_RECT.w,
  h: DECK_CONTENT_RECT.h - DECK_TITLE_H,
};

/** 字号层级（pt），与 HTML 版式一一对应。 */
export const DECK_FONT_SIZE = {
  h1: 92,
  h2: 50,
  h3: 28,
  body: 20,
  bodySm: 18,
  caption: 16,
  value: 88,
  stat: 56,
  quote: 44,
  divider: 64,
} as const;

/** 中性色（与 HTML 模板的 #F9FAFB / #E5E7EB / #6B7280 对齐）。 */
export const DECK_NEUTRAL = {
  cardBg: 'F9FAFB',
  border: 'E5E7EB',
  muted: '6B7280',
  ink: '1F2937',
  white: 'FFFFFF',
} as const;

/** 视口档位；坐标仍始终使用 1280×720 logical canvas。 */
export type ViewportProfile = 'narrow' | 'standard' | 'wide';

export interface ViewportSize {
  width: number;
  height: number;
}

/** 根据真实 viewport 选择布局密度，不改变 Deck 的逻辑坐标系。 */
export function resolveViewportProfile(width: number, _height: number): ViewportProfile {
  if (!Number.isFinite(width) || width < 1024) return 'narrow';
  if (width > 1440) return 'wide';
  return 'standard';
}

export type MeasurementStatus = 'measured' | 'fail' | 'unverified';
export type LayoutStatus = 'pass' | 'fail' | 'unverified';

export interface TextMeasureOptions {
  fontSize: number;
  maxWidth?: number;
  lineHeight?: number;
  letterSpacing?: number;
  fontFamily?: string;
  maxLines?: number;
}

export interface TextMeasurement {
  status: MeasurementStatus;
  text: string;
  width: number;
  height: number;
  lineHeight: number;
  lineCount: number;
  lines: string[];
  fontSize: number;
  reason?: string;
}

export interface FitTextResult extends Omit<TextMeasurement, 'status'> {
  status: LayoutStatus;
  rect: DeckRect;
  reason?: string;
}

export interface VerticalRegionRequest {
  id: string;
  text: string;
  fontSize: number;
  minFontSize?: number;
  lineHeight?: number;
  weight?: number;
  minHeight?: number;
}

export interface VerticalRegion {
  id: string;
  text: string;
  rect: DeckRect;
  fontSize: number;
  lineHeight: number;
  lines: string[];
  status: LayoutStatus;
  reason?: string;
}

export interface VerticalRegionAllocation {
  status: LayoutStatus;
  regions: VerticalRegion[];
  reason?: string;
}

export interface DeckLayoutContext {
  primary: DeckColor;
  primaryDark: DeckColor;
  background: DeckColor;
  text: DeckColor;
  textMuted: DeckColor;
  fontFamily?: string;
  style?: StyleTheme;
  /** Logical canvas is always 1280×720, even when viewport dimensions differ. */
  logicalWidth?: number;
  logicalHeight?: number;
  viewport?: ViewportSize;
  viewportProfile?: ViewportProfile;
  density?: 'compact' | 'standard' | 'spacious';
  /** String/object profile is retained as metadata; DOM font verification is later. */
  fontProfile?: string | { family?: string; weight?: number; source?: string };
}

export const DEFAULT_DECK_LAYOUT_CONTEXT: DeckLayoutContext = {
  primary: '2563EB',
  primaryDark: '1D4ED8',
  background: 'FFFFFF',
  text: '1F2937',
  textMuted: '6B7280',
  logicalWidth: SLIDE_W_PX,
  logicalHeight: SLIDE_H_PX,
  viewport: { width: SLIDE_W_PX, height: SLIDE_H_PX },
  viewportProfile: 'standard',
  density: 'standard',
};

// ---------------------------------------------------------------------------
// Deterministic text measurement and region allocation
// ---------------------------------------------------------------------------

function characterWidth(character: string, fontSize: number): number {
  if (/\s/.test(character)) return fontSize * 0.35;
  if (/[\u3400-\u9fff\u3040-\u30ff\uff00-\uffef]/.test(character)) return fontSize;
  if (/[A-Z]/.test(character)) return fontSize * 0.68;
  if (/[a-z]/.test(character)) return fontSize * 0.56;
  if (/[0-9]/.test(character)) return fontSize * 0.58;
  return fontSize * 0.5;
}

/**
 * Measure text without a DOM so plan→Deck remains deterministic in Node and the
 * browser. The result is explicit rather than silently falling back on invalid
 * dimensions; browser/font-specific validation can later upgrade it to unverified.
 */
export function measureText(text: string, options: TextMeasureOptions): TextMeasurement {
  const value = String(text ?? '');
  const fontSize = Number(options?.fontSize);
  const maxWidth = options?.maxWidth;
  const lineHeight = fontSize * (options?.lineHeight ?? 1.2);
  if (!Number.isFinite(fontSize) || fontSize <= 0 || !Number.isFinite(lineHeight) || lineHeight <= 0) {
    return {
      status: 'fail', text: value, width: 0, height: 0, lineHeight: 0,
      lineCount: 0, lines: [value], fontSize, reason: 'invalid_font_metrics',
    };
  }
  if (maxWidth !== undefined && (!Number.isFinite(maxWidth) || maxWidth <= 0)) {
    return {
      status: 'fail', text: value, width: 0, height: 0, lineHeight,
      lineCount: 0, lines: [value], fontSize, reason: 'invalid_measure_width',
    };
  }
  const letterSpacing = Number.isFinite(options?.letterSpacing) ? options.letterSpacing! : 0;
  const lines: string[] = [];
  let line = '';
  let lineWidth = 0;
  const pushLine = () => {
    lines.push(line);
    line = '';
    lineWidth = 0;
  };
  for (const character of value || ' ') {
    if (character === '\n') {
      pushLine();
      continue;
    }
    const width = characterWidth(character, fontSize) + letterSpacing;
    if (maxWidth !== undefined && line && lineWidth + width > maxWidth) pushLine();
    line += character;
    lineWidth += width;
  }
  if (line || lines.length === 0) lines.push(line);
  const widths = lines.map((current) => Array.from(current).reduce(
    (sum, character) => sum + characterWidth(character, fontSize) + letterSpacing, 0,
  ));
  const limitedLines = options?.maxLines && options.maxLines > 0
    ? lines.slice(0, options.maxLines)
    : lines;
  const width = Math.max(0, ...widths);
  return {
    status: 'measured', text: value, width, height: limitedLines.length * lineHeight,
    lineHeight, lineCount: limitedLines.length, lines: limitedLines, fontSize,
  };
}

/** Fit by wrapping first, then reducing font size; never removes input text. */
export function fitTextRect(text: string, rect: DeckRect, options: TextMeasureOptions & { minFontSize?: number }): FitTextResult {
  const value = String(text ?? '');
  if (!rect || !Number.isFinite(rect.w) || !Number.isFinite(rect.h) || rect.w <= 0 || rect.h <= 0) {
    return {
      ...measureText(value, { ...options, fontSize: Number(options?.fontSize) || 0 }),
      status: 'fail', rect, text: value, reason: 'invalid_text_rect',
    };
  }
  const start = Number(options?.fontSize);
  const min = Math.max(1, Math.min(Number(options?.minFontSize ?? start), start));
  let best = measureText(value, { ...options, fontSize: start, maxWidth: rect.w });
  for (let size = start; size >= min; size -= 1) {
    const measured = measureText(value, { ...options, fontSize: size, maxWidth: rect.w });
    best = measured;
    if (measured.height <= rect.h) {
      return { ...measured, status: 'pass', rect, text: value };
    }
  }
  return { ...best, status: 'fail', rect, text: value, reason: 'text_does_not_fit' };
}

/** Allocate only measured/minimum heights; regions never escape the logical body. */
export function allocateVerticalRegions(
  rect: DeckRect,
  requests: VerticalRegionRequest[],
  options: { gap?: number; fontFamily?: string; distributeExtra?: boolean } = {},
): VerticalRegionAllocation {
  if (!rect || rect.w <= 0 || rect.h <= 0 || requests.length === 0) {
    return { status: 'fail', regions: [], reason: 'invalid_region_input' };
  }
  const gap = Math.max(0, options.gap ?? DECK_GAP);
  const available = rect.h - gap * Math.max(0, requests.length - 1);
  if (available <= 0) return { status: 'fail', regions: [], reason: 'insufficient_region_height' };
  const measurements = requests.map((request) => {
    const measured = measureText(request.text, {
      fontSize: request.fontSize,
      maxWidth: rect.w,
      lineHeight: request.lineHeight,
      fontFamily: options.fontFamily,
    });
    const required = Math.max(request.minHeight ?? 24, measured.height + 16);
    return { request, measured, required };
  });
  const minimumTotal = measurements.reduce((sum, item) => sum + item.required, 0);
  const weights = measurements.map((item) => Math.max(1, item.request.weight ?? 1));
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  const canFit = minimumTotal <= available;
  let y = rect.y;
  const regions = measurements.map(({ request, measured, required }, index) => {
    const remaining = measurements.length - index - 1;
    const remainingMin = measurements.slice(index + 1).reduce((sum, item) => sum + item.required, 0);
    const spare = Math.max(0, available - minimumTotal);
    const extra = options.distributeExtra === false ? 0 : spare * (weights[index] / weightTotal);
    const height = Math.max(24, Math.min(available - (y - rect.y) - gap * remaining, required + extra));
    const fitted = fitTextRect(request.text, { x: rect.x, y, w: rect.w, h: height }, {
      fontSize: request.fontSize,
      minFontSize: request.minFontSize ?? Math.max(12, request.fontSize * 0.7),
      lineHeight: request.lineHeight,
      fontFamily: options.fontFamily,
    });
    const region: VerticalRegion = {
      id: request.id, text: request.text,
      rect: { x: rect.x, y, w: rect.w, h: height },
      fontSize: fitted.fontSize, lineHeight: fitted.lineHeight,
      lines: fitted.lines, status: fitted.status, reason: fitted.reason,
    };
    y += height + gap;
    // Keep the value referenced so future allocation changes cannot accidentally
    // drop the remaining demand calculation while retaining deterministic output.
    void remainingMin;
    void measured;
    return region;
  });
  const failed = !canFit || regions.some((region) => region.status === 'fail');
  return {
    status: failed ? 'fail' : regions.some((region) => region.status === 'unverified') ? 'unverified' : 'pass',
    regions,
    reason: failed ? (canFit ? 'text_does_not_fit' : 'minimum_regions_exceed_container') : undefined,
  };
}

// ---------------------------------------------------------------------------
// Node construction helpers
// ---------------------------------------------------------------------------

/** 纯色填充。 */
export function solid(color: DeckColor, transparency?: number): DeckFill {
  return transparency === undefined
    ? { type: 'solid', color }
    : { type: 'solid', color, transparency };
}

/** 主色衍生底色。 */
export function tint(color: DeckColor, alphaHex: string): DeckFill {
  const a = parseInt(alphaHex, 16);
  const alpha = Number.isFinite(a) ? a / 255 : 1;
  return { type: 'solid', color, transparency: Math.round((1 - alpha) * 100) };
}

/** 主色渐变填充（与 HTML 模板的 135 度渐变一致）。 */
export function gradientFill(from: DeckColor, to: DeckColor, angle = 135): DeckFill {
  return {
    type: 'gradient',
    gradient: {
      angle,
      stops: [
        { color: from, offset: 0 },
        { color: to, offset: 1 },
      ],
    },
  };
}

/** 构造一个 run（python-pptx 的 Run 语义）。 */
export function run(text: string, o?: Partial<Omit<DeckTextRun, 'text'>>): DeckTextRun {
  return { text, ...o };
}

/** 构造一个段落。 */
export function para(
  text: string,
  o?: {
    bold?: boolean;
    italic?: boolean;
    size?: number;
    color?: DeckColor;
    align?: 'left' | 'center' | 'right';
    bullet?: boolean;
    spaceAfter?: number;
    lineSpacing?: number;
  },
): DeckParagraph {
  const { bold, italic, size, color, align, bullet, spaceAfter, lineSpacing } = o ?? {};
  return {
    runs: [run(text, { bold, italic, fontSize: size, color })],
    align,
    bullet,
    spaceAfter,
    lineSpacing,
  };
}

/** 文本节点。 */
export function textNode(
  rect: DeckRect,
  paragraphs: DeckParagraph[],
  o?: {
    align?: 'left' | 'center' | 'right';
    valign?: 'top' | 'middle' | 'bottom';
    role?: DeckNode['role'];
    contentId?: string;
    contentColumn?: 'left' | 'right';
    contentOrder?: number;
    bullet?: boolean;
    source?: 'plan' | 'manual' | 'legacy';
    autoFit?: boolean;
  },
): DeckNode {
  return {
    kind: 'text',
    rect,
    paragraphs,
    align: o?.align ?? 'left',
    valign: o?.valign ?? 'top',
    role: o?.role,
    contentId: o?.contentId,
    contentColumn: o?.contentColumn,
    contentOrder: o?.contentOrder,
    bullet: o?.bullet,
    source: o?.source,
    autoFit: o?.autoFit,
  };
}

/** 形状节点。 */
export function shapeNode(
  rect: DeckRect,
  shape: DeckShapeType,
  o?: {
    fill?: DeckFill;
    line?: { color?: DeckColor; width?: number; dash?: 'solid' | 'dash' | 'dot' };
    radius?: number;
    text?: DeckParagraph[];
    valign?: 'top' | 'middle' | 'bottom';
    role?: DeckNode['role'];
  },
): DeckNode {
  return {
    kind: 'shape',
    rect,
    shape,
    fill: o?.fill,
    line: o?.line,
    rectRadius: o?.radius,
    text: o?.text,
    valign: o?.valign,
    role: o?.role,
  };
}

/** 图片节点（AI 阶段只有 prompt，写占位标记）。 */
export function imageNode(rect: DeckRect, alt?: string, radius = 16): DeckNode {
  return {
    kind: 'image',
    rect,
    src: DECK_IMAGE_PLACEHOLDER,
    alt,
    fit: 'cover',
    radius,
  };
}

/** 要点列表：一个文本框内多段 bullet（对应 python-pptx 的多 Paragraph）。 */
export function bulletList(
  rect: DeckRect,
  items: string[],
  o?: { size?: number; color?: DeckColor; spaceAfter?: number; contentIds?: string[] },
): DeckNode {
  return textNode(
    rect,
    items.map((t) =>
      para(t, {
        size: o?.size ?? DECK_FONT_SIZE.body,
        color: o?.color,
        bullet: true,
        spaceAfter: o?.spaceAfter ?? 8,
      }),
    ),
    { contentId: o?.contentIds?.[0], source: o?.contentIds ? 'plan' : undefined },
  );
}

/** 把要点文本拆成「标题 + 描述」（支持 `标题：描述` / `标题 | 描述`）。 */
export function splitTitleBody(s: string): { title: string; body: string } {
  const raw = (s ?? '').trim();
  const m = raw.match(/^([^：:|｜]{2,28})\s*[：:|｜]\s*([\s\S]+)$/);
  if (m) return { title: m[1].trim(), body: m[2].trim() };
  return { title: raw, body: '' };
}

/** 数值/趋势解析：`88% 增长` → { value: '88%', label: '增长' }。 */
export function splitValueLabel(s: string): { value: string; label: string } {
  const raw = (s ?? '').trim();
  const m = raw.match(/^([-+]?[,\d.]+\s*[%a-zA-Z\u4e00-\u9fa5]*)\s*(.*)$/);
  if (m && m[1]) return { value: m[1].trim(), label: (m[2] || '').trim() };
  return { value: raw, label: '' };
}

/** 供各布局 owner 使用的函数类型。 */
export type LayoutFn = (sp: SlidePlan, ctx: DeckLayoutContext) => DeckNode[];

export function titleBlock(
  sp: SlidePlan,
  ctx: DeckLayoutContext,
  rect: DeckRect = DECK_CONTENT_RECT,
): DeckNode {
  const compact = ctx.viewportProfile === 'narrow' || ctx.density === 'compact';
  const titleRect = {
    x: rect.x,
    y: rect.y,
    w: rect.w,
    h: DECK_TITLE_H,
  };
  const fitted = fitTextRect(sp.title || '', titleRect, {
    fontSize: compact ? 44 : DECK_FONT_SIZE.h2,
    minFontSize: compact ? 28 : 32,
    lineHeight: 1.12,
    fontFamily: ctx.fontFamily,
  });
  return textNode(
    fitted.rect,
    [para(sp.title || '', {
      bold: true,
      size: fitted.fontSize,
      color: ctx.primary,
      lineSpacing: fitted.lineHeight / Math.max(1, fitted.fontSize),
    })],
    { role: 'title', autoFit: fitted.status !== 'pass' },
  );
}

// ---------------------------------------------------------------------------
// Chart / architecture spec conversion
// ---------------------------------------------------------------------------

/** 页型 → 默认图表类型（当 plan 未给 chart 时用）。 */
export const DEFAULT_CHART_KIND_BY_PAGE: Partial<Record<SlidePageType, DeckChartKind>> = {
  'content-chart-bar': 'bar',
  'content-chart-line': 'line',
  'content-chart-pie': 'pie',
  'content-chart-donut': 'donut',
};

/** ai 侧 `ChartSpec` → core `DeckChartSpec`。 */
export function toDeckChartSpec(
  spec: ChartSpec | undefined,
  fallbackKind: DeckChartKind,
  overrideKind?: DeckChartKind,
): DeckChartSpec | null {
  if (!spec || !Array.isArray(spec.series) || spec.series.length === 0) return null;
  let kind: DeckChartKind = spec.kind ? resolveDeckChartKind(spec) : fallbackKind;
  if (overrideKind) {
    if (overrideKind === 'bar') {
      kind = spec.percentStacked ? 'barStacked100' : spec.stacked ? 'barStacked' : 'bar';
    } else if (overrideKind === 'line') {
      kind = spec.smooth ? 'lineSmooth' : 'line';
    } else {
      kind = overrideKind;
    }
  }
  const needsX = kind === 'scatter' || kind === 'bubble';
  const series = spec.series
    .filter((s) => Array.isArray(s?.points))
    .map((s) => ({
      name: s.name,
      values: s.points.map((p) =>
        typeof p?.value === 'number' && Number.isFinite(p.value) ? p.value : 0,
      ),
      xs: needsX
        ? s.points.map((p, i) => {
            const n = parseFloat(String(p?.label ?? ''));
            return Number.isFinite(n) ? n : i + 1;
          })
        : undefined,
      color: s.color ? normalizeColor(s.color) : undefined,
    }))
    .filter((s) => s.values.length > 0);
  if (series.length === 0) return null;
  return {
    kind,
    categories: (spec.series[0]?.points ?? []).map((p) => String(p?.label ?? '')),
    series,
    unit: spec.unit,
    showLegend: spec.showLegend,
    showValue: spec.showValues,
  };
}

export { splitH, splitV };
export type {
  DeckChartKind,
  DeckChartSpec,
  DeckColor,
  DeckFill,
  DeckNode,
  DeckParagraph,
  DeckRect,
  DeckShapeType,
  DeckTextRun,
};
