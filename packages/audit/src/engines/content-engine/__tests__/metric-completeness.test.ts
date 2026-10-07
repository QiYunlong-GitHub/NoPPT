import { describe, expect, it } from 'vitest';
import type { Presentation, Slide } from '@noppt/core';
import type { PresentationPlan } from '@noppt/ai';
import { ContentAuditEngine } from '../index';

function config() {
  return {
    engines: { layout: false, visual: false, content: true, fidelity: false, sanitization: false },
    weights: { layout: 0, visual: 0, content: 1, fidelity: 0, sanitization: 0 },
    thresholds: { pass: 80, warn: 60 },
    autoFix: false,
    maxRegenerationRetries: 0,
    viewport: { width: 1280, height: 720 },
  };
}

function presentation(html: string): Presentation {
  const slides: Slide[] = [
    { id: 'cover', title: '封面', html: '<div>封面</div>', hidden: false, index: 0, createdAt: 0, updatedAt: 0 },
    { id: 'metric-slide', title: '指标', html, hidden: false, index: 1, createdAt: 0, updatedAt: 0 },
    { id: 'summary', title: '总结', html: '<div>总结</div>', hidden: false, index: 2, createdAt: 0, updatedAt: 0 },
  ];
  return {
    id: 'metric-presentation',
    title: '指标完整性',
    slides,
    zoom: 1,
    width: 1280,
    height: 720,
    transition: 'none',
    createdAt: 0,
    updatedAt: 0,
    version: 1,
  };
}

function plan(): PresentationPlan {
  return {
    title: '指标完整性',
    primaryColor: '#2563eb',
    slides: [
      { pageType: 'cover', title: '封面', keyPoints: [], needsImage: false },
      {
        pageType: 'content-stats-highlight',
        title: '指标',
        keyPoints: [],
        needsImage: false,
        metricItems: [
          { kind: 'metric', contentId: 'metric-users', order: 0, label: '新增用户', value: '3万人' },
          { kind: 'metric', contentId: 'metric-rate', order: 1, label: '转化率', value: '42%' },
        ],
      },
      { pageType: 'summary', title: '总结', keyPoints: [], needsImage: false },
    ],
  };
}

describe('ContentAuditEngine metric completeness', () => {
  it('reports missing metric identities and text as structured contract issues', async () => {
    const result = await new ContentAuditEngine().audit({
      presentation: presentation(`
        <div data-metric-root="true">
          <article data-content-id="metric-users">
            <strong>3万人</strong><span>新增用户</span>
          </article>
        </div>
      `),
      plan: plan(),
      config: config(),
    });

    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: 'metric-content-completeness',
          severity: 'error',
          slideIndex: 1,
          metadata: expect.objectContaining({
            contentId: 'metric-rate',
            expectedText: '42% 转化率',
            omissionReason: expect.any(String),
          }),
        }),
      ]),
    );
    expect(result.status).toBe('fail');
  });
});
