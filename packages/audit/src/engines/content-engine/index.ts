import type { Page } from 'playwright-core';
import { collectRequiredContent, normalizeSlideContent } from '@noppt/ai';
import type { AuditContext, AuditEngineResult, AuditIssue } from '../../types';
import type { ContentEngineOptions } from './types';
import { runLlmCritique } from './llm-critique-adapter';
import { runAccessibilityCheck } from './accessibility-check';
import { validateOutline } from './outline-validator';
import { validateKeyPoints } from './key-points-validator';
import { checkContentDensity } from './content-density';
import { compareContentCollections, compareContentParity, collectDeckContentManifest, collectHtmlContentManifest } from './compare-content';
import { extractPlainText } from './html-text-utils';

function isPage(obj: unknown): obj is Page {
  return Boolean(
    obj &&
    typeof obj === 'object' &&
    typeof (obj as { goto?: unknown }).goto === 'function' &&
    typeof (obj as { evaluate?: unknown }).evaluate === 'function',
  );
}

interface RenderSlideRenderer {
  renderSlide(html: string): Promise<Page>;
}

function hasRenderSlide(obj: unknown): obj is RenderSlideRenderer {
  return Boolean(
    obj &&
    typeof obj === 'object' &&
    typeof (obj as { renderSlide?: unknown }).renderSlide === 'function',
  );
}

function hasPage(obj: unknown): obj is { page: Page } {
  return Boolean(obj && typeof obj === 'object' && isPage((obj as { page?: unknown }).page));
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

function auditMetricCompleteness(
  slides: Array<{ html: string }>,
  plan: NonNullable<AuditContext['plan']>,
): AuditIssue[] {
  const issues: AuditIssue[] = [];
  for (let slideIndex = 0; slideIndex < slides.length; slideIndex += 1) {
    const slidePlan = plan.slides?.[slideIndex];
    if (slidePlan?.pageType !== 'content-stats-highlight') continue;
    const content = normalizeSlideContent(slidePlan, slideIndex);
    const plainText = extractPlainText(slides[slideIndex].html);
    for (const item of content.metricItems) {
      const expectedText = item.kind === 'metric'
        ? `${item.value} ${item.label}`.trim()
        : item.originalText;
      const observedText = plainText.includes(item.kind === 'metric' ? item.value : item.originalText)
        ? plainText
        : '';
      const identityPresent = slides[slideIndex].html.includes(`data-content-id="${item.contentId}"`) || slides[slideIndex].html.includes(`data-content-id='${item.contentId}'`);
      const valuePresent = item.kind === 'omission' || (Boolean(item.value) && plainText.includes(item.value));
      const labelPresent = item.kind === 'omission' || (Boolean(item.label) && plainText.includes(item.label));
      const accountedFor = item.kind === 'omission'
        ? identityPresent || plainText.includes(item.originalText)
        : identityPresent && valuePresent && labelPresent;
      if (accountedFor) continue;
      issues.push({
        ruleId: 'metric-content-completeness',
        severity: 'error',
        engine: 'content',
        slideIndex,
        message: `指标 ${item.contentId} 未完整呈现值、标签或稳定内容身份`,
        fixSuggestion: '为每个指标输出非空 value/label，或输出带原因的 omission 节点，并保留 data-content-id',
        fixable: false,
        metadata: {
          contentId: item.contentId,
          expectedText,
          observedText,
          coverage: valuePresent && labelPresent ? 1 : 0,
          omissionReason: item.kind === 'omission' ? item.reason : identityPresent ? 'metric_text_missing' : 'metric_identity_missing',
        },
      });
    }
  }
  return issues;
}

function planContentManifest(slidePlan: NonNullable<AuditContext['plan']>['slides'][number], slideIndex: number) {
  const content = normalizeSlideContent(slidePlan, slideIndex);
  const required = collectRequiredContent(content);
  const comparisons = new Map(content.comparisonItems.map((item) => [item.contentId, item]));
  return required.map((item) => {
    const comparison = comparisons.get(item.contentId);
    return {
      contentId: item.contentId,
      text: item.text,
      role: item.role,
      order: comparison?.order ?? item.sourceIndex,
      ownership: comparison?.column,
      required: true,
    };
  });
}

function parityIssuesToAudit(
  slideIndex: number,
  parity: ReturnType<typeof compareContentCollections>,
): AuditIssue[] {
  return parity.issues.map((issue) => ({
    ruleId: `content-parity-${issue.code}`,
    severity: 'error' as const,
    engine: 'content' as const,
    slideIndex,
    message: issue.message,
    fixSuggestion: '保持计划、Deck 和 HTML 共享 contentId、文本、顺序、角色和归属；装饰节点不参与必需内容比较',
    fixable: false,
    metadata: {
      contentId: issue.contentId ?? `${issue.source}-content-manifest`,
      source: issue.source,
      expectedText: issue.expected,
      observedText: issue.observed,
      expectedSummary: issue.expected,
      observedSummary: issue.observed,
      coverage: issue.code === 'text_mismatch' || issue.code === 'missing_content' ? 0 : 1,
      omissionReason: issue.code === 'missing_content' ? 'silent_drop' : issue.code,
    },
  }));
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
      issues.push(...auditMetricCompleteness(slides, plan));
      for (let i = 0; i < slides.length; i++) {
        const slidePlan = plan.slides?.[i];
        if (!slidePlan) continue;
        const deckSlide = slides[i].deck;
        const planManifest = planContentManifest(slidePlan, i);
        const deckManifest = deckSlide ? collectDeckContentManifest(deckSlide) : [];
        const htmlManifest = collectHtmlContentManifest(slides[i].html);
        if (planManifest.length > 0) {
          const parity = compareContentCollections({ plan: planManifest, deck: deckManifest, html: htmlManifest });
          issues.push(...parityIssuesToAudit(i, parity));
        }

        if (slidePlan.pageType !== 'content-compare' || !deckSlide) continue;
        if (!Array.isArray(slidePlan.comparisonItems)) {
          issues.push({
            ruleId: 'compare-parity-legacy-derived',
            severity: 'warn',
            engine: 'content',
            slideIndex: i,
            message: '对比页缺少 typed comparisonItems，列归属只能按历史 keyPoints 适配，parity 需要复核',
            fixSuggestion: '在计划中提供带 contentId、column、order、bullet 的 comparisonItems 或显式 legacyColumnManifest',
            fixable: false,
            metadata: { legacyDerived: true, warning: 'compare_column_ownership_unverified' },
          });
          continue;
        }
        const parity = compareContentParity({ items: slidePlan.comparisonItems, slide: deckSlide, html: slides[i].html });
        issues.push(...parity.issues.map((issue) => ({
          ruleId: `compare-parity-${issue.code}`,
          severity: 'error' as const,
          engine: 'content' as const,
          slideIndex: i,
          message: issue.message,
          fixSuggestion: '使 Deck 与 canonical HTML 共享同一 contentId、column、order、bullet 和矩形语义',
          fixable: false,
          metadata: {
            contentId: issue.contentId,
            expectedText: issue.expected,
            observedText: issue.observed,
            parityStatus: parity.status,
            parityWarnings: parity.warnings,
          },
        })));
      }
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
          // Accessibility is best-effort when a renderer cannot create a page.
        } finally {
          if (page) {
            try {
              await page.close();
            } catch {
              // Ignore close failures after an already failed accessibility probe.
            }
          }
        }
      }
      return;
    }

    const sharedPage: Page | undefined = isPage(renderer)
      ? renderer
      : hasPage(renderer)
        ? renderer.page
        : undefined;

    if (!sharedPage) return;

    for (let i = 0; i < slides.length; i++) {
      try {
        await sharedPage.setContent(slides[i].html, { waitUntil: 'networkidle' });
        const a11yIssues = await runAccessibilityCheck(sharedPage, i);
        issues.push(...a11yIssues);
      } catch {
        // Shared-page accessibility is best-effort and must not abort content checks.
      }
    }
  }
}

export { compareContentParity } from './compare-content';
export type { CompareParityIssue, CompareParityResult, CompareParityIssueCode } from './compare-content';