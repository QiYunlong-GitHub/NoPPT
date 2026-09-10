import type { LayoutRule, LayoutRuleContext } from '../types';
import type { AuditIssue } from '../../../types';
import { getStyleFromAttrs, parseColor } from '../utils';

const COLOR_PROPS = ['color', 'background-color', 'border-color'];

function quantizeColor(c: { r: number; g: number; b: number }): string {
  const qr = Math.floor(c.r / 32);
  const qg = Math.floor(c.g / 32);
  const qb = Math.floor(c.b / 32);
  return `${qr},${qg},${qb}`;
}

function extractColorsFromValue(val: string): Array<{ r: number; g: number; b: number }> {
  const colors: Array<{ r: number; g: number; b: number }> = [];
  const colorRe = /(?:#[0-9a-f]{3,8}|rgba?\([^)]+\))/gi;
  let m: RegExpExecArray | null;
  while ((m = colorRe.exec(val)) !== null) {
    const c = parseColor(m[0]);
    if (c) colors.push(c);
  }
  return colors;
}

export const colorCountLimit: LayoutRule = {
  id: 'color-count-limit',
  description: '幻灯片中使用的明显不同颜色不应超过5种',
  defaultSeverity: 'warn',
  fixable: false,

  check(ctx: LayoutRuleContext): AuditIssue[] {
    const issues: AuditIssue[] = [];
    const colorBuckets = new Set<string>();
    const re = /<([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(ctx.html)) !== null) {
      const attrs = m[2] || '';
      if (/\/\s*$/.test(attrs)) continue;
      const styleStr = getStyleFromAttrs(attrs);
      if (!styleStr) continue;

      for (const prop of COLOR_PROPS) {
        const re2 = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, 'i');
        const pm = styleStr.match(re2);
        if (!pm) continue;
        const val = pm[1].trim();
        if (/^(transparent|none|inherit)$/i.test(val)) continue;
        const colors = extractColorsFromValue(val);
        for (const c of colors) {
          colorBuckets.add(quantizeColor(c));
        }
      }
    }

    if (colorBuckets.size > 5) {
      issues.push({
        ruleId: this.id,
        severity: this.defaultSeverity,
        engine: 'layout',
        slideIndex: ctx.slideIndex,
        message: `幻灯片使用了 ${colorBuckets.size} 种明显不同的颜色（建议不超过5种），色彩过于繁杂会影响视觉一致性`,
        fixSuggestion: '精简配色方案，使用统一的主题色板，主色+辅助色+中性色',
        fixable: false,
        metadata: { colorCount: colorBuckets.size, limit: 5 },
      });
    }

    return issues;
  },
};
