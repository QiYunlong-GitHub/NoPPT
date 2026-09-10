import type { Presentation } from '@noppt/core';
import type { PresentationPlan, ReferenceContext } from '@noppt/ai';

export type AuditSeverity = 'error' | 'warn' | 'info' | 'off';
export type AuditEngineType = 'layout' | 'visual' | 'content' | 'fidelity' | 'sanitization';
export type AuditResultStatus = 'passed' | 'warn' | 'fail' | 'error';
export type OverallResult = 'pass' | 'warn' | 'fail';

export interface AuditIssue {
  ruleId: string;
  severity: AuditSeverity;
  engine: AuditEngineType;
  slideIndex: number;
  selector?: string;
  message: string;
  fixSuggestion?: string;
  fixable: boolean;
  metadata?: Record<string, any>;
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
  raw?: any;
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
  renderer?: any;
  tempDir?: string;
  designContext?: {
    style: string;
    primaryColor: string;
    fontFamily: string;
    iconStyle: string;
  };
  referenceContext?: ReferenceContext;
}
