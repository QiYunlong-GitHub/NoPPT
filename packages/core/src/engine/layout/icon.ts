
import {
  findMatchingCloseDiv,
} from './dom';
export function isTrivialCircleSvg(svgInner: string): boolean {
  const inner = svgInner.trim();
  if (!inner) return true;
  if (/<(?:path|rect|polygon|polyline|line|ellipse|g|text|use)\b/i.test(inner)) return false;
  const circles = inner.match(/<circle\b/gi);
  return !!circles && circles.length <= 3;
}


export function makeCheckSvg(size: number, color: string): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
}


/** 从 HTML 的主体中推断品牌主色（H2 渐变 / 左色条 / 卡片背景）。若无法推断返回 DEFAULT_BLUE。 */
export function inferPrimaryColor(html: string): string {
  const DEFAULT_BLUE = '#2563eb';
  // 1) 最可信：<h2 ... background:linear-gradient(..., #hex1, #hex2 ...)> 首 stop
  const h2Grad = /<h2\b[^>]*style="[^"]*linear-gradient\s*\(\s*[^)]*\)/i.exec(html);
  if (h2Grad) {
    const stops = h2Grad[0].match(/#(?:[0-9a-f]{6}|[0-9a-f]{3})/gi) || [];
    const first = stops.find((s) => s.length === 7 || s.length === 4);
    if (first) return normalizeHex6(first);
  }
  // 2) 最常见语义色：border-left:5px solid #xxx（活力橙的条）
  const borderLeft = /border-left\s*:\s*\d+px\s+solid\s+(#[0-9a-f]{6}|#[0-9a-f]{3})/i.exec(html);
  if (borderLeft) return normalizeHex6(borderLeft[1]);
  // 3) 图标容器渐变首 stop
  const iconGrad = /background\s*:\s*linear-gradient\s*\(\s*[^)]*#[0-9a-f]{3,8}/i.exec(html);
  if (iconGrad) {
    const m = iconGrad[0].match(/#(?:[0-9a-f]{6}|[0-9a-f]{3})/i);
    if (m) return normalizeHex6(m[0]);
  }
  return DEFAULT_BLUE;
}


export function normalizeHex6(hex: string): string {
  let h = hex.replace('#', '');
  if (h.length === 3) h = `${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`;
  if (h.length >= 6) return `#${h.substring(0, 6)}`.toLowerCase();
  return hex.toLowerCase();
}


export function repairTrivialSvgIcons(html: string, primaryColor?: string): string {
  const effectivePrimary = primaryColor ? normalizeHex6(primaryColor) : inferPrimaryColor(html);
  let result = html;

  result = result.replace(
    /<svg\b([^>]*)>([\s\S]*?)<\/svg>/gi,
    (match: string, attrs: string, inner: string) => {
      if (!isTrivialCircleSvg(inner)) return match;

      const widthMatch = attrs.match(/\bwidth\s*=\s*["']?(\d+)/i);
      const heightMatch = attrs.match(/\bheight\s*=\s*["']?(\d+)/i);
      const w = widthMatch ? parseInt(widthMatch[1], 10) : 0;
      const h = heightMatch ? parseInt(heightMatch[1], 10) : 0;

      if (w > 40 || h > 40) return match;

      const size = w >= 10 && h >= 10 ? Math.max(14, Math.min(w, h, 22)) : 20;

      const colorMatch =
        attrs.match(/\bstroke\s*=\s*["']([^"']+)["']/i) ||
        inner.match(/\bstroke\s*=\s*["']([^"']+)["']/i);
      const color = colorMatch ? colorMatch[1] : effectivePrimary;

      return makeCheckSvg(size, color);
    },
  );

  return result;
}


/** 判断一段 HTML 开头的左侧 SVG 图标是否为「通用占位」（check / trivial circle）。
 *  语义图标（自定义多元素 shape）返回 false，不应被剥离或替换。 */
export function firstLeftIconIsGeneric(htmlSnippet: string): boolean {
  const svgOpen = /<svg\b([^>]*)>[\s\S]*?<\/svg>/i.exec(htmlSnippet);
  if (!svgOpen) return true; // 没 SVG 算通用 -> 不触发「语义图标保留」，外层仍走 hasLeftIcon 判断
  const attrs = svgOpen[1];
  const inner = svgOpen[0].substring(svgOpen[0].indexOf('>') + 1, svgOpen[0].lastIndexOf('<'));
  // (1) makeCheckSvg: 单 polyline points="20 6 9 17 4 12"
  if (/<polyline\b[^>]*points\s*=\s*["']20\s+6\s+9\s+17\s+4\s+12["']/i.test(inner)) return true;
  // (2) trivial circle svg：仅 circle 且 ≤3 个
  if (isTrivialCircleSvg(inner)) return true;
  // (3) stroke="#fff" 且在有色渐变/底色 span 内（语义图标在彩色容器里） → 不算占位，为语义图标
  // (4) 存在复杂元素（path/polygon/polyline 非 check/line 多组合等）→ 语义图标
  const hasMultipleLines = (inner.match(/<line\b/gi) || []).length >= 3;
  const hasPolygon = /<polygon\b/i.test(inner);
  const hasPath = /<path\b/i.test(inner);
  const hasExtra = /<(?:circle|ellipse|rect)\b/i.test(inner) && !isTrivialCircleSvg(inner);
  // 默认：size 很小且 stroke 不是白色 → 疑似占位（比如我们之前写死的 #2563eb check 样式）
  const wm = attrs.match(/\bwidth\s*=\s*["']?(\d+)/i);
  const hm = attrs.match(/\bheight\s*=\s*["']?(\d+)/i);
  const sz = Math.max(wm ? parseInt(wm[1], 10) : 0, hm ? parseInt(hm[1], 10) : 0);
  const stroke =
    (attrs.match(/\bstroke\s*=\s*["']([^"']+)["']/i) ||
      inner.match(/\bstroke\s*=\s*["']([^"']+)["']/i))?.[1] || '';
  const isWhiteStroke = /^#fff(?:fff)?$/i.test(stroke) || /^white$/i.test(stroke);
  // T4-FR4 HOTFIX：同样把 fill="#fff" / fill="white" 语义图标识别为非占位（图标 → 渐变容器内的白图标是语义最常见的形态）
  // 之前只看 stroke 不看 fill，导致 SVG icon（svg 本身没写 stroke，但 inner path 有 fill="#fff"）被误判为通用，进而被替换成 check。
  const fill =
    (attrs.match(/\bfill\s*=\s*["']([^"']+)["']/i) ||
      inner.match(/\bfill\s*=\s*["']([^"']+)["']/i))?.[1] || '';
  const isWhiteFill = /^#fff(?:fff)?$/i.test(fill) || /^white$/i.test(fill);
  if (isWhiteStroke || isWhiteFill || hasMultipleLines || hasPolygon || hasPath || hasExtra)
    return false;
  if (sz >= 24) return false; // 较大的图标多半是语义图标（作者精心设计的）
  return true;
}


export function normalizeIconGroups(html: string, primaryColor?: string): string {
  const effectivePrimary = primaryColor ? normalizeHex6(primaryColor) : inferPrimaryColor(html);
  const makeIcon = (size: number, color?: string) => makeCheckSvg(size, color ?? effectivePrimary);
  let result = html;

  result = result.replace(
    /<ul\b([^>]*)>([\s\S]*?)<\/ul>/gi,
    (fullMatch: string, ulAttrs: string, ulInner: string) => {
      const items: { full: string; inner: string; attrs: string; hasIcon: boolean }[] = [];
      const liRegex = /<li\b([^>]*)>([\s\S]*?)<\/li>/gi;
      let liMatch: RegExpExecArray | null;
      while ((liMatch = liRegex.exec(ulInner)) !== null) {
        const liInner = liMatch[2];
        const hasSvg = /<svg\b/i.test(liInner);
        const hasMarker = /noppt-icon-marker/i.test(liInner);
        items.push({
          full: liMatch[0],
          inner: liInner,
          attrs: liMatch[1],
          hasIcon: hasSvg || hasMarker,
        });
      }

      if (items.length < 2) return fullMatch;
      const iconCount = items.filter((it) => it.hasIcon).length;
      if (iconCount === 0 || iconCount === items.length) return fullMatch;

      const normalizedItems = items.map((it) => {
        if (it.hasIcon) return it.full;
        return `<li${it.attrs}>${makeIcon(20)}${it.inner}</li>`;
      });

      return `<ul${ulAttrs}>${normalizedItems.join('')}</ul>`;
    },
  );

  const containerRe =
    /<div\b([^>]*style="[^"]*display\s*:\s*flex[^"]*flex-direction\s*:\s*column[^"]*"[^>]*)>/gi;
  let containerMatch: RegExpExecArray | null;
  const replacements: { start: number; end: number; content: string }[] = [];

  while ((containerMatch = containerRe.exec(result)) !== null) {
    const openTag = containerMatch[0];
    const openEnd = containerMatch.index + openTag.length;
    const closeEnd = findMatchingCloseDiv(result, openEnd);
    if (closeEnd === -1) continue;

    const inner = result.substring(openEnd, closeEnd - 6);

    if (/<[uo]l[\s>]/i.test(inner)) continue;

    const cardRe =
      /<div\b([^>]*style="[^"]*(?:padding\s*:\s*\d+px|border-radius\s*:\s*\d+px)[^"]*"[^>]*)>/gi;
    const cards: {
      full: string;
      attrs: string;
      inner: string;
      hasLeftIcon: boolean;
      hasRightNumber: boolean;
      start: number;
      end: number;
    }[] = [];
    let cardMatch: RegExpExecArray | null;

    while ((cardMatch = cardRe.exec(inner)) !== null) {
      const cardOpenEnd = cardMatch.index + cardMatch[0].length;
      const cardCloseEnd = findMatchingCloseDiv(inner, cardOpenEnd);
      if (cardCloseEnd === -1) continue;

      const cardInner = inner.substring(cardOpenEnd, cardCloseEnd - 6);
      const isCard =
        /padding\s*:\s*\d+px/.test(cardMatch[1]) && /border-radius\s*:\s*\d+px/.test(cardMatch[1]);
      if (!isCard) {
        cardRe.lastIndex = cardCloseEnd;
        continue;
      }

      const hasLeftSvg = /^\s*<(?:svg|span\b[^>]*>\s*<svg)/i.test(cardInner);
      const hasRightNumber = />\s*0[1-9]\s*<\/(?:span|div|b|strong)>/i.test(cardInner);

      cards.push({
        full: inner.substring(cardMatch.index, cardCloseEnd),
        attrs: cardMatch[1],
        inner: cardInner,
        hasLeftIcon: hasLeftSvg,
        hasRightNumber: hasRightNumber,
        start: cardMatch.index,
        end: cardCloseEnd,
      });

      cardRe.lastIndex = cardCloseEnd;
    }

    if (cards.length < 2) continue;
    const leftIconCount = cards.filter((c) => c.hasLeftIcon).length;
    if (leftIconCount === 0 || leftIconCount === cards.length) continue;

    const allHaveRightNumbers = cards.every((c) => c.hasRightNumber);
    let newInner = inner;
    for (let i = cards.length - 1; i >= 0; i--) {
      const c = cards[i];
      if (c.hasLeftIcon && allHaveRightNumbers) {
        // 仅当图标为「通用占位（check / trivial circle）」时剥离；
        // 语义图标（自定义 path/polygon/multi-line）一律保留，避免把作者精心画的 icon 删除。
        if (!firstLeftIconIsGeneric(c.inner)) continue;
        let cleaned = c.inner.replace(
          /^\s*<span\b[^>]*>\s*<svg\b[^>]*>[\s\S]*?<\/svg>\s*<\/span>\s*/i,
          '',
        );
        cleaned = cleaned.replace(/^\s*<svg\b[^>]*>[\s\S]*?<\/svg>\s*/i, '');
        const newCard = `<div${c.attrs}>${cleaned}</div>`;
        newInner = newInner.substring(0, c.start) + newCard + newInner.substring(c.end);
      } else if (!c.hasLeftIcon && !allHaveRightNumbers) {
        const newCard = `<div${c.attrs}>${makeIcon(20)}${c.inner}</div>`;
        newInner = newInner.substring(0, c.start) + newCard + newInner.substring(c.end);
      }
    }

    const newContainer = openTag + newInner + '</div>';
    replacements.push({
      start: containerMatch.index,
      end: closeEnd,
      content: newContainer,
    });
  }

  for (let i = replacements.length - 1; i >= 0; i--) {
    const r = replacements[i];
    result = result.substring(0, r.start) + r.content + result.substring(r.end);
  }

  return result;
}


export function repairEmptySvgs(html: string): string {
  let result = html;

  result = result.replace(/<svg\b([^>]*)>\s*<\/svg>/gi, (match: string, attrs: string) => {
    if (/<(?:path|rect|circle|polygon|polyline|line|ellipse|g|text|use)\b/i.test(match))
      return match;

    const widthMatch = attrs.match(/\bwidth\s*=\s*["']?(\d+)/i);
    const heightMatch = attrs.match(/\bheight\s*=\s*["']?(\d+)/i);
    const w = widthMatch ? parseInt(widthMatch[1], 10) : 0;
    const h = heightMatch ? parseInt(heightMatch[1], 10) : 0;

    let vbW = w;
    let vbH = h;
    const vbMatch = attrs.match(/\bviewBox\s*=\s*["']([^"']+)["']/i);
    if (vbMatch) {
      const parts = vbMatch[1].split(/[\s,]+/);
      if (parts.length >= 4) {
        vbW = parseInt(parts[2], 10) || w;
        vbH = parseInt(parts[3], 10) || h;
      }
    }

    if (w >= 10 && w <= 28 && h >= 10 && h <= 28) {
      const vw = vbW || w || 16;
      const vh = vbH || h || 16;
      const cx = vw / 2;
      const cy = vh / 2;
      const r = Math.min(vw, vh) * 0.28;
      return `<svg${attrs}><circle cx="${cx}" cy="${cy}" r="${r}" fill="#fff" opacity="0.9"/></svg>`;
    }

    return match;
  });

  return result;
}


/**
 * 修复卡片网格页中 <p> 错误包裹图标 span 的问题。
 * AI 有时会生成 <p style="..."><span style="...icon...">💻</span></p>，
 * 导致图标继承 p 的 font-size/line-height/margin，产生错位和多余留白。
 * 此函数仅解包「内部只有一个 span（图标容器）、没有其他文本」的 <p>。
 */
export function unwrapIconWrappingParagraph(html: string): string {
  return html.replace(
    /<p\b([^>]*)>\s*(<span\b[^>]*\b(?:display\s*:\s*inline-flex|border-radius)[^>]*>[\s\S]*?<\/span>)\s*<\/p>/gi,
    (_match: string, _pAttrs: string, innerSpan: string) => innerSpan,
  );
}

