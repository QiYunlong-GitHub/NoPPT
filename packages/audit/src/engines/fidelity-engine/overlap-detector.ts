import type { Page } from 'playwright-core';
import type { OverlapRecord } from './types';

export async function detectOverlap(page: Page): Promise<OverlapRecord[]> {
  return page.evaluate(() => {
    const BLOCK_TAGS = new Set([
      'div', 'section', 'article', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'ul', 'ol', 'li', 'img', 'table',
    ]);
    const DECORATIVE_PATTERN = /(decoration|decorative|ornament|bg|background)/i;

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

    function isVisible(el: HTMLElement): boolean {
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      if (parseFloat(style.opacity) === 0) return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }

    function isDecorative(el: HTMLElement): boolean {
      const cls = el.className || '';
      if (typeof cls === 'string' && DECORATIVE_PATTERN.test(cls)) return true;
      const style = getComputedStyle(el);
      if (style.zIndex && style.zIndex !== 'auto' && parseInt(style.zIndex, 10) < 0) return true;
      if (style.pointerEvents === 'none') return true;
      return false;
    }

    function isAncestor(a: HTMLElement, b: HTMLElement): boolean {
      return a !== b && (a.contains(b) || b.contains(a));
    }

    function rectOverlap(
      r1: { x: number; y: number; width: number; height: number },
      r2: { x: number; y: number; width: number; height: number },
    ): number {
      const x1 = Math.max(r1.x, r2.x);
      const y1 = Math.max(r1.y, r2.y);
      const x2 = Math.min(r1.x + r1.width, r2.x + r2.width);
      const y2 = Math.min(r1.y + r1.height, r2.y + r2.height);
      if (x2 <= x1 || y2 <= y1) return 0;
      return (x2 - x1) * (y2 - y1);
    }

    function hasOpaqueBackground(el: HTMLElement): boolean {
      const style = getComputedStyle(el);
      const bg = style.backgroundColor;
      if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') {
        const match = bg.match(/rgba?\(([^)]+)\)/);
        if (match) {
          const parts = match[1].split(',').map((s) => s.trim());
          if (parts.length === 4 && parseFloat(parts[3]) === 0) return false;
        }
        return true;
      }
      if (style.backgroundImage && style.backgroundImage !== 'none') return true;
      return false;
    }

    function hasTextContent(el: HTMLElement): boolean {
      return (el.textContent || '').trim().length > 0;
    }

    const elements: HTMLElement[] = [];
    const all = document.querySelectorAll('*');
    for (const el of Array.from(all)) {
      if (!(el instanceof HTMLElement)) continue;
      if (!BLOCK_TAGS.has(el.tagName.toLowerCase())) continue;
      if (!isVisible(el)) continue;
      elements.push(el);
    }

    const records: OverlapRecord[] = [];
    const seen = new Set<string>();

    for (let i = 0; i < elements.length; i++) {
      for (let j = i + 1; j < elements.length; j++) {
        const el1 = elements[i];
        const el2 = elements[j];

        if (isAncestor(el1, el2)) continue;
        if (isDecorative(el1) || isDecorative(el2)) continue;

        const r1 = el1.getBoundingClientRect();
        const r2 = el2.getBoundingClientRect();
        const area1 = r1.width * r1.height;
        const area2 = r2.width * r2.height;
        const minArea = Math.min(area1, area2);
        if (minArea <= 0) continue;

        const overlapArea = rectOverlap(r1, r2);
        if (overlapArea <= 0) continue;
        if (overlapArea < minArea * 0.1) continue;

        const key = [generateSelector(el1), generateSelector(el2)].sort().join('||');
        if (seen.has(key)) continue;
        seen.add(key);

        const obscured =
          (hasTextContent(el1) && hasOpaqueBackground(el2)) ||
          (hasTextContent(el2) && hasOpaqueBackground(el1));

        records.push({
          element1: {
            selector: generateSelector(el1),
            rect: { x: r1.x, y: r1.y, width: r1.width, height: r1.height },
          },
          element2: {
            selector: generateSelector(el2),
            rect: { x: r2.x, y: r2.y, width: r2.width, height: r2.height },
          },
          overlapArea,
          isContentObscured: obscured,
        });
      }
    }

    return records;
  });
}
