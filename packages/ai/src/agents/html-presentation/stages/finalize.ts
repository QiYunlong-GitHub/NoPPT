import type { AgentDeps } from './deps';
import {
  DesignProposal,
  ImageRatio,
  PresentationGenerationOptions,
  PresentationPlan,
  RenderedSlide,
} from '../../../types';
import { HTMLPresentation, HTMLSlide } from '../shared';
import { formatBeijingTime, formatDuration } from '../../../providers/base';
import { auditSlideHtml } from '../../../utils/slide-visual-audit';
import { closeTraceSession, openTraceSession } from '../../../utils/llm-tracer';
import { ensureSemanticWrapping, wrapTextNodes } from '../postprocess';
import { flattenMeaninglessNesting } from '../html-sanitize';
import { buildValidatedDeck } from '../deck';
import {
  formatStrictDeckIssueDetails,
  formatStrictDeckIssues,
  formatStrictDeckNotices,
  inspectStrictDeckResult,
  normalizePlanForStrictDeckDetailed,
  StrictDeckValidationError,
} from '../deck/strict-deck';
import type { Deck } from '@noppt/core/deck';
export async function finalizePresentation(
  _deps: AgentDeps,
  topic: string,
  renderedSlides: RenderedSlide[],
  plan: PresentationPlan,
  _design: DesignProposal,
  options?: PresentationGenerationOptions,
  traceSessionId?: string,
): Promise<HTMLPresentation> {
  const slides: HTMLSlide[] = renderedSlides.map((s) => ({
    title: s.title,
    html: s.html,
    pageType: s.pageType,
    imagePrompt: s.imagePrompt,
    imageRatio: s.imageRatio as ImageRatio | undefined,
    critique: (s as any).critique,
  }));

  const imagePreference = options?.imagePreference || 'content-only';
  const imageEnabled = options?.imageOptions?.enabled && imagePreference !== 'none';
  const slideWidth = options?.slideWidth || 1280;
  const slideHeight = options?.slideHeight || 720;

  let ownTraceSession = false;
  if (!traceSessionId) {
    traceSessionId = `trace_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    openTraceSession(traceSessionId);
    ownTraceSession = true;
  }

  try {
    const startTime = Date.now();
    const startBeijingTime = formatBeijingTime();

    const totalDuration = Date.now() - startTime;
    const endBeijingTime = formatBeijingTime();
    console.log(
      `[${endBeijingTime}] [AGENT] End time: ${endBeijingTime}, Duration: ${formatDuration(totalDuration)}`,
    );
    console.log(
      `[${endBeijingTime}] [AGENT] ========== Presentation generation complete ==========\n`,
    );

    const onProgress = options?.onProgress;
    onProgress?.({
      phase: 'complete',
      current: slides.length,
      total: slides.length,
      message: '生成完成',
    });

    // ========== AI 包终局兜底（防线 4）==========
    //   - 每一张 slide 再过一遍 wrapTextNodes + ensureSemanticWrapping 双保险
    //   - 检测并记录是否仍存在裸文本（用于问题复现、告警）
    //   - 确保 slides 输出时，imagePreference 已经跟每一张 slide 的 needsImage/pageType 保持一致
    for (let sIdx = 0; sIdx < slides.length; sIdx++) {
      const slide = slides[sIdx];
      const preLen = slide.html.length;
      try {
        slide.html = wrapTextNodes(slide.html);
        slide.html = flattenMeaninglessNesting(slide.html);
        slide.html = ensureSemanticWrapping(slide.html);
      } catch (finalFixErr) {
        console.warn(
          `[${formatBeijingTime()}] [AGENT] [FINAL-FIX] slide ${sIdx + 1} "${slide.title}" final fix skipped due to:`,
          (finalFixErr as Error).message,
        );
      }
      if (slide.html.length !== preLen) {
        console.log(
          `[${formatBeijingTime()}] [AGENT] [FINAL-FIX] slide ${sIdx + 1} "${slide.title}" bare-text fixed in AI finalizer (${preLen} → ${slide.html.length})`,
        );
      }
    }

    // ========== 结构化 Deck 输出（HTML 与 PPTX 共用的同一份数据真值）==========
    // 由 plan 直接转换，不额外调用 LLM；fatal 契约错误仍终止生成，仅 recoverable needs_review 记录 warning 后保留 deck。
    const normalization = normalizePlanForStrictDeckDetailed(plan);
    const strictPlan = normalization.plan;
    if (normalization.notices.length > 0) {
      console.warn(
        `[${formatBeijingTime()}] [AGENT] [DECK] compare contract normalized: ` +
          `${formatStrictDeckNotices(normalization.notices)}`,
      );
    }
    // 与 render-deck.ts 使用同一组 image / sparseEnhancement 开关，
    // 保证屏幕预览 HTML 与落盘 Deck 的节点树一致（HTML↔PPTX parity）。
    const deckResult = buildValidatedDeck(strictPlan, {
      width: slideWidth,
      height: slideHeight,
      imageEnabled,
      imagePreference,
      sparseEnhancement: true,
      validationMode: 'strict',
    });
    const inspection = inspectStrictDeckResult(deckResult);
    if (!inspection.ok || !inspection.deck) {
      throw new StrictDeckValidationError(
        inspection.issues.filter((issue) => !issue.recoverable),
        inspection.warnings,
        strictPlan,
      );
    }
    if (inspection.warnings.length > 0) {
      console.warn(
        `[${formatBeijingTime()}] [AGENT] [DECK] strict deck accepted with recoverable issues: ` +
          `${formatStrictDeckIssues(inspection.warnings)} | ` +
          `${formatStrictDeckIssueDetails(inspection.warnings, strictPlan)}`,
      );
    }
    const deck: Deck = inspection.deck;
    for (let i = 0; i < slides.length && i < deck.slides.length; i++) {
      slides[i].deck = deck.slides[i];
    }
    const totalNodes = deck.slides.reduce((n, s) => n + (s.nodes?.length ?? 0), 0);
    const fallbackSlides = deck.slides.filter((s) => (s.nodes?.length ?? 0) === 0).length;
    console.log(
      `[${formatBeijingTime()}] [AGENT] [DECK] built structured deck: ${deck.slides.length} slides / ${totalNodes} nodes` +
        (fallbackSlides > 0 ? ` (${fallbackSlides} empty-node fallback)` : ''),
    );

    // ========== 生成期视觉审计（非阻断）==========
    // 复用出片前门禁 auditSlideHtml，在 deck 挂回后逐页检查几何越界与稀疏问题。
    // 确定性渲染无法按反馈再生，因此只记录告警供日志/QA 观察，不终止生成。
    let auditWarnings = 0;
    for (let i = 0; i < slides.length; i++) {
      const audit = auditSlideHtml(slides[i].html, {
        primary: (plan as any)?.primaryColor,
        pageType: (slides[i].pageType as string) || (deck.slides[i]?.pageType as string),
        width: slideWidth,
        height: slideHeight,
      });
      if (audit.issues.length > 0) {
        auditWarnings += audit.issues.length;
        const summary = audit.issues
          .map((issue) => `${issue.code}(${issue.detail})`)
          .join(' | ');
        console.warn(
          `[${formatBeijingTime()}] [AGENT] [VISUAL-AUDIT] slide ${i + 1} "${slides[i].title}": ${summary}`,
        );
      }
    }
    if (auditWarnings > 0) {
      console.warn(
        `[${formatBeijingTime()}] [AGENT] [VISUAL-AUDIT] ${auditWarnings} issue(s) across ${slides.length} slides (non-blocking)`,
      );
    }

    return {
      title: plan.title || topic,
      description: plan.description,
      primaryColor: plan.primaryColor,
      transition: 'none',
      slides,
      width: slideWidth,
      height: slideHeight,
      imagePreference,
      timing: { startTime: startBeijingTime, endTime: endBeijingTime, durationMs: totalDuration },
      deck,
      master: deck?.master,
      theme: deck?.theme,
      meta: deck?.meta,
    };
  } finally {
    if (ownTraceSession && traceSessionId) {
      closeTraceSession(traceSessionId);
    }
  }
}
