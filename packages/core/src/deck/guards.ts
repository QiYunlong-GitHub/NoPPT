/**
 * Deck 运行时守卫与归一化。
 *
 * 全仓未引入 zod，因此用 TS 类型 + 手写守卫函数保证运行时安全
 * （历史 deck / LLM 产出的脏数据不会让导出崩溃）。
 */

import { clampToSlide, type DeckRect } from './geometry';
import { isDeckShapeType, DEFAULT_DECK_SHAPE } from './shapes';
import { normalizeDeckChartKind, DECK_CHART_KINDS, type DeckChartKind } from './chart-kinds';
import type {
  Deck,
  DeckAlign,
  DeckColor,
  DeckMeta,
  DeckNode,
  DeckParagraph,
  DeckSlide,
  DeckTextRun,
  DeckVAlign,
} from './schema';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** 矩形守卫。 */
export function isDeckRect(v: unknown): v is DeckRect {
  return (
    isRecord(v) &&
    isFiniteNumber(v.x) &&
    isFiniteNumber(v.y) &&
    isFiniteNumber(v.w) &&
    isFiniteNumber(v.h)
  );
}

/** 把任意矩形归一化并钳制进画布。 */
export function normalizeRect(v: unknown, fallback?: DeckRect): DeckRect {
  if (!isDeckRect(v)) return clampToSlide(fallback ?? { x: 0, y: 0, w: 0, h: 0 });
  return clampToSlide({
    x: v.x,
    y: v.y,
    w: Math.max(0, v.w),
    h: Math.max(0, v.h),
  });
}

/**
 * 颜色归一化：统一输出**不带 `#` 的 6 位大写 HEX**（OOXML / PptxGenJS 惯例）。
 * 支持 `#RGB` / `#RRGGBB` / `rgb()` / 常见 CSS 颜色名；无法解析时返回兜底色。
 */
const NAMED_COLORS: Record<string, string> = {
  white: 'FFFFFF',
  black: '000000',
  red: 'FF0000',
  green: '008000',
  blue: '0000FF',
  gray: '808080',
  grey: '808080',
  transparent: 'FFFFFF',
};

export function normalizeColor(v: unknown, fallback: DeckColor = '000000'): DeckColor {
  if (typeof v !== 'string') return fallback;
  const raw = v.trim();
  if (!raw) return fallback;

  const hex = raw.replace(/^#/, '');
  if (/^[0-9a-fA-F]{6}$/.test(hex)) return hex.toUpperCase();
  if (/^[0-9a-fA-F]{3}$/.test(hex)) {
    return hex
      .split('')
      .map((c) => c + c)
      .join('')
      .toUpperCase();
  }

  const rgb = raw.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (rgb) {
    const to2 = (n: string) =>
      Math.max(0, Math.min(255, Number(n)))
        .toString(16)
        .padStart(2, '0');
    return (to2(rgb[1]) + to2(rgb[2]) + to2(rgb[3])).toUpperCase();
  }

  const named = NAMED_COLORS[raw.toLowerCase()];
  if (named) return named;
  return fallback;
}

/** 判断颜色是否带透明度语义（rgba 且 a<1 / transparent）。 */
export function isTransparentColor(v: unknown): boolean {
  if (typeof v !== 'string') return false;
  const raw = v.trim().toLowerCase();
  if (raw === 'transparent') return true;
  const m = raw.match(/^rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*([\d.]+)\s*\)$/);
  return !!m && Number(m[1]) < 1;
}

const ALIGNS: DeckAlign[] = ['left', 'center', 'right', 'justify'];
const VALIGNS: DeckVAlign[] = ['top', 'middle', 'bottom'];

function normalizeAlign(v: unknown, fallback: DeckAlign = 'left'): DeckAlign {
  return typeof v === 'string' && (ALIGNS as string[]).includes(v) ? (v as DeckAlign) : fallback;
}

/** 可选版本：非法值返回 undefined 而非兜底值，避免覆盖上层默认值。 */
function normalizeAlignOpt(v: unknown): DeckAlign | undefined {
  return typeof v === 'string' && (ALIGNS as string[]).includes(v) ? (v as DeckAlign) : undefined;
}

function normalizeVAlign(v: unknown, fallback: DeckVAlign = 'top'): DeckVAlign {
  return typeof v === 'string' && (VALIGNS as string[]).includes(v) ? (v as DeckVAlign) : fallback;
}

function normalizeTextRun(v: unknown): DeckTextRun | null {
  if (typeof v === 'string') return v ? { text: v } : null;
  if (!isRecord(v)) return null;
  const text = typeof v.text === 'string' ? v.text : '';
  if (!text) return null;
  return {
    text,
    bold: v.bold === true,
    italic: v.italic === true,
    underline: v.underline === true,
    fontSize: isFiniteNumber(v.fontSize) ? v.fontSize : undefined,
    fontFace: typeof v.fontFace === 'string' ? v.fontFace : undefined,
    color: typeof v.color === 'string' ? normalizeColor(v.color) : undefined,
    hyperlink: typeof v.hyperlink === 'string' ? v.hyperlink : undefined,
  };
}

/** 段落守卫。 */
export function isDeckParagraph(v: unknown): v is DeckParagraph {
  return isRecord(v) && Array.isArray(v.runs);
}

/** 归一化段落，非法输入返回空数组。 */
export function normalizeParagraphs(v: unknown): DeckParagraph[] {
  const list = Array.isArray(v) ? v : [v];
  const out: DeckParagraph[] = [];
  for (const item of list) {
    if (typeof item === 'string') {
      const run = normalizeTextRun(item);
      if (run) out.push({ runs: [run] });
      continue;
    }
    if (!isDeckParagraph(item)) continue;
    const runs = Array.isArray(item.runs)
      ? item.runs.map(normalizeTextRun).filter((r): r is DeckTextRun => r !== null)
      : [];
    if (runs.length === 0) continue;
    out.push({
      runs,
      align: normalizeAlignOpt(item.align),
      bullet: item.bullet === true,
      level: isFiniteNumber(item.level)
        ? Math.max(0, Math.min(4, Math.round(item.level)))
        : undefined,
      spaceAfter: isFiniteNumber(item.spaceAfter) ? item.spaceAfter : undefined,
      lineSpacing: isFiniteNumber(item.lineSpacing) ? item.lineSpacing : undefined,
    });
  }
  return out;
}

/** 节点守卫。 */
export function isDeckNode(v: unknown): v is DeckNode {
  if (!isRecord(v)) return false;
  const kind = v.kind;
  if (typeof kind !== 'string') return false;
  if (!['text', 'shape', 'image', 'table', 'chart', 'group'].includes(kind)) return false;
  return isDeckRect(v.rect);
}

/** 节点归一化：非法节点被丢弃，矩形被钳制进画布，形状/图表类型被降级兜底。 */
export function normalizeNodes(v: unknown): DeckNode[] {
  if (!Array.isArray(v)) return [];
  const out: DeckNode[] = [];
  for (const raw of v) {
    if (!isDeckNode(raw)) continue;
    const base = {
      id: typeof raw.id === 'string' ? raw.id : undefined,
      contentId: typeof raw.contentId === 'string' ? raw.contentId : undefined,
      contentColumn: raw.contentColumn === 'left' || raw.contentColumn === 'right' ? raw.contentColumn : undefined,
      contentOrder: isFiniteNumber(raw.contentOrder) ? raw.contentOrder : undefined,
      bullet: raw.bullet === true ? true : undefined,
      source: raw.source === 'plan' || raw.source === 'manual' || raw.source === 'legacy' ? raw.source : undefined,
      role: typeof raw.role === 'string' ? raw.role : undefined,
      locked: raw.locked === true ? true : undefined,
      rect: normalizeRect(raw.rect),
      rotate: isFiniteNumber(raw.rotate) ? raw.rotate : undefined,
      opacity: isFiniteNumber(raw.opacity) ? Math.max(0, Math.min(1, raw.opacity)) : undefined,
    };
    switch (raw.kind) {
      case 'text': {
        const paragraphs = normalizeParagraphs(raw.paragraphs);
        if (paragraphs.length === 0) break;
        out.push({
          ...base,
          kind: 'text',
          paragraphs,
          align: normalizeAlign(raw.align, 'left'),
          valign: normalizeVAlign(raw.valign, 'top'),
        });
        break;
      }
      case 'shape': {
        out.push({
          ...base,
          kind: 'shape',
          shape: isDeckShapeType(raw.shape) ? raw.shape : DEFAULT_DECK_SHAPE,
        });
        break;
      }
      case 'image': {
        if (typeof raw.src !== 'string' || !raw.src) break;
        out.push({ ...base, kind: 'image', src: raw.src });
        break;
      }
      case 'table': {
        const rows = Array.isArray(raw.rows) ? raw.rows.filter(Array.isArray) : [];
        if (rows.length === 0) break;
        out.push({ ...base, kind: 'table', rows: rows as DeckNodeTableRows });
        break;
      }
      case 'chart': {
        const spec = isRecord(raw.chart) ? raw.chart : null;
        if (!spec || !Array.isArray(spec.series)) break;
        out.push({
          ...base,
          kind: 'chart',
          chart: {
            ...spec,
            kind: normalizeDeckChartKind(spec.kind),
          } as DeckNodeChartSpec,
        });
        break;
      }
      case 'group': {
        const children = normalizeNodes(raw.children);
        if (children.length === 0) break;
        out.push({ ...base, kind: 'group', children });
        break;
      }
      default:
        break;
    }
  }
  return out;
}

type DeckNodeTableRows = Extract<DeckNode, { kind: 'table' }>['rows'];
type DeckNodeChartSpec = Extract<DeckNode, { kind: 'chart' }>['chart'];

/** Slide 守卫。 */
export function isDeckSlide(v: unknown): v is DeckSlide {
  return isRecord(v) && typeof v.id === 'string' && Array.isArray(v.nodes);
}

function isParityStatus(value: unknown): value is DeckSlide['parity'] {
  return value === 'pass' || value === 'fail' || value === 'needs_review' || value === 'unverified';
}

function isDeckSource(value: unknown): value is DeckSlide['source'] {
  return value === 'plan' || value === 'html' || value === 'manual';
}

/** Slide 归一化。 */
export function normalizeSlide(v: unknown): DeckSlide | null {
  if (!isDeckSlide(v)) return null;
  return {
    id: v.id,
    pageType: typeof v.pageType === 'string' ? v.pageType : undefined,
    title: typeof v.title === 'string' ? v.title : undefined,
    nodes: normalizeNodes(v.nodes),
    contentManifest: Array.isArray(v.contentManifest) ? v.contentManifest : undefined,
    layoutParams: v.layoutParams && isRecord(v.layoutParams) ? v.layoutParams : undefined,
    source: isDeckSource(v.source) ? v.source : undefined,
    geometryFallback: v.geometryFallback === true,
    parity: isParityStatus(v.parity) ? v.parity : undefined,
    parityIssues: Array.isArray(v.parityIssues)
      ? v.parityIssues.filter((issue): issue is string => typeof issue === 'string')
      : undefined,
    notes: typeof v.notes === 'string' ? v.notes : undefined,
    hidden: v.hidden === true,
  };
}

/** Deck 守卫。 */
export function isDeck(v: unknown): v is Deck {
  return isRecord(v) && typeof v.title === 'string' && Array.isArray(v.slides);
}

/** Deck 归一化：丢掉非法 slide，保证导出永不因脏数据崩溃。 */
export function normalizeDeck(v: unknown): Deck | null {
  if (!isDeck(v)) return null;
  const slides = Array.isArray(v.slides)
    ? v.slides.map(normalizeSlide).filter((s): s is DeckSlide => s !== null)
    : [];
  return {
    title: v.title,
    slides,
    master: isRecord(v.master) ? (v.master as Deck['master']) : undefined,
    theme: isRecord(v.theme) ? (v.theme as Deck['theme']) : undefined,
    meta: isRecord(v.meta) ? (v.meta as DeckMeta) : undefined,
    source:
      v.source === 'plan' || v.source === 'html' || v.source === 'manual' ? v.source : undefined,
    integrity: isRecord(v.integrity) && isParityStatus(v.integrity.status)
      ? {
          status: v.integrity.status,
          issues: Array.isArray(v.integrity.issues)
            ? v.integrity.issues.filter((issue): issue is string => typeof issue === 'string')
            : undefined,
        }
      : undefined,
  };
}

/** 枚举安全取用：非法值 → 兜底。 */
export function pickChartKind(v: unknown, fallback: DeckChartKind = 'bar'): DeckChartKind {
  if (typeof v !== 'string') return fallback;
  return (DECK_CHART_KINDS as string[]).includes(v)
    ? (v as DeckChartKind)
    : normalizeDeckChartKind(v);
}
