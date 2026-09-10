import type { Page } from 'playwright-core';
import type { TruncationRecord } from './types';

export async function detectTextTruncation(page: Page): Promise<TruncationRecord[]> {
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

    const records: TruncationRecord[] = [];
    const all = document.querySelectorAll('*');
    for (const el of Array.from(all)) {
      if (!(el instanceof HTMLElement)) continue;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') continue;

      const hasEllipsis = style.textOverflow === 'ellipsis';
      const hasHiddenOverflow = style.overflow === 'hidden' || style.overflowX === 'hidden';
      const isNowrap = style.whiteSpace === 'nowrap' || style.whiteSpace === 'pre';
      const candidate = hasEllipsis || (hasHiddenOverflow && isNowrap);
      if (!candidate) continue;

      const truncated = el.scrollWidth > el.clientWidth + 1;
      records.push({
        selector: generateSelector(el),
        tagName: el.tagName.toLowerCase(),
        clientWidth: el.clientWidth,
        scrollWidth: el.scrollWidth,
        truncated,
      });
    }
    return records;
  });
}
