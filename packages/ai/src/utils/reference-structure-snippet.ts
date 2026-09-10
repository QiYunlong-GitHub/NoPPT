// 参考 HTML 骨架片段裁剪器（FR-参考克隆）。
// 把参考真实画布裁剪为「确定性、可快照」的 DOM 骨架片段，注入生成 prompt，
// 让模型有可照抄的结构范本（标签 + class 名 + 关键 style + 截断文本）。
// 纯函数、零依赖、不进入逐页热路径（仅上传参考时执行一次）。

export interface SkeletonOptions {
  /** 最大递归深度，默认 6 */
  maxDepth?: number;
  /** 最大节点数（超出截断），默认 80 */
  maxNodes?: number;
  /** 文本节点截断长度，默认 24 */
  maxTextLen?: number;
  /** 输出字符上限，默认约 6000（≈2-3K token） */
  maxChars?: number;
}

const DEFAULTS: Required<SkeletonOptions> = {
  maxDepth: 6,
  maxNodes: 80,
  maxTextLen: 24,
  maxChars: 6000,
};

// 这些标签对版式理解无贡献，直接跳过
const SKIP_TAGS = new Set(['script', 'style', 'meta', 'link', 'title', 'head', 'br', 'hr', 'noscript']);

// 仅保留与版式相关的 style 片段，避免把整段渐变/动画塞进骨架
const KEEP_STYLE = /(position|display|flex|grid|gap|align|justify|background|border|border-radius|clip-path|width|height|margin|padding|text-align|color|font-size|transform|aspect-ratio|overflow)/i;

function pickStyle(styleAttr: string): string {
  if (!styleAttr) return '';
  const parts = styleAttr
    .split(';')
    .map((s) => s.trim())
    .filter((s) => KEEP_STYLE.test(s));
  return parts.join('; ');
}

function directText(el: Element): string {
  let t = '';
  el.childNodes.forEach((n) => {
    if (n.nodeType === 3) t += (n.textContent || '') + ' ';
  });
  return t.replace(/\s+/g, ' ').trim();
}

/**
 * 把参考画布裁剪为骨架片段。
 * @param canvas 参考 HTML 中识别出的真实画布元素（.slide 等）
 */
export function buildSkeletonSnippet(canvas: Element, opts?: SkeletonOptions): string {
  const o = { ...DEFAULTS, ...opts };
  const out: string[] = [];
  let nodeCount = 0;
  let truncated = false;

  function walk(el: Element, depth: number): void {
    if (truncated || depth > o.maxDepth || nodeCount >= o.maxNodes) {
      if (nodeCount >= o.maxNodes) truncated = true;
      return;
    }
    for (const child of Array.from(el.children)) {
      if (truncated || nodeCount >= o.maxNodes) {
        truncated = true;
        return;
      }
      const tag = child.tagName.toLowerCase();
      if (SKIP_TAGS.has(tag)) continue;
      nodeCount++;
      const cls = (child.getAttribute('class') || '').trim().slice(0, 60);
      const style = pickStyle(child.getAttribute('style') || '');
      const text = directText(child);
      const textShort = text.length > o.maxTextLen ? text.slice(0, o.maxTextLen) + '…' : text;
      const attrs = (cls ? ` class="${cls}"` : '') + (style ? ` style="${style}"` : '');
      const indent = '  '.repeat(depth);
      if (child.children.length === 0) {
        out.push(`${indent}<${tag}${attrs}>${textShort}</${tag}>`);
      } else {
        out.push(`${indent}<${tag}${attrs}>` + (textShort ? ` ${textShort}` : ''));
        walk(child, depth + 1);
        out.push(`${indent}</${tag}>`);
      }
      if (out.join('').length > o.maxChars) {
        truncated = true;
        return;
      }
    }
  }

  const canvasTag = canvas.tagName.toLowerCase();
  const canvasCls = (canvas.getAttribute('class') || '').trim().slice(0, 60);
  const canvasStyle = pickStyle(canvas.getAttribute('style') || '');
  const canvasAttrs = (canvasCls ? ` class="${canvasCls}"` : '') + (canvasStyle ? ` style="${canvasStyle}"` : '');
  out.push(`<${canvasTag}${canvasAttrs}>`);
  walk(canvas, 1);
  out.push(`</${canvasTag}>`);

  let res = out.join('\n');
  if (res.length > o.maxChars) res = res.slice(0, o.maxChars) + '\n…(truncated)';
  return res;
}
