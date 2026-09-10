import type { Page } from 'playwright-core';
import type { ImageLoadRecord } from './types';

export async function detectImageLoad(page: Page): Promise<ImageLoadRecord[]> {
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

    const records: ImageLoadRecord[] = [];
    const imgs = document.querySelectorAll('img');
    for (const img of Array.from(imgs)) {
      if (!(img instanceof HTMLImageElement)) continue;
      const loaded = img.complete && img.naturalWidth > 0;
      records.push({
        selector: generateSelector(img),
        src: img.currentSrc || img.src || '',
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
        loaded,
      });
    }
    return records;
  });
}
