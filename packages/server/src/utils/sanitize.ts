import { JSDOM } from 'jsdom';
import {
  ALLOWED_TAGS,
  ALLOWED_ATTRIBUTES,
  ALLOWED_ATTR_SET,
  ALLOWED_CSS_PROPERTIES,
} from '@noppt/core';

const ALLOWED_HREF_PROTOCOLS = new Set(['http:', 'https:']);

function parseStyleString(styleStr: string): Array<{ key: string; value: string }> {
  const declarations: Array<{ key: string; value: string }> = [];
  let i = 0;
  const len = styleStr.length;

  while (i < len) {
    while (i < len && (styleStr[i] === ';' || styleStr[i] === ' ' || styleStr[i] === '\n' || styleStr[i] === '\t')) i++;
    if (i >= len) break;

    let colonIdx = -1;
    let depth = 0;
    let inQuote: 0 | 1 | 2 = 0;
    for (let j = i; j < len; j++) {
      const ch = styleStr[j];
      if (depth === 0) {
        if (ch === "'" && inQuote !== 2) inQuote = inQuote === 1 ? 0 : 1;
        else if (ch === '"' && inQuote !== 1) inQuote = inQuote === 2 ? 0 : 2;
      }
      if (inQuote === 0) {
        if (ch === '(') depth++;
        else if (ch === ')') depth--;
        else if (ch === ':' && depth === 0) { colonIdx = j; break; }
      }
    }
    if (colonIdx === -1) break;

    const key = styleStr.substring(i, colonIdx).trim().toLowerCase();
    let semiIdx = -1;
    let depth2 = 0;
    let inQuote2: 0 | 1 | 2 = 0;
    for (let j = colonIdx + 1; j < len; j++) {
      const ch = styleStr[j];
      if (depth2 === 0) {
        if (ch === "'" && inQuote2 !== 2) inQuote2 = inQuote2 === 1 ? 0 : 1;
        else if (ch === '"' && inQuote2 !== 1) inQuote2 = inQuote2 === 2 ? 0 : 2;
      }
      if (inQuote2 === 0) {
        if (ch === '(') depth2++;
        else if (ch === ')') depth2--;
        else if (ch === ';' && depth2 === 0) { semiIdx = j; break; }
      }
    }

    const raw = semiIdx === -1 ? styleStr.substring(colonIdx + 1) : styleStr.substring(colonIdx + 1, semiIdx);
    const value = raw.trim();

    if (key && value) {
      declarations.push({ key, value });
    }

    i = semiIdx === -1 ? len : semiIdx + 1;
  }

  return declarations;
}

function isDangerousCssValue(value: string): boolean {
  if (/javascript:/i.test(value)) return true;
  if (/vbscript:/i.test(value)) return true;
  if (/expression\(/i.test(value)) return true;
  if (/@import/i.test(value)) return true;
  if (/behavior:/i.test(value)) return true;

  if (/url\(/i.test(value)) {
    const urlMatches = value.match(/url\(\s*['"]?([^'")]+)['"]?\s*\)/gi);
    if (urlMatches) {
      for (const m of urlMatches) {
        const inner = m.match(/url\(\s*['"]?([^'")]+)['"]?\s*\)/i);
        if (inner) {
          const url = inner[1].trim();
          if (url.startsWith('data:image')) continue;
          if (url.startsWith('http://') || url.startsWith('https://')) continue;
          if (url.startsWith('/')) continue;
          return true;
        }
      }
      return false;
    }
    return true;
  }

  return false;
}

function sanitizeStyleString(styleStr: string): string {
  const declarations = parseStyleString(styleStr);
  const safe: string[] = [];

  for (const { key, value } of declarations) {
    if (!ALLOWED_CSS_PROPERTIES.has(key)) continue;
    if (isDangerousCssValue(value)) continue;
    safe.push(`${key}: ${value}`);
  }

  return safe.join('; ');
}

function isSafeDataUrl(value: string): boolean {
  return /^data:image\//i.test(value);
}

function resolveUrlProtocol(value: string): { ok: boolean; protocol: string | null } {
  const trimmed = value.trim();
  if (!trimmed) return { ok: false, protocol: null };
  if (trimmed.startsWith('/') || trimmed.startsWith('#') || trimmed.startsWith('/data/')) {
    return { ok: true, protocol: null };
  }
  if (/^data:image\//i.test(trimmed)) {
    return { ok: true, protocol: 'data:' };
  }
  try {
    const url = new URL(trimmed, 'http://localhost');
    return { ok: true, protocol: url.protocol };
  } catch {
    return { ok: false, protocol: null };
  }
}

let sharedDom: JSDOM | null = null;

function getDom(): JSDOM {
  if (!sharedDom) {
    sharedDom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
      url: 'http://localhost/',
      pretendToBeVisual: false,
    });
  }
  return sharedDom;
}

export function sanitizeHtmlServerSide(html: string): string {
  if (!html || typeof html !== 'string') return '';

  const dom = getDom();
  const document = dom.window.document;
  const container = document.createElement('div');
  container.innerHTML = html;

  const cleanNode = (node: Node) => {
    if (node.nodeType !== dom.window.Node.ELEMENT_NODE) return;
    const element = node as HTMLElement;
    const tagName = element.tagName.toLowerCase();

    if (!ALLOWED_TAGS.includes(tagName)) {
      const parent = element.parentNode;
      if (parent) {
        const movedChildren: Node[] = [];
        while (element.firstChild) {
          const child = element.firstChild;
          element.removeChild(child);
          parent.insertBefore(child, element);
          movedChildren.push(child);
        }
        parent.removeChild(element);
        movedChildren.forEach(cleanNode);
      }
      return;
    }

    const attributes = Array.from(element.attributes);
    for (const attr of attributes) {
      const attrName = attr.name.toLowerCase();

      if (!ALLOWED_ATTR_SET.has(attrName)) {
        element.removeAttribute(attr.name);
        continue;
      }

      if (attrName === 'href') {
        const resolved = resolveUrlProtocol(attr.value);
        if (!resolved.ok || (resolved.protocol && !ALLOWED_HREF_PROTOCOLS.has(resolved.protocol))) {
          element.removeAttribute(attr.name);
        }
        continue;
      }

      if (attrName === 'src') {
        const value = attr.value.trim();
        if (/^data:/i.test(value)) {
          if (!isSafeDataUrl(value)) {
            element.removeAttribute(attr.name);
          }
          continue;
        }
        const resolved = resolveUrlProtocol(value);
        if (!resolved.ok) {
          element.removeAttribute(attr.name);
          continue;
        }
        if (resolved.protocol && resolved.protocol !== 'http:' && resolved.protocol !== 'https:' && resolved.protocol !== 'data:') {
          element.removeAttribute(attr.name);
        }
        continue;
      }

      if (attrName === 'style') {
        const safeStyle = sanitizeStyleString(attr.value);
        element.setAttribute('style', safeStyle);
        continue;
      }
    }

    let child = element.firstChild;
    while (child) {
      const next = child.nextSibling;
      cleanNode(child);
      child = next;
    }

    const eventAttributes = Array.from(element.attributes).filter((a) =>
      a.name.toLowerCase().startsWith('on')
    );
    eventAttributes.forEach((a) => element.removeAttribute(a.name));
  };

  let bodyChild = container.firstChild;
  while (bodyChild) {
    const next = bodyChild.nextSibling;
    cleanNode(bodyChild);
    bodyChild = next;
  }

  return container.innerHTML;
}

export interface SanitizeableLike {
  html?: string;
  [key: string]: any;
}

export function sanitizeSlidesHtml<T extends SanitizeableLike>(slides: T[]): T[] {
  if (!Array.isArray(slides)) return slides;
  return slides.map((slide) => {
    if (!slide || typeof slide.html !== 'string') return slide;
    return { ...slide, html: sanitizeHtmlServerSide(slide.html) };
  });
}
