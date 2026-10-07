import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { promises as fs, type Dirent } from 'fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'path';
import { StorageService } from '../../common/storage.service';
import type { Presentation } from '@noppt/core';
import { assertIntegrityEvidenceForSave } from '@noppt/audit';

export type IntegrityCheckStatus = 'pass' | 'warn' | 'fail' | 'unverified';
export type IntegrityRunState = 'candidate' | 'promoted' | 'rolled_back' | 'rollback_failed';

export interface IntegrityCheckResult {
  name: string;
  status: IntegrityCheckStatus;
  required?: boolean;
  detail?: string;
}

export interface IntegrityFileManifestEntry {
  relativePath: string;
  exists: boolean;
  size: number;
  sha256: string | null;
}

export interface IntegrityManifest {
  presentationId: string;
  sourceDir: string;
  baseHash: string;
  baseUpdatedAt: number | null;
  files: IntegrityFileManifestEntry[];
}

export interface PresentationIntegrityRun {
  runId: string;
  presentationId: string;
  sourceDir: string;
  runRoot: string;
  originalRoot: string;
  candidateRoot: string;
  previewRoot: string;
  reportRoot: string;
  hashManifestRoot: string;
  manifestPath: string;
  createdAt: number;
  baseHash: string;
  baseUpdatedAt: number | null;
  candidateHash: string | null;
  candidateUpdatedAt: number | null;
  promotedHash: string | null;
  state: IntegrityRunState;
}

export interface IntegrityPreview {
  previewId: string;
  presentationId: string;
  runId: string;
  candidateHash: string;
  artifactPath: string;
  openUrl: string;
  createdAt: number;
}

export interface IntegrityStoreOptions {
  artifactRoot?: string;
  now?: () => number;
  runIdFactory?: () => string;
  previewIdFactory?: () => string;
}

export interface IntegrityCandidateWriter {
  writeCandidatePresentation(presentation: unknown): Promise<unknown>;
}

export interface SaveSlideWithIntegrityInput {
  presentation: Presentation;
  context: {
    runId: string;
    presentationId: string;
    writePolicy: 'candidate_only' | 'active' | 'legacy_unverified';
    baseHash?: string;
    baseUpdatedAt?: number;
    snapshotRef?: string;
    activeWriteConfirmed: boolean;
  };
  evidence: unknown;
  requireVerified?: boolean;
}

export interface PromotionOptions {
  operator: string;
  explicitConfirmation: boolean;
  allowRisk?: boolean;
  checks: IntegrityCheckResult[];
}

export class IntegrityLifecycleError extends Error {
  constructor(
    public readonly code:
      | 'invalid_path'
      | 'source_missing'
      | 'source_drift'
      | 'candidate_missing'
      | 'promotion_confirmation_required'
      | 'promotion_checks_failed'
      | 'risk_confirmation_required'
      | 'invalid_state'
      | 'rollback_failed',
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'IntegrityLifecycleError';
  }
}

const DEFAULT_ARTIFACT_ROOT = resolve(
  process.cwd(),
  '.agents',
  'artifacts',
  'presentation-visual-integrity',
);
const REQUIRED_TOP_LEVEL_FILES = ['presentation.json', 'ai-log.jsonl', 'chat-history.json'];
const TRACKED_DIRECTORIES = ['assets', 'reference-attrs'];

function asForwardSlashes(value: string): string {
  return value.split(sep).join('/');
}

function isWithin(root: string, candidate: string): boolean {
  const rootPath = resolve(root);
  const candidatePath = resolve(candidate);
  const rel = relative(rootPath, candidatePath);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function assertSafeRelativePath(root: string, child: string, label: string): string {
  if (!child || isAbsolute(child)) {
    throw new IntegrityLifecycleError('invalid_path', `${label} must be a relative path`);
  }
  const resolvedChild = resolve(root, child);
  if (!isWithin(root, resolvedChild)) {
    throw new IntegrityLifecycleError('invalid_path', `${label} escapes its artifact root`);
  }
  return resolvedChild;
}

function sha256(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readFileHash(filePath: string): Promise<{ size: number; sha256: string }> {
  const content = await fs.readFile(filePath);
  return { size: content.byteLength, sha256: sha256(content) };
}

async function collectFiles(root: string, current = root): Promise<string[]> {
  if (!(await exists(current))) return [];
  const entries: Dirent[] = await fs.readdir(current, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(current, entry.name);
    if (entry.isSymbolicLink()) {
      throw new IntegrityLifecycleError('source_missing', `Symbolic links are not allowed: ${fullPath}`);
    }
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(root, fullPath)));
    } else if (entry.isFile()) {
      files.push(asForwardSlashes(relative(root, fullPath)));
    }
  }
  return files;
}

async function atomicWrite(filePath: string, content: string | Buffer): Promise<void> {
  await fs.mkdir(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.writeFile(tempPath, content);
    await fs.rename(tempPath, filePath);
  } finally {
    if (await exists(tempPath)) await fs.unlink(tempPath).catch(() => undefined);
  }
}

async function copyReadOnly(source: string, destination: string): Promise<void> {
  await fs.mkdir(dirname(destination), { recursive: true });
  await fs.copyFile(source, destination);
  // The snapshot is an evidence boundary. It is never used as a write target.
  await fs.chmod(destination, 0o444).catch(() => undefined);
}

export class IntegrityArtifactStore {
  private readonly artifactRoot: string;
  private readonly now: () => number;
  private readonly runIdFactory: () => string;
  private readonly previewIdFactory: () => string;

  constructor(options: IntegrityStoreOptions = {}) {
    this.artifactRoot = resolve(options.artifactRoot ?? DEFAULT_ARTIFACT_ROOT);
    this.now = options.now ?? (() => Date.now());
    this.runIdFactory = options.runIdFactory ?? (() => `run-${this.now()}-${Math.random().toString(36).slice(2, 10)}`);
    this.previewIdFactory =
      options.previewIdFactory ?? (() => `preview-${this.now()}-${Math.random().toString(36).slice(2, 10)}`);
  }

  getArtifactRoot(): string {
    return this.artifactRoot;
  }

  async startRun(sourceDir: string, presentationId: string): Promise<PresentationIntegrityRun> {
    const resolvedSourceDir = resolve(sourceDir);
    if (!(await exists(resolvedSourceDir))) {
      throw new IntegrityLifecycleError('source_missing', `Source presentation directory not found: ${resolvedSourceDir}`);
    }
    if (isWithin(resolvedSourceDir, this.artifactRoot)) {
      throw new IntegrityLifecycleError('invalid_path', 'Artifact root must not be inside the source presentation directory');
    }

    const presentationPath = join(resolvedSourceDir, 'presentation.json');
    if (!(await exists(presentationPath))) {
      throw new IntegrityLifecycleError('source_missing', `Missing source presentation.json: ${presentationPath}`);
    }
    const presentationBytes = await fs.readFile(presentationPath);
    this.parsePresentation(presentationBytes, presentationId);
    const runId = this.runIdFactory();
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(runId)) {
      throw new IntegrityLifecycleError('invalid_path', 'runId contains unsafe path characters');
    }

    const runRoot = assertSafeRelativePath(this.artifactRoot, runId, 'runId');
    const originalRoot = join(runRoot, 'original');
    const candidateRoot = join(runRoot, 'candidate');
    const previewRoot = join(runRoot, 'preview');
    const reportRoot = join(runRoot, 'reports');
    const hashManifestRoot = join(runRoot, 'hash-manifest');
    await Promise.all([
      fs.mkdir(originalRoot, { recursive: true }),
      fs.mkdir(candidateRoot, { recursive: true }),
      fs.mkdir(previewRoot, { recursive: true }),
      fs.mkdir(reportRoot, { recursive: true }),
      fs.mkdir(hashManifestRoot, { recursive: true }),
    ]);

    const manifest = await this.buildManifest(resolvedSourceDir, presentationId, presentationBytes);
    for (const file of manifest.files.filter((entry) => entry.exists)) {
      await copyReadOnly(join(resolvedSourceDir, file.relativePath), join(originalRoot, file.relativePath));
    }
    const manifestPath = join(hashManifestRoot, 'manifest.json');
    await atomicWrite(manifestPath, JSON.stringify(manifest, null, 2));

    const run: PresentationIntegrityRun = {
      runId,
      presentationId,
      sourceDir: resolvedSourceDir,
      runRoot,
      originalRoot,
      candidateRoot,
      previewRoot,
      reportRoot,
      hashManifestRoot,
      manifestPath,
      createdAt: this.now(),
      baseHash: manifest.baseHash,
      baseUpdatedAt: manifest.baseUpdatedAt,
      candidateHash: null,
      candidateUpdatedAt: null,
      promotedHash: null,
      state: 'candidate',
    };
    await this.persistRun(run);
    await this.appendEvent(run, {
      eventType: 'snapshot',
      status: 'pass',
      presentationId,
      runId,
      baseHash: run.baseHash,
      baseUpdatedAt: run.baseUpdatedAt,
      artifactPath: run.originalRoot,
      timestamp: run.createdAt,
    });
    return run;
  }

  async getRun(runId: string): Promise<PresentationIntegrityRun> {
    const runRoot = assertSafeRelativePath(this.artifactRoot, runId, 'runId');
    const runFile = join(runRoot, 'run.json');
    if (!(await exists(runFile))) {
      throw new IntegrityLifecycleError('source_missing', `Integrity run not found: ${runId}`);
    }
    return JSON.parse(await fs.readFile(runFile, 'utf8')) as PresentationIntegrityRun;
  }

  async writeCandidateFile(
    runOrId: PresentationIntegrityRun | string,
    relativePath: string,
    content: string | Buffer,
  ): Promise<string> {
    const run = await this.resolveRun(runOrId);
    this.assertCandidateState(run);
    const filePath = assertSafeRelativePath(run.candidateRoot, relativePath, 'candidate path');
    await atomicWrite(filePath, content);
    return filePath;
  }

  async writeCandidatePresentation(
    runOrId: PresentationIntegrityRun | string,
    presentation: unknown,
  ): Promise<PresentationIntegrityRun> {
    const run = await this.resolveRun(runOrId);
    this.assertCandidateState(run);
    const bytes = Buffer.from(JSON.stringify(presentation, null, 2), 'utf8');
    this.parsePresentation(bytes, run.presentationId);
    await this.writeCandidateFile(run, 'presentation.json', bytes);
    run.candidateHash = sha256(bytes);
    run.candidateUpdatedAt = this.readUpdatedAt(bytes);
    await this.persistRun(run);
    return run;
  }

  async createPreview(
    runOrId: PresentationIntegrityRun | string,
    metadata: Record<string, unknown> = {},
  ): Promise<IntegrityPreview> {
    const run = await this.resolveRun(runOrId);
    if (!run.candidateHash) {
      throw new IntegrityLifecycleError('candidate_missing', 'A candidate presentation is required before preview');
    }
    const candidatePath = join(run.candidateRoot, 'presentation.json');
    if (!(await exists(candidatePath))) {
      throw new IntegrityLifecycleError('candidate_missing', 'Candidate presentation.json is missing');
    }
    const previewId = this.previewIdFactory();
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(previewId)) {
      throw new IntegrityLifecycleError('invalid_path', 'previewId contains unsafe path characters');
    }
    const previewDir = assertSafeRelativePath(run.previewRoot, previewId, 'previewId');
    await fs.mkdir(previewDir, { recursive: true });
    await copyReadOnly(candidatePath, join(previewDir, 'presentation.json'));
    const preview: IntegrityPreview = {
      previewId,
      presentationId: run.presentationId,
      runId: run.runId,
      candidateHash: run.candidateHash,
      artifactPath: previewDir,
      openUrl: `/api/presentations/${encodeURIComponent(run.presentationId)}/integrity-preview/${encodeURIComponent(previewId)}`,
      createdAt: this.now(),
    };
    await atomicWrite(join(previewDir, 'preview.json'), JSON.stringify({ ...preview, ...metadata }, null, 2));
    await this.appendEvent(run, {
      eventType: 'preview',
      status: 'pass',
      presentationId: run.presentationId,
      runId: run.runId,
      candidateHash: run.candidateHash,
      previewId,
      artifactPath: previewDir,
      timestamp: preview.createdAt,
    });
    return preview;
  }

  async promote(
    runOrId: PresentationIntegrityRun | string,
    options: PromotionOptions,
  ): Promise<PresentationIntegrityRun> {
    const run = await this.resolveRun(runOrId);
    if (run.state !== 'candidate') {
      throw new IntegrityLifecycleError('invalid_state', `Cannot promote a run in state ${run.state}`);
    }
    if (!options.operator?.trim()) {
      throw new IntegrityLifecycleError('promotion_confirmation_required', 'Promotion operator is required');
    }
    if (!options.explicitConfirmation) {
      throw new IntegrityLifecycleError('promotion_confirmation_required', 'Explicit promotion confirmation is required');
    }
    const requiredChecks = options.checks.filter((check) => check.required !== false);
    if (requiredChecks.length === 0 || requiredChecks.some((check) => check.status === 'fail')) {
      throw new IntegrityLifecycleError('promotion_checks_failed', 'Promotion requires all required checks to pass', {
        checks: requiredChecks,
      });
    }
    const riskyChecks = requiredChecks.filter(
      (check) => check.status === 'warn' || check.status === 'unverified',
    );
    if (riskyChecks.length > 0 && !options.allowRisk) {
      throw new IntegrityLifecycleError(
        'risk_confirmation_required',
        'Warn or unverified checks require explicit risk confirmation',
        { checks: riskyChecks },
      );
    }
    if (!run.candidateHash) {
      throw new IntegrityLifecycleError('candidate_missing', 'Candidate presentation is missing');
    }
    const candidatePath = join(run.candidateRoot, 'presentation.json');
    const candidateBytes = await fs.readFile(candidatePath).catch(() => {
      throw new IntegrityLifecycleError('candidate_missing', 'Candidate presentation.json is missing');
    });
    if (sha256(candidateBytes) !== run.candidateHash) {
      throw new IntegrityLifecycleError('candidate_missing', 'Candidate hash changed after it was written');
    }
    this.parsePresentation(candidateBytes, run.presentationId);
    await this.assertSourceUnchanged(run);

    const targetPath = join(run.sourceDir, 'presentation.json');
    const activeOriginalPath = join(run.runRoot, 'promotion', 'active-original', 'presentation.json');
    await copyReadOnly(targetPath, activeOriginalPath);
    await atomicWrite(targetPath, candidateBytes);
    const promotedBytes = await fs.readFile(targetPath);
    if (sha256(promotedBytes) !== run.candidateHash) {
      throw new IntegrityLifecycleError('promotion_checks_failed', 'Promoted presentation hash verification failed');
    }
    run.promotedHash = run.candidateHash;
    run.state = 'promoted';
    await this.persistRun(run);
    await this.appendEvent(run, {
      eventType: 'promotion',
      status: riskyChecks.length > 0 ? 'warn' : 'pass',
      presentationId: run.presentationId,
      runId: run.runId,
      operator: options.operator,
      baseHash: run.baseHash,
      candidateHash: run.candidateHash,
      checks: options.checks,
      timestamp: this.now(),
    });
    return run;
  }

  async rollback(
    runOrId: PresentationIntegrityRun | string,
    operator: string,
  ): Promise<PresentationIntegrityRun> {
    const run = await this.resolveRun(runOrId);
    if (run.state !== 'promoted') {
      throw new IntegrityLifecycleError('invalid_state', `Cannot rollback a run in state ${run.state}`);
    }
    const targetPath = join(run.sourceDir, 'presentation.json');
    try {
      const currentBytes = await fs.readFile(targetPath);
      if (run.promotedHash && sha256(currentBytes) !== run.promotedHash) {
        throw new IntegrityLifecycleError(
          'source_drift',
          'Active presentation changed after promotion; rollback stopped',
        );
      }
      const originalPath = join(run.originalRoot, 'presentation.json');
      const originalBytes = await fs.readFile(originalPath).catch(() => {
        throw new IntegrityLifecycleError('rollback_failed', 'Original snapshot is missing');
      });
      this.parsePresentation(originalBytes, run.presentationId);
      await atomicWrite(targetPath, originalBytes);
      const restoredBytes = await fs.readFile(targetPath);
      if (sha256(restoredBytes) !== run.baseHash) {
        throw new Error('Restored presentation hash does not match the snapshot');
      }
      run.state = 'rolled_back';
      await this.persistRun(run);
      await this.appendEvent(run, {
        eventType: 'rollback',
        status: 'pass',
        presentationId: run.presentationId,
        runId: run.runId,
        operator,
        restoredHash: run.baseHash,
        timestamp: this.now(),
      });
      return run;
    } catch (error) {
      run.state = 'rollback_failed';
      await this.persistRun(run).catch(() => undefined);
      await this.appendEvent(run, {
        eventType: 'rollback',
        status: 'fail',
        presentationId: run.presentationId,
        runId: run.runId,
        operator,
        restoredHash: run.baseHash,
        errorCode: 'rollback_failed',
        timestamp: this.now(),
      }).catch(() => undefined);
      if (error instanceof IntegrityLifecycleError) throw error;
      throw new IntegrityLifecycleError('rollback_failed', 'Rollback failed; original snapshot was retained', {
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async resolveRun(runOrId: PresentationIntegrityRun | string): Promise<PresentationIntegrityRun> {
    const run = typeof runOrId === 'string' ? await this.getRun(runOrId) : runOrId;
    this.validateRunPaths(run);
    return run;
  }

  private validateRunPaths(run: PresentationIntegrityRun): void {
    const expectedRunRoot = assertSafeRelativePath(this.artifactRoot, run.runId, 'runId');
    if (resolve(run.runRoot) !== expectedRunRoot) {
      throw new IntegrityLifecycleError('invalid_path', 'Integrity run root is outside the configured artifact root');
    }
    for (const path of [run.originalRoot, run.candidateRoot, run.previewRoot, run.reportRoot, run.hashManifestRoot]) {
      if (!isWithin(expectedRunRoot, path)) {
        throw new IntegrityLifecycleError('invalid_path', 'Integrity artifact path escapes the run root');
      }
    }
    if (isWithin(resolve(run.sourceDir), this.artifactRoot)) {
      throw new IntegrityLifecycleError('invalid_path', 'Source presentation must remain outside the artifact root');
    }
  }

  private assertCandidateState(run: PresentationIntegrityRun): void {
    if (run.state !== 'candidate') {
      throw new IntegrityLifecycleError('invalid_state', `Candidate is not writable in state ${run.state}`);
    }
  }

  private parsePresentation(bytes: Buffer, presentationId: string): { id: string; updatedAt?: number; slides: unknown[] } {
    let parsed: { id?: unknown; updatedAt?: unknown; slides?: unknown };
    try {
      parsed = JSON.parse(bytes.toString('utf8')) as typeof parsed;
    } catch {
      throw new IntegrityLifecycleError('source_missing', 'presentation.json is not valid JSON');
    }
    if (parsed.id !== presentationId || !Array.isArray(parsed.slides)) {
      throw new IntegrityLifecycleError('source_missing', 'presentation.json failed identity/schema validation');
    }
    return {
      id: presentationId,
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : undefined,
      slides: parsed.slides,
    };
  }

  private readUpdatedAt(bytes: Buffer): number | null {
    const parsed = JSON.parse(bytes.toString('utf8')) as { updatedAt?: unknown };
    return typeof parsed.updatedAt === 'number' ? parsed.updatedAt : null;
  }

  private async buildManifest(
    sourceDir: string,
    presentationId: string,
    presentationBytes: Buffer,
  ): Promise<IntegrityManifest> {
    const tracked = new Set<string>(REQUIRED_TOP_LEVEL_FILES);
    for (const directory of TRACKED_DIRECTORIES) {
      for (const file of await collectFiles(sourceDir, join(sourceDir, directory))) tracked.add(file);
    }
    const files: IntegrityFileManifestEntry[] = [];
    for (const relativePath of [...tracked].sort()) {
      const sourcePath = join(sourceDir, relativePath);
      if (!(await exists(sourcePath))) {
        files.push({ relativePath, exists: false, size: 0, sha256: null });
        continue;
      }
      const stat = await fs.lstat(sourcePath);
      if (!stat.isFile()) {
        throw new IntegrityLifecycleError('source_missing', `Tracked input is not a regular file: ${sourcePath}`);
      }
      const file = relativePath === 'presentation.json' ? { size: presentationBytes.byteLength, sha256: sha256(presentationBytes) } : await readFileHash(sourcePath);
      files.push({ relativePath, exists: true, ...file });
    }
    return {
      presentationId,
      sourceDir,
      baseHash: sha256(presentationBytes),
      baseUpdatedAt: this.readUpdatedAt(presentationBytes),
      files,
    };
  }

  private async currentManifest(run: PresentationIntegrityRun): Promise<IntegrityManifest> {
    const presentationPath = join(run.sourceDir, 'presentation.json');
    const presentationBytes = await fs.readFile(presentationPath).catch(() => {
      throw new IntegrityLifecycleError('source_drift', 'Source presentation.json disappeared');
    });
    return this.buildManifest(run.sourceDir, run.presentationId, presentationBytes);
  }

  private async assertSourceUnchanged(run: PresentationIntegrityRun): Promise<void> {
    const current = await this.currentManifest(run);
    const base = JSON.parse(await fs.readFile(run.manifestPath, 'utf8')) as IntegrityManifest;
    const currentByPath = new Map(current.files.map((file) => [file.relativePath, file]));
    const drifted = base.files.some((expected) => {
      const observed = currentByPath.get(expected.relativePath);
      return !observed || observed.exists !== expected.exists || observed.sha256 !== expected.sha256;
    });
    const added = current.files.some((observed) => !base.files.some((expected) => expected.relativePath === observed.relativePath));
    if (drifted || added || current.baseHash !== run.baseHash || current.baseUpdatedAt !== run.baseUpdatedAt) {
      throw new IntegrityLifecycleError('source_drift', 'Source presentation or tracked inputs changed since snapshot', {
        baseHash: run.baseHash,
        currentHash: current.baseHash,
        baseUpdatedAt: run.baseUpdatedAt,
        currentUpdatedAt: current.baseUpdatedAt,
        drifted,
        added,
      });
    }
  }

  private async persistRun(run: PresentationIntegrityRun): Promise<void> {
    await atomicWrite(join(run.runRoot, 'run.json'), JSON.stringify(run, null, 2));
  }

  private async appendEvent(run: PresentationIntegrityRun, event: Record<string, unknown>): Promise<void> {
    const eventPath = join(run.reportRoot, 'lifecycle-events.jsonl');
    await fs.mkdir(dirname(eventPath), { recursive: true });
    await fs.appendFile(eventPath, `${JSON.stringify(event)}\n`, 'utf8');
  }
}

@Injectable()
export class PresentationIntegrityService {
  private readonly store: IntegrityArtifactStore;

  constructor(private readonly storage: StorageService) {
    this.store = new IntegrityArtifactStore();
  }

  startRun(presentationId: string): Promise<PresentationIntegrityRun> {
    return this.store.startRun(this.storage.getPresentationDir(presentationId), presentationId);
  }

  getStore(): IntegrityArtifactStore {
    return this.store;
  }

  getRun(runId: string): Promise<PresentationIntegrityRun> {
    return this.store.getRun(runId);
  }

  writeCandidatePresentation(
    runOrId: PresentationIntegrityRun | string,
    presentation: unknown,
  ): Promise<PresentationIntegrityRun> {
    return this.store.writeCandidatePresentation(runOrId, presentation);
  }

  createPreview(
    runOrId: PresentationIntegrityRun | string,
    metadata?: Record<string, unknown>,
  ): Promise<IntegrityPreview> {
    return this.store.createPreview(runOrId, metadata);
  }

  createCandidateWriter(runOrId: PresentationIntegrityRun | string): IntegrityCandidateWriter {
    return {
      writeCandidatePresentation: (presentation: unknown) =>
        this.store.writeCandidatePresentation(runOrId, presentation),
    };
  }

  async saveSlideWithIntegrity(input: SaveSlideWithIntegrityInput): Promise<PresentationIntegrityRun | Presentation> {
    const { context } = input;
    if (!context.runId || context.presentationId !== input.presentation.id || !context.snapshotRef || !context.baseHash) {
      throw new IntegrityLifecycleError('invalid_state', 'integrity_context_required: snapshot, base hash, and run context are required');
    }
    if (context.writePolicy === 'candidate_only') {
      await this.store.writeCandidatePresentation(context.runId, input.presentation);
      return this.getRun(context.runId);
    }
    if (context.writePolicy !== 'active' || !context.activeWriteConfirmed) {
      throw new IntegrityLifecycleError('promotion_confirmation_required', 'active writes require explicit confirmation');
    }
    assertIntegrityEvidenceForSave(input.evidence);
    const presentationPath = join(this.storage.getPresentationDir(input.presentation.id), 'presentation.json');
    await this.storage.writeJsonFile(presentationPath, { ...input.presentation, updatedAt: Date.now() });
    return input.presentation;
  }


  promote(runOrId: PresentationIntegrityRun | string, options: PromotionOptions): Promise<PresentationIntegrityRun> {
    return this.store.promote(runOrId, options);
  }

  rollback(runOrId: PresentationIntegrityRun | string, operator: string): Promise<PresentationIntegrityRun> {
    return this.store.rollback(runOrId, operator);
  }
}
