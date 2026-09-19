import {
  parseStyleDeclarations,
} from '../visual-fixes';

import {
  CONTAINER_STYLE_KEYS,
  CONTAINER_PADDING_PATTERN,
  defaultPadYx,
} from './constants';
export function removeEmptyDefaultContainer(html: string): string {
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


export function extractBackgroundStyles(styleStr: string): Record<string, string> | null {
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


export function analyzeTopLevelStructure(html: string): {
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


export function mergeStrayElementsIntoContainer(html: string): string {
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


export function stripContainerStylesFromUserElements(html: string): string {
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


export function wrapWithContainer(
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


export function removeDangerousContent(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/on\w+="[^"]*"/gi, '')
    .replace(/on\w+='[^']*'/gi, '');
}


export function cleanupEmptyDivs(html: string): string {
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


export function hasVisualStyle(styleStr: string): boolean {
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


/**
 * 清理没有视觉样式的空 <p></p> / <span></span>（幂等）。
 * 导出供各端后处理链路的**最后一步**调用：后处理拆解/重建过程中容易残留空段落，
 * 若清理发生在重建之前就会漏掉（pres_mtzke4lj slide-02 末尾残留 <p></p> 即此类）。
 */
export function cleanupEmptyInlineTags(html: string): string {
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


export function findMatchingCloseDiv(html: string, openPos: number): number {
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


export function stringifyDecls(decls: Array<{ key: string; value: string }>): string {
  return decls.map((d) => `${d.key}:${d.value}`).join(';');
}


export function setDecl(decls: Array<{ key: string; value: string }>, key: string, value: string): void {
  const idx = decls.findIndex((d) => d.key === key);
  if (idx >= 0) decls[idx].value = value;
  else decls.push({ key, value });
}

export function delDecl(decls: Array<{ key: string; value: string }>, key: string): void {
  const idx = decls.findIndex((d) => d.key === key);
  if (idx >= 0) decls.splice(idx, 1);
}

export function getDecl(decls: Array<{ key: string; value: string }>, key: string): string | undefined {
  return decls.find((d) => d.key === key)?.value;
}


export function transformStyleAttr(
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


/** 辅助：在 html 中从 openIdx（<tagname...> 的下标）开始寻找对应闭合 </tagname> 下标（返回闭合标签在整串 html 中的起始下标） */
export function findMatchingClose(html: string, openIdx: number, tagName: string): number {
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

