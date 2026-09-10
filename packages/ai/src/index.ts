export * from './types';
export * from './providers';
// NOTE: agents/index.ts → html-presentation-agent.ts exports hexToHsl/hueDelta already via module-level.
// Avoid duplicate export: `export * from './agents'` happens *before* utils re-exports, so we need to
// NOT re-export hexToHsl/hueDelta via utils (they exist in utils AND in html-presentation-agent).
// Solution: skip the names that cause TS2308 ambiguity — agents re-exports are the canonical ones.
// But for resolveEffectivePrimaryColor/COLOR_THEMES/darkenColor/assertHueClose they are only in agents,
// and we export them explicitly below. For style-violation-signal (hexToHsl/hueDeltaDeg local copies),
// we don't re-export hexToHsl/hueDeltaDeg (only StyleViolationBreakdown interface + named functions).
export * from './agents';
export * from './templates';
export * from './utils/logger';
export * from './utils/model-name-parser';
export * from './utils/llm-tracer';
export {
  styleViolationSignal,
  exceedsThreshold,
  collectStyleViolationSamples,
  formatStyleViolationSamplesSummary,
  countPxSticky,
  STYLE_VIOLATION_THRESHOLDS,
  styleViolationSignalLegacy,
  detectBlackBlockTitle,
  type StyleViolationBreakdown,
  type StyleViolationSamples,
} from './utils/style-violation-signal';
export { resolveReferenceComposition } from './utils/reference-attribute-resolver';
export {
  resolveEffectivePrimaryColor,
  resolveProposalPrimaryColor,
  COLOR_THEMES,
  darkenColor,
  assertHueClose,
} from './agents/html-presentation-agent';

// Task 2/3：参考属性提取与解析（供 server 侧 ai.service 注入）
export { extractReferenceHtmlAttributes } from './utils/reference-html-extractor';
export { countStyleRules } from './utils/reference-style-cascade';
export { extractReferenceImageAttributes, type VlmTextProvider } from './utils/vlm-attribute-extraction';
export {
  mergeReferenceAttrs,
  assembleReferenceVisualAttributes,
  resolveReferencePrimaryColor,
  resolveDeckReferencePrimaryColor,
  resolveFinalPagePrimaryColor,
  getReferencePaletteForPage,
} from './utils/reference-attribute-resolver';
export { applyMasterLogoSources, applyReferenceImageUrlSources } from './utils/reference-logo-src';
