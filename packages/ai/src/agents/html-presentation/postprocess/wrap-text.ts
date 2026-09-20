/**
 * PostProcess 裸文本包裹簇（从 postprocess/dom.ts 外置）。
 *
 * 外置原因：dom.ts 触及门禁的 800 行上限，而 wrapTextNodes（含 SVG 原始区保护）
 * 是一个自包含的逻辑块，整体搬出后 dom.ts 与新增文件均远低于阈值（门禁只减不增）。
 *
 * 纯函数，无 this 依赖；dom.ts 会再导出以保持 postprocess barrel 的对外签名不变。
 */

/**
 * 裸文本兜底 <p> 的默认排版。
 * line-height 由 2.0 下调为 1.6：2.0 会让每个兜底 <p> 至少占 2 倍字号高度
 * （20px 字 → 40px），一旦某个容器里被注入多个 <p>，卡片会被瞬间撑爆并溢出画布
 * （pres_mu7skl55_0cmg3m7 slide-03 遮挡的放大因素之一）。
 */
const DEFAULT_P_STYLE =
  'font-size:24px;color:#374151;font-weight:600;line-height:1.6;overflow-wrap:break-word;word-break:break-word;';

export function composeInheritedPStyle(parentStyle?: string): string {
  if (!parentStyle) return DEFAULT_P_STYLE;
  const grab = (re: RegExp): string | undefined => {
    const m = re.exec(parentStyle);
    return m ? m[1].trim() : undefined;
  };
  const fs = grab(/font-size\s*:\s*([^;"}]+)/i);
  const fc = grab(/(?:^|[^-])color\s*:\s*([^;"}]+)/i);
  const ls = grab(/letter-spacing\s*:\s*([^;"}]+)/i);
  const lh = grab(/line-height\s*:\s*([^;"}]+)/i);
  const fw = grab(/font-weight\s*:\s*([^;"}]+)/i);
  const parts = ['margin:0;'];
  if (fs) parts.push(`font-size:${fs};`);
  if (fc) parts.push(`color:${fc};`);
  if (ls) parts.push(`letter-spacing:${ls};`);
  if (lh) parts.push(`line-height:${lh};`);
  if (fw) parts.push(`font-weight:${fw};`);
  return parts.length > 1 ? parts.join('') : DEFAULT_P_STYLE;
}

/**
 * SVG 元素/子元素白名单 + `<svg>` 原始区保护（wrapTextNodes 专用）。
 *
 * 背景（pres_mu7skl55_0cmg3m7 slide-03「严重遮挡」的直接成因）：
 * wrapTextNodes 的 processContainer 不认识 SVG 命名空间——`<svg>` 既不在 isInline
 * 也不在 isBlock 名单里（被当成裸文本字符缓冲），而自闭合的 `<rect />` / `<path />`
 * 命中 `isSelfClosing && !isInline` 分支被切成独立 block 段。于是
 *   `<span><svg><rect/></svg></span>` → `<p><svg …>` + `<rect …/>` + `</svg></span>…</p>`
 * 再经下游 JSDOM 序列化（HTML5 解析规则）固化为
 *   `<p><svg …></svg></p><rect …>…</rect>`
 * SVG 图形丢失，`<rect>`/`<path>` 退化成 HTMLUnknownElement 并把后续文字节点吞进自己内部。
 *
 * 两道防线（均在 processContainer 内实现）：
 *   ① `<svg …>…</svg>` 整段按「不可分割的 block 段」处理，内部不做任何二次切分；
 *   ② 白名单内的标签一律按内联片段处理，绝不切成独立 block 段
 *      （覆盖 `<svg>` 未闭合、或标签已被上游改写等 ① 失效的场景）。
 */
const SVG_RAW_TAGS = new Set([
  'svg',
  'path',
  'circle',
  'rect',
  'line',
  'polyline',
  'polygon',
  'ellipse',
  'use',
  'g',
  'defs',
  'stop',
  'text',
  'tspan',
  'image',
  'marker',
  'symbol',
  'clippath',
  'mask',
  'pattern',
  'lineargradient',
  'radialgradient',
  'animate',
  'filter',
]);

// ===== 以下为 processContainer 的拆分件（降低圈复杂度 / 嵌套深度至门禁阈值内）=====

const INLINE_TAGS = new Set([
  'span',
  'strong',
  'em',
  'b',
  'i',
  'u',
  'a',
  'br',
  'sup',
  'sub',
  'font',
]);

const BLOCK_TAGS = new Set([
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'ul',
  'ol',
  'li',
  'div',
  'section',
  'article',
  'table',
  'blockquote',
  'img',
  'video',
  'figure',
  'figcaption',
  'pre',
  'code',
]);

const SINGLETON_TAGS = new Set(['br', 'img', 'hr', 'input']);

type Segment = { type: 'text' | 'block' | 'inline'; content: string };

interface TagClass {
  tagName: string;
  isClosing: boolean;
  isSelfClosing: boolean;
  isInline: boolean;
  isBlock: boolean;
}

/** 解析一个开/闭标签；非正规标签返回 null。 */
function classifyTag(tagFull: string): TagClass | null {
  const tagMatch = tagFull.match(/^<\/?([a-zA-Z0-9]+)/);
  if (!tagMatch) return null;
  const tagName = tagMatch[1].toLowerCase();
  return {
    tagName,
    isClosing: tagFull[1] === '/',
    isSelfClosing: tagFull[tagFull.length - 2] === '/' || SINGLETON_TAGS.has(tagName),
    isInline: INLINE_TAGS.has(tagName),
    isBlock: BLOCK_TAGS.has(tagName),
  };
}

/** 读取 `<svg …>…</svg>` 整段的结束位置（自闭合时到开标签末尾）；不匹配返回 -1。 */
function readSvgBlockEnd(content: string, i: number): number {
  if (!/^<svg[\s>]/i.test(content.slice(i, i + 20))) return -1;
  const openEnd = content.indexOf('>', i);
  if (openEnd === -1) return -1;
  if (content[openEnd - 1] === '/') return openEnd + 1;
  const closeIdx = content.toLowerCase().indexOf('</svg>', openEnd + 1);
  return closeIdx === -1 ? content.length : closeIdx + '</svg>'.length;
}

/**
 * 读取「不可分割原始块」的结束位置：HTML 注释 / CDATA / DOCTYPE 声明 / `<svg>` 整段。
 * 这些块整体作为一个 block segment，绝不进入裸文本缓冲（否则会被包一层 <p>）。
 */
function readIndivisibleBlockEnd(content: string, i: number): number {
  if (content.startsWith('<!--', i)) {
    const e = content.indexOf('-->', i);
    return e === -1 ? content.length : e + 3;
  }
  if (content.startsWith('<![CDATA[', i)) {
    const e = content.indexOf(']]>', i);
    return e === -1 ? content.length : e + 3;
  }
  if (content.startsWith('<!', i)) {
    const e = content.indexOf('>', i);
    return e === -1 ? content.length : e + 1;
  }
  return readSvgBlockEnd(content, i);
}

/** 从 start 起按标签名配对扫描块级元素的结束位置（内部跳过注释）。 */
function scanBlockEnd(content: string, start: number, tagName: string): number {
  let depth = 1;
  let j = start;
  while (j < content.length && depth > 0) {
    if (content[j] !== '<') {
      j++;
      continue;
    }
    if (content.startsWith('<!--', j)) {
      const endIdx = content.indexOf('-->', j);
      j = endIdx === -1 ? content.length : endIdx + 3;
      continue;
    }
    const nt = content.indexOf('>', j);
    if (nt === -1) break;
    const nm = content.slice(j, nt + 1).match(/^<\/?([a-zA-Z0-9]+)/);
    if (nm && nm[1].toLowerCase() === tagName) {
      if (content[j + 1] === '/') depth--;
      else if (content[nt - 1] !== '/') depth++;
    }
    j = nt + 1;
  }
  return j;
}

/** 把累积的裸文本缓冲落成一个 text segment（空白缓冲忽略）。 */
function flushBuffer(segments: Segment[], buffer: string): void {
  if (!buffer.trim()) return;
  segments.push({ type: 'text', content: buffer });
}

/**
 * 把一个容器的内容切成 segment 序列：裸文本段（后续包 <p>）与 block 段（原样保留）。
 * 裸文本缓冲按换行拆分，每行独立包裹 <p>（原实现多行合并成一个 <p>，换行会丢失）。
 */
function processContainer(content: string, parentStyle?: string): string {
  const segments: Segment[] = [];
  let buffer = '';
  let i = 0;
  while (i < content.length) {
    if (content[i] !== '<') {
      buffer += content[i];
      i++;
      continue;
    }
    // 防线① + 注释 / CDATA / DOCTYPE：整段不可分割
    const rawEnd = readIndivisibleBlockEnd(content, i);
    if (rawEnd !== -1) {
      flushBuffer(segments, buffer);
      buffer = '';
      segments.push({ type: 'block', content: content.slice(i, rawEnd) });
      i = rawEnd;
      continue;
    }
    const tagEnd = content.indexOf('>', i);
    if (tagEnd === -1) {
      buffer += content.slice(i);
      break;
    }
    const tagFull = content.slice(i, tagEnd + 1);
    const cls = classifyTag(tagFull);
    if (!cls) {
      buffer += content[i];
      i++;
      continue;
    }
    // 防线②：SVG 元素/子元素一律按内联片段处理，绝不切成独立 block 段
    if (SVG_RAW_TAGS.has(cls.tagName)) {
      buffer += tagFull;
      i = tagEnd + 1;
      continue;
    }
    if (cls.isInline || cls.isSelfClosing) {
      if (cls.isSelfClosing && !cls.isInline) {
        flushBuffer(segments, buffer);
        buffer = '';
        segments.push({ type: 'block', content: tagFull });
      } else {
        buffer += tagFull;
      }
      i = tagEnd + 1;
      continue;
    }
    if (cls.isBlock && !cls.isClosing) {
      const j = scanBlockEnd(content, tagEnd + 1, cls.tagName);
      flushBuffer(segments, buffer);
      buffer = '';
      segments.push({ type: 'block', content: content.slice(i, j) });
      i = j;
      continue;
    }
    if (cls.isBlock && cls.isClosing) {
      flushBuffer(segments, buffer);
      buffer = '';
      segments.push({ type: 'block', content: tagFull });
      i = tagEnd + 1;
      continue;
    }
    buffer += tagFull;
    i = tagEnd + 1;
  }
  flushBuffer(segments, buffer);
  return segments
    .map((seg) => {
      if (seg.type !== 'text' || !seg.content.trim()) return seg.content;
      const wrapped: string[] = [];
      for (const rawLine of seg.content.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line) continue;
        wrapped.push(`<p style="${composeInheritedPStyle(parentStyle)}">${line}</p>`);
      }
      return wrapped.join('');
    })
    .join('');
}

/** 递归处理 div/section/article 内部内容（深度优先，先内层）。 */
function replaceTextInDiv(htmlStr: string): string {
  const divRegex = /<(div|section|article)(\s[^>]*)?>([\s\S]*?)<\/\1>/gi;
  let iterations = 0;
  let out = htmlStr;
  do {
    const before = out;
    out = out.replace(divRegex, (match, tag, attrs, innerContent) => {
      const styleAttr = (attrs || '').match(/style="([^"]*)"/i);
      const parentStyle = styleAttr ? styleAttr[1] : undefined;
      const hasOuterDiv = /<(div|section|article)[\s>]/i.test(innerContent);
      // Step 1: 递归处理嵌套的子容器内部（深度优先，先内层）
      const pi = hasOuterDiv ? replaceTextInDiv(innerContent) : innerContent;
      // Step 2: 对当前层级也执行包裹，防止嵌套 div 周围的兄弟裸文本被遗漏
      const processed = processContainer(pi, parentStyle);
      if (processed === innerContent) return match;
      return `<${tag}${attrs || ''}>${processed}</${tag}>`;
    });
    iterations++;
    if (out === before) break;
  } while (iterations < 10);
  return out;
}

export function wrapTextNodes(html: string): string {
  return replaceTextInDiv(html);
}
