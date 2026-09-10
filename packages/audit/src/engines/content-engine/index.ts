import type { Page } from 'playwright-core';
import type {
  AuditContext,
  AuditEngineResult,
  AuditIssue,
} from '../../types';
import type { ContentEngineOptions } from './types';
import { runLlmCritique } from './llm-critique-adapter';
import { runAccessibilityCheck } from './accessibility-check';
import { validateOutline } from './outline-validator';
import { validateKeyPoints } from './key-points-validator';
import { checkContentDensity } from './content-density';

function isPage(obj: any): obj is Page {
  return obj && typeof obj.goto === 'function' && typeof obj.evaluate === 'function';
}

function hasRenderSlide(obj: any): boolean {
  return obj && typeof obj.renderSlide === 'function';
}

function computeScore(baseScore: number, issues: AuditIssue[]): number {
  let score = baseScore;
  for (const issue of issues) {
    if (issue.severity === 'error') score -= 15;
    else if (issue.severity === 'warn') score -= 5;
  }
  return Math.max(0, Math.round(score));
}

function determineStatus(score: number, issues: AuditIssue[]): AuditEngineResult['status'] {
  const errorCount = issues.filter((i) => i.severity === 'error').length;
  const warnCount = issues.filter((i) => i.severity === 'warn').length;
  if (errorCount > 0) return 'fail';
  if (warnCount > 0 || score < 80) return 'warn';
  return 'passed';
}

export class ContentAuditEngine {
  private options: ContentEngineOptions;

  constructor(options: ContentEngineOptions = {}) {
    this.options = options;
  }

  async audit(context: AuditContext): Promise<AuditEngineResult> {
    const startTime = Date.now();
    const issues: AuditIssue[] = [];
    const slides = context.presentation.slides;
    const plan = context.plan;
    const densityConfig = context.config.contentDensity || {};

    if (plan) {
      issues.push(...validateOutline(plan));
    }

    let llmScores: number[] = [];
    if (this.options.provider) {
      const effectiveOptions = context.designContext
        ? { ...this.options, designContext: context.designContext }
        : this.options;
      const llmResult = await runLlmCritique(slides, plan, effectiveOptions);
      issues.push(...llmResult.issues);
      llmScores = llmResult.scores;
    }

    for (let i = 0; i < slides.length; i++) {
      const slideIssues = checkContentDensity(slides[i].html, i, densityConfig);
      issues.push(...slideIssues);
    }

    if (plan) {
      issues.push(...validateKeyPoints(slides, plan));
    }

    await this.runAccessibility(context, slides, issues);

    let baseScore: number;
    if (llmScores.length > 0) {
      baseScore = llmScores.reduce((a, b) => a + b, 0) / llmScores.length;
    } else {
      baseScore = 100;
    }

    const score = computeScore(baseScore, issues);
    const status = determineStatus(score, issues);

    return {
      engine: 'content',
      engineName: 'Content Quality Audit Engine',
      status,
      score,
      issues,
      durationMs: Date.now() - startTime,
      raw: {
        llmScores,
        baseScore,
        slideCount: slides.length,
        hasPlan: !!plan,
        hasProvider: !!this.options.provider,
      },
    };
  }

  async auditOutline(context: AuditContext): Promise<AuditEngineResult> {
    const startTime = Date.now();
    const issues: AuditIssue[] = [];

    if (context.plan) {
      issues.push(...validateOutline(context.plan));
    }

    const score = computeScore(100, issues);
    const status = determineStatus(score, issues);

    return {
      engine: 'content',
      engineName: 'Content Quality Audit Engine',
      status,
      score,
      issues,
      durationMs: Date.now() - startTime,
      raw: { outlineOnly: true, slideCount: context.plan?.slides.length || 0 },
    };
  }

  private async runAccessibility(
    context: AuditContext,
    slides: Array<{ html: string }>,
    issues: AuditIssue[],
  ): Promise<void> {
    const renderer = context.renderer;
    if (!renderer) return;

    if (hasRenderSlide(renderer)) {
      for (let i = 0; i < slides.length; i++) {
        let page: Page | null = null;
        try {
          const renderedPage: Page = await renderer.renderSlide(slides[i].html);
          page = renderedPage;
          const a11yIssues = await runAccessibilityCheck(renderedPage, i);
          issues.push(...a11yIssues);
        } catch {
        } finally {
          if (page) {
            try { await page.close(); } catch {}
          }
        }
      }
      return;
    }

    const sharedPage: Page | undefined = isPage(renderer)
      ? renderer
      : (isPage(renderer.page) ? renderer.page : undefined);

    if (!sharedPage) return;

    for (let i = 0; i < slides.length; i++) {
      try {
        await sharedPage.setContent(slides[i].html, { waitUntil: 'networkidle' });
        const a11yIssues = await runAccessibilityCheck(sharedPage, i);
        issues.push(...a11yIssues);
      } catch {
      }
    }
  }
}
