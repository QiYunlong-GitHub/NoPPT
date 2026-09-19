import type {
  AgentDeps,
} from './deps';
import {
  DesignProposal,
  ImageRatio,
  PresentationGenerationOptions,
  PresentationPlan,
  RenderedSlide,
} from '../../../types';
import {
  HTMLPresentation,
  HTMLSlide,
} from '../shared';
import {
  formatBeijingTime,
  formatDuration,
} from '../../../providers/base';
import {
  closeTraceSession,
  openTraceSession,
} from '../../../utils/llm-tracer';
import {
  ensureSemanticWrapping,
  wrapTextNodes,
} from '../postprocess';
import {
  flattenMeaninglessNesting,
} from '../html-sanitize';
export async function finalizePresentation(_deps: AgentDeps, topic: string, renderedSlides: RenderedSlide[], plan: PresentationPlan, _design: DesignProposal, options?: PresentationGenerationOptions, traceSessionId?: string): Promise<HTMLPresentation> {
    const slides: HTMLSlide[] = renderedSlides.map((s) => ({
      title: s.title,
      html: s.html,
      pageType: s.pageType,
      imagePrompt: s.imagePrompt,
      imageRatio: s.imageRatio as ImageRatio | undefined,
      notes: undefined,
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
      };
    } finally {
      if (ownTraceSession && traceSessionId) {
        closeTraceSession(traceSessionId);
      }
    }
  }

