import { describe, it, expect } from 'vitest';
import { HTMLPresentationAgent } from './html-presentation-agent';
import type { SlidePlan } from '../types';

function buildAgent(): HTMLPresentationAgent {
  const dummy = {
    name: 'stub',
    config: {},
    supportsStreaming: false,
    chat: async () => ({
      content: '',
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    }),
  } as any;
  return new HTMLPresentationAgent(dummy);
}

function basePlan(over: Partial<SlidePlan>): SlidePlan {
  return {
    pageType: 'content-chart-bar',
    title: 't',
    keyPoints: [],
    needsImage: false,
    ...over,
  } as SlidePlan;
}

describe('injectStructuredGraphics (PostProcess 受控 SVG 注入)', () => {
  it('将 chart SVG 注入占位符', () => {
    const agent = buildAgent();
    const html = '<div class="structured-graphic" data-graphic-slot="chart"></div>';
    const plan = basePlan({
      pageType: 'content-chart-bar',
      chart: {
        kind: 'bar',
        series: [
          {
            points: [
              { label: 'a', value: 1 },
              { label: 'b', value: 2 },
            ],
          },
        ],
      },
    });
    const out = (agent as any).injectStructuredGraphics(html, plan, '#2563eb', '#1e40af');
    expect(out).toContain('<svg');
    expect(out).toContain('data-graphic-slot="chart"');
  });

  it('无占位符时原样返回（不破坏 DOM）', () => {
    const agent = buildAgent();
    const html = '<div>hello</div>';
    const plan = basePlan({
      chart: { kind: 'bar', series: [{ points: [{ label: 'a', value: 1 }] }] },
    });
    const out = (agent as any).injectStructuredGraphics(html, plan, '#2563eb', '#1e40af');
    expect(out).toBe(html);
  });

  it('无 chart 数据时占位符保持原内容（静默降级）', () => {
    const agent = buildAgent();
    const html = '<div class="structured-graphic" data-graphic-slot="chart">占位</div>';
    const plan = basePlan({ pageType: 'content-chart-bar' });
    const out = (agent as any).injectStructuredGraphics(html, plan, '#2563eb', '#1e40af');
    expect(out).toContain('占位');
  });

  it('注入 architecture SVG', () => {
    const agent = buildAgent();
    const html = '<div class="structured-graphic" data-graphic-slot="architecture"></div>';
    const plan = basePlan({
      pageType: 'content-architecture',
      architecture: { layers: [{ title: 'L1', nodeIds: [1] }], nodes: [{ id: 1, label: 'GW' }] },
    });
    const out = (agent as any).injectStructuredGraphics(html, plan, '#2563eb', '#1e40af');
    expect(out).toContain('<svg');
    expect(out).toContain('GW');
  });

  it('注入 cycle SVG（来自 keyPoints）', () => {
    const agent = buildAgent();
    const html = '<div class="structured-graphic" data-graphic-slot="cycle"></div>';
    const plan = basePlan({ pageType: 'content-cycle', keyPoints: ['a', 'b', 'c'] });
    const out = (agent as any).injectStructuredGraphics(html, plan, '#2563eb', '#1e40af');
    expect(out).toContain('<svg');
  });

  it('属性顺序无关也能匹配占位符', () => {
    const agent = buildAgent();
    const html = '<div data-graphic-slot="chart" class="structured-graphic"></div>';
    const plan = basePlan({
      pageType: 'content-chart-pie',
      chart: {
        kind: 'pie',
        series: [
          {
            points: [
              { label: 'x', value: 1 },
              { label: 'y', value: 3 },
            ],
          },
        ],
      },
    });
    const out = (agent as any).injectStructuredGraphics(html, plan, '#2563eb', '#1e40af');
    expect(out).toContain('<svg');
  });

  it('无 chart/architecture 时零注入、零异常（向后兼容主流程，呼应 NFR-3/AC-13）', () => {
    const agent = buildAgent();
    const html = '<div>普通内容页，无结构化图形</div>';
    const plan = basePlan({ pageType: 'content-no-image' });
    const out = (agent as any).injectStructuredGraphics(html, plan, '#2563eb', '#1e40af');
    expect(out).toBe(html);
  });
});
