import type { LayoutRule, LayoutRuleContext } from '../types';
import type { AuditIssue } from '../../../types';
import { getStyleFromAttrs } from '../utils';

const EMOJI_RE = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}\u{1F000}-\u{1F02F}\u{1F0A0}-\u{1F0FF}\u{1F100}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F900}-\u{1F9FF}]/u;

function isIconSpan(spanAttrs: string, spanInner: string): boolean {
  if (EMOJI_RE.test(spanInner)) return true;
  const clsMatch = spanAttrs.match(/class="([^"]*)"/i);
  if (clsMatch && /icon/i.test(clsMatch[1])) return true;
  const styleStr = getStyleFromAttrs(spanAttrs);
  if (/display\s*:\s*inline-flex/i.test(styleStr)) {
    if (/border-radius\s*:/i.test(styleStr) || /width\s*:\s*\d+px/i.test(styleStr) || /height\s*:\s*\d+px/i.test(styleStr)) {
      return true;
    }
  }
  return false;
}

function pHasFontStyling(pAttrs: string): boolean {
  const styleStr = getStyleFromAttrs(pAttrs);
  return /font-size\s*:/i.test(styleStr) || /font-weight\s*:/i.test(styleStr);
}

export const iconSpanWrappedByStyledP: LayoutRule = {
  id: 'icon-span-wrapped-by-styled-p',
  description: '图标 <span> 不应被带 font-size/font-weight 样式的 <p> 包裹，会导致图标错位',
  defaultSeverity: 'warn',
  fixable: true,

  check(ctx: LayoutRuleContext): AuditIssue[] {
    const issues: AuditIssue[] = [];
    const re = /<p\b([^>]*)>([\s\S]*?)<\/p>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(ctx.html)) !== null) {
      const pAttrs = m[1] || '';
      const inner = m[2] || '';
      if (!pHasFontStyling(pAttrs)) continue;

      const spanRe = /<span\b([^>]*)>([\s\S]*?)<\/span>/gi;
      let sm: RegExpExecArray | null;
      let iconFound = false;
      let spanCount = 0;
      let textOnly = '';
      while ((sm = spanRe.exec(inner)) !== null) {
        spanCount++;
        const spanAttrs = sm[1] || '';
        const spanInner = sm[2] || '';
        if (isIconSpan(spanAttrs, spanInner)) iconFound = true;
      }
      textOnly = inner.replace(/<span\b[^>]*>[\s\S]*?<\/span>/gi, '').replace(/<[^>]*>/g, '').trim();

      if (iconFound && spanCount === 1 && textOnly.length === 0) {
        issues.push({
          ruleId: this.id,
          severity: this.defaultSeverity,
          engine: 'layout',
          slideIndex: ctx.slideIndex,
          selector: 'p',
          message: '图标 <span> 被带字体样式的 <p> 包裹，可能导致图标继承 font-size/line-height 产生错位',
          fixSuggestion: '解包 <p> 标签，直接使用图标 <span>',
          fixable: true,
          metadata: {},
        });
      }
    }
    return issues;
  },

  fix(html: string): string {
    return html.replace(
      /<p\b([^>]*)>(\s*<span\b[^>]*>[\s\S]*?<\/span>\s*)<\/p>/gi,
      (_match: string, _pAttrs: string, innerSpan: string) => innerSpan.trim()
    );
  },
};
