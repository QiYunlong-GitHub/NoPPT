/**
 * 列表 DOM 操作纯工具模块（文本前缀方案）
 *
 * 在 contentEditable 中，通过在每行文本前添加/移除符号前缀
 * （如 "●  "、"1.  "、"A)  " 等）来实现列表效果。
 *
 * 配合 white-space: pre-wrap，多行文本通过 \n 分隔。
 * 纯文本计算逻辑委托给 listFormatting.ts。
 */
import {
  buildListReplacementText,
  buildStyleSwapText,
  type ListType,
} from './listFormatting';

export type { ListType };

export interface ToggleResult {
  resultType: ListType | null;
  resultStyle: string;
}

function findEditingHost(range: Range): HTMLElement | null {
  let node: Node | null = range.commonAncestorContainer;
  while (node) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') {
        return el;
      }
    }
    node = node.parentNode;
  }
  return null;
}

/**
 * 将新文本写入选区，保留 \n 换行符（white-space: pre-wrap 会将其渲染为换行）。
 *
 * 优先处理"选区位于同一个文本节点内"的常见情况：直接修改 nodeValue，
 * 避免 execCommand('insertText') 吞掉 \n 的问题。
 * 对于跨节点选区，回退到 deleteContents + 插入文本节点。
 */
function replaceRangeText(range: Range, newText: string): void {
  const startNode = range.startContainer;
  const endNode = range.endContainer;

  if (
    startNode === endNode &&
    startNode.nodeType === Node.TEXT_NODE
  ) {
    const textNode = startNode as Text;
    const start = range.startOffset;
    const end = range.endOffset;
    const full = textNode.nodeValue || '';
    const before = full.substring(0, start);
    const after = full.substring(end);
    textNode.nodeValue = before + newText + after;

    const newRange = document.createRange();
    newRange.setStart(textNode, before.length);
    newRange.setEnd(textNode, before.length + newText.length);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(newRange);
    return;
  }

  range.deleteContents();
  const textNode = document.createTextNode(newText);
  range.insertNode(textNode);

  const newRange = document.createRange();
  newRange.setStart(textNode, 0);
  newRange.setEnd(textNode, textNode.length);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(newRange);
}

/**
 * 切换选区的列表格式。
 *
 * @param range     当前选区
 * @param listType  目标列表类型 'ul' | 'ol'
 * @param styleKey  样式 key（对应 BULLET_STYLES / NUMBER_STYLES 的 key）
 * @param toggle    true=主按钮（同类型则取消）；false=样式按钮（只换样式不取消）
 */
export function toggleListInRange(
  range: Range,
  listType: ListType,
  styleKey: string,
  toggle: boolean = false,
): ToggleResult {
  const host = findEditingHost(range);
  if (!host) {
    return { resultType: null, resultStyle: '' };
  }

  const rawText = range.toString();
  if (!rawText) {
    return { resultType: null, resultStyle: '' };
  }

  const rawLines = rawText.split('\n');

  let result;
  if (toggle) {
    result = buildListReplacementText(rawLines, listType);
  } else {
    const swapped = buildStyleSwapText(rawLines, styleKey);
    if (swapped) {
      result = swapped;
    } else {
      result = buildListReplacementText(rawLines, listType, styleKey);
    }
  }

  if (result.text === rawText) {
    return { resultType: result.resultType, resultStyle: result.resultStyle };
  }

  replaceRangeText(range, result.text);

  return { resultType: result.resultType, resultStyle: result.resultStyle };
}
