import { describe, expect, it } from 'vitest';
import type { Presentation } from '@noppt/core';
import type { AuditConfig, AuditContext, AuditEngineResult } from '../../types';
import { buildIntegrityReport } from '../integrity-evidence';

const config = {
  viewport: { width: 1280, height: 720 },
} as AuditConfig;

function context(): AuditContext {
  return {
    presentation: {
      id: 'task13-presentation',
      title: 'Task 13 fixture',
      slides: [{ html: '<div data-content-id="content-1">content</div>' }],
      zoom: 1,
      width: 1280,
      height: 720,
      transition: 'none',
      createdAt: 0,
      updatedAt: 0,
      version: 1,
    } as unknown as Presentation,
    config,
    runId: 'task13-run',
    phase: 'candidate',
    source: 'canonical-html',
  };
}

function visualResult(
  status: 'fail' | 'unverified',
  issue?: AuditEngineResult['issues'][number],
): AuditEngineResult {
  return {
    engine: 'visual',
    engineName: 'Visual Design Audit Engine',
    status: status === 'fail' ? 'fail' : 'error',
    score: status === 'fail' ? 0 : 0,
    issues: issue ? [issue] : [],
    durationMs: 1,
    raw: {
      visualValidation: {
        status,
        reportPath: 'isolated/task13/visual-validation-report.json',
        slides: [{ slideIndex: 0, status, screenshotPaths: ['isolated/task13/screenshots/slide-1-800x600.png'] }],
      },
      perSlide: [{ slideIndex: 0, fonts: { state: status === 'fail' ? 'resolved' : 'unverified' } }],
    },
  };
}

describe('Task 13 visual validation candidate integration', () => {
  it('turns a required visual failure into failed per-slide evidence', () => {
    const issue = {
      ruleId: 'visual-validation-required_clipped',
      severity: 'error' as const,
      engine: 'visual' as const,
      slideIndex: 0,
      message: 'required content is clipped at 800x600',
      fixable: false,
      metadata: { code: 'required_clipped' },
    };
    const result = buildIntegrityReport(context(), [visualResult('fail', issue)], [issue]);

    expect(result.status).toBe('fail');
    expect(result.perSlide[0].status).toBe('fail');
    expect(result.events.some((event) => event.eventType === 'visual_validation' && event.status === 'fail')).toBe(true);
    expect(result.events[0].artifactPath).toContain('slide-1-800x600.png');
  });

  it('keeps browser-unverified evidence out of pass and records the reason', () => {
    const result = buildIntegrityReport(context(), [visualResult('unverified')], []);

    expect(result.status).toBe('needs_review');
    expect(result.perSlide[0].status).toBe('unverified');
    expect(result.events.every((event) => event.status === 'unverified')).toBe(true);
    expect(result.events[0].font).toMatchObject({ state: 'unverified' });
  });
});
