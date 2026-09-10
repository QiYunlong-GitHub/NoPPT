import type { LayoutRule, LayoutRuleContext } from '../types';
import type { AuditIssue } from '../../../types';
import { getStyleFromAttrs, isNeonBrightColor, parseColor } from '../utils';

function isVeryDark(r: number, g: number, b: number): boolean {
  return r < 30 && g < 30 && b < 30;
}

function extractShadowColors(shadowVal: string): Array<{ r: number; g: number; b: number }> {
  const colors: Array<{ r: number; g: number; b: number }> = [];
  const colorRe = /(?:#[0-9a-f]{3,8}|rgba?\([^)]+\))/gi;
  let m: RegExpExecArray | null;
  while ((m = colorRe.exec(shadowVal)) !== null) {
    const c = parseColor(m[0]);
    if (c) colors.push(c);
  }
  return colors;
}

export const noNeonCyberCliche: LayoutRule = {
  id: 'no-neon-cyber-cliche',
  description: '避免深蓝/极暗背景配合霓虹发光效果的赛博朋克陈词滥调',
  defaultSeverity: 'info',
  fixable: false,

  check(ctx: LayoutRuleContext): AuditIssue[] {
    const issues: AuditIssue[] = [];
    const re = /<([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(ctx.html)) !== null) {
      const tag = m[1];
      const attrs = m[2] || '';
      if (/\/\s*$/.test(attrs)) continue;
      const styleStr = getStyleFromAttrs(attrs);
      if (!styleStr) continue;

      const bgMatch = styleStr.match(/background(?:-color)?\s*:\s*([^;]+)/i);
      if (!bgMatch) continue;
      const bgColor = parseColor(bgMatch[1].trim());
      if (!bgColor || !isVeryDark(bgColor.r, bgColor.g, bgColor.b)) continue;

      const textShadowMatch = styleStr.match(/text-shadow\s*:\s*([^;]+)/i);
      const boxShadowMatch = styleStr.match(/box-shadow\s*:\s*([^;]+)/i);

      let hasNeonGlow = false;
      if (textShadowMatch) {
        const shadowColors = extractShadowColors(textShadowMatch[1]);
        hasNeonGlow = shadowColors.some((c) => isNeonBrightColor(c));
      }
      if (!hasNeonGlow && boxShadowMatch) {
        const shadowColors = extractShadowColors(boxShadowMatch[1]);
        hasNeonGlow = shadowColors.some((c) => isNeonBrightColor(c));
      }

      if (hasNeonGlow) {
        issues.push({
          ruleId: this.id,
          severity: this.defaultSeverity,
          engine: 'layout',
          slideIndex: ctx.slideIndex,
          selector: tag.toLowerCase(),
          message: `<${tag.toLowerCase()}> 使用了极暗背景配合霓虹发光效果，这是常见的赛博朋克陈词滥调，建议使用更专业的配色方案`,
          fixSuggestion: '考虑使用更柔和的阴影、降低饱和度，或选择非极暗背景色',
          fixable: false,
          metadata: { bgColor, tag: tag.toLowerCase() },
        });
      }
    }
    return issues;
  },
};
