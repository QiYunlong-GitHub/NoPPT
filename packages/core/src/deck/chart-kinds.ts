/**
 * 图表类型**单一枚举真值** + 双后端映射表。
 *
 * 背景：NoPPT 的图表要同时驱动
 *  1) `@noppt/ai` 里**手写 SVG 渲染器**（`templates/structured-graphics.ts`）；
 *  2) `@noppt/web` 里 **PptxGenJS** 的 `slide.addChart()`。
 * 两套枚举若各写一份必然漂移，因此在此定义唯一 `DeckChartKind`，
 * 两侧都通过 `CHART_BACKENDS` 查表，杜绝不一致。
 *
 * 借鉴来源：
 * - python-pptx `XL_CHART_TYPE`（73 种，含 *_STACKED / *_STACKED_100 / radar / bubble / XY_SCATTER / area）
 * - PptxGenJS `ChartType`（10 类）+ Combo（组合图）签名
 */

export type DeckChartKind =
  // 柱 / 条
  | 'bar'
  | 'barStacked'
  | 'barStacked100'
  // 折线
  | 'line'
  | 'lineSmooth'
  // 面积
  | 'area'
  | 'areaStacked'
  | 'areaStacked100'
  // 极坐标
  | 'pie'
  | 'donut'
  | 'radar'
  // 数值分布
  | 'scatter'
  | 'bubble'
  // 组合
  | 'combo';

/** 全部图表类型（供遍历/测试/降级）。 */
export const DECK_CHART_KINDS: DeckChartKind[] = [
  'bar',
  'barStacked',
  'barStacked100',
  'line',
  'lineSmooth',
  'area',
  'areaStacked',
  'areaStacked100',
  'pie',
  'donut',
  'radar',
  'scatter',
  'bubble',
  'combo',
];

/**
 * SVG 渲染器分派 key。
 * `@noppt/ai` 的 `structured-graphics.ts` 按此 key 选择绘制函数，
 * 具体渲染实现留在 ai 包（core 保持零依赖）。
 */
export type DeckChartSvgRenderer =
  'bar' | 'line' | 'area' | 'pieDonut' | 'radar' | 'scatter' | 'bubble' | 'combo';

/** PptxGenJS 侧图表配置。 */
export interface DeckChartPptxBackend {
  /** PptxGenJS `ChartType` 名；`combo` 走组合图签名。 */
  type: 'bar' | 'line' | 'area' | 'pie' | 'doughnut' | 'radar' | 'scatter' | 'bubble' | 'combo';
  /** 柱方向：col=竖直柱（默认），bar=水平条。 */
  barDir?: 'bar' | 'col';
  /** 分组方式（PptxGenJS `barGrouping`）。 */
  barGrouping?: 'clustered' | 'stacked' | 'percentStacked';
  /** 折线平滑（PptxGenJS `lineSmooth`）。 */
  lineSmooth?: boolean;
  /** 甜甜圈空心比例（PptxGenJS `holeSize`，1-100）。 */
  holeSize?: number;
  /** 是否按堆叠语义渲染（供 SVG 侧与 area 场景使用）。 */
  stacked?: boolean;
  /** 是否按 100% 堆叠语义渲染。 */
  percentStacked?: boolean;
}

export interface DeckChartBackendMap {
  svg: DeckChartSvgRenderer;
  pptx: DeckChartPptxBackend;
}

/**
 * 唯一映射表：DeckChartKind → { SVG 渲染器, PptxGenJS 配置 }。
 * 新增图表类型只需在此加一行，两后端同时生效。
 */
export const CHART_BACKENDS: Record<DeckChartKind, DeckChartBackendMap> = {
  bar: { svg: 'bar', pptx: { type: 'bar', barDir: 'col', barGrouping: 'clustered' } },
  barStacked: {
    svg: 'bar',
    pptx: { type: 'bar', barDir: 'col', barGrouping: 'stacked', stacked: true },
  },
  barStacked100: {
    svg: 'bar',
    pptx: {
      type: 'bar',
      barDir: 'col',
      barGrouping: 'percentStacked',
      stacked: true,
      percentStacked: true,
    },
  },
  line: { svg: 'line', pptx: { type: 'line' } },
  lineSmooth: { svg: 'line', pptx: { type: 'line', lineSmooth: true } },
  area: { svg: 'area', pptx: { type: 'area' } },
  areaStacked: { svg: 'area', pptx: { type: 'area', stacked: true } },
  areaStacked100: { svg: 'area', pptx: { type: 'area', stacked: true, percentStacked: true } },
  pie: { svg: 'pieDonut', pptx: { type: 'pie', holeSize: 0 } },
  donut: { svg: 'pieDonut', pptx: { type: 'doughnut', holeSize: 50 } },
  radar: { svg: 'radar', pptx: { type: 'radar' } },
  scatter: { svg: 'scatter', pptx: { type: 'scatter' } },
  bubble: { svg: 'bubble', pptx: { type: 'bubble' } },
  combo: { svg: 'combo', pptx: { type: 'combo' } },
};

/** 旧版 `ChartSpec.kind`（bar/line/pie/donut）→ DeckChartKind，保证向后兼容。 */
export const LEGACY_CHART_KIND_MAP: Record<string, DeckChartKind> = {
  bar: 'bar',
  column: 'bar',
  line: 'line',
  pie: 'pie',
  donut: 'donut',
  doughnut: 'donut',
  area: 'area',
  radar: 'radar',
  scatter: 'scatter',
  bubble: 'bubble',
};

/** 归一化任意输入为合法 DeckChartKind，非法则降级为 bar。 */
export function normalizeDeckChartKind(v: unknown): DeckChartKind {
  if (typeof v !== 'string') return 'bar';
  if ((DECK_CHART_KINDS as string[]).includes(v)) return v as DeckChartKind;
  const legacy = LEGACY_CHART_KIND_MAP[v.toLowerCase()];
  return legacy ?? 'bar';
}

/** 单系列图表（无堆叠意义的 pie/donut/radar）。 */
export function isSingleSeriesChart(kind: DeckChartKind): boolean {
  return kind === 'pie' || kind === 'donut';
}

/** 是否需要数值轴（pie/donut/radar 无传统数值轴）。 */
export function hasValueAxis(kind: DeckChartKind): boolean {
  return kind !== 'pie' && kind !== 'donut';
}
