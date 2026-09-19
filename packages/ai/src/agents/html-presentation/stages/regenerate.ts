import type {
  AgentDeps,
} from './deps';
import {
  DesignProposal,
  IconStyle,
  PageCategory,
  PresentationGenerationOptions,
  PresentationPlan,
  ReferenceContext,
  ReferenceMaster,
  RenderedSlide,
} from '../../../types';
import {
  buildReferenceContext,
  computePageIndexInCategory,
  pageTypeToCategory,
  resolveDeckReferencePrimaryColor,
  resolveLayoutForPage,
  resolveMasterForPage,
  resolveReferencePrimaryColor,
} from '../../../utils/reference-attribute-resolver';
import {
  CHANNEL_BUDGET,
  MAX_RETRY_PER_SLIDE,
  PAGE_TYPE_DEFAULT_IMAGE_RATIO,
  darkenColor,
  incRetryCount,
  keyOf,
  resolveEffectivePrimaryColor,
} from '../shared';
import {
  TraceableProvider,
} from '../../../providers/base';
import {
  resolveReferenceTextColors,
  summarizeReferenceHtmlBrief,
} from '../prompts';
import {
  closeTraceSession,
  openTraceSession,
} from '../../../utils/llm-tracer';
import {
  DEFAULT_MAX_RETRIES,
  DEFAULT_THRESHOLD,
  SlideCritique,
  buildCritiqueFeedback,
  critiqueSlide,
} from '../../../templates/slide-critique';
import {
  resolvePageReferenceStyleAttrs,
} from '../plan-utils';
import {
  postProcessSlideHtml,
} from '../palette';
import {
  applyL0ToCritique,
  generateFallbackSlide,
  sanitizeRegenerationFeedback,
} from '../html-sanitize';
import {
  applyMasterToSlideHtml,
} from '../../../utils/apply-master-to-slide-html';

import { generateSlideHtml } from './generate-slide';
export async function regenerateSingleSlide(deps: AgentDeps, _topic: string, plan: PresentationPlan, design: DesignProposal, slideIndex: number, options?: PresentationGenerationOptions, traceSessionId?: string, externalFeedback?: string, channel: string = 'placeholder', originalHtml?: string): Promise<RenderedSlide> {
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
      options?.referenceHtmlBrief || summarizeReferenceHtmlBrief(referenceHtml);
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
    const rp = resolvePageReferenceStyleAttrs(slidePlan, referenceVisualAttributes, {
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
    (deps.contentProvider as TraceableProvider).activeTraceSessionId = traceSessionId;

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
            generateFallbackSlide(
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
            generateFallbackSlide(
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
      const refText = resolveReferenceTextColors(referenceVisualAttributes, regenPageType);
      const safeFeedback = externalFeedback
        ? sanitizeRegenerationFeedback(
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

      let html = await generateSlideHtml(deps, 
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
      html = postProcessSlideHtml(
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
          deps.contentProvider,
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
          applyL0ToCritique(critiqueResult, html, slidePlan.pageType || 'content-no-image');

        while (!critiqueResult.passed && attempts <= critiqueMaxRetries) {
          attempts++;
          const feedback = combinedFeedback(buildCritiqueFeedback(critiqueResult));
          html = await generateSlideHtml(deps, 
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
          html = postProcessSlideHtml(
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
            deps.contentProvider,
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
            applyL0ToCritique(critiqueResult, html, slidePlan.pageType || 'content-no-image');
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

