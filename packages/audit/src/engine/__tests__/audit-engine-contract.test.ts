import { describe, expect, it, vi } from 'vitest';
import { AuditEngine } from '../audit-engine';
import type { AuditEngineContract, AuditEngineResult } from '../../types';

function makePresentation() {
  return {
    id: 'p1',
    title: 'Test',
    slides: [
      {
        id: 's1',
        title: 'S1',
        html: '<div><h1>标题</h1></div>',
        elements: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ],
    zoom: 1,
    width: 1280,
    height: 720,
    transition: 'none',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    version: 1,
  } as any;
}

const result = (engine: 'layout' | 'visual' | 'content'): AuditEngineResult => ({
  engine,
  engineName: engine,
  status: 'passed',
  score: 100,
  issues: [],
  durationMs: 0,
});

describe('AuditEngine contract diagnostics', () => {
  it('reports an enabled engine that is not registered', async () => {
    const engine = new AuditEngine({
      engines: {
        layout: false,
        visual: true,
        content: false,
        fidelity: false,
        sanitization: false,
      },
    });
    const report = await engine.auditPresentation(makePresentation());
    const visual = report.engineResults.find((entry) => entry.engine === 'visual');
    expect(visual).toMatchObject({
      status: 'error',
      raw: { code: 'AUDIT_ENGINE_MISSING' },
    });
    expect(visual?.issues[0]).toMatchObject({
      severity: 'error',
      metadata: { diagnostic: true, code: 'AUDIT_ENGINE_MISSING' },
    });
    expect(report.regenerationRequired).toBe(true);
  });

  it('converts unknown thrown values into a safe structured diagnostic', async () => {
    const engine = new AuditEngine({
      engines: {
        layout: false,
        visual: true,
        content: false,
        fidelity: false,
        sanitization: false,
      },
    });
    const throwingEngine: AuditEngineContract = {
      audit: async () => {
        throw { secret: 'must not leak' };
      },
    };
    engine.registerEngine('visual', throwingEngine);

    const report = await engine.auditPresentation(makePresentation());
    const visual = report.engineResults.find((entry) => entry.engine === 'visual');
    expect(visual).toMatchObject({ status: 'error', raw: { code: 'AUDIT_ENGINE_FAILED' } });
    expect(JSON.stringify(visual)).not.toContain('must not leak');
    expect(visual?.issues[0].message).toContain('未知审核引擎错误');
  });

  it('reports re-verification failures instead of hiding them', async () => {
    let calls = 0;
    const engine = new AuditEngine({
      engines: {
        layout: true,
        visual: false,
        content: false,
        fidelity: false,
        sanitization: false,
      },
      autoFix: true,
    });
    const layout: AuditEngineContract = {
      audit: async () => {
        calls += 1;
        if (calls > 1) throw new Error('reverify unavailable');
        return {
          ...result('layout'),
          issues: [
            {
              ruleId: 'layout.test-fix',
              severity: 'warn',
              engine: 'layout',
              slideIndex: 0,
              message: 'needs fix',
              fixable: true,
            },
          ],
        };
      },
    };
    engine.registerEngine('layout', layout);

    const report = await engine.auditPresentation(makePresentation());
    expect(report.engineResults.some((entry) => entry.raw?.code === 'AUDIT_REVERIFY_FAILED')).toBe(
      true,
    );
    expect(report.issues.some((issue) => issue.metadata?.code === 'AUDIT_REVERIFY_FAILED')).toBe(
      true,
    );
  });

  it('continues destroying later engines after one failure', async () => {
    const laterDestroy = vi.fn(async (): Promise<void> => undefined);
    const engine = new AuditEngine({
      engines: {
        layout: false,
        visual: false,
        content: false,
        fidelity: false,
        sanitization: false,
      },
    });
    engine.registerEngine('visual', {
      audit: async () => result('visual'),
      destroy: async (): Promise<void> => {
        throw new Error('first destroy failed');
      },
    });
    engine.registerEngine('content', {
      audit: async () => result('content'),
      destroy: laterDestroy,
    });

    await expect(engine.destroy()).rejects.toThrow('first destroy failed');
    expect(laterDestroy).toHaveBeenCalledTimes(1);
  });
});
