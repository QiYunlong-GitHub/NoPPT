import type {
  CardItem,
  ComparisonItem,
  ContentOmission,
  MetricItem,
  PresentationPlan,
  SlidePlan,
  SummaryItem,
} from '../../../types';

export const MAX_TITLE_LENGTH = 500;
export const MAX_ITEM_TEXT_LENGTH = 10_000;
export const MAX_ITEMS_PER_SLIDE = 32;

export type ContractIssueCode =
  | 'invalid_slide'
  | 'empty_required_text'
  | 'duplicate_content_id'
  | 'invalid_content_id'
  | 'content_text_too_long'
  | 'too_many_items'
  | 'compare_column_count'
  | 'compare_invalid_order'
  | 'compare_duplicate_order'
  | 'compare_pair_alignment'
  | 'compare_column_ownership_unverified'
  | 'metric_count_mismatch'
  | 'metric_value_not_separable'
  | 'metric_label_not_provided'
  | 'card_body_missing'
  | 'summary_item_missing'
  | 'omission_reason_missing';

export interface PlanContractIssue {
  code: ContractIssueCode;
  slideIndex: number;
  contentId?: string;
  path: string;
  expected: string;
  observed: string;
  recoverable: boolean;
}

export interface RequiredContentItem {
  contentId: string;
  text: string;
  role: 'title' | 'subtitle' | 'kicker' | 'compare' | 'metric' | 'card' | 'summary' | 'body';
  sourceIndex: number;
}

export interface CoverContentItem {
  contentId: string;
  text: string;
  role: 'title' | 'subtitle' | 'kicker';
  sourceIndex: number;
}

export interface NormalizedSlideContent {
  coverItems: CoverContentItem[];
  comparisonItems: ComparisonItem[];
  metricItems: MetricItem[];
  cardItems: CardItem[];
  summaryItems: SummaryItem[];
  omissions: ContentOmission[];
}

export interface ValidatedSlideContent {
  normalized: NormalizedSlideContent;
  issues: PlanContractIssue[];
  requiredItems: RequiredContentItem[];
  omissions: ContentOmission[];
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function sourceItems(slide: SlidePlan): string[] {
  return Array.isArray(slide?.keyPoints) ? slide.keyPoints.map((item) => text(item)) : [];
}

function idFor(slideIndex: number, kind: string, sourceIndex: number, explicit?: unknown): string {
  const candidate = text(explicit);
  return candidate || `slide-${slideIndex + 1}-${kind}-${sourceIndex + 1}`;
}

function splitTitleBody(raw: string): { title?: string; body: string; compact: boolean } {
  const match = raw.match(/^([^：:|｜]{2,28})\s*[：:|｜]\s*(.+)$/u);
  if (match) return { title: match[1].trim(), body: match[2].trim(), compact: false };
  return { body: raw, compact: true };
}

function parseLegacyMetric(raw: string, contentId: string, order: number): MetricItem {
  // Keep the numeric token and its Chinese/Latin unit together.  The suffix is
  // intentionally conservative: if no readable label remains, the full source
  // becomes an omission rather than an invented metric label.
  const match = raw.match(/^(.*?)([-+]?\d[\d,]*(?:\.\d+)?\s*(?:个百分点|%|％|°C|℃|°|倍|万(?:人|户|元)?|亿(?:人|户|元)?|千(?:人|户|元)?|百(?:人|户|元)?|[a-zA-Z]+)?)(.*)$/u);
  if (!match) {
    return {
      kind: 'omission',
      contentId,
      order,
      originalText: raw,
      reason: 'value_not_separable',
      status: 'omitted',
      legacyDerived: true,
    };
  }
  const label = `${match[1]}${match[3]}`.trim();
  const value = match[2].trim();
  if (!label || !value) {
    return {
      kind: 'omission',
      contentId,
      order,
      originalText: raw,
      reason: !value ? 'value_not_separable' : 'label_not_provided',
      status: 'needs_review',
      legacyDerived: true,
    };
  }
  return { kind: 'metric', contentId, order, label, value, originalText: raw, legacyDerived: true };
}

function normalizeCompare(slide: SlidePlan, slideIndex: number): ComparisonItem[] {
  const typed = Array.isArray(slide?.comparisonItems) ? slide.comparisonItems : undefined;
  if (typed) {
    return typed.map((item, index) => ({
      ...item,
      contentId: idFor(slideIndex, 'compare', index, item?.contentId),
      text: text(item?.text),
      column: item?.column === 'right' ? 'right' : 'left',
      order: Number.isInteger(item?.order) ? item.order : index,
      bullet: Boolean(item?.bullet),
    }));
  }
  const raw = sourceItems(slide);
  const manifest = Array.isArray(slide.legacyColumnManifest) ? slide.legacyColumnManifest : undefined;
  if (manifest && manifest.length === raw.length) {
    return raw.map((value, index) => ({
      contentId: idFor(slideIndex, 'compare', index),
      text: value,
      column: manifest[index].column,
      order: manifest[index].order,
      bullet: true,
      legacyDerived: true,
    }));
  }
  const half = Math.ceil(raw.length / 2);
  return raw.map((value, index) => ({
    contentId: idFor(slideIndex, 'compare', index),
    text: value,
    column: index < half ? 'left' : 'right',
    order: index < half ? index : index - half,
    bullet: true,
    legacyDerived: true,
  }));
}

function normalizeMetrics(slide: SlidePlan, slideIndex: number): MetricItem[] {
  if (Array.isArray(slide?.metricItems)) {
    return slide.metricItems.map((item, index) => {
      const contentId = idFor(slideIndex, 'metric', index, item?.contentId);
      if (item?.kind === 'omission') return { ...item, contentId, order: index, originalText: text(item.originalText) };
      return {
        ...item,
        kind: 'metric',
        contentId,
        order: index,
        label: text(item?.label),
        value: text(item?.value),
        description: text(item?.description) || undefined,
      };
    });
  }
  if (Array.isArray(slide?.showcaseMetrics) && slide.showcaseMetrics.length > 0) {
    return slide.showcaseMetrics.map((item, index) => ({
      kind: 'metric',
      contentId: idFor(slideIndex, 'metric', index),
      order: index,
      label: text(item?.label),
      value: text(item?.value),
      trend: item?.trend,
      legacyDerived: true,
    }));
  }
  return sourceItems(slide).map((value, index) => parseLegacyMetric(value, idFor(slideIndex, 'metric', index), index));
}

function normalizeCards(slide: SlidePlan, slideIndex: number): CardItem[] {
  if (Array.isArray(slide?.cardItems)) {
    return slide.cardItems.map((item, index) => {
      const title = text(item?.title) || undefined;
      const body = text(item?.body) || (item?.compact && title ? title : '');
      return {
        ...item,
        contentId: idFor(slideIndex, 'card', index, item?.contentId),
        title,
        body,
        compact: Boolean(item?.compact || !title),
        legacyDerived: item?.legacyDerived,
      };
    });
  }
  return sourceItems(slide).map((value, index) => {
    const parsed = splitTitleBody(value);
    return {
      contentId: idFor(slideIndex, 'card', index),
      title: parsed.title,
      body: parsed.body,
      compact: parsed.compact,
      legacyDerived: true,
    };
  });
}

function normalizeSummary(slide: SlidePlan, slideIndex: number): SummaryItem[] {
  if (Array.isArray(slide?.summaryItems)) {
    return slide.summaryItems.map((item, index) => ({
      ...item,
      contentId: idFor(slideIndex, 'summary', index, item?.contentId),
      text: text(item?.text),
      role: item?.role || 'point',
    }));
  }
  return sourceItems(slide).map((value, index) => ({
    contentId: idFor(slideIndex, 'summary', index),
    text: value,
    role: 'point',
    legacyDerived: true,
  }));
}

function normalizeCover(slide: SlidePlan, slideIndex: number): CoverContentItem[] {
  if (text(slide?.pageType) !== 'cover') return [];
  const title = text(slide?.title);
  const items: CoverContentItem[] = [];
  if (title) items.push({ contentId: `slide-${slideIndex + 1}-title`, text: title, role: 'title', sourceIndex: -1 });
  sourceItems(slide).forEach((value, index) => {
    if (!value) return;
    items.push({
      contentId: `slide-${slideIndex + 1}-cover-${index + 1}`,
      text: value,
      role: index === 0 ? 'subtitle' : index === 1 ? 'subtitle' : 'kicker',
      sourceIndex: index,
    });
  });
  return items;
}

export function normalizeSlideContent(slide: SlidePlan, slideIndex: number): NormalizedSlideContent {
  const pageType = text(slide?.pageType);
  return {
    coverItems: normalizeCover(slide, slideIndex),
    comparisonItems: pageType === 'content-compare' ? normalizeCompare(slide, slideIndex) : [],
    metricItems: pageType === 'content-stats-highlight' ? normalizeMetrics(slide, slideIndex) : [],
    cardItems: pageType === 'content-cards' ? normalizeCards(slide, slideIndex) : [],
    summaryItems: pageType === 'summary' ? normalizeSummary(slide, slideIndex) : [],
    omissions: Array.isArray(slide?.omissions) ? slide.omissions : [],
  };
}

function validateIdAndText(
  item: { contentId: string; text: string },
  path: string,
  slideIndex: number,
  issues: PlanContractIssue[],
): void {
  if (!/^[A-Za-z0-9_.-]{1,128}$/u.test(item.contentId)) {
    issues.push({ code: 'invalid_content_id', slideIndex, contentId: item.contentId, path, expected: 'safe contentId', observed: item.contentId, recoverable: false });
  }
  if (!item.text) {
    issues.push({ code: 'empty_required_text', slideIndex, contentId: item.contentId, path, expected: 'non-empty text', observed: '', recoverable: false });
  } else if (item.text.length > MAX_ITEM_TEXT_LENGTH) {
    issues.push({ code: 'content_text_too_long', slideIndex, contentId: item.contentId, path, expected: `<= ${MAX_ITEM_TEXT_LENGTH} characters`, observed: String(item.text.length), recoverable: false });
  }
}

export function collectRequiredContent(content: NormalizedSlideContent): RequiredContentItem[] {
  const result: RequiredContentItem[] = [];
  content.coverItems.forEach((item) => result.push(item));
  content.comparisonItems.forEach((item, sourceIndex) => result.push({ contentId: item.contentId, text: item.text, role: 'compare', sourceIndex }));
  content.metricItems.forEach((item, sourceIndex) => {
    if (item.kind === 'metric') result.push({ contentId: item.contentId, text: `${item.value} ${item.label}`.trim(), role: 'metric', sourceIndex });
    else if (item.originalText.trim()) result.push({ contentId: item.contentId, text: item.originalText.trim(), role: 'metric', sourceIndex });
  });
  content.cardItems.forEach((item, sourceIndex) => result.push({ contentId: item.contentId, text: [item.title, item.body].filter(Boolean).join(' — '), role: 'card', sourceIndex }));
  content.summaryItems.forEach((item, sourceIndex) => result.push({ contentId: item.contentId, text: item.text, role: 'summary', sourceIndex }));
  return result;
}

export function collectOmissions(content: NormalizedSlideContent): ContentOmission[] {
  return [
    ...content.omissions,
    ...content.metricItems.filter((item): item is Extract<MetricItem, { kind: 'omission' }> => item.kind === 'omission'),
  ];
}

export function validateSlideContent(slide: SlidePlan, slideIndex: number): ValidatedSlideContent {
  const normalized = normalizeSlideContent(slide, slideIndex);
  const issues: PlanContractIssue[] = [];
  if (!slide || typeof slide !== 'object') {
    issues.push({ code: 'invalid_slide', slideIndex, path: 'slide', expected: 'object', observed: typeof slide, recoverable: false });
    return { normalized, issues, requiredItems: [], omissions: collectOmissions(normalized) };
  }
  if (text(slide.title).length > MAX_TITLE_LENGTH) {
    issues.push({ code: 'content_text_too_long', slideIndex, path: 'title', expected: `<= ${MAX_TITLE_LENGTH} characters`, observed: String(text(slide.title).length), recoverable: false });
  }
  const required = collectRequiredContent(normalized);
  if (required.length > MAX_ITEMS_PER_SLIDE) {
    issues.push({ code: 'too_many_items', slideIndex, path: 'content', expected: `<= ${MAX_ITEMS_PER_SLIDE} items`, observed: String(required.length), recoverable: false });
  }
  const ids = new Set<string>();
  for (const item of required) {
    if (ids.has(item.contentId)) issues.push({ code: 'duplicate_content_id', slideIndex, contentId: item.contentId, path: 'contentId', expected: 'unique per slide', observed: item.contentId, recoverable: false });
    ids.add(item.contentId);
    validateIdAndText(item, `content.${item.role}[${item.sourceIndex}]`, slideIndex, issues);
  }
  normalized.comparisonItems.forEach((item, index) => {
    if (!Number.isInteger(item.order) || item.order < 0) issues.push({ code: 'compare_invalid_order', slideIndex, contentId: item.contentId, path: `comparisonItems[${index}].order`, expected: 'non-negative integer', observed: String(item.order), recoverable: false });
  });
  if (normalized.comparisonItems.length > 0) {
    const left = normalized.comparisonItems.filter((item) => item.column === 'left').length;
    const right = normalized.comparisonItems.filter((item) => item.column === 'right').length;
    if (left !== right) issues.push({ code: 'compare_column_count', slideIndex, path: 'comparisonItems', expected: 'equal left/right item counts', observed: `${left}/${right}`, recoverable: false });
    const ordersByColumn = new Map<'left' | 'right', number[]>();
    for (const item of normalized.comparisonItems) {
      const orders = ordersByColumn.get(item.column) ?? [];
      if (orders.includes(item.order)) {
        issues.push({ code: 'compare_duplicate_order', slideIndex, contentId: item.contentId, path: 'comparisonItems.order', expected: 'unique order within each column', observed: `${item.column}:${item.order}`, recoverable: false });
      }
      orders.push(item.order);
      ordersByColumn.set(item.column, orders);
    }
    const leftOrders = [...(ordersByColumn.get('left') ?? [])].sort((a, b) => a - b);
    const rightOrders = [...(ordersByColumn.get('right') ?? [])].sort((a, b) => a - b);
    if (leftOrders.length !== rightOrders.length || leftOrders.some((order, index) => order !== rightOrders[index])) {
      issues.push({ code: 'compare_pair_alignment', slideIndex, path: 'comparisonItems.order', expected: 'matching row orders in both columns', observed: `${leftOrders.join(',')}/${rightOrders.join(',')}`, recoverable: false });
    }
    if (normalized.comparisonItems.some((item) => item.legacyDerived) && !slide.legacyColumnManifest) issues.push({ code: 'compare_column_ownership_unverified', slideIndex, path: 'comparisonItems', expected: 'explicit column manifest', observed: 'legacy keyPoints', recoverable: true });
  }
  normalized.metricItems.forEach((item, index) => {
    if (item.kind === 'metric') {
      if (!item.label) issues.push({ code: 'empty_required_text', slideIndex, contentId: item.contentId, path: `metricItems[${index}].label`, expected: 'non-empty label', observed: '', recoverable: false });
      if (!item.value) issues.push({ code: 'empty_required_text', slideIndex, contentId: item.contentId, path: `metricItems[${index}].value`, expected: 'non-empty value', observed: '', recoverable: false });
    }
  });
  const metricCount = normalized.metricItems.length;
  if (Array.isArray(slide.metricValues) && slide.metricValues.length !== metricCount) {
    issues.push({ code: 'metric_count_mismatch', slideIndex, path: 'metricValues', expected: String(metricCount), observed: String(slide.metricValues.length), recoverable: false });
  }
  normalized.cardItems.forEach((item, index) => {
    if (!item.body) issues.push({ code: 'card_body_missing', slideIndex, contentId: item.contentId, path: `cardItems[${index}].body`, expected: 'body or compact content', observed: '', recoverable: false });
  });
  normalized.summaryItems.forEach((item, index) => {
    if (!item.text) issues.push({ code: 'summary_item_missing', slideIndex, contentId: item.contentId, path: `summaryItems[${index}].text`, expected: 'non-empty summary text', observed: '', recoverable: false });
  });
  for (const omission of normalized.omissions) {
    if (ids.has(omission.contentId)) issues.push({ code: 'duplicate_content_id', slideIndex, contentId: omission.contentId, path: 'omissions.contentId', expected: 'unique per slide', observed: omission.contentId, recoverable: false });
    ids.add(omission.contentId);
    if (omission.originalText !== undefined && !text(omission.originalText)) issues.push({ code: 'empty_required_text', slideIndex, contentId: omission.contentId, path: 'omissions.originalText', expected: 'original text preserved', observed: '', recoverable: false });
    if (!text(omission.reason)) issues.push({ code: 'omission_reason_missing', slideIndex, contentId: omission.contentId, path: 'omissions.reason', expected: 'reason', observed: '', recoverable: false });
  }
  return { normalized, issues, requiredItems: required, omissions: collectOmissions(normalized) };
}

export function normalizePresentationPlan(plan: PresentationPlan): { plan: PresentationPlan; issues: PlanContractIssue[]; slides: ValidatedSlideContent[] } {
  const safePlan = plan ?? ({ title: '', primaryColor: '', slides: [] } as PresentationPlan);
  const issues: PlanContractIssue[] = [];
  const slides = (safePlan.slides ?? []).map((slide, index) => {
    const validation = validateSlideContent(slide, index);
    issues.push(...validation.issues);
    const content = validation.normalized;
    const projectedKeyPoints = content.comparisonItems.length
      ? content.comparisonItems.map((item) => item.text)
      : content.metricItems.length
        ? content.metricItems.map((item) => item.kind === 'metric' ? `${item.label} ${item.value}`.trim() : item.originalText)
        : content.cardItems.length
          ? content.cardItems.map((item) => [item.title, item.body].filter(Boolean).join('：'))
          : content.summaryItems.length
            ? content.summaryItems.map((item) => item.text)
            : sourceItems(slide);
    const projected = {
      ...slide,
      keyPoints: projectedKeyPoints,
      comparisonItems: content.comparisonItems,
      metricItems: content.metricItems,
      cardItems: content.cardItems,
      summaryItems: content.summaryItems,
      omissions: content.omissions,
    } as SlidePlan;
    return { ...validation, normalized: content, projected };
  });
  return { plan: { ...safePlan, slides: slides.map((slide) => slide.projected) }, issues, slides };
}
