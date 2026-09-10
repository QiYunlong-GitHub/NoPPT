import type { Page } from 'playwright-core';
import type { LayoutShiftRecord } from './types';

export async function detectLayoutShift(
  page: Page,
  viewport: { width: number; height: number },
): Promise<LayoutShiftRecord[]> {
  return page.evaluate(
    ({ width, height }) => {
      function generateSelector(el: Element): string {
        if (!(el instanceof Element)) return '';
        if (el.id) return '#' + el.id;
        const parts: string[] = [];
        let current: Element | null = el;
        while (current && current.nodeType === 1 && current !== document.documentElement) {
          let part = current.tagName.toLowerCase();
          if (current.classList && current.classList.length > 0) {
            const cls = current.classList[0];
            if (cls) part += '.' + cls;
          } else {
            const parent = current.parentElement;
            if (parent) {
              const siblings = Array.from(parent.children);
              const sameTag = siblings.filter((s) => s.tagName === current!.tagName);
              if (sameTag.length > 1) {
                const idx = sameTag.indexOf(current) + 1;
                part += `:nth-of-type(${idx})`;
              }
            }
          }
          parts.unshift(part);
          if (current.classList && current.classList.length > 0) break;
          current = current.parentElement;
        }
        return parts.join(' > ');
      }

      const records: LayoutShiftRecord[] = [];
      const all = document.querySelectorAll('*');

      for (const el of Array.from(all)) {
        if (!(el instanceof HTMLElement)) continue;
        const style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') continue;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;

        if (style.position === 'absolute' || style.position === 'fixed') {
          if (rect.left < -2) {
            records.push({
              selector: generateSelector(el),
              issue: 'element-out-of-viewport',
              detail: `left offset ${Math.round(rect.left)}px is beyond left viewport boundary`,
            });
          }
          if (rect.top < -2) {
            records.push({
              selector: generateSelector(el),
              issue: 'element-out-of-viewport',
              detail: `top offset ${Math.round(rect.top)}px is beyond top viewport boundary`,
            });
          }
          if (rect.right > width + 2) {
            records.push({
              selector: generateSelector(el),
              issue: 'element-out-of-viewport',
              detail: `right edge ${Math.round(rect.right)}px exceeds viewport width ${width}px`,
            });
          }
          if (rect.bottom > height + 2) {
            records.push({
              selector: generateSelector(el),
              issue: 'element-out-of-viewport',
              detail: `bottom edge ${Math.round(rect.bottom)}px exceeds viewport height ${height}px`,
            });
          }
        }

        if (style.overflow === 'hidden' || style.overflowX === 'hidden' || style.overflowY === 'hidden') {
          const childOverflowX = el.scrollWidth - el.clientWidth;
          const childOverflowY = el.scrollHeight - el.clientHeight;
          if (childOverflowX > 2 || childOverflowY > 2) {
            records.push({
              selector: generateSelector(el),
              issue: 'content-clipped',
              detail: `content clipped by overflow:hidden (overflowX: ${childOverflowX}px, overflowY: ${childOverflowY}px)`,
            });
          }
        }
      }

      return records;
    },
    { width: viewport.width, height: viewport.height },
  );
}
