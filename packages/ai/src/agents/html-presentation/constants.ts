/**
 * shared.ts 二次拆分产出：图片占位符与正文字号约束常量
 * 由 html-presentation/shared.ts 的顶层声明逐块搬移，对外导出保持不变。
 */

import type { ImageRatio } from '../../types';

export const IMAGE_PLACEHOLDER = 'https://NOPPT_IMAGE_PLACEHOLDER';

// ===== Task-6 FR-4：正文字号硬 Clamp 常量（集中配置，方便调参）=====
/** 正文类元素 font-size 下限（px），低于此值强制抬升 */

export const BODY_FONT_SIZE_MIN = 16;
/** 正文类元素 font-size 上限（px），高于此值强制压落到 20（左图右文卡片条上限） */

export const BODY_FONT_SIZE_MAX = 20;
/** 绝对豁免标签（H1-H6），这些标签内部的 font-size 不 clamp（H3 允许 28-30px） */

export const BODY_FONT_SIZE_EXEMPT_TAGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6']);
/** 豁免的 CSS class（部分关键词匹配即可），带这些类名的元素即使在 li/p 内部也不 clamp */

export const BODY_FONT_SIZE_EXEMPT_CLASS_KEYWORDS = [
  'hero-title',
  'page-title',
  'slide-title',
  'cover-title',
] as const;
/** 正文类 clamp 生效的标签范围（扩大 scope，从原来的 li/p 扩展到常见正文容器） */

export const BODY_CLAMP_TAGS = [
  'li',
  'p',
  'div',
  'span',
  'a',
  'figcaption',
  'aside',
  'td',
  'th',
  'em',
  'strong',
  'small',
  'label',
  'button',
];
// ==================================================================


export function replaceImagePlaceholderWithRealSrc(
  html: string,
  realSrc: string,
  ratio: ImageRatio,
): string {
  if (!html) return html;
  // 只匹配第一个占位 img（每张 slide 只应该有一张内容配图）
  const re =
    /<img\b([^>]*)src\s*=\s*["']\s*`?\s*https:\/\/NOPPT_IMAGE_PLACEHOLDER\s*`?\s*["']([^>]*)>/i;
  return html.replace(re, (_fullMatch, beforeAttrs: string, afterAttrs: string) => {
    const allAttrs = beforeAttrs + ' ' + afterAttrs;
    const attrs: string[] = [];
    // 收集除 src / data-image-ratio 以外的其它原有属性
    const attrRe = /([\w-:.]+)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/gi;
    let seenRatio = false;
    let ma: RegExpExecArray | null;
    while ((ma = attrRe.exec(allAttrs)) !== null) {
      const name = ma[1].trim().toLowerCase();
      if (!name || name === 'src') continue;
      if (name === 'data-image-ratio') {
        seenRatio = true;
        attrs.push(`data-image-ratio="${ratio}"`);
        continue;
      }
      const quote =
        ma[2] !== undefined ? `"${ma[2]}"` : ma[3] !== undefined ? `'${ma[3]}'` : (ma[4] ?? '');
      attrs.push(quote ? `${ma[1]}=${quote}` : ma[1]);
    }
    if (!seenRatio) attrs.push(`data-image-ratio="${ratio}"`);
    attrs.push(`src="${realSrc}"`);
    return `<img ${attrs.join(' ')}>`;
  });
}

