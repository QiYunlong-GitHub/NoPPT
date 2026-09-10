import type { LayoutRule, LayoutRuleContext } from '../types';
import type { AuditIssue } from '../../../types';
import { findOuterContainer, getDirectChildren, getStyleFromAttrs } from '../utils';

export const noAbsPosAsMainLayout: LayoutRule = {
  id: 'no-abs-pos-as-main-layout',
  description: '外层容器的直接子元素中不应有超过3个使用 position:absolute，建议改用 flex/grid 布局',
  defaultSeverity: 'warn',
  fixable: false,

  check(ctx: LayoutRuleContext): AuditIssue[] {
    const issues: AuditIssue[] = [];
    const outer = findOuterContainer(ctx.html);
    if (!outer) return issues;

    const children = getDirectChildren(ctx.html, outer.tag);
    const absChildren = children.filter(child => {
      const styleStr = getStyleFromAttrs(child.attrs);
      return /position\s*:\s*absolute/i.test(styleStr);
    });

    if (absChildren.length > 3) {
      issues.push({
        ruleId: this.id,
        severity: this.defaultSeverity,
        engine: 'layout',
        slideIndex: ctx.slideIndex,
        selector: outer.tag,
        message: `外层容器有 ${absChildren.length} 个直接子元素使用 position:absolute，建议改用 flex/grid 布局以获得更好的响应式和可维护性`,
        fixSuggestion: '将主要布局从绝对定位迁移到 flexbox 或 grid，仅对装饰性元素使用绝对定位',
        fixable: false,
        metadata: { absoluteCount: absChildren.length, threshold: 3 },
      });
    }

    return issues;
  },
};
