import type { LayoutRule, LayoutRuleContext } from '../types';
import type { AuditIssue } from '../../../types';
import { getStyleMap, hasStyleKey, stringifyStyleMap } from '../utils';

const REQUIRED_STYLES: Array<{ key: string; value: string }> = [
  { key: 'width', value: '100%' },
  { key: 'height', value: '100%' },
  { key: 'overflow', value: 'hidden' },
  { key: 'position', value: 'relative' },
  { key: 'box-sizing', value: 'border-box' },
];

export const outerContainerRequiredStyles: LayoutRule = {
  id: 'outer-container-required-styles',
  description: '外层容器必须包含 width:100%, height:100%, overflow:hidden, position:relative, box-sizing:border-box',
  defaultSeverity: 'error',
  fixable: true,

  check(ctx: LayoutRuleContext): AuditIssue[] {
    const issues: AuditIssue[] = [];
    const m = /^<(div|section|article)\b([^>]*)>/i.exec(ctx.html.trim());
    if (!m) return issues;

    const tagName = m[1];
    const attrs = m[2] || '';
    const styleMatch = attrs.match(/style="([^"]*)"/i);
    const styleStr = styleMatch ? styleMatch[1] : '';
    const styleMap = getStyleMap(styleStr);

    const missing: string[] = [];
    for (const req of REQUIRED_STYLES) {
      const existing = styleMap[req.key];
      if (!existing || existing.toLowerCase().replace(/\s+/g, '') !== req.value) {
        missing.push(`${req.key}:${req.value}`);
      }
    }

    if (missing.length > 0) {
      issues.push({
        ruleId: this.id,
        severity: this.defaultSeverity,
        engine: 'layout',
        slideIndex: ctx.slideIndex,
        selector: tagName.toLowerCase(),
        message: `外层 <${tagName.toLowerCase()}> 容器缺少必要样式: ${missing.join(', ')}`,
        fixSuggestion: '补充缺失的布局样式以确保幻灯片正确渲染',
        fixable: true,
        metadata: { missing, tagName: tagName.toLowerCase() },
      });
    }

    return issues;
  },

  fix(html: string): string {
    const trimmed = html.trim();
    const m = /^<(div|section|article)\b([^>]*)>/i.exec(trimmed);
    if (!m) return html;

    const tagName = m[1];
    const attrs = m[2] || '';
    const styleMatch = attrs.match(/style="([^"]*)"/i);
    const existingStyle = styleMatch ? styleMatch[1] : '';
    const styleMap = getStyleMap(existingStyle);

    for (const req of REQUIRED_STYLES) {
      if (!hasStyleKey(existingStyle, req.key)) {
        styleMap[req.key] = req.value;
      }
    }

    const newStyle = stringifyStyleMap(styleMap);
    let newAttrs: string;
    if (styleMatch) {
      newAttrs = attrs.replace(/style="[^"]*"/i, `style="${newStyle}"`);
    } else {
      newAttrs = `${attrs} style="${newStyle}"`.trim();
    }

    const rest = trimmed.substring(m[0].length);
    return `<${tagName}${newAttrs}>${rest}`;
  },
};
