import type { AuditIssue } from '../../../types';
import type { LayoutRule, LayoutRuleContext } from '../types';
import { elementMatches, isRequiredContent, numberStyle, parseStyle } from './required-node-utils';

function logicalCanvas(html: string): { width: number; height: number } {
  return {
    width: Number.parseFloat(html.match(/data-logical-width\s*=\s*["']([^"']+)["']/iu)?.[1] ?? '1280'),
    height: Number.parseFloat(html.match(/data-logical-height\s*=\s*["']([^"']+)["']/iu)?.[1] ?? '720'),
  };
}

export const logicalCanvasBoundary: LayoutRule = {
  id: 'logical-canvas-boundary',
  description: '必需内容节点的逻辑矩形必须位于 logical canvas 内',
  defaultSeverity: 'error',
  fixable: false,
  check(ctx: LayoutRuleContext): AuditIssue[] {
    const issues: AuditIssue[] = [];
    const canvas = logicalCanvas(ctx.html);
    for (const element of elementMatches(ctx.html)) {
      if (!isRequiredContent(element.attrs)) continue;
      const style = parseStyle(element.attrs);
      const x = numberStyle(style, 'left');
      const y = numberStyle(style, 'top');
      const width = numberStyle(style, 'width');
      const height = numberStyle(style, 'height');
      if ([x, y, width, height].some((value) => value === undefined)) continue;
      const outOfBounds = x! < 0 || y! < 0 || width! <= 0 || height! <= 0 || x! + width! > canvas.width || y! + height! > canvas.height;
      if (!outOfBounds) continue;
      const contentId = element.attrs.match(/\bdata-content-id\s*=\s*["']([^"']*)["']/iu)?.[1];
      issues.push({
        ruleId: this.id,
        severity: this.defaultSeverity,
        engine: 'layout',
        slideIndex: ctx.slideIndex,
        selector: contentId ? `[data-content-id="${contentId}"]` : 'required-content',
        message: `必需内容节点${contentId ? ` ${contentId}` : ''}超出 ${canvas.width}×${canvas.height} logical canvas`,
        fixSuggestion: '重新分配逻辑矩形或切换到安全的 compact/reflow 布局',
        fixable: false,
        metadata: {
          code: 'geometry_out_of_bounds',
          contentId,
          expected: canvas,
          observed: { x, y, width, height },
          outOfBounds: true,
        },
      });
    }
    return issues;
  },
};
