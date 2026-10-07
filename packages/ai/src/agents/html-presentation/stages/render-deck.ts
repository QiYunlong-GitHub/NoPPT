/**
 * render-deck.ts —— 确定性 Deck 渲染分支（feature flag `deterministicDeckPreview` 开启时走此路径）。
 *
 * 与 `render.ts`（LLM-HTML 路径，`generateSlideHtmlSafe`）并行上线：
 * - 复用既有模块：planToDeck（SlidePlan→Deck 节点树，含节点层配图决策 image-plan-guard）+
 *   deckSlideToHtml（节点→HTML，跳过 HTML 字符串手术与 postProcessSlideHtml 颜色/图表 pass）+
 *   critiqueDeckSlide（评审 Deck/Plan 节点树，复用与 HTML 路径同构的评审核心）。
 * - 关闭 flag 时由 `render.ts` 主流程回退 `generateSlideHtmlSafe`，既有行为零变更。
 *
 * 参考归一（与 render.ts 主流程同口径，缺一则参考 deck 会出现行为回退）：
 * 参考 layout 映射 pageType → pageType 兜底 → Q4 兜底配图 → 逐页参考主色覆盖。
 *
 * 结构说明（门禁 `max-lines-per-function` ≤200 / `max-params` ≤5）：
 * 单页渲染参数较多，统一聚合进 `DeckSlideJob` 上下文对象，避免函数签名膨胀。
 *
 * 红线：本文件为新增模块，仅由 `render.ts` 在 flag 开启时调用；不修改 `packages/ai/src/index.ts` /
 * `agents/index.ts` 既有具名导出，不删除任何既有文件。
 */

import type { AgentDeps } from './deps';
import type { Deck, DeckSlide } from '@noppt/core/deck';
import type {
  DesignProposal,
  IconStyle,
  ImagePreference,
  PresentationGenerationOptions,
  PresentationPlan,
  ReferenceContext,
  ReferenceMaster,
  ReferenceVisualAttributes,
  RenderedSlide,
  SlidePageType,
  SlidePlan,
} from '../../../types';
import {
  buildReferenceContext,
  computePageIndexInCategory,
  pageTypeToCategory,
  resolveDeckReferencePrimaryColor,
  resolveHeroImageForPage,
  resolveLayoutForPage,
  resolveMasterForPage,
  resolveReferencePrimaryColor,
} from '../../../utils/reference-attribute-resolver';
import { pLimit, resolveEffectivePrimaryColor } from '../shared';
import type { AIModelProvider, TraceableProvider } from '../../../providers/base';
import { formatBeijingTime } from '../../../providers/base';
import { openTraceSession, closeTraceSession } from '../../../utils/llm-tracer';
import {
  DEFAULT_MAX_RETRIES,
  DEFAULT_THRESHOLD,
  type SlideCritique,
} from '../../../templates/slide-critique';
import { generateFallbackSlide } from '../html-sanitize';
import { applyMasterToSlideHtml } from '../../../utils/apply-master-to-slide-html';
import {
  buildLayoutContext,
  buildValidatedDeck,
  critiqueDeckSlide,
  darkenHex,
  deckCritiqueContextFromDeck,
  deckSlideToHtml,
  type DeckLayoutContext,
} from '../deck';

/** 回传给 `RenderedSlide.critique` 的评审摘要（与 render.ts 形状一致）。 */
interface DeckCritiqueSummary {
  score: number;
  passed: boolean;
  attempts: number;
  issues: string[];
}

/** 单页渲染任务上下文（聚合参数，避免 max-params 门禁）。 */
interface DeckSlideJob {
  deps: AgentDeps;
  plan: PresentationPlan;
  slidePlan: SlidePlan;
  slide: Deck['slides'][number];
  ctx: DeckLayoutContext;
  critiqueCtx: ReturnType<typeof deckCritiqueContextFromDeck>;
  options?: PresentationGenerationOptions;
  master?: ReferenceMaster;
  referenceContext: ReferenceContext;
  originalIdx: number;
  renderCount: number;
  slideWidth: number;
  slideHeight: number;
  primaryColor: string;
  /** 逐页参考主色覆盖（参考 > deck 级兜底），与 render.ts 逐页语义一致。 */
  pagePrimary?: string;
  fontFamily: 'sans' | 'serif' | 'mono';
  iconStyle: IconStyle;
  critiqueEnabled: boolean;
  critiqueThreshold: number;
  critiqueMaxRetries: number;
}

/** 单页渲染结果。 */
interface DeckSlideResult {
  html: string;
  deck?: DeckSlide;
  plan: SlidePlan;
  originalIdx: number;
  pageType?: SlidePageType;
  critique?: DeckCritiqueSummary;
}

/**
 * 参考母版解析（FR-0/FR-3）：按分类取母版，并把该页参考原图作为 hero 挂上。
 * 与 `render.ts` 主流程口径一致，保证两条路径的母版/hero 注入行为等价。
 */
function resolveReferenceMaster(
  referenceVisualAttributes: ReferenceVisualAttributes | undefined,
  slidePlan: SlidePlan,
): ReferenceMaster | undefined {
  let master: ReferenceMaster | undefined = referenceVisualAttributes
    ? resolveMasterForPage(referenceVisualAttributes, pageTypeToCategory(slidePlan.pageType))
    : undefined;
  if (slidePlan.referenceHeroImage?.src) {
    master = {
      ...(master ?? {}),
      heroImage: {
        src: slidePlan.referenceHeroImage.src,
        ...(slidePlan.referenceHeroImage.bbox ?? {}),
      },
    } as ReferenceMaster;
  }
  return master;
}

/** 单页 Deck → HTML；评审开启时跑一次 Deck 评审；异常回落 generateFallbackSlide。 */
async function renderDeckSlideAt(job: DeckSlideJob): Promise<DeckSlideResult> {
  const { deps, slidePlan, slide, ctx, options, master, originalIdx } = job;
  const t0 = formatBeijingTime();
  console.log(
    `[${t0}] [AGENT-DECK] Rendering slide ${originalIdx + 1} (${slide.pageType}): "${slide.title}"`,
  );
  // 逐页参考主色覆盖（参考 > deck 级兜底），与 render.ts 逐页语义一致
  const slideCtx: DeckLayoutContext = job.pagePrimary
    ? { ...ctx, primary: job.pagePrimary, primaryDark: darkenHex(job.pagePrimary) }
    : ctx;
  try {
    const html = deckSlideToHtml(slide, slideCtx, {
      width: job.slideWidth,
      height: job.slideHeight,
      primaryColor: slideCtx.primary,
      primaryColorDarker: slideCtx.primaryDark,
      background: slideCtx.background,
      fontFamily: slideCtx.fontFamily,
      referenceMaster: master,
    });

    let critiqueResult: SlideCritique | null = null;
    let attempts = 1;

    if (job.critiqueEnabled) {
      critiqueResult = await critiqueDeckSlide(
        deps.contentProvider,
        slide,
        slidePlan,
        job.critiqueCtx,
        {
          threshold: job.critiqueThreshold,
          maxRetries: job.critiqueMaxRetries,
          slideWidth: job.slideWidth,
          slideHeight: job.slideHeight,
          referenceContext: job.referenceContext,
        },
      );
      attempts = 1;
      // Deck 路径为确定性渲染，无法按 HTML feedback 再生；评审不通过仅记录，不重试再生。
      if (critiqueResult.passed) {
        console.log(
          `[${formatBeijingTime()}] [CRITIQUE-DECK] Slide ${originalIdx + 1} PASSED score=${critiqueResult.overallScore}`,
        );
      } else {
        console.warn(
          `[${formatBeijingTime()}] [CRITIQUE-DECK] Slide ${originalIdx + 1} not passed score=${critiqueResult.overallScore} (deterministic, no regeneration)`,
        );
      }
      options?.onProgress?.({
        phase: 'critique',
        current: originalIdx,
        total: job.renderCount,
        message: `第 ${originalIdx + 1} 页评审${critiqueResult.passed ? '通过' : '未通过'}（${critiqueResult.overallScore}分）`,
        critique: {
          slideIndex: originalIdx,
          slideTitle: slidePlan.title || `幻灯片 ${originalIdx + 1}`,
          attempt: attempts,
          maxAttempts: job.critiqueMaxRetries + 1,
          score: critiqueResult.overallScore,
          passed: critiqueResult.passed,
          issues: critiqueResult.issues.map((i) => i.title),
        },
      });
    }

    console.log(
      `[${formatBeijingTime()}] [AGENT-DECK] Slide ${originalIdx + 1} HTML generated (${html.length} chars, critique=${critiqueResult?.overallScore ?? 'N/A'})`,
    );
    options?.onProgress?.({
      phase: 'content',
      current: originalIdx + 1,
      total: job.renderCount,
      message: `已生成 ${originalIdx + 1}/${job.plan.slides.length} 页内容`,
    });

    return {
      html,
      deck: slide,
      plan: slidePlan,
      originalIdx,
      pageType: slide.pageType as SlidePageType | undefined,
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
      `[${formatBeijingTime()}] [AGENT-DECK] Failed to render slide ${originalIdx + 1}, using fallback:`,
      e,
    );
    const fallback = generateFallbackSlide(
      slidePlan,
      job.primaryColor,
      job.slideWidth,
      job.slideHeight,
      job.fontFamily,
      job.iconStyle,
    );
    return {
      html: master ? applyMasterToSlideHtml(fallback, master) : fallback,
      plan: slidePlan,
      originalIdx,
      pageType: slidePlan.pageType,
    };
  }
}

/** 渲染结果 → RenderedSlide[]（统一出口再补一次母版注入，幂等）。 */
function toRenderedSlides(
  results: DeckSlideResult[],
  plan: PresentationPlan,
  referenceVisualAttributes?: ReferenceVisualAttributes,
): RenderedSlide[] {
  return results.map((r) => {
    const sp = r.plan;
    const m = resolveReferenceMaster(referenceVisualAttributes, sp);
    let html = r.html;
    if (m) html = applyMasterToSlideHtml(html, m);
    return {
      title: sp.title || plan.slides[r.originalIdx]?.title || `幻灯片 ${r.originalIdx + 1}`,
      html,
      deck: r.deck,
      pageType: (r.pageType ?? 'content-no-image') as SlidePageType,
      imagePrompt: sp.imagePrompt,
      imageRatio: sp.imageRatio || undefined,
      backgroundPrompt: plan.slides[r.originalIdx]?.backgroundPrompt,
      critique: r.critique,
    };
  });
}

/**
 * 参考归一：参考 layout 映射 pageType + pageType 兜底 + Q4 兜底配图。
 * 等价于 `render.ts` 主流程在逐页生成前的三段预处理，缺任一段都会让参考 deck 出现行为回退。
 */
function normalizeSlidesForDeck(
  plan: PresentationPlan,
  referenceVisualAttributes: ReferenceVisualAttributes | undefined,
  fallbackEnabled: boolean,
): PresentationPlan {
  const slides: SlidePlan[] = plan.slides.map((sp, i) => {
    const baseCat = pageTypeToCategory(sp.pageType);
    const pageIndexInCategory = computePageIndexInCategory(plan.slides, i);
    let pageType = sp.pageType;
    if (referenceVisualAttributes) {
      const resolvedLayout = resolveLayoutForPage(
        referenceVisualAttributes,
        baseCat,
        pageIndexInCategory,
        sp.pageType,
      );
      if (resolvedLayout) pageType = resolvedLayout;
    }
    if (!pageType) {
      pageType = i === 0 ? 'cover' : i === plan.slides.length - 1 ? 'summary' : 'content-no-image';
    }
    const next: SlidePlan = { ...sp, pageType };
    // Q4（FR-0 兜底配图）：关闭 AI 生图且参考含图时，挂参考原图避免内容页全篇无图。
    if (fallbackEnabled && !next.referenceHeroImage?.src) {
      const refHero = resolveHeroImageForPage(referenceVisualAttributes, pageType);
      if (refHero?.src) next.referenceHeroImage = { src: refHero.src, ...(refHero.bbox ?? {}) };
    }
    return next;
  });
  return { ...plan, slides };
}

/**
 * 确定性 Deck 渲染：把整份 plan 转成 Deck 节点树后逐页渲染为屏幕预览 HTML。
 * 出参与 `renderSlides` 完全一致，便于 flag 切换时调用方无感。
 */
export async function renderSlidesWithDeck(
  deps: AgentDeps,
  plan: PresentationPlan,
  design: DesignProposal,
  options?: PresentationGenerationOptions,
  traceSessionId?: string,
): Promise<RenderedSlide[]> {
  const imagePreference: ImagePreference = options?.imagePreference || 'content-only';
  // 归一化 iconStyle：与 render.ts 保持一致（旧值 checkmark/minimal 映射到 bullet）
  const finalIconStyle = (options?.iconStyle || design.iconStyle || 'auto') as string;
  const iconStyle: IconStyle =
    finalIconStyle === 'checkmark' || finalIconStyle === 'minimal'
      ? 'bullet'
      : (finalIconStyle as IconStyle);
  const fontFamily = options?.fontFamily || design.fontFamily;
  const referenceVisualAttributes = options?.referenceVisualAttributes;
  // FR-0/FR-4：参考主色前置裁决（参考 > 用户显式 > 主题 > 默认蓝），与 render.ts 同口径
  const refDeckPrimary = resolveDeckReferencePrimaryColor(referenceVisualAttributes);
  const primaryColor = refDeckPrimary ?? resolveEffectivePrimaryColor(options, design, '#2563eb');
  const slideWidth = options?.slideWidth || 1280;
  const slideHeight = options?.slideHeight || 720;

  const imgProvider = (options?.imageProvider || deps.provider) as AIModelProvider;
  // 图片开关与 render.ts 同口径：imageOptions.enabled 且非 pref=none
  const imageEnabled = options?.imageOptions?.enabled && imagePreference !== 'none';

  // Trace session：若外部已传入则复用；否则自行打开并在结束时关闭
  let ownTraceSession = false;
  if (!traceSessionId) {
    traceSessionId = `trace_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    openTraceSession(traceSessionId);
    ownTraceSession = true;
  }
  (deps.contentProvider as TraceableProvider).activeTraceSessionId = traceSessionId;
  (deps.editingProvider as TraceableProvider).activeTraceSessionId = traceSessionId;
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
    const critiqueThreshold = options?.critique?.threshold ?? DEFAULT_THRESHOLD;
    const critiqueMaxRetries = options?.critique?.maxRetries ?? DEFAULT_MAX_RETRIES;
    const critiqueEnabled =
      (options?.critique?.enabled ?? false) && (options?.critique?.llmCritique ?? true);
    const referenceContext: ReferenceContext = buildReferenceContext(referenceVisualAttributes);

    const fallbackEnabled =
      ((options as { referenceFallbackImage?: boolean } | undefined)?.referenceFallbackImage ??
        true) &&
      imagePreference === 'none';
    const deckPlan = normalizeSlidesForDeck(plan, referenceVisualAttributes, fallbackEnabled);

    // 整份 plan → Deck（节点层 image-plan-guard 在此完成占位/升级/剥离决策）
    const deckResult = buildValidatedDeck(deckPlan, {
      width: slideWidth,
      height: slideHeight,
      background: '#ffffff',
      fontFamily,
      imageEnabled,
      imagePreference,
      includePageNumber: true,
      validationMode: 'strict',
    });
    if (deckResult.status !== 'pass' || !deckResult.deck) {
      throw new Error(`Deck contract validation failed: ${deckResult.issues.map((issue) => issue.code).join(', ')}`);
    }
    const deck = deckResult.deck;
    const ctx = buildLayoutContext(deckPlan, { background: '#ffffff', fontFamily });
    const critiqueCtx = deckCritiqueContextFromDeck(deck);

    options?.onProgress?.({
      phase: 'content',
      current: 0,
      total: renderCount,
      message: '正在生成幻灯片内容（确定性 Deck 渲染）...',
    });

    const jobs: DeckSlideJob[] = indicesToRender.map((originalIdx) => {
      const slidePlan = deckPlan.slides[originalIdx];
      return {
        deps,
        plan: deckPlan,
        slidePlan,
        slide: deck.slides[originalIdx],
        ctx,
        critiqueCtx,
        options,
        master: resolveReferenceMaster(referenceVisualAttributes, slidePlan),
        referenceContext,
        originalIdx,
        renderCount,
        slideWidth,
        slideHeight,
        primaryColor,
        pagePrimary:
          resolveReferencePrimaryColor(
            referenceVisualAttributes,
            String(slidePlan.pageType ?? ''),
          ) ?? undefined,
        fontFamily,
        iconStyle,
        critiqueEnabled,
        critiqueThreshold,
        critiqueMaxRetries,
      };
    });

    const results = await Promise.all(jobs.map((job) => limit(() => renderDeckSlideAt(job))));

    return toRenderedSlides(results, deckPlan, referenceVisualAttributes);
  } finally {
    if (ownTraceSession && traceSessionId) {
      closeTraceSession(traceSessionId);
    }
  }
}
