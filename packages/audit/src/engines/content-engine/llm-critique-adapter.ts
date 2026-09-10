import { critiqueSlide } from '@noppt/ai/templates';
import type { PresentationPlan } from '@noppt/ai';
import type { Slide } from '@noppt/core';
import type { AuditIssue } from '../../types';
import type { ContentEngineOptions } from './types';

const DEFAULT_DESIGN_CONTEXT = {
  style: 'business',
  primaryColor: '#2563eb',
  fontFamily: 'sans',
  iconStyle: 'line',
};

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^\w\u4e00-\u9fff-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function mapSeverity(severity: 'fatal' | 'important' | 'minor'): AuditIssue['severity'] {
  if (severity === 'fatal') return 'error';
  if (severity === 'important') return 'warn';
  return 'info';
}

function extractSlideTitle(slide: Slide): string {
  if (slide.title && slide.title.trim()) return slide.title.trim();
  const hMatch = slide.html.match(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/i);
  if (hMatch) {
    return hMatch[1].replace(/<[^>]+>/g, '').trim();
  }
  return '';
}

function getPageType(plan: PresentationPlan | undefined, slideIndex: number): string {
  if (plan && plan.slides[slideIndex]) {
    return plan.slides[slideIndex].pageType;
  }
  return 'content-no-image';
}

export async function runLlmCritique(
  slides: Slide[],
  plan: PresentationPlan | undefined,
  options: ContentEngineOptions,
): Promise<{ issues: AuditIssue[]; scores: number[] }> {
  if (!options.provider) {
    return { issues: [], scores: [] };
  }

  const designContext = options.designContext || DEFAULT_DESIGN_CONTEXT;
  const issues: AuditIssue[] = [];
  const scores: number[] = [];

  for (let i = 0; i < slides.length; i++) {
    const slide = slides[i];
    const slideTitle = extractSlideTitle(slide);
    const pageType = getPageType(plan, i);

    try {
      const critique = await critiqueSlide(
        options.provider,
        slideTitle,
        slide.html,
        pageType,
        designContext,
      );

      scores.push(Math.round(critique.overallScore * 10));

      for (const issue of critique.issues) {
        issues.push({
          ruleId: `llm-${issue.severity}-${slugify(issue.title)}`,
          severity: mapSeverity(issue.severity),
          engine: 'content',
          slideIndex: i,
          message: `${issue.title}: ${issue.problem}`,
          fixSuggestion: issue.fix,
          fixable: false,
          metadata: {
            current: issue.current,
            scores: critique.scores,
            rawReport: critique.rawReport,
          },
        });
      }
    } catch {
      continue;
    }
  }

  return { issues, scores };
}
