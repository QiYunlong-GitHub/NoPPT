// 审计重试循环三方法（从 ai.service.ts 外置）。
// 运行时行为零变更：ai.service.ts 保留三个私有方法作为薄门面，
// 通过 XxxImpl.call(this, ...) 调用本文件，this.* 全部经 AiService 实例解析（与 postProcessPresentationImpl 同构）。
import { collectImageRefs, isLocalAssetUrl, replaceImageUrlInHtml, mapRatioToSize, extractRatioFromImgTag } from '../utils/html-string';
import type { ImagePreference, ColorTheme, PresentationPlan, DesignProposal, RenderedSlide, ReferenceVisualAttributes, ReferenceContext } from '@noppt/ai';
import { formatBeijingTime, simpleLog, setSessionStage, replaceImagePlaceholderWithRealSrc, type TraceableProvider } from '@noppt/ai';
import { HTMLPresentationAgent, IMAGE_PLACEHOLDER } from '@noppt/ai/agents';
import { styleViolationSignal, resolveEffectivePrimaryColor, resolveDeckReferencePrimaryColor } from '@noppt/ai';
import type { Presentation } from '@noppt/core';
import { SlideRenderer, runVlmCritique } from '@noppt/audit';
import { sanitizeHtmlServerSide } from '../../../utils/sanitize';
import { join } from 'path';
import * as os from 'os';
import { runHtmlPlaceholderAuditLoop } from '../html-audit-loop';
import { triageSlideIssues } from '../triage-vlm-issues';

export function buildHtmlAuditHookImpl(this: any, params: {
    agent: HTMLPresentationAgent;
    topic: string;
    referenceVisualAttributes?: ReferenceVisualAttributes;
    referenceHtmlBrief?: string;
    options: any;
    maxRetries: number;
    slideWidth: number;
    slideHeight: number;
    startIndex?: number;
  }) {
    const {
      agent,
      topic,
      options,
      maxRetries,
      slideWidth,
      slideHeight,
      startIndex = 0,
      referenceHtmlBrief,
    } = params;
    const htmlOnlyOptions = {
      ...options,
      referenceVisualAttributes: params.referenceVisualAttributes,
      referenceHtmlBrief,
      imageProvider: undefined,
    };
    return async (
      slides: RenderedSlide[],
      ctx: { plan: PresentationPlan; design: DesignProposal; traceSessionId?: string },
    ): Promise<RenderedSlide[]> => {
      // —— 内联自检开关：总关 / VLM 占位子关 → 直接跳过 HTML 占位审核闭环 ——
      const critiqueCfg = (options as any)?.critique;
      if (!critiqueCfg || critiqueCfg.enabled === false || critiqueCfg.vlmPlaceholder === false) {
        simpleLog(
          'AI:HTML-AUDIT',
          `因内联自检开关关闭（enabled=${critiqueCfg?.enabled ?? 'undefined'}，vlmPlaceholder=${critiqueCfg?.vlmPlaceholder ?? 'undefined'}），跳过 HTML 占位审核闭环（共 ${slides.length} 页）`,
        );
        return slides;
      }
      const vlmProvider = await this.auditService.getVlmProvider();
      if (!vlmProvider) return slides;
      const previousVlmSession = (vlmProvider as TraceableProvider).activeTraceSessionId;
      if (ctx.traceSessionId) {
        (vlmProvider as TraceableProvider).activeTraceSessionId = ctx.traceSessionId;
      }
      try {
        simpleLog(
          'AI:HTML-AUDIT',
          `开始 HTML 占位符审核闭环（${slides.length} 页，最多重试 ${maxRetries} 次）`,
        );
        return await runHtmlPlaceholderAuditLoop({
          slides,
          vlmProvider,
          slideWidth,
          slideHeight,
          maxRetries,
          onlyAfterLlmPass: true,
          traceSessionId: ctx.traceSessionId,
          onProgress: options.onProgress,
          regenerateSlideFn: async (idx: number, feedback: string) => {
            // AC-6 / Task6：HTML 占位符审计闭环也需 originalHtml 注入，budget 耗尽保留原 HTML
            const originalHtml = slides[idx]?.html || '';
            return agent.regenerateSingleSlide(
              topic,
              ctx.plan,
              ctx.design,
              startIndex + idx,
              htmlOnlyOptions,
              ctx.traceSessionId,
              feedback,
              'placeholder-audit',
              originalHtml,
            );
          },
        });
      } finally {
        (vlmProvider as TraceableProvider).activeTraceSessionId = previousVlmSession;
      }
    };
  }

  /**
   * 步骤 3：图片插入后的 VLM 分诊闭环
   * 对每页带图幻灯片截图 → VLM 评审 → rootCause 分诊 → HTML/图片/二者重生成
   * 触发最大次数后取最优版本。
   */

export async function runPostImageVlmTriageLoopImpl(this: any, params: {
    result: Presentation;
    plan: PresentationPlan | undefined;
    design: DesignProposal | undefined;
    agent: HTMLPresentationAgent;
    imageProvider: any;
    imageOptions: any;
    traceSessionId: string;
    topic: string;
    maxRetries: number;
    slideWidth: number;
    slideHeight: number;
    generationOptions: any;
    primaryColor?: string;
    colorTheme?: ColorTheme;
  }): Promise<{ regeneratedCount: number; attempts: number }> {
    const {
      result,
      plan,
      design,
      agent,
      imageProvider,
      imageOptions,
      traceSessionId,
      topic,
      maxRetries,
      slideWidth,
      slideHeight,
      generationOptions,
      primaryColor,
      colorTheme,
    } = params;

    // FR-15：从 generationOptions.referenceVisualAttributes 抽取分类参考图 seed 映射，
    // 供循环内图片重生成按 slide pageType 选取 img2img seed。
    const referenceSeedMap:
      Partial<Record<'cover' | 'content' | 'summary' | 'global', string>> | undefined = (() => {
      const rva = (generationOptions as any)?.referenceVisualAttributes;
      if (!rva || !rva.byCategory) return undefined;
      return {
        cover: rva.byCategory.cover?.referenceImageUrl,
        content: rva.byCategory.content?.referenceImageUrl,
        summary: rva.byCategory.summary?.referenceImageUrl,
        global: rva.global?.referenceImageUrl,
      };
    })();

    // —— FR-3 / 单源 primary：复用 5 级优先级 resolveEffectivePrimaryColor 确保与主流程一致 ——
    // 此前 finalEffectivePrimary 仅在 postProcessPresentation 作用域存在，
    // runPostImageVlmTriageLoop 是独立方法，因此此处按同一链再求一次，避免 regenOptions
    // 把 primaryColor 写回为 undefined → 内部 fallback #2563eb → styleViolationSignal 错判主题色。
    // FR-2.x：参考主色也纳入此链（参考 > 用户显式），使 triage 重生成与终局防线使用同一参考色。
    const refDeckPrimaryForTriage = resolveDeckReferencePrimaryColor(
      (generationOptions as any)?.referenceVisualAttributes ?? null,
    );
    const finalEffectivePrimary = resolveEffectivePrimaryColor(
      { primaryColor: refDeckPrimaryForTriage ?? primaryColor, colorTheme },
      {
        primaryColor: (design as any)?.primaryColor,
        colorTheme: (design as any)?.colorTheme,
      },
      '#2563eb',
    );

    if (!imageProvider || typeof imageProvider.generateImage !== 'function') {
      return { regeneratedCount: 0, attempts: 0 };
    }

    const vlmProvider = await this.auditService.getVlmProvider();
    if (!vlmProvider) {
      return { regeneratedCount: 0, attempts: 0 };
    }

    let renderer: InstanceType<typeof SlideRenderer> | null = null;
    try {
      renderer = new SlideRenderer({ width: slideWidth, height: slideHeight });
      await renderer.initialize();
    } catch (e) {
      console.warn(
        '[AI:VLM-LOOP] 渲染器初始化失败，跳过步骤3闭环:',
        e instanceof Error ? e.message : e,
      );
      return { regeneratedCount: 0, attempts: 0 };
    }

    const tmpDir = os.tmpdir();
    const previousProviderSession = (imageProvider as TraceableProvider).activeTraceSessionId;
    (imageProvider as TraceableProvider).activeTraceSessionId = traceSessionId;
    const previousVlmSession = (vlmProvider as TraceableProvider).activeTraceSessionId;
    (vlmProvider as TraceableProvider).activeTraceSessionId = traceSessionId;

    let totalRegenerated = 0;
    let attempt = 0;

    try {
      while (attempt < maxRetries) {
        attempt++;
        simpleLog(
          'AI:AUDIT',
          `[RETRY] stage=audit attempt=${attempt}/${maxRetries} loop=vlm-triage`,
        );
        setSessionStage(traceSessionId, 'post-image-vlm-triage');
        simpleLog('AI:VLM-LOOP', `开始第 ${attempt} 轮终局 VLM 分诊评审`);

        const slidesToCheck: number[] = [];
        for (let i = 0; i < result.slides.length; i++) {
          const s = result.slides[i];
          if ((s as any).hidden) continue;
          const hasImg = /<img\b/i.test(s.html);
          const hasPlaceholder = s.html.includes(IMAGE_PLACEHOLDER);
          if (hasImg || hasPlaceholder) slidesToCheck.push(i);
        }

        if (slidesToCheck.length === 0) break;

        let hadRegeneration = false;

        for (const idx of slidesToCheck) {
          const slide = result.slides[idx];
          const inlinedHtml = this.inlineLocalImagesForScreenshot(slide.html, result.id);
          const shotPath = await this.captureSlideScreenshot(renderer, inlinedHtml, idx, tmpDir);
          if (!shotPath) continue;

          const vlm = await runVlmCritique(vlmProvider, shotPath, idx, slide.title, 'final');
          if (!this.vlmHasBlockingIssue(vlm)) continue;

          const triage = triageSlideIssues(vlm.issues);
          const feedback = this.buildVlmFeedback(vlm);
          simpleLog('AI:VLM-LOOP', `第 ${idx + 1} 页 VLM 评审不通过，分诊结果: ${triage}`, {
            issueCount: vlm.issues.length,
            score: vlm.score,
          });

          const slidePlan = plan?.slides?.[idx];
          const ratio = (slide as any).imageRatio || (slidePlan as any)?.imageRatio || '4:3';
          const targetSize = mapRatioToSize(ratio, imageOptions?.size);

          if (triage === 'image') {
            const originalPrompt =
              (slidePlan as any)?.imagePrompt ||
              `${topic} - ${slide.title || ''}，商务级专业插画品质，细腻细节，高完成度画面，整体配色与主题协调`;
            const enhancedPrompt = `${originalPrompt}\n\n【视觉评审反馈，请针对性改进图片本身，避免之前的问题】\n${feedback}`;
            const newUrl = await this.generateAndLocalizeImage({
              imageProvider,
              imagePrompt: enhancedPrompt,
              targetSize,
              presentationId: result.id,
              slideIdx: idx,
              imageOptions,
              referenceImageByCategory: referenceSeedMap,
              referenceCategory: slide.pageType,
            });
            if (newUrl) {
              if (slide.html.includes(IMAGE_PLACEHOLDER)) {
                slide.html = replaceImagePlaceholderWithRealSrc(slide.html, newUrl, ratio as any);
              } else {
                const { imgs } = collectImageRefs(slide.html);
                const localImgs = imgs.filter((ref) => isLocalAssetUrl(ref.src));
                if (localImgs.length > 0) {
                  slide.html = replaceImageUrlInHtml(slide.html, localImgs[0].src, newUrl);
                }
              }
              totalRegenerated++;
              hadRegeneration = true;
            }
          } else if (triage === 'html' || triage === 'both') {
            // 2025-07 P1-B 修复：VLM issue 若全部为「warn 级别」（原 severity ∈ {minor/important} 映射链），
            //   且没有 fatal(error) 级 issue → 不触发整页 HTML regenerate。
            // 原因：「对齐松散 / 图标密度高」这种视觉 minor/warn 类建议一旦交给 regenerateSingleSlide 整页重写，
            //   LLM 会把 metric 数值、H2 标题、进度条比例、badge 文案 全部重做 → 内容漂移 & 样式畸形。
            // 保护策略：
            //   - triage === 'html' 且 非 fatal → 直接跳过 HTML 重写；
            //   - triage === 'both' 且 非 fatal → 允许图片 regenerate，但跳过 HTML。
            // TODO(#R1-followup): 提供 auditSettings.allowMinorHtmlRegen 扩展位，若后续需要强审核模式可显式打开。
            const hasVlmFatal = vlm.issues.some((i) => i.severity === 'error');
            const allNonFatal = vlm.issues.length > 0 && !hasVlmFatal;
            if (allNonFatal && triage === 'html') {
              console.info(
                `[AI:VLM-LOOP] slide ${idx + 1} 全是非 fatal VLM issue（均为 warn/info 级视觉建议），按 P1-B 政策不整页 HTML 重写（避免灾难性劣化）：` +
                  JSON.stringify(vlm.issues.map((i) => `${i.severity}:${i.ruleId || i.message}`)),
              );
              continue;
            }
            if (!plan || !design) {
              console.warn(
                `[AI:VLM-LOOP] 第 ${idx + 1} 页需要 HTML 重生成但缺少 plan/design，跳过`,
              );
              continue;
            }
            try {
              // FR-3(d) / FR-6 / AC-6 / AC-4 调用点改造：
              // - regenOptions.primaryColor / colorTheme 显式写回单源值（finalEffectivePrimary / 入参 colorTheme），
              //   防止展开对象时 undefined 覆盖 → regenerateSingleSlide 内部 fallback 蓝 #2563eb → styleViolationSignal 错判活力橙。
              // - imagePreference 显式保留（FR-6）：即使 imageProvider/imageOptions 被置 undefined，
              //   LLM prompt 仍会按偏好要求 LLM 生成 NOPPT_IMAGE_PLACEHOLDER，便于 Line 2994 检测占位再重图。
              // - 第 9 形参 originalHtml = slide.html（AC-6 / Task6）：budget 超支时 agent 返回原 HTML，不再被替换成 generateFallbackSlide。
              const regenOptions = {
                ...(generationOptions || {}),
                imageProvider: undefined,
                imageOptions: undefined,
                primaryColor: finalEffectivePrimary,
                colorTheme: colorTheme ?? (generationOptions?.colorTheme as ColorTheme | undefined),
                imagePreference:
                  (generationOptions?.imagePreference as ImagePreference | undefined) ??
                  'content-only',
                referenceVisualAttributes:
                  (generationOptions as any)?.referenceVisualAttributes ?? undefined,
              };

              // P1-B triage==='both' && allNonFatal → 跳过 HTML regenerate，仅尝试图片侧生成（若 imageProvider 存在）
              const skipHtmlRegen = allNonFatal && triage === 'both';
              let regenerated: Awaited<ReturnType<HTMLPresentationAgent['regenerateSingleSlide']>> =
                null;
              if (!skipHtmlRegen) {
                const originalHtmlBeforeRegen: string = slide.html;
                regenerated = await agent.regenerateSingleSlide(
                  topic,
                  plan,
                  design,
                  idx,
                  regenOptions,
                  traceSessionId,
                  feedback,
                  'vlm-triage',
                  originalHtmlBeforeRegen,
                );
                if (regenerated) {
                  // FR-6: triage==='html' 且 pageType 为带图类，验证占位符未丢（若丢则写 warn，不阻断）
                  const needImgType =
                    /image/i.test(regenerated.pageType || '') ||
                    /cover/i.test(regenerated.pageType || '');
                  if (
                    triage === 'html' &&
                    needImgType &&
                    !regenerated.html.includes(IMAGE_PLACEHOLDER) &&
                    !/<img\b/i.test(regenerated.html)
                  ) {
                    console.warn(
                      `[AI:VLM-LOOP] 第 ${idx + 1} 页 pageType=${regenerated.pageType} 本应为带图结构，但 regenerated HTML 丢失图片占位符。` +
                        `建议修复 LLM prompt 约束（已保留原始 slide.html 作为备选但本次实际使用 regenerated 版本）。`,
                    );
                  }
                  slide.html = regenerated.html;
                  (slide as any).imagePrompt = regenerated.imagePrompt;
                  (slide as any).imageRatio = regenerated.imageRatio;
                  (slide as any).pageType = regenerated.pageType;
                  totalRegenerated++;
                  hadRegeneration = true;
                }
              } else {
                console.info(
                  `[AI:VLM-LOOP] slide ${idx + 1} triage=both 且全部 issue 非 fatal；按 P1-B 政策保留原 HTML，仅走图片侧（若有图且可生成）。`,
                );
                hadRegeneration = true; // 仍标记为发生过处理（图片侧可能写回）
              }

              if (
                (skipHtmlRegen || (regenerated && regenerated.html.includes(IMAGE_PLACEHOLDER))) &&
                imageProvider?.generateImage
              ) {
                const newRatio = (
                  skipHtmlRegen ? ratio : regenerated?.imageRatio || ratio
                ) as string;
                const newSize = mapRatioToSize(newRatio, imageOptions?.size);
                const regenTitle = regenerated?.title || slide.title || '';
                const regenImgPrompt =
                  regenerated?.imagePrompt ||
                  (slidePlan as any)?.imagePrompt ||
                  `${topic} - ${regenTitle}，商务级专业插画品质`;
                const imgPrompt =
                  triage === 'both'
                    ? `${regenImgPrompt}\n\n【视觉评审反馈，请针对性改进图片本身】\n${feedback}`
                    : regenImgPrompt;
                const newUrl = await this.generateAndLocalizeImage({
                  imageProvider,
                  imagePrompt: imgPrompt,
                  targetSize: newSize,
                  presentationId: result.id,
                  slideIdx: idx,
                  imageOptions,
                  referenceImageByCategory: referenceSeedMap,
                  referenceCategory: slide.pageType,
                });
                if (newUrl) {
                  slide.html = replaceImagePlaceholderWithRealSrc(
                    slide.html,
                    newUrl,
                    newRatio as any,
                  );
                }
              }
            } catch (e) {
              console.warn(
                `[AI:VLM-LOOP] 第 ${idx + 1} 页 HTML 重生成失败:`,
                e instanceof Error ? e.message : e,
              );
            }
          }
        }

        if (hadRegeneration) {
          for (let i = 0; i < result.slides.length; i++) {
            result.slides[i].html = sanitizeHtmlServerSide(result.slides[i].html);
          }
          (result as any).updatedAt = Date.now();
          await this.storage.writeJsonFile(
            join(this.storage.getPresentationDir(result.id), 'presentation.json'),
            result,
          );
        } else {
          break;
        }
      }
    } finally {
      (imageProvider as TraceableProvider).activeTraceSessionId = previousProviderSession;
      (vlmProvider as TraceableProvider).activeTraceSessionId = previousVlmSession;
      if (renderer) {
        try {
          await renderer.close();
        } catch {
          /* ignore */
        }
      }
    }

    return { regeneratedCount: totalRegenerated, attempts: attempt };
  }

  /**
   * 审核图片重生成闭环：VLM 视觉评审发现图片问题后，
   * 把 fixSuggestion 拼入原始 prompt 重新生成图片并替换，受 maxRegenerationRetries 控制。
   */

export async function runAuditImageRegenerationLoopImpl(this: any, params: {
    result: Presentation;
    plan: PresentationPlan | undefined;
    imageProvider: any;
    imageConfig: any;
    traceSessionId: string;
    topic: string;
    maxRetries: number;
    designContext: { style: string; primaryColor: string; fontFamily: string; iconStyle: string };
    referenceContext?: ReferenceContext;
    referenceVisualAttributes?: ReferenceVisualAttributes;
  }): Promise<{ regeneratedCount: number; attempts: number }> {
    const {
      result,
      plan,
      imageProvider,
      imageConfig,
      traceSessionId,
      topic,
      maxRetries,
      designContext,
    } = params;
    // FR-15：分类参考图 seed 映射，供循环内图片重生成按 slide pageType 选取 img2img seed。
    const referenceSeedMap:
      Partial<Record<'cover' | 'content' | 'summary' | 'global', string>> | undefined = (() => {
      const rva = params.referenceVisualAttributes;
      if (!rva || !rva.byCategory) return undefined;
      return {
        cover: rva.byCategory.cover?.referenceImageUrl,
        content: rva.byCategory.content?.referenceImageUrl,
        summary: rva.byCategory.summary?.referenceImageUrl,
        global: rva.global?.referenceImageUrl,
      };
    })();
    let totalRegenerated = 0;
    let attempt = 0;

    if (!imageProvider || typeof imageProvider.generateImage !== 'function') {
      return { regeneratedCount: 0, attempts: 0 };
    }

    const previousProviderSession = (imageProvider as TraceableProvider).activeTraceSessionId;
    (imageProvider as TraceableProvider).activeTraceSessionId = traceSessionId;

    try {
      while (attempt < maxRetries) {
        attempt++;
        simpleLog(
          'AI:AUDIT',
          `[RETRY] stage=audit attempt=${attempt}/${maxRetries} loop=image-regen`,
        );
        setSessionStage(traceSessionId, 'audit-image-regen');

        const report = await this.auditService.auditPresentationFromData(result, result.id, {
          plan,
          designContext,
          referenceContext: params.referenceContext,
        });

        const visibleSlides = result.slides.filter((s) => !(s as any).hidden);
        const visibleToReal: number[] = [];
        result.slides.forEach((s, realIdx) => {
          if (!(s as any).hidden) visibleToReal.push(realIdx);
        });

        const imageIssues = report.issues.filter(
          (i) =>
            i.engine === 'visual' &&
            (i.severity === 'error' || i.severity === 'warn') &&
            i.metadata?.source === 'vlm' &&
            i.metadata?.imageRelated === true,
        );

        if (imageIssues.length === 0) {
          if (attempt > 1) {
            simpleLog('AI:AUDIT-IMG', `第 ${attempt} 轮审核无图片问题，闭环结束`, {
              id: result.id,
            });
          }
          break;
        }

        const issuesBySlide = new Map<number, string[]>();
        for (const issue of imageIssues) {
          if (issue.slideIndex < 0 || issue.slideIndex >= visibleToReal.length) continue;
          const realIdx = visibleToReal[issue.slideIndex];
          const arr = issuesBySlide.get(realIdx) || [];
          if (issue.fixSuggestion) arr.push(issue.fixSuggestion);
          else if (issue.message) arr.push(issue.message);
          issuesBySlide.set(realIdx, arr);
        }

        if (issuesBySlide.size === 0) break;

        const concurrency = 2;
        let running = 0;
        const queue: Array<() => Promise<void>> = [];
        let slideRegenCount = 0;

        for (const [realIdx, suggestions] of issuesBySlide) {
          queue.push(async () => {
            const slide = result.slides[realIdx];
            const { imgs, bgImages } = collectImageRefs(slide.html);
            const localImgs = imgs.filter((ref) => isLocalAssetUrl(ref.src));
            const localBg = bgImages.filter((ref) => isLocalAssetUrl(ref.url));

            if (localImgs.length === 0 && localBg.length === 0) return;

            const slidePlan = plan?.slides?.[realIdx] as any;
            const originalPrompt =
              slidePlan?.imagePrompt ||
              `${topic} - ${slide.title || ''}，商务级专业插画品质，细腻细节，高完成度画面，整体配色与主题协调`;
            const feedback = suggestions.map((s, i) => `${i + 1}. ${s}`).join('\n');
            const enhancedPrompt = `${originalPrompt}\n\n【视觉评审反馈，请针对性改进，避免之前的问题】\n${feedback}`;

            const tasks: Array<{
              oldUrl: string;
              newUrl: string;
              kind: 'img' | 'bg';
              ratio?: string;
            }> = [];

            for (const ref of localImgs) {
              const ratio = extractRatioFromImgTag(ref.fullMatch);
              const size = mapRatioToSize(ratio, imageConfig?.size);
              try {
                const images = await imageProvider.generateImage(enhancedPrompt, {
                  size,
                  n: 1,
                  referenceImageByCategory: referenceSeedMap,
                  referenceCategory: slide.pageType,
                });
                if (images && images.length > 0 && images[0].url) {
                  const localPath = await this.storage.saveImageFromUrl(result.id, images[0].url);
                  tasks.push({ oldUrl: ref.src, newUrl: localPath, kind: 'img', ratio });
                  simpleLog('AI:AUDIT-IMG', `第 ${attempt} 轮重生成内容配图`, {
                    id: result.id,
                    slide: realIdx + 1,
                    oldUrl: ref.src,
                    newUrl: localPath,
                    size,
                  });
                }
              } catch (e) {
                console.warn(
                  `[${formatBeijingTime()}] [AI:AUDIT-IMG] 第 ${realIdx + 1} 页内容配图重生成失败:`,
                  e instanceof Error ? e.message : e,
                );
              }
            }

            for (const ref of localBg) {
              try {
                const images = await imageProvider.generateImage(enhancedPrompt, {
                  size: '1792x1024',
                  n: 1,
                  referenceImageByCategory: referenceSeedMap,
                  referenceCategory: slide.pageType,
                });
                if (images && images.length > 0 && images[0].url) {
                  const localPath = await this.storage.saveImageFromUrl(result.id, images[0].url);
                  tasks.push({ oldUrl: ref.url, newUrl: localPath, kind: 'bg' });
                  simpleLog('AI:AUDIT-IMG', `第 ${attempt} 轮重生成背景图`, {
                    id: result.id,
                    slide: realIdx + 1,
                    oldUrl: ref.url,
                    newUrl: localPath,
                  });
                }
              } catch (e) {
                console.warn(
                  `[${formatBeijingTime()}] [AI:AUDIT-IMG] 第 ${realIdx + 1} 页背景图重生成失败:`,
                  e instanceof Error ? e.message : e,
                );
              }
            }

            if (tasks.length > 0) {
              for (const t of tasks) {
                slide.html = replaceImageUrlInHtml(slide.html, t.oldUrl, t.newUrl);
              }
              slideRegenCount += tasks.length;
            }
          });
        }

        const runNext = async (): Promise<void> => {
          if (queue.length === 0) return;
          const task = queue.shift()!;
          running++;
          try {
            await task();
          } finally {
            running--;
            if (running < concurrency && queue.length > 0) await runNext();
          }
        };
        const runners: Promise<void>[] = [];
        for (let i = 0; i < Math.min(concurrency, queue.length); i++) runners.push(runNext());
        await Promise.all(runners);

        if (slideRegenCount > 0) {
          totalRegenerated += slideRegenCount;
          for (let i = 0; i < result.slides.length; i++) {
            result.slides[i].html = sanitizeHtmlServerSide(result.slides[i].html);
          }
          (result as any).updatedAt = Date.now();
          await this.storage.writeJsonFile(
            join(this.storage.getPresentationDir(result.id), 'presentation.json'),
            result,
          );
          simpleLog('AI:AUDIT-IMG', `第 ${attempt} 轮完成，重生成 ${slideRegenCount} 张图片`, {
            id: result.id,
            slideCount: issuesBySlide.size,
          });
        } else {
          break;
        }
      }
    } finally {
      (imageProvider as TraceableProvider).activeTraceSessionId = previousProviderSession;
    }

    return { regeneratedCount: totalRegenerated, attempts: attempt };
  }
