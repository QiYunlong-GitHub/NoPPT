import { describe, expect, it } from 'vitest';
import { renderChartSvg, resolveDeckChartKind, type SvgRenderOptions } from './structured-graphics';
import type { ChartSpec } from '../types';

const opts: SvgRenderOptions = {
  primaryColor: '#2563eb',
  primaryColorDarker: '#1e40af',
};

describe('structured-graphics · extended chart kinds', () => {
  it('area：输出填充多边形', () => {
    const spec: ChartSpec = {
      kind: 'area',
      series: [
        {
          points: [
            { label: 'Q1', value: 10 },
            { label: 'Q2', value: 20 },
            { label: 'Q3', value: 15 },
          ],
        },
      ],
    };
    const svg = renderChartSvg(spec, opts);
    expect(svg).toContain('<svg');
    expect(svg).toContain('<polygon');
    expect(svg).toContain('<polyline');
  });

  it('bar + percentStacked：输出百分比标签', () => {
    const spec: ChartSpec = {
      kind: 'bar',
      stacked: true,
      percentStacked: true,
      series: [
        {
          points: [
            { label: 'Q1', value: 30 },
            { label: 'Q2', value: 50 },
          ],
        },
        {
          points: [
            { label: 'Q1', value: 70 },
            { label: 'Q2', value: 50 },
          ],
        },
      ],
    };
    const svg = renderChartSvg(spec, opts);
    expect(svg).toContain('<rect');
    expect(svg).toContain('30%');
    expect(svg).toContain('70%');
  });

  it('line + smooth：输出三次贝塞尔 path', () => {
    const spec: ChartSpec = {
      kind: 'line',
      smooth: true,
      series: [
        {
          points: [
            { label: 'a', value: 1 },
            { label: 'b', value: 5 },
            { label: 'c', value: 3 },
            { label: 'd', value: 8 },
          ],
        },
      ],
    };
    expect(renderChartSvg(spec, opts)).toContain(' C ');
  });

  it('radar：输出多边形网格与数据多边形', () => {
    const spec: ChartSpec = {
      kind: 'radar',
      series: [
        {
          points: [
            { label: '速度', value: 8 },
            { label: '成本', value: 6 },
            { label: '质量', value: 9 },
            { label: '服务', value: 7 },
          ],
        },
      ],
    };
    const svg = renderChartSvg(spec, opts);
    expect(svg).toContain('<polygon');
    expect(svg).toContain('速度');
  });

  it('scatter / bubble：输出圆形数据点', () => {
    const base: ChartSpec = {
      kind: 'scatter',
      series: [
        {
          points: [
            { label: '1', value: 3 },
            { label: '2', value: 6 },
            { label: '3', value: 4 },
          ],
        },
      ],
    };
    expect(renderChartSvg(base, opts)).toContain('<circle');
    expect(renderChartSvg({ ...base, kind: 'bubble' }, opts)).toContain('<circle');
  });

  it('combo：柱 + 折线叠加', () => {
    const spec: ChartSpec = {
      kind: 'combo',
      seriesKinds: ['bar', 'line'],
      series: [
        {
          points: [
            { label: 'Q1', value: 10 },
            { label: 'Q2', value: 20 },
          ],
        },
        {
          points: [
            { label: 'Q1', value: 15 },
            { label: 'Q2', value: 25 },
          ],
        },
      ],
    };
    const svg = renderChartSvg(spec, opts);
    expect(svg).toContain('<rect');
    expect(svg).toContain('<polyline');
  });

  it('resolveDeckChartKind：收敛到 core 单一枚举', () => {
    expect(resolveDeckChartKind({ kind: 'bar', series: [] })).toBe('bar');
    expect(resolveDeckChartKind({ kind: 'bar', stacked: true, series: [] })).toBe('barStacked');
    expect(resolveDeckChartKind({ kind: 'bar', percentStacked: true, series: [] })).toBe(
      'barStacked100',
    );
    expect(resolveDeckChartKind({ kind: 'area', stacked: true, series: [] })).toBe('areaStacked');
    expect(resolveDeckChartKind({ kind: 'line', smooth: true, series: [] })).toBe('lineSmooth');
    expect(resolveDeckChartKind({ kind: 'radar', series: [] })).toBe('radar');
    expect(resolveDeckChartKind({ kind: 'bubble', series: [] })).toBe('bubble');
    expect(resolveDeckChartKind({ kind: 'combo', series: [] })).toBe('combo');
  });
});
