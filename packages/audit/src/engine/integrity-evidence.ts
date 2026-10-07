import type { PresentationPlan } from '@noppt/ai';
import { collectRequiredContent, normalizeSlideContent } from '@noppt/ai';
import type {
  AuditEngineResult,
  AuditIssue,
  AuditReport,
  AuditContext,
  IntegrityEvidence,
  IntegrityReport,
  IntegrityStatus,
} from '../types';
import { collectHtmlContentManifest } from '../engines/content-engine/compare-content';

function issueCode(issue: AuditIssue): string | undefined {
  const metadataCode = issue.metadata?.code;
  if (typeof metadataCode === 'string') return metadataCode;
  if (issue.ruleId === 'no-required-content-clipping') return 'required_clipped';
  if (issue.ruleId === 'logical-canvas-boundary') return 'geometry_out_of_bounds';
  if (issue.ruleId === 'no-empty-required-text') return 'empty_required_node';
  if (issue.ruleId === 'no-fixed-nested-canvas') return 'fixed_nested_canvas';
  if (issue.ruleId.startsWith('content-parity-') || issue.ruleId.startsWith('compare-parity-')) return 'parity_mismatch';
  if (issue.ruleId.startsWith('font-metric')) return 'font_metric_exceeded';
  return undefined;
}

function statusFromIssues(issues: AuditIssue[]): IntegrityStatus {
  if (issues.some((issue) => issue.severity === 'error')) return 'fail';
  if (issues.some((issue) => issue.severity === 'warn')) return 'warn';
  return 'pass';
}

function visualEvidence(results: AuditEngineResult[], slideIndex: number): { status: IntegrityStatus; font: Record<string, unknown>; artifactPath?: string } {
  const visual = results.find((result) => result.engine === 'visual');
  const perSlide = (visual?.raw?.perSlide as Array<Record<string, unknown>> | undefined)?.find(
    (slide) => slide.slideIndex === slideIndex,
  );
  const font = (perSlide?.fonts as Record<string, unknown> | undefined) ??
    ((visual?.raw?.fontEvidence as Array<Record<string, unknown>> | undefined)?.find((slide) => slide.slideIndex === slideIndex) ?? {});
  const screenshotPath = typeof perSlide?.screenshotPath === 'string' ? perSlide.screenshotPath : undefined;
  const validation = visual?.raw?.visualValidation as { status?: string; reportPath?: string; slides?: Array<{ slideIndex?: number; status?: string; screenshotPaths?: string[] }> } | undefined;
  const validationSlide = validation?.slides?.find((slide) => slide.slideIndex === slideIndex);
  const validationArtifact = validationSlide?.screenshotPaths?.[0] || validation?.reportPath || screenshotPath;
  if (!visual) return { status: 'unverified', font: { state: 'unverified', reason: 'visual_engine_not_enabled' }, artifactPath: validationArtifact };
  if (visual.status === 'error' || visual.raw?.error || visual.issues.some((issue) => issue.ruleId === 'visual-renderer-unavailable')) {
    return { status: 'unverified', font: { state: 'unverified', reason: visual.raw?.error ?? 'visual_renderer_unavailable' }, artifactPath: validationArtifact };
  }
  if (validation?.status === 'unverified' || validationSlide?.status === 'unverified') {
    return { status: 'unverified', font, artifactPath: validationArtifact };
  }
  if (validationSlide?.status === 'fail') return { status: 'fail', font, artifactPath: validationArtifact };
  const fontState = font.state;
  if (fontState === 'unverified') return { status: 'unverified', font, artifactPath: validationArtifact };
  if (fontState === 'failed') return { status: 'fail', font, artifactPath: validationArtifact };
  return { status: 'pass', font, artifactPath: validationArtifact };
}

function profile(width: number): string {
  return width < 1000 ? 'narrow' : width > 1400 ? 'wide' : 'standard';
}

function pageExpected(plan: PresentationPlan | undefined, slideIndex: number): Record<string, unknown> {
  const slidePlan = plan?.slides?.[slideIndex];
  if (!slidePlan) return { content: 0 };
  const normalized = normalizeSlideContent(slidePlan, slideIndex);
  return { content: collectRequiredContent(normalized).length };
}

function pageObserved(html: string): Record<string, unknown> {
  return { content: collectHtmlContentManifest(html).filter((item) => item.required !== false && !item.decoration).length };
}

export function buildIntegrityReport(
  context: AuditContext,
  results: AuditEngineResult[],
  issues: AuditIssue[],
  fixSummary?: AuditReport['fixSummary'],
): IntegrityReport {
  const runId = context.runId ?? `audit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const presentationId = context.presentation.id;
  const viewport = context.config.viewport ?? { width: 1280, height: 720 };
  const visual = results.find((result) => result.engine === 'visual');
  const perSlide: IntegrityReport['perSlide'] = [];
  const events: IntegrityEvidence[] = [];

  for (let slideIndex = 0; slideIndex < context.presentation.slides.length; slideIndex += 1) {
    const slideIssues = issues.filter((issue) => issue.slideIndex === slideIndex);
    const codes = slideIssues.map(issueCode).filter((code): code is string => Boolean(code));
    const visualState = visualEvidence(results, slideIndex);
    const hasMissingVisualEvidence = !visual || visualState.status === 'unverified';
    const auditStatus = statusFromIssues(slideIssues);
    const status: IntegrityStatus = auditStatus === 'fail'
      ? 'fail'
      : hasMissingVisualEvidence
        ? 'unverified'
        : auditStatus;
    const emptyRequiredNodes = codes.filter((code) => code === 'empty_required_node').length;
    const outOfBoundsNodes = codes.filter((code) => code === 'geometry_out_of_bounds').length;
    const clippedNodes = codes.filter((code) => code === 'required_clipped').length;
    const parity = codes.includes('parity_mismatch') ? 'fail' : visual ? 'pass' : 'unverified';
    const expected = pageExpected(context.plan, slideIndex);
    const observed = pageObserved(context.presentation.slides[slideIndex].html);
    const pageType = context.plan?.slides?.[slideIndex]?.pageType ?? (context.presentation.slides[slideIndex] as unknown as { pageType?: string }).pageType;
    const common = {
      presentationId,
      slideIndex,
      runId,
      phase: context.phase ?? 'candidate',
      source: context.source ?? 'deck',
      pageType,
      viewport: { ...viewport, profile: profile(viewport.width) },
      logicalCanvas: { width: 1280, height: 720 },
      expected,
      observed,
      emptyRequiredNodes,
      outOfBoundsNodes,
      clippedNodes,
      parity: parity as 'pass' | 'fail' | 'unverified',
      font: visualState.font,
      artifactPath: visualState.artifactPath ?? null,
      durationMs: 0,
      errorCode: codes[0] ?? (hasMissingVisualEvidence ? 'visual_evidence_unverified' : null),
    } satisfies Omit<IntegrityEvidence, 'eventType' | 'status' | 'fixAction'>;
    const slideEvents: IntegrityEvidence[] = [
      { ...common, eventType: 'render', status: visualState.status, fixAction: null },
      { ...common, eventType: 'visual_validation', status: visualState.status, fixAction: null },
      { ...common, eventType: 'audit', status, fixAction: null },
      {
        ...common,
        eventType: 'fix',
        status,
        fixAction: fixSummary?.fixedRuleIds.join(',') || null,
      },
    ];
    perSlide.push({ presentationId, slideIndex, runId, status, events: slideEvents });
    events.push(...slideEvents);
  }

  const overallStatus: IntegrityStatus = perSlide.some((slide) => slide.status === 'fail')
    ? 'fail'
    : perSlide.some((slide) => slide.status === 'unverified' || slide.status === 'needs_review')
      ? 'needs_review'
      : perSlide.some((slide) => slide.status === 'warn')
        ? 'warn'
        : 'pass';
  return { runId, presentationId, status: overallStatus, perSlide, events };
}

export interface IntegritySavePolicy {
  requireVerified?: boolean;
  operation?: 'save' | 'export' | 'promotion';
}

export function assertIntegrityEvidenceForSave(
  report: unknown,
  policy: IntegritySavePolicy = { requireVerified: true, operation: 'save' },
): void {
  const integrity = (report as { integrity?: IntegrityReport } | null)?.integrity;
  if (!integrity || !integrity.runId || !integrity.presentationId || !Array.isArray(integrity.perSlide) || !Array.isArray(integrity.events) || integrity.perSlide.length === 0 || integrity.events.length === 0) {
    throw new Error('integrity_context_required: integrity evidence is missing; save is blocked');
  }
  const requireVerified = policy.requireVerified !== false;
  const blockingStatuses = new Set<IntegrityStatus>(['fail', 'needs_review', 'unverified']);
  if (requireVerified && blockingStatuses.has(integrity.status)) {
    throw new Error(`integrity_${integrity.status}: verified ${policy.operation ?? 'save'} is blocked`);
  }
  if (requireVerified && integrity.status !== 'pass') {
    throw new Error(`integrity_status_invalid: verified ${policy.operation ?? 'save'} requires pass evidence`);
  }
  const expectedEvents = new Set<IntegrityEvidence['eventType']>(['render', 'visual_validation', 'audit', 'fix']);
  const bySlide = new Map<number, Set<IntegrityEvidence['eventType']>>();
  for (const event of integrity.events) {
    if (!expectedEvents.has(event.eventType)) continue;
    const seen = bySlide.get(event.slideIndex) ?? new Set<IntegrityEvidence['eventType']>();
    seen.add(event.eventType);
    bySlide.set(event.slideIndex, seen);
    if (requireVerified && event.status !== 'pass') throw new Error(`integrity_event_${event.status}: verified operation is blocked`);
  }
  for (const slide of integrity.perSlide) {
    const seen = bySlide.get(slide.slideIndex);
    if (!seen || [...expectedEvents].some((eventType) => !seen.has(eventType))) throw new Error(`integrity_evidence_incomplete: slide ${slide.slideIndex + 1} lacks required evidence events`);
    if (requireVerified && slide.status !== 'pass') throw new Error(`integrity_slide_${slide.status}: verified operation is blocked`);
  }
}
