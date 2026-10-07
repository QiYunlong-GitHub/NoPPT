import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FONT_METRIC_THRESHOLDS,
  classifyFontObservation,
  type FontObservation,
  type FontProfile,
} from './font-icon-check';

const profile: FontProfile = {
  declaredFamily: 'Inter',
  fallbackStack: ['Arial', 'sans-serif'],
  weight: 700,
  language: 'zh-CN',
  source: 'design-context',
};

function observation(overrides: Partial<FontObservation> = {}): FontObservation {
  return {
    fontsApiAvailable: true,
    fontCheck: true,
    resolvedFamily: 'Inter',
    resolvedWeight: 700,
    fontSize: 32,
    lineHeight: 38,
    baselineWidth: 100,
    baselineHeight: 40,
    scrollWidth: 100,
    clientWidth: 100,
    scrollHeight: 40,
    clientHeight: 40,
    ...overrides,
  };
}

describe('font state and metric validation', () => {
  it('reports a matching loaded font as resolved', () => {
    const result = classifyFontObservation(observation(), profile);

    expect(result.state).toBe('resolved');
    expect(result.weightState).toBe('matched');
    expect(result.metricStatus).toBe('ok');
    expect(result.maxMetricDelta).toBe(0);
    expect(result.fontSize).toBe(32);
    expect(result.lineHeight).toBe(38);
    expect(result.domMetrics).toMatchObject({ scrollWidth: 100, clientWidth: 100 });
  });

  it('reports a loaded fallback family explicitly instead of resolved', () => {
    const result = classifyFontObservation(
      observation({ resolvedFamily: 'Arial', fontCheck: false }),
      profile,
    );

    expect(result.state).toBe('fallback');
    expect(result.fallbackUsed).toBe(true);
    expect(result.resolvedFamily).toBe('Arial');
  });

  it('reports unavailable document.fonts as unverified', () => {
    const result = classifyFontObservation(
      observation({ fontsApiAvailable: false, fontCheck: undefined }),
      profile,
    );

    expect(result.state).toBe('unverified');
    expect(result.reason).toContain('document.fonts');
  });

  it('reports a failed font check when no usable family resolves', () => {
    const result = classifyFontObservation(
      observation({ resolvedFamily: '', fontCheck: false }),
      profile,
    );

    expect(result.state).toBe('failed');
    expect(result.fallbackUsed).toBe(false);
  });

  it('reports declared/resolved weight mismatches as failed', () => {
    const result = classifyFontObservation(observation({ resolvedWeight: 400 }), profile);

    expect(result.state).toBe('failed');
    expect(result.weightState).toBe('mismatch');
    expect(result.resolvedWeight).toBe(400);
  });

  it('never treats unknown browser font state as resolved across metric observations', () => {
    for (const delta of [0, 0.01, 0.05, 0.1, 0.25]) {
      const result = classifyFontObservation(
        observation({
          fontsApiAvailable: false,
          fontCheck: undefined,
          scrollWidth: 100 * (1 + delta),
          scrollHeight: 40 * (1 + delta),
        }),
        profile,
      );

      expect(result.state).toBe('unverified');
      expect(result.state).not.toBe('resolved');
    }
  });

  it('applies warning and failure thresholds to metric deltas', () => {
    const warning = classifyFontObservation(
      observation({ scrollWidth: 106, scrollHeight: 42 }),
      profile,
    );
    const failure = classifyFontObservation(
      observation({ scrollWidth: 111, scrollHeight: 45 }),
      profile,
    );

    expect(DEFAULT_FONT_METRIC_THRESHOLDS).toEqual({ warning: 0.05, failure: 0.1 });
    expect(warning.metricStatus).toBe('warn');
    expect(warning.state).toBe('resolved');
    expect(failure.metricStatus).toBe('fail');
    expect(failure.state).toBe('failed');
    expect(failure.maxMetricDelta).toBeGreaterThan(DEFAULT_FONT_METRIC_THRESHOLDS.failure);
  });
});
