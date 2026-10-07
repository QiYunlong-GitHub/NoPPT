import type { AuditIssue } from '../../../types';
import type { LayoutRule, LayoutRuleContext } from '../types';
import { elementMatches, isRequiredContent, parseStyle } from './required-node-utils';

export const noFixedNestedCanvas: LayoutRule = {
  id: 'no-fixed-nested-canvas',
  description: '响应式根容器内不得嵌套第二个固定 logical canvas',
  defaultSeverity: 'error',
  fixable: false,
  check(ctx: LayoutRuleContext): AuditIssue[] {
    const root = /^<(?:div|section|article)\b([^>]*)>/iu.exec(ctx.html.trim());
    if (!root) return [];
    const rootStyle = parseStyle(root[1]);
    const responsiveRoot = rootStyle.width === '100%' || /data-canonical-root/iu.test(root[1]);
    if (!responsiveRoot || !elementMatches(ctx.html).some((element) => isRequiredContent(element.attrs))) return [];

    const nestedPattern = /<(?:div|section|article)\b([^>]*)>/giu;
    let match: RegExpExecArray | null;
    while ((match = nestedPattern.exec(ctx.html)) !== null) {
      if (match.index === root.index) continue;
      const attrs = match[1] ?? '';
      const style = parseStyle(attrs);
      const width = style.width?.replace(/\s+/gu, '').toLowerCase();
      const height = style.height?.replace(/\s+/gu, '').toLowerCase();
      if (width !== '1280px' || height !== '720px') continue;
      if (/data-logical-canvas\s*=\s*["']true["']/iu.test(attrs) && style.width === '100%') continue;
      return [{
        ruleId: this.id,
        severity: this.defaultSeverity,
        engine: 'layout',
        slideIndex: ctx.slideIndex,
        selector: 'nested-fixed-canvas',
        message: '响应式根容器内发现固定 1280×720 嵌套画布',
        fixSuggestion: '让 canonical logical canvas 使用 width/height:100% 映射到 viewport，禁止第二套固定坐标盒',
        fixable: false,
        metadata: { code: 'fixed_nested_canvas', nestedCanvas: { width: 1280, height: 720 } },
      }];
    }
    return [];
  },
};
