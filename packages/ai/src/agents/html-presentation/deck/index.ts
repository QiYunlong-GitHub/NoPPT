/**
 * Deck 中间层（AI 侧）：把结构化计划转成绝对定位节点树。
 *
 * - `layout-templates.ts`：33 种 pageType 在 1280×720 画布上的布局模板
 * - `plan-to-deck.ts`：PresentationPlan → Deck 转换器
 */

export * from './layout-templates';
export * from './slide-contract';
export * from './plan-to-deck';
export * from './image-plan-guard';
export * from './deck-critique';
export * from './deck-to-html';
