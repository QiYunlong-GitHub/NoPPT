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

const commitElementTransform = (el: HTMLElement) => {
  const match = el.style.transform.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/);
  if (match) {
    const tx = parseFloat(match[1]);
    const ty = parseFloat(match[2]);
    if (tx !== 0 || ty !== 0) {
      const styleLeft = parseFloat(el.style.left) || 0;
      const styleTop = parseFloat(el.style.top) || 0;
      el.style.left = `${styleLeft + tx}px`;
      el.style.top = `${styleTop + ty}px`;
    }
    el.style.transform = el.style.transform.replace(/translate\([^)]+\)\s*/g, '').trim();
  }
};

export { getCollectiveBBox, highlightElement, commitElementTransform };
