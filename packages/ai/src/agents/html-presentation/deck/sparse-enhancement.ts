/**
 * 稀疏页自动视觉增强（Deck 节点层）。
 *
 * 设计取舍（与 `content-density.ts` 一样刻意不经 `deck/index.ts` barrel）：
 * - 只被 `plan-to-deck` 直接 import，不扩大 `packages/ai` 公共具名导出面；
 * - 只**追加** `decoration` / `chart` 节点，不改写既有 text/shape，不动 contentManifest；
 * - 数据必须来自 SlidePlan 已有语义（metricItems / keyPoints / chart），严禁编造数字；
 * - 主题色由渲染器统一继承（`renderDecoration` 走 derivedDecor，`renderChart` 走 ctx.primary），
 *   本层不写死任何 hex，保证 HTML 与 PPTX 两个后端按同一份 Deck 渲染（parity）；
 * - 配图（有成本）只尊重 `imagePreference` / `imageEnabled`，本模块绝不主动生图：
 *   配图升级由既有的 `applyDeckImageGuard` 负责，这里只把「已允许配图」的页排除，
 *   避免同一页既升级带图版式又叠加确定性装饰造成拥挤。
 */

import type {
  DeckDecorationNode,
  DeckDecorationKind,
  DeckDecorationTone,
  DeckNode,
  DeckRect,
} from '@noppt/core/deck';
import type { ImagePreference, MetricItem, SlidePlan } from '../../../types';
import { DECK_BODY_RECT, toDeckChartSpec } from './layout-primitives';
import type { DeckLayoutContext } from './layout-primitives';
import { isStructurePage } from '../../../utils/image-plan-guard';

/** 增强手段：确定性零成本优先；配图仅在显式开启时由既有 guard 完成。 */
export type SparseEnhancementKind =
  | 'none'
  | 'chart'
  | 'timeline'
  | 'kpi'
  | 'badge'
  | 'quote'
  | 'image-deferred';

export interface SparseEnhancementOptions {
  /** 总开关，默认开启；调用方（如测试 / 兼容模式）可显式关闭。 */
  enabled?: boolean;
  /** 配图偏好：none / minimal 时不做任何配图相关升级。 */
  imagePreference?: ImagePreference;
  /** 图片生成总开关；未显式开启时不做配图升级。 */
  imageEnabled?: boolean;
}

export interface SparseEnhancementDecision {
  kind: SparseEnhancementKind;
  /** 人类可读的决策原因，落到 layoutParams.visualEnhancement 供审计。 */
  reason: string;
  /** 实际追加的节点数。 */
  added: number;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 结构页 / 已带图 / 已经是视觉结构化页型：不再叠加确定性装饰。 */
const NO_ENHANCE_PAGE_TYPES: ReadonlySet<string> = new Set([
  'cover',
  'toc',
  'summary',
  'content-image-left',
  'content-image-right',
  'content-image-top',
  'content-image-background',
  'content-dashboard',
]);

/** 已经是图表 / 时间轴 / 图标等结构化页型：布局自身已产出视觉元素。 */
const ALREADY_VISUAL_TYPES: ReadonlySet<string> = new Set([
  'content-chart-bar',
  'content-chart-line',
  'content-chart-pie',
  'content-chart-donut',
  'content-timeline',
  'content-icon-grid',
  'content-stats-highlight',
  'content-value-showcase',
  'comparison-deep-dive',
  'content-flowchart',
  'content-org-chart',
  'content-pyramid',
  'content-matrix',
  'content-cycle',
  'content-three-section',
  'content-process-steps',
]);

const TONE_CYCLE: readonly DeckDecorationTone[] = ['amber', 'teal', 'violet', 'rose', 'blue', 'neutral'];

function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** 稀疏页文本节点的「有效占位高度」上限：短句不会真的占满 520px 的 rect。 */
const TEXT_OCCUPANCY_CAP = 112;

/**
 * 收集「会与增强元素打架」的节点矩形。
 * - 排除 shape / group（卡片底色、边框、分隔线）：增强元素本就叠在卡片空白底色之上；
 * - 文本节点按「有效占位高度」而非整个 rect 计算：稀疏页 fitTextRect 常把一个短句
 *   放进数百像素高的 rect（垂直居中/靠顶），实际文字只占顶部或中部一小条。
 *   若按整个 rect 判占用，就永远找不到槽位，与「稀疏页铺满正文」的既有布局策略冲突。
 */
function contentRects(nodes: DeckNode[]): Rect[] {
  return nodes
    .filter((node) => node.kind !== 'shape' && node.kind !== 'group')
    .map((node) => {
      const rect = node.rect;
      if (node.kind !== 'text') return rect;
      const effectiveH = Math.min(rect.h, TEXT_OCCUPANCY_CAP);
      const valignTop = (node as { valign?: string }).valign === 'top';
      return valignTop
        ? { ...rect, h: effectiveH }
        : { ...rect, y: rect.y + Math.max(0, (rect.h - effectiveH) / 2), h: effectiveH };
    });
}

/**
 * 在正文安全区里找一个不与既有内容相交的槽位。
 * 槽位候选来自「内容块之间的空档」：按候选高度在正文区从下往上扫描，取第一个无碰撞位置。
 * 这样在内容页只有顶部一条标题、下方大片留白时（spacious 典型形态），能稳定命中底部空档。
 */
function findSafeSlot(nodes: DeckNode[], width: number, height: number): DeckRect | undefined {
  const occupied = contentRects(nodes);
  const w = Math.max(80, Math.min(width, DECK_BODY_RECT.w));
  const h = Math.max(32, Math.min(height, DECK_BODY_RECT.h));
  const stepY = 16;
  const maxY = DECK_BODY_RECT.y + DECK_BODY_RECT.h - h;
  for (let y = maxY; y >= DECK_BODY_RECT.y; y -= stepY) {
    for (let x = DECK_BODY_RECT.x; x + w <= DECK_BODY_RECT.x + DECK_BODY_RECT.w; x += stepY) {
      const candidate: Rect = { x, y, w, h };
      if (!occupied.some((rect) => intersects(candidate, rect))) return candidate;
    }
  }
  return undefined;
}

interface DecorationOptions {
  rect: DeckRect;
  tone: DeckDecorationTone;
  value: string;
  label?: string;
  progress?: number;
}

function decoration(
  id: string,
  kind: DeckDecorationKind,
  options: DecorationOptions,
): DeckDecorationNode {
  return {
    kind: 'decoration',
    id,
    role: 'decoration',
    decoration: kind,
    tone: options.tone,
    value: options.value,
    label: options.label,
    progress: options.progress,
    rect: options.rect,
  };
}

/** 从已有 metricItems 取「真实数值」的指标（omission 项不得编造数值）。 */
function realMetrics(sp: SlidePlan): Extract<MetricItem, { kind: 'metric' }>[] {
  return (sp?.metricItems ?? []).filter(
    (item): item is Extract<MetricItem, { kind: 'metric' }> =>
      item.kind === 'metric' && typeof item.value === 'string' && item.value.trim().length > 0,
  );
}

/** 从 keyPoints 取去空、去标题前缀后的正文短句，只取真实文本。 */
function realPoints(sp: SlidePlan): string[] {
  return (sp?.keyPoints ?? [])
    .map((text) => (typeof text === 'string' ? text.trim() : ''))
    .filter((text) => text.length > 0);
}

function canEnhance(sp: SlidePlan, density: DeckLayoutContext['density'], options: SparseEnhancementOptions): boolean {
  if (options.enabled === false) return false;
  if (density !== 'spacious') return false;
  const pageType = sp?.pageType ?? '';
  if (isStructurePage(pageType) || NO_ENHANCE_PAGE_TYPES.has(pageType)) return false;
  if (ALREADY_VISUAL_TYPES.has(pageType)) return false;
  return true;
}

/** 配图是否已被既有 guard 放行：放行时跳过确定性装饰，避免拥挤与重复付费。 */
function imageAlreadyAllowed(sp: SlidePlan, options: SparseEnhancementOptions): boolean {
  if (options.imageEnabled !== true) return false;
  if (options.imagePreference === 'none' || options.imagePreference === 'minimal') return false;
  if (sp?.referenceLockedImage) return true;
  return sp?.needsImage === true;
}

function buildKpiNodes(
  sp: SlidePlan,
  nodes: DeckNode[],
  prefix: string,
): { nodes: DeckNode[]; reason: string } | undefined {
  const metrics = realMetrics(sp).slice(0, 4);
  if (metrics.length === 0) return undefined;
  const cardW = Math.floor((DECK_BODY_RECT.w - 24 * (metrics.length - 1)) / metrics.length);
  const appended: DeckNode[] = [];
  let working = nodes;
  metrics.forEach((item, index) => {
    const slot = findSafeSlot(working, cardW, 96);
    if (!slot) return;
    const node = decoration(`${prefix}-enh-kpi-${index}`, 'kpi', {
      rect: slot,
      tone: TONE_CYCLE[index % TONE_CYCLE.length],
      value: item.value,
      label: item.label || item.description,
    });
    appended.push(node);
    working = [...working, node];
  });
  return appended.length > 0
    ? { nodes: appended, reason: `sparse kpi from ${appended.length} real metric(s)` }
    : undefined;
}

function buildTimelineNodes(
  sp: SlidePlan,
  nodes: DeckNode[],
  prefix: string,
): { nodes: DeckNode[]; reason: string } | undefined {
  const points = realPoints(sp).slice(0, 4);
  if (points.length < 2) return undefined;
  const appended: DeckNode[] = [];
  let working = nodes;
  points.forEach((text, index) => {
    const slot = findSafeSlot(working, 360, 48);
    if (!slot) return;
    const node = decoration(`${prefix}-enh-timeline-${index}`, 'timeline', {
      rect: slot,
      tone: TONE_CYCLE[index % TONE_CYCLE.length],
      value: '',
      label: text.slice(0, 42),
      progress: Math.round(((index + 1) / points.length) * 100),
    });
    appended.push(node);
    working = [...working, node];
  });
  return appended.length > 0
    ? { nodes: appended, reason: `sparse timeline from ${appended.length} real keyPoint(s)` }
    : undefined;
}

function buildBadgeNodes(
  sp: SlidePlan,
  nodes: DeckNode[],
  prefix: string,
): { nodes: DeckNode[]; reason: string } | undefined {
  const points = realPoints(sp);
  if (points.length === 0) return undefined;
  const first = points[0];
  const split = first.match(/^([^：:]{1,12})[：:]\s*(.+)$/);
  const label = split ? split[1] : first.slice(0, 12);
  const slot = findSafeSlot(nodes, 320, 56);
  if (!slot) return undefined;
  return {
    nodes: [decoration(`${prefix}-enh-badge-0`, 'badge', {
      rect: slot,
      tone: 'amber',
      value: label,
      label: '关键点',
    })],
    reason: 'sparse badge from real keyPoint',
  };
}

/**
 * 对稀疏内容页追加零成本视觉增强节点；返回决策与「可能追加节点」的新数组（不改输入）。
 */
export function applySparseEnhancement(
  sp: SlidePlan,
  nodes: DeckNode[],
  ctx: DeckLayoutContext,
  slideId: string,
  options: SparseEnhancementOptions = {},
): { nodes: DeckNode[]; decision: SparseEnhancementDecision } {
  const none: SparseEnhancementDecision = { kind: 'none', reason: 'not eligible', added: 0 };
  if (!canEnhance(sp, ctx.density, options)) return { nodes, decision: none };
  if (imageAlreadyAllowed(sp, options)) {
    return {
      nodes,
      decision: { kind: 'image-deferred', reason: 'image already allowed by plan/guard', added: 0 },
    };
  }

  const prefix = slideId || 'slide';
  const chartSlot = findSafeSlot(nodes, 480, 260);
  const spec = toDeckChartSpec(sp?.chart, 'bar');
  if (chartSlot && spec) {
    return {
      nodes: [...nodes, { kind: 'chart', rect: chartSlot, chart: spec }],
      decision: { kind: 'chart', reason: 'sparse chart from plan.chart (real data)', added: 1 },
    };
  }

  const kpi = buildKpiNodes(sp, nodes, prefix);
  if (kpi) {
    return { nodes: [...nodes, ...kpi.nodes], decision: { kind: 'kpi', reason: kpi.reason, added: kpi.nodes.length } };
  }

  const timeline = buildTimelineNodes(sp, nodes, prefix);
  if (timeline) {
    return {
      nodes: [...nodes, ...timeline.nodes],
      decision: { kind: 'timeline', reason: timeline.reason, added: timeline.nodes.length },
    };
  }

  const badge = buildBadgeNodes(sp, nodes, prefix);
  if (badge) {
    return { nodes: [...nodes, ...badge.nodes], decision: { kind: 'badge', reason: badge.reason, added: badge.nodes.length } };
  }

  return { nodes, decision: { ...none, reason: 'no safe slot or real data available' } };
}
