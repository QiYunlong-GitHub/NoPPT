// 终局写盘阶段（从 postProcessPresentationImpl 外置，行为零变更）。
// 原实现为块作用域 { ... }：内部变量不外泄，仅做 sanitize / 终局防线重放 / 落盘 / 日志，
// 故抽为 Promise<void>。helper 一律直接 import；运行期数据经显式 FinalWriteCtx 传入（漏传即编译报错）。
import {
  styleViolationSignal,
  exceedsThreshold,
  collectStyleViolationSamples,
  formatStyleViolationSamplesSummary,
  resolveReferencePrimaryColor,
  resolveFinalPagePrimaryColor,
  getReferencePaletteForPage,
  simpleLog,
} from '@noppt/ai';
import {
  sanitizeHtmlServerSide,
} from '../../../utils/sanitize';
import {
  join,
} from 'path';
import {
  buildFallbackSlideHtml,
} from './html-helpers';
import type {
  ReferenceVisualAttributes,
  StyleViolationBreakdown,
} from '@noppt/ai';

export interface FinalWriteCtx {
  self: any;
  result: any;
  presentationId: any;
  plan: any;
  design: any;
  agent: any;
  generationOptions: any;
  finalEffectivePrimary: any;
  finalWidth: any;
  finalHeight: any;
  slideWidth: any;
  slideHeight: any;
  style: any;
  fontFamily: any;
  primaryColor: any;
  referenceHtml: any;
  referenceImage: any;
  backgroundEnabled: any;
  presentation: any;
}

export async function runFinalWrite(ctx: FinalWriteCtx): Promise<void> {
  const {
    self,
    result,
    presentationId,
    plan,
    design,
    agent,
    generationOptions,
    finalEffectivePrimary,
    finalWidth,
    finalHeight,
    slideWidth,
    slideHeight,
    style,
    fontFamily,
    primaryColor,
    referenceHtml,
    referenceImage,
    backgroundEnabled,
    presentation,
  } = ctx;

    // =============== 终局写盘：无论本次是新建（!presentationId）还是覆盖已有 pres（有 presentationId），
    // 只要 AI 生成完了，就强制把完整 result（含 <img> 的 layout）写回磁盘，
    // 彻底解决「前端 editor 模式下后端跳过写盘，前端 savePresentation 竞态导致 presentation.json 保存残缺裸文本版本」的根因。
    {
      // 🛡️ 写盘前最终 XSS 防线：服务端 HTML 白名单 sanitize，与前端 security.ts 保持一致
      for (const slide of result.slides) {
        if (slide.html && typeof slide.html === 'string') {
          slide.html = sanitizeHtmlServerSide(slide.html);
        }
      }

      // —— finalGuard：写盘前对每页 HTML 重放后处理全链（兜底任何未 post 的通道产物）——
      const finalSanitizeStat = { pages: result.slides.length, reapplied: 0, assertionFailed: 0 };
      // FR-3 / Task 4：finalMainColor 由函数入口的 finalEffectivePrimary 派生，
      // 并在下方「逐页」用参考主色（resolveReferencePrimaryColor）前置裁决后覆盖（参考 > 用户显式 > 默认蓝）。
      const slideW = slideWidth || finalWidth || 1280;
      const slideH = slideHeight || finalHeight || 720;
      // FR-A（回归修复）：参考属性来源兜底。generationOptions 在分步 finalizePresentation 等路径可能未带来源，
      // 此时用 presentationId + req 字段回源重解析（resolveReferenceVisualAttributes 内部走 sha1 缓存，命中零 I/O），
      // 确保逐页参考主色裁决不丢失（否则回落默认蓝，把参考红色重染）。
      let rva: ReferenceVisualAttributes | null | undefined =
        generationOptions?.referenceVisualAttributes;
      if (!rva) {
        try {
          rva =
            (
              await self.resolveReferenceVisualAttributes({
                presentationId,
                referenceHtml,
                referenceImage,
              } as any)
            ).referenceVisualAttributes ?? undefined;
        } catch {
          rva = undefined;
        }
      }

      for (const [i, slide] of result.slides.entries()) {
        if (!slide.html || typeof slide.html !== 'string') continue;
        const raw = slide.html;
        // FR-2.x：逐页用参考主色前置裁决——若该页对应分类/全局上传了参考图且含合法主色则以此为准，
        // 否则回落 finalEffectivePrimary（与今日行为完全一致，向后兼容）。
        // FR-0/FR-4：优先用 slide 自身 pageType；缺失（如前端 editor 落盘的残缺版本）时按位置兜底，
        // 避免 pageTypeToCategory('') 一律回落 'content'，使封面/总结取到各自参考色而非默认蓝。
        const rawPageType = String((slide as any)?.pageType ?? '').toLowerCase();
        const pageType =
          rawPageType ||
          (i === 0 ? 'cover' : i === result.slides.length - 1 ? 'summary' : 'content');
        // 终局逐页取色三级链：分类参考主色 → deck 级参考主色 → finalEffectivePrimary（用户显式/默认蓝）。
        // 修复收尾缺口：某分类参考图缺失（或 VLM 未抽出主色）且 global 也无主色时，取 deck 级参考红，
        // 避免该页回落默认蓝 #2563eb（plan 第 ④ 项）。
        const pageRefPrimary = resolveReferencePrimaryColor(rva ?? undefined, pageType);
        const finalMainColor = resolveFinalPagePrimaryColor(
          rva ?? undefined,
          pageType,
          finalEffectivePrimary,
        );
        // 参考撞色板 / 标题色 / 正文色 / 描边色 → 终局越权信号白名单，避免参考多色页被误判越权而反复重放。
        const cat =
          pageType === 'cover' || pageType === 'page-cover'
            ? 'cover'
            : pageType === 'summary' ||
                pageType === 'conclusion' ||
                pageType === 'ending' ||
                pageType === 'end'
              ? 'summary'
              : 'content';
        const slidePalette = rva ? getReferencePaletteForPage(rva, pageType) : undefined;
        const styleRef = rva ? (rva.byCategory[cat] ?? rva.global) : undefined;
        const allowedAccentHexes = new Set<string>(
          [
            ...(slidePalette?.accents || []),
            slidePalette?.strokeColor,
            slidePalette?.primary,
            (styleRef as any)?.style?.titleColor,
            (styleRef as any)?.style?.bodyColor,
          ]
            .filter((c): c is string => !!c)
            .map((c) => c.toLowerCase()),
        );
        if (!pageRefPrimary && finalMainColor !== finalEffectivePrimary) {
          console.log(
            `[FINAL] 第 ${i + 1} 页(${pageType}) 分类参考主色缺失 → deck 级参考主色 ${finalMainColor} 兜底（避免回落默认蓝）`,
          );
        }
        const proofOfViolation = styleViolationSignal(raw, finalMainColor, { allowedAccentHexes }); // breakdown: StyleViolationBreakdown
        const proofSamples = collectStyleViolationSamples(raw, proofOfViolation);
        // NFR-5 / Task 9: 只要 signal>0 立即打印三分量明细（便于以后调查误判）
        if (proofOfViolation.total > 0) {
          console.warn(
            `[FINAL][WARN] 第 ${i + 1} 页 "${slide.title?.slice(0, 30) || ''}" 样式越权信号存在 pre-replay：` +
              `total=${proofOfViolation.total} ` +
              `(neutralFont22_29=${proofOfViolation.neutralFont22_29} ` +
              `neutralPxSticky=${proofOfViolation.neutralPxSticky} ` +
              `colorViolations=${proofOfViolation.colorViolations}) ` +
              `samples=${formatStyleViolationSamplesSummary(finalMainColor, proofSamples)}`,
          );
        }
        // FR-1 Q1 / Task 1.4：仅当任一分量超过阈值时才重放 postProcessHtmlSnapshot
        // （而不是任何 total>0 就重放）
        if (exceedsThreshold(proofOfViolation) && agent) {
          try {
            const before = slide.html;
            slide.html = agent.postProcessHtmlSnapshot(slide.html, {
              primaryColor: finalMainColor,
              slideWidth: slideW,
              slideHeight: slideH,
              backgroundEnabled,
              fontFamily: (fontFamily || design?.fontFamily || 'sans') as 'sans' | 'serif' | 'mono',
              // FR：终局重放把参考标题色接入后处理（与生成期主色/参考色链路同源），
              // 使浅底 heading 的中性色升级为目标参考标题色，深底仍强制白字（enforceHeadingColorOnLightBg）。
              referenceVisualAttributes: generationOptions?.referenceVisualAttributes ?? undefined,
              pageType,
            });
            if (slide.html !== before) finalSanitizeStat.reapplied++;
          } catch (e) {
            console.warn(
              '[FINAL] postProcessHtmlSnapshot 重放失败:',
              e instanceof Error ? e.message : e,
            );
          }
        }
        // 重放后再断言
        let after = slide.html;
        const remain: StyleViolationBreakdown = styleViolationSignal(after, finalMainColor, {
          allowedAccentHexes,
        });
        let remain2: StyleViolationBreakdown = {
          neutralFont22_29: 0,
          neutralPxSticky: 0,
          colorViolations: 0,
          total: 0,
        };
        if (exceedsThreshold(remain) && agent) {
          try {
            after = agent.postProcessHtmlSnapshot(after, {
              primaryColor: finalMainColor,
              slideWidth: slideW,
              slideHeight: slideH,
              backgroundEnabled,
              fontFamily: (fontFamily || design?.fontFamily || 'sans') as 'sans' | 'serif' | 'mono',
              // FR：终局重放把参考标题色接入后处理（与生成期主色/参考色链路同源），
              // 使浅底 heading 的中性色升级为目标参考标题色，深底仍强制白字（enforceHeadingColorOnLightBg）。
              referenceVisualAttributes: generationOptions?.referenceVisualAttributes ?? undefined,
              pageType,
            });
            slide.html = after;
          } catch (_) {
            /* 二次重放异常忽略，保留现状 */
          }
          remain2 = styleViolationSignal(after, finalMainColor, { allowedAccentHexes });
        }

        if (exceedsThreshold(remain2)) {
          // ——— 防御闭环项 3（L6.5 Fallback 降级保护）：高级版式（comparison-deep-dive / cards /
          // timeline / table / value-showcase / stats-highlight / zigzag / image-background…）
          // 禁止用极简 fallback 整页替换，否则原本 5 条对比/卡片/时序信息全部丢失、无法给用户
          // 做人工复核。策略：保留主结构，只在日志中打印更详尽的告警并同样记 sanitizationFailed
          // （audit 依然能拿到 issue 结构化结果，前端也仍能通过 style 引擎做进一步补救）。
          const NEVER_FALLBACK_FOR_ADVANCED: ReadonlySet<string> = new Set([
            'comparison-deep-dive',
            'content-value-showcase',
            'content-stats-highlight',
            'content-compare',
            'content-timeline',
            'content-table',
            'content-image-background',
            'content-zigzag',
            'content-cards',
          ]);
          const explicitLayout = String((slide as any)?.pageType ?? '').toLowerCase() || undefined;
          const layoutFromHtml2 = (after.match(
            /<\s*(?:div|section|article)\b[^>]*\bdata-layout\s*=\s*["']?([a-z0-9-]+)["']?[^>]*>/i,
          ) || [])[1]?.toLowerCase();
          const isProtectedAdvancedLayout =
            (explicitLayout && NEVER_FALLBACK_FOR_ADVANCED.has(explicitLayout)) ||
            (layoutFromHtml2 && NEVER_FALLBACK_FOR_ADVANCED.has(layoutFromHtml2));

          const slidePlanSrc = (plan && (plan as any).slides && (plan as any).slides[i]) as any;
          const fbTitle = String((slide as any)?.title || slidePlanSrc?.title || '');
          const samples2 = collectStyleViolationSamples(after, remain2);
          const detailsForStorage = {
            breakdown: remain2,
            samples: samples2,
            expectedPrimary: finalMainColor,
          };
          // 无论是否替换，都把 sanitizationFailed 条目写入以便审计追溯
          if (!(result as any).sanitizationFailed)
            (result as any).sanitizationFailed = { pages: [] };
          (result as any).sanitizationFailed.pages.push({
            index: i + 1,
            // remain: 保持旧字段兼容（存 breakdown.total 作为数字）
            remain: remain2.total,
            breakdown: remain2,
            samples: samples2,
            fallbackApplied: !isProtectedAdvancedLayout,
            protectedAdvancedSkipped: isProtectedAdvancedLayout,
          } as any);
          finalSanitizeStat.assertionFailed++;

          if (isProtectedAdvancedLayout) {
            // —— 保护版式路径：不替换 slide.html，仅打更详细的告警并记标记（sanitization 生成一个 skipped-advanced 类型 issue）
            (slide as any)._sanitizationFallbackSkippedForAdvanced = {
              index: i + 1,
              title: fbTitle,
              pageType: explicitLayout || layoutFromHtml2 || '',
              remain: remain2.total,
              breakdown: remain2,
              samples: samples2,
              expectedPrimary: finalMainColor,
              fallbackApplied: false,
            };
            console.warn(
              `[FINAL] 第 ${i + 1} 页二次消毒仍超阈值，但检测到其为【高级版式】pageType=${explicitLayout || layoutFromHtml2}，` +
                `为避免丢失结构化内容不执行整页 fallback 替换（${fbTitle.slice(0, 20)}）。` +
                ` breakdown=(${remain2.neutralFont22_29}/${remain2.neutralPxSticky}/${remain2.colorViolations}) ` +
                `total=${remain2.total}。samples=${formatStyleViolationSamplesSummary(finalMainColor, samples2)}。` +
                ` 保留原始 HTML，仅写入 sanitizationFailed.pages[${i}]（fallbackApplied=false, protectedAdvancedSkipped=true）。`,
            );
          } else {
            // —— 普通版式路径：继续应用 FR-4 主色化兜底整页替换
            const fbKeyPoints: string[] = Array.isArray(slidePlanSrc?.keyPoints)
              ? slidePlanSrc.keyPoints.map((k: unknown) => String(k))
              : [];
            slide.html = buildFallbackSlideHtml(
              fbTitle,
              fbKeyPoints,
              slideW,
              slideH,
              finalMainColor,
            );
            // AC-8 / Task10b：在 slide 对象上打标记（_sanitizationFallbackApplied），
            // auditEngine 的 sanitization engine 消费它 → 生成结构化 sanitization-fallback-applied issue 并写入 latest-report。
            // 标记结构刻意与 sanitizationFailed.pages[n] 对齐，便于 audit 端透传 metadata。
            (slide as any)._sanitizationFallbackApplied = {
              index: i + 1,
              title: fbTitle,
              remain: remain2.total,
              breakdown: remain2,
              samples: samples2,
              expectedPrimary: finalMainColor,
              fallbackApplied: true,
            };
            console.error(
              `[FINAL] 第 ${i + 1} 页二次消毒仍超阈值 → 已应用主色化兜底 fallback（${fbTitle.slice(0, 20)}）。` +
                ` breakdown=(${remain2.neutralFont22_29}/${remain2.neutralPxSticky}/${remain2.colorViolations})` +
                ` total=${remain2.total}。samples=${formatStyleViolationSamplesSummary(finalMainColor, samples2)}。` +
                ` 详情已写入 sanitizationFailed.pages[${i}]。`,
            );
          }
        } else if (exceedsThreshold(remain) && !agent) {
          finalSanitizeStat.assertionFailed++;
          const remainSamples = collectStyleViolationSamples(after, remain);
          console.warn(
            `[FINAL] 消毒断言超阈值但无 agent 可二次处理，仅记 warn 不换页：idx=${i + 1} ` +
              `breakdown=(${remain.neutralFont22_29}/${remain.neutralPxSticky}/${remain.colorViolations}) total=${remain.total} ` +
              `samples=${formatStyleViolationSamplesSummary(finalMainColor, remainSamples)} ` +
              `frag=${after.slice(0, 180)}`,
          );
        }
      }
      simpleLog('AI:FINAL', '终局消毒防线（三分量阈值化 v2）', finalSanitizeStat);

      const presentationFile = join(
        self.storage.getPresentationDir(result.id),
        'presentation.json',
      );
      result.updatedAt = Date.now();
      // 防御性校验（无论详细/简单模式都打日志）：终局 <img> 数量，便于以后再次排查「图片消失」类问题
      const slideImgReport = result.slides.map((s, idx) => ({
        idx: idx + 1,
        title: s.title.length > 20 ? s.title.substring(0, 20) + '…' : s.title,
        htmlLen: s.html.length,
        imgCount: (s.html.match(/<img\b/gi) || []).length,
        hasBg: /background-image\s*:/i.test(s.html) ? 1 : 0,
      }));
      simpleLog('AI:SAVE', `终局写盘 presentation.json`, {
        id: result.id,
        presentationIdIn: presentationId || '(new)',
        slides: result.slides.length,
        totalImg: slideImgReport.reduce((n, r) => n + r.imgCount, 0),
        slidesReport: slideImgReport,
      });
      await self.storage.writeJsonFile(presentationFile, result);
    }
}
