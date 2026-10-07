import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  IntegrityArtifactStore,
  IntegrityLifecycleError,
  type IntegrityCheckResult,
} from './presentation-integrity.service';

function hash(bytes: Buffer): string {
  return require('crypto').createHash('sha256').update(bytes).digest('hex');
}

describe('IntegrityArtifactStore', () => {
  let root: string;
  let sourceDir: string;
  let artifactRoot: string;
  let store: IntegrityArtifactStore;
  let originalBytes: Buffer;
  const presentation = {
    id: 'pres-fixture',
    title: 'Fixture',
    updatedAt: 100,
    slides: [{ id: 'slide-1', index: 0, title: 'Slide', html: '<div>ok</div>' }],
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'noppt-integrity-store-'));
    sourceDir = join(root, 'source-presentation');
    artifactRoot = join(root, 'isolated-artifacts');
    mkdirSync(join(sourceDir, 'assets', 'images'), { recursive: true });
    mkdirSync(join(sourceDir, 'reference-attrs'), { recursive: true });
    originalBytes = Buffer.from(JSON.stringify(presentation, null, 2), 'utf8');
    writeFileSync(join(sourceDir, 'presentation.json'), originalBytes);
    writeFileSync(join(sourceDir, 'ai-log.jsonl'), '{"type":"plan"}\n');
    writeFileSync(join(sourceDir, 'chat-history.json'), '[]');
    writeFileSync(join(sourceDir, 'assets', 'images', 'cover.png'), Buffer.from([1, 2, 3]));
    writeFileSync(join(sourceDir, 'reference-attrs', 'style.json'), '{"source":"fixture"}');
    store = new IntegrityArtifactStore({
      artifactRoot,
      now: () => 1234,
      runIdFactory: () => 'run-fixture',
      previewIdFactory: () => 'preview-fixture',
    });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('snapshots tracked inputs read-only and keeps candidate and preview outside the source', async () => {
    const run = await store.startRun(sourceDir, presentation.id);
    const candidate = { ...presentation, updatedAt: 101, title: 'Candidate' };
    const candidateRun = await store.writeCandidatePresentation(run, candidate);
    const preview = await store.createPreview(candidateRun, { pageIndex: 0 });

    expect(candidateRun.baseHash).toBe(hash(originalBytes));
    expect(candidateRun.candidateHash).not.toBe(candidateRun.baseHash);
    expect(existsSync(join(run.originalRoot, 'presentation.json'))).toBe(true);
    expect(existsSync(join(run.originalRoot, 'assets', 'images', 'cover.png'))).toBe(true);
    expect(preview.openUrl).toContain('/integrity-preview/preview-fixture');
    expect(preview.artifactPath.startsWith(artifactRoot)).toBe(true);
    expect(preview.artifactPath.startsWith(sourceDir)).toBe(false);
    expect(readFileSync(join(sourceDir, 'presentation.json'))).toEqual(originalBytes);
    expect(readFileSync(join(sourceDir, 'ai-log.jsonl'), 'utf8')).toContain('plan');
    expect(readFileSync(join(sourceDir, 'reference-attrs', 'style.json'), 'utf8')).toContain('fixture');
  });

  it.each<{
    name: string;
    checks: IntegrityCheckResult[];
    errorCode: IntegrityLifecycleError['code'];
  }>([
    {
      name: 'missing explicit confirmation',
      checks: [{ name: 'content', status: 'pass' }],
      errorCode: 'promotion_confirmation_required',
    },
    {
      name: 'required check failure',
      checks: [{ name: 'content', status: 'fail' }],
      errorCode: 'promotion_checks_failed',
    },
    {
      name: 'unverified check without risk confirmation',
      checks: [{ name: 'browser', status: 'unverified' }],
      errorCode: 'risk_confirmation_required',
    },
  ])('does not promote when $name', async ({ checks, errorCode }) => {
    const run = await store.startRun(sourceDir, presentation.id);
    await store.writeCandidatePresentation(run, { ...presentation, updatedAt: 101 });
    const sourceBefore = readFileSync(join(sourceDir, 'presentation.json'));

    await expect(
      store.promote(run, {
        operator: 'test-operator',
        explicitConfirmation: errorCode !== 'promotion_confirmation_required',
        allowRisk: false,
        checks,
      }),
    ).rejects.toMatchObject({ code: errorCode });

    expect((await store.getRun(run.runId)).state).toBe('candidate');
    expect(readFileSync(join(sourceDir, 'presentation.json'))).toEqual(sourceBefore);
  });

  it('rejects promotion after presentation hash or updatedAt drift', async () => {
    const run = await store.startRun(sourceDir, presentation.id);
    await store.writeCandidatePresentation(run, { ...presentation, updatedAt: 101 });
    writeFileSync(
      join(sourceDir, 'presentation.json'),
      JSON.stringify({ ...presentation, updatedAt: 999 }, null, 2),
    );

    await expect(
      store.promote(run, {
        operator: 'test-operator',
        explicitConfirmation: true,
        checks: [{ name: 'content', status: 'pass' }],
      }),
    ).rejects.toMatchObject({ code: 'source_drift' });
    expect((await store.getRun(run.runId)).state).toBe('candidate');
  });

  it('marks rollback_failed and retains the snapshot when the active file drifts after promotion', async () => {
    const run = await store.startRun(sourceDir, presentation.id);
    const promoted = await store.promote(
      await store.writeCandidatePresentation(run, { ...presentation, updatedAt: 101 }),
      {
        operator: 'test-operator',
        explicitConfirmation: true,
        checks: [{ name: 'content', status: 'pass' }],
      },
    );
    writeFileSync(
      join(sourceDir, 'presentation.json'),
      JSON.stringify({ ...presentation, updatedAt: 202 }, null, 2),
    );

    await expect(store.rollback(promoted, 'test-operator')).rejects.toMatchObject({
      code: 'source_drift',
    });
    expect((await store.getRun(run.runId)).state).toBe('rollback_failed');
    expect(existsSync(join(run.originalRoot, 'presentation.json'))).toBe(true);
  });

  it('promotes only after confirmation and atomically rolls back the exact snapshot', async () => {
    const run = await store.startRun(sourceDir, presentation.id);
    const candidateRun = await store.writeCandidatePresentation(run, {
      ...presentation,
      updatedAt: 101,
      title: 'Promoted candidate',
    });
    const promoted = await store.promote(candidateRun, {
      operator: 'test-operator',
      explicitConfirmation: true,
      checks: [
        { name: 'content', status: 'pass' },
        { name: 'browser', status: 'warn' },
      ],
      allowRisk: true,
    });

    expect(promoted.state).toBe('promoted');
    expect(JSON.parse(readFileSync(join(sourceDir, 'presentation.json'), 'utf8')).title).toBe(
      'Promoted candidate',
    );
    expect(existsSync(join(run.runRoot, 'promotion', 'active-original', 'presentation.json'))).toBe(true);

    const rolledBack = await store.rollback(promoted, 'test-operator');
    expect(rolledBack.state).toBe('rolled_back');
    expect(readFileSync(join(sourceDir, 'presentation.json'))).toEqual(originalBytes);
    expect(hash(readFileSync(join(sourceDir, 'presentation.json')))).toBe(run.baseHash);
    expect(readFileSync(join(run.reportRoot, 'lifecycle-events.jsonl'), 'utf8')).toContain('rollback');
  });

  it.each([
    { status: 'fail' as const, allowRisk: true },
    { status: 'warn' as const, allowRisk: false },
    { status: 'unverified' as const, allowRisk: false },
  ])('preserves the source for non-promoting check outcome $status', async ({ status, allowRisk }) => {
    const run = await store.startRun(sourceDir, presentation.id);
    await store.writeCandidatePresentation(run, { ...presentation, updatedAt: 101 });
    const before = readFileSync(join(sourceDir, 'presentation.json'));

    await expect(
      store.promote(run, {
        operator: 'test-operator',
        explicitConfirmation: true,
        allowRisk,
        checks: [{ name: 'required-check', status }],
      }),
    ).rejects.toBeInstanceOf(IntegrityLifecycleError);
    expect(readFileSync(join(sourceDir, 'presentation.json'))).toEqual(before);
  });
});
