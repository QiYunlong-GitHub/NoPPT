/**
 * 列表格式化纯工具函数
 * 从 EditorLayout.tsx applyListToSelection / handleSelectionListStyleType 拆分而来
 * - getLinePrefixInfo：纯函数，分析单行文本前缀
 * - buildListReplacementText：纯函数，给定行数组+目标列表类型/样式，计算输出文本
 * - buildStyleSwapText：纯函数，保持列表类型不变，仅切换样式
 */
import { BULLET_STYLES, NUMBER_STYLES, LIST_INDENT } from '@/constants/listStyles';

export type ListType = 'ul' | 'ol';
export type LinePrefixInfo = { type: ListType | null; style: string; content: string };

export function getLinePrefixInfo(line: string): LinePrefixInfo {
  for (const [style, { symbol }] of Object.entries(BULLET_STYLES)) {
    if (!symbol) continue;
    const prefix = symbol + LIST_INDENT;
    if (line.startsWith(prefix)) {
      return { type: 'ul', style, content: line.substring(prefix.length) };
    }
  }
  for (const [style, { formatter }] of Object.entries(NUMBER_STYLES)) {
    if (style === 'none') continue;
    for (let i = 1; i <= 100; i++) {
      const numStr = formatter(i);
      const prefix = numStr + LIST_INDENT;
      if (line.startsWith(prefix)) {
        return { type: 'ol', style, content: line.substring(prefix.length) };
      }
    }
  }
  return { type: null, style: '', content: line };
}

export type BuildListResult = {
  text: string;
  /** 最终生效的列表类型：如果 toggle-off，则为 null */
  resultType: ListType | null;
  /** 最终生效的样式 key */
  resultStyle: string;
};

export function buildListReplacementText(
  rawLines: string[],
  listType: ListType,
  styleOverride?: string,
): BuildListResult {
  if (!rawLines || rawLines.length === 0) {
    return { text: '', resultType: null, resultStyle: '' };
  }
  const lineInfos = rawLines.map((l) => getLinePrefixInfo(l));
  const firstType = lineInfos[0].type;
  const allSameType =
    firstType !== null && lineInfos.every((info) => info.type === firstType);

  const targetStyle =
    styleOverride || (listType === 'ul' ? 'disc' : 'decimal');

  // 全部同类型，且与目标相同，且用户未指定强制样式 -> 视为 toggle off
  if (allSameType && firstType === listType && !styleOverride) {
    return {
      text: lineInfos.map((info) => info.content).join('\n'),
      resultType: null,
      resultStyle: '',
    };
  }

  const text = lineInfos
    .map((info, index) => {
      const baseContent = info.content;
      if (listType === 'ul') {
        const bullet = BULLET_STYLES[targetStyle] || BULLET_STYLES.disc;
        return bullet.symbol + LIST_INDENT + baseContent;
      } else {
        const num = NUMBER_STYLES[targetStyle] || NUMBER_STYLES.decimal;
        const numStr = num.formatter(index + 1);
        return numStr + LIST_INDENT + baseContent;
      }
    })
    .join('\n');
  return { text, resultType: listType, resultStyle: targetStyle };
}

/**
 * 「仅切换样式，不改变类型」纯计算。
 * 如果当前行里没有任何 list prefix，则返回 null（调用者应该 no-op）。
 */
export function buildStyleSwapText(
  rawLines: string[],
  styleType: string,
): { text: string; resultType: ListType | null; resultStyle: string } | null {
  if (!rawLines || rawLines.length === 0) return null;
  const lineInfos = rawLines.map((l) => getLinePrefixInfo(l));
  const currentListType = lineInfos[0]?.type;
  if (!currentListType) return null;

  const text = lineInfos
    .map((info, index) => {
      const baseContent = info.content;
      if (currentListType === 'ul') {
        const bullet = BULLET_STYLES[styleType];
        if (!bullet || !bullet.symbol) return baseContent;
        return bullet.symbol + LIST_INDENT + baseContent;
      } else {
        const num = NUMBER_STYLES[styleType];
        if (!num || styleType === 'none') return baseContent;
        const numStr = num.formatter(index + 1);
        return numStr + LIST_INDENT + baseContent;
      }
    })
    .join('\n');
  return { text, resultType: currentListType, resultStyle: styleType };
}
