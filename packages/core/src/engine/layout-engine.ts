import { generateId, generatePresentationId } from '../utils/id';
import type { Slide, Presentation } from '../models/slide';
import {
  parseStyleDeclarations,
  enforceImageStyles,
  enforceMinFontSize,
  enforceFlexChildrenMinWidth,
  enforceTextWrapping,
  enforceFlatStructure,
  enforceGridLayout,
  applyCompositionGuard,
} from './visual-fixes';

const DEFAULT_HTML = `
<div style="width: 100%; height: 100%; background-color: #fff; overflow: hidden; position: relative; box-sizing: border-box; padding: 0px;">
  <h1
    class="noppt-text-element"
    style="
      position: absolute;
      left: 530px;
      top: 200px;
      display: inline-block;
      width: auto;
      height: auto;
      padding: 4px 8px;
      font-size: 48px;
      line-height: 1.2;
      color: #1e293b;
      margin: 0;
      white-space: pre-wrap;
      word-break: break-word;
      background: transparent;
      user-select: text;
    "
  >新幻灯片</h1>
</div>
`.trim();

function removeEmptyDefaultContainer(html: string): string {
  const firstDivMatch = html.match(/^<div\b([^>]*)>[\s\S]*?<\/div>/i);
  if (!firstDivMatch) return html;
  const firstDiv = firstDivMatch[0];
  const firstTagEnd = firstDiv.indexOf('>');
  const firstCloseIdx = firstDiv.indexOf('</div>');
  const inner = firstDiv.substring(firstTagEnd + 1, firstCloseIdx).trim();
  if (inner.length > 0) return html;
  const firstAttrs = firstDivMatch[1] || '';
  const hasFlexStyles =
    /display\s*:\s*flex|justify-content\s*:|align-items\s*:|background-color\s*:\s*#f8fafc/i.test(
      firstAttrs,
    );
  if (!hasFlexStyles) return html;
  const afterFirstDiv = html.substring(firstDiv.length).trim();
  if (afterFirstDiv.length === 0) return html;
  return afterFirstDiv;
}

const COVER_CONTENT_SIGN_RE = /<h[23]\b|<(ul|ol)\b|<img[\s>]|<table\b/i;
// 多列 / 分栏结构标记：网格列定义、行向 flex、定宽百分比列（如 flex:0 0 40%）→ 内容页，禁止居中。
const COVER_MULTI_COL_RE =
  /grid-template-columns\s*:|display\s*:\s*(?:inline-)?grid\b|flex-direction\s*:\s*row\b|flex\s*:\s*0\s+0\s+\d+%/i;

/**
 * 居中护栏单一真源（与 @noppt/ai 侧 ensureOuterContainer / enforceCoverPosterArtStyles 共用）。
 * 仅当 HTML 片段「只有标题、无任何内容标记、且非多列/分栏结构」时才判为封面式可居中，
 * 否则一律禁止注入「justify-content/align-items/text-align : center」三件套，
 * 避免内容页（尤其是图片被删后误判为「仅标题」的页面）被强制居中、构图被破坏。
 */
export function isCoverLikeHtml(innerHtml: string): boolean {
  const clean = innerHtml.replace(/<!--[\s\S]*?-->/g, '');
  if (COVER_CONTENT_SIGN_RE.test(clean) || COVER_MULTI_COL_RE.test(clean)) return false;
  const low = clean.toLowerCase();
  const h1Count = (low.match(/<h1\b/g) || []).length;
  return h1Count >= 1;
}

function extractBackgroundStyles(styleStr: string): Record<string, string> | null {
  const bgKeys = [
    'background-image',
    'background-size',
    'background-position',
    'background-repeat',
    'background',
  ];
  const bgStyles: Record<string, string> = {};
  for (const { key, value } of parseStyleDeclarations(styleStr)) {
    if (bgKeys.includes(key)) {
      bgStyles[key] = value;
    }
  }
  return Object.keys(bgStyles).length > 0 ? bgStyles : null;
}

function normalizeOuterContainer(html: string): string {
  let result = html.trim();
  if (!result) return DEFAULT_HTML;

  result = removeEmptyDefaultContainer(result);

  const FULL_FONT =
    "system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,'Noto Sans SC','PingFang SC','Microsoft YaHei',sans-serif";

  // ============================================================
  // 🛡️ 强信任第一道防线：如果外层就是合规容器（ok8），直接 return，
  // 根本不做栈 flatten / wrapWithContainer 重写。
  // ============================================================
  const firstOuter = /^<(div|section|article)\b([^>]*)>/.exec(result);
  if (firstOuter) {
    const tagName = firstOuter[1];
    const attrs = firstOuter[2] || '';
    const cls = (attrs.match(/class="([^"]*)"/i) || [, ''])[1];
    if (!/noppt-/.test(cls)) {
      const styleMatch = attrs.match(/style="([^"]*)"/i);
      const existingStyle = (styleMatch ? styleMatch[1] : '').trim();
      if (existingStyle) {
        const has = (r: RegExp) => r.test(existingStyle);
        const ok8 =
          has(/(?:^|;)\s*width\s*:\s*100%\s*(?:;|$)/i) &&
          has(/(?:^|;)\s*height\s*:\s*100%\s*(?:;|$)/i) &&
          has(/(?:^|;)\s*overflow\s*:\s*hidden\s*(?:;|$)/i) &&
          has(/(?:^|;)\s*position\s*:\s*relative\s*(?:;|$)/i) &&
          has(/(?:^|;)\s*box-sizing\s*:\s*border-box\s*(?:;|$)/i) &&
          has(/(?:^|;)\s*display\s*:\s*flex\s*(?:;|$)/i) &&
          has(/(?:^|;)\s*flex-direction\s*:\s*(?:column|row)\s*(?:;|$)/i);
        if (ok8) {
          // 只缺字段追加，已有值一字不改
          let safeStyle = existingStyle;
          const addIfMissing = (prop: string, fallback: string) => {
            if (
              !new RegExp(
                `(?:^|;)\\s*${prop.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:`,
                'i',
              ).test(`;${safeStyle}`)
            ) {
              safeStyle = safeStyle.endsWith(';')
                ? `${safeStyle}${prop}:${fallback}`
                : `${safeStyle};${prop}:${fallback}`;
            }
          };
          if (/(?:^|;)\s*padding\s*:\s*0(?:px)?\s*(?:;|$)/i.test(safeStyle)) {
            safeStyle = safeStyle.replace(
              /(padding\s*:\s*)0(?:px)?\s*(;|$)/i,
              (_m, p, s) => `${p}${defaultPadYx()}${s || ';'}`,
            );
          }
          if (!/(?:^|;)\s*background(?:-color)?\s*:/i.test(`;${safeStyle}`))
            safeStyle += ';background-color:#fff';
          addIfMissing('font-family', FULL_FONT);
          // 居中护栏：仅封面式页面（仅标题、无内容标记、非多列/分栏）才注入居中三件套；
          // 内容页 / 多列页 / 图片被删后误判为「仅标题」的页面一律禁止居中，保护原有构图。
          if (isCoverLikeHtml(result)) {
            addIfMissing('justify-content', 'center');
            addIfMissing('align-items', 'center');
            addIfMissing('text-align', 'center');
          }
          const newAttrs = styleMatch
            ? attrs.replace(/style="[^"]*"/i, `style="${safeStyle}"`)
            : `${attrs} style="${safeStyle}"`;
          // 闭合 tag 匹配：只找外层开头 tagName 的同级最后 </tagName>
          const rest = result.substring(firstOuter[0].length);
          const closeTag = `</${tagName.toLowerCase()}>`;
          let dep = 1;
          let close = -1;
          const scanRe = new RegExp(`<(/?)(${tagName})\\b([^>]*)>`, 'gi');
          let mm: RegExpExecArray | null;
          while ((mm = scanRe.exec(rest)) !== null) {
            if (mm[1] === '/') {
              dep--;
              if (dep === 0) {
                close = mm.index;
                break;
              }
            } else if (!/\/\s*$/.test(mm[3] || '')) {
              dep++;
            }
          }
          if (close >= 0) {
            const inner = rest.substring(0, close);
            const after = rest.substring(close + closeTag.length);
            return `<${tagName.toLowerCase()}${newAttrs}>${inner}</${tagName.toLowerCase()}>${after}`;
          }
        }
      }
    }
  }

  // 解析 HTML 片段，判断任意层级打开标签是否是「幻灯片根容器」
  // 即：<div|section|article> + width:100% height:100% + (position:relative 或 box-sizing:border-box 或 overflow:hidden)
  // 同时不能是 noppt- 用户元素，不能是 position:absolute
  const isSlideRootWrapperTag = (tagName: string, attrs: string): boolean => {
    const tn = tagName.toLowerCase();
    if (tn !== 'div' && tn !== 'section' && tn !== 'article') return false;
    if (/noppt-/.test((attrs.match(/class="([^"]*)"/i) || [, ''])[1])) return false;
    const styleMatch = attrs.match(/style="([^"]*)"/i);
    if (!styleMatch) return false;
    const st: Record<string, string> = {};
    for (const { key, value } of parseStyleDeclarations(styleMatch[1])) {
      st[key] = value;
    }
    if (st['position'] === 'absolute') return false;
    if (st['left'] || st['top']) return false;
    const widthOk = st['width'] === '100%';
    const heightOk = st['height'] === '100%';
    const markerOk =
      st['position'] === 'relative' ||
      st['box-sizing'] === 'border-box' ||
      st['overflow'] === 'hidden' ||
      st['display'] === 'flex';
    return widthOk && heightOk && markerOk;
  };

  // 预扫描：提取最外层 slide 根容器上的背景相关样式，避免扁平化后丢失
  let preservedBgStyles: Record<string, string> | null = null;
  const firstOuterTag = /^<([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>/.exec(result);
  if (firstOuterTag && isSlideRootWrapperTag(firstOuterTag[1], firstOuterTag[2])) {
    const styleMatch = firstOuterTag[2].match(/style="([^"]*)"/i);
    if (styleMatch) {
      preservedBgStyles = extractBackgroundStyles(styleMatch[1]);
    }
  }

  // 扫描整个 HTML 片段，提取「真正的内容节点」（即不包括任何 slide 根容器本身，只包括它们内部和顶级上的非 slide 根容器元素）
  // 通过遍历标签栈来实现：
  //   - 遇到 slide 根容器打开标签：跳过（不记录开始/结束标签本身），但记录其内部内容
  //   - 遇到非 slide 根容器的打开/关闭/自闭合标签：记录整段原文
  //   - 遇到文本节点/注释：记录
  // 这样无论嵌套多少层 slide 根容器，最终只输出它们内部真正的内容
  const anyTag = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>/g;
  let lastIndex = 0;
  const flattenOutput: string[] = [];
  // 用于标记「当前在哪些 slide 根容器内部」——这些容器自身的开闭标签不会记录
  const tagStack: { tag: string; isSlideRoot: boolean }[] = [];
  let match: RegExpExecArray | null;
  while ((match = anyTag.exec(result)) !== null) {
    const before = result.substring(lastIndex, match.index);
    if (before.length > 0) flattenOutput.push(before);
    lastIndex = anyTag.lastIndex;
    const isClose = match[1] === '/';
    const tagName = match[2];
    const attrs = match[3] || '';
    const isSelfClosing =
      /\/\s*$/.test(attrs.trim()) ||
      /^(img|br|hr|input|meta|link|base|wbr|source|track|embed|param|col)$/i.test(tagName);
    if (!isClose && !isSelfClosing) {
      const isSlideRoot = isSlideRootWrapperTag(tagName, attrs);
      tagStack.push({ tag: tagName.toLowerCase(), isSlideRoot });
      if (!isSlideRoot) {
        flattenOutput.push(match[0]);
      }
    } else if (isSelfClosing) {
      // 自闭合标签永远不会是 slide 根容器（slide 根容器必须有内部内容）
      flattenOutput.push(match[0]);
    } else {
      // 闭合标签：弹栈
      let popTag: { tag: string; isSlideRoot: boolean } | null = null;
      for (let i = tagStack.length - 1; i >= 0; i--) {
        if (tagStack[i].tag === tagName.toLowerCase()) {
          popTag = tagStack[i];
          tagStack.splice(i, 1);
          break;
        }
      }
      // 不记录 slide 根容器的闭合标签
      if (!popTag || !popTag.isSlideRoot) {
        flattenOutput.push(match[0]);
      }
    }
  }
  // 追加最后一个标签之后的内容
  if (lastIndex < result.length) {
    flattenOutput.push(result.substring(lastIndex));
  }

  let flattenedContent = flattenOutput.join('').trim();

  // 如果 flatten 之后内容为空（不应该发生，但兜底），返回默认
  if (!flattenedContent) return DEFAULT_HTML;

  // 移除用户元素上错误的容器样式（保持原 stripContainerStylesFromUserElements 行为）
  flattenedContent = stripContainerStylesFromUserElements(flattenedContent);

  // 最终判断：flattenedContent 里面有没有任何绝对定位元素？
  // 注意：这里不再用 analyzeTopLevelStructure，而是直接扫描内容
  const hasAbsolute = /style="[^"]*position\s*:\s*absolute/i.test(flattenedContent);

  // 只调用一次 wrapWithContainer，带上保留的背景样式
  const wrapped = wrapWithContainer(flattenedContent, !hasAbsolute, preservedBgStyles);
  // 引用未使用的辅助函数，避免 TS unused 报错（保留以兼容历史代码）
  void analyzeTopLevelStructure;
  void mergeStrayElementsIntoContainer;
  return wrapped;
}

function analyzeTopLevelStructure(html: string): {
  isSingleDiv: boolean;
  hasAbsoluteChildren: boolean;
} {
  const openTagEnd = html.indexOf('>');
  if (openTagEnd === -1) return { isSingleDiv: false, hasAbsoluteChildren: false };
  const firstTagName = html.substring(1, openTagEnd).split(/[\s>]/)[0].toLowerCase();
  if (firstTagName !== 'div' && firstTagName !== 'section' && firstTagName !== 'article') {
    return { isSingleDiv: false, hasAbsoluteChildren: false };
  }
  const rest = html.substring(openTagEnd + 1);
  let depth = 1;
  let hasAbsoluteChildren = false;
  const tagRe = /<(\/?)(div|section|article)\b([^>]*)>/gi;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(rest)) !== null) {
    if (m[1] === '/') {
      depth--;
    } else {
      if (depth === 1 && /position\s*:\s*absolute/i.test(m[3] || '')) {
        hasAbsoluteChildren = true;
      }
      depth++;
    }
    if (depth === 0) {
      const afterClose = rest.substring(m.index + m[0].length).trim();
      return { isSingleDiv: afterClose.length === 0, hasAbsoluteChildren };
    }
  }
  return { isSingleDiv: false, hasAbsoluteChildren };
}

function mergeStrayElementsIntoContainer(html: string): string {
  const openTagEnd = html.indexOf('>');
  if (openTagEnd === -1) return html;

  const tagStart = html.indexOf('<');
  const firstTagFull = html.substring(tagStart + 1, openTagEnd);
  const firstTagName = firstTagFull.split(/[\s>]/)[0].toLowerCase();
  if (firstTagName !== 'div' && firstTagName !== 'section' && firstTagName !== 'article')
    return html;

  const closeTag = `</${firstTagName}>`;

  const afterOpen = html.substring(openTagEnd + 1);
  let depth = 1;
  let closeIdx = -1;
  const tagRe = /<(\/?)(div|section|article)\b([^>]*)>/gi;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(afterOpen)) !== null) {
    if (m[1] === '/') {
      depth--;
    } else {
      depth++;
    }
    if (depth === 0) {
      closeIdx = openTagEnd + 1 + m.index + m[0].length;
      break;
    }
  }

  if (closeIdx === -1) return html;

  const beforeClose = html.substring(0, closeIdx - closeTag.length);
  const stray = html.substring(closeIdx).trim();

  if (!stray) return html;

  return beforeClose + stray + closeTag;
}

const CONTAINER_STYLE_KEYS = new Set([
  'width',
  'height',
  'display',
  'flex-direction',
  'overflow',
  'box-sizing',
  'justify-content',
  'align-items',
  'background-color',
  'background',
  'font-family',
]);

const CONTAINER_PADDING_PATTERN = /^48px\s+60px$/i;

function stripContainerStylesFromUserElements(html: string): string {
  return html.replace(/<div([^>]*class="[^"]*noppt-[^"]*"[^>]*)>/gi, (match, attrs) => {
    const styleMatch = attrs.match(/style="([^"]*)"/i);
    if (!styleMatch) return match;
    const styleStr = styleMatch[1];
    const declarations = parseStyleDeclarations(styleStr);
    const positionVal = declarations.find((d) => d.key === 'position')?.value;
    if (positionVal !== 'absolute') return match;
    const filtered = declarations.filter((d) => {
      if (CONTAINER_STYLE_KEYS.has(d.key)) return false;
      if (d.key === 'padding' && CONTAINER_PADDING_PATTERN.test(d.value.trim())) return false;
      return true;
    });
    const newStyle = filtered.map((d) => `${d.key}:${d.value}`).join(';');
    const newAttrs = attrs.replace(/style="[^"]*"/i, `style="${newStyle}"`);
    return `<div${newAttrs}>`;
  });
}

/**
 * B3L：动态计算根容器 padding 默认值，与 AI 端 ensureOuterContainer、
 * 前端 security.ts#computeDefaultPadding 完全一致（AI 端 60/48 基线）。
 */
function defaultPadYx(): string {
  // 与 web security.ts 保持一致：默认按 1280x720 基线
  const w = (globalThis as any).__NOPPT_SLIDE_WIDTH__ || 1280;
  const h = (globalThis as any).__NOPPT_SLIDE_HEIGHT__ || 720;
  const padX = Math.max(32, Math.round((60 * w) / 1280 / 8) * 8);
  const padY = Math.max(24, Math.round((48 * h) / 720 / 8) * 8);
  return `${padY}px ${padX}px`;
}

function wrapWithContainer(
  inner: string,
  addPadding: boolean,
  bgStyles?: Record<string, string> | null,
): string {
  const hasBgImage = bgStyles && (bgStyles['background-image'] || bgStyles['background']);
  const styles: string[] = [];
  styles.push('width:100%');
  styles.push('height:100%');
  styles.push('overflow:hidden');
  styles.push('position:relative');
  styles.push('box-sizing:border-box');
  if (addPadding) {
    styles.push(`padding:${defaultPadYx()}`);
    styles.push('display:flex');
    styles.push('flex-direction:column');
    if (!hasBgImage) styles.push('background-color:#fff');
    styles.push(
      "font-family:system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif",
    );
  } else {
    styles.push('padding:0px');
  }
  if (bgStyles) {
    for (const [k, v] of Object.entries(bgStyles)) {
      styles.push(`${k}:${v}`);
    }
  }
  return `<div style="${styles.join(';')};">${inner}</div>`;
}

function removeDangerousContent(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/on\w+="[^"]*"/gi, '')
    .replace(/on\w+='[^']*'/gi, '');
}

function cleanupEmptyDivs(html: string): string {
  let result = html;
  // 🛡️ 无罪推定：任何带 style 且 style 内容非空的空 div 一律不删（装饰块/分隔线/绝对定位视觉元素 100% 都带 style）
  // 只删除：① 完全无 style 属性，或 ② style 空字符串/只有空白的空 div（flatten 垃圾容器）
  for (let i = 0; i < 3; i++) {
    const before = result;
    result = result.replace(
      /<div(\s+[^>]*)?>\s*<\/div>/gi,
      (match: string, attrs: string | undefined) => {
        const a = (attrs || '').trim();
        const styleIdx = a.search(/style\s*=/i);
        if (styleIdx === -1) return '';
        const svm =
          a.slice(styleIdx).match(/^style\s*=\s*"([^"]*)"/i) ||
          a.slice(styleIdx).match(/^style\s*=\s*'([^']*)'/i);
        if (!svm || svm[1].trim() === '') return '';
        return match;
      },
    );
    if (result === before) break;
  }
  return result;
}

function hasVisualStyle(styleStr: string): boolean {
  const s = styleStr.toLowerCase();
  if (
    /background(?:-image|-color)?\s*:/.test(s) &&
    !/background(?:-color)?\s*:\s*(?:transparent|#fff\b|white\b|#ffffff\b|none)/i.test(s)
  )
    return true;
  if (/\bborder(?:-top|-left|-right|-bottom)?\s*:\s*[1-9]/.test(s)) return true;
  if (/box-shadow\s*:/.test(s) && !/box-shadow\s*:\s*none/i.test(s)) return true;
  return false;
}

function cleanupEmptyInlineTags(html: string): string {
  let result = html;
  for (let i = 0; i < 5; i++) {
    const before = result;
    result = result.replace(
      /<(p|span)(\s+[^>]*)?>([\s]*?)<\/\1>/gi,
      (match: string, _tag: string, attrs: string | undefined) => {
        const a = (attrs || '').trim();
        const styleMatch = a.match(/style\s*=\s*"([^"]*)"/i) || a.match(/style\s*=\s*'([^']*)'/i);
        const styleStr = styleMatch ? styleMatch[1] : '';
        if (styleStr && hasVisualStyle(styleStr)) return match;
        return '';
      },
    );
    if (result === before) break;
  }
  return result;
}

function isTrivialCircleSvg(svgInner: string): boolean {
  const inner = svgInner.trim();
  if (!inner) return true;
  if (/<(?:path|rect|polygon|polyline|line|ellipse|g|text|use)\b/i.test(inner)) return false;
  const circles = inner.match(/<circle\b/gi);
  return !!circles && circles.length <= 3;
}

function makeCheckSvg(size: number, color: string): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
}

/** 从 HTML 的主体中推断品牌主色（H2 渐变 / 左色条 / 卡片背景）。若无法推断返回 DEFAULT_BLUE。 */
function inferPrimaryColor(html: string): string {
  const DEFAULT_BLUE = '#2563eb';
  // 1) 最可信：<h2 ... background:linear-gradient(..., #hex1, #hex2 ...)> 首 stop
  const h2Grad = /<h2\b[^>]*style="[^"]*linear-gradient\s*\(\s*[^)]*\)/i.exec(html);
  if (h2Grad) {
    const stops = h2Grad[0].match(/#(?:[0-9a-f]{6}|[0-9a-f]{3})/gi) || [];
    const first = stops.find((s) => s.length === 7 || s.length === 4);
    if (first) return normalizeHex6(first);
  }
  // 2) 最常见语义色：border-left:5px solid #xxx（活力橙的条）
  const borderLeft = /border-left\s*:\s*\d+px\s+solid\s+(#[0-9a-f]{6}|#[0-9a-f]{3})/i.exec(html);
  if (borderLeft) return normalizeHex6(borderLeft[1]);
  // 3) 图标容器渐变首 stop
  const iconGrad = /background\s*:\s*linear-gradient\s*\(\s*[^)]*#[0-9a-f]{3,8}/i.exec(html);
  if (iconGrad) {
    const m = iconGrad[0].match(/#(?:[0-9a-f]{6}|[0-9a-f]{3})/i);
    if (m) return normalizeHex6(m[0]);
  }
  return DEFAULT_BLUE;
}

function normalizeHex6(hex: string): string {
  let h = hex.replace('#', '');
  if (h.length === 3) h = `${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`;
  if (h.length >= 6) return `#${h.substring(0, 6)}`.toLowerCase();
  return hex.toLowerCase();
}

function repairTrivialSvgIcons(html: string, primaryColor?: string): string {
  const effectivePrimary = primaryColor ? normalizeHex6(primaryColor) : inferPrimaryColor(html);
  let result = html;

  result = result.replace(
    /<svg\b([^>]*)>([\s\S]*?)<\/svg>/gi,
    (match: string, attrs: string, inner: string) => {
      if (!isTrivialCircleSvg(inner)) return match;

      const widthMatch = attrs.match(/\bwidth\s*=\s*["']?(\d+)/i);
      const heightMatch = attrs.match(/\bheight\s*=\s*["']?(\d+)/i);
      const w = widthMatch ? parseInt(widthMatch[1], 10) : 0;
      const h = heightMatch ? parseInt(heightMatch[1], 10) : 0;

      if (w > 40 || h > 40) return match;

      const size = w >= 10 && h >= 10 ? Math.max(14, Math.min(w, h, 22)) : 20;

      const colorMatch =
        attrs.match(/\bstroke\s*=\s*["']([^"']+)["']/i) ||
        inner.match(/\bstroke\s*=\s*["']([^"']+)["']/i);
      const color = colorMatch ? colorMatch[1] : effectivePrimary;

      return makeCheckSvg(size, color);
    },
  );

  return result;
}

function findMatchingCloseDiv(html: string, openPos: number): number {
  let depth = 1;
  const openRe = /<div\b/gi;
  const closeRe = /<\/div>/gi;
  openRe.lastIndex = openPos;
  closeRe.lastIndex = openPos;

  while (depth > 0) {
    const nextOpen = openRe.exec(html);
    const nextClose = closeRe.exec(html);
    if (!nextClose) return -1;
    if (nextOpen && nextOpen.index < nextClose.index) {
      depth++;
      closeRe.lastIndex = nextOpen.index + nextOpen[0].length;
      openRe.lastIndex = nextOpen.index + nextOpen[0].length;
    } else {
      depth--;
      if (depth === 0) return nextClose.index + nextClose[0].length;
      openRe.lastIndex = nextClose.index + nextClose[0].length;
      closeRe.lastIndex = nextClose.index + nextClose[0].length;
    }
  }
  return -1;
}

/** 判断一段 HTML 开头的左侧 SVG 图标是否为「通用占位」（check / trivial circle）。
 *  语义图标（自定义多元素 shape）返回 false，不应被剥离或替换。 */
function firstLeftIconIsGeneric(htmlSnippet: string): boolean {
  const svgOpen = /<svg\b([^>]*)>[\s\S]*?<\/svg>/i.exec(htmlSnippet);
  if (!svgOpen) return true; // 没 SVG 算通用 -> 不触发「语义图标保留」，外层仍走 hasLeftIcon 判断
  const attrs = svgOpen[1];
  const inner = svgOpen[0].substring(svgOpen[0].indexOf('>') + 1, svgOpen[0].lastIndexOf('<'));
  // (1) makeCheckSvg: 单 polyline points="20 6 9 17 4 12"
  if (/<polyline\b[^>]*points\s*=\s*["']20\s+6\s+9\s+17\s+4\s+12["']/i.test(inner)) return true;
  // (2) trivial circle svg：仅 circle 且 ≤3 个
  if (isTrivialCircleSvg(inner)) return true;
  // (3) stroke="#fff" 且在有色渐变/底色 span 内（语义图标在彩色容器里） → 不算占位，为语义图标
  // (4) 存在复杂元素（path/polygon/polyline 非 check/line 多组合等）→ 语义图标
  const hasMultipleLines = (inner.match(/<line\b/gi) || []).length >= 3;
  const hasPolygon = /<polygon\b/i.test(inner);
  const hasPath = /<path\b/i.test(inner);
  const hasExtra = /<(?:circle|ellipse|rect)\b/i.test(inner) && !isTrivialCircleSvg(inner);
  // 默认：size 很小且 stroke 不是白色 → 疑似占位（比如我们之前写死的 #2563eb check 样式）
  const wm = attrs.match(/\bwidth\s*=\s*["']?(\d+)/i);
  const hm = attrs.match(/\bheight\s*=\s*["']?(\d+)/i);
  const sz = Math.max(wm ? parseInt(wm[1], 10) : 0, hm ? parseInt(hm[1], 10) : 0);
  const stroke =
    (attrs.match(/\bstroke\s*=\s*["']([^"']+)["']/i) ||
      inner.match(/\bstroke\s*=\s*["']([^"']+)["']/i))?.[1] || '';
  const isWhiteStroke = /^#fff(?:fff)?$/i.test(stroke) || /^white$/i.test(stroke);
  // T4-FR4 HOTFIX：同样把 fill="#fff" / fill="white" 语义图标识别为非占位（图标 → 渐变容器内的白图标是语义最常见的形态）
  // 之前只看 stroke 不看 fill，导致 SVG icon（svg 本身没写 stroke，但 inner path 有 fill="#fff"）被误判为通用，进而被替换成 check。
  const fill =
    (attrs.match(/\bfill\s*=\s*["']([^"']+)["']/i) ||
      inner.match(/\bfill\s*=\s*["']([^"']+)["']/i))?.[1] || '';
  const isWhiteFill = /^#fff(?:fff)?$/i.test(fill) || /^white$/i.test(fill);
  if (isWhiteStroke || isWhiteFill || hasMultipleLines || hasPolygon || hasPath || hasExtra)
    return false;
  if (sz >= 24) return false; // 较大的图标多半是语义图标（作者精心设计的）
  return true;
}

function normalizeIconGroups(html: string, primaryColor?: string): string {
  const effectivePrimary = primaryColor ? normalizeHex6(primaryColor) : inferPrimaryColor(html);
  const makeIcon = (size: number, color?: string) => makeCheckSvg(size, color ?? effectivePrimary);
  let result = html;

  result = result.replace(
    /<ul\b([^>]*)>([\s\S]*?)<\/ul>/gi,
    (fullMatch: string, ulAttrs: string, ulInner: string) => {
      const items: { full: string; inner: string; attrs: string; hasIcon: boolean }[] = [];
      const liRegex = /<li\b([^>]*)>([\s\S]*?)<\/li>/gi;
      let liMatch: RegExpExecArray | null;
      while ((liMatch = liRegex.exec(ulInner)) !== null) {
        const liInner = liMatch[2];
        const hasSvg = /<svg\b/i.test(liInner);
        const hasMarker = /noppt-icon-marker/i.test(liInner);
        items.push({
          full: liMatch[0],
          inner: liInner,
          attrs: liMatch[1],
          hasIcon: hasSvg || hasMarker,
        });
      }

      if (items.length < 2) return fullMatch;
      const iconCount = items.filter((it) => it.hasIcon).length;
      if (iconCount === 0 || iconCount === items.length) return fullMatch;

      const normalizedItems = items.map((it) => {
        if (it.hasIcon) return it.full;
        return `<li${it.attrs}>${makeIcon(20)}${it.inner}</li>`;
      });

      return `<ul${ulAttrs}>${normalizedItems.join('')}</ul>`;
    },
  );

  const containerRe =
    /<div\b([^>]*style="[^"]*display\s*:\s*flex[^"]*flex-direction\s*:\s*column[^"]*"[^>]*)>/gi;
  let containerMatch: RegExpExecArray | null;
  const replacements: { start: number; end: number; content: string }[] = [];

  while ((containerMatch = containerRe.exec(result)) !== null) {
    const openTag = containerMatch[0];
    const openEnd = containerMatch.index + openTag.length;
    const closeEnd = findMatchingCloseDiv(result, openEnd);
    if (closeEnd === -1) continue;

    const inner = result.substring(openEnd, closeEnd - 6);

    if (/<[uo]l[\s>]/i.test(inner)) continue;

    const cardRe =
      /<div\b([^>]*style="[^"]*(?:padding\s*:\s*\d+px|border-radius\s*:\s*\d+px)[^"]*"[^>]*)>/gi;
    const cards: {
      full: string;
      attrs: string;
      inner: string;
      hasLeftIcon: boolean;
      hasRightNumber: boolean;
      start: number;
      end: number;
    }[] = [];
    let cardMatch: RegExpExecArray | null;

    while ((cardMatch = cardRe.exec(inner)) !== null) {
      const cardOpenEnd = cardMatch.index + cardMatch[0].length;
      const cardCloseEnd = findMatchingCloseDiv(inner, cardOpenEnd);
      if (cardCloseEnd === -1) continue;

      const cardInner = inner.substring(cardOpenEnd, cardCloseEnd - 6);
      const isCard =
        /padding\s*:\s*\d+px/.test(cardMatch[1]) && /border-radius\s*:\s*\d+px/.test(cardMatch[1]);
      if (!isCard) {
        cardRe.lastIndex = cardCloseEnd;
        continue;
      }

      const hasLeftSvg = /^\s*<(?:svg|span\b[^>]*>\s*<svg)/i.test(cardInner);
      const hasRightNumber = />\s*0[1-9]\s*<\/(?:span|div|b|strong)>/i.test(cardInner);

      cards.push({
        full: inner.substring(cardMatch.index, cardCloseEnd),
        attrs: cardMatch[1],
        inner: cardInner,
        hasLeftIcon: hasLeftSvg,
        hasRightNumber: hasRightNumber,
        start: cardMatch.index,
        end: cardCloseEnd,
      });

      cardRe.lastIndex = cardCloseEnd;
    }

    if (cards.length < 2) continue;
    const leftIconCount = cards.filter((c) => c.hasLeftIcon).length;
    if (leftIconCount === 0 || leftIconCount === cards.length) continue;

    const allHaveRightNumbers = cards.every((c) => c.hasRightNumber);
    let newInner = inner;
    for (let i = cards.length - 1; i >= 0; i--) {
      const c = cards[i];
      if (c.hasLeftIcon && allHaveRightNumbers) {
        // 仅当图标为「通用占位（check / trivial circle）」时剥离；
        // 语义图标（自定义 path/polygon/multi-line）一律保留，避免把作者精心画的 icon 删除。
        if (!firstLeftIconIsGeneric(c.inner)) continue;
        let cleaned = c.inner.replace(
          /^\s*<span\b[^>]*>\s*<svg\b[^>]*>[\s\S]*?<\/svg>\s*<\/span>\s*/i,
          '',
        );
        cleaned = cleaned.replace(/^\s*<svg\b[^>]*>[\s\S]*?<\/svg>\s*/i, '');
        const newCard = `<div${c.attrs}>${cleaned}</div>`;
        newInner = newInner.substring(0, c.start) + newCard + newInner.substring(c.end);
      } else if (!c.hasLeftIcon && !allHaveRightNumbers) {
        const newCard = `<div${c.attrs}>${makeIcon(20)}${c.inner}</div>`;
        newInner = newInner.substring(0, c.start) + newCard + newInner.substring(c.end);
      }
    }

    const newContainer = openTag + newInner + '</div>';
    replacements.push({
      start: containerMatch.index,
      end: closeEnd,
      content: newContainer,
    });
  }

  for (let i = replacements.length - 1; i >= 0; i--) {
    const r = replacements[i];
    result = result.substring(0, r.start) + r.content + result.substring(r.end);
  }

  return result;
}

function repairEmptySvgs(html: string): string {
  let result = html;

  result = result.replace(/<svg\b([^>]*)>\s*<\/svg>/gi, (match: string, attrs: string) => {
    if (/<(?:path|rect|circle|polygon|polyline|line|ellipse|g|text|use)\b/i.test(match))
      return match;

    const widthMatch = attrs.match(/\bwidth\s*=\s*["']?(\d+)/i);
    const heightMatch = attrs.match(/\bheight\s*=\s*["']?(\d+)/i);
    const w = widthMatch ? parseInt(widthMatch[1], 10) : 0;
    const h = heightMatch ? parseInt(heightMatch[1], 10) : 0;

    let vbW = w;
    let vbH = h;
    const vbMatch = attrs.match(/\bviewBox\s*=\s*["']([^"']+)["']/i);
    if (vbMatch) {
      const parts = vbMatch[1].split(/[\s,]+/);
      if (parts.length >= 4) {
        vbW = parseInt(parts[2], 10) || w;
        vbH = parseInt(parts[3], 10) || h;
      }
    }

    if (w >= 10 && w <= 28 && h >= 10 && h <= 28) {
      const vw = vbW || w || 16;
      const vh = vbH || h || 16;
      const cx = vw / 2;
      const cy = vh / 2;
      const r = Math.min(vw, vh) * 0.28;
      return `<svg${attrs}><circle cx="${cx}" cy="${cy}" r="${r}" fill="#fff" opacity="0.9"/></svg>`;
    }

    return match;
  });

  return result;
}

/**
 * 修复卡片网格页中 <p> 错误包裹图标 span 的问题。
 * AI 有时会生成 <p style="..."><span style="...icon...">💻</span></p>，
 * 导致图标继承 p 的 font-size/line-height/margin，产生错位和多余留白。
 * 此函数仅解包「内部只有一个 span（图标容器）、没有其他文本」的 <p>。
 */
function unwrapIconWrappingParagraph(html: string): string {
  return html.replace(
    /<p\b([^>]*)>\s*(<span\b[^>]*\b(?:display\s*:\s*inline-flex|border-radius)[^>]*>[\s\S]*?<\/span>)\s*<\/p>/gi,
    (_match: string, _pAttrs: string, innerSpan: string) => innerSpan,
  );
}

/**
 * 修复卡片强制 height:100% 导致的大面积留白。
 * 在 display:grid 容器中，如果子卡片设置了 height:100%，配合 align-content:stretch
 * 会把卡片强制拉伸到整行高度，内容不足时卡片下半部分全是空白。
 * 这里移除「卡片样式」div（有 border-radius/background/border，且不是 slide 根容器）上的
 * height:100%，让卡片高度由内容自然撑开。
 */
function removeForcedCardHeight(html: string): string {
  return html.replace(
    /<div\b([^>]*style="[^"]*")([^>]*)>/gi,
    (match: string, stylePart: string, rest: string) => {
      if (!/height\s*:\s*100%/i.test(stylePart)) return match;
      if (!/display\s*:\s*flex/i.test(stylePart)) return match;
      if (!/flex-direction\s*:\s*column/i.test(stylePart)) return match;
      if (/flex\s*:\s*1\b/.test(stylePart)) return match;
      // 排除 slide 根容器：它有 position:relative + overflow:hidden + box-sizing:border-box
      if (/position\s*:\s*relative/i.test(stylePart) && /overflow\s*:\s*hidden/i.test(stylePart))
        return match;
      // 必须是卡片样式：有 border-radius 或 background 或 border
      const looksLikeCard =
        /border-radius\s*:/i.test(stylePart) ||
        /background(?:-color)?\s*:/i.test(stylePart) ||
        /border\s*:/i.test(stylePart);
      if (!looksLikeCard) return match;
      const newStyle = stylePart.replace(/style="([^"]*)"/i, (_s: string, css: string) => {
        const cleaned = css
          .replace(/(^|;)\s*height\s*:\s*100%\s*(?=;|$)/i, '$1')
          .replace(/;;+/g, ';')
          .replace(/^;\s*/, '')
          .replace(/;\s*$/, '');
        return `style="${cleaned}"`;
      });
      return `<div${newStyle}${rest}>`;
    },
  );
}

/**
 * B3L 专用：O(N) 裸文本快速探测（与 Server 端 _serverHasBareText 等价）。
 * 无裸文本 → enforceBareTextToParagraphs 直接 return 原字符串，不重建 style。
 */
function _coreHasBareText(html: string): boolean {
  const TEXT_TAGS = new Set([
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'p',
    'li',
    'figcaption',
    'td',
    'th',
    'label',
    'button',
    'pre',
    'code',
    'blockquote',
    'sup',
    'sub',
    'textarea',
    'option',
    'title',
    'style',
    'script',
    'noscript',
    'a',
    'span',
    'strong',
    'em',
    'b',
    'i',
    'u',
    's',
    'small',
    'mark',
    'abbr',
    'cite',
    'del',
    'ins',
    'kbd',
    'q',
    'samp',
    'var',
    'time',
    'font',
  ]);
  const SELF_CLOSING = new Set([
    'br',
    'img',
    'hr',
    'input',
    'meta',
    'link',
    'wbr',
    'area',
    'base',
    'col',
    'embed',
    'source',
    'track',
  ]);
  const n = html.length;
  const ctxStack: boolean[] = [false];
  let i = 0;
  while (i < n) {
    const ch = html[i];
    if (ch !== '<') {
      if (!ctxStack[ctxStack.length - 1] && !/\s/.test(ch)) return true;
      i++;
      continue;
    }
    if (html.startsWith('<!--', i)) {
      const end = html.indexOf('-->', i);
      i = end === -1 ? n : end + 3;
      continue;
    }
    if (html.startsWith('<![CDATA[', i)) {
      const end = html.indexOf(']]>', i);
      i = end === -1 ? n : end + 3;
      continue;
    }
    if (html.startsWith('<!', i) || html.startsWith('<?', i)) {
      const end = html.indexOf('>', i);
      i = end === -1 ? n : end + 1;
      continue;
    }
    const tagEnd = html.indexOf('>', i);
    if (tagEnd === -1) {
      i++;
      continue;
    }
    const tagFull = html.slice(i, tagEnd + 1);
    const tm = tagFull.match(/^<\/?([a-zA-Z0-9]+)/);
    if (!tm) {
      i = tagEnd + 1;
      continue;
    }
    const tn = tm[1].toLowerCase();
    const closing = tagFull[1] === '/';
    const selfCls = tagFull.endsWith('/>') || SELF_CLOSING.has(tn);
    if (selfCls) {
      i = tagEnd + 1;
      continue;
    }
    if (!closing) {
      const clsMatch = tagFull.match(/class="([^"]*)"/i);
      const isNopptText = clsMatch && /\bnoppt-text-element\b/.test(clsMatch[1]);
      const inTextCtx = TEXT_TAGS.has(tn) || !!isNopptText;
      ctxStack.push(inTextCtx);
    } else {
      if (ctxStack.length > 1) ctxStack.pop();
    }
    i = tagEnd + 1;
  }
  return false;
}

/**
 * enforceBareTextToParagraphs —— 裸文本终级兜底（栈式深度优先扫描）。
 *
 * 任何进入 normalizeAISlide 的 slide.html，在离开之前都会过这一关：
 *   - 位于 div/section/article 等"布局容器"直接子位置的可见字符（未被
 *     p/li/h1~h6 等"文本容器"包裹）一律被识别为"裸文本"。
 *   - 按照换行拆分、trim 后非空的行，各自包装成带默认样式的 <p> 标签。
 *
 * 这是整个演示文稿生成链路中的"最后一公里"。即使上游 AI 端和 Server 端
 * 的各种 sanitize 都因为某种路径没被触发，这里是 LayoutEngine 层的统一
 * 出口，保证写入 JSON 的 HTML 不会出现"大片空白 + 无法选择的裸字"。
 *
 * B3L 优化：前置 O(N) 无裸文本短路 → 99% AI 返回直接 return 原字符串，
 * 避免全量重建导致 style 属性被序列化再重建。
 */
function enforceBareTextToParagraphs(html: string): string {
  if (!html) return html;
  // B3L：无裸文本直接返回，不动 style
  if (!_coreHasBareText(html)) return html;
  const DEFAULT_P_STYLE =
    'font-size:24px;color:#374151;font-weight:600;line-height:2.0;overflow-wrap:break-word;word-break:break-word;';
  // 判断：一个开标签里的 style 是否足以证明它是 Badge/胶囊 容器
  const isBadgeStyle = (openTagFull: string): boolean => {
    const sm = openTagFull.match(/style="([^"]*)"/i);
    if (!sm) return false;
    const s = sm[1];
    const has = (r: RegExp) => r.test(s);
    const score = [
      has(/display\s*:\s*(?:inline-flex|flex)\b/i),
      has(/padding\s*:[^;]*(?:1[0-9]px\s+2[0-9]px|10px\s+28px|12px\s+24px)\b/i),
      has(/border-radius\s*:[^;]*999px/i),
      has(
        /background\s*:[^;]*(?:#[0-9a-f]{6,8}1[0-9a-f]|rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*0\.0[5-9])/i,
      ),
    ].filter(Boolean).length;
    return score >= 3;
  };
  const TEXT_TAGS = new Set<string>([
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'p',
    'li',
    'figcaption',
    'td',
    'th',
    'label',
    'button',
    'pre',
    'code',
    'blockquote',
    'sup',
    'sub',
    'textarea',
    'option',
    'title',
    'style',
    'script',
    'noscript',
    'a',
    'span',
    'strong',
    'em',
    'b',
    'i',
    'u',
    's',
    'small',
    'mark',
    'abbr',
    'cite',
    'del',
    'ins',
    'kbd',
    'q',
    'samp',
    'var',
  ]);
  const CONTAINER_TAGS = new Set<string>([
    'div',
    'section',
    'article',
    'aside',
    'nav',
    'main',
    'header',
    'footer',
    'body',
    'figure',
    'ul',
    'ol',
    'table',
    'thead',
    'tbody',
    'tfoot',
    'tr',
    'form',
    'details',
    'summary',
  ]);
  const SINGLETON = new Set<string>([
    'br',
    'img',
    'hr',
    'input',
    'meta',
    'link',
    'wbr',
    'area',
    'base',
    'col',
    'embed',
    'source',
    'track',
  ]);

  const isNopptTextElement = (tagFull: string): boolean => {
    const clsMatch = tagFull.match(/class="([^"]*)"/i);
    if (!clsMatch) return false;
    return /\bnoppt-text-element\b/.test(clsMatch[1]);
  };

  interface Frame {
    tagName: string;
    openTagFull: string;
    inTextContext: boolean;
    pendingBare: string;
    isContainer: boolean;
    innerBuffer: string;
    isBadgeContainer: boolean;
  }
  const stack: Frame[] = [
    {
      tagName: '__root__',
      openTagFull: '',
      inTextContext: false,
      pendingBare: '',
      isContainer: false,
      innerBuffer: '',
      isBadgeContainer: false,
    },
  ];
  const flushBare = (frame: Frame) => {
    if (!frame.pendingBare) return;
    const lines = frame.pendingBare.split(/\r?\n/);
    let generated = '';
    for (const raw of lines) {
      const t = raw.trim();
      if (!t) continue;
      generated += `<p style="margin:0;${DEFAULT_P_STYLE}">${t}</p>`;
    }
    frame.innerBuffer += generated;
    frame.pendingBare = '';
  };
  let i = 0;
  const n = html.length;
  while (i < n) {
    if (html[i] === '<') {
      if (html.startsWith('<!--', i)) {
        const end = html.indexOf('-->', i);
        const j = end === -1 ? n : end + 3;
        const top = stack[stack.length - 1];
        if (top.inTextContext || !top.isContainer || top.isBadgeContainer)
          top.innerBuffer += html.slice(i, j);
        else {
          flushBare(top);
          top.innerBuffer += html.slice(i, j);
        }
        i = j;
        continue;
      }
      if (html.startsWith('<![CDATA[', i) || html.startsWith('<!', i) || html.startsWith('<?', i)) {
        const end = html.indexOf('>', i);
        const j = end === -1 ? n : end + 1;
        stack[stack.length - 1].innerBuffer += html.slice(i, j);
        i = j;
        continue;
      }
      const tagEnd = html.indexOf('>', i);
      if (tagEnd === -1) {
        const top = stack[stack.length - 1];
        if (top.inTextContext || !top.isContainer || top.isBadgeContainer)
          top.innerBuffer += html[i];
        else top.pendingBare += html[i];
        i++;
        continue;
      }
      const tagFull = html.slice(i, tagEnd + 1);
      const tagMatch = tagFull.match(/^<\/?([a-zA-Z0-9]+)/);
      if (!tagMatch) {
        const top = stack[stack.length - 1];
        if (top.inTextContext || !top.isContainer || top.isBadgeContainer)
          top.innerBuffer += tagFull;
        else top.pendingBare += tagFull;
        i = tagEnd + 1;
        continue;
      }
      const tagName = tagMatch[1].toLowerCase();
      const isClosing = tagFull[1] === '/';
      const isSelfClosing = tagFull.endsWith('/>') || SINGLETON.has(tagName);
      if (isSelfClosing) {
        const top = stack[stack.length - 1];
        if (!top.inTextContext && !top.isBadgeContainer && top.isContainer) flushBare(top);
        top.innerBuffer += tagFull;
        i = tagEnd + 1;
        continue;
      }
      if (!isClosing) {
        const top = stack[stack.length - 1];
        if (!top.inTextContext && !top.isBadgeContainer && top.isContainer) flushBare(top);
        const badged = isBadgeStyle(tagFull);
        const isNopptText = isNopptTextElement(tagFull);
        const inTextContext =
          top.inTextContext ||
          TEXT_TAGS.has(tagName) ||
          badged ||
          top.isBadgeContainer ||
          isNopptText;
        const isContainer = !inTextContext && CONTAINER_TAGS.has(tagName);
        stack.push({
          tagName,
          openTagFull: tagFull,
          inTextContext,
          pendingBare: '',
          isContainer,
          innerBuffer: '',
          isBadgeContainer: badged || top.isBadgeContainer,
        });
        i = tagEnd + 1;
        continue;
      } else {
        let popIdx = -1;
        for (let k = stack.length - 1; k >= 1; k--) {
          if (stack[k].tagName === tagName) {
            popIdx = k;
            break;
          }
        }
        if (popIdx === -1) {
          const top = stack[stack.length - 1];
          if (top.inTextContext || !top.isContainer || top.isBadgeContainer)
            top.innerBuffer += tagFull;
          else top.pendingBare += tagFull;
          i = tagEnd + 1;
          continue;
        }
        const popped = stack.splice(popIdx)[0];
        if (popped.isContainer && !popped.isBadgeContainer) flushBare(popped);
        const closing = `</${popped.tagName}>`;
        const assembled = popped.openTagFull + popped.innerBuffer + closing;
        const newTop = stack[stack.length - 1];
        if (!newTop.inTextContext && !newTop.isBadgeContainer && newTop.isContainer)
          flushBare(newTop);
        newTop.innerBuffer += assembled;
        i = tagEnd + 1;
        continue;
      }
    } else {
      const top = stack[stack.length - 1];
      // Badge 容器永远视为文本安全上下文，字符直接 innerBuffer 不包 p
      if (top.inTextContext || top.isBadgeContainer || !top.isContainer) top.innerBuffer += html[i];
      else top.pendingBare += html[i];
      i++;
    }
  }
  while (stack.length > 1) {
    const popped = stack.pop()!;
    if (popped.isContainer && !popped.isBadgeContainer) flushBare(popped);
    const assembled =
      popped.openTagFull +
      popped.innerBuffer +
      (popped.tagName !== '__root__' ? `</${popped.tagName}>` : '');
    stack[stack.length - 1].innerBuffer += assembled;
  }
  if (stack[0].isContainer) flushBare(stack[0]);
  return stack[0].innerBuffer;
}

/* ============================================================================
 * preventContentImageTopOverflow —— 最终兜底（LayoutEngine 层溢出防御）
 *
 * 目标：修复"上图下文（content-image-top）+ 单列长列表 + 卡片大 padding"
 *       组合导致的标题和列表内容超出 1280×720 可视区域问题。
 *
 * 检测模式（同时满足才修复，避免误伤左图右文/其他布局）：
 *   ① H2 存在 → ② 紧随一个含 <img> 且样式含 flex:0 0 XX% 的 div（图片包裹）
 *             → ③ 随后有文本 div 内含 UL/OL 且为 flex-direction:column（单列）
 *             → ④ 该列表内 li 标签数 ≥ 3（3 个以上才有高度压缩必要）
 *
 * 修复阶梯（按优先级逐层施加）：
 *   Step 1：li≥4 时，列表单列 flex → 双列 Grid；同时 li padding/字号/icon 降级紧凑
 *   Step 2：按 li 数量压缩图片容器高度（48%→40%/35%/32%）、缩小 margin-bottom
 *   Step 3：li≥5 时，H2 标题紧凑（font/margin/line-height 降级）
 *   Step 4：极限兜底，内层文本容器增加 max-height + overflow-y:auto（可视不裁切）
 * ========================================================================== */

function stringifyDecls(decls: Array<{ key: string; value: string }>): string {
  return decls.map((d) => `${d.key}:${d.value}`).join(';');
}

function setDecl(decls: Array<{ key: string; value: string }>, key: string, value: string): void {
  const idx = decls.findIndex((d) => d.key === key);
  if (idx >= 0) decls[idx].value = value;
  else decls.push({ key, value });
}
function delDecl(decls: Array<{ key: string; value: string }>, key: string): void {
  const idx = decls.findIndex((d) => d.key === key);
  if (idx >= 0) decls.splice(idx, 1);
}
function getDecl(decls: Array<{ key: string; value: string }>, key: string): string | undefined {
  return decls.find((d) => d.key === key)?.value;
}

function transformStyleAttr(
  tagStr: string,
  fn: (decls: Array<{ key: string; value: string }>) => boolean | void,
): string {
  return tagStr.replace(/style="([^"]*)"/i, (_m: string, styleVal: string) => {
    const decls = parseStyleDeclarations(styleVal);
    const changed = fn(decls);
    if (changed === false) return _m; // 显式表示没变
    return `style="${stringifyDecls(decls)}"`;
  });
}

/** 解析 style 中 flex: 0 0 XX% 的百分比（未找到返回 null） */
function parseFlexBasisPercent(styleVal: string): number | null {
  const decls = parseStyleDeclarations(styleVal);
  const flex = getDecl(decls, 'flex');
  if (flex) {
    const m = flex.match(/0\s+0\s+(\d+(?:\.\d+)?)%/);
    if (m) return parseFloat(m[1]);
  }
  const basis = getDecl(decls, 'flex-basis');
  if (basis) {
    const m = basis.match(/(\d+(?:\.\d+)?)%/);
    if (m) return parseFloat(m[1]);
  }
  return null;
}

/** 判断 UL style 是否是单列 flex（非 grid） */
function isSingleColumnFlexUl(styleVal: string): boolean {
  const decls = parseStyleDeclarations(styleVal);
  const display = (getDecl(decls, 'display') || '').toLowerCase();
  if (display === 'grid') return false;
  const flexDir = (getDecl(decls, 'flex-direction') || '').toLowerCase();
  return flexDir === 'column' || display === 'flex'; // 没写 flex-direction 默认 column（我们的布局都是 column）
}

/** 解析 grid-template-columns: repeat(N,1fr) 中的列数 N（未匹配返回 null） */
function parseGridRepeatCols(styleVal: string): number | null {
  const decls = parseStyleDeclarations(styleVal);
  const display = (getDecl(decls, 'display') || '').toLowerCase();
  if (display !== 'grid') return null;
  const gtc = getDecl(decls, 'grid-template-columns');
  if (!gtc) return null;
  const m = gtc.match(/repeat\(\s*(\d+)\s*,\s*1fr\s*\)/);
  if (m) return parseInt(m[1], 10);
  return null;
}

/** FR-5：探测「H2 -> 卡片 grid (N>=3 列) -> 底部 img」的 stats-grid-bottom-image 布局。
 *  成功返回 probe；否则返回 null（调用方再回退到 UL/OL 探测）。 */
function probeStatsGridBottomImage(html: string): VerticalLayoutProbe | null {
  const h2Re = /<h2\b([^>]*)>[\s\S]*?<\/h2>/i;
  const h2Match = html.match(h2Re);
  if (!h2Match || h2Match.index === undefined) return null;
  const h2EndAbs = h2Match.index + h2Match[0].length;
  const afterH2 = html.slice(h2EndAbs);

  // 水平双栏（img 和 grid 分别在两个 flex 兄弟列）直接跳过
  const imgRe = /<img\b([^>]*)>/i;
  const gridRe = /<div\b([^>]*style="[^"]*display\s*:\s*grid[^"]*"[^>]*)>/i;
  const imgMatch = afterH2.match(imgRe);
  const gridMatch = afterH2.match(gridRe);
  if (!imgMatch || !gridMatch) return null;
  const imgRelIdx = imgMatch.index!;
  const gridRelIdx = gridMatch.index!;

  // 仅处理 grid 在 img 之前（卡片在上、图片在下即 BOTTOM 模式）
  if (gridRelIdx > imgRelIdx) return null;
  // 若结构里还存在 UL/OL 且位置比 grid 更早，则这是「列表 + 图」老结构，走老路径
  const listRe = /<(ul|ol)\b([^>]*)>/i;
  const listMatch = afterH2.match(listRe);
  if (listMatch && listMatch.index !== undefined && listMatch.index < gridRelIdx) return null;

  // 水平双栏判定：grid 与 img 若在两个 flex:0 0 XX% 兄弟列中 → 跳过
  if (isHorizontalImageSide(afterH2, imgRelIdx, gridRelIdx)) return null;

  // grid 列数 N>=3
  const gridStyleMatch = gridMatch[1].match(/style="([^"]*)"/i);
  if (!gridStyleMatch) return null;
  const cols = parseGridRepeatCols(gridStyleMatch[1]);
  if (cols === null || cols < 3) return null;

  // 找到 imgWrap: img 之前最近一个有 flex:0 0 XX% 或 flex-basis XX% 的 div
  const beforeImg = afterH2.slice(0, imgRelIdx);
  const divOpenRe = /<div\b([^>]*)>/gi;
  let lastDivMatch: RegExpMatchArray | null = null;
  let m: RegExpExecArray | null;
  while ((m = divOpenRe.exec(beforeImg)) !== null) lastDivMatch = m;
  if (!lastDivMatch) return null;
  const imgWrapStyleMatch = lastDivMatch[1].match(/style="([^"]*)"/i);
  if (!imgWrapStyleMatch) return null;
  const flexPct = parseFlexBasisPercent(imgWrapStyleMatch[1]);
  // FR-5 兜底：即便 imgWrap 不是 flex:0 0 XX%（例如 slide-04 场景下还没加 flex basis），
  // 我们依然允许后续 Step 2 把它改造成压缩样式，这里只要求 style 声明存在；
  // 为避免误伤，我们在 flexPct === null 时额外判断：imgWrap 是否含 display:flex（即真实的 flex 容器）
  if (flexPct === null) {
    const decls = parseStyleDeclarations(imgWrapStyleMatch[1]);
    const disp = (getDecl(decls, 'display') || '').toLowerCase();
    if (disp !== 'flex') return null;
  }

  const gridOpenAbs = h2EndAbs + gridRelIdx;
  // 用列数做"虚拟 liCount"，保证 Step 2 阶梯被触发（>=3）
  return {
    mode: 'bottom',
    liCount: cols,
    ulTagName: 'ul',
    ulOpenGlobalIdx: gridOpenAbs,
    layoutKind: 'stats-grid',
    cardCols: cols,
  };
}

/** 把 UL style 从单列 flex → 双列 Grid；并返回 style 字符串（已 transform） */
function convertUlTo2ColGrid(ulOpenTag: string): string {
  return transformStyleAttr(ulOpenTag, (decls) => {
    // 替换 display / flex-direction 为 grid
    delDecl(decls, 'display');
    delDecl(decls, 'flex-direction');
    setDecl(decls, 'display', 'grid');
    setDecl(decls, 'grid-template-columns', 'repeat(2,1fr)');
    // gap：同时兼容 row/column，把单行 gap 拆分为紧凑 12px 20px
    const gap = getDecl(decls, 'gap');
    if (gap) {
      // 原 gap 可能只有一个值（如 16px），改成 row 12px / col 20px
      setDecl(decls, 'gap', '12px 20px');
    } else {
      setDecl(decls, 'gap', '12px 20px');
    }
    // 保持 list-style/ margin / padding 不变（若缺失则补齐）
    if (!getDecl(decls, 'margin')) setDecl(decls, 'margin', '0');
    if (!getDecl(decls, 'padding')) setDecl(decls, 'padding', '0');
    if (!getDecl(decls, 'list-style')) setDecl(decls, 'list-style', 'none');
    if (!getDecl(decls, 'min-width')) setDecl(decls, 'min-width', '0');
    return true;
  });
}

/** 使单个 li 样式更紧凑（双列模式）：padding/字号/icon 缩小一挡 */
function tightenLiStyle(liOpenTag: string): string {
  return transformStyleAttr(liOpenTag, (decls) => {
    let changed = false;
    // padding：16px 24px → 12px 20px
    const pad = getDecl(decls, 'padding');
    if (pad) {
      setDecl(decls, 'padding', '12px 20px');
      changed = true;
    }
    // 缩小 gap（通常是 14px → 12px）
    const gap = getDecl(decls, 'gap');
    if (gap) {
      setDecl(decls, 'gap', '12px');
      changed = true;
    }
    return changed;
  });
}

/** 缩小 li 内的文字 span 字号：24px → 20px；28px → 22px */
function tightenTextSpanInLi(spanOpenTag: string): string {
  return transformStyleAttr(spanOpenTag, (decls) => {
    let changed = false;
    const fs = getDecl(decls, 'font-size');
    if (fs) {
      const m = fs.match(/(\d+(?:\.\d+)?)px/);
      if (m) {
        const n = parseFloat(m[1]);
        if (n >= 27) {
          setDecl(decls, 'font-size', '22px');
          changed = true;
        } else if (n >= 23) {
          setDecl(decls, 'font-size', '20px');
          changed = true;
        }
      }
    }
    return changed;
  });
}

/** 缩小 li 内图标容器（40px → 36px；20px 字号 → 18px） */
function tightenIconSpanInLi(spanOpenTag: string): string {
  return transformStyleAttr(spanOpenTag, (decls) => {
    let changed = false;
    const w = getDecl(decls, 'width');
    const h = getDecl(decls, 'height');
    if (w && /40px/.test(w)) {
      setDecl(decls, 'width', '36px');
      changed = true;
    }
    if (h && /40px/.test(h)) {
      setDecl(decls, 'height', '36px');
      changed = true;
    }
    const fs = getDecl(decls, 'font-size');
    if (fs) {
      const m = fs.match(/(\d+(?:\.\d+)?)px/);
      if (m) {
        const n = parseFloat(m[1]);
        if (n >= 19) {
          setDecl(decls, 'font-size', '18px');
          changed = true;
        }
      }
    }
    return changed;
  });
}

/** 压缩 H2 标题（仅当 li≥5 时触发） */
function tightenH2(h2OpenTag: string): string {
  return transformStyleAttr(h2OpenTag, (decls) => {
    let changed = false;
    // font-size:44px → 40px
    const fs = getDecl(decls, 'font-size');
    if (fs) {
      const m = fs.match(/(\d+(?:\.\d+)?)px/);
      if (m && parseFloat(m[1]) >= 43) {
        setDecl(decls, 'font-size', '40px');
        changed = true;
      }
    }
    // margin-bottom:32px → 20px
    const mb = getDecl(decls, 'margin-bottom');
    if (mb) {
      const m = mb.match(/(\d+(?:\.\d+)?)px/);
      if (m && parseFloat(m[1]) >= 30) {
        setDecl(decls, 'margin-bottom', '20px');
        changed = true;
      }
    }
    // line-height:1.25 → 1.2
    const lh = getDecl(decls, 'line-height');
    if (lh && /1\.25/.test(lh)) {
      setDecl(decls, 'line-height', '1.2');
      changed = true;
    }
    return changed;
  });
}

/** 探测 H2 后垂直布局中「图片容器 + 列表」或「卡片 grid + 底部图片」的模式：
 *  - 'top'    →  图片(flex:0 0 XX%) 在列表之前（真正的上图下文）
 *  - 'bottom' →  列表/卡片grid 在图片之前（LLM把顺序调换了，即"下文上图"，DOM顺序bottom化）
 *  探测失败返回 null（不进入修复）
 */
interface VerticalLayoutProbe {
  mode: 'top' | 'bottom';
  liCount: number; // ul-list: 实际 li 数; stats-grid: 用列数（用于阶梯判定）
  ulTagName: 'ul' | 'ol'; // 仅 ul-list 模式有意义；stats-grid 占位为 'ul'
  ulOpenGlobalIdx: number; // UL/OL 或卡片 grid div 开标签在整 html 中的起始下标
  layoutKind: 'ul-list' | 'stats-grid';
  cardCols?: number; // stats-grid 时的列数（N>=3）
}
/** 探测 H2 后是否存在「水平双栏」布局：
 *  - 在 afterH2 最近的一级（未遇到 UL/OL 前）里，若发现一对兄弟 div：
 *      ① flex:0 0 XX%（含 <img>）     ② flex:0 0 YY%（含 <ul/ol>）   或顺序相反，
 *    且两者都挂在同一个「flex row 容器」下 → 认定为水平排布，跳过垂直压缩。 */
function isHorizontalImageSide(afterH2: string, imgRelIdx: number, listRelIdx: number): boolean {
  // 找两个 flex:0 0 XX% 的子容器各自的 <div 起始位置，
  // 允许 imageWrap 在 list 前或后（图左文右 / 文左图右）。
  // 先找 imgWrap：imgRelIdx 前最后一个 <div ... style="...flex:0 0 XX%...">（满足 parseFlexBasisPercent）。
  const beforeImg = afterH2.slice(0, imgRelIdx);
  const lastFlexDivBeforeImg = findLastFlexBasisDiv(beforeImg);
  if (!lastFlexDivBeforeImg) return false;

  // 再找 listWrap：listRelIdx 前最后一个 <div ... style="...flex:0 0 XX%...">
  const beforeList = afterH2.slice(0, listRelIdx);
  const lastFlexDivBeforeList = findLastFlexBasisDiv(beforeList);
  if (!lastFlexDivBeforeList) return false;

  // 两者必须是不同 div（两个分栏），且 imgWrap 应该包含图片、listWrap 应该包含 list，顺序无关。
  // —— T5-FR5 HOTFIX②：在"img 列 45%（图左文右）→ 紧接着 ul 无外层 div"的结构下，
  //   beforeList 内 lastFlexDivBeforeList.start === lastFlexDivBeforeImg.start 并非"真 listWrap"，
  //   说明列表本身就没有 flex:0 0 XX% wrapper（ai 直接把 ul 当列）；此时不能因为找不到第二个 flex div 就判失败，
  //   应直接回退：如果两个 flex 锚定同一列，且另一列实际是 <ul> 本身（紧挨该列之后），
  //   我们只需证明 img 列 + ul 在同一个 flex row 父容器里 → 算作水平双栏（listWrap 当成 0 0 55% 虚拟列）。
  if (lastFlexDivBeforeList.start === lastFlexDivBeforeImg.start) {
    // 检查在"img 列之后 + listRelIdx 之前"是否存在紧接的 ul/ol 开标签
    const between = afterH2.slice(lastFlexDivBeforeImg.start + 1, listRelIdx);
    // 需出现过 </div> 关闭 img 列，且随后没有第二个 div.flex wrapper，才是"裸 ul"结构
    const closed = /<\/div>/i.test(between);
    const noSecondFlexDiv = findFirstFlexBasisDiv(between) === null;
    if (closed && noSecondFlexDiv) {
      const [imgStart, imgPct] = [lastFlexDivBeforeImg.start, lastFlexDivBeforeImg.pct];
      // 推断 list 列为 100% - imgPct（四舍五入到 55/45/60/40/65/35 这几种常见比例都合法）
      const listPctInferred = Math.round(100 - imgPct);
      const sumPct = imgPct + listPctInferred;
      if (sumPct < 95 || sumPct > 105) return false;
      const earliest = imgStart;
      const beforeBoth = afterH2.slice(0, earliest);
      const probeWindow =
        beforeBoth.endsWith('>') === false
          ? afterH2.slice(0, Math.min(afterH2.length, earliest + 120))
          : beforeBoth;
      const rowParent = findLastFlexRowParent(probeWindow);
      if (rowParent === null) return false;
      return true;
    }
    // 否则尝试在 img 列之后扫描第二个 flex:0 0 XX% 作为真 listWrap 兜底
    const afterImgDiv = afterH2.slice(lastFlexDivBeforeImg.start + 1, listRelIdx);
    const rewind = findFirstFlexBasisDiv(afterImgDiv);
    if (rewind) {
      lastFlexDivBeforeList.start = lastFlexDivBeforeImg.start + 1 + rewind.start;
      lastFlexDivBeforeList.pct = rewind.pct;
    }
    if (lastFlexDivBeforeList.start === lastFlexDivBeforeImg.start) return false;
  }
  const [imgStart, imgPct] = [lastFlexDivBeforeImg.start, lastFlexDivBeforeImg.pct];
  const [listStart, listPct] = [lastFlexDivBeforeList.start, lastFlexDivBeforeList.pct];
  const sumPct = imgPct + listPct;
  if (sumPct < 85 || sumPct > 110) return false;

  // 找到更早的父级容器（display:flex 且 flex-direction 非 column 或缺省）：
  // 取两个 start 中较小者的之前的片段，找最后一个 display:flex 的外层。
  const earliest = Math.min(imgStart, listStart);
  const beforeBoth = afterH2.slice(0, earliest);
  // T5-FR5 HOTFIX：如果 beforeBoth 内部就只有 <div…> 开标签（beforeBoth 从 afterH2 开头开始、
  // beforeH2 只有一个 row 容器），那么 beforeBoth 的末尾应当正好落在子列开标签之前；
  // 但 beforeBoth 若未以 > 结尾说明没有包含 row 容器结束 >，
  // 导致 findLastFlexRowParent 把内部 flex 样式当成属性片段而非完整开标签 → 正则无法命中。
  // 此时将 beforeBoth 向后补最多 120 字符，使其包含第一个完整开标签再扫描父级 row。
  const probeWindow =
    beforeBoth.endsWith('>') === false
      ? afterH2.slice(0, Math.min(afterH2.length, earliest + 120))
      : beforeBoth;
  const rowParent = findLastFlexRowParent(probeWindow);
  // T5-FR5 HOTFIX：rowParent === 0 是合法值（row 容器出现在 afterH2 开头，极常见），
  // 不能用 if (!rowParent) 判定——必须显式 === null，避免 index=0 被误判为"未找到"。
  if (rowParent === null) return false;

  // 两个 flex div 的 start 都应当在 rowParent 之后（属于其 children），这已由 beforeBoth 定义保证。
  return true;
}

/** 在片段里找"第一个" flex:0 0 XX% 开标签（用于在已知列之后定位第二个分栏 div） */
function findFirstFlexBasisDiv(text: string): { start: number; pct: number } | null {
  const re = /<div\b([^>]*)>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const attrs = m[1];
    const sm = attrs.match(/style="([^"]*)"/i);
    if (!sm) continue;
    const p = parseFlexBasisPercent(sm[1]);
    if (p !== null) return { start: m.index, pct: p };
  }
  return null;
}

function findLastFlexBasisDiv(text: string): { start: number; pct: number } | null {
  const re = /<div\b([^>]*)>/gi;
  let best: { start: number; pct: number } | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const attrs = m[1];
    const sm = attrs.match(/style="([^"]*)"/i);
    if (!sm) continue;
    const p = parseFlexBasisPercent(sm[1]);
    if (p !== null) best = { start: m.index, pct: p };
  }
  return best;
}

function findLastFlexRowParent(text: string): number | null {
  // 找最后一个 display:flex / display:inline-flex 的开标签，且 flex-direction ≠ column。
  const re = /<(?:div|section|article)\b([^>]*)>/gi;
  let bestIdx: number | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const attrs = m[1];
    const sm = attrs.match(/style="([^"]*)"/i);
    if (!sm) continue;
    const decls = parseStyleDeclarations(sm[1]);
    const display = (getDecl(decls, 'display') || '').toLowerCase();
    if (display !== 'flex' && display !== 'inline-flex') continue;
    const fd = (getDecl(decls, 'flex-direction') || '').toLowerCase();
    if (fd === 'column' || fd === 'column-reverse') continue;
    bestIdx = m.index;
  }
  return bestIdx;
}

function probeVerticalImageLayout(html: string): VerticalLayoutProbe | null {
  const h2Re = /<h2\b([^>]*)>[\s\S]*?<\/h2>/i;
  const h2Match = html.match(h2Re);
  if (!h2Match || h2Match.index === undefined) return null;
  const h2EndAbs = h2Match.index + h2Match[0].length;
  const afterH2 = html.slice(h2EndAbs);

  // 同时找 H2 之后第一个 <img> 和第一个 <ul/ol>
  const imgRe = /<img\b([^>]*)>/i;
  const listRe = /<(ul|ol)\b([^>]*)>/i;
  const imgMatch = afterH2.match(imgRe);
  const listMatch = afterH2.match(listRe);
  if (!imgMatch || !listMatch) return null;
  const imgRelIdx = imgMatch.index!;
  const listRelIdx = listMatch.index!;

  // T2-FR2: 先判定「水平双栏」：如果 img / list 分别在两个 flex:0 0 XX% 兄弟分栏中
  // （且两者百分比之和接近一整行，父容器为 flex row），则为水平布局，
  // 垂直压缩 + 双列 grid 均不应介入 → 直接返回 null 跳过修复。
  if (isHorizontalImageSide(afterH2, imgRelIdx, listRelIdx)) return null;

  // 决定谁在前：
  //   TOP    → img 在 list 之前（imgRelIdx < listRelIdx）
  //   BOTTOM → list 在 img 之前（listRelIdx < imgRelIdx）
  const mode: 'top' | 'bottom' = imgRelIdx < listRelIdx ? 'top' : 'bottom';

  // 无论哪种模式，都必须找到「包裹 <img> 且有 flex:0 0 XX% 的 div」作为图片压缩目标
  // 如果是 TOP 模式，这个 imgWrap 在 beforeImg（img 前）中查找最后一个 div；
  // 如果是 BOTTOM 模式，这个 imgWrap 也在 <img> 前（即列表与 img 之间）找最后一个 div。
  const beforeImg = afterH2.slice(0, imgRelIdx);
  const divOpenRe = /<div\b([^>]*)>/gi;
  let lastDivMatch: RegExpMatchArray | null = null;
  let m: RegExpMatchArray | null;
  while ((m = divOpenRe.exec(beforeImg)) !== null) lastDivMatch = m;
  if (!lastDivMatch) return null;
  const imgWrapStyleMatch = lastDivMatch[1].match(/style="([^"]*)"/i);
  if (!imgWrapStyleMatch) return null;
  const flexPct = parseFlexBasisPercent(imgWrapStyleMatch[1]);
  if (flexPct === null) return null;

  // 验证列表是单列 flex（未被 Grid 化）
  const listAttrs = listMatch[2];
  const listStyleMatch = listAttrs.match(/style="([^"]*)"/i);
  if (listStyleMatch && !isSingleColumnFlexUl(listStyleMatch[1])) return null;

  // 数 li
  const ulOpenAbs = h2EndAbs + listRelIdx;
  const tag = (listMatch[1] as 'ul' | 'ol').toLowerCase() as 'ul' | 'ol';
  const ulCloseAbs = findMatchingClose(html, ulOpenAbs, tag);
  if (ulCloseAbs === -1) return null;
  const ulInner = html.slice(ulOpenAbs, ulCloseAbs);
  const liCount = (ulInner.match(/<li\b/gi) || []).length;
  if (liCount === 0) return null;

  return { mode, liCount, ulTagName: tag, ulOpenGlobalIdx: ulOpenAbs, layoutKind: 'ul-list' };
}

function preventContentImageTopOverflow(html: string): string {
  // ------------------- ① 特征匹配：TOP or BOTTOM 垂直图片列表布局 -------------------
  // FR-5：先探测「卡片 grid + 底部图片」stats-grid-bottom-image；再回退到 UL/OL 老布局
  let probe: VerticalLayoutProbe | null = probeStatsGridBottomImage(html);
  if (!probe) probe = probeVerticalImageLayout(html);
  if (!probe) return html;
  const { mode, liCount, layoutKind } = probe;

  // ------------------- ② 根据 li 数量进入不同修复阶梯 -------------------
  let output = html;
  let repaired = false;

  // Step 1：li>=4，单列 → 双列 Grid，并紧凑化 li 卡片样式（TOP/BOTTOM 都需要，因为高度瓶颈相同）
  // FR-5：stats-grid 模式下卡片本身就是 display:grid with N>=3 列，跳过 Step 1（不做转双列/li 紧凑化）
  if (layoutKind !== 'stats-grid' && liCount >= 4) {
    output = output.replace(/(<(ul|ol)\b[^>]*>)/i, (fullMatch) => {
      const newTag = convertUlTo2ColGrid(fullMatch);
      if (newTag !== fullMatch) repaired = true;
      return newTag;
    });
    output = output.replace(/<li\b([^>]*)>/gi, (m) => {
      const r = tightenLiStyle(m);
      if (r !== m) repaired = true;
      return r;
    });
    // 文字 span：样式有 font-size:24/28px 且有 flex:1
    output = output.replace(
      /<span\b([^>]*style="[^"]*font-size\s*:\s*(?:24|28)px[^"]*flex\s*:\s*1[^"]*"[^>]*)>/gi,
      (m) => {
        const r = tightenTextSpanInLi(m);
        if (r !== m) repaired = true;
        return r;
      },
    );
    // 图标 span：width:40px;height:40px
    output = output.replace(
      /<span\b([^>]*style="[^"]*width\s*:\s*40px[^"]*height\s*:\s*40px[^"]*)>/gi,
      (m) => {
        const r = tightenIconSpanInLi(m);
        if (r !== m) repaired = true;
        return r;
      },
    );
  }

  // Step 2：按 li 数量 / 卡片列数 压缩图片容器高度（TOP/BOTTOM 均需要，只是 margin 方向不同）
  // FR-5：stats-grid 模式统一 32% + margin-top:24px（不按列数阶梯变化）
  if (liCount >= 3) {
    let targetPct = 40;
    let marginSide: 'margin-top' | 'margin-bottom' =
      mode === 'top' ? 'margin-bottom' : 'margin-top';
    let newMarginVal = '20px';
    if (layoutKind === 'stats-grid') {
      targetPct = 32;
      newMarginVal = '24px';
    } else if (liCount === 3) {
      targetPct = 40;
      newMarginVal = '20px';
    } else if (liCount === 4) {
      targetPct = 35;
      newMarginVal = '16px';
    } else {
      targetPct = 32;
      newMarginVal = '16px';
    }

    // FR-5：stats-grid 模式下 imgWrap 可能还没有 flex:0 0 XX%（LLM 原生仅 display:flex），
    // 所以放宽匹配——只要是带 style 的 div 且紧接 <img> 就允许 transform 注入 flex:0 0 32%
    const imgWrapRe =
      layoutKind === 'stats-grid'
        ? /(<div\b[^>]*style="[^"]*"[^>]*>)(?=\s*<img\b)/i
        : /(<div\b[^>]*style="[^"]*flex\s*:\s*0\s+0\s+\d+(?:\.\d+)?%[^"]*"[^>]*>)(?=\s*<img\b)/i;
    output = output.replace(imgWrapRe, (imgWrapTag) => {
      // 这里使用 transformStyleAttr 精细压缩 + 设置 margin 方向（TOP → mb，BOTTOM → mt）
      const r = transformStyleAttr(imgWrapTag, (decls) => {
        let local = false;
        // FR-5：若声明了 min-height:0 / overflow / align-items:stretch，保留；否则补齐关键约束
        const flex = getDecl(decls, 'flex');
        if (flex) {
          const newFlex = flex.replace(/0\s+0\s+\d+(?:\.\d+)?%/, `0 0 ${targetPct}%`);
          if (newFlex !== flex) {
            setDecl(decls, 'flex', newFlex);
            local = true;
          }
        } else {
          setDecl(decls, 'flex-basis', `${targetPct}%`);
          setDecl(decls, 'flex-shrink', '0');
          setDecl(decls, 'flex-grow', '0');
          local = true;
        }
        // FR-5 stats-grid 模式：为防包裹缺少关键显示约束，补齐 display:flex / align-items / overflow / min-height
        if (layoutKind === 'stats-grid') {
          const disp = (getDecl(decls, 'display') || '').toLowerCase();
          if (!disp) {
            setDecl(decls, 'display', 'flex');
            local = true;
          }
          const align = getDecl(decls, 'align-items');
          if (!align) {
            setDecl(decls, 'align-items', 'stretch');
            local = true;
          }
          const oh = getDecl(decls, 'overflow');
          if (!oh) {
            setDecl(decls, 'overflow', 'hidden');
            local = true;
          }
          const mh = getDecl(decls, 'min-height');
          if (!mh) {
            setDecl(decls, 'min-height', '0');
            local = true;
          }
        }
        setDecl(decls, marginSide, newMarginVal);
        local = true;
        return local;
      });
      if (r !== imgWrapTag) repaired = true;
      return r;
    });
  }

  // Step 3：li≥5，H2 标题降级紧凑（TOP/BOTTOM 通用）—— stats-grid 不降级（grid 本身横向排布不挤）
  if (layoutKind !== 'stats-grid' && liCount >= 5) {
    output = output.replace(/<h2\b([^>]*)>/i, (m) => {
      const r = tightenH2(m);
      if (r !== m) repaired = true;
      return r;
    });
  }

  // Step 4（极限兜底）：如果 li 特别多 ≥6，给文本区加可滚动
  //   - TOP    → 文本容器（flex:1）在图片之后、紧邻 UL
  //   - BOTTOM → 文本容器在图片之前、紧邻 UL（即 H2 之后第一个 flex:1 div）
  //   我们用相同的前瞻/后顾正则，两种模式都能命中一个 flex:1 容器
  if (layoutKind !== 'stats-grid' && liCount >= 6) {
    // TOP 模式：文本容器在列表前
    let anyHit = false;
    output = output.replace(
      /(<div\b[^>]*style="[^"]*flex\s*:\s*1[^"]*min-height\s*:\s*0[^"]*"[^>]*>)(?=\s*<(ul|ol)\b)/i,
      (full) => {
        const r = transformStyleAttr(full, (decls) => {
          setDecl(decls, 'max-height', '100%');
          setDecl(decls, 'overflow-y', 'auto');
          return true;
        });
        if (r !== full) {
          repaired = true;
          anyHit = true;
        }
        return r;
      },
    );
    // BOTTOM 模式：文本容器在列表之后且紧邻图片容器前也可能需要，这里只要没命中 TOP，
    // 就尝试把"任何包含大量 li 的单列/双列容器的外层"统一处理；上面TOP已兜底且不重复修改（重复调用 transformStyleAttr 是幂等的）
    if (!anyHit && mode === 'bottom') {
      // 找第一个 flex:1 且 min-height:0 的 <div...>（通常就是列表所在文本容器），给它加滚动。
      output = output.replace(
        /(<div\b[^>]*style="[^"]*flex\s*:\s*1[^"]*min-height\s*:\s*0[^"]*"[^>]*>)/i,
        (full) => {
          const r = transformStyleAttr(full, (decls) => {
            setDecl(decls, 'max-height', '100%');
            setDecl(decls, 'overflow-y', 'auto');
            return true;
          });
          if (r !== full) repaired = true;
          return r;
        },
      );
    }
  }

  return repaired ? output : html;
}

/** 辅助：在 html 中从 openIdx（<tagname...> 的下标）开始寻找对应闭合 </tagname> 下标（返回闭合标签在整串 html 中的起始下标） */
function findMatchingClose(html: string, openIdx: number, tagName: string): number {
  let depth = 1;
  let i = html.indexOf('>', openIdx) + 1;
  if (i === 0) return -1;
  const openRe = new RegExp(`<${tagName}\\b`, 'gi');
  const closeRe = new RegExp(`<\\/${tagName}>`, 'gi');
  while (depth > 0) {
    openRe.lastIndex = i;
    closeRe.lastIndex = i;
    const nextOpen = openRe.exec(html);
    const nextClose = closeRe.exec(html);
    if (!nextClose) return -1;
    if (nextOpen && nextOpen.index < nextClose.index) {
      depth++;
      i = nextOpen.index + nextOpen[0].length;
    } else {
      depth--;
      if (depth === 0) return nextClose.index;
      i = nextClose.index + nextClose[0].length;
    }
  }
  return -1;
}

export class LayoutEngine {
  static createSlide(index: number, title?: string): Slide {
    const now = Date.now();
    return {
      id: generateId(),
      title: title || `幻灯片 ${index + 1}`,
      html: DEFAULT_HTML,
      notes: '',
      hidden: false,
      index,
      createdAt: now,
      updatedAt: now,
    };
  }

  static createPresentation(title?: string, width?: number, height?: number): Presentation {
    const now = Date.now();
    const firstSlide = LayoutEngine.createSlide(0, '封面');
    return {
      id: generatePresentationId(),
      title: title || '未命名演示',
      description: '',
      author: '',
      slides: [firstSlide],
      selectedSlideId: firstSlide.id,
      zoom: 1,
      width: width || 1280,
      height: height || 720,
      transition: 'none',
      createdAt: now,
      updatedAt: now,
      version: 1,
      tags: [],
    };
  }

  static duplicateSlide(slide: Slide, newIndex: number): Slide {
    const now = Date.now();
    return {
      ...slide,
      id: generateId(),
      title: `${slide.title} (副本)`,
      index: newIndex,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * L1 高级版式白名单（data-layout 属性值）。
   * 命中后 normalizeAISlide 会走「轻量分支」，跳过 flatten 剥离，
   * 只做 sanitize 安全 + 溢出防御 + 裸文本兜底等"不破坏结构"的步骤。
   */
  private static readonly ADVANCED_LAYOUTS: ReadonlySet<string> = new Set([
    'comparison-deep-dive',
    'content-zigzag',
    'content-value-showcase',
    'content-stats-highlight',
    'content-image-background',
  ]);

  /**
   * 轻量版 normalizeOuterContainer：跳过破坏性 flatten，只做两件事：
   *   1) 保证最外层是合规根容器（若最外层就是合规 div/section/article 且带 ok8 属性，直接 return，一字不改）
   *   2) 背景样式保留 + 必要字段缺失才补（不重写已有 padding/display/flex-direction）
   *
   * 设计原则：AI 写了什么结构，我们就保留什么结构，只补安全兜底属性，永不 flatten。
   */
  private static normalizeOuterContainerForAdvancedLayout(html: string): string {
    let result = html.trim();
    if (!result) return DEFAULT_HTML;

    result = removeEmptyDefaultContainer(result);

    const FULL_FONT =
      "system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,'Noto Sans SC','PingFang SC','Microsoft YaHei',sans-serif";

    // —— 完全复用 normalizeOuterContainer 中已有的 ok8 判定逻辑 ——
    const firstOuter = /^<(div|section|article)\b([^>]*)>/.exec(result);
    if (firstOuter) {
      const tagName = firstOuter[1];
      const attrs = firstOuter[2] || '';
      const cls = (attrs.match(/class="([^"]*)"/i) || [, ''])[1];
      if (!/noppt-/.test(cls)) {
        const styleMatch = attrs.match(/style="([^"]*)"/i);
        const existingStyle = (styleMatch ? styleMatch[1] : '').trim();
        if (existingStyle) {
          const has = (r: RegExp) => r.test(existingStyle);
          const ok8 =
            has(/(?:^|;)\s*width\s*:\s*100%\s*(?:;|$)/i) &&
            has(/(?:^|;)\s*height\s*:\s*100%\s*(?:;|$)/i) &&
            has(/(?:^|;)\s*overflow\s*:\s*hidden\s*(?:;|$)/i) &&
            has(/(?:^|;)\s*position\s*:\s*relative\s*(?:;|$)/i) &&
            has(/(?:^|;)\s*box-sizing\s*:\s*border-box\s*(?:;|$)/i) &&
            has(/(?:^|;)\s*padding\s*:/i) &&
            !/(?:^|;)\s*padding\s*:\s*0(?:px)?\s*(?:;|$)/i.test(existingStyle) &&
            has(/(?:^|;)\s*display\s*:\s*flex\s*(?:;|$)/i) &&
            has(/(?:^|;)\s*flex-direction\s*:\s*(?:column|row)\s*(?:;|$)/i);
          if (ok8) {
            let safeStyle = existingStyle;
            const addIfMissing = (prop: string, fallback: string) => {
              if (
                !new RegExp(
                  `(?:^|;)\\s*${prop.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:`,
                  'i',
                ).test(`;${safeStyle}`)
              ) {
                safeStyle = safeStyle.endsWith(';')
                  ? `${safeStyle}${prop}:${fallback}`
                  : `${safeStyle};${prop}:${fallback}`;
              }
            };
            if (/(?:^|;)\s*padding\s*:\s*0(?:px)?\s*(?:;|$)/i.test(safeStyle)) {
              safeStyle = safeStyle.replace(
                /(padding\s*:\s*)0(?:px)?\s*(;|$)/i,
                (_m, p, s) => `${p}${defaultPadYx()}${s || ';'}`,
              );
            }
            if (!/(?:^|;)\s*background(?:-color)?\s*:/i.test(`;${safeStyle}`))
              safeStyle += ';background-color:#fff';
            addIfMissing('font-family', FULL_FONT);
            addIfMissing('justify-content', 'center');
            addIfMissing('align-items', 'center');
            addIfMissing('text-align', 'center');
            const newAttrs = styleMatch
              ? attrs.replace(/style="[^"]*"/i, `style="${safeStyle}"`)
              : `${attrs} style="${safeStyle}"`;
            const rest = result.substring(firstOuter[0].length);
            const closeTag = `</${tagName.toLowerCase()}>`;
            let dep = 1;
            let close = -1;
            const scanRe = new RegExp(`<(/?)(${tagName})\\b([^>]*)>`, 'gi');
            let mm: RegExpExecArray | null;
            while ((mm = scanRe.exec(rest)) !== null) {
              if (mm[1] === '/') {
                dep--;
                if (dep === 0) {
                  close = mm.index;
                  break;
                }
              } else if (!/\/\s*$/.test(mm[3] || '')) {
                dep++;
              }
            }
            if (close >= 0) {
              const inner = rest.substring(0, close);
              const after = rest.substring(close + closeTag.length);
              return `<${tagName.toLowerCase()}${newAttrs}>${inner}</${tagName.toLowerCase()}>${after}`;
            }
          }
        }
      }
    }

    // 最外层不是 ok8：直接用 wrapWithContainer 把整个内容包一层合规壳（不做任何 flatten 剥离）
    // 这里 hasAbsolute=false 意思是"按正常 flex+padding 默认值包壳"，但内部的 absolute 元素会因为 position:relative 而正确锚定。
    // （如果 AI 返回的内容里有 absolute 元素，它们自己的 left/top 是相对于最近的 position:relative 祖先，最外层壳加了 relative 就能当锚。）
    return wrapWithContainer(result, true, null);
  }

  /**
   * 改善点 6：高级版式去脏属性。
   * 只删「100% 是脏、不会误伤合法装饰元素」的属性：
   *   - max-width:none / max-height:none（破坏编辑器画布约束）
   *   - overflow:visible（会让内容溢出画布外，破坏 1280×720 边界）
   *
   * 故意不删 position:absolute / left:XXpx / width:XXpx 等，因为装饰性 halo/blob/分隔线 会合法使用这些；
   * 脏的大容器级固定 width/height 通常在 AI prompt 里已被「禁止写」，这里只兜底最恶劣的几个。
   */
  private static cleanDirtyAdvancedLayoutStyles(html: string, _layoutType: string): string {
    // 扫描每个标签的 style=""，把脏属性整条删除（注意保持其他 style 不变）
    return html.replace(
      /<([a-z][a-z0-9-]*)\b([^>]*)>/gi,
      (_tagMatch, tag: string, attrs: string) => {
        const styleMatch = attrs.match(/style="([^"]*)"/i);
        if (!styleMatch) return `<${tag}${attrs}>`;
        let style = styleMatch[1];
        const dropProps = [
          /(?:^|;)\s*max-width\s*:\s*none\s*(?=;|$)/gi,
          /(?:^|;)\s*max-height\s*:\s*none\s*(?=;|$)/gi,
          /(?:^|;)\s*overflow\s*:\s*visible\s*(?=;|$)/gi,
        ];
        for (const re of dropProps) style = style.replace(re, '');
        style = style.replace(/^;+|;+$/g, '').replace(/;;+/g, ';');
        const newAttrs = attrs.replace(/style="[^"]*"/i, `style="${style}"`);
        return `<${tag}${newAttrs}>`;
      },
    );
  }

  private static repairComparisonDeepDiveHtml(html: string): string {
    let result = html;

    result = result.replace(
      /(<span\b[^>]*display:\s*inline-flex[^>]*width:\s*22px[^>]*background:\s*#E5E7EB[^>]*>)\s*<svg\b[^>]*>\s*<rect\b([^>]*)>([\s\S]*?)<\/rect>\s*<\/svg>\s*<\/span>/gi,
      (match, circleOpen: string, rectAttrs: string, inner: string) => {
        const hasNestedTags = /<(p|span|div|li|h[1-6])\b/i.test(inner);
        if (!hasNestedTags) return match;
        const text = inner.replace(/<[^>]+>/g, '').trim();
        if (!text) return match;
        const properSvg = `<svg width="10" height="10" viewBox="0 0 10 10"><rect${rectAttrs}/></svg>`;
        const labelSpan = `<span style="font-size:20px;font-weight:600;color:#374151;line-height:1.4;flex:1;min-width:0;overflow-wrap:break-word;word-break:break-word">${text}</span>`;
        return `${circleOpen}${properSvg}</span>${labelSpan}`;
      },
    );

    result = result.replace(
      /(<div\b[^>]*display:\s*flex[^>]*align-items:\s*center[^>]*gap:\s*12px[^>]*>)([\s\S]*?)<\/div>/gi,
      (match, divOpen: string, divInner: string) => {
        const brokenRect = /<rect\b[^>]*>([\s\S]*?)<\/rect>/i.exec(divInner);
        if (!brokenRect) return match;
        const rectInner = brokenRect[1];
        const hasNestedTags = /<(p|span|div|li|h[1-6])\b/i.test(rectInner);
        if (!hasNestedTags) return match;
        const text = rectInner.replace(/<[^>]+>/g, '').trim();
        if (!text) return match;
        const cleanedBefore = divInner
          .substring(0, brokenRect.index)
          .replace(/<p\b[^>]*>\s*<\/p>/gi, '')
          .replace(/<p\b[^>]*>[\s\S]*?<\/p>/gi, '');
        const cleanedAfter = divInner
          .substring(brokenRect.index + brokenRect[0].length)
          .replace(/<p\b[^>]*>\s*<\/p>/gi, '')
          .replace(/<p\b[^>]*>[\s\S]*?<\/p>/gi, '');
        const iconHtml = `<span style="display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:22px;height:22px;border-radius:50%;background:#E5E7EB;"><svg width="10" height="10" viewBox="0 0 10 10"><rect x="2" y="4.5" width="6" height="1.5" rx="0.75" fill="#9CA3AF"/></svg></span>`;
        const labelHtml = `<span style="font-size:20px;font-weight:600;color:#374151;line-height:1.4;flex:1;min-width:0;overflow-wrap:break-word;word-break:break-word">${text}</span>`;
        return `${divOpen}${cleanedBefore}${iconHtml}${labelHtml}${cleanedAfter}</div>`;
      },
    );

    // ——— FR-4 (fix-slide-comparison-image-disaster)：防御性清理两栏内"h3 ↔ ul 之间被入侵的 <img>" ———
    // 比较版式（comparison-deep-dive）的左右栏卡片内部禁止任何插图；若 LLM 在闭环中自发
    // 把图塞到 h3 与 ul 之间，直接把图及其包裹 div 整体移除，保持 5 条进度条不被裁切。
    result = LayoutEngine.sanitizeComparisonColumnInjectedImages(
      result,
      'right',
      /<div\b([^>]*)>/gi,
      (attrs1: string) =>
        /background\s*:\s*linear-gradient\s*\(\s*135deg\s*,\s*#0891b206\s*,\s*#0891b20A\s*\)/i.test(
          attrs1,
        ) && /box-shadow\s*:\s*0\s*8px\s*28px\s*#0891b218/i.test(attrs1),
    );
    result = LayoutEngine.sanitizeComparisonColumnInjectedImages(
      result,
      'left',
      /<div\b([^>]*)>/gi,
      (attrs2: string) =>
        /background\s*:\s*#F9FAFB/i.test(attrs2) &&
        /border\s*:\s*2px\s*solid\s*#E5E7EB/i.test(attrs2),
    );

    result = result.replace(/<p\b[^>]*>\s*<\/p>/gi, '');

    result = result.replace(
      /(<svg\b[^>]*width="14"[^>]*>)\s*(<\/svg>)/gi,
      '$1<path d="M13 4L6.5 10.5L3 7" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>$2',
    );

    result = result.replace(
      /(<svg\b[^>]*width="15"[^>]*>)\s*(<\/svg>)/gi,
      '$1<path d="M13 4L6.5 10.5L3 7" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>$2',
    );

    // 合并 3+ 空行为 1 行（保持 diff 可读，不影响结构）
    result = result.replace(/\n[ \t]*(?:\r?\n[ \t]*){2,}/g, '\n\n');

    return result;
  }

  /**
   * FR-4 (fix-slide-comparison-image-disaster) 辅助：
   * 扫描 HTML，找到 attrsPredicate 匹配的那根 comparison 栏卡片，
   * 在该卡片内部的 <\/h3> … <ul 区间里把所有包含 <img> 的最内层包裹 div + <img> 移除，
   * 保留 h3 与 <ul> 本体及正常的纯文本/行内样式节点。
   * 不对 <ul> 内部做任何改动。若没有命中卡片或无 img → 返回原值（幂等）。
   */
  private static sanitizeComparisonColumnInjectedImages(
    html: string,
    _side: 'left' | 'right',
    divOpenRe: RegExp,
    attrsPredicate: (attrs: string) => boolean,
  ): string {
    if (!html) return html;
    const flagsRe = /<div\b([^>]*)>/gi;
    void divOpenRe; // 统一用 flagsRe 并在回调内部用 attrsPredicate 判定，避免 g 状态问题
    flagsRe.lastIndex = 0;
    let m: RegExpExecArray | null;
    const matches: Array<{ openIdx: number; openTagLen: number; attrs: string; closeIdx: number }> =
      [];
    // 第一轮：定位所有 <div 开标签 + attrs
    while ((m = flagsRe.exec(html)) !== null) {
      const attrs = m[1] || '';
      if (!attrsPredicate(attrs)) continue;
      const openIdx = m.index;
      const openTagLen = m[0].length;
      // 匹配对应的 </div>（用 stack，因为卡片内部还有 li/div 等嵌套）
      let depth = 1;
      const innerScan = /<(\/?)div\b([^>]*)>/gi;
      innerScan.lastIndex = openIdx + openTagLen;
      let closeIdx = -1;
      let inner: RegExpExecArray | null;
      while ((inner = innerScan.exec(html)) !== null) {
        if (inner[1] === '/') {
          depth--;
          if (depth === 0) {
            closeIdx = inner.index;
            break;
          }
        } else if (!/\/\s*$/.test(inner[2] || '')) {
          depth++;
        }
      }
      if (closeIdx < 0) continue;
      matches.push({ openIdx, openTagLen, attrs, closeIdx });
    }
    if (matches.length === 0) return html;
    // 从后往前替换，保持 index 不变
    let out = html;
    for (let i = matches.length - 1; i >= 0; i--) {
      const { openIdx, openTagLen, closeIdx } = matches[i];
      const cardInner = out.substring(openIdx + openTagLen, closeIdx);
      // 在卡片内部找 </h3> ... <ul 片段
      const gapRe = /(<\/h3\s*>)([\s\S]*?)(?=<ul\b)/i;
      if (!gapRe.test(cardInner)) continue;
      const newCardInner = cardInner.replace(gapRe, (_whole, h3Close: string, between: string) => {
        if (!/<img\b/i.test(between)) return `${h3Close}${between}`;
        // 把 between 中所有"包裹 <img 的最外层 div"以及裸 <img> 都剥掉。
        // 策略：对每个 <img 位置，找到包含它的"最外层 <div>"，收集非重叠的移除区间，
        // 最后统一倒序切片；残留的无 div 包裹裸 <img> 再兜底移除。
        let cleaned = between;
        type Range = { start: number; end: number };
        // (1) 收集 <img 位置列表
        const imgPositions: number[] = [];
        const imgRe = /<img\b/gi;
        let imgMatch: RegExpExecArray | null;
        while ((imgMatch = imgRe.exec(cleaned)) !== null) {
          imgPositions.push(imgMatch.index);
        }
        // (2) 对每个 <img 位置，找包含它的最外层 <div>，收集互斥区间
        const removeRanges: Range[] = [];
        for (const pos of imgPositions) {
          if (removeRanges.some((r) => pos >= r.start && pos < r.end)) continue;
          // 找包住 pos 的最外层 <div 开标签：要求其在 pos 之前、且其匹配的 </div> 在 pos 之后
          const divOpenRe = /<div\b([^>]*)>/gi;
          let outermostStart = -1;
          let outermostEnd = -1;
          let dOpen: RegExpExecArray | null;
          while ((dOpen = divOpenRe.exec(cleaned)) !== null) {
            if (dOpen.index >= pos) break;
            const attrs = dOpen[1] || '';
            if (/\/\s*$/.test(attrs)) continue;
            // 配对 </div>
            let depth = 1;
            const pairRe = /<(\/?)div\b([^>]*)>/gi;
            pairRe.lastIndex = dOpen.index + dOpen[0].length;
            let p: RegExpExecArray | null;
            let matchedClose: { index: number; len: number } | null = null;
            while ((p = pairRe.exec(cleaned)) !== null) {
              if (p[1] === '/') {
                if (--depth === 0) {
                  matchedClose = { index: p.index, len: p[0].length };
                  break;
                }
              } else if (!/\/\s*$/.test(p[2] || '')) {
                depth++;
              }
            }
            if (!matchedClose) continue;
            const end = matchedClose.index + matchedClose.len;
            if (pos >= dOpen.index && pos < end) {
              // 更外层（start 更小、end 更大或相等）
              if (outermostStart < 0 || dOpen.index < outermostStart) {
                outermostStart = dOpen.index;
                outermostEnd = end;
              }
            }
          }
          if (outermostStart >= 0 && outermostEnd > outermostStart) {
            removeRanges.push({ start: outermostStart, end: outermostEnd });
          }
        }
        // (3) 倒序移除
        if (removeRanges.length > 0) {
          removeRanges.sort((a, b) => b.start - a.start);
          for (const r of removeRanges) {
            cleaned = cleaned.substring(0, r.start) + cleaned.substring(r.end);
          }
        }
        // (4) 残余的裸 <img/> / <img ...></img> 兜底剥掉
        cleaned = cleaned.replace(/<img\b[\s\S]*?(?:\/\s*>|<\/img>)/gi, '');
        // (3) 合并多余空白行（保留 1 行）
        cleaned = cleaned.replace(/\n[ \t]*(?:\r?\n[ \t]*){2,}/g, '\n\n');
        // (4) 去掉只剩空白的孤立 `margin-bottom:16px` style 残留
        cleaned = cleaned.replace(
          /<div\b[^>]*style\s*=\s*"[^"]*margin-bottom\s*:\s*\d+px[^"]*"[^>]*>\s*<\/div>/gi,
          '',
        );
        return `${h3Close}${cleaned}`;
      });
      if (newCardInner === cardInner) continue;
      out = out.substring(0, openIdx + openTagLen) + newCardInner + out.substring(closeIdx);
    }
    return out;
  }

  private static extractLiTexts(ulBody: string): string[] {
    const texts: string[] = [];
    const liRe = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
    let m: RegExpExecArray | null;
    while ((m = liRe.exec(ulBody)) !== null) {
      const inner = m[1];
      const spans = inner.match(/<span\b[^>]*>([\s\S]*?)<\/span>/gi);
      let label = '';
      if (spans) {
        for (const s of spans) {
          const t = s.replace(/<[^>]+>/g, '').trim();
          if (t && !t.includes('胜出') && !t.startsWith('+') && !/^\d+%$/.test(t)) {
            label = t;
            break;
          }
        }
      }
      if (!label) {
        label = inner.replace(/<[^>]+>/g, '').trim();
      }
      if (label) texts.push(label);
    }
    return texts;
  }

  private static balanceComparisonDeepDiveLIs(html: string): string {
    const uls: Array<{
      open: string;
      close: string;
      openIdx: number;
      closeIdx: number;
      liCount: number;
      body: string;
    }> = [];
    const ulRe = /<ul\b([^>]*)>/gi;
    let m: RegExpExecArray | null;
    while ((m = ulRe.exec(html)) !== null) {
      const openIdx = m.index;
      const openTag = m[0];
      let dep = 1;
      const innerScan = /<(\/?)ul\b([^>]*)>/gi;
      innerScan.lastIndex = openIdx + openTag.length;
      let closeIdx = -1;
      let inner: RegExpExecArray | null;
      while ((inner = innerScan.exec(html)) !== null) {
        if (inner[1] === '/') {
          dep--;
          if (dep === 0) {
            closeIdx = inner.index;
            break;
          }
        } else if (!/\/\s*$/.test(inner[2] || '')) dep++;
      }
      if (closeIdx < 0) continue;
      const closeTag = `</ul>`;
      const body = html.substring(openIdx + openTag.length, closeIdx);
      const liCount = (body.match(/<li\b/gi) || []).length;
      uls.push({ open: openTag, close: closeTag, openIdx, closeIdx, liCount, body });
      if (uls.length >= 2) break;
    }
    if (uls.length < 2) return html;
    const [ulL, ulR] = uls;
    const N = Math.max(ulL.liCount, ulR.liCount, 3);

    const leftLabels = LayoutEngine.extractLiTexts(ulL.body);

    const leftPlaceholder = (
      _idx: number,
      label: string,
    ) => `<li style="display:flex;flex-direction:column;gap:8px;padding:16px 20px;border-radius:12px;background:#FFFFFF;border:1px dashed #D1D5DB;min-width:0;overflow-wrap:break-word;word-break:break-word;opacity:0.65;">
  <div style="display:flex;align-items:center;gap:12px;">
    <span style="display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:22px;height:22px;border-radius:50%;background:#F3F4F6;">
      <svg width="10" height="10" viewBox="0 0 10 10"><rect x="2" y="4.5" width="6" height="1.5" rx="0.75" fill="#9CA3AF"/></svg>
    </span>
    <span style="font-size:20px;font-weight:600;color:#9CA3AF;line-height:1.4;flex:1;min-width:0;overflow-wrap:break-word;word-break:break-word">${label}</span>
  </div>
  <div style="width:100%;height:8px;border-radius:999px;background:#F3F4F6;overflow:hidden;">
    <div style="pointer-events:none;width:0%;height:100%;border-radius:999px;background:#D1D5DB;"></div>
  </div>
</li>`;

    const rightPlaceholder = (
      _idx: number,
      label: string,
    ) => `<li style="display:flex;flex-direction:column;gap:8px;padding:16px 20px;border-radius:12px;background:#FFFFFF;border:1px dashed #D1D5DB;min-width:0;overflow-wrap:break-word;word-break:break-word;opacity:0.65;">
  <div style="display:flex;align-items:center;gap:12px;">
    <span style="display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:22px;height:22px;border-radius:50%;background:#F3F4F6;">
      <svg width="10" height="10" viewBox="0 0 10 10"><rect x="2" y="4.5" width="6" height="1.5" rx="0.75" fill="#9CA3AF"/></svg>
    </span>
    <span style="font-size:20px;font-weight:600;color:#9CA3AF;line-height:1.4;flex:1;min-width:0;overflow-wrap:break-word;word-break:break-word">${label}</span>
  </div>
  <div style="width:100%;height:8px;border-radius:999px;background:#F3F4F6;overflow:hidden;">
    <div style="pointer-events:none;width:0%;height:100%;border-radius:999px;background:#D1D5DB;"></div>
  </div>
</li>`;

    const buildPatch = (ul: typeof ulL, isLeft: boolean): string => {
      if (ul.liCount >= N) return '';
      const extras: string[] = [];
      for (let i = ul.liCount; i < N; i++) {
        const label = isLeft
          ? leftLabels[i] || `对比维度 ${i + 1}`
          : leftLabels[i] || `对比维度 ${i + 1}`;
        extras.push(isLeft ? leftPlaceholder(i, label) : rightPlaceholder(i, label));
      }
      return extras.join('\n');
    };

    const leftPatch = buildPatch(ulL, true);
    const rightPatch = buildPatch(ulR, false);
    if (!leftPatch && !rightPatch) return html;

    const patchAt = (idx: number, patch: string): string => {
      if (!patch) return html;
      return html.substring(0, idx) + patch + html.substring(idx);
    };
    html = patchAt(ulR.closeIdx, rightPatch);
    html = patchAt(ulL.closeIdx, leftPatch);
    return html;
  }

  static normalizeAISlide(slide: Slide): Slide {
    // ——— 防御闭环项 5：前置空白裁剪。真实世界中 HTML 可能来自模板字符串首行、
    // 审计闭环 regenerate 产物拼接、editor 端草稿保存等不同路径，如果开头残留空白，
    // data-layout 路由正则的 ^ 锚就无法识别，高级版式会掉进通用 flatten 链，
    // FR-4 repairComparisonDeepDiveHtml / balanceComparisonDeepDiveLIs 等修复永远不触发。
    let html = (typeof slide.html === 'string' ? slide.html : '').replace(/^\s+/, '');
    html = removeDangerousContent(html);

    // ========== 🚀 L1 data-layout 路由：高级版式走轻量分支，跳过 flatten ==========
    // 判定：开头 <tag...> 里有没有 data-layout 且值在 ADVANCED_LAYOUTS 白名单中
    const layoutMatch =
      /^<\s*(?:div|section|article)\b[^>]*\bdata-layout\s*=\s*["']?([a-z0-9-]+)["']?[^>]*>/i.exec(
        html,
      );
    const isAdvancedLayout =
      layoutMatch && LayoutEngine.ADVANCED_LAYOUTS.has(layoutMatch[1].toLowerCase());

    if (isAdvancedLayout) {
      html = LayoutEngine.normalizeOuterContainerForAdvancedLayout(html);
      html = LayoutEngine.cleanDirtyAdvancedLayoutStyles(
        html,
        layoutMatch?.[1]?.toLowerCase() ?? '',
      );
      if (layoutMatch?.[1]?.toLowerCase() === 'comparison-deep-dive') {
        html = LayoutEngine.repairComparisonDeepDiveHtml(html);
        html = LayoutEngine.balanceComparisonDeepDiveLIs(html);
      }
    } else {
      // 普通版式：走原来的 normalizeOuterContainer（含 flatten），保持向后兼容
      html = normalizeOuterContainer(html);
    }

    // 构图护栏（web 编辑态重归一化）：保守移除根容器居中三件套——仅当页面含内容标记且非纯标题页时。
    // 纯封面（仅 H1）保持居中，避免误伤；真正的左对齐裁断由管线 postProcessLayout 的 applyCompositionGuard 完成。
    html = applyCompositionGuard(html);

    // 以下步骤对两种版式都生效（它们不破坏结构，只做安全/溢出/裸文本兜底）：
    html = enforceFlatStructure(html);
    html = unwrapIconWrappingParagraph(html);
    html = enforceImageStyles(html, { borderRadius: '12px', addDataImageRatio: false });
    html = enforceFlexChildrenMinWidth(html);
    html = enforceTextWrapping(html);
    html = removeForcedCardHeight(html);
    html = enforceGridLayout(html);
    html = enforceMinFontSize(html, 14);
    html = cleanupEmptyDivs(html);
    html = cleanupEmptyInlineTags(html);
    html = repairEmptySvgs(html);
    // FR-2 / Task 3 + 4: 推断主色后统一补标图标色，避免写死 DEFAULT_BLUE 跨色相污染（如橙底蓝字）。
    const primary = inferPrimaryColor(html);
    html = repairTrivialSvgIcons(html, primary);
    html = normalizeIconGroups(html, primary);
    html = enforceBareTextToParagraphs(html);
    // preventContentImageTopOverflow 只会命中 H2 + flex:0 0 XX% 图片包裹 + 单列长列表的组合，
    // 对高级版式（双栏对比/Z 字/数值大卡/背景图）的 probe 永远返回 null，不会误伤创意布局。
    html = preventContentImageTopOverflow(html);

    return {
      ...slide,
      html,
      updatedAt: Date.now(),
    };
  }
}

export { generatePresentationId, generateId };
