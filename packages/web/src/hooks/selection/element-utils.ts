import type { ElementRect } from '@/utils/SmartGuides';

const getCollectiveBBox = (rects: ElementRect[]): ElementRect => {
  if (rects.length === 0) return { left: 0, top: 0, width: 0, height: 0 };
  let minLeft = Infinity;
  let minTop = Infinity;
  let maxRight = -Infinity;
  let maxBottom = -Infinity;
  for (const r of rects) {
    minLeft = Math.min(minLeft, r.left);
    minTop = Math.min(minTop, r.top);
    maxRight = Math.max(maxRight, r.left + r.width);
    maxBottom = Math.max(maxBottom, r.top + r.height);
  }
  return { left: minLeft, top: minTop, width: maxRight - minLeft, height: maxBottom - minTop };
};

const highlightElement = (element: HTMLElement, selected: boolean) => {
  if (selected) {
    element.classList.add('noppt-selected');
  } else {
    element.classList.remove('noppt-selected');
  }
};

/**
 * 让元素具备用 left/top 表达偏移的能力（位置类编辑的前提）。
 *
 * - 已定位元素（relative / absolute / fixed / sticky）→ 原样返回 false；
 * - static 元素 → 改为 relative，并把此前被忽略的行内 left/top 归零，返回 true。
 *
 * 归零是「无跳位」的安全转换：static 元素上的行内 left/top 此前不生效，
 * 一旦转为 relative 会立刻生效导致元素瞬移；relative + left/top:0 与 static
 * 视觉完全等价，因此归零不会引入任何可感知的位置变化。
 *
 * 幂等，可在 commit 与 resize 起始处重复调用。
 */
export const ensureOffsetPositionable = (el: HTMLElement): boolean => {
  // 优先用行内 position 判断：编辑器对定位的写入始终是行内样式，
  // 且 jsdom 下 getComputedStyle 对未挂载/未显式定位的元素会返回 ''，
  // 若只看 computed 会在第二次提交时把已累加的 left/top 误清零。
  const inlinePosition = el.style.position;
  const positionedInline =
    inlinePosition === 'absolute' ||
    inlinePosition === 'fixed' ||
    inlinePosition === 'relative' ||
    inlinePosition === 'sticky';
  if (positionedInline) return false;

  // 兜底：样式表（非行内）设置过定位的情况（如 absolute），不要覆盖。
  const computedPosition = getComputedStyle(el).position;
  if (computedPosition !== '' && computedPosition !== 'static') return false;

  // 未定位：转为 relative 并把此前被忽略的行内 left/top 归零（避免转换瞬间跳位）。
  el.style.position = 'relative';
  el.style.left = '0px';
  el.style.top = '0px';
  return true;
};

const commitElementTransform = (el: HTMLElement) => {
  const match = el.style.transform.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/);
  if (match) {
    const tx = parseFloat(match[1]);
    const ty = parseFloat(match[2]);
    if (tx !== 0 || ty !== 0) {
      // 折叠 translate 前，确保 left/top 对当前元素生效（流式 static 元素需先转 relative）
      ensureOffsetPositionable(el);
      const styleLeft = parseFloat(el.style.left) || 0;
      const styleTop = parseFloat(el.style.top) || 0;
      el.style.left = `${styleLeft + tx}px`;
      el.style.top = `${styleTop + ty}px`;
    }
    el.style.transform = el.style.transform.replace(/translate\([^)]+\)\s*/g, '').trim();
  }
};

export { getCollectiveBBox, highlightElement, commitElementTransform };
