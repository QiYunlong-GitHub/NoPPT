/**
 * `@noppt/core/deck` —— 结构化幻灯片中间层（零依赖）。
 *
 * Deck 是 HTML 渲染与 PPTX 渲染共用的同一份数据真值：
 * - `schema.ts`：Deck / DeckSlide / DeckNode 树（借鉴 python-pptx 对象模型）
 * - `geometry.ts`：1280×720 px ↔ 13.333×7.5 inch 无损映射
 * - `chart-kinds.ts`：图表单一枚举 + SVG/PPTX 双后端映射表
 * - `shapes.ts`：形状枚举 + 双后端映射
 * - `guards.ts`：运行时守卫与归一化（替代 zod）
 */

export * from './schema';
export * from './geometry';
export * from './chart-kinds';
export * from './shapes';
export * from './guards';
