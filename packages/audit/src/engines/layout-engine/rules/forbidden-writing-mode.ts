import type { LayoutRule, LayoutRuleContext } from '../types';
import type { AuditIssue } from '../../../types';
import { getStyleMap, stringifyStyleMap } from '../utils';

export const forbiddenWritingMode: LayoutRule = {
  id: 'forbidden-writing-mode',
  description: '禁止使用 writing-mode: vertical-rl 或 vertical-lr',
  defaultSeverity: 'error',
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
      if (/writing-mode\s*:\s*vertical-(?:rl|lr)/i.test(styleMatch[1])) {
        issues.push({
          ruleId: this.id,
          severity: this.defaultSeverity,
          engine: 'layout',
          slideIndex: ctx.slideIndex,
          selector: tag.toLowerCase(),
          message: `<${tag.toLowerCase()}> 使用了不支持的 writing-mode 垂直排版`,
          fixSuggestion: '移除 writing-mode 属性，使用水平排版',
          fixable: true,
          metadata: { tag: tag.toLowerCase() },
        });
      }
    }
    return issues;
  },

  fix(html: string): string {
    return html.replace(/<([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g, (match: string, tag: string, attrs: string) => {
      if (/\/\s*$/.test(attrs)) return match;
      const styleMatch = attrs.match(/style="([^"]*)"/i);
      if (!styleMatch) return match;
      if (!/writing-mode\s*:\s*vertical-(?:rl|lr)/i.test(styleMatch[1])) return match;
      const styleMap = getStyleMap(styleMatch[1]);
      delete styleMap['writing-mode'];
      const newStyle = stringifyStyleMap(styleMap);
      const newAttrs = attrs.replace(/style="[^"]*"/i, `style="${newStyle}"`);
      return `<${tag}${newAttrs}>`;
    });
  },
};
