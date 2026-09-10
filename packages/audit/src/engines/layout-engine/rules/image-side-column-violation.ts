import type { LayoutRule, LayoutRuleContext } from '../types';
import type { AuditIssue } from '../../../types';

/**
 * 侧栏页（图片侧栏，55:45 布局）判定：
 *  1) 优先读 html 内的 data-page-type 属性（若 audit 上下文未来透传 pageType 可改由此处扩展）；
 *  2) 无该属性时回退到文本特征（左图右文/右图左文/图片在左/图片在右/55:45 等）。
 * 仅 content-image-left / content-image-right（或含上述文本特征）判定为侧栏页；
 * content-image-top 的顶部通栏双列布局合法，需明确排除。
 */
function isSideLayout(html: string): boolean {
  const m = html.match(/data-page-type\s*=\s*["']([^"']+)["']/i);
  const pageType = m ? m[1].toLowerCase() : '';
  if (pageType === 'content-image-left' || pageType === 'content-image-right') return true;
  if (pageType === 'content-image-top') return false;
  return /左图右文|右图左文|图片在左|图片在右|55\s*[:：]\s*45/.test(html);
}

export const imageSideColumnViolation: LayoutRule = {
  id: 'image-side-column-violation',
  description: '图片侧栏页的列表必须单列，双列/栅格会在 55:45 布局下挤压或溢出',
  defaultSeverity: 'error',
  fixable: false,

  check(ctx: LayoutRuleContext): AuditIssue[] {
    const issues: AuditIssue[] = [];
    // 只对侧栏页做检测；content-image-top 等合法双列页直接放行。
    if (!isSideLayout(ctx.html)) return issues;

    const hasGrid =
      /display\s*:\s*grid/i.test(ctx.html) ||
      /grid-template-columns\s*:\s*repeat\(\s*[23]\s*,\s*1fr\s*\)/i.test(ctx.html);

    if (hasGrid) {
      issues.push({
        ruleId: this.id,
        severity: this.defaultSeverity,
        engine: 'layout',
        slideIndex: ctx.slideIndex,
        selector: 'ul',
        message: '图片侧栏页列表必须单列（55:45 下双列会挤压/溢出）',
        fixSuggestion: '改 display:flex;flex-direction:column;gap:24px 的单列 ul',
        fixable: false,
        metadata: { pageType: 'side' },
      });
    }

    return issues;
  },
};
