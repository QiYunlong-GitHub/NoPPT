/**
 * Deck 图表节点 → `slide.addChart()`。
 *
 * 关键点：**不自己维护第二套图表枚举**。
 * `DeckChartKind` 是 core 里的唯一真值，这里只查 `CHART_BACKENDS[kind].pptx`
 * 得到 PptxGenJS 的 `ChartType` + `barDir` / `barGrouping` / `lineSmooth` / `holeSize`，
 * 从而保证 SVG 渲染器与 PPTX 渲染器永远不会漂移。
 */

import {
  CHART_BACKENDS,
  rectToInch,
  type DeckChartKind,
  type DeckChartNode,
  type DeckRect,
} from '@noppt/core/deck';

/** PptxGenJS `addChart` 的数据行：name / labels / values。 */
interface PptxChartData {
  name?: string;
  labels: string[];
  values: number[];
}

function toChartData(node: DeckChartNode): PptxChartData[] {
  const spec = node.chart;
  const labels = spec.categories ?? [];
  return (spec.series ?? []).map((s, i) => ({
    name: s.name || `系列${i + 1}`,
    // scatter / bubble 用 xs 作标签，其余用 categories
    labels: s.xs?.length ? s.xs.map((x) => String(x)) : labels,
    values: s.values ?? [],
  }));
}

/** 组合图：PptxGenJS 用 `addChart(chartTypes[], data[], opts)` 的不同签名。 */
function renderComboChart(
  slide: { addChart: Function },
  node: DeckChartNode,
  opts: Record<string, unknown>,
  data: PptxChartData[],
): void {
  const kinds: DeckChartKind[] =
    node.chart.seriesKinds?.map((k) => (k === 'line' ? 'line' : k === 'area' ? 'area' : 'bar')) ??
    data.map((_, i) => (i % 2 === 0 ? 'bar' : 'line'));
  const chartTypes = data.map((d, i) => {
    const backend = CHART_BACKENDS[kinds[i] ?? 'bar'].pptx;
    return {
      type: backend.type === 'combo' ? 'bar' : backend.type,
      data: [d],
      options: { ...(backend.barDir ? { barDir: backend.barDir } : {}) },
    };
  });
  slide.addChart(chartTypes, data, {
    ...opts,
    ...(node.chart.secondaryAxis ? { secondaryValAxis: true, secondaryCatAxis: true } : {}),
  });
}

/** 渲染图表节点。 */
export function renderChartNode(slide: { addChart: Function }, node: DeckChartNode): void {
  const spec = node.chart;
  const data = toChartData(node).filter((d) => d.values.length > 0);
  if (data.length === 0) return;

  const backend = CHART_BACKENDS[spec.kind] ?? CHART_BACKENDS.bar;
  const pos = rectToInch(node.rect as DeckRect);
  const opts: Record<string, unknown> = { ...pos };

  if (spec.title) {
    opts.showTitle = true;
    opts.title = spec.title;
  }
  if (typeof spec.showLegend === 'boolean') opts.showLegend = spec.showLegend;
  else if (data.length > 1) opts.showLegend = true;
  if (opts.showLegend) opts.legendPos = 'b';
  if (spec.showValue) opts.showValue = true;
  if (spec.showPercent) opts.showPercent = true;
  if (spec.colors?.length) opts.chartColors = spec.colors;
  if (typeof spec.holeSize === 'number') opts.holeSize = spec.holeSize;
  else if (typeof backend.pptx.holeSize === 'number') opts.holeSize = backend.pptx.holeSize;
  if (spec.xTitle) {
    opts.showCatAxisTitle = true;
    opts.catAxisTitle = spec.xTitle;
  }
  if (spec.yTitle) {
    opts.showValAxisTitle = true;
    opts.valAxisTitle = spec.yTitle;
  }
  if (backend.pptx.barDir) opts.barDir = backend.pptx.barDir;
  if (backend.pptx.barGrouping) opts.barGrouping = backend.pptx.barGrouping;
  if (backend.pptx.lineSmooth) opts.lineSmooth = true;
  // 弱化网格线，贴近 NoPPT 的 HTML 视觉
  opts.valGridLine = { style: 'solid', color: 'E5E7EB', size: 0.5 };
  opts.catGridLine = { style: 'none' };
  opts.valAxisLabelFontSize = 10;
  opts.catAxisLabelFontSize = 10;
  opts.dataLabelFontSize = 10;

  if (backend.pptx.type === 'combo') {
    renderComboChart(slide, node, opts, data);
    return;
  }
  slide.addChart(backend.pptx.type, data, opts);
}
