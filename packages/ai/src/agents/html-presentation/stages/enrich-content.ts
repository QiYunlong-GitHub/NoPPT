/**
 * 稀疏页内容扩写 stage。
 *
 * 设计要点（与项目其余 stage 一致）：
 * - 只用 deps.contentProvider（内容生成阶段模型），不新增 StageModelConfigs 字段、不改 MCP schema；
 * - 所有稀疏页合并为**一次** LLM 调用（控制成本与延迟）；
 * - 失败 / 非法 JSON / 数值越界时回退原 plan，非阻断，绝不因扩写让生成失败；
 * - 只改内容（keyPoints + typed 字段），保持 pageType / 标题 / 主色 / needsImage 不变；
 * - 严禁编造数字：数值守卫剔除越界 metricValues，omission 指标不被当作真实数值来源。
 */

import type { AgentDeps } from './deps';
import { switchStage } from './deps';
import type {
  CardItem,
  ComparisonItem,
  MetricItem,
  PresentationPlan,
  SlidePlan,
  SummaryItem,
} from '../../../types';
import type { GenerationCallback } from '../../../types';
import { measureContentVolume } from '../deck/content-density';
import { extractJson } from '../html-sanitize';
import { buildEnrichmentPrompt } from './content-enrichment.prompt';

const SPARSE_CHARS = 80;
const SPARSE_UNITS = 4;

/** 这些页型要求 typed 字段，缺失时视为内容不足；content-no-image 等只用 keyPoints 的不适用。 */
const REQUIRES_TYPED: ReadonlySet<string> = new Set([
  'content-cards',
  'content-compare',
  'comparison-deep-dive',
  'content-stats-highlight',
  'content-value-showcase',
  'summary',
]);

interface EnrichmentOptions {
  enabled: boolean;
  referenceText: string;
  onProgress?: GenerationCallback;
}

interface RawSlidePatch {
  index?: unknown;
  keyPoints?: unknown;
  comparisonItems?: unknown;
  metricValues?: unknown;
  advantageIndices?: unknown;
  cardItems?: unknown;
  metricItems?: unknown;
  showcaseMetrics?: unknown;
  summaryItems?: unknown;
}

/** 判定一页是否稀疏：字数不足 / 要点不足 / 缺 typed 字段，任一命中即需扩写。 */
export function isSparseSlide(sp: SlidePlan): boolean {
  if (sp.pageType === 'cover' || sp.pageType === 'summary' || sp.pageType === 'toc') return false;
  const { chars, units } = measureContentVolume(sp);
  if (chars < SPARSE_CHARS || units < SPARSE_UNITS) return true;
  const hasTyped =
    (sp.cardItems?.length ?? 0) > 0 ||
    (sp.comparisonItems?.length ?? 0) > 0 ||
    (sp.metricItems?.length ?? 0) > 0 ||
    (sp.showcaseMetrics?.length ?? 0) > 0 ||
    (sp.summaryItems?.length ?? 0) > 0;
  return REQUIRES_TYPED.has(sp.pageType) && !hasTyped;
}

function cleanStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim());
}

function clampMetrics(value: unknown, length: number): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const nums = value
    .filter((n): n is number => typeof n === 'number' && Number.isFinite(n))
    .map((n) => Math.max(0, Math.min(100, Math.round(n))))
    .slice(0, length);
  return nums.length === length ? nums : undefined;
}

function clampIndices(value: unknown, length: number): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const nums = value
    .filter((n): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n < length)
    .slice(0, length);
  return nums.length > 0 ? nums : undefined;
}

function pageTypeAllows(pageType: string, field: string): boolean {
  // 注意：metricValues 的合法性由 slide-contract 校验为「长度 === normalized.metricItems.length」，
  // 而 normalizeSlideContent 只为 content-stats-highlight 生成 metricItems。
  // 因此除 stats-highlight 外的页型一律不得写入 metricValues / advantageIndices，
  // 否则严格校验会 metric_count_mismatch 直接失败（comparison-deep-dive 靠成对 keyPoints 撑满即可）。
  const map: Record<string, string[]> = {
    'content-compare': ['comparisonItems'],
    'comparison-deep-dive': [],
    'content-cards': ['cardItems'],
    'content-stats-highlight': ['metricItems', 'metricValues', 'advantageIndices'],
    'content-value-showcase': ['showcaseMetrics'],
    'summary': ['summaryItems'],
  };
  return (map[pageType] ?? []).includes(field);
}

/** 把单个 patch 合并进 slide，只改内容字段，保持版式与身份字段不变。 */
export function mergeSlidePatch(slide: SlidePlan, patch: RawSlidePatch): SlidePlan {
  const next: SlidePlan = { ...slide };
  const keyPoints = cleanStrings(patch.keyPoints);
  if (keyPoints.length > 0) next.keyPoints = keyPoints;

  if (pageTypeAllows(slide.pageType, 'comparisonItems') && Array.isArray(patch.comparisonItems)) {
    const items: ComparisonItem[] = patch.comparisonItems
      .filter((it): it is Record<string, unknown> => !!it && typeof it === 'object')
      .map((it, i) => ({
        contentId: `enriched-cmp-${i + 1}`,
        text: typeof it.text === 'string' ? it.text.trim() : '',
        column: (it.column === 'right' ? 'right' : 'left') as 'left' | 'right',
        order: typeof it.order === 'number' ? it.order : i,
        bullet: true,
      }))
      .filter((it) => it.text.length > 0);
    if (items.length > 0) next.comparisonItems = items;
  }

  if (pageTypeAllows(slide.pageType, 'cardItems') && Array.isArray(patch.cardItems)) {
    const items: CardItem[] = patch.cardItems
      .filter((it): it is Record<string, unknown> => !!it && typeof it === 'object')
      .map((it, i) => ({
        contentId: `enriched-card-${i + 1}`,
        title: typeof it.title === 'string' ? it.title.trim() : undefined,
        body: typeof it.body === 'string' ? it.body.trim() : '',
      }))
      .filter((it) => it.body.length > 0);
    if (items.length > 0) next.cardItems = items;
  }

  if (pageTypeAllows(slide.pageType, 'metricItems') && Array.isArray(patch.metricItems)) {
    const items: MetricItem[] = patch.metricItems
      .filter((it): it is Record<string, unknown> => !!it && typeof it === 'object' && it.kind === 'metric')
      .map((it, i) => ({
        kind: 'metric' as const,
        contentId: `enriched-metric-${i + 1}`,
        order: i,
        label: typeof it.label === 'string' ? it.label.trim() : '',
        value: typeof it.value === 'string' ? it.value.trim() : '',
        description: typeof it.description === 'string' ? it.description.trim() : undefined,
      }))
      .filter((it) => it.label.length > 0 && it.value.length > 0);
    if (items.length > 0) next.metricItems = items;
  }

  if (pageTypeAllows(slide.pageType, 'showcaseMetrics') && Array.isArray(patch.showcaseMetrics)) {
    const items = patch.showcaseMetrics
      .filter((it): it is Record<string, unknown> => !!it && typeof it === 'object')
      .map((it) => ({
        label: typeof it.label === 'string' ? it.label.trim() : '',
        value: typeof it.value === 'string' ? it.value.trim() : '',
        trend: (
          it.trend === 'up' || it.trend === 'down' || it.trend === 'flat'
            ? it.trend
            : undefined
        ) as 'up' | 'down' | 'flat' | undefined,
      }))
      .filter((it) => it.label.length > 0 && it.value.length > 0);
    if (items.length > 0) next.showcaseMetrics = items;
  }

  if (pageTypeAllows(slide.pageType, 'summaryItems') && Array.isArray(patch.summaryItems)) {
    const items: SummaryItem[] = patch.summaryItems
      .filter((it): it is Record<string, unknown> => !!it && typeof it === 'object')
      .map((it, i) => ({
        contentId: `enriched-summary-${i + 1}`,
        text: typeof it.text === 'string' ? it.text.trim() : '',
        role: (it.role === 'action' || it.role === 'takeaway' ? it.role : 'point') as
          | 'point'
          | 'action'
          | 'takeaway',
      }))
      .filter((it) => it.text.length > 0);
    if (items.length > 0) next.summaryItems = items;
  }

  if (pageTypeAllows(slide.pageType, 'metricValues')) {
    const dims = next.keyPoints.length || next.comparisonItems?.length || 0;
    const metrics = clampMetrics(patch.metricValues, dims);
    if (metrics) next.metricValues = metrics;
  }
  if (pageTypeAllows(slide.pageType, 'advantageIndices')) {
    const dims = next.metricValues?.length || next.keyPoints.length || 0;
    const indices = clampIndices(patch.advantageIndices, dims);
    if (indices) next.advantageIndices = indices;
  }

  return next;
}

export interface EnrichmentResult {
  plan: PresentationPlan;
  enrichedCount: number;
  skipped: boolean;
}

/**
 * 对稀疏页做一次批量 LLM 扩写。非阻断：任何异常都返回原 plan。
 */
export async function enrichSparseContent(
  deps: AgentDeps,
  plan: PresentationPlan,
  options: EnrichmentOptions,
): Promise<EnrichmentResult> {
  const original = { plan, enrichedCount: 0, skipped: false };
  if (!options.enabled) return { ...original, skipped: true };
  const slides = Array.isArray(plan.slides) ? plan.slides : [];
  const sparse = slides
    .map((slide, index) => ({ slide, index }))
    .filter(({ slide }) => isSparseSlide(slide));
  if (sparse.length === 0) return { ...original, skipped: true };

  options.onProgress?.({
    phase: 'outline',
    current: 0,
    total: sparse.length,
    message: `正在扩写 ${sparse.length} 页稀疏内容...`,
  });

  try {
    switchStage(deps.contentProvider, 'content-enrichment');
    const response = await deps.contentProvider.chat(
      [
        { role: 'system', content: buildEnrichmentPrompt(sparse, options.referenceText) },
        { role: 'user', content: '请按输出格式只返回 JSON。' },
      ],
      { temperature: 0.3, maxTokens: Math.min(8192, 1024 + sparse.length * 640) },
    );
    const data = JSON.parse(extractJson(response.content));
    const patches: RawSlidePatch[] = Array.isArray(data?.slides) ? data.slides : [];
    if (patches.length === 0) return original;

    const newSlides = slides.map((slide, index) => {
      const patch = patches.find((p) => p.index === index);
      return patch ? mergeSlidePatch(slide, patch) : slide;
    });
    const enrichedCount = patches.filter((p) => p.index !== undefined).length;
    options.onProgress?.({
      phase: 'outline',
      current: sparse.length,
      total: sparse.length,
      message: `已扩写 ${enrichedCount} 页内容`,
    });
    return { plan: { ...plan, slides: newSlides }, enrichedCount, skipped: false };
  } catch (error) {
    console.warn('[ENRICH] 内容扩写失败，回退原计划:', error instanceof Error ? error.message : error);
    return original;
  }
}
