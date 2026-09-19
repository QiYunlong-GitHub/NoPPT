import type {
  AgentDeps,
} from './deps';
import {
  DesignProposal,
  IconStyle,
  ImagePreference,
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
  resolveHeroImageForPage,
  resolveLayoutForPage,
  resolveMasterForPage,
  resolveReferencePrimaryColor,
} from '../../../utils/reference-attribute-resolver';
import {
  CHANNEL_BUDGET,
  COLOR_THEMES,
  HTMLSlide,
  IMAGE_PLACEHOLDER,
  MAX_RETRY_PER_SLIDE,
  PAGE_TYPE_DEFAULT_IMAGE_RATIO,
  incRetryCount,
  keyOf,
  pLimit,
  resolveEffectivePrimaryColor,
} from '../shared';
import {
  AIModelProvider,
  TraceableProvider,
  formatBeijingTime,
} from '../../../providers/base';
import {
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
} from '../html-sanitize';
import {
  applyMasterToSlideHtml,
} from '../../../utils/apply-master-to-slide-html';
import {
  isStructurePage,
  resolveSlideImageDecision,
  stripImagePlaceholders,
} from '../../../utils/image-plan-guard';
import {
  injectImagePlaceholderForContentSlide,
  slideHasMeaningfulBody,
} from '../postprocess';

import { generateSlideHtmlSafe } from './generate-slide';
export async function renderSlides(deps: AgentDeps, _topic: string, plan: PresentationPlan, design: DesignProposal, options?: PresentationGenerationOptions, traceSessionId?: string): Promise<RenderedSlide[]> {
    const style = options?.style || 'business';
    const audience = options?.audience || '';
    const density = design.density;
    const imagePreference = options?.imagePreference || 'content-only';
    // 归一化iconStyle：将旧值checkmark/minimal映射到bullet（向后兼容本地存储旧值）
    const finalIconStyle = (options?.iconStyle || design.iconStyle || 'auto') as string;
    const iconStyle: IconStyle =
      finalIconStyle === 'checkmark' || finalIconStyle === 'minimal'
        ? 'bullet'
        : (finalIconStyle as IconStyle);
    const fontFamily = options?.fontFamily || design.fontFamily;
    const referenceHtml = options?.referenceHtml || '';
    const colorTheme = options?.colorTheme || design.colorTheme;
    // 参考视觉属性前置读取，供主色裁决使用（原位于 2712 处，后移至此，避免逐页后处理引用时尚未定义）
    const referenceVisualAttributes = options?.referenceVisualAttributes;

    // FR-0/FR-4：参考主色前置裁决（参考 > 用户显式 > 主题 > 默认蓝）。
    // 无参考时 refDeckPrimary 为 undefined，完整回落原 5 级链，行为与改造前逐字节一致。
    const refDeckPrimary = resolveDeckReferencePrimaryColor(referenceVisualAttributes);
    const primaryColor = refDeckPrimary ?? resolveEffectivePrimaryColor(options, design, '#2563eb');

    // 设计参数生效日志：展示 renderSlides 实际使用的 effective 参数
    console.log(
      `[DESIGN] effective: style=${style} colorTheme=${colorTheme} primaryColor=${primaryColor}(single-source${refDeckPrimary ? ', reference-first' : ''}) iconStyle=${iconStyle} fontFamily=${fontFamily} audience=${audience || ''}`,
    );
    // 一致性告警（防线）：用户显式给了 colorTheme 但未显式给 primaryColor 时，effective 主色应等于 theme 色。
    // 参考主色生效属预期不一致（参考 > 用户全局设置），跳过以避免噪音掩盖真实问题。
    if (
      !refDeckPrimary &&
      options?.colorTheme &&
      !options?.primaryColor &&
      primaryColor.toLowerCase() !== (COLOR_THEMES[options.colorTheme] || '').toLowerCase()
    ) {
      console.warn(
        `[DESIGN] primaryColor(${primaryColor}) 与 colorTheme(${options.colorTheme}) 不一致，应为 ${COLOR_THEMES[options.colorTheme]}（用户未显式指定主色时）。`,
      );
    }

    const imgProvider = (options?.imageProvider || deps.provider) as AIModelProvider;
    const imageEnabled = options?.imageOptions?.enabled && imagePreference !== 'none';
    const backgroundEnabled = options?.backgroundEnabled || false;
    const slideWidth = options?.slideWidth || 1280;
    const slideHeight = options?.slideHeight || 720;

    // S1：生成 referenceHtml 摘要（≤500 字符），两侧 prompt 都注入
    const referenceHtmlBrief =
      options?.referenceHtmlBrief || summarizeReferenceHtmlBrief(referenceHtml);

    const onProgress = options?.onProgress;

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
      const critiqueEnabled = options?.critique?.enabled ?? false;
      const critiqueThreshold = options?.critique?.threshold ?? DEFAULT_THRESHOLD;
      const critiqueMaxRetries = options?.critique?.maxRetries ?? DEFAULT_MAX_RETRIES;
      const llmCritiqueEnabled = critiqueEnabled && (options?.critique?.llmCritique ?? true);
      onProgress?.({
        phase: 'content',
        current: 0,
        total: renderCount,
        message: '正在生成幻灯片内容...',
      });
      const htmlResults = await Promise.all(
        indicesToRender.map((originalIdx) =>
          limit(async () => {
            const slidePlan = plan.slides[originalIdx];
            const baseCat: PageCategory = pageTypeToCategory(slidePlan.pageType);
            // 计算本页在所属分类内的序号（第 0 页才克隆参考结构），供布局映射与逐页参考指令复用（共享函数：等价内联）
            const pageIndexInCategory = computePageIndexInCategory(plan.slides, originalIdx);
            const referenceContext: ReferenceContext =
              buildReferenceContext(referenceVisualAttributes);
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
            // FR-0/FR-4：逐页用参考主色覆盖（参考 > deck 级兜底），与内容阶段 formatReferenceOverrideForPage 逐页语义一致
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
            // Q4（FR-0 兜底配图）：用户关闭 AI 生图（imagePreference==='none'）且参考图含图时，
            // 把该分类参考原图作为「兜底配图」挂到本页（复用现有 hero 注入链路，带蒙版），
            // 避免内容页全篇无图。可被 options.referenceFallbackImage=false 关闭。
            const fallbackEnabled =
              ((options as any)?.referenceFallbackImage ?? true) && rp.imagePreference === 'none';
            if (fallbackEnabled && !slidePlan.referenceHeroImage?.src) {
              const refHero = resolveHeroImageForPage(
                referenceVisualAttributes,
                slidePlan.pageType,
              );
              if (refHero?.src) {
                slidePlan.referenceHeroImage = { src: refHero.src, ...(refHero.bbox ?? {}) };
                master = {
                  ...(master ?? {}),
                  heroImage: { src: refHero.src, ...(refHero.bbox ?? {}) },
                } as ReferenceMaster;
              }
            }
            // Task5 · 布局字段写入（FR-18 §18.2）：参考 layout 1:1 映射为内置 pageType，按分类作用域生效（复用 pageIndexInCategory）
            if (referenceVisualAttributes) {
              const resolvedLayout = resolveLayoutForPage(
                referenceVisualAttributes,
                baseCat,
                pageIndexInCategory,
                slidePlan.pageType,
              );
              if (resolvedLayout) slidePlan.pageType = resolvedLayout;
            }
            // FR-0/FR-4 兜底：保证 slidePlan.pageType 非空，使生成结果与终局防线能按页取到正确分类
            // （空 pageType 会让 pageTypeToCategory 回落 'content'，封面/总结无法取到各自参考色；且 undefined 不会落盘）。
            if (!slidePlan.pageType) {
              slidePlan.pageType =
                originalIdx === 0
                  ? 'cover'
                  : originalIdx === plan.slides.length - 1
                    ? 'summary'
                    : 'content-no-image';
            }
            const designContext = {
              style: rp.style,
              primaryColor: rp.primaryColor,
              fontFamily: rp.fontFamily,
              iconStyle: rp.iconStyle,
            };
            const t0 = formatBeijingTime();
            console.log(
              `[${t0}] [AGENT] Generating HTML for slide ${originalIdx + 1} (${slidePlan.pageType}): "${slidePlan.title}"`,
            );
            try {
              let html = await generateSlideHtmlSafe(deps, 
                slidePlan,
                rp,
                slideWidth,
                slideHeight,
                audience,
                colorTheme,
                referenceHtmlBrief,
                undefined,
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
                critiqueResult = await critiqueSlide(
                  deps.contentProvider,
                  slidePlan.title || `幻灯片 ${originalIdx + 1}`,
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
                  applyL0ToCritique(
                    critiqueResult,
                    html,
                    slidePlan.pageType || 'content-no-image',
                  );
                attempts = 1;

                while (!critiqueResult.passed && attempts <= critiqueMaxRetries) {
                  const st = incRetryCount(keyOf(traceSessionId), originalIdx, 'critique');
                  console.log(
                    `[RETRY] page=${originalIdx + 1} stage=critique attempt=${st.channelCount} total=${st.total} score=${critiqueResult.overallScore}`,
                  );
                  if (st.channelCount > CHANNEL_BUDGET.critique) {
                    console.warn(
                      `[RETRY] 通道 critique 配额已尽（${CHANNEL_BUDGET.critique}），页 ${originalIdx + 1} 保留当前版本不再重试（regenerationLimited）`,
                    );
                    break;
                  }
                  if (st.total >= MAX_RETRY_PER_SLIDE) {
                    console.warn(
                      `[RETRY] 页 ${originalIdx + 1} 已达重试上限 ${MAX_RETRY_PER_SLIDE}，保留当前版本不再重试（regenerationLimited）`,
                    );
                    break;
                  }
                  attempts++;
                  onProgress?.({
                    phase: 'critique',
                    current: originalIdx,
                    total: renderCount,
                    message: `第 ${originalIdx + 1} 页评审未通过（${critiqueResult.overallScore}分），第 ${attempts} 次重新生成...`,
                    critique: {
                      slideIndex: originalIdx,
                      slideTitle: slidePlan.title || `幻灯片 ${originalIdx + 1}`,
                      attempt: attempts,
                      maxAttempts: critiqueMaxRetries + 1,
                      score: critiqueResult.overallScore,
                      passed: false,
                      issues: critiqueResult.issues.map((i) => i.title),
                    },
                  });
                  console.log(
                    `[${formatBeijingTime()}] [CRITIQUE] Slide ${originalIdx + 1} score=${critiqueResult.overallScore}, retry ${attempts}/${critiqueMaxRetries + 1}. Issues: ${critiqueResult.issues.map((i) => i.title).join('; ')}`,
                  );

                  const feedback = buildCritiqueFeedback(critiqueResult);

                  html = await generateSlideHtmlSafe(deps, 
                    slidePlan,
                    rp,
                    slideWidth,
                    slideHeight,
                    audience,
                    colorTheme,
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
                    backgroundEnabled,
                    rp.fontFamily,
                    referenceVisualAttributes,
                  );

                  critiqueResult = await critiqueSlide(
                    deps.contentProvider,
                    slidePlan.title || `幻灯片 ${originalIdx + 1}`,
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
                    applyL0ToCritique(
                      critiqueResult,
                      html,
                      slidePlan.pageType || 'content-no-image',
                    );
                }

                if (critiqueResult.passed) {
                  console.log(
                    `[${formatBeijingTime()}] [CRITIQUE] Slide ${originalIdx + 1} PASSED with score=${critiqueResult.overallScore} after ${attempts} attempt(s)`,
                  );
                } else {
                  console.warn(
                    `[${formatBeijingTime()}] [CRITIQUE] Slide ${originalIdx + 1} still failing after ${attempts} attempts (score=${critiqueResult.overallScore}), using best available version`,
                  );
                }

                onProgress?.({
                  phase: 'critique',
                  current: originalIdx,
                  total: renderCount,
                  message: `第 ${originalIdx + 1} 页评审${critiqueResult.passed ? '通过' : '未通过'}（${critiqueResult.overallScore}分）`,
                  critique: {
                    slideIndex: originalIdx,
                    slideTitle: slidePlan.title || `幻灯片 ${originalIdx + 1}`,
                    attempt: attempts,
                    maxAttempts: critiqueMaxRetries + 1,
                    score: critiqueResult.overallScore,
                    passed: critiqueResult.passed,
                    issues: critiqueResult.issues.map((i) => i.title),
                  },
                });
              }

              console.log(
                `[${formatBeijingTime()}] [AGENT] Slide ${originalIdx + 1} HTML generated (${html.length} chars, critique=${critiqueResult?.overallScore ?? 'N/A'})`,
              );
              onProgress?.({
                phase: 'content',
                current: originalIdx + 1,
                total: renderCount,
                message: `已生成 ${originalIdx + 1}/${plan.slides.length} 页内容`,
              });
              // Task5 · 母版 DOM 硬注入（FR-3）：critique 之后、return 之前
              html = applyMasterToSlideHtml(html, master);
              return {
                success: true as const,
                html,
                plan: slidePlan,
                originalIdx,
                imagePreference: rp.imagePreference,
                backgroundEnabled: rp.backgroundEnabled,
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
                `[${formatBeijingTime()}] [AGENT] Failed to generate slide ${originalIdx + 1}, using fallback:`,
                e,
              );
              const fallback = generateFallbackSlide(
                slidePlan,
                rp.primaryColor,
                slideWidth,
                slideHeight,
                rp.fontFamily,
                rp.iconStyle,
              );
              // Task5 · fallback 分支同样注入母版（AC-18 五页全覆盖）
              return {
                success: true as const,
                html: applyMasterToSlideHtml(fallback, master),
                plan: slidePlan,
                originalIdx,
              };
            }
          }),
        ),
      );

      const slides: HTMLSlide[] = htmlResults.map((r) => {
        // 统一出口幂等兜底：确保每一页都注入母版层 / 背景（覆盖任何绕过逐页注入的支路，如历史样本 slide-03）。
        // 同一份 html 上重复 applyMasterToSlideHtml 是幂等的（已含 data-master / noppt-master-layer 则跳过）。
        const sp = r.plan;
        const cat = pageTypeToCategory(sp.pageType || 'content');
        let m: ReferenceMaster | undefined = referenceVisualAttributes
          ? resolveMasterForPage(referenceVisualAttributes, cat)
          : undefined;
        if (m && sp.referenceHeroImage?.src) {
          m = {
            ...m,
            heroImage: { src: sp.referenceHeroImage.src, ...(sp.referenceHeroImage.bbox ?? {}) },
          } as ReferenceMaster;
        }
        let html = r.html;
        if (m) html = applyMasterToSlideHtml(html, m);
        return {
          title: sp.title || plan.slides[r.originalIdx]?.title || `幻灯片 ${r.originalIdx + 1}`,
          html,
          pageType: sp.pageType,
          imagePrompt: sp.imagePrompt,
          imageRatio: sp.imageRatio || PAGE_TYPE_DEFAULT_IMAGE_RATIO[sp.pageType] || undefined,
          notes: undefined,
          critique: (r as any).critique,
          imagePreference: (r as any).imagePreference,
          backgroundEnabled: (r as any).backgroundEnabled,
          _originalIdx: r.originalIdx,
        };
      });

      // ========== 兜底 0：结构页 / 无图页占位符剥离（配图决策单一真源）==========
      // 结构页（cover/toc/summary）在 content-only 下 plan.needsImage=false，但 LLM 可能自发写入
      // 占位符；旧逻辑「看到占位符就生图」会因此给参考本身无图槽的封面/总结配上图。
      // 这里先按 image-plan-guard 的决策剥离，后续生图/升级步骤都基于剥离后的 HTML。
      if (imageEnabled) {
        for (const s of slides) {
          const originalIdx = s._originalIdx as number;
          const slidePlan = plan.slides[originalIdx];
          const slideImgPref: ImagePreference = s.imagePreference || imagePreference;
          const hasPlaceholder = s.html.includes(IMAGE_PLACEHOLDER);
          const decision = resolveSlideImageDecision({
            pageType: s.pageType,
            planNeedsImage: slidePlan?.needsImage,
            imagePreference: slideImgPref,
            imageEnabled,
            hasPlaceholder,
          });
          if (!decision.stripPlaceholder || !hasPlaceholder) continue;
          const cleaned = stripImagePlaceholders(s.html, {
            collapseLayout: isStructurePage(s.pageType),
          });
          if (cleaned === s.html) continue;
          console.log(
            `[${formatBeijingTime()}] [IMAGE-GUARD] Slide ${originalIdx + 1} "${s.title}" 剥离占位符（reason=${decision.reason}, pageType=${s.pageType}）`,
          );
          s.html = cleaned;
          s.imageRatio = undefined;
          s.imagePrompt = undefined;
          if (slidePlan) {
            slidePlan.needsImage = false;
            slidePlan.imageRatio = undefined;
            slidePlan.imagePrompt = undefined;
          }
        }
      }

      // ========== 兜底 1：当用户明确偏好配图时，将"纯文字/非带图类型 slide"升级为带图布局 ==========
      if (imageEnabled && (imagePreference === 'content-only' || imagePreference === 'all')) {
        for (const s of slides) {
          const originalIdx = (s as any)._originalIdx as number;
          const sp = plan.slides[originalIdx];
          const pt = s.pageType || 'content-no-image';
          const alreadyHasImg = /<img\b/i.test(s.html);
          if (alreadyHasImg) continue;
          const isImageType =
            pt === 'content-image-left' ||
            pt === 'content-image-right' ||
            pt === 'content-image-top';
          const isStructure = isStructurePage(pt);
          const slideImgPref: ImagePreference = (s as any).imagePreference || imagePreference;
          // 结构页恒不升级（与参考模板一致）；pref=none 的页面也不升级。
          // 内容页保持既有策略：非带图版式 → 升级为带图布局。
          if (isStructure || slideImgPref === 'none') continue;
          const shouldUpgrade = !isImageType;
          if (!shouldUpgrade) continue;
          // ——— FR-1 (fix-slide-comparison-image-disaster)：L1 高级版式（含 cards/compare/timeline）一律不升级为带图布局 ———
          const NEVER_UPGRADE_FOR_IMAGE: ReadonlySet<string> = new Set([
            'comparison-deep-dive',
            'content-value-showcase',
            'content-stats-highlight',
            'content-image-background',
            'content-zigzag',
            'content-cards',
            'content-compare',
            'content-timeline',
            'content-table',
            // ===== FR-18 扩展（全部 needsImage=false，禁止强制升带图）=====
            'content-flowchart',
            'content-org-chart',
            'content-pyramid',
            'content-matrix',
            'content-quote',
            'content-three-section',
            'content-process-steps',
            'content-icon-grid',
            'content-section-divider',
            'content-testimonial',
            'content-chart-bar',
            'content-chart-line',
            'content-chart-pie',
            'content-chart-donut',
            'content-cycle',
            'content-dashboard',
          ]);
          if (NEVER_UPGRADE_FOR_IMAGE.has(pt)) continue;
          const meaningfulBody = isStructure
            ? slideHasMeaningfulBody(s.html) || Boolean(s.title)
            : slideHasMeaningfulBody(s.html);
          if (!meaningfulBody) continue;

          // 结构页（cover/toc/summary）已在上方硬短路，走到这里的只可能是内容页 → 一律升级为左图右文
          let layoutPageType: 'content-image-left' | 'content-image-top' = 'content-image-left';
          let targetImageRatio: '4:3' | '16:9' = '4:3';
          {
            // ——— FR-1 双锁：保护版式本不该进这里，再判一次避免被绕过 ———
            const NEVER_UPGRADE_FOR_IMAGE2: ReadonlySet<string> = new Set([
              'comparison-deep-dive',
              'content-value-showcase',
              'content-stats-highlight',
              'content-image-background',
              'content-zigzag',
              'content-cards',
              'content-compare',
              'content-timeline',
              'content-table',
            ]);
            if (NEVER_UPGRADE_FOR_IMAGE2.has(pt)) continue;
            layoutPageType = 'content-image-left';
            targetImageRatio = '4:3';
          }

          const upgraded = injectImagePlaceholderForContentSlide(
            s.html,
            layoutPageType,
            plan.primaryColor,
          );
          if (upgraded !== s.html) {
            console.log(
              `[${formatBeijingTime()}] [AGENT] Slide ${originalIdx + 1} "${s.title}" (${pt}): upgrading → ${layoutPageType} (placeholder injected, imagePref=${imagePreference})`,
            );
            s.html = upgraded;
            if (!s.imageRatio) s.imageRatio = targetImageRatio;
            s.pageType = layoutPageType;
            if (sp) {
              sp.pageType = layoutPageType;
              sp.needsImage = true;
              if (!sp.imageRatio) sp.imageRatio = targetImageRatio;
            }
          }
        }
      }

      // ========== 兜底 2：占位符一致性强制校验 ==========
      if (imageEnabled && imgProvider.generateImage) {
        for (const s of slides) {
          const originalIdx = (s as any)._originalIdx as number;
          const sp = plan.slides[originalIdx];
          const hasImageInHtml = /<img\b/i.test(s.html);
          const hasPlaceholder = s.html.includes(IMAGE_PLACEHOLDER);
          const slideImgPref2: ImagePreference = (s as any).imagePreference || imagePreference;
          // 配图决策单一真源：结构页恒不配图 → 绝不注入；内容页按 plan.needsImage
          const decision = resolveSlideImageDecision({
            pageType: s.pageType || sp?.pageType,
            planNeedsImage: sp?.needsImage,
            imagePreference: slideImgPref2,
            imageEnabled,
            hasPlaceholder,
          });
          const needsPerPlan =
            decision.needsImage &&
            sp?.pageType &&
            PAGE_TYPE_DEFAULT_IMAGE_RATIO[sp.pageType] !== null;
          if (needsPerPlan && !hasImageInHtml && !hasPlaceholder && sp?.pageType) {
            const injected = injectImagePlaceholderForContentSlide(
              s.html,
              sp.pageType,
              plan.primaryColor,
            );
            if (injected !== s.html) {
              console.log(
                `[${formatBeijingTime()}] [AGENT] Slide ${originalIdx + 1} "${s.title}": pre-image-gen check FAIL → placeholder injected (pageType=${sp.pageType})`,
              );
              s.html = injected;
              if (!s.imageRatio) s.imageRatio = PAGE_TYPE_DEFAULT_IMAGE_RATIO[sp.pageType] || '4:3';
            } else {
              console.warn(
                `[${formatBeijingTime()}] [AGENT] Slide ${originalIdx + 1} "${s.title}": pre-image-gen placeholder injection FAILED (layout irregular), will fallback to orphan rescue on server side`,
              );
            }
          }
        }
      }

      let rendered: RenderedSlide[] = slides.map((s) => {
        const originalIdx = (s as any)._originalIdx as number;
        return {
          title: s.title,
          html: s.html,
          pageType: s.pageType!,
          imagePrompt: s.imagePrompt,
          imageRatio: s.imageRatio,
          backgroundPrompt: plan.slides[originalIdx]?.backgroundPrompt,
          critique: s.critique,
        };
      });

      if (options?.postHtmlAuditHook) {
        try {
          rendered = await options.postHtmlAuditHook(rendered, { plan, design, traceSessionId });
        } catch (e) {
          console.warn(
            `[${formatBeijingTime()}] [AGENT] postHtmlAuditHook failed, fallback to original slides:`,
            e instanceof Error ? e.message : e,
          );
        }
      }

      return rendered;
    } finally {
      if (ownTraceSession && traceSessionId) {
        closeTraceSession(traceSessionId);
      }
    }
  }

