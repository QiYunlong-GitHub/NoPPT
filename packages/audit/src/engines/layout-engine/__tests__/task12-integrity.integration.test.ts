import { describe, expect, it } from 'vitest';
import { AuditEngine } from '../../../engine/audit-engine';
import { LayoutAuditEngine } from '../index';
import type { Presentation } from '@noppt/core';

function slideHtml(index: number): string {
  return `<div data-canonical-root="true" data-logical-width="1280" data-logical-height="720" style="position:relative;width:100%;height:100%;overflow:hidden;">\n    <div data-content-id="required-${index}" data-role="content" style="position:absolute;left:1300px;top:0;width:120px;height:40px;overflow:hidden;"></div>\n    <div data-content-id="decoration-${index}" data-role="decoration" style="position:absolute;left:1300px;top:0;width:120px;height:40px;overflow:hidden;"></div>\n    <div data-logical-canvas="true" style="position:relative;width:1280px;height:720px;"></div>\n  </div>`;
}

function presentation(): Presentation {
  return {
    id: 'task12-presentation',
    title: 'Task 12 audit fixture',
    slides: Array.from({ length: 5 }, (_, index) => ({
      id: `slide-${index}`,
      title: `Slide ${index + 1}`,
      html: slideHtml(index),
      index,
      createdAt: 0,
      updatedAt: 0,
    })),
    width: 1280,
    height: 720,
    zoom: 1,
    transition: 'none',
    createdAt: 0,
    updatedAt: 0,
    version: 1,
  } as Presentation;
}

describe('Task 12 content/parity/geometry audit integration', () => {
  it('registers required-node clipping, canvas bounds, empty text, and nested canvas rules without flagging decoration', async () => {
    const result = await new LayoutAuditEngine().audit({
      presentation: presentation(),
      config: {
        engines: { layout: true, visual: false, content: false, fidelity: false, sanitization: false },
        weights: { layout: 1, visual: 0, content: 0, fidelity: 0, sanitization: 0 },
        thresholds: { pass: 70, warn: 50 },
        autoFix: false,
        maxRegenerationRetries: 0,
        viewport: { width: 1280, height: 720 },
      },
    });

    const ids = new Set(result.issues.map((issue) => issue.ruleId));
    expect([...ids]).toEqual(expect.arrayContaining([
      'no-required-content-clipping',
      'logical-canvas-boundary',
      'no-empty-required-text',
      'no-fixed-nested-canvas',
    ]));
    expect(result.issues.some((issue) => issue.selector?.includes('decoration'))).toBe(false);
    expect(new Set(result.issues.map((issue) => issue.slideIndex))).toEqual(new Set([0, 1, 2, 3, 4]));
  });

  it('produces five per-page integrity results linked by one runId', async () => {
    const engine = new AuditEngine({
      engines: { layout: true, visual: false, content: false, fidelity: false, sanitization: false },
      autoFix: false,
    });
    const report = await engine.auditPresentation(presentation());
    const integrity = (report as unknown as { integrity?: { runId?: string; perSlide?: unknown[] } }).integrity;

    expect(integrity?.runId).toBeTruthy();
    expect(integrity?.perSlide).toHaveLength(5);
    expect((integrity?.perSlide as Array<{ runId?: string }>).every((item) => item.runId === integrity?.runId)).toBe(true);
  });
});
