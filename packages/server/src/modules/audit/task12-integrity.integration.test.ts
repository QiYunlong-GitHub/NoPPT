import { describe, expect, it, vi } from 'vitest';
import { LogsService } from '../logs/logs.service';

const baseEvidence = {
  eventType: 'audit',
  presentationId: 'task12-presentation',
  slideIndex: 0,
  runId: 'task12-run',
  phase: 'candidate',
  source: 'deck',
  pageType: 'content',
  viewport: { width: 1280, height: 720 },
  logicalCanvas: { width: 1280, height: 720 },
  expected: { content: 1 },
  observed: { content: 1 },
  emptyRequiredNodes: 0,
  outOfBoundsNodes: 0,
  clippedNodes: 0,
  parity: 'pass',
  font: { state: 'resolved' },
  status: 'pass',
  fixAction: null,
  artifactPath: null,
  durationMs: 1,
  errorCode: null,
};

describe('Task 12 server audit evidence integration', () => {
  it('writes structured integrity events with runId and strips secrets, full sensitive material, and external responses', async () => {
    const entries: unknown[] = [];
    const storage = {
      generateId: vi.fn(() => 'entry-1'),
      getPresentationDir: vi.fn(() => 'isolated'),
      appendToLogFile: vi.fn(async (_path: string, data: unknown) => entries.push(data)),
    };
    const logs = new LogsService(storage as never);

    await (logs as unknown as { logIntegrityEvent: (id: string, event: Record<string, unknown>) => Promise<void> })
      .logIntegrityEvent('task12-presentation', {
        ...baseEvidence,
        apiKey: 'should-not-be-written',
        sensitiveMaterial: 'full secret content',
        externalResponse: { raw: 'provider response' },
      });

    expect(entries).toHaveLength(1);
    const entry = entries[0] as Record<string, unknown>;
    expect(entry).toMatchObject({ type: 'audit', presentationId: 'task12-presentation', runId: 'task12-run' });
    expect(entry).not.toHaveProperty('apiKey');
    expect(entry).not.toHaveProperty('sensitiveMaterial');
    expect(entry).not.toHaveProperty('externalResponse');
  });

  it('blocks a save when required integrity evidence is missing instead of treating it as a pass', async () => {
    const audit = await import('@noppt/audit');
    const assertEvidence = (audit as unknown as {
      assertIntegrityEvidenceForSave?: (report: unknown) => void;
    }).assertIntegrityEvidenceForSave;

    expect(assertEvidence).toBeTypeOf('function');
    expect(() => assertEvidence?.({ overallResult: 'pass', issues: [] })).toThrow(/evidence|integrity|save/i);
  });
});
