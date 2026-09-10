import type { LayoutRule, LayoutRuleContext } from '../types';
import type { AuditIssue } from '../../../types';
import { getStyleMap, stringifyStyleMap } from '../utils';

export const noCardHeight100: LayoutRule = {
  id: 'no-card-height-100',
  description: '卡片样式 div 不应设置 height:100%，这会导致卡片被强制拉伸产生大面积留白',
  defaultSeverity: 'warn',
  fixable: true,

  check(ctx: LayoutRuleContext): AuditIssue[] {
    const issues: AuditIssue[] = [];
    const re = /<div\b([^>]*)>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(ctx.html)) !== null) {
      const attrs = m[1] || '';
      const styleMatch = attrs.match(/style="([^"]*)"/i);
      if (!styleMatch) continue;
      const styleStr = styleMatch[1];
      if (!/height\s*:\s*100%/i.test(styleStr)) continue;
      if (/flex\s*:\s*1\b/i.test(styleStr)) continue;
      if (/position\s*:\s*relative/i.test(styleStr) && /overflow\s*:\s*hidden/i.test(styleStr))
        continue;

      const looksLikeCard =
        /border-radius\s*:/i.test(styleStr) ||
        /background(?:-color)?\s*:/i.test(styleStr) ||
        /border\s*:/i.test(styleStr);
      if (!looksLikeCard) continue;

      issues.push({
        ruleId: this.id,
        severity: this.defaultSeverity,
        engine: 'layout',
        slideIndex: ctx.slideIndex,
        selector: 'div',
        message: '卡片样式 div 设置了 height:100%，在 grid 布局中可能导致卡片被强制拉伸产生留白',
        fixSuggestion: '移除 height:100%，让卡片高度由内容自然撑开（min-height 会保留）',
        fixable: true,
        metadata: {},
      });
    }
    return issues;
  },

  fix(html: string): string {
    return html.replace(/<div\b([^>]*)>/gi, (match: string, attrs: string) => {
      const styleMatch = attrs.match(/style="([^"]*)"/i);
      if (!styleMatch) return match;
      const styleStr = styleMatch[1];
      if (!/height\s*:\s*100%/i.test(styleStr)) return match;
      if (/flex\s*:\s*1\b/i.test(styleStr)) return match;
      if (/position\s*:\s*relative/i.test(styleStr) && /overflow\s*:\s*hidden/i.test(styleStr))
        return match;

      const looksLikeCard =
        /border-radius\s*:/i.test(styleStr) ||
        /background(?:-color)?\s*:/i.test(styleStr) ||
        /border\s*:/i.test(styleStr);
      if (!looksLikeCard) return match;

      const styleMap = getStyleMap(styleStr);
      delete styleMap['height'];
      const newStyle = stringifyStyleMap(styleMap);
      const newAttrs = attrs.replace(/style="[^"]*"/i, `style="${newStyle}"`);
      return `<div${newAttrs}>`;
    });
  },
};
