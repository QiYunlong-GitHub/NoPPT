import type { LayoutRule, LayoutRuleContext } from '../types';
import type { AuditIssue } from '../../../types';
import { getStyleMap, hasStyleKey, stringifyStyleMap } from '../utils';

const DECORATION_KEYWORDS = /(?:decoration|decorative|ornament)/i;

export const decorativeNeedsPointerEventsNone: LayoutRule = {
  id: 'decorative-needs-pointer-events-none',
  description: '装饰性元素（class 含 decoration/decorative/ornament）应设置 pointer-events:none，避免阻挡交互',
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
      const classMatch = attrs.match(/class="([^"]*)"/i);
      if (!classMatch || !DECORATION_KEYWORDS.test(classMatch[1])) continue;
      const styleMatch = attrs.match(/style="([^"]*)"/i);
      const styleStr = styleMatch ? styleMatch[1] : '';
      if (hasStyleKey(styleStr, 'pointer-events')) continue;

      issues.push({
        ruleId: this.id,
        severity: this.defaultSeverity,
        engine: 'layout',
        slideIndex: ctx.slideIndex,
        selector: `${tag.toLowerCase()}.${classMatch[1].split(/\s+/)[0]}`,
        message: `装饰性元素 <${tag.toLowerCase()}> 缺少 pointer-events:none，可能阻挡用户交互`,
        fixSuggestion: '添加 pointer-events:none 使装饰元素不响应鼠标事件',
        fixable: true,
        metadata: { tag: tag.toLowerCase(), className: classMatch[1] },
      });
    }
    return issues;
  },

  fix(html: string): string {
    return html.replace(/<([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g, (match: string, tag: string, attrs: string) => {
      if (/\/\s*$/.test(attrs)) return match;
      const classMatch = attrs.match(/class="([^"]*)"/i);
      if (!classMatch || !DECORATION_KEYWORDS.test(classMatch[1])) return match;
      const styleMatch = attrs.match(/style="([^"]*)"/i);
      const styleStr = styleMatch ? styleMatch[1] : '';
      if (hasStyleKey(styleStr, 'pointer-events')) return match;

      const styleMap = getStyleMap(styleStr);
      styleMap['pointer-events'] = 'none';
      const newStyle = stringifyStyleMap(styleMap);
      let newAttrs: string;
      if (styleMatch) {
        newAttrs = attrs.replace(/style="[^"]*"/i, `style="${newStyle}"`);
      } else {
        newAttrs = `${attrs} style="${newStyle}"`.trim();
      }
      return `<${tag}${newAttrs}>`;
    });
  },
};
