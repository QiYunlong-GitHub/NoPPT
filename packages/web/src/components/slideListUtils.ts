// SlideListPanel 的纯逻辑外置（Phase 6 抽取，零行为变更）。
// 从 handleSlideClick 的 shift 多选分支抽出，便于单测与后续拆分。

export interface SlideLike {
  id: string;
}

/**
 * 计算 shift 多选区间：以 lastIndex 与 index 为端点（含端点），
 * 返回区间内所有 slide.id 的集合。行为与抽出前完全一致。
 */
export function getRangeSelection(
  slides: SlideLike[],
  lastIndex: number,
  index: number,
): Set<string> {
  const start = Math.min(lastIndex, index);
  const end = Math.max(lastIndex, index);
  const newSelected = new Set<string>();
  for (let i = start; i <= end; i++) {
    newSelected.add(slides[i].id);
  }
  return newSelected;
}
