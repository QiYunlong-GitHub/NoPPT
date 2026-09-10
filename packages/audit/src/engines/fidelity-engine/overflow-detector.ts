import type { Page } from 'playwright-core';
import type { OverflowRecord } from './types';

export async function detectOverflow(page: Page): Promise<OverflowRecord[]> {
  return page.evaluate(() => {
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

    const records: OverflowRecord[] = [];
    const all = document.querySelectorAll('*');
    for (const el of Array.from(all)) {
      if (!(el instanceof HTMLElement)) continue;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      if (style.overflowX === 'visible' && style.overflowY === 'visible') continue;

      const overflowX = el.scrollWidth - el.clientWidth;
      const overflowY = el.scrollHeight - el.clientHeight;
      if (overflowX > 2 || overflowY > 2) {
        records.push({
          selector: generateSelector(el),
          tagName: el.tagName.toLowerCase(),
          overflowX,
          overflowY,
          clientWidth: el.clientWidth,
          clientHeight: el.clientHeight,
          scrollWidth: el.scrollWidth,
          scrollHeight: el.scrollHeight,
        });
      }
    }
    return records;
  });
}
