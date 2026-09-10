import type { LayoutRule, LayoutRuleContext } from '../types';
import type { AuditIssue } from '../../../types';
import { getStyleFromAttrs } from '../utils';

const HEADING_TAGS = /^h[1-3]$/i;
const BODY_TAGS = /^(?:p|li|span)$/i;

function extractFontSizePx(styleStr: string): number | null {
  const m = styleStr.match(/font-size\s*:\s*(\d+(?:\.\d+)?)px/i);
  return m ? parseFloat(m[1]) : null;
}

export const fontSizeHierarchy: LayoutRule = {
  id: 'font-size-hierarchy',
  description: '标题(h1/h2/h3)与正文(p/li/span)字号差距应至少2.5倍，以建立清晰的视觉层次',
  defaultSeverity: 'warn',
  fixable: false,

  check(ctx: LayoutRuleContext): AuditIssue[] {
    const issues: AuditIssue[] = [];
    const headingSizes: number[] = [];
    const bodySizes: number[] = [];

    const re = /<([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(ctx.html)) !== null) {
      const tag = m[1].toLowerCase();
      const attrs = m[2] || '';
      if (/\/\s*$/.test(attrs)) continue;
      const styleStr = getStyleFromAttrs(attrs);
      const size = extractFontSizePx(styleStr);
      if (size === null) continue;

      if (HEADING_TAGS.test(tag)) {
        headingSizes.push(size);
      } else if (BODY_TAGS.test(tag)) {
        bodySizes.push(size);
      }
    }

    if (headingSizes.length === 0 || bodySizes.length === 0) return issues;

    const minHeading = Math.min(...headingSizes);
    const maxBody = Math.max(...bodySizes);

    if (maxBody * 2.5 > minHeading) {
      issues.push({
        ruleId: this.id,
        severity: this.defaultSeverity,
        engine: 'layout',
        slideIndex: ctx.slideIndex,
        message: `标题字号(${minHeading}px)与正文字号(${maxBody}px)差距不足2.5倍，视觉层次不够清晰`,
        fixSuggestion: `建议标题字号至少为正文字号的2.5倍（当前正文字号${maxBody}px，标题应≥${Math.ceil(maxBody * 2.5)}px）`,
        fixable: false,
        metadata: { minHeadingSize: minHeading, maxBodySize: maxBody, ratio: minHeading / maxBody },
      });
    }

    return issues;
  },
};
