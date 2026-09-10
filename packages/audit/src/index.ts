export * from './types';
export * from './config/default-config';
export { AuditEngine } from './engine/audit-engine';
export { LayoutAuditEngine } from './engines/layout-engine';
export * from './engines/layout-engine/types';
export { VisualAuditEngine } from './engines/visual-engine';
export type { PerSlideVisualMetrics } from './engines/visual-engine';
export { SlideRenderer } from './engines/visual-engine/slide-renderer';
export { runVlmCritique } from './engines/visual-engine/vlm-critique';
export type {
  VlmReviewResult,
  VlmRootCause,
  VlmCritiqueMode,
} from './engines/visual-engine/vlm-critique';
export * from './engines/visual-engine/metrics';
export { ContentAuditEngine } from './engines/content-engine';
export * from './engines/content-engine/types';
export { FidelityAuditEngine } from './engines/fidelity-engine';
export * from './engines/fidelity-engine/types';
export { AutoFixer } from './fix/auto-fixer';
export { ResolutionStrategy } from './fix/resolution-strategy';
export { FeedbackBuilder } from './fix/feedback-builder';
export type { FixResult, ResolutionDecision, ResolutionAction } from './fix/resolution-strategy';
