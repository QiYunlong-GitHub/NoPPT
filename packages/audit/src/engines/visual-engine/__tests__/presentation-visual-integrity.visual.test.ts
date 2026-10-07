import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Presentation } from '@noppt/core';
import type { PresentationPlan } from '@noppt/ai';
import { buildLayoutContext, planToDeck } from '@noppt/ai/agents/html-presentation/deck/plan-to-deck';
import { deckSlideToHtml } from '@noppt/ai/agents/html-presentation/deck/deck-to-html';
import {
  ARTIFACT_ROOT,
  PRESENTATION_ID,
  TARGET_DIR,
} from './presentation-visual-integrity.exploration';
import {
  DEFAULT_VISUAL_VIEWPORTS,
  runVisualValidation,
} from '../visual-validation';

function readTargetPresentation(): Presentation {
  return JSON.parse(
    readFileSync(join(TARGET_DIR, 'presentation.json'), 'utf8'),
  ) as Presentation;
}

function readTargetPlan(): PresentationPlan {
  const line = readFileSync(join(TARGET_DIR, 'ai-log.jsonl'), 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((item) => JSON.parse(item) as { type?: string; response?: { plan?: PresentationPlan } })
    .find((item) => item.type === 'plan');
  if (!line?.response?.plan) throw new Error('target plan record is missing from isolated input');
  return line.response.plan;
}

function buildCandidate(presentation: Presentation): Presentation {
  const plan = readTargetPlan();
  const generatedDeck = planToDeck(plan);
  const context = buildLayoutContext(plan);

  return {
    ...presentation,
    slides: presentation.slides.map((slide, index) => {
      const deck = generatedDeck.slides[index] || slide.deck;
      return {
        ...slide,
        // Validate the isolated Deck-first candidate. The target presentation is
        // read-only and is never replaced by this derived HTML.
        deck,
        html: deck ? deckSlideToHtml(deck, context) : slide.html,
      };
    }),
  };
}

describe('presentation visual integrity · Playwright fix checking', () => {
  it('validates five isolated candidate pages across viewports and reverse continuous resize', async () => {
    const presentation = readTargetPresentation();
    const candidate = buildCandidate(presentation);
    const runId = `task13-${Date.now()}`;
    const result = await runVisualValidation(candidate, {
      presentationId: PRESENTATION_ID,
      runId,
      artifactRoot: join(ARTIFACT_ROOT, runId),
      viewports: DEFAULT_VISUAL_VIEWPORTS,
      resizeSequence: [
        { width: 800, height: 600 },
        { width: 1280, height: 720 },
        { width: 1600, height: 900 },
        { width: 1280, height: 720 },
        { width: 800, height: 600 },
      ],
    });

    expect(result.pageCount).toBe(5);
    expect(result.viewportSequence).toEqual([
      '800x600',
      '1280x720',
      '1600x900',
      '1280x720',
      '800x600',
    ]);
    expect(existsSync(result.reportPath)).toBe(true);
    expect(existsSync(result.markdownReportPath)).toBe(true);

    if (result.status === 'unverified') {
      expect(result.browser.status).toBe('unverified');
      expect(result.unverified.length).toBeGreaterThan(0);
      expect(result.status).not.toBe('pass');
      return;
    }

    expect(result.browser.status).toBe('ready');
    expect(result.status).toBe('pass');
    expect(result.slides).toHaveLength(5);
    for (const slide of result.slides) {
      expect(slide.viewports).toHaveLength(DEFAULT_VISUAL_VIEWPORTS.length);
      expect(slide.resizeChecks).toHaveLength(1);
      expect(slide.metrics.every((metric) => metric.requiredClipped === 0)).toBe(true);
      expect(slide.metrics.every((metric) => metric.horizontalOverflow === false)).toBe(true);
      expect(slide.metrics.every((metric) => metric.titleOverlap === false)).toBe(true);
      expect(slide.metrics.every((metric) => metric.emptyRequiredNodes === 0)).toBe(true);
      expect(slide.metrics.every((metric) => metric.parity === 'pass')).toBe(true);
      expect(slide.metrics.every((metric) => metric.font.status !== 'failed')).toBe(true);
      expect(slide.screenshotPaths).toHaveLength(DEFAULT_VISUAL_VIEWPORTS.length);
      for (const screenshotPath of slide.screenshotPaths) {
        expect(existsSync(screenshotPath)).toBe(true);
      }
    }
  }, 120_000);
});
