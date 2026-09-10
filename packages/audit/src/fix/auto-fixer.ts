import type { AuditIssue } from '../types';
import { LayoutAuditEngine } from '../engines/layout-engine';

export interface FixResult {
  html: string;
  fixedIssues: AuditIssue[];
  failedIssues: AuditIssue[];
}

export class AutoFixer {
  private layoutEngine: LayoutAuditEngine;

  constructor(layoutEngine?: LayoutAuditEngine) {
    this.layoutEngine = layoutEngine || new LayoutAuditEngine();
  }

  fixSlide(html: string, issues: AuditIssue[]): FixResult {
    const fixable = issues
      .filter(i => i.fixable && i.severity !== 'off')
      .sort((a, b) => {
        const sevOrder: Record<string, number> = { error: 0, warn: 1, info: 2 };
        const sa = sevOrder[a.severity] ?? 3;
        const sb = sevOrder[b.severity] ?? 3;
        if (sa !== sb) return sa - sb;
        return a.ruleId.localeCompare(b.ruleId);
      });

    if (fixable.length === 0) {
      return { html, fixedIssues: [], failedIssues: [] };
    }

    let currentHtml = html;
    const fixedIssues: AuditIssue[] = [];
    const failedIssues: AuditIssue[] = [];
    const fixedRuleIds = new Set<string>();

    for (const issue of fixable) {
      if (fixedRuleIds.has(issue.ruleId)) continue;
      try {
        const beforeHtml = currentHtml;
        currentHtml = this.layoutEngine.fix(currentHtml, issue.ruleId);
        if (currentHtml !== beforeHtml) {
          fixedIssues.push(issue);
          fixedRuleIds.add(issue.ruleId);
        }
      } catch {
        failedIssues.push(issue);
      }
    }

    return { html: currentHtml, fixedIssues, failedIssues };
  }

  fixAll(slides: Array<{ html: string }>, allIssues: AuditIssue[]): {
    slides: Array<{ html: string }>;
    summary: { fixedCount: number; failedCount: number; fixedRuleIds: string[]; failedRuleIds: string[] };
  } {
    const fixedRuleIdsSet = new Set<string>();
    const failedRuleIdsSet = new Set<string>();
    let totalFixed = 0;
    let totalFailed = 0;

    const fixedSlides = slides.map((slide, slideIndex) => {
      const slideIssues = allIssues.filter(i => i.slideIndex === slideIndex);
      const result = this.fixSlide(slide.html, slideIssues);
      totalFixed += result.fixedIssues.length;
      totalFailed += result.failedIssues.length;
      result.fixedIssues.forEach(i => fixedRuleIdsSet.add(i.ruleId));
      result.failedIssues.forEach(i => failedRuleIdsSet.add(i.ruleId));
      return { ...slide, html: result.html };
    });

    return {
      slides: fixedSlides,
      summary: {
        fixedCount: totalFixed,
        failedCount: totalFailed,
        fixedRuleIds: Array.from(fixedRuleIdsSet),
        failedRuleIds: Array.from(failedRuleIdsSet),
      },
    };
  }
}
