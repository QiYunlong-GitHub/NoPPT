import { describe, it, expect } from 'vitest';
import {
  renderChartSvg,
  renderCycleSvg,
  renderDashboardSvg,
  renderArchitectureSvg,
  type SvgRenderOptions,
} from './structured-graphics';
import type { ChartSpec, ArchitectureSpec } from '../types';

const opts: SvgRenderOptions = {
  primaryColor: '#2563eb',
  primaryColorDarker: '#1e40af',
};

describe('structured-graphics · 受控 SVG 渲染器', () => {
  describe('renderChartSvg', () => {
    it('bar：输出 svg 且包含坐标轴与柱', () => {
      const spec: ChartSpec = {
        kind: 'bar',
        series: [{ name: 'A', points: [{ label: 'Q1', value: 10 }, { label: 'Q2', value: 20 }] }],
        unit: '%',
      };
      const svg = renderChartSvg(spec, opts);
      expect(svg).toContain('<svg');
      expect(svg).toContain('<rect');
      expect(svg).toContain('Q1');
    });

    it('line：输出 polyline', () => {
      const spec: ChartSpec = { kind: 'line', series: [{ points: [{ label: 'a', value: 1 }, { label: 'b', value: 3 }] }] };
      const svg = renderChartSvg(spec, opts);
      expect(svg).toContain('<polyline');
      expect(svg).toContain('<circle');
    });

    it('pie/donut：输出 path 扇区', () => {
      const spec: ChartSpec = { kind: 'pie', series: [{ points: [{ label: 'x', value: 1 }, { label: 'y', value: 3 }] }] };
      const pie = renderChartSvg(spec, opts);
      expect(pie).toContain('<path');
      const donut = renderChartSvg({ ...spec, kind: 'donut' }, opts);
      expect(donut).toContain('<path');
    });

    it('空 series 静默降级为 空串（不抛错）', () => {
      const svg = renderChartSvg({ kind: 'bar', series: [] }, opts);
      expect(svg).toBe('');
    });

    it('非法入参不抛异常', () => {
      expect(() => renderChartSvg(null as any, opts)).not.toThrow();
      expect(renderChartSvg(null as any, opts)).toBe('');
    });
  });

  describe('renderCycleSvg', () => {
    it('输出环形节点与箭头', () => {
      const svg = renderCycleSvg(['采集', '清洗', '分析'], opts);
      expect(svg).toContain('<svg');
      expect(svg).toContain('<circle');
      expect(svg).toContain('采集');
    });
    it('少于 2 项降级为空串', () => {
      expect(renderCycleSvg(['仅一个'], opts)).toBe('');
    });
  });

  describe('renderDashboardSvg', () => {
    it('输出指标卡与趋势', () => {
      const svg = renderDashboardSvg(
        [
          { label: 'DAU', value: '12k', trend: 'up' },
          { label: '留存', value: '80%', trend: 'down' },
        ],
        opts,
      );
      expect(svg).toContain('<rect');
      expect(svg).toContain('DAU');
      expect(svg).toContain('↑');
    });
    it('空指标降级为空串', () => {
      expect(renderDashboardSvg([], opts)).toBe('');
    });
  });

  describe('renderArchitectureSvg', () => {
    const spec: ArchitectureSpec = {
      layers: [
        { title: '接入层', nodeIds: [1, 2] },
        { title: '服务层', nodeIds: [3] },
      ],
      nodes: [
        { id: 1, label: 'Gateway', variant: 'cloud' },
        { id: 2, label: 'LB', variant: 'box' },
        { id: 3, label: 'DB', variant: 'cylinder' },
      ],
      flows: [[1, 3]],
    };
    it('输出分层节点与流向箭头', () => {
      const svg = renderArchitectureSvg(spec, opts);
      expect(svg).toContain('<svg');
      expect(svg).toContain('接入层');
      expect(svg).toContain('Gateway');
      expect(svg).toContain('DB');
      expect(svg).toContain('marker-end');
    });
    it('空 layers 降级为空串', () => {
      expect(renderArchitectureSvg({ layers: [] }, opts)).toBe('');
    });
  });
});
