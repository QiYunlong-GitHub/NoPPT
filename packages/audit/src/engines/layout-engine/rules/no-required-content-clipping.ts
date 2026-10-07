import type { AuditIssue } from '../../../types';
import type { LayoutRule, LayoutRuleContext } from '../types';
import { elementMatches, isRequiredContent, parseStyle } from './required-node-utils';

export const noRequiredContentClipping: LayoutRule = {
  id: 'no-required-content-clipping',
  description: '必需内容节点不得通过 overflow:hidden 或显式裁切标记静默隐藏内容',
  defaultSeverity: 'error',
  fixable: false,
  check(ctx: LayoutRuleContext): AuditIssue[] {
    const issues: AuditIssue[] = [];
    for (const element of elementMatches(ctx.html)) {
      if (!isRequiredContent(element.attrs)) continue;
      const style = parseStyle(element.attrs);
      if (style.overflow?.toLowerCase() !== 'hidden' && !/\bdata-(?:clipped|overflow-clipped)\s*=\s*["']true["']/iu.test(element.attrs)) continue;
      const contentId = element.attrs.match(/\bdata-content-id\s*=\s*["']([^"']*)["']/iu)?.[1];
      issues.push({
        ruleId: this.id,
        severity: this.defaultSeverity,
        engine: 'layout',
        slideIndex: ctx.slideIndex,
        selector: contentId ? `[data-content-id="${contentId}"]` : 'required-content',
        message: `必需内容节点${contentId ? ` ${contentId}` : ''}存在裁切风险`,
        fixSuggestion: '移除必需内容节点的 overflow:hidden，或在测量后扩大/重排文本区域',
        fixable: false,
        metadata: { code: 'required_clipped', contentId, clipped: true },
      });
    }
    return issues;
  },
};
