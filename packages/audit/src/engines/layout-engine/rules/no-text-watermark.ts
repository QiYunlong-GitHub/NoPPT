import type { LayoutRule, LayoutRuleContext } from '../types';
import type { AuditIssue } from '../../../types';
import { getStyleFromAttrs } from '../utils';

function isWatermarkElement(className: string, styleStr: string): boolean {
  if (/watermark/i.test(className)) return true;
  if (/position\s*:\s*absolute/i.test(styleStr)) {
    const opacityMatch = styleStr.match(/opacity\s*:\s*([\d.]+)/i);
    const fsMatch = styleStr.match(/font-size\s*:\s*(\d+(?:\.\d+)?)px/i);
    if (opacityMatch && fsMatch) {
      const opacity = parseFloat(opacityMatch[1]);
      const fontSize = parseFloat(fsMatch[1]);
      if (opacity < 0.3 && fontSize > 72) return true;
    }
  }
  return false;
}

function isPlaceholderText(text: string): boolean {
  return /^[0-9]+$/.test(text) || /^[a-zA-Z]+$/.test(text);
}

export const noTextWatermark: LayoutRule = {
  id: 'no-text-watermark',
  description: '不应使用纯数字或纯字母文本作为水印装饰元素',
  defaultSeverity: 'info',
  fixable: false,

  check(ctx: LayoutRuleContext): AuditIssue[] {
    const issues: AuditIssue[] = [];
    const re = /<([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(ctx.html)) !== null) {
      const tag = m[1];
      const attrs = m[2] || '';
      const inner = m[3] || '';
      if (/\/\s*$/.test(attrs)) continue;

      const classMatch = attrs.match(/class="([^"]*)"/i);
      const className = classMatch ? classMatch[1] : '';
      const styleStr = getStyleFromAttrs(attrs);

      if (!isWatermarkElement(className, styleStr)) continue;

      const textContent = inner.replace(/<[^>]*>/g, '').trim();
      if (textContent.length < 3) continue;
      if (!isPlaceholderText(textContent)) continue;

      issues.push({
        ruleId: this.id,
        severity: this.defaultSeverity,
        engine: 'layout',
        slideIndex: ctx.slideIndex,
        selector: tag.toLowerCase(),
        message: `检测到文本水印装饰元素: "${textContent.substring(0, 20)}${textContent.length > 20 ? '...' : ''}"，纯数字或纯字母水印显得不够专业`,
        fixSuggestion: '移除文本水印，或使用有意义的图形/logo装饰替代',
        fixable: false,
        metadata: { tag: tag.toLowerCase(), text: textContent.substring(0, 50) },
      });
    }
    return issues;
  },
};
