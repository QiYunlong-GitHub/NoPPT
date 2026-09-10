import type { AuditContext, AuditEngineResult, AuditIssue } from '../../types';
import { rules } from './rules';
import type { LayoutRule, LayoutRuleContext } from './types';

export class LayoutAuditEngine {
  private rules: LayoutRule[] = rules;

  async audit(context: AuditContext): Promise<AuditEngineResult> {
    const issues: AuditIssue[] = [];
    const ruleOverrides = context.config.rules || {};

    for (let slideIndex = 0; slideIndex < context.presentation.slides.length; slideIndex++) {
      const slide = context.presentation.slides[slideIndex];
      const ctx: LayoutRuleContext = {
        html: slide.html,
        slideIndex,
        config: ruleOverrides as Record<string, any>,
      };

      for (const rule of this.rules) {
        const severity = ruleOverrides[rule.id] || rule.defaultSeverity;
        if (severity === 'off') continue;
        const ruleIssues = rule.check(ctx);
        for (const issue of ruleIssues) {
          issue.severity = severity;
          issue.engine = 'layout';
          issue.ruleId = rule.id;
          issue.fixable = rule.fixable;
        }
        issues.push(...ruleIssues);
      }
    }

    const errorCount = issues.filter((i) => i.severity === 'error').length;
    const warnCount = issues.filter((i) => i.severity === 'warn').length;
    let score = 100 - errorCount * 20 - warnCount * 5;
    if (score < 0) score = 0;

    return {
      engine: 'layout',
      engineName: 'Layout & Style Audit Engine',
      status: errorCount > 0 ? 'fail' : warnCount > 0 ? 'warn' : 'passed',
      score,
      issues,
      durationMs: 0,
    };
  }

  fix(html: string, ruleId?: string): string {
    let result = html;
    for (const rule of this.rules) {
      if (ruleId && rule.id !== ruleId) continue;
      if (rule.fix) {
        result = rule.fix(result);
      }
    }
    return result;
  }

  fixAllSlides(slides: Array<{ html: string }>): Array<{ html: string }> {
    return slides.map((s) => ({ ...s, html: this.fix(s.html) }));
  }
}
