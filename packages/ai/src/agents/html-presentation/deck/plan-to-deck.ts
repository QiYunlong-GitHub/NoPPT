/**
 * `PresentationPlan` → `Deck` 转换器。
 *
 * 这是 Deck 的**主来源**：计划阶段的结构化语义（pageType / keyPoints / chart /
 * architecture / showcaseMetrics / layoutParams）直接摆到 1280×720 绝对定位画布上，
 * 不需要再让 LLM 吐一遍结构化数据（省 token，也不会破坏现有 HTML 生成链路）。
 *
 * 纯 TS、无 DOM 依赖，可在 Node 与浏览器同构运行。
 */

import {
  normalizeColor,
  type Deck,
  type DeckColor,
  type DeckMaster,
  type DeckMeta,
  type DeckSlide,
  type DeckTheme,
} from '@noppt/core/deck';
import type { ImagePreference, MetricItem, PresentationPlan, SlidePlan } from '../../../types';
import {
  normalizePresentationPlan,
  normalizeSlideContent,
  validateSlideContent,
} from './slide-contract';
import type { collectRequiredContent, PlanContractIssue } from './slide-contract';
import {
  DECK_BODY_RECT,
  DECK_CONTENT_RECT,
  DECK_NEUTRAL,
  DEFAULT_DECK_LAYOUT_CONTEXT,
  layoutSlideNodes,
  resolveViewportProfile,
  type DeckLayoutContext,
  type ViewportProfile,
} from './layout-templates';
import { applyDeckImageGuard } from './image-plan-guard';

export interface PlanToDeckOptions {
  /** 画布宽（px），默认 1280。 */
  width?: number;
  /** 画布高（px），默认 720。 */
  height?: number;
  /** 背景色，默认白。 */
  background?: DeckColor;
  /** 字体族（PPTX 侧用于中文字体兜底）。 */
  fontFamily?: string;
  /** 是否生成页脚页码（母版 slideNumber）。 */
  includePageNumber?: boolean;
  /** 母版标题，默认 NOPPT_MASTER。 */
  masterTitle?: string;
  /** 逐页备注注入（index → notes）；缺省留空由上层（Slide.notes）合并。 */
  notesResolver?: (index: number, slide: SlidePlan) => string | undefined;
  /** 配图偏好（节点层 image-plan-guard 使用）；与 `imageEnabled` 同时传入才生效。 */
  imagePreference?: ImagePreference;
  /** 图片生成开关（节点层 image-plan-guard 使用）；明确传入时才对 Deck 节点树应用配图决策。 */
  imageEnabled?: boolean;
  /** Validation mode for typed content. Legacy keeps old callers readable. */
  validationMode?: 'legacy' | 'strict';
  /** Optional layout metadata retained for the validated contract. */
  layoutProfile?: string;
  fontProfile?: string;
  /** Actual viewport used for density/reflow selection; logical coordinates stay 1280×720. */
  viewport?: { width: number; height: number };
  viewportProfile?: ViewportProfile;
  density?: 'compact' | 'standard' | 'spacious';
}

export interface PlanToDeckResult {
  deck?: Deck;
  normalizedPlan: PresentationPlan;
  issues: PlanContractIssue[];
  status: 'pass' | 'fail' | 'needs_review';
}

export class PlanContractError extends Error {
  readonly code = 'plan_contract_invalid';
  constructor(readonly issues: PlanContractIssue[]) {
    super(`Presentation plan failed contract validation (${issues.length} issue(s))`);
    this.name = 'PlanContractError';
  }
}

export function darkenHex(hex: string, amount = 0.18): DeckColor {
  const v = parseInt(hex, 16);
  if (!Number.isFinite(v)) return hex;
  const ch = (n: number) => Math.max(0, Math.min(255, Math.round(n * (1 - amount))));
  const r = ch((v >> 16) & 255);
  const g = ch((v >> 8) & 255);
  const b = ch(v & 255);
  return [r, g, b]
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

/** 由 plan 主色 + 选项构造布局上下文。 */
export function buildLayoutContext(
  plan: PresentationPlan,
  options?: PlanToDeckOptions,
): DeckLayoutContext {
  const primary = normalizeColor(plan?.primaryColor, DEFAULT_DECK_LAYOUT_CONTEXT.primary);
  const viewport = options?.viewport ?? { width: 1280, height: 720 };
  const viewportProfile = options?.viewportProfile
    ?? (options?.layoutProfile === 'narrow' || options?.layoutProfile === 'standard' || options?.layoutProfile === 'wide'
      ? options.layoutProfile
      : resolveViewportProfile(viewport.width, viewport.height));
  return {
    ...DEFAULT_DECK_LAYOUT_CONTEXT,
    primary,
    primaryDark: darkenHex(primary),
    background: normalizeColor(options?.background, DEFAULT_DECK_LAYOUT_CONTEXT.background),
    fontFamily: options?.fontFamily,
    logicalWidth: 1280,
    logicalHeight: 720,
    viewport,
    viewportProfile,
    density: options?.density ?? (viewportProfile === 'narrow' ? 'compact' : viewportProfile === 'wide' ? 'spacious' : 'standard'),
    fontProfile: options?.fontProfile,
  };
}

/** 构造 deck 级主题。 */
export function buildDeckTheme(ctx: DeckLayoutContext, plan: PresentationPlan): DeckTheme {
  return {
    primary: ctx.primary,
    primaryDark: ctx.primaryDark,
    background: ctx.background,
    text: ctx.text,
    textMuted: ctx.textMuted,
    fontFamily: ctx.fontFamily,
    style: plan?.slides?.[0]?.styleTheme,
  };
}

/**
 * 构造母版 —— 借鉴 PptxGenJS `defineSlideMaster`。
 * HTML 侧用它产出 deck 级页脚/页码片段消除跨页风格漂移；
 * PPTX 侧它成为 PowerPoint 中一等公民的 Layout（可在「视图 → 幻灯片母版」二次编辑）。
 */
export function buildDeckMaster(ctx: DeckLayoutContext, options?: PlanToDeckOptions): DeckMaster {
  const master: DeckMaster = {
    title: options?.masterTitle || 'NOPPT_MASTER',
    background: { type: 'solid', color: ctx.background },
    margin: [48, 64, 48, 64],
    objects: [],
    placeholders: [
      { name: 'title', type: 'title', rect: { ...DECK_CONTENT_RECT, h: 72 } },
      { name: 'body', type: 'body', rect: DECK_BODY_RECT },
    ],
  };
  if (options?.includePageNumber !== false) {
    master.slideNumber = {
      x: 1136,
      y: 640,
      w: 80,
      h: 32,
      align: 'right',
      color: DECK_NEUTRAL.muted,
      fontSize: 14,
    };
  }
  return master;
}

/** 构造 deck 元信息（→ PPTX docProps/core.xml）。 */
export function buildDeckMeta(plan: PresentationPlan): DeckMeta {
  return {
    title: plan?.title,
    subject: plan?.description,
    keywords:
      plan?.slides
        ?.map((s) => s.title)
        .filter(Boolean)
        .slice(0, 12)
        .join('; ') || undefined,
  };
}

/** Attach stable content identity metadata to generated text nodes without changing layout geometry. */
function annotateContentNodes(
  nodes: DeckSlide['nodes'],
  required: ReturnType<typeof collectRequiredContent>,
): DeckSlide['nodes'] {
  const used = new Set<string>();
  const visit = (node: DeckSlide['nodes'][number]): DeckSlide['nodes'][number] => {
    if (node.kind === 'group') return { ...node, children: node.children.map(visit) };
    if (node.kind !== 'text' && node.kind !== 'shape') return node;
    if (node.contentId) {
      used.add(node.contentId);
      return node;
    }
    const textValue = node.kind === 'text'
      ? node.paragraphs.flatMap((paragraph) => paragraph.runs.map((run) => run.text)).join(' ').trim()
      : (node.text ?? []).flatMap((paragraph) => paragraph.runs.map((run) => run.text)).join(' ').trim();
    if (!textValue || node.role === 'title') return node;
    const match = required.find((item) => !used.has(item.contentId) && (item.text === textValue || item.text.includes(textValue) || textValue.includes(item.text)));
    const fallback = match ?? required.find((item) => !used.has(item.contentId));
    if (!fallback) return node;
    used.add(fallback.contentId);
    return { ...node, contentId: fallback.contentId, source: 'plan' };
  };
  return nodes.map(visit);
}

/** 单页 plan →单页 deck slide。 */
export function slidePlanToDeckSlide(
  sp: SlidePlan,
  ctx: DeckLayoutContext,
  index: number,
  options?: PlanToDeckOptions,
): DeckSlide {
  // 节点层配图决策（image-plan-guard）：仅在 imageEnabled 明确传入时生效，
  // 避免改变既有 planToDeck(plan) 默认行为（向后兼容既有测试与调用方）。
  // 升级后 pageType 可能变化（如 内容页 → content-image-left），故节点树与返回 pageType 都用 guarded。
  const guarded =
    options?.imageEnabled !== undefined
      ? applyDeckImageGuard(sp, {
          imagePreference: options.imagePreference ?? 'content-only',
          imageEnabled: options.imageEnabled,
        })
      : sp;
  const withIndex: SlidePlan & { _index?: number } = { ...guarded };
  (withIndex as { _index?: number })._index = index;
  const validation = validateSlideContent(guarded, index);
  const metricContent = normalizeSlideContent(guarded, index).metricItems;
  const descriptionStateByContentId = Object.fromEntries(
    metricContent.map((item) => [
      item.contentId,
      item.kind === 'metric' && item.description ? 'provided' : 'not_provided',
    ]),
  );
  const metricMeasuredRegionsByContentId = Object.fromEntries(
    metricContent.map((item) => [
      item.contentId,
      item.kind === 'metric'
        ? ['value', 'label', ...(item.description ? ['description'] : []), ...(item.trend && item.trend !== 'flat' ? ['trend'] : [])]
        : ['omission'],
    ]),
  );
  const omissionReasonByContentId = Object.fromEntries(
    metricContent.filter((item): item is Extract<MetricItem, { kind: 'omission' }> => item.kind === 'omission')
      .map((item) => [item.contentId, item.reason]),
  );
  const nodes = annotateContentNodes(layoutSlideNodes(withIndex, ctx), validation.requiredItems);
  const measurementStatus = nodes.some((node) => node.kind === 'text' && node.autoFit) ? 'fail' : 'pass';
  return {
    id: `slide-${index + 1}`,
    pageType: guarded?.pageType,
    title: sp?.title,
    nodes,
    contentManifest: validation.requiredItems.map((item, order) => {
      const comparison = validation.normalized.comparisonItems.find((candidate) => candidate.contentId === item.contentId);
      const omission = validation.omissions.find((candidate) => candidate.contentId === item.contentId);
      return {
        contentId: item.contentId,
        text: item.text,
        role: item.role,
        order: comparison?.order ?? order,
        column: comparison?.column,
        bullet: comparison?.bullet,
        required: true,
        status: omission?.status ?? 'present',
        sourceText: omission?.originalText,
        omissionReason: omission?.reason,
      };
    }),
    notes: options?.notesResolver?.(index, sp),
    layoutParams: {
      ...(sp?.layoutParams as unknown as Record<string, unknown> | undefined),
      logicalCanvas: { width: 1280, height: 720 },
      viewportProfile: ctx.viewportProfile,
      density: ctx.density,
      fontProfile: ctx.fontProfile,
      measurementStatus,
      descriptionStateByContentId,
      metricMeasuredRegionsByContentId,
      omissionReasonByContentId,
      legacyDerived: validation.normalized.comparisonItems.some((item) => item.legacyDerived),
      warnings: validation.issues.filter((issue) => issue.recoverable).map((issue) => issue.code),
    },
  };
}

function buildDeckFromPlan(plan: PresentationPlan, options?: PlanToDeckOptions): Deck {
  const ctx = buildLayoutContext(plan, options);
  const slides: DeckSlide[] = (plan.slides ?? []).map((sp, i) =>
    slidePlanToDeckSlide(sp, ctx, i, options),
  );
  return {
    title: plan.title || '未命名演示',
    slides,
    master: buildDeckMaster(ctx, options),
    theme: buildDeckTheme(ctx, plan),
    meta: buildDeckMeta(plan),
    source: 'plan',
  };
}

/** Validate and build a Deck while retaining every issue for callers and reports. */
export function buildValidatedDeck(
  plan: PresentationPlan,
  options: PlanToDeckOptions = {},
): PlanToDeckResult {
  const normalized = normalizePresentationPlan(plan ?? ({ title: '', primaryColor: '', slides: [] } as PresentationPlan));
  const fatal = normalized.issues.some((issue) => !issue.recoverable);
  const status = fatal ? 'fail' : normalized.issues.length > 0 ? 'needs_review' : 'pass';
  const deck = fatal && options.validationMode !== 'legacy'
    ? undefined
    : buildDeckFromPlan(normalized.plan, options);
  return { deck, normalizedPlan: normalized.plan, issues: normalized.issues, status };
}

/**
 * Backward-compatible bare Deck API. Legacy plans are normalized first so text is
 * retained, but callers that need a persistence gate should use buildValidatedDeck
 * with `validationMode: 'strict'`.
 */
export function planToDeck(plan: PresentationPlan, options?: PlanToDeckOptions): Deck {
  const result = buildValidatedDeck(plan ?? ({ title: '', primaryColor: '', slides: [] } as PresentationPlan), {
    ...options,
    validationMode: options?.validationMode ?? 'legacy',
  });
  if (!result.deck) throw new PlanContractError(result.issues);
  return result.deck;
}

/**
 * Deck 构建入口：`PresentationPlan` → 完整 Deck（slides + master + theme + meta）。
 */
export function buildDeck(plan: PresentationPlan, options?: PlanToDeckOptions): Deck {
  return planToDeck(plan, options);
}
