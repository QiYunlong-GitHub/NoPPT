import {
  parseStyleDeclarations,
} from '../visual-fixes';

import {
  DEFAULT_HTML,
} from './constants';
import {
  defaultPadYx,
} from './constants';
import {
  removeEmptyDefaultContainer,
  extractBackgroundStyles,
  analyzeTopLevelStructure,
  mergeStrayElementsIntoContainer,
  stripContainerStylesFromUserElements,
  wrapWithContainer,
} from './dom';
import {
  isCoverLikeHtml,
} from './cover';
export function normalizeOuterContainer(html: string): string {
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

