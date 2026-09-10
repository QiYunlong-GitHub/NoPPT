import type { AuditConfig } from '../types';

export const DEFAULT_AUDIT_CONFIG: AuditConfig = {
  engines: {
    layout: true,
    visual: true,
    content: true,
    fidelity: true,
    sanitization: true,
  },
  weights: {
    layout: 0.25,
    visual: 0.25,
    content: 0.30,
    fidelity: 0.15,
    sanitization: 0.05,
  },
  thresholds: {
    pass: 70,
    warn: 50,
  },
  autoFix: true,
  maxRegenerationRetries: 1,
  viewport: {
    width: 1280,
    height: 720,
  },
  contentDensity: {
    maxCharsPerSlide: 800,
    minBulletPointsPerCard: 2,
    maxBulletPointsPerCard: 3,
  },
  strictness: 'normal',
};

export const STRICT_CONFIG_PRESET: Partial<AuditConfig> = {
  thresholds: { pass: 80, warn: 60 },
  strictness: 'strict',
};

export const RELAXED_CONFIG_PRESET: Partial<AuditConfig> = {
  thresholds: { pass: 50, warn: 30 },
  strictness: 'relaxed',
};

export function mergeConfig(base: AuditConfig, override?: Partial<AuditConfig>): AuditConfig {
  if (!override) return {
    ...base,
    engines: { ...base.engines },
    weights: { ...base.weights },
    thresholds: { ...base.thresholds },
    viewport: { ...base.viewport },
  };
  return {
    ...base,
    ...override,
    engines: { ...base.engines, ...(override.engines || {}) },
    weights: { ...base.weights, ...(override.weights || {}) },
    thresholds: { ...base.thresholds, ...(override.thresholds || {}) },
    viewport: { ...base.viewport, ...(override.viewport || {}) },
    contentDensity: { ...(base.contentDensity || {}), ...(override.contentDensity || {}) },
    rules: { ...(base.rules || {}), ...(override.rules || {}) },
  };
}

export function getConfigPreset(strictness: 'strict' | 'normal' | 'relaxed'): Partial<AuditConfig> {
  switch (strictness) {
    case 'strict':
      return STRICT_CONFIG_PRESET;
    case 'relaxed':
      return RELAXED_CONFIG_PRESET;
    default:
      return {};
  }
}
