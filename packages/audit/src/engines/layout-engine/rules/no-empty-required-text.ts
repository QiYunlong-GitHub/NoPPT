import type { AuditIssue } from '../../../types';
import type { LayoutRule, LayoutRuleContext } from '../types';
import { elementMatches, isRequiredContent, plainText } from './required-node-utils';

export const noEmptyRequiredText: LayoutRule = {
  id: 'no-empty-required-text',
  description: '必需内容节点不得为空或只包含空白文本',
  defaultSeverity: 'error',
  fixable: false,
  check(ctx: LayoutRuleContext): AuditIssue[] {
    const issues: AuditIssue[] = [];
    for (const element of elementMatches(ctx.html)) {
      if (!isRequiredContent(element.attrs) || plainText(element.body)) continue;
      const contentId = element.attrs.match(/\bdata-content-id\s*=\s*["']([^"']*)["']/iu)?.[1];
      issues.push({
        ruleId: this.id,
        severity: this.defaultSeverity,
        engine: 'layout',
        slideIndex: ctx.slideIndex,
        selector: contentId ? `[data-content-id="${contentId}"]` : 'required-content',
        message: `必需内容节点${contentId ? ` ${contentId}` : ''}为空`,
        fixSuggestion: '输出非空文本，或生成带原因和 identity 的显式 omission 节点',
        fixable: false,
        metadata: { code: 'empty_required_node', contentId, emptyRequiredNodes: 1 },
      });
    }
    return issues;
  },
};
