import type { Page } from 'playwright-core';
import type { AuditIssue } from '../../types';
import axeCore from 'axe-core';

function mapImpact(impact: string | null | undefined): AuditIssue['severity'] {
  if (impact === 'critical' || impact === 'serious') return 'error';
  if (impact === 'moderate') return 'warn';
  return 'info';
}

export async function runAccessibilityCheck(page: Page, slideIndex: number): Promise<AuditIssue[]> {
  const issues: AuditIssue[] = [];

  try {
    await page.addScriptTag({ content: axeCore.source });

    const results = await page.evaluate(async () => {
      const axe = (window as any).axe;
      if (!axe) return { violations: [] };
      return await axe.run(document, {
        runOnly: ['wcag2a', 'wcag2aa'],
      });
    });

    const violations = results?.violations || [];

    for (const violation of violations) {
      const node = violation.nodes && violation.nodes[0];
      const selector = node?.target ? node.target.join(' ') : undefined;
      const failureSummary = node?.failureSummary || '';

      issues.push({
        ruleId: `a11y-${violation.id}`,
        severity: mapImpact(violation.impact),
        engine: 'content',
        slideIndex,
        selector,
        message: `${violation.help}${failureSummary ? ': ' + failureSummary : ''}`,
        fixable: false,
        metadata: {
          helpUrl: violation.helpUrl,
          impact: violation.impact,
          nodeCount: violation.nodes?.length || 0,
        },
      });
    }
  } catch (err) {
    issues.push({
      ruleId: 'a11y-check-failed',
      severity: 'info',
      engine: 'content',
      slideIndex,
      message: `可访问性检查执行失败: ${err instanceof Error ? err.message : String(err)}`,
      fixable: false,
    });
  }

  return issues;
}
