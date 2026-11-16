/**
 * 内容密度自适应（Deck 路径内部模块）。
 *
 * 该文件刻意不经过 `deck/index.ts` 的 `export *` barrel：只被布局 owner 直接 import，
 * 因此不会扩大 `packages/ai` 的公共具名导出面。
 *
 * 旧 `density` 只是 viewport 的空钩子（生产恒 standard），本模块把「一页实际承载多少内容」
 * 变成真值来源：内容少 → spacious（放大卡片与视觉主角，把正文区用满）；
 * 内容多 → compact（收紧行距与间距，保证不溢出），即双向自适应。
 */

import type { DeckRect } from '@noppt/core/deck';
import type { DeckLayoutContext } from './layout-primitives';
import type { SlidePlan } from '../../../types';

export type ResolvedDensity = NonNullable<DeckLayoutContext['density']>;

export interface ContentVolume {
  /** 可独立成块的内容单元数（typed 字段优先，裸 keyPoints 兜底）。 */
  units: number;
  /** 本页正文字符数（中文按 1 字计，空白不计）。 */
  chars: number;
}

function charCount(value: unknown): number {
  return typeof value === 'string' ? Array.from(value.replace(/\s/g, '')).length : 0;
}

/** 统计一页的有效内容量，typed 字段与 keyPoints 取较大者，避免重复计数。 */
export function measureContentVolume(sp: SlidePlan): ContentVolume {
  const keyPoints = Array.isArray(sp?.keyPoints) ? sp.keyPoints : [];
  const typedCounts = [
    sp?.cardItems?.length,
    sp?.comparisonItems?.length,
    sp?.summaryItems?.length,
    sp?.metricItems?.length,
    sp?.showcaseMetrics?.length,
    sp?.architecture?.nodes?.length,
  ].filter((n): n is number => typeof n === 'number' && n > 0);
  const units = Math.max(keyPoints.length, ...typedCounts, 0);
  const typedChars = [
    ...(sp?.cardItems ?? []).flatMap((item) => [item.title, item.body]),
    ...(sp?.comparisonItems ?? []).map((item) => item.text),
    ...(sp?.summaryItems ?? []).map((item) => item.text),
    ...(sp?.metricItems ?? []).flatMap((item) => item.kind === 'metric'
      ? [item.label, item.value, item.description]
      : [item.originalText]),
    ...(sp?.showcaseMetrics ?? []).flatMap((item) => [item.label, item.value]),
  ].reduce((sum, value) => sum + charCount(value), 0);
  const keyChars = keyPoints.reduce((sum, text) => sum + charCount(text), 0);
  return { units, chars: Math.max(keyChars, typedChars) };
}

/**
 * 由内容量 + 视口共同裁决密度，两个方向都要生效：
 * 稀疏页放大视觉块、稠密页收紧间距；窄屏更紧凑，宽屏更舒展。
 */
export function resolveContentDensity(sp: SlidePlan, ctx: DeckLayoutContext): ResolvedDensity {
  const { units, chars } = measureContentVolume(sp);
  let level = chars >= 160 || units >= 6 ? 2 : chars < 80 || units <= 3 ? 0 : 1;
  if (ctx.viewportProfile === 'narrow') level += 1;
  if (ctx.viewportProfile === 'wide' && level > 0) level -= 1;
  if (level >= 2) return 'compact';
  if (level <= 0) return 'spacious';
  return 'standard';
}

/** 密度对应的行间距（8pt 网格内）。 */
export function densityGap(ctx: DeckLayoutContext): number {
  if (ctx.density === 'compact') return 8;
  if (ctx.density === 'spacious') return 24;
  return 16;
}

/**
 * 把给定区域均匀切成 N 行并铺满，不留「内容 hug 后居中」造成的空洞。
 * 行高不足 24px 时自动收紧 gap，保证所有 rect 仍在区域内。
 */
export function fillRowRects(rect: DeckRect, count: number, gap: number): DeckRect[] {
  const n = Math.max(1, Math.min(12, Math.floor(count)));
  const availableGap = Math.max(0, Math.floor((rect.h - 24 * n) / Math.max(1, n - 1)));
  const g = Math.max(0, Math.min(Math.round(gap), availableGap));
  const h = Math.max(24, Math.floor((rect.h - g * (n - 1)) / n));
  return Array.from({ length: n }, (_, index) => ({
    x: rect.x,
    y: rect.y + index * (h + g),
    w: rect.w,
    h,
  }));
}
