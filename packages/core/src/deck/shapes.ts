/**
 * Deck 形状枚举 —— 借鉴 PptxGenJS 的 `ShapeType`（近 200 种 preset geometry）。
 *
 * 这里只收录 NoPPT 版式真正会用到的常用形状（约 40 种），
 * 每个枚举值直接就是 OOXML `a:prstGeom` 的 preset 名，因此：
 * - PPTX 渲染侧可原样透传给 `slide.addShape(pptx.ShapeType.xxx)`；
 * - HTML 渲染侧通过 `SVG_SHAPE_RENDERERS` 查表得到等价 SVG 片段。
 */

export type DeckShapeType =
  // 基础几何
  | 'rect'
  | 'roundRect'
  | 'ellipse'
  | 'line'
  | 'triangle'
  | 'rightTriangle'
  | 'diamond'
  | 'parallelogram'
  | 'trapezoid'
  // 多边形
  | 'pentagon'
  | 'hexagon'
  | 'heptagon'
  | 'octagon'
  // 箭头 / 指向
  | 'rightArrow'
  | 'leftArrow'
  | 'upArrow'
  | 'downArrow'
  | 'chevron'
  | 'quadArrow'
  // 星 / 徽标
  | 'star'
  | 'plus'
  | 'heart'
  | 'lightningBolt'
  | 'sun'
  | 'moon'
  | 'cloud'
  // 弧 / 环
  | 'arc'
  | 'blockArc'
  | 'donut'
  | 'pie'
  | 'plaque'
  | 'frame'
  | 'bevel'
  | 'foldedCorner'
  // 立体 / 容器（架构图用）
  | 'cube'
  | 'cylinder'
  | 'can'
  // 流程图
  | 'flowChartProcess'
  | 'flowChartDecision'
  | 'flowChartTerminator'
  | 'flowChartDocument'
  | 'flowChartInputOutput'
  | 'flowChartPreparation';

/** 默认形状（缺形状名时的兜底）。 */
export const DEFAULT_DECK_SHAPE: DeckShapeType = 'rect';

/**
 * 形状 → PPTX preset 名映射。
 * 当前 DeckShapeType 的取值本身就是 preset 名，因此恒等映射；
 * 保留这张表的意义在于：将来若 HTML 侧另起别名，只需改这一处。
 */
export const DECK_SHAPE_TO_PPTX: Record<DeckShapeType, string> = {
  rect: 'rect',
  roundRect: 'roundRect',
  ellipse: 'ellipse',
  line: 'line',
  triangle: 'triangle',
  rightTriangle: 'rightTriangle',
  diamond: 'diamond',
  parallelogram: 'parallelogram',
  trapezoid: 'trapezoid',
  pentagon: 'pentagon',
  hexagon: 'hexagon',
  heptagon: 'heptagon',
  octagon: 'octagon',
  rightArrow: 'rightArrow',
  leftArrow: 'leftArrow',
  upArrow: 'upArrow',
  downArrow: 'downArrow',
  chevron: 'chevron',
  quadArrow: 'quadArrow',
  star: 'star',
  plus: 'plus',
  heart: 'heart',
  lightningBolt: 'lightningBolt',
  sun: 'sun',
  moon: 'moon',
  cloud: 'cloud',
  arc: 'arc',
  blockArc: 'blockArc',
  donut: 'donut',
  pie: 'pie',
  plaque: 'plaque',
  frame: 'frame',
  bevel: 'bevel',
  foldedCorner: 'foldedCorner',
  cube: 'cube',
  cylinder: 'cylinder',
  can: 'can',
  flowChartProcess: 'flowChartProcess',
  flowChartDecision: 'flowChartDecision',
  flowChartTerminator: 'flowChartTerminator',
  flowChartDocument: 'flowChartDocument',
  flowChartInputOutput: 'flowChartInputOutput',
  flowChartPreparation: 'flowChartPreparation',
};

const SHAPE_KEYS = Object.keys(DECK_SHAPE_TO_PPTX) as DeckShapeType[];

/** 判断任意字符串是否是合法形状名（替代 zod 的运行时校验）。 */
export function isDeckShapeType(v: unknown): v is DeckShapeType {
  return typeof v === 'string' && (SHAPE_KEYS as string[]).includes(v);
}

/**
 * 形状 → SVG 渲染策略。
 * HTML 侧不可能实现近 200 种 preset 的真实路径，因此降级为几类可泛化画法：
 * - `polygon`：用顶点表画出（已知顶点的形状）
 * - `ellipse`：椭圆
 * - `rect` / `roundRect` / `line`：直接对应 SVG 原生元素
 * - `box`：统一降级为圆角矩形（流程图/立体类形状）
 */
export type DeckShapeSvgStrategy = 'rect' | 'roundRect' | 'ellipse' | 'line' | 'polygon' | 'box';

export const DECK_SHAPE_SVG_STRATEGY: Record<DeckShapeType, DeckShapeSvgStrategy> = {
  rect: 'rect',
  roundRect: 'roundRect',
  ellipse: 'ellipse',
  line: 'line',
  triangle: 'polygon',
  rightTriangle: 'polygon',
  diamond: 'polygon',
  parallelogram: 'polygon',
  trapezoid: 'polygon',
  pentagon: 'polygon',
  hexagon: 'polygon',
  heptagon: 'polygon',
  octagon: 'polygon',
  rightArrow: 'polygon',
  leftArrow: 'polygon',
  upArrow: 'polygon',
  downArrow: 'polygon',
  chevron: 'polygon',
  quadArrow: 'polygon',
  star: 'polygon',
  plus: 'polygon',
  heart: 'polygon',
  lightningBolt: 'polygon',
  sun: 'ellipse',
  moon: 'polygon',
  cloud: 'polygon',
  arc: 'polygon',
  blockArc: 'polygon',
  donut: 'ellipse',
  pie: 'polygon',
  plaque: 'roundRect',
  frame: 'rect',
  bevel: 'polygon',
  foldedCorner: 'polygon',
  cube: 'box',
  cylinder: 'box',
  can: 'box',
  flowChartProcess: 'box',
  flowChartDecision: 'polygon',
  flowChartTerminator: 'roundRect',
  flowChartDocument: 'rect',
  flowChartInputOutput: 'polygon',
  flowChartPreparation: 'polygon',
};

/**
 * `polygon` 策略的归一化顶点表（0..1 坐标系，渲染时按矩形缩放）。
 * 未列出的多边形统一降级为 `box`（圆角矩形），保证永不崩。
 */
export const DECK_SHAPE_POLYGONS: Partial<Record<DeckShapeType, Array<[number, number]>>> = {
  triangle: [
    [0.5, 0],
    [1, 1],
    [0, 1],
  ],
  rightTriangle: [
    [0, 0],
    [1, 1],
    [0, 1],
  ],
  diamond: [
    [0.5, 0],
    [1, 0.5],
    [0.5, 1],
    [0, 0.5],
  ],
  parallelogram: [
    [0.2, 0],
    [1, 0],
    [0.8, 1],
    [0, 1],
  ],
  trapezoid: [
    [0.2, 0],
    [0.8, 0],
    [1, 1],
    [0, 1],
  ],
  pentagon: [
    [0.5, 0],
    [1, 0.38],
    [0.81, 1],
    [0.19, 1],
    [0, 0.38],
  ],
  hexagon: [
    [0.25, 0],
    [0.75, 0],
    [1, 0.5],
    [0.75, 1],
    [0.25, 1],
    [0, 0.5],
  ],
  rightArrow: [
    [0, 0.25],
    [0.6, 0.25],
    [0.6, 0],
    [1, 0.5],
    [0.6, 1],
    [0.6, 0.75],
    [0, 0.75],
  ],
  leftArrow: [
    [1, 0.25],
    [0.4, 0.25],
    [0.4, 0],
    [0, 0.5],
    [0.4, 1],
    [0.4, 0.75],
    [1, 0.75],
  ],
  upArrow: [
    [0.25, 1],
    [0.25, 0.4],
    [0, 0.4],
    [0.5, 0],
    [1, 0.4],
    [0.75, 0.4],
    [0.75, 1],
  ],
  downArrow: [
    [0.25, 0],
    [0.25, 0.6],
    [0, 0.6],
    [0.5, 1],
    [1, 0.6],
    [0.75, 0.6],
    [0.75, 0],
  ],
  chevron: [
    [0, 0],
    [0.5, 0.5],
    [0, 1],
    [0.4, 1],
    [0.9, 0.5],
    [0.4, 0],
  ],
  flowChartDecision: [
    [0.5, 0],
    [1, 0.5],
    [0.5, 1],
    [0, 0.5],
  ],
  flowChartInputOutput: [
    [0.2, 0],
    [1, 0],
    [0.8, 1],
    [0, 1],
  ],
  flowChartPreparation: [
    [0.15, 0],
    [0.85, 0],
    [1, 0.5],
    [0.85, 1],
    [0.15, 1],
    [0, 0.5],
  ],
};
