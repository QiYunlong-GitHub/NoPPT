import type {
  ComparisonItem,
  LegacyColumnManifest,
  PresentationPlan,
  SlidePlan,
} from '../../../types';

/**
 * strict Deck 之前的对比页安全归一。
 *
 * 只处理「裸 keyPoints 的 legacy content-compare」：偶数且非空时补齐 typed
 * ownership；奇数 / 单项 / 空项 / 非法 manifest 时降级为非对比页并保留全部非空要点。
 * 显式 comparisonItems 属于真实规划输入，保持原样交由 strict 校验判定，
 * 不伪造配对内容、不吞掉正文。
 */

export type CompareNormalizationStrategy = 'paired_legacy' | 'degraded_to_cards';

export interface CompareNormalizationNotice {
  slideIndex: number;
  fromPageType: string;
  toPageType: string;
  strategy: CompareNormalizationStrategy;
  retainedPoints: number;
  reason: string;
}

export interface CompareNormalizationResult {
  plan: PresentationPlan;
  notices: CompareNormalizationNotice[];
}

const SAFE_PAGE_TYPE = 'content-no-image' as const;

/** manifest 必须左右等量、order 非负整数、同列不重复且两列逐行对齐。 */
export function isPairedLegacyManifest(manifest: LegacyColumnManifest[]): boolean {
  if (!manifest.length || manifest.length % 2 !== 0) return false;
  if (!manifest.every(
    (entry) =>
      (entry.column === 'left' || entry.column === 'right') &&
      Number.isInteger(entry.order) &&
      entry.order >= 0,
  )) return false;
  const left = manifest.filter((entry) => entry.column === 'left').map((entry) => entry.order);
  const right = manifest.filter((entry) => entry.column === 'right').map((entry) => entry.order);
  if (left.length !== right.length || left.length === 0) return false;
  if (new Set(left).size !== left.length || new Set(right).size !== right.length) return false;
  const sortedLeft = [...left].sort((a, b) => a - b);
  const sortedRight = [...right].sort((a, b) => a - b);
  return sortedLeft.every((order, index) => order === sortedRight[index]);
}

export function formatCompareNormalizationNotices(notices: CompareNormalizationNotice[]): string {
  if (!notices.length) return 'none';
  return notices
    .map((notice) =>
      `slide${notice.slideIndex + 1} ${notice.fromPageType}->${notice.toPageType} ` +
      `${notice.strategy} retained=${notice.retainedPoints} reason=${notice.reason}`,
    )
    .join('; ');
}

function buildPairedItems(
  points: string[],
  slideIndex: number,
): { comparisonItems: ComparisonItem[]; legacyColumnManifest: LegacyColumnManifest[] } {
  const half = points.length / 2;
  const comparisonItems: ComparisonItem[] = points.map((text, index) => ({
    contentId: `strict-compare-${slideIndex}-${index}`,
    text,
    column: index < half ? 'left' : 'right',
    order: index < half ? index : index - half,
    bullet: true,
  }));
  const legacyColumnManifest: LegacyColumnManifest[] = comparisonItems.map((item) => ({
    column: item.column,
    order: item.order,
  }));
  return { comparisonItems, legacyColumnManifest };
}

function normalizeCompareSlide(
  slide: SlidePlan,
  slideIndex: number,
): { slide: SlidePlan; notice?: CompareNormalizationNotice } {
  if (slide?.pageType !== 'content-compare') return { slide };
  const typed = Array.isArray(slide.comparisonItems) ? slide.comparisonItems : undefined;
  if (typed && typed.length > 0) return { slide };

  const raw = Array.isArray(slide.keyPoints) ? slide.keyPoints : [];
  const points = raw.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  const manifest = Array.isArray(slide.legacyColumnManifest) ? slide.legacyColumnManifest : undefined;

  const manifestUsable =
    manifest !== undefined &&
    manifest.length === raw.length &&
    points.length === raw.length &&
    isPairedLegacyManifest(manifest);
  if (manifestUsable) return { slide };

  // 已经声明过 manifest 却非法，说明列归属不可信，不复用 keyPoints 硬凑配对。
  const paired = manifest === undefined && points.length >= 2 && points.length % 2 === 0 && points.length === raw.length;
  if (paired) {
    return {
      slide: { ...slide, ...buildPairedItems(points, slideIndex) },
      notice: {
        slideIndex,
        fromPageType: 'content-compare',
        toPageType: 'content-compare',
        strategy: 'paired_legacy',
        retainedPoints: points.length,
        reason: 'paired legacy keyPoints',
      },
    };
  }

  const degraded: SlidePlan = {
    ...slide,
    pageType: SAFE_PAGE_TYPE,
    keyPoints: points,
    comparisonItems: undefined,
    legacyColumnManifest: undefined,
  };
  return {
    slide: degraded,
    notice: {
      slideIndex,
      fromPageType: 'content-compare',
      toPageType: SAFE_PAGE_TYPE,
      strategy: 'degraded_to_cards',
      retainedPoints: points.length,
      reason: manifest === undefined
        ? `unpaired legacy keyPoints (${raw.length} total, ${points.length} non-empty)`
        : 'invalid legacyColumnManifest',
    },
  };
}

export function normalizeComparePlan(plan: PresentationPlan): CompareNormalizationResult {
  const slides = Array.isArray(plan?.slides) ? plan.slides : [];
  if (!slides.length) return { plan, notices: [] };
  const notices: CompareNormalizationNotice[] = [];
  let changed = false;
  const normalized = slides.map((slide, index) => {
    const result = normalizeCompareSlide(slide, index);
    if (result.slide !== slide) changed = true;
    if (result.notice) notices.push(result.notice);
    return result.slide;
  });
  return { plan: changed ? { ...plan, slides: normalized } : plan, notices };
}
