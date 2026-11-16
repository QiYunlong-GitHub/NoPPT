/**
 * 阶段 3：把全篇统一的「结论 / 页码条」落成 Deck 节点。
 *
 * 设计取舍：
 * - 只**追加**节点，不改写 `planToDeck` 产出的既有 text/shape，避免破坏内容布局与
 *   `buildValidatedDeck` 的 strict 校验；
 * - 页码由页序统一生成，不再输出硬编码「01」徽章，也不再复述标题；
 * - 页脚只承载「页码 + 进度」：旧 `firstConclusion` 会把该页第一条正文写进页脚，
 *   实测与列表首项逐字重复（如「02 / 05 指东太平洋海表温度…」），现彻底移除；
 * -「无图」模式不生成无语义 KPI / 柱形图；
 * - 装饰 rect 与内容 rect 相交时在生成期跳过（避让），避免遮挡标题与正文；
 * - 节点进入 Deck（HTML 与 PPTX 共用的数据真值），保持 Deck↔HTML↔PPTX parity；
 * - 全部组件 `role:'decoration'` 且渲染时 `pointer-events:none`，内容节点仍可选中。
 */

import type { Deck, DeckDecorationNode, DeckSlide } from '@noppt/core/deck';

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 统一页脚条：y=664、底边 696（≤700 安全区），封面与封底不生成。 */
const FOOTER_RECT: Rect = { x: 64, y: 664, w: 1152, h: 32 };

function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function contentRects(slide: DeckSlide): Rect[] {
  return slide.nodes.filter((node) => node.role !== 'decoration').map((node) => node.rect);
}

/** 页脚只生成页码与阅读进度，不写入任何正文（正文由内容节点独占）。 */
function footerNode(slide: DeckSlide, index: number, total: number): DeckDecorationNode {
  return {
    kind: 'decoration',
    id: `${slide.id}-deco-footer`,
    role: 'decoration',
    decoration: 'callout',
    label: `${String(index + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}`,
    progress: Math.round(((index + 1) / Math.max(1, total)) * 100),
    rect: { ...FOOTER_RECT },
  };
}

function attachToSlide(
  slide: DeckSlide,
  index: number,
  total: number,
): { slide: DeckSlide; skipped: boolean } {
  const isCover = index === 0 || slide.pageType === 'cover';
  const isClosing = slide.pageType === 'summary' || (total > 2 && index === total - 1);
  if (isCover || isClosing) return { slide, skipped: false };
  const candidate = footerNode(slide, index, total);
  if (contentRects(slide).some((rect) => intersects(candidate.rect, rect))) {
    return { slide, skipped: true };
  }
  return { slide: { ...slide, nodes: [...slide.nodes, candidate] }, skipped: false };
}

/** 给整份 Deck 追加统一页脚条，返回新对象（不修改输入，便于测试与审计）。 */
export function attachVisualComponents(input: Deck): Deck {
  const total = input.slides.length;
  const skipped: number[] = [];
  const slides = input.slides.map((slide, index) => {
    const result = attachToSlide(slide, index, total);
    if (result.skipped) skipped.push(index + 1);
    return result.slide;
  });
  if (skipped.length > 0) {
    console.warn(
      `[AGENT-DECK] footer decoration skipped on slides: ${skipped.join(', ')} (content overlap)`,
    );
  }
  return { ...input, slides };
}
