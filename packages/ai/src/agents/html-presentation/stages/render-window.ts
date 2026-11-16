import type { PresentationGenerationOptions, PresentationPlan } from '../../../types';

/**
 * 渲染窗口解析。引导式设计稿首屏固定传 startIndex=0 / endIndex=1，
 * 该窗口只校验首页契约；正式出片与局部重生成仍按整册 strict 校验。
 *
 * 这里只做窗口判定，不物理裁剪 plan：整册 Deck 仍一次性构建，
 * 页码 / 总页数 / originalIdx / backgroundPrompt 的绝对下标语义保持不变。
 */
export interface RenderWindow {
  startIdx: number;
  endIdx: number;
  isFirstSlidePreview: boolean;
}

export function resolveRenderWindow(
  plan: PresentationPlan,
  options?: PresentationGenerationOptions,
): RenderWindow {
  const total = Array.isArray(plan?.slides) ? plan.slides.length : 0;
  const startIdx = Math.max(0, options?.startIndex ?? 0);
  const endIdx = Math.min(total, options?.endIndex ?? total);
  return {
    startIdx,
    endIdx,
    isFirstSlidePreview: startIdx === 0 && endIdx === 1 && total > 1,
  };
}
