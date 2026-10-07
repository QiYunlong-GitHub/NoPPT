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
import { closeTraceSession, openTraceSession } from '../../../utils/llm-tracer';
import { ensureSemanticWrapping, wrapTextNodes } from '../postprocess';
import { flattenMeaninglessNesting } from '../html-sanitize';
import { buildValidatedDeck, PlanContractError } from '../deck';
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
    // 由 plan 直接转换，不额外调用 LLM；任何异常都只降级掉 deck，绝不影响 html 主链路。
    let deck: Deck | undefined;
    const deckResult = buildValidatedDeck(plan, {
      width: slideWidth,
      height: slideHeight,
      validationMode: 'strict',
    });
    if (deckResult.status !== 'pass' || !deckResult.deck) {
      throw new PlanContractError(deckResult.issues);
    }
    deck = deckResult.deck;
    for (let i = 0; i < slides.length && i < deck.slides.length; i++) {
      slides[i].deck = deck.slides[i];
    }
    const totalNodes = deck.slides.reduce((n, s) => n + (s.nodes?.length ?? 0), 0);
    const fallbackSlides = deck.slides.filter((s) => (s.nodes?.length ?? 0) === 0).length;
    console.log(
      `[${formatBeijingTime()}] [AGENT] [DECK] built structured deck: ${deck.slides.length} slides / ${totalNodes} nodes` +
        (fallbackSlides > 0 ? ` (${fallbackSlides} empty-node fallback)` : ''),
    );

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
