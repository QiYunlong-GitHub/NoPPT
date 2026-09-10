/**
 * XSS 安全防护工具
 */

import {
  ALLOWED_TAGS,
  ALLOWED_ATTRIBUTES,
  ALLOWED_ATTR_SET,
  ALLOWED_CSS_PROPERTIES,
} from '@noppt/core';

const ALLOWED_PROTOCOLS = ['http:', 'https:', 'data:'];
const ALLOWED_HREF_PROTOCOLS = ['http:', 'https:'];

function parseStyleString(styleStr: string): Array<{ key: string; value: string; raw: string }> {
  const declarations: Array<{ key: string; value: string; raw: string }> = [];
  let i = 0;
  const len = styleStr.length;

  while (i < len) {
    while (
      i < len &&
      (styleStr[i] === ';' || styleStr[i] === ' ' || styleStr[i] === '\n' || styleStr[i] === '\t')
    )
      i++;
    if (i >= len) break;

    let colonIdx = -1;
    let depth = 0;
    let inQuote: 0 | 1 | 2 = 0; // 0 无，1 单引号，2 双引号
    for (let j = i; j < len; j++) {
      const ch = styleStr[j];
      // 引号状态机（括号外才切换）
      if (depth === 0) {
        if (ch === "'" && inQuote !== 2) inQuote = inQuote === 1 ? 0 : 1;
        else if (ch === '"' && inQuote !== 1) inQuote = inQuote === 2 ? 0 : 2;
      }
      if (inQuote === 0) {
        if (ch === '(') depth++;
        else if (ch === ')') depth--;
        else if (ch === ':' && depth === 0) {
          colonIdx = j;
          break;
        }
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
        else if (ch === ';' && depth2 === 0) {
          semiIdx = j;
          break;
        }
      }
    }

    const raw =
      semiIdx === -1 ? styleStr.substring(colonIdx + 1) : styleStr.substring(colonIdx + 1, semiIdx);
    const value = raw.trim();

    if (key && value) {
      declarations.push({ key, value, raw: `${key}: ${value}` });
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

/**
 * 从 slideWidth/slideHeight（如果能在运行时拿到，默认按 1280x720 基线）
 * 计算与 AI Agent 端 ensureOuterContainer / LayoutEngine 完全一致的 padding 默认值：
 *   padX = max(32, round((60*w/1280)/8)*8)   （AI 端取 60，48；LayoutEngine 取 64，48 → 这里统一为 AI 端逻辑：60/48）
 *   padY = max(24, round((48*h/720)/8)*8)
 */
function computeDefaultPadding(): { padX: number; padY: number } {
  const slideWidth = (globalThis as any).__NOPPT_SLIDE_WIDTH__ || 1280;
  const slideHeight = (globalThis as any).__NOPPT_SLIDE_HEIGHT__ || 720;
  const padX = Math.max(32, Math.round((60 * slideWidth) / 1280 / 8) * 8);
  const padY = Math.max(24, Math.round((48 * slideHeight) / 720 / 8) * 8);
  return { padX, padY };
}

function ensureRootContainerStyles(html: string): string {
  const trimmed = html.trim();
  if (!trimmed) return trimmed;
  const { padX, padY } = computeDefaultPadding();
  const defaultPadding = `${padY}px ${padX}px`;

  const outerDivMatch = trimmed.match(/^<div([^>]*)>([\s\S]*)<\/div>$/i);
  // 注意：内部有 position:absolute 装饰元素（halo、方块、分隔线），不代表根容器也该改成 absolute 布局！
  // 旧逻辑 hasAbsolute=true 会把根容器 padding 改成 0 并 delete display/flex 所有属性 → 这是 AI 返回的根布局被清空的元凶。
  // 新逻辑：根容器布局由 根容器自身 style 决定，内部子元素有没有 absolute 完全不影响根容器。
  const hasAbsoluteInner = /style="[^"]*position\s*:\s*absolute/i.test(trimmed);

  if (!outerDivMatch) {
    const fallbackProps: string[] = [
      'width: 100%',
      'height: 100%',
      'overflow: hidden',
      'position: relative',
      'box-sizing: border-box',
      `padding: ${defaultPadding}`,
      'display: flex',
      'flex-direction: column',
      "font-family: system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif",
      'background-color: #fff',
    ];
    return `<div style="${fallbackProps.join('; ')};">${trimmed}</div>`;
  }

  const attrs = outerDivMatch[1] || '';
  const inner = outerDivMatch[2] || '';
  const styleMatch = attrs.match(/style="([^"]*)"/i);
  const existingStyle = styleMatch ? styleMatch[1] : '';

  const styles: Record<string, string> = {};
  if (existingStyle) {
    for (const { key, value } of parseStyleString(existingStyle)) {
      styles[key] = value;
    }
  }

  // 根容器自身的 style 里如果已经写了 padding/display/flex 就用 AI 的，不干预
  // required 只是「缺失才补」的安全兜底
  const required: Record<string, string> = {
    width: '100%',
    height: '100%',
    overflow: 'hidden',
    position: 'relative',
    'box-sizing': 'border-box',
  };
  if (!styles['background-color'] && !styles['background'] && !styles['background-image']) {
    required['background-color'] = '#fff';
  }
  // 不管内部有没有 absolute，都按正常容器兜底：
  // - padding 只在 AI 没写时用默认（绝对定位元素本来就不依赖 padding 锚定）
  // - display / flex-direction / font-family 一律缺失才补
  if (!styles['padding']) required['padding'] = defaultPadding;
  if (!styles['display']) required['display'] = 'flex';
  if (!styles['flex-direction']) required['flex-direction'] = 'column';
  if (!styles['font-family'])
    required['font-family'] =
      "system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";

  for (const [k, v] of Object.entries(required)) {
    if (!styles[k]) styles[k] = v;
  }

  // 🛡️ 关键修复：不管 hasAbsoluteInner 真假，一律不再 delete 根容器的
  // display / flex-direction / justify-content / align-items / gap 等属性！
  // 因为：内部有绝对定位装饰块 ≠ 根容器就要用 absolute-only 坐标系。
  // 只要根容器有 position:relative（上面 required 保证了），内部 absolute 元素就能按根容器定位。
  void hasAbsoluteInner;

  const newStyle = Object.entries(styles)
    .map(([k, v]) => `${k}: ${v}`)
    .join('; ');
  let newAttrs: string;
  if (styleMatch) {
    newAttrs = attrs.replace(/style="[^"]*"/i, `style="${newStyle}"`);
  } else {
    newAttrs = `${attrs} style="${newStyle}"`;
  }
  return `<div${newAttrs}>${inner}</div>`;
}

export function sanitizeHtml(html: string): string {
  if (!html || typeof html !== 'string') return '';

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  const cleanNode = (node: Node) => {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as HTMLElement;
      const tagName = element.tagName.toLowerCase();

      if (!ALLOWED_TAGS.includes(tagName)) {
        // 策略：非白名单标签 → 「unwrap」（剥离标签本身，保留所有子节点）。
        // 关键修复：对子节点先收集，逐个提升到父节点后，**必须继续递归 clean 这些子节点**，
        // 因为子节点里可能还嵌套着非白名单标签（如外层 <div<div unwrap 后内层还有 <div<div 包着 <img>），
        // 原来的 return 过早，导致 Array.from 的静态 forEach 快照永远不会遍历到 unwrap 新插入的兄弟节点。
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
          // 对每个被提升的子节点继续递归 clean，确保内层嵌套的 <div<div / <ul<ul / <img> 的 style/src 都被正确处理
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

        if (attrName === 'href' || attrName === 'src') {
          const value = attr.value;
          try {
            const url = new URL(value, window.location.origin);
            const allowed = attrName === 'href' ? ALLOWED_HREF_PROTOCOLS : ALLOWED_PROTOCOLS;
            if (!allowed.includes(url.protocol)) {
              element.removeAttribute(attr.name);
            }
          } catch {
            element.removeAttribute(attr.name);
          }
          continue;
        }

        if (attrName === 'style') {
          const rawStyle = attr.value;
          const safeStyle = sanitizeStyleString(rawStyle);
          element.setAttribute('style', safeStyle);
          continue;
        }
      }

      // 白名单元素：动态扫描 + 原地扫描所有子节点。
      // 不用 Array.from(childNodes).forEach，因为深层子节点的 unwrap 会把节点提升为
      // 本元素的直接子节点（插在当前 child 之前），而静态快照会遗漏它们。
      // 正确做法：用「下一个兄弟指针」来推进，处理完当前节点时 next 已经记录了。
      let child = element.firstChild;
      while (child) {
        const next = child.nextSibling; // 先记住下一个，避免 cleanNode 内 unwrap 导致指针混乱
        cleanNode(child);
        child = next;
      }

      const eventAttributes = Array.from(element.attributes).filter((a) =>
        a.name.toLowerCase().startsWith('on'),
      );
      eventAttributes.forEach((a) => element.removeAttribute(a.name));
    }
  };

  // body 的所有子节点也用同样的「原地动态扫描」策略，避免顶层就漏了 unwrap 提升的兄弟
  let bodyChild = doc.body.firstChild;
  while (bodyChild) {
    const next = bodyChild.nextSibling;
    cleanNode(bodyChild);
    bodyChild = next;
  }

  return ensureRootContainerStyles(doc.body.innerHTML);
}

export function sanitizeStyle(style: CSSStyleDeclaration): string {
  const safeStyles: string[] = [];
  for (let i = 0; i < style.length; i++) {
    const prop = style.item(i).toLowerCase();
    if (ALLOWED_CSS_PROPERTIES.has(prop)) {
      const value = style.getPropertyValue(prop);
      if (!isDangerousCssValue(value)) {
        safeStyles.push(`${prop}: ${value}`);
      }
    }
  }
  return safeStyles.join('; ');
}

export function sanitizeElement(element: HTMLElement): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = element.outerHTML;
  const sanitizedHtml = sanitizeHtml(wrapper.innerHTML);
  wrapper.innerHTML = sanitizedHtml;
  return (wrapper.firstElementChild as HTMLElement) || element;
}

export function safeSetInnerHTML(element: HTMLElement, html: string): void {
  const sanitizedHtml = sanitizeHtml(html);
  element.innerHTML = sanitizedHtml;
}

export function safeHtml(html: string): { __html: string } {
  return {
    __html: sanitizeHtml(html),
  };
}
