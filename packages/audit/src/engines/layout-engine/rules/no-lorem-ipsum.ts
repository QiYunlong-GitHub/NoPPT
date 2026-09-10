import type { LayoutRule, LayoutRuleContext } from '../types';
import type { AuditIssue } from '../../../types';

const PLACEHOLDER_PATTERNS = [
  /lorem\s+ipsum/i,
  /占位文字/,
  /placeholder\s+text/i,
  /示例文本/,
  /待填写/,
];

export const noLoremIpsum: LayoutRule = {
  id: 'no-lorem-ipsum',
  description: '幻灯片中不应包含 Lorem ipsum 等占位符文本',
  defaultSeverity: 'warn',
  fixable: false,

  check(ctx: LayoutRuleContext): AuditIssue[] {
    const issues: AuditIssue[] = [];
    const textOnly = ctx.html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

    for (const pattern of PLACEHOLDER_PATTERNS) {
      if (pattern.test(textOnly)) {
        const match = textOnly.match(pattern);
        issues.push({
          ruleId: this.id,
          severity: this.defaultSeverity,
          engine: 'layout',
          slideIndex: ctx.slideIndex,
          message: `检测到占位符文本: "${match ? match[0] : pattern.source}"，演示文稿中不应保留占位内容`,
          fixSuggestion: '替换为实际内容，或删除该文本块',
          fixable: false,
          metadata: { pattern: match ? match[0] : null },
        });
      }
    }

    return issues;
  },
};
