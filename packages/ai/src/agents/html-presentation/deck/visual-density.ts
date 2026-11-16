/**
 * 视觉密度度量 —— 把「HTML 幻灯片视觉差距」转成可回归的数字。
 *
 * 设计原则（见 `repo-wiki/slide-visual-gap-analysis-and-plan.md` §6.1）：
 * - 现状基线（BASELINE）与改造目标（TARGET）分离；目标值只作参照，不参与断言，
 *   避免把「目标」锁成回归门禁而挡住后续阶段的实现。
 * - 度量函数是纯字符串运算，不依赖 DOM / LLM / 运行期产物，可在任意包的单测中复用。
 * - 历史产物用静态 fixture 固定；当前渲染器能力用 vitest 命名快照跟踪（`-u` 显式更新）。
 */

export interface VisualDensity {
  /** 去重的 6 位十六进制色值（小写、字典序）。 */
  hexColors: string[];
  /** `--x:` 形式的 CSS 自定义属性声明数。 */
  cssVariableDeclarations: number;
  linearGradients: number;
  radialGradients: number;
  boxShadows: number;
  svgElements: number;
  tables: number;
  absolutePositions: number;
  /** 带 `data-deck-node-id` 的内容节点数。 */
  deckNodes: number;
  /** 去重的 `font-size: Npx` 数值（升序）。 */
  fontSizes: number[];
  chineseChars: number;
  /** HTML 字符数。 */
  length: number;
}

function count(html: string, pattern: RegExp): number {
  return (html.match(pattern) ?? []).length;
}

/** 度量一段幻灯片 HTML 的视觉组织手段密度。 */
export function measureVisualDensity(html: string): VisualDensity {
  const hexColors = Array.from(
    new Set((html.match(/#[0-9a-fA-F]{6}\b/g) ?? []).map((c) => c.toLowerCase())),
  ).sort();
  const fontSizes = Array.from(
    new Set(
      Array.from(html.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g), (m) => Number(m[1])),
    ),
  ).sort((a, b) => a - b);
  return {
    hexColors,
    cssVariableDeclarations: count(html, /--[a-zA-Z0-9-]+\s*:/g),
    linearGradients: count(html, /linear-gradient\(/g),
    radialGradients: count(html, /radial-gradient\(/g),
    boxShadows: count(html, /box-shadow\s*:/g),
    svgElements: count(html, /<svg\b/gi),
    tables: count(html, /<table\b/gi),
    absolutePositions: count(html, /position:\s*absolute/gi),
    deckNodes: count(html, /data-deck-node-id/g),
    fontSizes,
    chineseChars: count(html, /[\u4e00-\u9fff]/g),
    length: html.length,
  };
}

/**
 * 2026-11-10 产物 `pres_mvxwps0f_xjm9ezs` 全篇 5 页的实测聚合值。
 * 这是**历史事实**，不随后续改造修改；需要对比新基线时请新增常量。
 */
export const VISUAL_DENSITY_BASELINE = Object.freeze({
  hexColorCount: 7,
  cssVariableDeclarations: 0,
  linearGradients: 1,
  radialGradients: 0,
  boxShadows: 0,
  svgElements: 0,
  tables: 0,
  absolutePositions: 39,
  deckNodes: 21,
  chineseChars: 293,
  length: 19303,
  /** `finalize-deck` 事件中 `deck[].nodes[].kind` 的去重结果。 */
  deckKinds: Object.freeze(['shape', 'text']),
});

/**
 * 阶段 2–3 的改造目标（来自分析文档 §6.3 / §6.4 验收标准）。
 * 仅作参照值，测试中不得据此断言当前渲染器，只能断言「目标 > 基线」。
 */
export const VISUAL_DENSITY_TARGET = Object.freeze({
  hexColorCountAtLeast: 15,
  radialGradientsAtLeast: 1,
  boxShadowsAtLeast: 1,
  svgDecorationsAtLeast: 1,
  deckKindsAtLeast: 4,
});
