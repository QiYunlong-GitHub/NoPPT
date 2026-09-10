import {
  renderSvgIcon,
  resolveIconByIndex,
} from '@noppt/ai/templates';

export type IconStyle = 'auto' | 'line' | 'filled' | 'numbered' | 'bullet' | 'lettered' | 'emoji' | 'none' | 'checkmark' | 'minimal';

const CHECK_SVG = `<svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M13 4L6.5 10.5L3 7" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const DASH_SVG = `<svg width="10" height="10" viewBox="0 0 10 10"><rect x="2" y="4.5" width="6" height="1.5" rx="0.75" fill="#9CA3AF"/></svg>`;
const EMOJI_POOL = ['🎯','📊','⚡','🛡️','💡','🤝','🚀','📈','🔍','✨','🔥','⭐','🏆','🎨','💎','🌐','🔑','📱','💻','🔧'];

function renderLineSvg(pathIdx: number, size: number, color: string): string {
  const name = resolveIconByIndex(pathIdx);
  return renderSvgIcon(name, 'line', size, color, 2);
}

function renderFilledSvg(pathIdx: number, size: number, color: string): string {
  const name = resolveIconByIndex(pathIdx);
  return renderSvgIcon(name, 'filled', size, color, 0);
}

function makeGradient(primary: string, darker: string): string {
  return `linear-gradient(135deg,${primary},${darker})`;
}

function darkenColor(hex: string, percent: number): string {
  const h = hex.replace('#', '');
  if (h.length !== 6) return hex;
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  const f = 1 - percent / 100;
  const nr = Math.max(0, Math.min(255, Math.round(r * f)));
  const ng = Math.max(0, Math.min(255, Math.round(g * f)));
  const nb = Math.max(0, Math.min(255, Math.round(b * f)));
  return '#' + [nr, ng, nb].map((c) => c.toString(16).padStart(2, '0')).join('');
}

function detectPrimaryColorFromElement(root: Element): string {
  const html = root.innerHTML;
  const gradMatch = html.match(/linear-gradient\(135deg,\s*(#[0-9a-fA-F]{6})\s*,/);
  if (gradMatch) return gradMatch[1];
  const colorMatch = html.match(/background:\s*(#[0-9a-fA-F]{6})/);
  if (colorMatch) return colorMatch[1];
  const styleColor = html.match(/color:\s*(#[0-9a-fA-F]{6})/);
  if (styleColor) return styleColor[1];
  const slideEl = root.closest('[data-slide-content="true"]');
  if (slideEl) {
    const slideHtml = slideEl.innerHTML;
    const gm = slideHtml.match(/linear-gradient\(135deg,\s*(#[0-9a-fA-F]{6})\s*,/);
    if (gm) return gm[1];
  }
  return '#2563eb';
}

function makeListIcon(style: IconStyle, idx: number, primary: string, darker: string, isCompareLeft: boolean = false): string {
  if (style === 'none') return '';

  if (isCompareLeft) {
    return `<span class="noppt-icon-marker" style="display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:20px;height:20px;border-radius:50%;background:#E5E7EB;">${DASH_SVG}</span>`;
  }

  const grad = makeGradient(primary, darker);
  const shadow = `0 2px 8px ${primary}40`;
  const letter = String.fromCharCode(65 + (idx % 26));

  switch (style) {
    case 'line':
      return `<span class="noppt-icon-marker" style="display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:28px;height:28px;border-radius:8px;background:${primary}10;color:${primary};">${renderLineSvg(idx, 18, primary)}</span>`;
    case 'filled':
      return `<span class="noppt-icon-marker" style="display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:28px;height:28px;border-radius:8px;background:${grad};box-shadow:${shadow};color:#fff;">${renderFilledSvg(idx, 18, '#fff')}</span>`;
    case 'numbered':
      return `<span class="noppt-icon-marker" style="display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:28px;height:28px;border-radius:8px;background:${grad};box-shadow:${shadow};color:#fff;font-size:14px;font-weight:800;">${idx + 1}</span>`;
    case 'checkmark':
    case 'bullet':
      return `<span class="noppt-icon-marker" style="display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:28px;height:28px;border-radius:50%;background:${grad};box-shadow:${shadow};">${CHECK_SVG}</span>`;
    case 'lettered':
      return `<span class="noppt-icon-marker" style="display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:28px;height:28px;border-radius:50%;background:${grad};box-shadow:${shadow};color:#fff;font-size:13px;font-weight:800;">${letter}</span>`;
    case 'minimal':
      return `<span class="noppt-icon-marker" style="display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:10px;height:10px;border-radius:50%;background:${primary};"></span>`;
    case 'emoji': {
      const emoji = EMOJI_POOL[idx % EMOJI_POOL.length];
      const useBg = idx % 2 === 1;
      if (useBg) {
        const radius = idx % 4 === 1 ? '10px' : '50%';
        return `<span class="noppt-icon-marker" style="display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:40px;height:40px;border-radius:${radius};background:${primary}12;font-size:20px;line-height:1;">${emoji}</span>`;
      }
      return `<span class="noppt-icon-marker" style="display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:32px;height:28px;font-size:22px;line-height:1;">${emoji}</span>`;
    }
    case 'auto':
    default:
      return `<span class="noppt-icon-marker" style="display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:28px;height:28px;border-radius:8px;background:${primary}10;color:${primary};">${renderLineSvg(idx, 18, primary)}</span>`;
  }
}

function makeCircleIcon(size: number, fontSize: number, num: number, primary: string, darker: string, fontWeight: number = 700, shadowAlpha: string = '30'): string {
  const grad = makeGradient(primary, darker);
  const shadowY = size > 44 ? 4 : 3;
  const shadowBlur = size > 44 ? 16 : 12;
  const shadow = `0 ${shadowY}px ${shadowBlur}px ${primary}${shadowAlpha}`;
  return `<span class="noppt-icon-marker" style="display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:${size}px;height:${size}px;border-radius:50%;background:${grad};box-shadow:${shadow};color:#fff;font-size:${fontSize}px;font-weight:${fontWeight};">${num}</span>`;
}

function makeBigBadgeIcon(style: IconStyle, idx: number, size: number, primary: string, darker: string): string {
  const iconSize = Math.round(size * 0.46);
  const radius = Math.round(size * 0.25);
  if (style === 'filled') {
    const grad = makeGradient(primary, darker);
    const shadow = `0 ${size > 44 ? 4 : 2}px ${size > 44 ? 12 : 8}px ${primary}40`;
    return `<span class="noppt-icon-marker" style="display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:${size}px;height:${size}px;border-radius:${radius}px;background:${grad};box-shadow:${shadow};color:#fff;">${renderFilledSvg(idx, iconSize, '#fff')}</span>`;
  }
  if (style === 'emoji') {
    const emoji = EMOJI_POOL[idx % EMOJI_POOL.length];
    return `<span class="noppt-icon-marker" style="display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:${size}px;height:${size}px;border-radius:${radius}px;background:${primary}12;font-size:${Math.round(iconSize * 1.1)}px;line-height:1;">${emoji}</span>`;
  }
  return `<span class="noppt-icon-marker" style="display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:${size}px;height:${size}px;border-radius:${radius}px;background:${primary}14;color:${primary};">${renderLineSvg(idx, iconSize, primary)}</span>`;
}

function replaceIconsInContainer(container: Element, newStyle: IconStyle, primary?: string, startIdx: number = 0): { primary: string; count: number } {
  const detectedPrimary = primary || detectPrimaryColorFromElement(container);
  const darker = darkenColor(detectedPrimary, 20);

  let ulCount = 0;
  const ulElements = container.querySelectorAll('ul');
  const directUls: HTMLUListElement[] = [];
  ulElements.forEach((ul) => {
    let nestedInReplaced = false;
    let parent: Element | null = ul.parentElement;
    while (parent && parent !== container) {
      if (parent.tagName === 'UL') { nestedInReplaced = true; break; }
      parent = parent.parentElement;
    }
    if (!nestedInReplaced) directUls.push(ul as HTMLUListElement);
  });

  directUls.forEach((ul) => {
    const lis = Array.from(ul.children).filter((el) => el.tagName === 'LI');
    const isCompareColumn = ul.closest('div[style*="border"]') !== null;
    const isInCompareLeft = isCompareColumn && !ul.querySelector(':scope > li > span[style*="box-shadow"]');

    lis.forEach((li, idx) => {
      const liEl = li as HTMLElement;
      const existingIcon = liEl.querySelector(':scope > span.noppt-icon-marker') || liEl.querySelector(':scope > span:first-child');
      const isLeftCompareItem = isInCompareLeft && existingIcon?.querySelector('svg rect');

      liEl.style.display = 'flex';
      liEl.style.alignItems = 'center';
      liEl.style.gap = '14px';
      liEl.style.listStyle = 'none';
      liEl.style.overflowWrap = 'break-word';
      liEl.style.wordBreak = 'break-word';
      ul.style.listStyle = 'none';
      ul.style.paddingLeft = '0';

      const newIconHtml = makeListIcon(newStyle, startIdx + idx, detectedPrimary, darker, !!isLeftCompareItem);

      if (existingIcon) {
        if (newIconHtml) {
          existingIcon.outerHTML = newIconHtml;
        } else {
          existingIcon.remove();
        }
      } else if (newIconHtml) {
        liEl.insertAdjacentHTML('afterbegin', newIconHtml);
      }
      const textSpan = liEl.querySelector(':scope > span:last-child');
      if (textSpan && textSpan !== existingIcon) {
        (textSpan as HTMLElement).style.lineHeight = '1.4';
        (textSpan as HTMLElement).style.flex = '1';
      }
      ulCount++;
    });
  });

  let bigCircleCount = 0;
  const allSpans = container.querySelectorAll('span.noppt-icon-marker, span[style*="border-radius:50%"]');
  const bigCircleSpans: HTMLElement[] = [];
  allSpans.forEach((span) => {
    const el = span as HTMLElement;
    const style = el.getAttribute('style') || '';
    if (
      style.includes('border-radius:50%') &&
      style.includes('linear-gradient') &&
      style.includes('box-shadow') &&
      style.match(/width:(\d+)px/)
    ) {
      const w = parseInt(style.match(/width:(\d+)px/)![1]);
      if (w >= 32) {
        bigCircleSpans.push(el);
      }
    }
  });

  bigCircleSpans.forEach((span, idx) => {
    const style = span.getAttribute('style') || '';
    const widthMatch = style.match(/width:(\d+)px/);
    const size = widthMatch ? parseInt(widthMatch[1]) : 44;

    let targetSize = size;
    let targetFontSize = 18;
    let targetWeight = 700;
    let shadowAlpha = '30';

    if (size >= 56) {
      targetFontSize = 24;
      targetWeight = 800;
      shadowAlpha = '35';
    } else if (size >= 44) {
      targetFontSize = 18;
      targetWeight = 700;
      shadowAlpha = '30';
    } else if (size >= 40) {
      targetFontSize = 18;
      targetWeight = 700;
      shadowAlpha = '30';
    } else if (size >= 32) {
      targetFontSize = 16;
      targetWeight = 700;
      shadowAlpha = '30';
    }

    const num = idx + 1;
    const newSpanHtml = makeCircleIcon(targetSize, targetFontSize, num, detectedPrimary, darker, targetWeight, shadowAlpha);
    span.outerHTML = newSpanHtml;
    bigCircleCount++;
  });

  return { primary: detectedPrimary, count: ulCount + bigCircleCount };
}

export function replaceIconsInHtml(html: string, newStyle: IconStyle): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<!DOCTYPE html><html><body>${html}</body></html>`, 'text/html');
  const container = doc.body;

  if (!container.firstElementChild) return html;

  replaceIconsInContainer(container, newStyle);

  return container.innerHTML;
}

export function replaceIconsInElement(element: HTMLElement, newStyle: IconStyle, primary?: string): number {
  const liveEl = (element.isConnected ? element : (document.getElementById(element.id) || element)) as HTMLElement;
  if (!liveEl || !liveEl.isConnected) return 0;
  const { count } = replaceIconsInContainer(liveEl, newStyle, primary);
  return count;
}

export function replaceIconsInElements(elements: HTMLElement[], newStyle: IconStyle, primary?: string): number {
  if (elements.length === 0) return 0;
  const liveElements = elements
    .map((el) => (el.isConnected ? el : (document.getElementById(el.id) as HTMLElement | null)))
    .filter((el): el is HTMLElement => !!el && el.isConnected);
  if (liveElements.length === 0) return 0;
  const detectedPrimary = primary || detectPrimaryColorFromElement(liveElements[0].closest('[data-slide-content="true"]') || liveElements[0]);
  let total = 0;
  liveElements.forEach((el) => {
    const { count } = replaceIconsInContainer(el, newStyle, detectedPrimary, total);
    total += count;
  });
  return total;
}

function isPlainTextContainer(el: Element): boolean {
  if (el.tagName === 'UL' || el.tagName === 'OL') return false;
  if (el.querySelector('ul, ol, table, img, svg, video, iframe, h1, h2, h3, button, input, select, textarea, .noppt-slide-image-element, .noppt-group-element')) return false;
  const text = (el.textContent || '').trim();
  if (!text) return false;
  return true;
}

function extractLinesFromContainer(el: HTMLElement): string[] {
  const lines: string[] = [];

  const brSplit = el.innerHTML.split(/<br\s*\/?>/i);
  if (brSplit.length >= 2) {
    brSplit.forEach((l) => {
      const div = document.createElement('div');
      div.innerHTML = l;
      const t = (div.textContent || '').trim();
      if (t) lines.push(t);
    });
    if (lines.length >= 2) return lines;
    lines.length = 0;
  }

  const childBlocks = Array.from(el.children).filter(
    (c) => (c.tagName === 'DIV' || c.tagName === 'P' || c.tagName === 'SPAN') && isPlainTextContainer(c)
  );
  if (childBlocks.length >= 2) {
    childBlocks.forEach((c) => {
      const t = (c.textContent || '').trim();
      if (t) lines.push(t);
    });
    if (lines.length >= 2) return lines;
    lines.length = 0;
  }

  const directText = Array.from(el.childNodes)
    .filter((n) => n.nodeType === Node.TEXT_NODE)
    .map((n) => (n.textContent || '').trim())
    .filter((t) => t)
    .join(' ');
  if (directText) {
    return [directText];
  }

  const singleText = (el.textContent || '').trim();
  if (singleText) {
    return [singleText];
  }

  return [];
}

export function findBestIconContainer(el: HTMLElement): HTMLElement {
  let best: HTMLElement = el;
  let bestLineCount = extractLinesFromContainer(el).length;
  let current: HTMLElement | null = el;
  const maxDepth = 8;
  let depth = 0;

  while (current && depth < maxDepth) {
    const lines = extractLinesFromContainer(current);
    if (lines.length > bestLineCount) {
      bestLineCount = lines.length;
      best = current;
    }
    depth++;
    current = current.parentElement;
    if (current && current.hasAttribute('data-slide-content')) break;
  }

  return best;
}

function rebuildElementWithIcons(el: HTMLElement, lines: string[], newStyle: IconStyle, primary: string, darker: string, globalIdx: number): HTMLUListElement {
  const ul = document.createElement('ul');
  ul.style.listStyle = 'none';
  ul.style.paddingLeft = '0';
  ul.style.margin = '0';

  lines.forEach((text, idx) => {
    const li = document.createElement('li');
    li.style.display = 'flex';
    li.style.alignItems = 'center';
    li.style.gap = '14px';
    li.style.listStyle = 'none';
    li.style.overflowWrap = 'break-word';
    li.style.wordBreak = 'break-word';
    li.style.margin = '0';
    li.style.padding = '0';

    const iconHtml = makeListIcon(newStyle, globalIdx + idx, primary, darker, false);
    if (iconHtml) {
      li.insertAdjacentHTML('afterbegin', iconHtml);
    }

    const textSpan = document.createElement('span');
    textSpan.textContent = text;
    textSpan.style.flex = '1';
    textSpan.style.lineHeight = '1.4';
    li.appendChild(textSpan);

    ul.appendChild(li);
  });

  return ul;
}

export interface AddIconsResult {
  count: number;
  replacements: Map<HTMLElement, HTMLElement>;
}

export function addIconsToElements(elements: HTMLElement[], newStyle: IconStyle): AddIconsResult {
  const result: AddIconsResult = { count: 0, replacements: new Map() };
  if (elements.length === 0) return result;
  if (newStyle === 'none') return result;

  const liveElements = elements
    .map((el) => (el.isConnected ? el : (document.getElementById(el.id) as HTMLElement | null)))
    .filter((el): el is HTMLElement => !!el && el.isConnected);
  if (liveElements.length === 0) return result;

  const slideEl = liveElements[0].closest('[data-slide-content="true"]') as HTMLElement | null;
  const detectedPrimary = detectPrimaryColorFromElement(slideEl || liveElements[0]);
  const darker = darkenColor(detectedPrimary, 20);

  let totalAdded = 0;
  let globalIdx = 0;

  liveElements.forEach((el) => {
    const best = findBestIconContainer(el);
    let lines = extractLinesFromContainer(best);
    const sourceEl = best;

    if (lines.length < 2) {
      const parent = best.parentElement;
      if (parent && parent !== slideEl) {
        const siblings = Array.from(parent.children).filter((c) => isPlainTextContainer(c) && (c.tagName === 'DIV' || c.tagName === 'P')) as HTMLElement[];
        if (siblings.length >= 3) {
          const siblingLines: string[] = [];
          siblings.forEach((s) => {
            const t = (s.textContent || '').trim();
            if (t) siblingLines.push(t);
          });
          if (siblingLines.length >= 3) {
            const wrapper = document.createElement('div');
            siblings[0].parentElement!.insertBefore(wrapper, siblings[0]);
            siblings.forEach((s) => wrapper.appendChild(s));
            lines = siblingLines;
            best.replaceWith(wrapper);
            const ul = rebuildElementWithIcons(wrapper, lines, newStyle, detectedPrimary, darker, globalIdx);
            wrapper.replaceWith(ul);
            result.replacements.set(sourceEl, ul);
            totalAdded += lines.length;
            globalIdx += lines.length;
            return;
          }
        }
      }
    }

    if (lines.length === 0) return;

    const ul = rebuildElementWithIcons(best, lines, newStyle, detectedPrimary, darker, globalIdx);
    best.replaceWith(ul);
    result.replacements.set(sourceEl, ul);

    totalAdded += lines.length;
    globalIdx += lines.length;
  });

  result.count = totalAdded;
  return result;
}

export function findAndAddIconsInSlide(slideEl: HTMLElement, newStyle: IconStyle): number {
  if (newStyle === 'none') return 0;

  const detectedPrimary = detectPrimaryColorFromElement(slideEl);
  const darker = darkenColor(detectedPrimary, 20);

  const candidates: HTMLElement[] = [];
  const seen = new Set<HTMLElement>();

  const checkSiblings = (parent: HTMLElement) => {
    const plainChildren = Array.from(parent.children).filter((c) => isPlainTextContainer(c) && (c.tagName === 'DIV' || c.tagName === 'P')) as HTMLElement[];
    if (plainChildren.length >= 2 && !seen.has(parent)) {
      seen.add(parent);
      candidates.push(parent);
    }
  };

  slideEl.querySelectorAll(':scope > div, :scope > div > div, :scope > div > div > div').forEach((d) => {
    const html = d.innerHTML;
    const brCount = (html.match(/<br\s*\/?>/gi) || []).length;
    const lines = extractLinesFromContainer(d as HTMLElement);
    if (brCount >= 2 || lines.length >= 3) {
      if (!seen.has(d as HTMLElement)) {
        seen.add(d as HTMLElement);
        candidates.push(d as HTMLElement);
      }
    }
    checkSiblings(d as HTMLElement);
  });

  slideEl.querySelectorAll('div, p').forEach((el) => {
    checkSiblings(el.parentElement as HTMLElement);
  });

  let totalAdded = 0;
  let globalIdx = 0;

  const processed = new Set<HTMLElement>();

  candidates.forEach((cand) => {
    if (processed.has(cand)) return;
    if (cand.closest('ul, ol')) return;

    const plainChildren = Array.from(cand.children).filter((c) => isPlainTextContainer(c) && (c.tagName === 'DIV' || c.tagName === 'P')) as HTMLElement[];

    if (plainChildren.length >= 2) {
      const lines: string[] = [];
      plainChildren.forEach((c) => {
        const t = (c.textContent || '').trim();
        if (t) lines.push(t);
      });
      if (lines.length >= 2) {
        const ul = rebuildElementWithIcons(cand, lines, newStyle, detectedPrimary, darker, globalIdx);
        plainChildren.forEach((c) => c.remove());
        cand.appendChild(ul);
        totalAdded += lines.length;
        globalIdx += lines.length;
        processed.add(cand);
        return;
      }
    }

    const lines = extractLinesFromContainer(cand);
    if (lines.length >= 2) {
      const ul = rebuildElementWithIcons(cand, lines, newStyle, detectedPrimary, darker, globalIdx);
      cand.replaceWith(ul);
      totalAdded += lines.length;
      globalIdx += lines.length;
      processed.add(cand);
    }
  });

  return totalAdded;
}
