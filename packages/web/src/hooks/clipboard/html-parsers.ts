import { sanitizeHtml } from '@/utils';
import { createTextElement } from '@/utils/elementFactories';

const PASTED_LAYOUT_PROPS = [
  'display',
  'flex-direction',
  'flex-wrap',
  'align-items',
  'align-content',
  'justify-content',
  'justify-items',
  'grid-template-columns',
  'grid-template-rows',
  'grid-column',
  'grid-row',
  'gap',
  'width',
  'height',
  'min-width',
  'min-height',
  'max-width',
  'max-height',
  'overflow',
  'overflow-x',
  'overflow-y',
  'position',
  'left',
  'top',
  'right',
  'bottom',
  'box-sizing',
];

const createTableFromHtml = (html: string, x: number, y: number): HTMLElement => {
  const cssRules: { selector: string; styles: Record<string, string> }[] = [];

  const styleRegex = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let styleMatch;
  while ((styleMatch = styleRegex.exec(html)) !== null) {
    const cssText = styleMatch[1] || '';
    const ruleRegex = /([^{]+)\s*\{([^}]+)\}/g;
    let match;
    while ((match = ruleRegex.exec(cssText)) !== null) {
      const selector = match[1].trim();
      const body = match[2].trim();
      const styles: Record<string, string> = {};
      let farEastFont = '';
      body.split(';').forEach((decl) => {
        const colonIdx = decl.indexOf(':');
        if (colonIdx > 0) {
          const prop = decl.slice(0, colonIdx).trim().toLowerCase();
          const val = decl.slice(colonIdx + 1).trim();
          if (!prop || !val) return;
          if (prop === 'mso-fareast-font-family') {
            farEastFont = val.replace(/^['"]|['"]$/g, '');
            return;
          }
          if (prop.startsWith('mso-') && prop !== 'mso-number-format') {
            return;
          }
          styles[prop] = val;
        }
      });
      if (farEastFont && styles['font-family']) {
        styles['font-family'] = `${farEastFont}, ${styles['font-family']}`;
      } else if (farEastFont) {
        styles['font-family'] = farEastFont;
      }
      if (Object.keys(styles).length > 0) {
        cssRules.push({ selector, styles });
      }
    }
  }

  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = sanitizeHtml(html);

  const table = tempDiv.querySelector('table');
  if (!table) {
    return createTextElement(html.replace(/<[^>]*>/g, ''), x, y);
  }

  const getSelectorPriority = (selector: string): number => {
    if (selector.includes(' ')) {
      const parts = selector.split(/\s+/);
      const last = parts[parts.length - 1];
      return getSelectorPriority(last) + 1;
    }
    if (selector.includes('.')) {
      if (/^[a-zA-Z][a-zA-Z0-9]*\./.test(selector)) {
        return 3;
      }
      return 2;
    }
    return 1;
  };

  const sortedRules = [...cssRules].sort(
    (a, b) => getSelectorPriority(a.selector) - getSelectorPriority(b.selector),
  );

  const applyStylesFromRules = (el: Element) => {
    const element = el as HTMLElement;
    const classList = Array.from(element.classList);
    const tagName = element.tagName.toLowerCase();

    const originalStyle = element.style.cssText;

    sortedRules.forEach(({ selector, styles }) => {
      let matches = false;

      if (selector.startsWith('.') && classList.includes(selector.slice(1))) {
        matches = true;
      } else if (selector.toLowerCase() === tagName) {
        matches = true;
      } else if (selector.includes('.')) {
        const dotIdx = selector.indexOf('.');
        const selTag = selector.slice(0, dotIdx).toLowerCase();
        const selClass = selector.slice(dotIdx + 1);
        if (selTag === tagName && classList.includes(selClass)) {
          matches = true;
        }
      } else if (selector.includes(' ')) {
        const parts = selector.split(/\s+/);
        const lastPart = parts[parts.length - 1];
        if (lastPart.startsWith('.') && classList.includes(lastPart.slice(1))) {
          matches = true;
        } else if (lastPart.toLowerCase() === tagName) {
          matches = true;
        } else if (lastPart.includes('.')) {
          const dotIdx = lastPart.indexOf('.');
          const selTag = lastPart.slice(0, dotIdx).toLowerCase();
          const selClass = lastPart.slice(dotIdx + 1);
          if (selTag === tagName && classList.includes(selClass)) {
            matches = true;
          }
        }
      }

      if (matches) {
        Object.entries(styles).forEach(([prop, val]) => {
          element.style.setProperty(prop, val);
        });
      }
    });

    if (originalStyle) {
      const temp = document.createElement('div');
      temp.style.cssText = originalStyle;
      for (let i = 0; i < temp.style.length; i++) {
        const prop = temp.style[i];
        const val = temp.style.getPropertyValue(prop);
        element.style.setProperty(prop, val);
      }
    }

    element.querySelectorAll('*').forEach((child) => {
      applyStylesFromRules(child);
    });
  };

  applyStylesFromRules(table);

  table.style.position = 'absolute';
  table.style.left = `${x}px`;
  table.style.top = `${y}px`;
  table.style.userSelect = 'none';
  table.style.cursor = 'move';
  table.style.maxWidth = 'none';
  table.style.maxHeight = 'none';

  if (!table.style.borderCollapse) {
    table.style.borderCollapse = 'collapse';
  }

  table.setAttribute('data-noppt-table', 'true');

  const cells = table.querySelectorAll('th, td');
  cells.forEach((cell) => {
    const cellEl = cell as HTMLElement;
    if (!cellEl.style.border) {
      cellEl.style.border = '1px solid #cbd5e1';
    }
    if (!cellEl.style.padding) {
      cellEl.style.padding = '8px 12px';
    }
  });

  return table;
};

const createRichTextFromHtml = (html: string, x: number, y: number): HTMLElement => {
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = sanitizeHtml(html);

  const styleElements = tempDiv.querySelectorAll('style');
  const cssRules: { selector: string; styles: Record<string, string> }[] = [];

  styleElements.forEach((styleEl) => {
    const cssText = styleEl.textContent || '';
    const ruleRegex = /([^{]+)\s*\{([^}]+)\}/g;
    let match;
    while ((match = ruleRegex.exec(cssText)) !== null) {
      const selector = match[1].trim();
      if (selector.startsWith('@')) return;
      const body = match[2].trim();
      const styles: Record<string, string> = {};
      let farEastFont = '';
      body.split(';').forEach((decl) => {
        const colonIdx = decl.indexOf(':');
        if (colonIdx > 0) {
          const prop = decl.slice(0, colonIdx).trim().toLowerCase();
          const val = decl.slice(colonIdx + 1).trim();
          if (!prop || !val) return;
          if (prop === 'mso-fareast-font-family') {
            farEastFont = val.replace(/^['"]|['"]$/g, '');
            return;
          }
          if (prop.startsWith('mso-')) return;
          styles[prop] = val;
        }
      });
      if (farEastFont && styles['font-family']) {
        styles['font-family'] = `${farEastFont}, ${styles['font-family']}`;
      } else if (farEastFont) {
        styles['font-family'] = farEastFont;
      }
      if (Object.keys(styles).length > 0) {
        cssRules.push({ selector, styles });
      }
    }
  });

  styleElements.forEach((el) => el.remove());

  const cleanPastedLayoutStyles = (root: HTMLElement) => {
    const all = root.querySelectorAll<HTMLElement>('*');
    all.forEach((el) => {
      const tag = el.tagName.toLowerCase();
      if (tag === 'img' || tag === 'table' || tag === 'video') return;
      const isAbsolute = el.style.position === 'absolute';
      PASTED_LAYOUT_PROPS.forEach((prop) => {
        if (prop === 'position' && isAbsolute) return;
        el.style.removeProperty(prop);
      });
      if (isAbsolute) {
        el.style.position = 'absolute';
      }
    });
  };

  cleanPastedLayoutStyles(tempDiv);

  const walker = document.createTreeWalker(tempDiv, NodeFilter.SHOW_COMMENT);
  const comments: Comment[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const text = (node as Comment).data || '';
    if (text.includes('StartFragment') || text.includes('EndFragment')) {
      comments.push(node as Comment);
    }
  }
  comments.forEach((c) => c.parentNode?.removeChild(c));

  const contentDiv = document.createElement('div');
  contentDiv.style.cssText = `
    position: absolute;
    left: ${x}px;
    top: ${y}px;
    min-width: 100px;
    min-height: 24px;
    padding: 4px 8px;
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-word;
  `;

  while (tempDiv.firstChild) {
    contentDiv.appendChild(tempDiv.firstChild);
  }

  const getSelectorPriority = (selector: string): number => {
    if (selector.includes(' ')) {
      const parts = selector.split(/\s+/);
      const last = parts[parts.length - 1];
      return getSelectorPriority(last) + 1;
    }
    if (selector.includes('.')) {
      if (/^[a-zA-Z][a-zA-Z0-9]*\./.test(selector)) {
        return 3;
      }
      return 2;
    }
    return 1;
  };

  const sortedRules = [...cssRules].sort(
    (a, b) => getSelectorPriority(a.selector) - getSelectorPriority(b.selector),
  );

  const applyStylesFromRules = (el: Element) => {
    const element = el as HTMLElement;
    const classList = Array.from(element.classList);
    const tagName = element.tagName.toLowerCase();

    const originalStyle = element.style.cssText;

    sortedRules.forEach(({ selector, styles }) => {
      let matches = false;

      if (selector.startsWith('.') && classList.includes(selector.slice(1))) {
        matches = true;
      } else if (selector.toLowerCase() === tagName) {
        matches = true;
      } else if (selector.includes('.')) {
        const dotIdx = selector.indexOf('.');
        const selTag = selector.slice(0, dotIdx).toLowerCase();
        const selClass = selector.slice(dotIdx + 1);
        if (selTag === tagName && classList.includes(selClass)) {
          matches = true;
        }
      } else if (selector.includes(' ')) {
        const parts = selector.split(/\s+/);
        const lastPart = parts[parts.length - 1];
        if (lastPart.startsWith('.') && classList.includes(lastPart.slice(1))) {
          matches = true;
        } else if (lastPart.toLowerCase() === tagName) {
          matches = true;
        } else if (lastPart.includes('.')) {
          const dotIdx = lastPart.indexOf('.');
          const selTag = lastPart.slice(0, dotIdx).toLowerCase();
          const selClass = lastPart.slice(dotIdx + 1);
          if (selTag === tagName && classList.includes(selClass)) {
            matches = true;
          }
        }
      }

      if (matches) {
        Object.entries(styles).forEach(([prop, val]) => {
          if (PASTED_LAYOUT_PROPS.includes(prop)) return;
          element.style.setProperty(prop, val);
        });
      }
    });

    if (originalStyle) {
      const temp = document.createElement('div');
      temp.style.cssText = originalStyle;
      for (let i = 0; i < temp.style.length; i++) {
        const prop = temp.style[i];
        const val = temp.style.getPropertyValue(prop);
        element.style.setProperty(prop, val);
      }
    }

    element.querySelectorAll('*').forEach((child) => {
      applyStylesFromRules(child);
    });
  };

  applyStylesFromRules(contentDiv);

  return contentDiv;
};

export { createTableFromHtml, createRichTextFromHtml };
