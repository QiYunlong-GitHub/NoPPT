/**
 * 参考素材（RAG / 对话上下文）长度上限：**按生成要求分档**。
 *
 * 与后端 `packages/server/src/modules/mcp/draft-store.ts` 的 `referenceTextLimit()` 必须保持一致：
 * `limit = clamp(每页预算(800) × slideCount, 3000, 20000)`。
 * 页数越多可承载的素材越长；页数很少时抬到下限，避免素材被压得无法使用。
 */

/** 每页素材预算（字符）。 */
export const REFERENCE_CHARS_PER_SLIDE = 800;
/** 分档下限。 */
export const REFERENCE_TEXT_MIN_CHARS = 3000;
/** 分档上限：与后端 `NOPPT_MAX_REF_TEXT_CHARS` 默认值一致。 */
export const REFERENCE_TEXT_MAX_CHARS = 20000;
/** 未给出页数时的默认页数。 */
export const DEFAULT_SLIDE_COUNT = 8;

export function referenceTextLimit(slideCount?: number): number {
  const slides =
    typeof slideCount === 'number' && Number.isFinite(slideCount) && slideCount > 0
      ? Math.trunc(slideCount)
      : DEFAULT_SLIDE_COUNT;
  return Math.min(
    Math.max(REFERENCE_CHARS_PER_SLIDE * slides, REFERENCE_TEXT_MIN_CHARS),
    REFERENCE_TEXT_MAX_CHARS,
  );
}
