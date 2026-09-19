// postProcessPresentation 巨型编排主体（从 ai.service.ts 外置）。
// 运行时行为零变更：ai.service.ts 保留 private postProcessPresentation 作为薄门面，
// 通过 postProcessPresentationImpl.call(this, ...) 调用本函数，this.* 全部经 AiService 实例解析。
// 纯逻辑符号（LayoutEngine / ensureSemanticWrapping / styleViolationSignal / isStructurePage 等）按包级导入；
// 原文件中的私有 helper（classifyProviderError / tagAuditProviderError / escapeHtmlText /
// darkenColorHex / buildFallbackSlideHtml）一并搬入本文件，避免回引造成循环依赖。
import type {
  ReferenceVisualAttributes,
  ReferenceContext,
  StyleViolationBreakdown,
  LLMCallTrace,
  ImageGenerationTrace,
  ImagePreference,
} from '@noppt/ai';
import {
  styleViolationSignal,
  exceedsThreshold,
  collectStyleViolationSamples,
  formatStyleViolationSamplesSummary,
  resolveReferencePrimaryColor,
  resolveFinalPagePrimaryColor,
  getReferencePaletteForPage,
  isStructurePage,
  formatBeijingTime,
  simpleLog,
  getLLMTraces,
  getImageTraces,
  closeTraceSession,
} from '@noppt/ai';
import { LayoutEngine } from '@noppt/core';
import type { Presentation } from '@noppt/core';
import { sanitizeHtmlServerSide } from '../../../utils/sanitize';
import { ensureSemanticWrapping } from '../utils/html-string';
import { join } from 'path';


import {
  classifyProviderError,
  tagAuditProviderError,
  escapeHtmlText,
  darkenColorHex,
  buildFallbackSlideHtml,
} from './html-helpers';
import { runAutoAudit } from './auto-audit';
import { runFinalWrite } from './final-write';

export async function postProcessPresentationImpl(
  this: any,
  presentation: any,
  params: any,
): Promise<any> {
    const {
      presentationId,
      slideWidth,
      slideHeight,
      consoleDetailedLocal,
      fileDetailedLocal,
      traceSessionId,
      topic,
      style,
      audience,
      slideCount,
      slideCountMin,
      slideCountMax,
      density,
      imagePreference,
      colorTheme,
      primaryColor,
      backgroundEnabled,
      iconStyle,
      fontFamily,
      referenceHtml,
      referenceImage,
      logSettings,
      logSettingsNormalized,
      planningConfig,
      contentConfig,
      editingConfig,
      imageConfig,
      imageProvider,
      plan,
      design,
      agent,
      generationOptions,
      enableAudit,
    } = params;

    const finalWidth = presentation.width || slideWidth || 1280;
    const finalHeight = presentation.height || slideHeight || 720;

    // —— Task4 / FR-3: 单源 primary 链（5 级优先级 resolveEffectivePrimaryColor）——
    // 全链路所有需要 primaryColor 的子阶段均从 finalEffectivePrimary 派生，
    // 彻底消除「design?.primaryColor / plan?.primaryColor / 局部 primaryColor 互相冲突」
    // 导致的 styleViolationSignal 错主题色误判（本规格 spec 3.9 根因）。
    // 额外：开发环境下若最终值与任何候选冲突，打印详细来源。
    // FR-2.x：参考主色纳入终局单源链（参考 > 用户 > 默认蓝），与 3512 triage / 903 主管线一致；
    // 避免无参考覆盖时回落默认蓝 #2563eb（缺口2：此前此处 5 级链缺参考分支，会把 design.primaryColor 写回蓝色，与红色成品冲突）。
    const finalEffectivePrimary = this.resolveFinalEffectivePrimary(presentation, generationOptions, {
      primaryColor,
      colorTheme,
      design,
    });

    let result: Presentation;
    if (presentationId) {
      result = {
        id: presentationId,
        title: presentation.title,
        slides: [],
        selectedSlideId: '',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        width: finalWidth,
        height: finalHeight,
      } as Presentation;
    } else {
      result = LayoutEngine.createPresentation(presentation.title, finalWidth, finalHeight);
    }

    result.slides = presentation.slides.map((slide, index) =>
      LayoutEngine.normalizeAISlide({
        id: LayoutEngine.createSlide(index).id,
        title: slide.title,
        html: slide.html,
        notes: slide.notes,
        hidden: false,
        index,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );

    // ———— 溢出风险指数估算日志（便于后续观察上图下文/纯文字页溢出率） ————
    try {
      const padYMatch = result.slides[0]?.html.match(/padding\s*:\s*(\d+)px\s+\d+px/i);
      const padY = padYMatch ? parseInt(padYMatch[1]) : 48;
      const availH = finalHeight - padY * 2;
      for (let i = 0; i < result.slides.length; i++) {
        const s = result.slides[i];
        const h = s.html;
        const hasH2 = /<h2\b/i.test(h);
        const liCount = (h.match(/<li\b/gi) || []).length;
        // 同时检测两种垂直图片布局：TOP（imgWrap在list前）和 BOTTOM（list在imgWrap前，即下文上图DOM换序）
        // 先分别找 H2 后第一个 imgWrap(带flex:0 0 XX%且内部有img) 和 第一个 <ul/ol>
        let layoutMode: 'top' | 'bottom' | null = null;
        let imgFlexPct: number | null = null;
        if (hasH2 && liCount > 0) {
          const h2M = h.match(/<h2\b[^>]*>[\s\S]*?<\/h2>/i);
          if (h2M && h2M.index !== undefined) {
            const after = h.slice(h2M.index + h2M[0].length);
            const imgM = after.match(/<img\b/i);
            const listM = after.match(/<(ul|ol)\b/i);
            if (imgM && listM && imgM.index != null && listM.index != null) {
              // 找 <img 之前最近的 div(flex:0 0 XX%)
              const beforeImg = after.slice(0, imgM.index);
              const divFlexM = beforeImg.match(
                /<div\b[^>]*style="[^"]*flex\s*:\s*0\s+0\s+(\d+)(?:\.\d+)?%[^"]*"[^>]*>(?=[^>]*$)/,
              );
              // 上面的断言可能太严格，退一步：取 beforeImg 中最后一个 <div style="...flex:0 0 XX%"> 的匹配
              let lastFlex: RegExpMatchArray | null = null;
              const re = /<div\b[^>]*style="[^"]*flex\s*:\s*0\s+0\s+(\d+)(?:\.\d+)?%[^"]*"[^>]*>/gi;
              let mm: RegExpExecArray | null;
              while ((mm = re.exec(beforeImg)) !== null) lastFlex = mm;
              if (lastFlex) {
                imgFlexPct = parseFloat(lastFlex[1]);
                layoutMode = imgM.index < listM.index ? 'top' : 'bottom';
              } else if (divFlexM) {
                imgFlexPct = parseFloat(divFlexM[1]);
                layoutMode = imgM.index < listM.index ? 'top' : 'bottom';
              }
            }
          }
        }
        const hasVerticalImg = layoutMode != null;
        const imgH = imgFlexPct != null ? (availH * imgFlexPct) / 100 : 0;
        const h2H = hasH2 ? 44 * 1.25 + 32 : 0;
        const avgLiH =
          liCount > 0 && /padding\s*:\s*12px\s+20px/i.test(h)
            ? 12 * 2 + 20 * 1.4 + 12
            : 16 * 2 + 24 * 1.4 + 16;
        const liH =
          liCount > 0
            ? avgLiH *
              (hasVerticalImg && /display\s*:\s*grid/i.test(h) ? Math.ceil(liCount / 2) : liCount)
            : 0;
        const estH = h2H + imgH + liH;
        const ratio = availH > 0 ? estH / availH : 0;
        const level: 'low' | 'mid' | 'high' = ratio > 1.05 ? 'high' : ratio > 0.92 ? 'mid' : 'low';
        const isGrid = /display\s*:\s*grid/i.test(h);
        if (level !== 'low' || hasVerticalImg) {
          const msgBase =
            `risk=${level} estH=${estH.toFixed(0)}px avail=${availH}px ratio=${ratio.toFixed(2)} ` +
            `vLayout=${layoutMode ?? 'none'} imgFlex=${imgFlexPct ?? 0}% liCount=${liCount} grid=${isGrid}`;
          if (level === 'high') {
            console.warn(
              `[${formatBeijingTime()}] [AI:OVERFLOW-RISK] slide ${i + 1} "${s.title}": ${msgBase}`,
            );
          } else if (consoleDetailedLocal && hasVerticalImg) {
            console.log(
              `[${formatBeijingTime()}] [AI:OVERFLOW-RISK] slide ${i + 1} "${s.title}": ${msgBase}`,
            );
          }
        }
      }
    } catch (e) {
      // 日志绝不影响主流程
      void e;
    }

    if (presentation.transition) {
      (result as any).transition = presentation.transition;
    }
    if (presentation.primaryColor) {
      (result as any).primaryColor = presentation.primaryColor;
    }
    // ———— B-3 · 显式透传 imagePreference 到 result ————
    // 这是孤儿救援逻辑 L335 的 explicitPref 来源：如果这里漏掉，explicitPref=undefined，
    // 会 fallback 到 inferImagePreferenceFromPresentation，从而误判成 minimal（因为
    // 救援之前本来就没图），最终 cover/summary 的 BG 注入永远不触发，陷入"没图→infer minimal
    // →不填→还是没图"的死循环。
    if ((presentation as any).imagePreference) {
      (result as any).imagePreference = (presentation as any).imagePreference;
    }

    if (!presentationId) {
      this.storage.ensurePresentationDir(result.id);
    }

    const IMAGE_PLACEHOLDER = 'https://NOPPT_IMAGE_PLACEHOLDER';
    const imgUrlCache = new Map<string, string>();
    const detailed = consoleDetailedLocal;
    let downloadedCount = 0;
    let bareTextFixed = 0;

    if (detailed) {
      console.log(`[${formatBeijingTime()}] [AI] Image config enabled:`, imageConfig?.enabled);
      console.log(
        `[${formatBeijingTime()}] [AI] Image useDefaultProvider:`,
        imageConfig?.useDefaultProvider,
      );
    }

    for (let slideIndex = 0; slideIndex < result.slides.length; slideIndex++) {
      const slide = result.slides[slideIndex];
      // ⚠️【B-3 Server 端同步兜底】先过一遍语义化修复，再处理占位符/下载图片/孤儿图片。
      // 这样即使 AI 端漏掉裸文本（例如非标准流程生成的 HTML），Server 侧仍然保证无裸文本。
      const preLength = slide.html.length;
      slide.html = ensureSemanticWrapping(slide.html);
      if (slide.html.length !== preLength) {
        bareTextFixed++;
        if (detailed) {
          console.log(
            `[${formatBeijingTime()}] [AI] Slide ${slideIndex + 1} "${slide.title}" cleaned bare text (${preLength} → ${slide.html.length} chars) by server-side ensureSemanticWrapping`,
          );
        }
      }
      const hasPlaceholder = slide.html.includes(IMAGE_PLACEHOLDER);
      if (hasPlaceholder && detailed) {
        console.log(
          `[${formatBeijingTime()}] [AI] Slide ${slideIndex + 1} "${slide.title}" has image placeholder - removing (image gen failed or disabled)`,
        );
      }
      if (hasPlaceholder) {
        slide.html = slide.html.replace(
          /<div[^>]*>\s*<img[^>]*src=["']https:\/\/NOPPT_IMAGE_PLACEHOLDER["'][^>]*>\s*<\/div>/gi,
          '',
        );
        slide.html = slide.html.replace(
          /<img[^>]*src=["']https:\/\/NOPPT_IMAGE_PLACEHOLDER["'][^>]*>/gi,
          '',
        );
      }

      const imgRegex = /<img[^>]*src\s*=\s*["']([^"']*)["'][^>]*>/gi;
      let match;
      const imgsToReplace: Array<{ original: string; replacement: string }> = [];

      while ((match = imgRegex.exec(slide.html)) !== null) {
        const originalUrl = match[1]
          .trim()
          .replace(/^`|`$/g, '')
          .trim()
          .replace(/^["']|["']$/g, '')
          .trim();

        const isPlaceholder =
          originalUrl === IMAGE_PLACEHOLDER || originalUrl.includes('NOPPT_IMAGE_PLACEHOLDER');
        if (isPlaceholder) {
          imgsToReplace.push({ original: match[0], replacement: '' });
          continue;
        }

        if (
          originalUrl &&
          !originalUrl.startsWith('/data/') &&
          !originalUrl.startsWith('http://localhost') &&
          !originalUrl.startsWith('#') &&
          !originalUrl.startsWith('data:')
        ) {
          if (!imgUrlCache.has(originalUrl)) {
            try {
              if (detailed) {
                console.log(
                  `[${formatBeijingTime()}] [AI] Downloading image from URL: ${originalUrl.substring(0, 100)}...`,
                );
              }
              const localPath = await this.storage.saveImageFromUrl(result.id, originalUrl);
              imgUrlCache.set(originalUrl, localPath);
              downloadedCount++;
              if (detailed) {
                console.log(`[${formatBeijingTime()}] [AI] Image saved locally to: ${localPath}`);
              }
            } catch (e) {
              console.error(`[${formatBeijingTime()}] [AI] Failed to download/save image:`, e);
              imgUrlCache.set(originalUrl, originalUrl);
            }
          }
          const localUrl = imgUrlCache.get(originalUrl);
          if (localUrl && localUrl !== originalUrl) {
            imgsToReplace.push({ original: originalUrl, replacement: localUrl });
          }
        }
      }

      for (const { original, replacement } of imgsToReplace) {
        slide.html = slide.html.split(original).join(replacement);
      }

      const bgImgRegex = /background-image\s*:\s*[^;]*url\(\s*['"]?([^'")]+)['"]?\s*\)[^;]*;?/gi;
      let bgMatch;
      const bgImgsToReplace: Array<{ original: string; url: string; replacement: string }> = [];

      while ((bgMatch = bgImgRegex.exec(slide.html)) !== null) {
        const originalUrl = bgMatch[1]
          .trim()
          .replace(/^`|`$/g, '')
          .trim()
          .replace(/^["']|["']$/g, '')
          .trim();

        const isPlaceholder =
          originalUrl.includes('NOPPT_BG_PLACEHOLDER') ||
          originalUrl.includes('NOPPT_IMAGE_PLACEHOLDER');
        if (isPlaceholder) {
          continue;
        }

        if (
          originalUrl &&
          !originalUrl.startsWith('/data/') &&
          !originalUrl.startsWith('http://localhost') &&
          !originalUrl.startsWith('#') &&
          !originalUrl.startsWith('data:')
        ) {
          if (!imgUrlCache.has(originalUrl)) {
            try {
              if (detailed) {
                console.log(
                  `[${formatBeijingTime()}] [AI] Downloading background image from URL: ${originalUrl.substring(0, 100)}...`,
                );
              }
              const localPath = await this.storage.saveImageFromUrl(result.id, originalUrl);
              imgUrlCache.set(originalUrl, localPath);
              downloadedCount++;
              if (detailed) {
                console.log(
                  `[${formatBeijingTime()}] [AI] Background image saved locally to: ${localPath}`,
                );
              }
            } catch (e) {
              console.error(
                `[${formatBeijingTime()}] [AI] Failed to download/save background image:`,
                e,
              );
              imgUrlCache.set(originalUrl, originalUrl);
            }
          }
          const localUrl = imgUrlCache.get(originalUrl);
          if (localUrl && localUrl !== originalUrl) {
            const newBgDecl = bgMatch[0].replace(originalUrl, localUrl);
            bgImgsToReplace.push({
              original: bgMatch[0],
              url: originalUrl,
              replacement: newBgDecl,
            });
          }
        }
      }

      for (const { original, replacement } of bgImgsToReplace) {
        slide.html = slide.html.split(original).join(replacement);
      }
    }

    if (!detailed && (downloadedCount > 0 || bareTextFixed > 0)) {
      simpleLog('AI:POST', '后处理完成', {
        images: downloadedCount,
        bareTextFixed,
        slides: result.slides.length,
      });
    }

    // ========== 兜底：扫描磁盘孤儿配图 → 回填到无图内容页 / 封面 / 总结 ==========
    // B-3 扩展：感知 imagePreference
    //  - 优先使用 presentation.imagePreference（AI 包透传）；否则启发式推断
    //  - pref=all 下 cover/summary 不再过滤，优先使用背景大图注入
    //  - 新增 injectOrphanImageIntoBackground 给 cover/summary 用
    const orphanRescued = this.rescueOrphanImages(result, detailed);
    // ========== 终局兜底（写入磁盘前的最后防线）==========
    let finalGuardFixed = 0;
    let finalGuardRescued = 0;
    try {
      // ——— 防线 1：裸文本终局校正 ———
      for (let idx = 0; idx < result.slides.length; idx++) {
        const slide = result.slides[idx];
        const prevLen = slide.html.length;
        slide.html = ensureSemanticWrapping(slide.html);
        if (slide.html.length !== prevLen) {
          finalGuardFixed++;
          if (detailed) {
            console.log(
              `[${formatBeijingTime()}] [AI] [FINAL-GUARD-1] slide ${idx + 1} "${slide.title}" final bare-text cleanup (${prevLen}→${slide.html.length})`,
            );
          }
        }
      }
      // ——— 防线 2：孤儿图片终局注入 ———
      try {
        const imagesDir2 = this.storage.getImagesDir(result.id);
        const allFiles2 = this.storage.listDir(imagesDir2);
        const imageFiles2 = allFiles2.filter((f) => /\.(png|jpe?g|webp)$/i.test(f));
        const soup2 = result.slides.map((s) => s.html).join('\n');
        const orphans2 = imageFiles2.filter((name) => !soup2.includes(name));
        if (orphans2.length > 0) {
          if (detailed) {
            console.log(
              `[${formatBeijingTime()}] [AI] [FINAL-GUARD-2] found ${orphans2.length} unplaced images after main guard, retry rescue...`,
            );
          }
          const explicitPref2 = (result as any).imagePreference as ImagePreference | undefined;
          const pref2 = explicitPref2 || this.inferImagePreferenceFromPresentation(result);
          const singleSlide2 = result.slides.length === 1;
          const urlOf = (i: number) =>
            `/data/workspace/presentations/${result.id}/assets/images/${orphans2[i]}`;
          let oi = 0;
          const rescueFew2 = pref2 === 'minimal' || pref2 === 'none';
          const maxF = rescueFew2 ? Math.min(2, orphans2.length) : orphans2.length;
          for (
            let sIdx = 0;
            sIdx < result.slides.length && oi < orphans2.length && oi < maxF;
            sIdx++
          ) {
            const slide = result.slides[sIdx];
            // 结构页（封面/目录/总结）恒不配图：孤儿救援终局注入也一律跳过
            const inferredPt2 =
              sIdx === 0 ? 'cover' : sIdx === result.slides.length - 1 ? 'summary' : 'content';
            if (isStructurePage(inferredPt2)) continue;
            if (
              /data-layout\s*=\s*["']?toc\b/i.test(slide.html) ||
              /目录|table\s*of\s*contents|大纲/i.test(slide.html)
            ) continue;
            if (/<img\b/i.test(slide.html)) continue;
            if (pref2 !== 'all' && !singleSlide2) {
              const cLike =
                /font-size:\s*[7-9]\dpx|font-size:\s*1\d{2,}px|<h1\b|总结|感谢|开启.*纪元|结论/i.test(
                  `${slide.title} ${slide.html}`,
                );
              if (cLike) continue;
            }
            if (!this.slideHasMeaningfulBody(slide.html)) continue;
            const rebuilt = this.injectOrphanImageIntoSlide(slide.html, urlOf(oi), {
              pageType: inferredPt2,
            });
            if (rebuilt !== slide.html) {
              if (detailed) {
                console.log(
                  `[${formatBeijingTime()}] [AI] [FINAL-GUARD-2] slide ${sIdx + 1} "${slide.title}" <-- ${orphans2[oi]}`,
                );
              }
              slide.html = rebuilt;
              oi++;
            }
          }
          finalGuardRescued = oi;
          if (oi > 0 && detailed) {
            console.log(
              `[${formatBeijingTime()}] [AI] [FINAL-GUARD-2] rescued ${oi}/${orphans2.length} images via final guard`,
            );
          }
        }
      } catch (e2) {
        console.warn(
          `[${formatBeijingTime()}] [AI] [FINAL-GUARD-2] skipped due to error:`,
          (e2 as Error).message,
        );
      }
    } catch (finalGuardErr) {
      console.warn(
        `[${formatBeijingTime()}] [AI] [FINAL-GUARD] skipped due to error:`,
        (finalGuardErr as Error).message,
      );
    }

    if (!detailed) {
      simpleLog('AI', '生成完成', {
        slides: result.slides.length,
        title: result.title.length > 30 ? result.title.substring(0, 30) + '…' : result.title,
        orphanRescued,
        finalGuardFixed,
        finalGuardRescued,
      });
    }


    await runFinalWrite({
      self: this,
      result: result,
      presentationId: presentationId,
      plan: plan,
      design: design,
      agent: agent,
      generationOptions: generationOptions,
      finalEffectivePrimary: finalEffectivePrimary,
      finalWidth: finalWidth,
      finalHeight: finalHeight,
      slideWidth: slideWidth,
      slideHeight: slideHeight,
      style: style,
      fontFamily: fontFamily,
      primaryColor: primaryColor,
      referenceHtml: referenceHtml,
      referenceImage: referenceImage,
      backgroundEnabled: backgroundEnabled,
      presentation: presentation,
    });

    await runAutoAudit({
      self: this,
      result,
      plan,
      presentation,
      design,
      agent,
      generationOptions,
      enableAudit,
      finalEffectivePrimary,
      style,
      fontFamily,
      iconStyle,
      contentConfig,
      imageConfig,
      imageProvider,
      traceSessionId,
      topic,
      colorTheme,
      finalWidth,
      finalHeight,
    });

    // ——— 文件日志：根据 fileVerbosity 决定详细程度 ———
    // 用本地变量判断（见开头的 logSettingsNormalized），避免并发下全局 runtimeConfig 被别的请求污染
    const fileDetailed = fileDetailedLocal;
    // 无论什么模式，先取出 traces（规划/内容/编辑 3 阶段 + 图片生成 完整 request/response 报文，**零截断**）
    // —— 核心承诺：这里的 traces.messages/prompt/response.content 等与实际发送/收到的内容完全一致，
    //    没有任何 truncate/裁剪，方便对比定位根源。
    // 必须先分别取 llmTraces 和 imageTraces，再 closeTraceSession（关闭后 session 从内存中删除）
    const llmTraces: LLMCallTrace[] = getLLMTraces(traceSessionId);
    const imageTraces: ImageGenerationTrace[] = getImageTraces(traceSessionId);
    closeTraceSession(traceSessionId);
    // 诊断日志：无论什么模式都在控制台打一行，便于以后判断是"fileDetailed=false 没写"还是"traces=[] 空"
    simpleLog('AI:LOG', `写入 ai-log.jsonl 前的诊断`, {
      fileDetailed: String(fileDetailed),
      llmTraces: llmTraces.length,
      // 图片生成相关 traces 数量（便于判断为什么日志里看不到图片报文）
      imageTraces: imageTraces.length,
      logVerbosity: logSettingsNormalized.fileVerbosity,
      reqLogSettings: logSettings ? JSON.stringify(logSettings) : 'absent',
    });
    const routingInfo = {
      planning: `${planningConfig.provider}/${planningConfig.model}`,
      content: `${contentConfig.provider}/${contentConfig.model}`,
      editing: `${editingConfig.provider}/${editingConfig.model}`,
    };
    if (fileDetailed) {
      // =============== 详细模式：完整报文 + 每页最终 HTML 零截断 ===============
      // 写入字段：
      //   1. request.*                —— 全部用户输入参数（含 modelConfigs/imageConfig/referenceHtml 长度等）
      //   2. request.referenceHtml?   —— 完整参考 HTML 原文（用于排查参考文件的影响）
      //   3. request.referenceImage?  —— 完整参考图 base64 原文
      //   4. response.presentation    —— 标题/配色/尺寸/转场/imagePreference 等
      //   5. response.slides          —— 每页完整 title + html + notes + imagePrompt（**不做长度限制**）
      //                                   这是排查"为什么某页是大片空白/裸文本/没有图"的最直接证据
      //   6. response.postProcessing  —— 下载图片数、裸文本修复、孤儿救援、终局防线等统计
      //   7. llmCalls: LLMCallTrace[] —— 3 个阶段的完整请求 messages + 完整响应 content
      //      每条 trace 包含：stage / provider / model / request.messages[] / request.options
      //                      / response.content/usage 或 error.message+stack
      //                      / startedAt / endedAt / durationMs
      await this.logsService.logAICall(result.id, 'generate-presentation', {
        request: {
          presentationIdIn: presentationId || null,
          topic,
          style,
          audience,
          slideCount,
          slideCountMin,
          slideCountMax,
          density,
          imagePreference,
          colorTheme,
          primaryColor,
          backgroundEnabled,
          iconStyle,
          fontFamily,
          slideWidth,
          slideHeight,
          referenceHtmlLength: referenceHtml?.length || 0,
          referenceHtml, // 完整原文，方便排查参考文件问题
          referenceImageLength: referenceImage?.length || 0,
          referenceImage, // 完整 base64，方便排查参考图问题
          modelConfigs: {
            planning: {
              provider: planningConfig.provider,
              model: planningConfig.model,
              baseUrl: planningConfig.baseUrl,
            },
            content: {
              provider: contentConfig.provider,
              model: contentConfig.model,
              baseUrl: contentConfig.baseUrl,
            },
            editing: {
              provider: editingConfig.provider,
              model: editingConfig.model,
              baseUrl: editingConfig.baseUrl,
            },
          },
          imageConfig: imageConfig
            ? {
                enabled: imageConfig.enabled,
                useDefaultProvider: imageConfig.useDefaultProvider,
                provider: imageConfig.provider,
                model: imageConfig.model,
                size: imageConfig.size,
                gatewayVendor: imageConfig.gatewayVendor,
                allModels: imageConfig.allModels,
                routing: imageConfig.routing,
              }
            : undefined,
        },
        response: {
          presentation: {
            id: result.id,
            title: presentation.title,
            slideCount: presentation.slides.length,
            primaryColor: presentation.primaryColor,
            transition: (presentation as any).transition,
            imagePreference: (presentation as any).imagePreference,
            width: finalWidth,
            height: finalHeight,
            description: presentation.description,
          },
          // 每页最终 HTML 完整原文（终局防线之后、写盘前的快照），无任何截断
          slides: result.slides.map((s, i) => ({
            index: i + 1,
            title: s.title,
            notes: s.notes,
            htmlLength: s.html.length,
            hasImage: /<img\b/i.test(s.html),
            hasBgImage: /background-image/i.test(s.html),
            html: s.html, // ← 关键：完整 HTML 原文
            imagePrompt: (s as any).imagePrompt,
            imageRatio: (s as any).imageRatio,
            pageType: (s as any).pageType,
            elements: (s as any).elements,
          })),
          postProcessing: {
            downloadedImages: downloadedCount,
            bareTextFixedSlides: bareTextFixed,
            orphanRescued,
            finalGuard: { bareTextFixed: finalGuardFixed, orphanRescued: finalGuardRescued },
          },
        },
        // 核心：3 阶段 LLM 调用完整报文（messages/options/response/error 零截断）
        llmCalls: llmTraces.map((t) => ({
          stage: t.stage,
          provider: t.provider,
          model: t.model,
          durationMs: t.durationMs,
          startedAt: new Date(t.startedAt).toISOString(),
          endedAt: new Date(t.endedAt).toISOString(),
          // 以下字段**不做任何截断**，完整复制原文，保证排查时的原始证据
          request: {
            messages: t.request.messages,
            options: t.request.options,
          },
          response: t.response
            ? {
                content: t.response.content,
                model: t.response.model,
                usage: t.response.usage,
              }
            : undefined,
          error: t.error,
        })),
        llmCallCount: llmTraces.length,
        // —— 新增：图片生成完整报文（prompt / options / images / revisedPrompt / error 零截断）——
        // 用于排查：半边图像、颜色错误、大面积纯色空白、prompt_extend 改写失控 等问题
        imageGenerationCalls: imageTraces.map((t) => ({
          stage: t.stage,
          provider: t.provider,
          model: t.model,
          size: t.size,
          scene: t.scene,
          durationMs: t.durationMs,
          startedAt: new Date(t.startedAt).toISOString(),
          endedAt: new Date(t.endedAt).toISOString(),
          // 完整请求（零截断）：prompt 原文 + 所有 options（含 model/size/n/referenceImage）
          request: t.request,
          // 完整响应（零截断）：images[].url / revisedPrompt（这是 prompt_extend 改写后的真实 prompt，对排查颜色/构图错误至关重要）
          response: t.response
            ? {
                images: t.response.images.map((img) => ({
                  url: img.url,
                  revisedPrompt: img.revisedPrompt,
                })),
                // 平台原始响应（如果不是太大），方便对比 images 字段和平台返回的一致性
                rawPreview:
                  t.response.raw && typeof t.response.raw === 'object'
                    ? {
                        request_id: (t.response.raw as any).request_id,
                        code: (t.response.raw as any).code,
                        message: (t.response.raw as any).message,
                        usage: (t.response.raw as any).usage,
                        outputChoicesCount: (t.response.raw as any).output?.choices?.length,
                      }
                    : undefined,
              }
            : undefined,
          error: t.error,
        })),
        imageGenerationCallCount: imageTraces.length,
        model: planningConfig.model,
        provider: planningConfig.provider,
        routing: routingInfo,
      });
    } else {
      // 简单模式：仅记录基础摘要，不记录 messages/response.html 等大字段
      await this.logsService.logAICall(result.id, 'generate-presentation', {
        request: { topic, style, audience, slideCount, density, imagePreference, colorTheme },
        response: {
          presentation: {
            title: presentation.title,
            slideCount: presentation.slides.length,
          },
        },
        llmCallCount: llmTraces.length,
        // 简单模式也保留数量级信息，便于后续判断"有没有触发图片生成"
        imageGenerationCallCount: imageTraces.length,
        model: planningConfig.model,
        provider: planningConfig.provider,
        routing: routingInfo,
      });
    }

    return result;
  }
