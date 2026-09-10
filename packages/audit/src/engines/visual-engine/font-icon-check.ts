import type { Page } from 'playwright-core';

export interface FontIconCheckResult {
  fontFamilyCount: number;
  fontFamilies: string[];
  fontSizeLevels: number;
  fontSizes: number[];
  iconStyles: string[];
  iconStyleConsistent: boolean;
}

interface RawFontIconData {
  fontFamilies: string[];
  fontSizes: number[];
  iconStyles: string[];
}

export async function checkFontAndIcons(page: Page): Promise<FontIconCheckResult> {
  const raw = await page.evaluate((): RawFontIconData => {
    const fontFamilySet = new Set<string>();
    const fontSizeSet = new Set<number>();
    const iconStyleSet = new Set<string>();

    const all = document.body.querySelectorAll<HTMLElement>('*');
    for (const el of all) {
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') continue;

      const family = (style.fontFamily || '').split(',')[0].trim().replace(/['"]/g, '');
      if (family) fontFamilySet.add(family);

      const sizeMatch = (style.fontSize || '').match(/([\d.]+)px/);
      if (sizeMatch) {
        const px = parseFloat(sizeMatch[1]);
        if (!Number.isNaN(px)) fontSizeSet.add(Math.round(px * 10) / 10);
      }

      const classNames = (el.className && typeof el.className === 'string') ? el.className : '';
      const hasIconClass = /(^|[\s-])icon(s)?([\s-]|$)/i.test(classNames) ||
        /\bfa[srbldc]?\b/.test(classNames) ||
        /\bmaterial-icons\b/.test(classNames) ||
        /\blucide\b/.test(classNames) ||
        /\bbi\b/.test(classNames);
      const hasDataIcon = el.hasAttribute('data-icon');
      const isSvg = el.tagName.toLowerCase() === 'svg';
      const isEmoji = el.textContent && /\p{Emoji_Presentation}/u.test(el.textContent) && el.textContent.trim().length <= 4;

      if (hasIconClass || hasDataIcon || isSvg || isEmoji) {
        const explicit = el.getAttribute('data-icon-style');
        if (explicit) {
          iconStyleSet.add(explicit);
        } else if (isSvg) {
          const strokeWidth = el.getAttribute('stroke-width') || style.strokeWidth;
          const hasFill = style.fill && style.fill !== 'none' && style.fill !== 'rgba(0, 0, 0, 0)';
          const hasStroke = style.stroke && style.stroke !== 'none' && parseFloat(strokeWidth) > 0;
          if (hasStroke && !hasFill) iconStyleSet.add('linear');
          else if (hasFill) iconStyleSet.add('solid');
          else iconStyleSet.add('linear');
        } else if (isEmoji) {
          iconStyleSet.add('emoji');
        } else if (classNames) {
          if (/\b(solid|fas|filled)\b/.test(classNames)) iconStyleSet.add('solid');
          else if (/\b(regular|far|line|linear|outline|outlined)\b/.test(classNames)) iconStyleSet.add('linear');
          else iconStyleSet.add('solid');
        }
      }
    }

    return {
      fontFamilies: Array.from(fontFamilySet),
      fontSizes: Array.from(fontSizeSet).sort((a, b) => a - b),
      iconStyles: Array.from(iconStyleSet),
    };
  });

  return {
    fontFamilyCount: raw.fontFamilies.length,
    fontFamilies: raw.fontFamilies,
    fontSizeLevels: raw.fontSizes.length,
    fontSizes: raw.fontSizes,
    iconStyles: raw.iconStyles,
    iconStyleConsistent: raw.iconStyles.length <= 1,
  };
}
