import type { LayoutRule, LayoutRuleContext } from '../types';
import type { AuditIssue } from '../../../types';
import { getStyleMap, hasStyleKey, stringifyStyleMap } from '../utils';

export const gridNeedsAlignContent: LayoutRule = {
  id: 'grid-needs-align-content',
  description: 'display:grid 容器应设置 align-content 属性，避免内容被拉伸',
  defaultSeverity: 'warn',
  fixable: true,

  check(ctx: LayoutRuleContext): AuditIssue[] {
    const issues: AuditIssue[] = [];
    const re = /<([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(ctx.html)) !== null) {
      const tag = m[1];
      const attrs = m[2] || '';
      if (/\/\s*$/.test(attrs)) continue;
      const styleMatch = attrs.match(/style="([^"]*)"/i);
      if (!styleMatch) continue;
      const styleStr = styleMatch[1];
      if (!/display\s*:\s*grid/i.test(styleStr)) continue;
      if (hasStyleKey(styleStr, 'align-content')) continue;

      issues.push({
        ruleId: this.id,
        severity: this.defaultSeverity,
        engine: 'layout',
        slideIndex: ctx.slideIndex,
        selector: tag.toLowerCase(),
        message: `<${tag.toLowerCase()}> 使用了 display:grid 但未设置 align-content，可能导致卡片被不均匀拉伸`,
        fixSuggestion: '添加 align-content:center 或其他合适的值',
        fixable: true,
        metadata: { tag: tag.toLowerCase() },
      });
    }
    return issues;
  },

  fix(html: string): string {
    return html.replace(/<([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g, (match: string, tag: string, attrs: string) => {
      if (/\/\s*$/.test(attrs)) return match;
      const styleMatch = attrs.match(/style="([^"]*)"/i);
      if (!styleMatch) return match;
      const styleStr = styleMatch[1];
      if (!/display\s*:\s*grid/i.test(styleStr)) return match;
      if (hasStyleKey(styleStr, 'align-content')) return match;

      const styleMap = getStyleMap(styleStr);
      styleMap['align-content'] = 'center';
      const newStyle = stringifyStyleMap(styleMap);
      const newAttrs = attrs.replace(/style="[^"]*"/i, `style="${newStyle}"`);
      return `<${tag}${newAttrs}>`;
    });
  },
};
