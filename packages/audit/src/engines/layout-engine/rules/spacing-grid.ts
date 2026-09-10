import type { LayoutRule, LayoutRuleContext } from '../types';
import type { AuditIssue } from '../../../types';
import { extractPxValues, getStyleFromAttrs, isOn8Grid } from '../utils';

const SPACING_PROPS = [
  'padding', 'padding-top', 'padding-bottom', 'padding-left', 'padding-right',
  'margin', 'margin-top', 'margin-bottom', 'margin-left', 'margin-right',
];

export const spacingGrid: LayoutRule = {
  id: 'spacing-grid',
  description: 'padding/margin 值应遵循 8px 网格系统（容差 ±2px）',
  defaultSeverity: 'info',
  fixable: false,

  check(ctx: LayoutRuleContext): AuditIssue[] {
    const issues: AuditIssue[] = [];
    const violations: Array<{ tag: string; prop: string; value: number }> = [];

    const re = /<([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(ctx.html)) !== null) {
      const tag = m[1].toLowerCase();
      const attrs = m[2] || '';
      if (/\/\s*$/.test(attrs)) continue;
      const styleStr = getStyleFromAttrs(attrs);
      if (!styleStr) continue;

      for (const prop of SPACING_PROPS) {
        const propRe = new RegExp(`(?:^|;)\\s*${prop.replace(/-/g, '\\-')}\\s*:\\s*([^;]+)`, 'i');
        const pm = styleStr.match(propRe);
        if (!pm) continue;
        const pxValues = extractPxValues(pm[1]);
        for (const px of pxValues) {
          if (px === 0) continue;
          if (!isOn8Grid(px, 2)) {
            violations.push({ tag, prop, value: px });
          }
        }
      }
    }

    if (violations.length > 0) {
      const samples = violations.slice(0, 5).map(v => `${v.prop}:${v.value}px`).join(', ');
      issues.push({
        ruleId: this.id,
        severity: this.defaultSeverity,
        engine: 'layout',
        slideIndex: ctx.slideIndex,
        message: `发现 ${violations.length} 处间距值不符合 8px 网格系统（容差±2px），例如: ${samples}`,
        fixSuggestion: '将 padding/margin 值调整为最近的 8 的倍数（如 8px、16px、24px、32px），以保持视觉节奏一致',
        fixable: false,
        metadata: { violationCount: violations.length, violations: violations.slice(0, 10) },
      });
    }

    return issues;
  },
};
