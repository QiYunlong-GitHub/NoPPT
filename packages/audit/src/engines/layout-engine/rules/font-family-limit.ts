import type { LayoutRule, LayoutRuleContext } from '../types';
import type { AuditIssue } from '../../../types';
import { getStyleFromAttrs } from '../utils';

export const fontFamilyLimit: LayoutRule = {
  id: 'font-family-limit',
  description: '幻灯片中使用的字体族不应超过3种',
  defaultSeverity: 'warn',
  fixable: false,

  check(ctx: LayoutRuleContext): AuditIssue[] {
    const issues: AuditIssue[] = [];
    const fontFamilies = new Set<string>();
    const re = /<([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(ctx.html)) !== null) {
      const attrs = m[2] || '';
      if (/\/\s*$/.test(attrs)) continue;
      const styleStr = getStyleFromAttrs(attrs);
      if (!styleStr) continue;
      const ffMatch = styleStr.match(/(?:^|;)\s*font-family\s*:\s*([^;]+)/i);
      if (!ffMatch) continue;
      const firstFont = ffMatch[1].split(',')[0].trim().replace(/['"]/g, '').toLowerCase();
      if (firstFont) fontFamilies.add(firstFont);
    }

    if (fontFamilies.size > 3) {
      issues.push({
        ruleId: this.id,
        severity: this.defaultSeverity,
        engine: 'layout',
        slideIndex: ctx.slideIndex,
        message: `幻灯片使用了 ${fontFamilies.size} 种字体（建议不超过3种），过多字体会破坏视觉统一性`,
        fixSuggestion: '限制为标题字体+正文字体，最多再加一种装饰字体',
        fixable: false,
        metadata: { fontCount: fontFamilies.size, fonts: Array.from(fontFamilies), limit: 3 },
      });
    }

    return issues;
  },
};
