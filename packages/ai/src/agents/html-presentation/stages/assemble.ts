import type {
  AgentDeps,
} from './deps';
import {
  DesignProposal,
  ImagePreference,
  ImageRatio,
  ImageSize,
  PresentationGenerationOptions,
  PresentationPlan,
  RenderedSlide,
  SlidePageType,
  SlidePlan,
} from '../../../types';
import {
  HTMLSlide,
  IMAGE_PLACEHOLDER,
  PAGE_TYPE_DEFAULT_IMAGE_RATIO,
  getImageSizeForRatio,
  pLimit,
  replaceImagePlaceholderWithRealSrc,
  selectImageModel,
} from '../shared';
import {
  AIModelProvider,
  TraceableProvider,
  formatBeijingTime,
} from '../../../providers/base';
import {
  closeTraceSession,
  openTraceSession,
} from '../../../utils/llm-tracer';
import {
  switchStage,
} from './deps';
import {
  isStructurePage,
  resolveSlideImageDecision,
  stripImagePlaceholders,
} from '../../../utils/image-plan-guard';
import {
  injectImagePlaceholderForContentSlide,
  removeBackgroundPlaceholder,
  removeImagePlaceholder,
  slideHasMeaningfulBody,
} from '../postprocess';
import {
  buildReferenceSeedMap,
  injectBackgroundImageToDiv,
} from '../html-sanitize';
import { sanitizeImagePrompt } from './image-prompt';
export async function assembleImages(deps: AgentDeps, topic: string, renderedSlides: RenderedSlide[], plan: PresentationPlan, _design: DesignProposal, options?: PresentationGenerationOptions, traceSessionId?: string): Promise<RenderedSlide[]> {
    const slides: HTMLSlide[] = renderedSlides.map((s) => ({
      title: s.title,
      html: s.html,
      pageType: s.pageType,
      imagePrompt: s.imagePrompt,
      imageRatio: s.imageRatio as ImageRatio | undefined,
      notes: undefined,
      critique: (s as any).critique,
    }));

    const imgProvider = (options?.imageProvider || deps.provider) as AIModelProvider;
    const imagePreference = options?.imagePreference || 'content-only';
    const imageEnabled = options?.imageOptions?.enabled && imagePreference !== 'none';
    const backgroundEnabled = options?.backgroundEnabled || false;
    const onProgress = options?.onProgress;

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
      if (imageEnabled && imgProvider.generateImage) {
        // 切换 LLM trace 阶段标签为 images，便于后续日志分离
        switchStage(imgProvider, 'images');
        const timestamp = formatBeijingTime();
        console.log(`[${timestamp}] [AGENT] Starting parallel image generation...`);
        onProgress?.({
          phase: 'images',
          current: 0,
          total: slides.length,
          message: '正在生成配图...',
        });

        const imgLimit = pLimit(2);
        let successCount = 0;
        let failCount = 0;

        await Promise.all(
          slides.map((slide, idx) =>
            imgLimit(async () => {
              const slidePlan = plan.slides[idx];
              const slidePageType = slide.pageType || slidePlan?.pageType;
              const slideImgPref: ImagePreference = slide.imagePreference || imagePreference;
              let hasPlaceholder = slide.html.includes(IMAGE_PLACEHOLDER);
              // 配图决策单一真源：结构页（cover/toc/summary）恒不配图 —— 即便 HTML 里带着占位符也先剥离，
              // 杜绝「参考封面/总结本无图槽却被 LLM 自发占位符带出图片」。
              const decision = resolveSlideImageDecision({
                pageType: slidePageType,
                planNeedsImage: slidePlan?.needsImage,
                imagePreference: slideImgPref,
                imageEnabled,
                hasPlaceholder,
              });
              if (decision.stripPlaceholder && hasPlaceholder) {
                const cleaned = stripImagePlaceholders(slide.html, {
                  collapseLayout: isStructurePage(slidePageType),
                });
                if (cleaned !== slide.html) {
                  console.log(
                    `[${formatBeijingTime()}] [IMAGE-GUARD] Slide ${idx + 1} "${slide.title}" 生图前剥离占位符（reason=${decision.reason}）`,
                  );
                  slide.html = cleaned;
                  hasPlaceholder = false;
                }
              }
              const needsImagePerPlan =
                decision.needsImage &&
                slidePlan?.pageType &&
                PAGE_TYPE_DEFAULT_IMAGE_RATIO[slidePlan.pageType] !== null;
              // 兜底 A：计划明确说要配图，但 LLM 生成 HTML 时漏写占位符 → 现在注入后继续生成
              if (needsImagePerPlan && !hasPlaceholder && slidePlan?.pageType) {
                const injected = injectImagePlaceholderForContentSlide(
                  slide.html,
                  slidePlan.pageType,
                  plan.primaryColor,
                );
                if (injected !== slide.html) {
                  console.log(
                    `[${formatBeijingTime()}] [AGENT] Slide ${idx + 1} "${slide.title}": plan needs image but placeholder missing → injected, will generate`,
                  );
                  slide.html = injected;
                  hasPlaceholder = true;
                }
              }
              // 兜底 B：content-only/all 偏好下，内容页即便 plan 未标 needsImage，只要 HTML 含占位符也生成；
              // 结构页已被上面的 decision.needsImage=false 拦截，不再生成。
              const shouldGenerate = decision.needsImage && hasPlaceholder;
              if (!shouldGenerate) {
                onProgress?.({
                  phase: 'images',
                  current: idx + 1,
                  total: slides.length,
                  message: `配图进度 ${idx + 1}/${slides.length}`,
                });
                return;
              }
              const ratio =
                slide.imageRatio ||
                slidePlan?.imageRatio ||
                PAGE_TYPE_DEFAULT_IMAGE_RATIO[slidePlan.pageType!] ||
                '4:3';
              const allModels = options?.imageOptions?.allModels || [];
              const routing = options?.imageOptions?.routing;
              const defaultModel = options?.imageOptions?.model || imgProvider.config.model;
              const { modelName: selectedModel } = selectImageModel(
                allModels.map((m, i) => ({ ...m, index: i })),
                slidePlan.pageType!,
                ratio as ImageRatio,
                routing,
                defaultModel,
              );
              const selectedModelObj = allModels.find((m) => m.modelName === selectedModel);
              const selectedModelSizes = selectedModelObj?.sizes;
              const selectedModelPixelRanges = selectedModelObj?.pixelRanges;
              // —— 运行时诊断：用户现在看到 size=2048x2048 时到底卡在哪一步了 ——
              // —— 核心原则（用户要求 "严格以 ratio 优先，无法确定才用默认尺寸"）：
              //    当 ratio 明确存在（非 1:1 或 任意已确定的 ImageRatio），一律信任 ratio，
              //    除非 ratio=1:1 或 ratio 完全拿不到（plan+HTML 都没写）才用 imageOptions.size。
              //    这样：imageOptions.size 只是"方形兜底默认尺寸"，不再作为全局覆盖一切的强约束。
              const __beforeTargetSize = options?.imageOptions?.size as ImageSize | undefined;
              // 分析配置 size 本身的比例（如果存在）
              const cfgW =
                __beforeTargetSize && /^(\d+)x(\d+)$/.test(__beforeTargetSize)
                  ? parseInt(__beforeTargetSize.match(/^(\d+)x(\d+)$/)![1], 10)
                  : 0;
              const cfgH =
                __beforeTargetSize && /^(\d+)x(\d+)$/.test(__beforeTargetSize)
                  ? parseInt(__beforeTargetSize.match(/^(\d+)x(\d+)$/)![2], 10)
                  : 0;
              const cfgIsSquare = cfgW > 0 && cfgH > 0 && cfgW === cfgH;
              // 判断"ratio 是否明确可信任"：只有 ratio=1:1 或 ratio 根本取不到才尊重配置 size
              const ratioKnown: boolean =
                ratio === '1:1' ||
                ratio === '4:3' ||
                ratio === '3:4' ||
                ratio === '16:9' ||
                ratio === '9:16' ||
                ratio === '3:2' ||
                ratio === '2:3' ||
                ratio === '21:9';
              // 尊重配置 size 的条件：
              //   a) ratio=1:1 且 cfg 是方形 → cfg 就是 1:1 尺寸的精确指定；
              //   b) ratio 未知 → cfg 是默认尺寸。
              // 其他情况：ratio 明确，一律交给 getImageSizeForRatio，不被 cfg 覆盖
              let effectiveFixedSize: ImageSize | undefined;
              let whyIgnoredCfg = '';
              if (ratio === '1:1') {
                if (cfgIsSquare) {
                  effectiveFixedSize = __beforeTargetSize; // ratio=1:1 且 cfg 方形 → 尊重
                } else {
                  effectiveFixedSize = undefined; // ratio=1:1 但 cfg 非方形 → 信任 ratio=1:1，忽略 cfg
                  whyIgnoredCfg = `ratio=1:1 但 cfgSize(${__beforeTargetSize}) 非方形，忽略cfg`;
                }
              } else if (!ratioKnown) {
                effectiveFixedSize = __beforeTargetSize; // ratio 拿不到 → cfg 做默认
              } else {
                // ratio 已知且非 1:1 → 严格以 ratio 为准，不管 cfg size 是什么
                effectiveFixedSize = undefined;
                whyIgnoredCfg = `ratio=${ratio}，严格按ratio计算尺寸，忽略cfgSize=${__beforeTargetSize ?? '<none>'}`;
              }
              // 本地调试时，只要有机会走智能尺寸就打完整链路诊断日志
              if (!effectiveFixedSize || /^(\d+)x(\d+)$/.test(effectiveFixedSize)) {
                const msg = (() => {
                  const hasSizes = !!(selectedModelSizes && selectedModelSizes.length);
                  const hasRanges = !!(selectedModelPixelRanges && selectedModelPixelRanges.length);
                  const sizeList = hasSizes
                    ? selectedModelSizes!.map((s) => `${s.width}x${s.height}`).join(',')
                    : '<empty>';
                  const rangeList = hasRanges
                    ? selectedModelPixelRanges!
                        .map(
                          (r) =>
                            `${(r.minPixels / 1048576).toFixed(2)}-${(r.maxPixels / 1048576).toFixed(2)}M`,
                        )
                        .join(',')
                    : '<empty>';
                  return `seedSize-dbg slide=${idx + 1} model=${selectedModel} ratio=${ratio} hasSizes=${hasSizes}(${sizeList}) hasRanges=${hasRanges}(${rangeList}) cfgSize=${__beforeTargetSize ?? '<none>'} useCfgAsIs=${Boolean(effectiveFixedSize)} whyIgnored=${whyIgnoredCfg || '<ratio respected>'}`;
                })();
                console.log(`[${formatBeijingTime()}] [AGENT] ${msg}`);
              }
              const targetSize =
                effectiveFixedSize ||
                getImageSizeForRatio(
                  selectedModel,
                  ratio as ImageRatio,
                  selectedModelSizes,
                  selectedModelPixelRanges,
                );
              const rawImagePrompt =
                slidePlan?.imagePrompt ||
                `${topic} - ${slide.title}，商务级专业插画品质，细腻细节，高完成度画面，整体配色与主题协调`;
              const imagePrompt = sanitizeImagePrompt(deps, rawImagePrompt, plan.primaryColor);
              try {
                const images = await imgProvider.generateImage!(imagePrompt, {
                  model: selectedModel,
                  size: targetSize,
                  quality: options?.imageOptions?.quality,
                  n: 1,
                  referenceImage: options?.referenceImage,
                  // FR-15：按 slide pageType 选取对应分类的参考图作为 img2img seed（provider 内部按分类选取）
                  referenceImageByCategory: buildReferenceSeedMap(options),
                  referenceCategory: slide.pageType,
                  // 扩展字段：给 imageProvider 的 trace 使用，便于日志定位 slide 页号和标题
                  ...({
                    scene: `slide-${idx + 1} "${slide.title}" (primary, ratio=${ratio})`,
                  } as any),
                });
                if (images && images.length > 0 && images[0].url) {
                  slide.html = replaceImagePlaceholderWithRealSrc(
                    slide.html,
                    images[0].url,
                    ratio as ImageRatio,
                  );
                  successCount++;
                  console.log(
                    `[${formatBeijingTime()}] [AGENT] Slide ${idx + 1}: image generated with ${selectedModel} (targetSize=${targetSize}, ratio=${ratio})`,
                  );
                } else {
                  failCount++;
                  removeImagePlaceholder(slide);
                }
              } catch (e) {
                failCount++;
                console.warn(
                  `[${formatBeijingTime()}] [AGENT] Slide ${idx + 1} image generation failed (${selectedModel}), removing placeholder:`,
                  e,
                );
                removeImagePlaceholder(slide);
              }
              onProgress?.({
                phase: 'images',
                current: idx + 1,
                total: slides.length,
                message: `配图进度 ${idx + 1}/${slides.length}`,
              });
            }),
          ),
        );
        console.log(
          `[${formatBeijingTime()}] [AGENT] Image generation complete: ${successCount} succeeded, ${failCount} failed`,
        );
      } else if (!imageEnabled) {
        for (const slide of slides) {
          removeImagePlaceholder(slide);
        }
      }

      // ========== 兜底 2+（B-2）：imagePreference 终局校验 —— 图片生成后扫描漏网之鱼，重新注入+再生成 ==========
      // 修复：LLM HTML 既没有 <img>，也没有占位符，即使 A-3/B-1 都过了也有可能在极端情况下（占位符替换时 remove 掉了）出现裸文本 slide
      // 扫描范围：imagePreference=all 时所有 slide；content-only 时非结构页的 slide
      if (
        (imagePreference === 'all' || imagePreference === 'content-only') &&
        imgProvider.generateImage
      ) {
        const toReInject: Array<{
          slide: HTMLSlide;
          sp: SlidePlan;
          idx: number;
          layout: 'content-image-left' | 'content-image-top';
        }> = [];
        const finalNeedImage = (
          pt: SlidePageType | undefined,
          _idx2: number,
        ): 'content-image-left' | 'content-image-top' | null => {
          // ——— FR-1 (fix-slide-comparison-image-disaster)：L1 高级版式 + cards/compare/timeline/table 一概不补图 ———
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
          if (pt && NEVER_UPGRADE_FOR_IMAGE.has(pt)) return null;
          // 结构页（cover/toc/summary）在任何偏好（含 all）下都不补图 —— 与参考模板保持一致
          if (isStructurePage(pt)) return null;
          return 'content-image-left';
        };
        for (let i = 0; i < slides.length; i++) {
          const s = slides[i];
          const sp = plan.slides[i];
          const hasImg = /<img\b[^>]*src\s*=\s*["'](?!.*NOPPT_IMAGE_PLACEHOLDER)[^"']+["']/i.test(
            s.html,
          );
          if (hasImg) continue;
          const layout = finalNeedImage(s.pageType || sp?.pageType, i);
          if (!layout) continue;
          // 这张 slide 在终局没有有效 <img src>
          const meaningfulB =
            s.pageType === 'cover' || s.pageType === 'toc' || s.pageType === 'summary'
              ? Boolean(s.title) || slideHasMeaningfulBody(s.html)
              : slideHasMeaningfulBody(s.html);
          if (!meaningfulB) continue;
          toReInject.push({ slide: s, sp, idx: i, layout });
        }
        if (toReInject.length > 0) {
          console.log(
            `[${formatBeijingTime()}] [AGENT] B-2 FINAL CHECK: found ${toReInject.length} slide(s) without image, re-injecting & re-generating...`,
          );
          onProgress?.({
            phase: 'images',
            current: slides.length,
            total: slides.length + toReInject.length,
            message: `发现 ${toReInject.length} 张漏网无图页，正在补图...`,
          });
          const imgLimit2 = pLimit(2);
          await Promise.all(
            toReInject.map((entry) =>
              imgLimit2(async () => {
                const { slide, sp, idx, layout } = entry;
                const injected = injectImagePlaceholderForContentSlide(
                  slide.html,
                  layout,
                  plan.primaryColor,
                );
                slide.html = injected;
                if (!slide.imageRatio)
                  slide.imageRatio = layout === 'content-image-top' ? '21:9' : '4:3';
                slide.pageType = layout;
                if (sp) {
                  sp.pageType = layout;
                  sp.needsImage = true;
                  if (!sp.imageRatio) sp.imageRatio = slide.imageRatio;
                }
                // 再跑一次生成
                const ratio =
                  slide.imageRatio ||
                  sp?.imageRatio ||
                  (layout === 'content-image-top' ? '21:9' : '4:3');
                const allModels = options?.imageOptions?.allModels || [];
                const routing = options?.imageOptions?.routing;
                const defaultModel = options?.imageOptions?.model || imgProvider.config.model;
                const { modelName: selectedModel } = selectImageModel(
                  allModels.map((m, i) => ({ ...m, index: i })),
                  layout,
                  ratio as ImageRatio,
                  routing,
                  defaultModel,
                );
                const selectedModelObj = allModels.find((m) => m.modelName === selectedModel);
                const selectedModelSizes = selectedModelObj?.sizes;
                const selectedModelPixelRanges = selectedModelObj?.pixelRanges;
                // —— B-2 补图路径：严格按 ratio 优先（与主配图路径规则完全一致）
                const __beforeTargetSizeB2 = options?.imageOptions?.size as ImageSize | undefined;
                const cfgWB2 =
                  __beforeTargetSizeB2 && /^(\d+)x(\d+)$/.test(__beforeTargetSizeB2)
                    ? parseInt(__beforeTargetSizeB2.match(/^(\d+)x(\d+)$/)![1], 10)
                    : 0;
                const cfgHB2 =
                  __beforeTargetSizeB2 && /^(\d+)x(\d+)$/.test(__beforeTargetSizeB2)
                    ? parseInt(__beforeTargetSizeB2.match(/^(\d+)x(\d+)$/)![2], 10)
                    : 0;
                const cfgIsSquareB2 = cfgWB2 > 0 && cfgHB2 > 0 && cfgWB2 === cfgHB2;
                const ratioKnownB2: boolean =
                  ratio === '1:1' ||
                  ratio === '4:3' ||
                  ratio === '3:4' ||
                  ratio === '16:9' ||
                  ratio === '9:16' ||
                  ratio === '3:2' ||
                  ratio === '2:3' ||
                  ratio === '21:9';
                let effectiveFixedSizeB2: ImageSize | undefined;
                let whyIgnoredCfgB2 = '';
                if (ratio === '1:1') {
                  if (cfgIsSquareB2) effectiveFixedSizeB2 = __beforeTargetSizeB2;
                  else {
                    effectiveFixedSizeB2 = undefined;
                    whyIgnoredCfgB2 = `ratio=1:1但cfgSize非方形，忽略cfg`;
                  }
                } else if (!ratioKnownB2) {
                  effectiveFixedSizeB2 = __beforeTargetSizeB2;
                } else {
                  effectiveFixedSizeB2 = undefined;
                  whyIgnoredCfgB2 = `ratio=${ratio}，严格按ratio计算尺寸，忽略cfgSize=${__beforeTargetSizeB2 ?? '<none>'}`;
                }
                if (!effectiveFixedSizeB2 || /^(\d+)x(\d+)$/.test(effectiveFixedSizeB2)) {
                  const msg = (() => {
                    const hasSizes = !!(selectedModelSizes && selectedModelSizes.length);
                    const hasRanges = !!(
                      selectedModelPixelRanges && selectedModelPixelRanges.length
                    );
                    const sizeList = hasSizes
                      ? selectedModelSizes!.map((s) => `${s.width}x${s.height}`).join(',')
                      : '<empty>';
                    const rangeList = hasRanges
                      ? selectedModelPixelRanges!
                          .map(
                            (r) =>
                              `${(r.minPixels / 1048576).toFixed(2)}-${(r.maxPixels / 1048576).toFixed(2)}M`,
                          )
                          .join(',')
                      : '<empty>';
                    return `seedSize-dbg(B-2) slide=${idx + 1} model=${selectedModel} ratio=${ratio} layout=${layout} hasSizes=${hasSizes}(${sizeList}) hasRanges=${hasRanges}(${rangeList}) cfgSize=${__beforeTargetSizeB2 ?? '<none>'} useCfgAsIs=${Boolean(effectiveFixedSizeB2)} whyIgnored=${whyIgnoredCfgB2 || '<ratio respected>'}`;
                  })();
                  console.log(`[${formatBeijingTime()}] [AGENT] ${msg}`);
                }
                const targetSize =
                  effectiveFixedSizeB2 ||
                  getImageSizeForRatio(
                    selectedModel,
                    ratio as ImageRatio,
                    selectedModelSizes,
                    selectedModelPixelRanges,
                  );
                const rawImagePrompt =
                  sp?.imagePrompt ||
                  `${topic} - ${slide.title}，商务级专业插画品质，细腻细节，高完成度画面，整体配色与主题协调`;
                const imagePrompt = sanitizeImagePrompt(deps, rawImagePrompt, plan.primaryColor);
                try {
                  const images = await imgProvider.generateImage!(imagePrompt, {
                    model: selectedModel,
                    size: targetSize,
                    quality: options?.imageOptions?.quality,
                    n: 1,
                    referenceImage: options?.referenceImage,
                    // FR-15：按 slide pageType 选取对应分类的参考图作为 img2img seed
                    referenceImageByCategory: buildReferenceSeedMap(options),
                    referenceCategory: slide.pageType,
                    ...({
                      scene: `slide-${idx + 1} "${slide.title}" (B-2-rescue, layout=${layout})`,
                    } as any),
                  });
                  if (images && images.length > 0 && images[0].url) {
                    slide.html = replaceImagePlaceholderWithRealSrc(
                      slide.html,
                      images[0].url,
                      ratio as ImageRatio,
                    );
                    console.log(
                      `[${formatBeijingTime()}] [AGENT] Slide ${idx + 1} B-2 补图成功 (${selectedModel}, targetSize=${targetSize}, ratio=${ratio})`,
                    );
                  } else {
                    // 再失败：移除 placeholder，交给 server 端孤儿救援（它会把其他生成的孤儿图片塞进来）
                    removeImagePlaceholder(slide);
                    console.warn(
                      `[${formatBeijingTime()}] [AGENT] Slide ${idx + 1} B-2 补图无结果，等待 server 端孤儿救援...`,
                    );
                  }
                } catch (e) {
                  removeImagePlaceholder(slide);
                  console.warn(
                    `[${formatBeijingTime()}] [AGENT] Slide ${idx + 1} B-2 补图异常，等待 server 端孤儿救援:`,
                    e,
                  );
                }
                onProgress?.({
                  phase: 'images',
                  current: slides.length + (idx + 1),
                  total: slides.length + toReInject.length,
                  message: `补图进度 ${entry.idx + 1}/${toReInject.length}`,
                });
              }),
            ),
          );
        }
      }

      if (backgroundEnabled && imgProvider.generateImage) {
        const timestamp = formatBeijingTime();
        console.log(`[${timestamp}] [AGENT] Starting background image generation...`);
        onProgress?.({ phase: 'images', current: 0, total: 4, message: '正在生成背景图...' });

        const BG_PLACEHOLDER = 'https://NOPPT_BG_PLACEHOLDER';
        //【缺陷修复 1】cover/toc/summary 也必须 HTML 里真正存在 BG_PLACEHOLDER 才入队，
        // 否则即使 pageType 匹配也会白白调用 generateImage，再 replace 时 0 命中，导致"打了 trace 但图片没注入"的假象
        const coverSlide = slides.find(
          (s) => s.pageType === 'cover' && s.html.includes(BG_PLACEHOLDER),
        );
        const tocSlide = slides.find(
          (s) => s.pageType === 'toc' && s.html.includes(BG_PLACEHOLDER),
        );
        const contentSlide = slides.find(
          (s) => s.pageType && s.pageType.startsWith('content-') && s.html.includes(BG_PLACEHOLDER),
        );
        const summarySlide = slides.find(
          (s) => s.pageType === 'summary' && s.html.includes(BG_PLACEHOLDER),
        );

        const bgTasks: { label: string; slide: HTMLSlide; prompt: string }[] = [];
        const contentPrompt = plan.slides.find((s) =>
          s.pageType?.startsWith('content-'),
        )?.backgroundPrompt;

        if (coverSlide) {
          const p = plan.slides.find((s) => s.pageType === 'cover')?.backgroundPrompt;
          if (p) bgTasks.push({ label: '封面', slide: coverSlide, prompt: p });
        }
        if (tocSlide) {
          const p = plan.slides.find((s) => s.pageType === 'toc')?.backgroundPrompt;
          if (p) bgTasks.push({ label: '目录', slide: tocSlide, prompt: p });
        }
        //【缺陷修复 2】内容背景：contentPrompt 存在但没有任何 content 页含 BG_PLACEHOLDER 时，
        // 之前整个"内容"任务被跳过（连 generateImage 都不打 trace），用户以为没执行。
        // 改为：找任意 content 页当"主落点 slide"，后续 replace 仍遍历所有 content 页。
        if (contentPrompt) {
          if (contentSlide) {
            bgTasks.push({ label: '内容', slide: contentSlide, prompt: contentPrompt });
          } else {
            const fallbackContentSlide = slides.find(
              (s) => s.pageType && s.pageType.startsWith('content-'),
            );
            if (fallbackContentSlide) {
              console.warn(
                `[${formatBeijingTime()}] [AGENT] Background(content): contentPrompt 存在但没有 content 页包含 BG_PLACEHOLDER，仍然尝试生成背景图，后续将遍历所有 content 页用 background-image 注入`,
              );
              bgTasks.push({ label: '内容', slide: fallbackContentSlide, prompt: contentPrompt });
            } else {
              console.warn(
                `[${formatBeijingTime()}] [AGENT] Background(content): contentPrompt 存在，但没有 pageType=content-* 的 slide，跳过内容背景`,
              );
            }
          }
        } else {
          //【缺陷修复 3】planning 没输出 backgroundPrompt 时给出显性日志
          console.warn(
            `[${formatBeijingTime()}] [AGENT] Background(content): plan.slides 中所有 content-* 页均没有 backgroundPrompt，请检查 planning 输出是否包含 backgroundPrompt`,
          );
        }
        if (summarySlide) {
          const p = plan.slides.find((s) => s.pageType === 'summary')?.backgroundPrompt;
          if (p) bgTasks.push({ label: '总结', slide: summarySlide, prompt: p });
        }

        //【缺陷修复 4】最终入队 0 条时，给出"为什么没生成"的汇总日志 + progress 更新，避免一条 trace 都没有、
        // 用户就像本 issue 一样困惑："为什么 ai-log 里找不到背景图报文"
        if (bgTasks.length === 0) {
          console.warn(
            `[${formatBeijingTime()}] [AGENT] Background: 最终入队 bgTasks=0，以下均为可能原因：① slide HTML 里没有 NOPPT_BG_PLACEHOLDER；② planning 没输出 backgroundPrompt；③ 没有 cover/toc/content-*/summary 等目标 pageType。请逐一核实`,
          );
          onProgress?.({
            phase: 'images',
            current: 1,
            total: 1,
            message: '背景图无需生成（无 BG_PLACEHOLDER 或未规划 backgroundPrompt）',
          });
        } else {
          let bgIdx = 0;
          for (const task of bgTasks) {
            try {
              const bgImgPrompt = sanitizeImagePrompt(deps, task.prompt, plan.primaryColor);
              const allModels = options?.imageOptions?.allModels || [];
              const defaultModel = options?.imageOptions?.model || imgProvider.config.model;
              let selectedModel = defaultModel;
              let selectedModelSizes = allModels.find((m) => m.modelName === selectedModel)?.sizes;
              const bgSize: ImageSize = '1792x1024';
              const actualSize = selectedModelSizes?.some(
                (s) => `${s.width}x${s.height}` === bgSize,
              )
                ? bgSize
                : (options?.imageOptions?.size as ImageSize) || '1792x1024';

              const images = await imgProvider.generateImage!(bgImgPrompt, {
                model: selectedModel,
                size: actualSize,
                quality: options?.imageOptions?.quality,
                n: 1,
                ...({ scene: `background-${task.label}` } as any),
              });
              if (images && images.length > 0 && images[0].url) {
                const hitsBefore =
                  task.label === '内容'
                    ? slides
                        .filter((s) => s.pageType?.startsWith('content-'))
                        .reduce(
                          (acc, s) => acc + (s.html.match(/NOPPT_BG_PLACEHOLDER/gi)?.length ?? 0),
                          0,
                        )
                    : (task.slide.html.match(/NOPPT_BG_PLACEHOLDER/gi)?.length ?? 0);
                if (task.label === '内容') {
                  for (const slide of slides) {
                    if (slide.pageType?.startsWith('content-')) {
                      slide.html = slide.html.replace(
                        /url\(['"]?https:\/\/NOPPT_BG_PLACEHOLDER['"]?\)/gi,
                        `url('${images[0].url}')`,
                      );
                    }
                  }
                } else {
                  task.slide.html = task.slide.html.replace(
                    /url\(['"]?https:\/\/NOPPT_BG_PLACEHOLDER['"]?\)/gi,
                    `url('${images[0].url}')`,
                  );
                }
                const hitsAfter =
                  task.label === '内容'
                    ? slides
                        .filter((s) => s.pageType?.startsWith('content-'))
                        .reduce(
                          (acc, s) => acc + (s.html.match(/NOPPT_BG_PLACEHOLDER/gi)?.length ?? 0),
                          0,
                        )
                    : (task.slide.html.match(/NOPPT_BG_PLACEHOLDER/gi)?.length ?? 0);
                // 若没有 placeholder 命中，退一步尝试把首屏的 background-image 注入到 slide 的最外层 div 背景样式里
                if (hitsBefore - hitsAfter === 0) {
                  const inj = injectBackgroundImageToDiv(
                    task.label === '内容'
                      ? slides.filter((s) => s.pageType?.startsWith('content-'))
                      : [task.slide],
                    images[0].url,
                  );
                  console.log(
                    `[${formatBeijingTime()}] [AGENT] Background (${task.label}) generated successfully, placeholder hit=${hitsBefore - hitsAfter}/${hitsBefore}, fallback injectBackgroundImageToDiv=${inj.attempted}, injected=${inj.injected}`,
                  );
                } else {
                  console.log(
                    `[${formatBeijingTime()}] [AGENT] Background (${task.label}) generated successfully, replaced ${hitsBefore - hitsAfter}/${hitsBefore} placeholder(s)`,
                  );
                }
              } else {
                console.warn(
                  `[${formatBeijingTime()}] [AGENT] Background (${task.label}) 调用成功但 images[0].url 为空，触发 removeBackgroundPlaceholder`,
                );
                removeBackgroundPlaceholder(task.slide);
              }
            } catch (e) {
              console.warn(
                `[${formatBeijingTime()}] [AGENT] Background (${task.label}) generation failed:`,
                e,
              );
              removeBackgroundPlaceholder(task.slide);
            }
            bgIdx++;
            onProgress?.({
              phase: 'images',
              current: bgIdx,
              total: bgTasks.length,
              message: `背景图进度 ${bgIdx}/${bgTasks.length}`,
            });
          }
        }

        for (const slide of slides) {
          if (slide.html.includes('NOPPT_BG_PLACEHOLDER')) {
            removeBackgroundPlaceholder(slide);
          }
        }
      } else if (!backgroundEnabled) {
        //【缺陷修复 4 补充】backgroundEnabled=false 时也给出显性日志。
        // 这正是本次用户 issue 的直接原因：pres_mse1kl5x_urnm2gj 的 Background=关 → 完全跳过了 generateImage → imageGenerationCalls 里没有 background-* 记录
        console.log(
          `[${formatBeijingTime()}] [AGENT] Background generation skipped: backgroundEnabled=false（当前请求未开启自动背景图；imageGenerationCalls 中将只有 slide 配图的 5 次记录，没有 background-* 记录）`,
        );
        for (const slide of slides) {
          if (slide.html.includes('NOPPT_BG_PLACEHOLDER')) {
            removeBackgroundPlaceholder(slide);
          }
        }
      }

      return slides.map((s, i) => ({
        title: s.title,
        html: s.html,
        pageType: (s.pageType || renderedSlides[i]?.pageType)!,
        imagePrompt: s.imagePrompt,
        imageRatio: s.imageRatio,
        backgroundPrompt: renderedSlides[i]?.backgroundPrompt,
      }));
    } finally {
      if (ownTraceSession && traceSessionId) {
        closeTraceSession(traceSessionId);
      }
    }
  }

