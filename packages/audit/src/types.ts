import type { Presentation } from '@noppt/core';
import type { PresentationPlan, ReferenceContext } from '@noppt/ai';

export type AuditSeverity = 'error' | 'warn' | 'info' | 'off';
export type AuditEngineType = 'layout' | 'visual' | 'content' | 'fidelity' | 'sanitization';
export type AuditResultStatus = 'passed' | 'warn' | 'fail' | 'error';
export type OverallResult = 'pass' | 'warn' | 'fail';
export type IntegrityStatus = 'pass' | 'warn' | 'fail' | 'unverified' | 'needs_review';

export interface IntegrityEvidence {
  eventType: 'render' | 'visual_validation' | 'audit' | 'fix';
  presentationId: string;
  slideIndex: number;
  runId: string;
  phase: 'candidate' | 'preview' | 'promotion' | 'rollback';
  source: 'plan' | 'deck' | 'canonical-html' | 'editor' | 'html-fallback' | 'unknown';
  pageType?: string;
  viewport: { width: number; height: number; profile?: string };
  logicalCanvas: { width: number; height: number };
  expected: Record<string, unknown>;
  observed: Record<string, unknown>;
  emptyRequiredNodes: number;
  outOfBoundsNodes: number;
  clippedNodes: number;
  parity: 'pass' | 'fail' | 'unverified';
  font: Record<string, unknown>;
  status: IntegrityStatus;
  fixAction?: string | null;
  artifactPath?: string | null;
  durationMs: number;
  errorCode?: string | null;
}

export interface IntegritySlideResult {
  presentationId: string;
  slideIndex: number;
  runId: string;
  status: IntegrityStatus;
  events: IntegrityEvidence[];
}

export interface IntegrityReport {
  runId: string;
  presentationId: string;
  status: IntegrityStatus;
  perSlide: IntegritySlideResult[];
  events: IntegrityEvidence[];
}

export interface AuditIssue {
  ruleId: string;
  severity: AuditSeverity;
  engine: AuditEngineType;
  slideIndex: number;
  selector?: string;
  message: string;
  fixSuggestion?: string;
  fixable: boolean;
  metadata?: Record<string, unknown>;
}

export interface AuditRule {
  id: string;
  engine: AuditEngineType;
  description: string;
  defaultSeverity: AuditSeverity;
  fixable: boolean;
}

export interface AuditEngineResult {
  engine: AuditEngineType;
  engineName: string;
  status: AuditResultStatus;
  score: number;
  issues: AuditIssue[];
  durationMs: number;
  raw?: Record<string, unknown>;
}

export interface ScreenshotInfo {
  slideIndex: number;
  path: string;
  width: number;
  height: number;
}

export interface FixSummary {
  fixedCount: number;
  failedCount: number;
  fixedRuleIds: string[];
  failedRuleIds: string[];
}

export interface AuditReportMetadata {
  auditId: string;
  timestamp: string;
  engineVersion: string;
  config: AuditConfig;
  presentationTitle: string;
  slideCount: number;
}

export interface AuditReport {
  metadata: AuditReportMetadata;
  overallScore: number;
  overallResult: OverallResult;
  engineResults: AuditEngineResult[];
  issues: AuditIssue[];
  screenshots: ScreenshotInfo[];
  fixSummary?: FixSummary;
  regenerationRequired: boolean;
  feedbackPrompt?: string;
  integrity?: IntegrityReport;
}

export interface EngineWeights {
  layout: number;
  visual: number;
  content: number;
  fidelity: number;
  sanitization: number;
}

export interface AuditThresholds {
  pass: number;
  warn: number;
}

export interface AuditViewport {
  width: number;
  height: number;
}

export interface AuditConfig {
  engines: {
    layout: boolean;
    visual: boolean;
    content: boolean;
    fidelity: boolean;
    sanitization: boolean;
  };
  rules?: Record<string, AuditSeverity>;
  weights: EngineWeights;
  thresholds: AuditThresholds;
  autoFix: boolean;
  maxRegenerationRetries: number;
  viewport: AuditViewport;
  contentDensity?: {
    maxCharsPerSlide?: number;
    minBulletPointsPerCard?: number;
    maxBulletPointsPerCard?: number;
  };
  strictness?: 'strict' | 'normal' | 'relaxed';
}

export interface AuditContext {
  presentation: Presentation;
  plan?: PresentationPlan;
  config: AuditConfig;
  renderer?: unknown;
  tempDir?: string;
  runId?: string;
  phase?: IntegrityEvidence['phase'];
  source?: IntegrityEvidence['source'];
  designContext?: {
    style: string;
    primaryColor: string;
    fontFamily: string;
    iconStyle: string;
  };
  referenceContext?: ReferenceContext;
}

/** Public contract implemented by every registered audit engine. */
export interface AuditEngineContract {
  audit(context: AuditContext): Promise<AuditEngineResult>;
  auditOutline?(context: AuditContext): Promise<AuditEngineResult>;
  destroy?(): Promise<void> | void;
}
