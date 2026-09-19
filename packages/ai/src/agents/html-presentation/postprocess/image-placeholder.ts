/**
 * PostProcess 簇C：图片占位符注入/清理（从 html-presentation-agent.ts 外置）。
 * 依赖：IMAGE_PLACEHOLDER 来自 ../constants；JSDOM 来自 jsdom；类型来自 ../../../types。
 */
import { JSDOM } from 'jsdom';
import { IMAGE_PLACEHOLDER } from '../constants';
import type { HTMLSlide } from '../types';
import type { SlidePageType, ImageRatio } from '../../../types';

export function removeImagePlaceholder(slide: HTMLSlide) {
  const imgRegex =
    /<div[^>]*style="[^"]*"[^>]*>\s*<img[^>]*src=["']https:\/\/NOPPT_IMAGE_PLACEHOLDER["'][^>]*>\s*<\/div>/gi;
  const singleImgRegex = /<img[^>]*src=["']https:\/\/NOPPT_IMAGE_PLACEHOLDER["'][^>]*>/gi;
  let newHtml = slide.html.replace(imgRegex, '');
  newHtml = newHtml.replace(singleImgRegex, '');
  // 删图后收起「仅用于放图的定宽列」：flex:0 0 N% 的空容器直接移除，避免右侧大块空白；
  // 其兄弟内容列（flex:1）随之占满宽度，构图不再被空洞破坏。
  newHtml = newHtml.replace(
    /<div([^>]*?style="[^"]*flex\s*:\s*0\s+0\s+\d+%[^"]*"[^>]*)>\s*<\/div>/gi,
    '',
  );
  slide.html = newHtml;
}

/**
 * 判断 slide HTML 是否有足够有意义的正文内容（用于 content-no-image → 带图 升级判定）
 * 与 server 端保持一致：不强制要求 ul/ol/li，只要去除标题/标签后剩余纯文本长度 ≥ 6 个字符即可
 */
export function slideHasMeaningfulBody(html: string): boolean {
  if (!html) return false;
  let stripped = html.replace(/^<div\b[^>]*>/i, '').replace(/<\/div>\s*$/i, '');
  stripped = stripped.replace(/<h[12]\b[^>]*>[\s\S]*?<\/h[12]>/gi, '');
  const textOnly = stripped
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim();
  return textOnly.length >= 6;
}

/**
 * 兜底：把"纯文字内容页"改为带图布局并注入 IMAGE_PLACEHOLDER（左图右文 / 右图左文 / 上图下文）。
 *
 * 场景：
 *  1) 规划阶段把本该配图的页标成 content-no-image（过度保守）
 *  2) LLM 生成 HTML 时，对 content-image-* 页漏写占位符
 *
 * 实现约束（pres_mtzke4lj_ovu6r61 复盘）：
 *  - **绝不重建页面**：h2 之前的装饰与标题容器、以及正文节点的原始标签/样式一律原样保留；
 *  - 只做「插入图片列 + 把原正文容器整体搬进文字列」这一最小侵入 DOM 移动；
 *  - 无法安全识别正文容器（版式不规则）时 fail-safe 返回原 HTML ——
 *    宁可不配图，也不产出「列表被挤出内容列、文字全部不可见」的坏页。
 */
export function injectImagePlaceholderForContentSlide(
  html: string,
  pageType: SlidePageType,
  _primaryColor: string = '#2563eb',
): string {
  if (!html || html.includes(IMAGE_PLACEHOLDER) || /<img\b/i.test(html)) return html;
  // ——— FR-2 (fix-slide-comparison-image-disaster)：保护版式有固定结构，绝不重建左图右文/上图下文 ———
  const PROTECTED_LAYOUT_FOR_INJECT: ReadonlySet<string> = new Set([
    'comparison-deep-dive',
    'content-value-showcase',
    'content-stats-highlight',
    'content-compare',
    'content-timeline',
    'content-table',
  ]);
  const layoutFromHtml = (html.match(
    /<\s*(?:div|section|article)\b[^>]*\bdata-layout\s*=\s*["']?([a-z0-9-]+)["']?[^>]*>/i,
  ) || [])[1]?.toLowerCase();
  if (
    PROTECTED_LAYOUT_FOR_INJECT.has(pageType) ||
    (layoutFromHtml && PROTECTED_LAYOUT_FOR_INJECT.has(layoutFromHtml))
  ) {
    return html;
  }

  const dom = new JSDOM(
    `<!doctype html><html><body><div id="__noppt_inject_root">${html}</div></body></html>`,
  );
  const doc = dom.window.document;
  const wrap = doc.getElementById('__noppt_inject_root');
  const outer = wrap?.firstElementChild as HTMLElement | null;
  if (!wrap || !outer) return html;
  // 行布局根容器（flex-direction:row）不适合再追加分栏行，避免把正文挤成 0 宽
  const outerStyle = outer.getAttribute('style') || '';
  if (/flex-direction\s*:\s*row/i.test(outerStyle) && !/flex-direction\s*:\s*column/i.test(outerStyle)) {
    return html;
  }
  const h2 = outer.querySelector('h2');
  if (!h2) return html;

  // 正文容器：优先取 h2 的后续同级节点；否则取「包含 h2 的直接子元素」之后的直接子元素
  const isMeaningful = (el: HTMLElement): boolean => {
    if (el.matches('ul,ol,p,table,section,article')) return true;
    if (el.querySelector('ul,ol,p,table,li')) return true;
    return (el.textContent || '').trim().length >= 20;
  };
  let body: HTMLElement | undefined;
  const h2Siblings = Array.from(h2.parentElement?.children ?? []) as HTMLElement[];
  const h2Idx = h2Siblings.indexOf(h2);
  if (h2Idx >= 0) body = h2Siblings.slice(h2Idx + 1).find(isMeaningful);
  if (!body) {
    const children = Array.from(outer.children) as HTMLElement[];
    const anchorIdx = children.findIndex((c) => c === h2 || c.contains(h2));
    if (anchorIdx >= 0) body = children.slice(anchorIdx + 1).find(isMeaningful);
  }
  if (!body) return html;

  const ratio: ImageRatio = pageType === 'content-image-top' ? '21:9' : '4:3';
  const makeImg = (): HTMLElement => {
    const img = doc.createElement('img');
    img.setAttribute('src', IMAGE_PLACEHOLDER);
    img.setAttribute('data-image-ratio', ratio);
    img.setAttribute(
      'style',
      'width:100%;height:100%;object-fit:cover;border-radius:16px;display:block;',
    );
    return img;
  };
  const makeDiv = (style: string): HTMLElement => {
    const div = doc.createElement('div');
    div.setAttribute('style', style);
    return div;
  };

  const row = makeDiv(
    pageType === 'content-image-top'
      ? 'flex:1;display:flex;flex-direction:column;gap:24px;align-items:stretch;min-height:0;min-width:0;'
      : 'flex:1;display:flex;gap:40px;align-items:stretch;min-height:0;min-width:0;',
  );
  if (pageType === 'content-image-top') {
    const banner = makeDiv(
      'width:100%;max-height:200px;min-height:0;display:flex;overflow:hidden;border-radius:16px;',
    );
    banner.appendChild(makeImg());
    const contentWrap = makeDiv(
      'flex:1;display:flex;flex-direction:column;gap:16px;min-height:0;min-width:0;justify-content:space-evenly;overflow:hidden;',
    );
    contentWrap.appendChild(body); // DOM append 即自动从原位置「移动」整段正文节点
    row.appendChild(banner);
    row.appendChild(contentWrap);
  } else {
    const imageCol = makeDiv(
      'flex:0 0 45%;display:flex;align-items:stretch;min-height:0;min-width:0;overflow:hidden;border-radius:16px;',
    );
    imageCol.appendChild(makeImg());
    const contentCol = makeDiv(
      'flex:0 0 55%;display:flex;flex-direction:column;gap:16px;min-height:0;min-width:0;overflow:hidden;justify-content:space-evenly;',
    );
    contentCol.appendChild(body);
    if (pageType === 'content-image-right') {
      row.appendChild(contentCol);
      row.appendChild(imageCol);
    } else {
      row.appendChild(imageCol);
      row.appendChild(contentCol);
    }
  }
  outer.appendChild(row);

  const rebuilt = wrap.innerHTML;
  // 不变量校验：占位符已注入，且可见文本一个字都没丢，否则 fail-safe 回退原 HTML
  if (!rebuilt.includes(IMAGE_PLACEHOLDER)) return html;
  if (visibleTextLength(rebuilt) < visibleTextLength(html)) return html;
  return rebuilt;
}

/** 可见文本长度（去标签/去注释/去空白），用于后处理「文本不许丢失」不变量校验 */
export function visibleTextLength(html: string): number {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, '').length;
}

export function injectBackgroundPlaceholder(html: string): string {
  const firstDivMatch = html.match(/^(<div\b[^>]*>)/i);
  if (!firstDivMatch) return html;
  const openTag = firstDivMatch[1];
  const styleMatch = openTag.match(/style="([^"]*)"/i);
  const bgStyle =
    "background-image:linear-gradient(rgba(255,255,255,0.88),rgba(255,255,255,0.88)),url('https://NOPPT_BG_PLACEHOLDER');background-size:cover;background-position:center;background-repeat:no-repeat;";
  if (!styleMatch) {
    return html.replace(/^<div\b/i, `<div style="${bgStyle}"`);
  }
  const style = styleMatch[1];
  if (style.includes('NOPPT_BG_PLACEHOLDER') || style.includes('background-image')) {
    return html;
  }
  const cleanedStyle = style
    .replace(/background-color\s*:[^;]*;?/gi, '')
    .replace(/background\s*:[^;]*;?/gi, '');
  const newStyle = bgStyle + cleanedStyle;
  return html.replace(/style="[^"]*"/i, `style="${newStyle}"`);
}

export function removeBackgroundPlaceholder(slide: HTMLSlide) {
  slide.html = slide.html
    .replace(
      /background-image:\s*linear-gradient\([^)]*\)\s*,\s*url\(['"]?https:\/\/NOPPT_BG_PLACEHOLDER['"]?\)[^;]*;?/gi,
      '',
    )
    .replace(/background-image:\s*url\(['"]?https:\/\/NOPPT_BG_PLACEHOLDER['"]?\)[^;]*;?/gi, '')
    .replace(/background-size:\s*cover[^;]*;?/gi, '')
    .replace(/background-position:\s*center[^;]*;?/gi, '')
    .replace(/background-repeat:\s*no-repeat[^;]*;?/gi, '');
}
