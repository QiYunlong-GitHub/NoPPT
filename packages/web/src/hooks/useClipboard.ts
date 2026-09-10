import { useRef, type MutableRefObject } from 'react';
import type { ClipboardElement } from './useSelection';
import { getSlideAppendTarget as _getSlideAppendTarget } from '@/utils/selection';
import { sanitizeHtml } from '@/utils';
import {
  createTextElement as _createTextElement,
  createImageElement as _createImageElement,
} from '@/utils/elementFactories';
import { t } from '@/i18n';

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

interface PresentationLike {
  zoom?: number;
  width?: number;
  height?: number;
  [key: string]: any;
}

interface SlideLike {
  id: string;
  [key: string]: any;
}

interface UseClipboardParams {
  currentSlide: SlideLike | null | undefined;
  presentation: PresentationLike | null | undefined;
  selectedSlideId: string | null;
  slideContainerRef: MutableRefObject<HTMLDivElement | null>;
  selectedElementsRef: MutableRefObject<HTMLElement[]>;
  clipboardElements: ClipboardElement[];
  setClipboardElements: React.Dispatch<React.SetStateAction<ClipboardElement[]>>;
  isPasteMode: boolean;
  setIsPasteMode: React.Dispatch<React.SetStateAction<boolean>>;
  clipboardSourceSlideId: string | null;
  setClipboardSourceSlideId: React.Dispatch<React.SetStateAction<string | null>>;
  tabIdRef: MutableRefObject<string>;
  setContextMenu: React.Dispatch<React.SetStateAction<any>>;
  setShowPropertyPanel: (show: boolean) => void;
  setRightPanelTab: (tab: 'property' | 'ai') => void;
  setIsFormatBrushMode: React.Dispatch<React.SetStateAction<boolean>>;
  setFormatBrushData: React.Dispatch<React.SetStateAction<Record<string, string> | null>>;
  showToast: (message: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
  saveSlideHtmlRef: MutableRefObject<(addToHistory?: boolean, slideId?: string) => void>;
  updateSelectedElements: (elements: HTMLElement[]) => HTMLElement[];
  highlightElement: (el: HTMLElement, highlight: boolean) => void;
  saveAndRestoreSelectionForNewElements: (
    newElements: HTMLElement[],
    options?: { markUnsaved?: boolean; clearClipboard?: boolean },
  ) => void;
}

export function useClipboard({
  currentSlide,
  presentation,
  selectedSlideId,
  slideContainerRef,
  selectedElementsRef,
  clipboardElements,
  setClipboardElements,
  isPasteMode,
  setIsPasteMode,
  clipboardSourceSlideId,
  setClipboardSourceSlideId,
  tabIdRef,
  setContextMenu,
  setShowPropertyPanel,
  setRightPanelTab,
  setIsFormatBrushMode,
  setFormatBrushData,
  showToast,
  saveSlideHtmlRef,
  updateSelectedElements,
  highlightElement,
  saveAndRestoreSelectionForNewElements,
}: UseClipboardParams) {
  const getSlideAppendTarget = (innerDiv: HTMLElement): HTMLElement =>
    _getSlideAppendTarget(innerDiv);

  const createTextElement = (text: string, x: number, y: number): HTMLElement =>
    _createTextElement(text, x, y);
  const createImageElement = (
    src: string,
    x: number,
    y: number,
    width?: number,
    height?: number,
  ): HTMLElement => _createImageElement(src, x, y, width, height);

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

  const checkClipboard = async (): Promise<{
    hasSlideClipboard: boolean;
    hasElementClipboard: boolean;
    hasTextClipboard: boolean;
    hasHtmlClipboard: boolean;
    hasImageClipboard: boolean;
  }> => {
    const result = {
      hasSlideClipboard: false,
      hasElementClipboard: false,
      hasTextClipboard: false,
      hasHtmlClipboard: false,
      hasImageClipboard: false,
    };

    try {
      const text = await navigator.clipboard.readText();
      if (text.startsWith('__noppt_slides__:')) {
        result.hasSlideClipboard = true;
      } else if (text.startsWith('__noppt_elements__:')) {
        result.hasElementClipboard = true;
      } else if (text && text.trim().length > 0) {
        result.hasTextClipboard = true;
      }
    } catch {
      // ignore
    }

    try {
      const clipboardItems = await navigator.clipboard.read();
      for (const item of clipboardItems) {
        if (
          item.types.includes('application/x-noppt-slides') ||
          item.types.includes('application/x-noppt-slide')
        ) {
          result.hasSlideClipboard = true;
        }
        if (item.types.includes('application/x-noppt-elements')) {
          result.hasElementClipboard = true;
        }
        if (item.types.includes('text/html')) {
          result.hasHtmlClipboard = true;
        }
        if (item.types.some((t) => t.startsWith('image/'))) {
          result.hasImageClipboard = true;
        }
      }
    } catch {
      // ignore
    }

    return result;
  };

  const handlePasteSlideAsImage = async (clientX?: number, clientY?: number) => {
    if (!currentSlide || !presentation) return;

    let slidesData: any[] = [];

    try {
      const text = await navigator.clipboard.readText();
      if (text.startsWith('__noppt_slides__:')) {
        const jsonStr = text.substring('__noppt_slides__:'.length);
        slidesData = JSON.parse(jsonStr);
      }
    } catch {
      // ignore
    }

    if (slidesData.length === 0) {
      try {
        const clipboardItems = await navigator.clipboard.read();
        for (const item of clipboardItems) {
          if (item.types.includes('application/x-noppt-slides')) {
            const blob = await item.getType('application/x-noppt-slides');
            const text = await blob.text();
            slidesData = JSON.parse(text);
            break;
          }
          if (item.types.includes('application/x-noppt-slide')) {
            const blob = await item.getType('application/x-noppt-slide');
            const text = await blob.text();
            slidesData = [JSON.parse(text)];
            break;
          }
        }
      } catch {
        // ignore
      }
    }

    if (slidesData.length === 0) {
      showToast(t('剪贴板中没有幻灯片数据'), 'error');
      return;
    }

    const container = slideContainerRef.current;
    const innerDiv = container?.querySelector('[data-slide-content="true"]') as HTMLElement | null;
    if (!container || !innerDiv) return;

    const rect = innerDiv.getBoundingClientRect();
    const zoom = presentation.zoom ?? 1;

    let targetX: number;
    let targetY: number;

    if (clientX !== undefined && clientY !== undefined) {
      targetX = (clientX - rect.left) / zoom;
      targetY = (clientY - rect.top) / zoom;
    } else {
      targetX = 100;
      targetY = 100;
    }

    const slideWidth = presentation.width || 1280;
    const slideHeight = presentation.height || 720;
    const scale = 0.5;
    const imgWidth = slideWidth * scale;
    const imgHeight = slideHeight * scale;

    const pastedElements: HTMLElement[] = [];
    let offsetX = 0;
    let offsetY = 0;

    for (const slideData of slidesData) {
      try {
        const slideHtml = slideData.html || slideData.content || '';

        const containerEl = document.createElement('div');
        containerEl.className = 'noppt-group-element';
        containerEl.style.position = 'absolute';
        containerEl.style.left = `${targetX - imgWidth / 2 + offsetX}px`;
        containerEl.style.top = `${targetY - imgHeight / 2 + offsetY}px`;
        containerEl.style.width = `${imgWidth}px`;
        containerEl.style.height = `${imgHeight}px`;
        containerEl.style.overflow = 'hidden';
        containerEl.style.border = '1px solid #e2e8f0';
        containerEl.style.borderRadius = '4px';
        containerEl.style.background = '#ffffff';
        containerEl.style.userSelect = 'none';
        containerEl.style.cursor = 'move';
        containerEl.style.boxSizing = 'border-box';
        containerEl.style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)';
        containerEl.setAttribute('data-element-type', 'group');
        containerEl.setAttribute('data-group-scale-x', String(scale));
        containerEl.setAttribute('data-group-scale-y', String(scale));
        containerEl.setAttribute('data-slide-title', slideData.title || t('未命名幻灯片'));

        const contentWrapper = document.createElement('div');
        contentWrapper.className = 'noppt-group-content';
        contentWrapper.style.width = `${slideWidth}px`;
        contentWrapper.style.height = `${slideHeight}px`;
        contentWrapper.style.transform = `scale(${scale})`;
        contentWrapper.style.transformOrigin = 'top left';
        contentWrapper.style.position = 'relative';
        contentWrapper.style.pointerEvents = 'none';
        contentWrapper.innerHTML = slideHtml;

        containerEl.appendChild(contentWrapper);
        getSlideAppendTarget(innerDiv).appendChild(containerEl);
        pastedElements.push(containerEl);

        offsetX += 30;
        offsetY += 30;
      } catch (e) {
        console.warn('Failed to paste slide as image:', e);
      }
    }

    if (pastedElements.length > 0) {
      saveSlideHtmlRef.current(true);

      const finalPasted = updateSelectedElements(pastedElements);
      finalPasted.forEach((el) => highlightElement(el, true));
      if (finalPasted.length > 0) {
        setShowPropertyPanel(true);
        setRightPanelTab('property');
      }
      showToast(t('已粘贴 {n} 张幻灯片为绑定对象', { n: finalPasted.length }), 'success');
      clearClipboard();
    } else {
      showToast(t('粘贴失败'), 'error');
    }
  };

  const handlePasteAsImage = async (clientX?: number, clientY?: number) => {
    if (!currentSlide || !presentation) return;

    setContextMenu(null);

    let elementsData: any[] = [];

    if (clipboardElements.length > 0) {
      elementsData = clipboardElements;
    } else {
      const elements = await readElementsFromClipboard();
      if (elements && elements.length > 0) {
        elementsData = elements;
      }
    }

    if (elementsData.length === 0) {
      showToast(t('剪贴板中没有元素数据'), 'error');
      return;
    }

    const container = slideContainerRef.current;
    const innerDiv = container?.querySelector('[data-slide-content="true"]') as HTMLElement | null;
    if (!container || !innerDiv) return;

    const rect = innerDiv.getBoundingClientRect();
    const zoom = presentation.zoom ?? 1;

    let targetX: number;
    let targetY: number;

    if (clientX !== undefined && clientY !== undefined) {
      targetX = (clientX - rect.left) / zoom;
      targetY = (clientY - rect.top) / zoom;
    } else {
      targetX = rect.width / 2 / zoom;
      targetY = rect.height / 3 / zoom;
    }

    let minLeft = Infinity,
      minTop = Infinity,
      maxRight = -Infinity,
      maxBottom = -Infinity;
    elementsData.forEach((item: any) => {
      minLeft = Math.min(minLeft, item.left);
      minTop = Math.min(minTop, item.top);
      maxRight = Math.max(maxRight, item.left + item.width);
      maxBottom = Math.max(maxBottom, item.top + item.height);
    });

    const groupWidth = maxRight - minLeft;
    const groupHeight = maxBottom - minTop;

    const containerEl = document.createElement('div');
    containerEl.className = 'noppt-group-element';
    containerEl.style.position = 'absolute';
    containerEl.style.left = `${targetX - groupWidth / 2}px`;
    containerEl.style.top = `${targetY - groupHeight / 2}px`;
    containerEl.style.width = `${groupWidth}px`;
    containerEl.style.height = `${groupHeight}px`;
    containerEl.style.overflow = 'visible';
    containerEl.style.userSelect = 'none';
    containerEl.style.cursor = 'move';
    containerEl.style.boxSizing = 'border-box';
    containerEl.setAttribute('data-element-type', 'group');
    containerEl.setAttribute('data-group-scale-x', '1');
    containerEl.setAttribute('data-group-scale-y', '1');

    const contentWrapper = document.createElement('div');
    contentWrapper.className = 'noppt-group-content';
    contentWrapper.style.width = `${groupWidth}px`;
    contentWrapper.style.height = `${groupHeight}px`;
    contentWrapper.style.position = 'relative';
    contentWrapper.style.pointerEvents = 'none';
    contentWrapper.style.transformOrigin = 'top left';

    elementsData.forEach((item: any) => {
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = item.html;
      const el = tempDiv.firstElementChild as HTMLElement;
      if (!el) return;

      el.style.boxShadow = '';
      el.style.transform = 'none';
      el.classList.remove('noppt-selected');
      el.style.position = 'absolute';
      el.style.left = `${item.left - minLeft}px`;
      el.style.top = `${item.top - minTop}px`;

      contentWrapper.appendChild(el);
    });

    containerEl.appendChild(contentWrapper);
    getSlideAppendTarget(innerDiv).appendChild(containerEl);

    saveSlideHtmlRef.current(true);
    const finalContainer = updateSelectedElements([containerEl]);
    finalContainer.forEach((el) => highlightElement(el, true));
    if (finalContainer.length > 0) {
      setShowPropertyPanel(true);
      setRightPanelTab('property');
    }
    showToast(t('已粘贴为绑定对象'), 'success');
    clearClipboard();
  };

  const handlePasteText = async (clientX?: number, clientY?: number) => {
    if (!currentSlide || !presentation) return;

    setContextMenu(null);

    let text = '';
    try {
      text = await navigator.clipboard.readText();
    } catch {
      showToast(t('读取剪贴板失败'), 'error');
      return;
    }

    if (!text || !text.trim()) {
      showToast(t('剪贴板中没有文本'), 'error');
      return;
    }

    const container = slideContainerRef.current;
    const innerDiv = container?.querySelector('[data-slide-content="true"]') as HTMLElement | null;
    if (!container || !innerDiv) return;

    const rect = innerDiv.getBoundingClientRect();
    const zoom = presentation.zoom ?? 1;

    let posX: number;
    let posY: number;

    if (clientX !== undefined && clientY !== undefined) {
      posX = (clientX - rect.left) / zoom;
      posY = (clientY - rect.top) / zoom;
    } else {
      posX = 100;
      posY = 100;
    }

    const textEl = createTextElement(text, posX, posY);
    getSlideAppendTarget(innerDiv).appendChild(textEl);

    saveSlideHtmlRef.current(true);
    const finalSelected = updateSelectedElements([textEl]);
    finalSelected.forEach((el) => highlightElement(el, true));
    if (finalSelected.length > 0) {
      setShowPropertyPanel(true);
      setRightPanelTab('property');
    }
    showToast(t('已粘贴文本'), 'success');
    clearClipboard();
  };

  const handlePasteHtml = async (clientX?: number, clientY?: number) => {
    if (!currentSlide || !presentation) return;

    setContextMenu(null);

    let htmlContent = '';
    let plainText = '';

    try {
      const clipboardItems = await navigator.clipboard.read();
      for (const item of clipboardItems) {
        if (item.types.includes('text/html')) {
          const blob = await item.getType('text/html');
          htmlContent = await blob.text();
        }
        if (item.types.includes('text/plain')) {
          const blob = await item.getType('text/plain');
          plainText = await blob.text();
        }
      }
    } catch {
      // ignore
    }

    if (!htmlContent && !plainText) {
      showToast(t('剪贴板中没有内容'), 'error');
      return;
    }

    const container = slideContainerRef.current;
    const innerDiv = container?.querySelector('[data-slide-content="true"]') as HTMLElement | null;
    if (!container || !innerDiv) return;

    const rect = innerDiv.getBoundingClientRect();
    const zoom = presentation.zoom ?? 1;

    let posX: number;
    let posY: number;

    if (clientX !== undefined && clientY !== undefined) {
      posX = (clientX - rect.left) / zoom;
      posY = (clientY - rect.top) / zoom;
    } else {
      posX = 100;
      posY = 100;
    }

    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = sanitizeHtml(htmlContent || '');

    const tables = tempDiv.querySelectorAll('table');

    const pastedElements: HTMLElement[] = [];

    if (tables.length > 0) {
      tables.forEach((_, idx) => {
        const pastedTable = createTableFromHtml(htmlContent, posX + idx * 20, posY + idx * 20);
        pastedTable.classList.add('noppt-table-element');
        getSlideAppendTarget(innerDiv).appendChild(pastedTable);
        pastedElements.push(pastedTable);
      });
    } else if (htmlContent) {
      const htmlContainer = document.createElement('div');
      htmlContainer.className = 'noppt-text-element';
      htmlContainer.style.position = 'absolute';
      htmlContainer.style.left = `${posX}px`;
      htmlContainer.style.top = `${posY}px`;
      htmlContainer.style.padding = '4px 8px';
      htmlContainer.style.fontSize = '16px';
      htmlContainer.style.color = '#334155';
      htmlContainer.style.lineHeight = '1.5';
      htmlContainer.style.whiteSpace = 'pre-wrap';
      htmlContainer.style.wordBreak = 'break-word';
      htmlContainer.style.minWidth = '100px';
      htmlContainer.style.minHeight = '24px';
      htmlContainer.style.userSelect = 'none';
      htmlContainer.style.cursor = 'move';
      htmlContainer.innerHTML = sanitizeHtml(htmlContent);

      getSlideAppendTarget(innerDiv).appendChild(htmlContainer);
      pastedElements.push(htmlContainer);
    } else if (plainText) {
      const textEl = createTextElement(plainText, posX, posY);
      getSlideAppendTarget(innerDiv).appendChild(textEl);
      pastedElements.push(textEl);
    }

    if (pastedElements.length > 0) {
      saveSlideHtmlRef.current(true);
      const finalPasted = updateSelectedElements(pastedElements);
      finalPasted.forEach((el) => highlightElement(el, true));
      if (finalPasted.length > 0) {
        setShowPropertyPanel(true);
        setRightPanelTab('property');
      }
      showToast(t('已粘贴 {n} 个元素', { n: finalPasted.length }), 'success');
      clearClipboard();
    } else {
      showToast(t('粘贴失败'), 'error');
    }
  };

  const handlePasteImage = async (clientX?: number, clientY?: number) => {
    if (!currentSlide || !presentation) return;

    setContextMenu(null);

    let imageBlob: Blob | null = null;

    try {
      const clipboardItems = await navigator.clipboard.read();
      for (const item of clipboardItems) {
        for (const type of item.types) {
          if (type.startsWith('image/')) {
            imageBlob = await item.getType(type);
            break;
          }
        }
        if (imageBlob) break;
      }
    } catch {
      showToast(t('读取剪贴板失败'), 'error');
      return;
    }

    if (!imageBlob) {
      showToast(t('剪贴板中没有图片'), 'error');
      return;
    }

    const container = slideContainerRef.current;
    const innerDiv = container?.querySelector('[data-slide-content="true"]') as HTMLElement | null;
    if (!container || !innerDiv) return;

    const rect = innerDiv.getBoundingClientRect();
    const zoom = presentation.zoom ?? 1;

    let posX: number;
    let posY: number;

    if (clientX !== undefined && clientY !== undefined) {
      posX = (clientX - rect.left) / zoom;
      posY = (clientY - rect.top) / zoom;
    } else {
      posX = 100;
      posY = 100;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;

      const img = new Image();
      img.onload = () => {
        const maxWidth = 400;
        const maxHeight = 300;
        let width = img.naturalWidth;
        let height = img.naturalHeight;

        if (width > maxWidth) {
          height = (maxWidth / width) * height;
          width = maxWidth;
        }
        if (height > maxHeight) {
          width = (maxHeight / height) * width;
          height = maxHeight;
        }

        const imgEl = document.createElement('img');
        imgEl.src = dataUrl;
        imgEl.className = 'noppt-image-element';
        imgEl.style.position = 'absolute';
        imgEl.style.left = `${posX - width / 2}px`;
        imgEl.style.top = `${posY - height / 2}px`;
        imgEl.style.width = `${width}px`;
        imgEl.style.height = `${height}px`;
        imgEl.style.userSelect = 'none';
        imgEl.style.cursor = 'move';
        imgEl.draggable = false;

        getSlideAppendTarget(innerDiv).appendChild(imgEl);

        saveSlideHtmlRef.current(true);
        const finalSelected = updateSelectedElements([imgEl]);
        finalSelected.forEach((el) => highlightElement(el, true));
        if (finalSelected.length > 0) {
          setShowPropertyPanel(true);
          setRightPanelTab('property');
        }
        showToast(t('已粘贴图片'), 'success');
        clearClipboard();
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(imageBlob);
  };

  const readElementsFromClipboard = async (): Promise<any[] | null> => {
    try {
      const text = await navigator.clipboard.readText();
      if (text.startsWith('__noppt_elements__:')) {
        const jsonStr = text.substring('__noppt_elements__:'.length);
        return JSON.parse(jsonStr);
      }
    } catch {
      // ignore
    }

    try {
      const clipboardItems = await navigator.clipboard.read();
      for (const item of clipboardItems) {
        if (item.types.includes('application/x-noppt-elements')) {
          const blob = await item.getType('application/x-noppt-elements');
          const text = await blob.text();
          return JSON.parse(text);
        }
      }
    } catch {
      // ignore
    }

    return null;
  };

  const clearClipboard = async () => {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/plain': new Blob([''], { type: 'text/plain' }),
          'text/html': new Blob([''], { type: 'text/html' }),
          'image/png': new Blob([], { type: 'image/png' }),
          'application/x-noppt-slide': new Blob([''], { type: 'application/x-noppt-slide' }),
          'application/x-noppt-slides': new Blob([''], { type: 'application/x-noppt-slides' }),
        }),
      ]);
    } catch {
      try {
        await navigator.clipboard.writeText('');
      } catch {
        // ignore
      }
    }
    setClipboardElements([]);
    setClipboardSourceSlideId(null);
    setIsPasteMode(false);

    try {
      localStorage.setItem('noppt_clipboard_cleared', `${Date.now()}_${tabIdRef.current}`);
    } catch {
      // ignore
    }
  };
  const clearClipboardRef = useRef(clearClipboard);
  clearClipboardRef.current = clearClipboard;

  const stripPastedIds = (root: HTMLElement) => {
    root.removeAttribute('data-noppt-id');
    root.querySelectorAll<HTMLElement>('[data-noppt-id]').forEach((el) => {
      el.removeAttribute('data-noppt-id');
    });
  };

  const pasteElementsFromData = (
    elements: any[],
    targetX: number,
    targetY: number,
    extraOffset: number = 0,
  ): HTMLElement[] => {
    const container = slideContainerRef.current;
    const innerDiv = container?.querySelector('[data-slide-content="true"]') as HTMLElement | null;
    if (!container || !innerDiv || !elements || elements.length === 0) return [];

    let minLeft = Infinity,
      minTop = Infinity,
      maxRight = -Infinity,
      maxBottom = -Infinity;
    elements.forEach((item: any) => {
      minLeft = Math.min(minLeft, item.left);
      minTop = Math.min(minTop, item.top);
      maxRight = Math.max(maxRight, item.left + item.width);
      maxBottom = Math.max(maxBottom, item.top + item.height);
    });

    const groupCenterX = (minLeft + maxRight) / 2;
    const groupCenterY = (minTop + maxBottom) / 2;
    const deltaX = targetX - groupCenterX + extraOffset;
    const deltaY = targetY - groupCenterY + extraOffset;

    const pasted: HTMLElement[] = [];
    elements.forEach((item: any) => {
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = item.html;
      const el = tempDiv.firstElementChild as HTMLElement;
      if (!el) return;

      el.style.boxShadow = '';
      el.style.transform = 'none';
      el.classList.remove('noppt-selected');
      el.style.position = 'absolute';
      el.style.left = `${Math.max(0, item.left + deltaX)}px`;
      el.style.top = `${Math.max(0, item.top + deltaY)}px`;

      stripPastedIds(el);

      const appendTarget = getSlideAppendTarget(innerDiv);
      appendTarget.appendChild(el);
      pasted.push(el);
    });

    return pasted;
  };

  const handleCopyElements = async () => {
    if (selectedElementsRef.current.length === 0) return;

    const container = slideContainerRef.current;
    const innerDiv = container?.querySelector('[data-slide-content="true"]');
    if (!container || !innerDiv) return;

    const rect = innerDiv.getBoundingClientRect();
    const zoom = presentation?.zoom ?? 1;

    const copied = selectedElementsRef.current.map((el) => {
      const wasSelected = el.classList.contains('noppt-selected');
      const originalBoxShadow = el.style.boxShadow;

      if (wasSelected) {
        el.classList.remove('noppt-selected');
        el.style.boxShadow = '';
      }

      const elRect = el.getBoundingClientRect();
      const html = el.outerHTML;

      if (wasSelected) {
        el.classList.add('noppt-selected');
        el.style.boxShadow = originalBoxShadow;
      }

      return {
        html: html,
        width: elRect.width / zoom,
        height: elRect.height / zoom,
        left: (elRect.left - rect.left) / zoom,
        top: (elRect.top - rect.top) / zoom,
      };
    });

    setClipboardElements(copied);
    setClipboardSourceSlideId(selectedSlideId || null);
    setIsPasteMode(true);

    try {
      localStorage.setItem('noppt_clipboard_timestamp', `${Date.now()}_${tabIdRef.current}`);
    } catch {
      // ignore
    }

    if (navigator.clipboard) {
      try {
        const elementsJson = JSON.stringify(copied);
        const textTypeBlob = new Blob([`__noppt_elements__:${elementsJson}`], {
          type: 'text/plain',
        });

        const clipboardItems: Record<string, Blob> = {
          'text/plain': textTypeBlob,
        };

        if (selectedElementsRef.current.length === 1) {
          const el = selectedElementsRef.current[0];
          const tagName = el.tagName.toLowerCase();

          if (tagName === 'img') {
            const imgEl = el as HTMLImageElement;
            try {
              const canvas = document.createElement('canvas');
              const width = imgEl.naturalWidth || imgEl.width;
              const height = imgEl.naturalHeight || imgEl.height;
              canvas.width = width;
              canvas.height = height;
              const ctx = canvas.getContext('2d');
              if (ctx) {
                ctx.drawImage(imgEl, 0, 0, width, height);
                const dataUrl = canvas.toDataURL('image/png');
                const byteString = atob(dataUrl.split(',')[1]);
                const ab = new ArrayBuffer(byteString.length);
                const ia = new Uint8Array(ab);
                for (let i = 0; i < byteString.length; i++) {
                  ia[i] = byteString.charCodeAt(i);
                }
                const imgBlob = new Blob([ab], { type: 'image/png' });
                clipboardItems['image/png'] = imgBlob;
              }
            } catch {
              // ignore
            }
          } else {
            const htmlText = el.outerHTML;
            clipboardItems['text/html'] = new Blob([htmlText], { type: 'text/html' });
          }
        } else {
          const combinedHtml = selectedElementsRef.current.map((el) => el.outerHTML).join('');
          clipboardItems['text/html'] = new Blob([combinedHtml], { type: 'text/html' });
        }

        await navigator.clipboard.write([new ClipboardItem(clipboardItems)]);
      } catch (err) {
        console.warn('Failed to copy to system clipboard:', err);
        try {
          const elementsJson = JSON.stringify(copied);
          await navigator.clipboard.writeText(`__noppt_elements__:${elementsJson}`);
        } catch {
          // ignore
        }
      }
    }
  };

  const handleCopySlideAsImage = async () => {
    if (!currentSlide || !presentation) return;

    const container = slideContainerRef.current;
    const innerDiv = container?.querySelector('[data-slide-content="true"]') as HTMLElement | null;
    if (!container || !innerDiv) return;

    try {
      const slideWidth = presentation.width || 1280;
      const slideHeight = presentation.height || 720;
      const scale = 2;

      const canvas = document.createElement('canvas');
      canvas.width = slideWidth * scale;
      canvas.height = slideHeight * scale;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.scale(scale, scale);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, slideWidth, slideHeight);

      const tempSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${slideWidth}" height="${slideHeight}">
        <foreignObject width="100%" height="100%">
          <div xmlns="http://www.w3.org/1999/xhtml" style="width:${slideWidth}px;height:${slideHeight}px;background:white;">
            ${innerDiv.innerHTML}
          </div>
        </foreignObject>
      </svg>`;

      const img = new Image();
      const svgBlob = new Blob([tempSvg], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(svgBlob);

      img.onload = () => {
        ctx.drawImage(img, 0, 0);
        URL.revokeObjectURL(url);

        canvas.toBlob(async (blob) => {
          if (blob && navigator.clipboard) {
            try {
              await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
              showToast(t('幻灯片已复制为图片'), 'success');
            } catch (err) {
              console.warn('Failed to copy slide image:', err);
              showToast(t('复制失败，请重试'), 'error');
            }
          }
        }, 'image/png');
      };

      img.onerror = () => {
        URL.revokeObjectURL(url);
        showToast(t('复制失败，请重试'), 'error');
      };

      img.src = url;
    } catch (e) {
      console.warn('Failed to copy slide as image:', e);
      showToast(t('复制失败，请重试'), 'error');
    }
  };

  const handlePasteAtPosition = (clientX: number, clientY: number) => {
    if (clipboardElements.length === 0 || !currentSlide) return;

    const container = slideContainerRef.current;
    const innerDiv = container?.querySelector('[data-slide-content="true"]') as HTMLElement | null;
    if (!container || !innerDiv) return;

    const rect = innerDiv.getBoundingClientRect();
    const zoom = presentation?.zoom ?? 1;
    const targetX = (clientX - rect.left) / zoom;
    const targetY = (clientY - rect.top) / zoom;

    let minLeft = Infinity;
    let minTop = Infinity;
    let maxRight = -Infinity;
    let maxBottom = -Infinity;

    clipboardElements.forEach((item) => {
      minLeft = Math.min(minLeft, item.left);
      minTop = Math.min(minTop, item.top);
      maxRight = Math.max(maxRight, item.left + item.width);
      maxBottom = Math.max(maxBottom, item.top + item.height);
    });

    const groupCenterX = (minLeft + maxRight) / 2;
    const groupCenterY = (minTop + maxBottom) / 2;

    const deltaX = targetX - groupCenterX;
    const deltaY = targetY - groupCenterY;

    const pastedElements: HTMLElement[] = [];

    clipboardElements.forEach((item) => {
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = item.html;
      const el = tempDiv.firstElementChild as HTMLElement;
      if (!el) return;

      el.style.boxShadow = '';
      el.style.transform = 'none';
      el.classList.remove('noppt-selected');

      const posX = item.left + deltaX;
      const posY = item.top + deltaY;

      el.style.position = 'absolute';
      el.style.left = `${Math.max(0, posX)}px`;
      el.style.top = `${Math.max(0, posY)}px`;

      stripPastedIds(el);

      getSlideAppendTarget(innerDiv).appendChild(el);
      pastedElements.push(el);
    });

    saveAndRestoreSelectionForNewElements(pastedElements, {
      markUnsaved: false,
      clearClipboard: true,
    });
  };
  const handlePasteAtPositionRef = useRef(handlePasteAtPosition);
  handlePasteAtPositionRef.current = handlePasteAtPosition;

  const handlePasteWithOffset = () => {
    if (clipboardElements.length === 0 || !currentSlide) return;

    const container = slideContainerRef.current;
    const innerDiv = container?.querySelector('[data-slide-content="true"]') as HTMLElement | null;
    if (!container || !innerDiv) return;

    const isSameSlide = clipboardSourceSlideId && clipboardSourceSlideId === selectedSlideId;
    const pastedElements: HTMLElement[] = [];
    const offsetX = isSameSlide ? 20 : 0;
    const offsetY = isSameSlide ? 20 : 0;

    clipboardElements.forEach((item) => {
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = item.html;
      const el = tempDiv.firstElementChild as HTMLElement;
      if (!el) return;

      el.style.boxShadow = '';
      el.style.transform = 'none';
      el.classList.remove('noppt-selected');

      const posX = item.left + offsetX;
      const posY = item.top + offsetY;

      el.style.position = 'absolute';
      el.style.left = `${Math.max(0, posX)}px`;
      el.style.top = `${Math.max(0, posY)}px`;

      stripPastedIds(el);

      getSlideAppendTarget(innerDiv).appendChild(el);
      pastedElements.push(el);
    });

    saveAndRestoreSelectionForNewElements(pastedElements, {
      markUnsaved: false,
      clearClipboard: true,
    });
  };

  const handlePasteFromClipboard = async () => {
    if (!currentSlide) return;

    const container = slideContainerRef.current;
    const innerDiv = container?.querySelector('[data-slide-content="true"]') as HTMLElement | null;
    if (!container || !innerDiv) return;

    if (clipboardElements.length > 0 && isPasteMode) {
      handlePasteWithOffset();
      return;
    }

    if (!navigator.clipboard) {
      if (clipboardElements.length > 0) {
        handlePasteWithOffset();
      }
      return;
    }

    try {
      const items = await navigator.clipboard.read();
      const rect = innerDiv.getBoundingClientRect();
      const zoom = presentation?.zoom ?? 1;
      const centerX = rect.width / 2 / zoom;
      const centerY = rect.height / 3 / zoom;
      const pastedElements: HTMLElement[] = [];

      for (const item of items) {
        const hasCustomElements = item.types.includes('application/x-noppt-elements');
        const hasHtml = item.types.includes('text/html');
        const hasPlainText = item.types.includes('text/plain');
        const hasImage = item.types.some((t) => t.startsWith('image/'));

        if (hasCustomElements) {
          const blob = await item.getType('application/x-noppt-elements');
          const text = await blob.text();
          const elements = JSON.parse(text);
          const pasted = pasteElementsFromData(elements, centerX, centerY, 0);
          pastedElements.push(...pasted);
          break;
        }

        if (hasPlainText) {
          const blob = await item.getType('text/plain');
          const text = await blob.text();
          if (text.startsWith('__noppt_elements__:')) {
            const jsonStr = text.substring('__noppt_elements__:'.length);
            const elements = JSON.parse(jsonStr);
            const pasted = pasteElementsFromData(elements, centerX, centerY, 0);
            pastedElements.push(...pasted);
            break;
          }
        }

        if (hasHtml) {
          const blob = await item.getType('text/html');
          const html = await blob.text();

          const tempDiv = document.createElement('div');
          tempDiv.innerHTML = sanitizeHtml(html);
          const tables = tempDiv.querySelectorAll('table');

          if (tables.length > 0) {
            const tableContainer = document.createElement('div');
            tableContainer.className = 'noppt-table-element';
            tableContainer.style.position = 'absolute';
            tableContainer.style.left = `${centerX - 200}px`;
            tableContainer.style.top = `${centerY - 50}px`;
            tableContainer.style.userSelect = 'none';
            tableContainer.style.cursor = 'move';
            tableContainer.style.maxWidth = '800px';

            const shadowRoot = tableContainer.attachShadow({ mode: 'open' });
            shadowRoot.innerHTML = sanitizeHtml(html);

            const tableInShadow = shadowRoot.querySelector('table');
            if (tableInShadow) {
              if (!(tableInShadow as HTMLElement).style.borderCollapse) {
                (tableInShadow as HTMLElement).style.borderCollapse = 'collapse';
              }
            }

            tableContainer.setAttribute('data-noppt-table', 'true');
            getSlideAppendTarget(innerDiv).appendChild(tableContainer);
            pastedElements.push(tableContainer);
          } else {
            const directChildren = Array.from(tempDiv.children) as HTMLElement[];
            const firstAbsoluteChild = directChildren.find(
              (c) =>
                c.style?.position === 'absolute' &&
                (c.style.left || c.style.top || c.style.right || c.style.bottom),
            );
            if (firstAbsoluteChild) {
              directChildren.forEach((origEl, idx) => {
                const extracted = origEl.cloneNode(true) as HTMLElement;
                extracted.classList.remove('noppt-selected');
                extracted.style.boxShadow = '';
                extracted.style.transform = 'none';
                if (!extracted.style.left && !extracted.style.top) {
                  extracted.style.left = `${centerX - 200 + idx * 20}px`;
                  extracted.style.top = `${centerY - 50 + idx * 20}px`;
                }
                extracted.style.position = 'absolute';
                stripPastedIds(extracted);
                getSlideAppendTarget(innerDiv).appendChild(extracted);
                pastedElements.push(extracted);
              });
            } else {
              const richTextEl = createRichTextFromHtml(html, centerX - 200, centerY - 50);
              if (richTextEl.innerText?.trim()) {
                getSlideAppendTarget(innerDiv).appendChild(richTextEl);
                pastedElements.push(richTextEl);
              }
            }
          }
          break;
        }

        if (hasPlainText && !hasImage) {
          const blob = await item.getType('text/plain');
          const text = await blob.text();
          if (text.trim()) {
            const textEl = createTextElement(text.trim(), centerX - 150, centerY - 20);
            getSlideAppendTarget(innerDiv).appendChild(textEl);
            pastedElements.push(textEl);
          }
          break;
        }

        if (hasImage && !hasHtml) {
          const imageType = item.types.find((t) => t.startsWith('image/'));
          if (imageType) {
            const blob = await item.getType(imageType);
            const dataUrl = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result as string);
              reader.onerror = reject;
              reader.readAsDataURL(blob);
            });
            const img = createImageElement(dataUrl, centerX - 150, centerY - 100);
            img.className = 'noppt-image-element';
            img.onload = () => {
              const naturalWidth = (img as HTMLImageElement).naturalWidth;
              const naturalHeight = (img as HTMLImageElement).naturalHeight;
              const maxW = 400;
              const maxH = 300;
              const ratio = Math.min(maxW / naturalWidth, maxH / naturalHeight, 1);
              img.style.width = `${naturalWidth * ratio}px`;
              img.style.height = `${naturalHeight * ratio}px`;
              img.style.left = `${centerX - (naturalWidth * ratio) / 2}px`;
              img.style.top = `${centerY - (naturalHeight * ratio) / 2}px`;
              saveSlideHtmlRef.current(true);
            };
            getSlideAppendTarget(innerDiv).appendChild(img);
            pastedElements.push(img);
            break;
          }
        }
      }

      if (pastedElements.length > 0) {
        saveAndRestoreSelectionForNewElements(pastedElements, {
          markUnsaved: true,
          clearClipboard: true,
        });
      }
    } catch (err) {
      console.warn('Failed to read from system clipboard:', err);
      if (clipboardElements.length > 0) {
        handlePasteWithOffset();
      }
    }
  };
  const handlePasteFromClipboardRef = useRef(handlePasteFromClipboard);
  handlePasteFromClipboardRef.current = handlePasteFromClipboard;

  const handlePasteEvent = (e: ClipboardEvent) => {
    if (!currentSlide) {
      return;
    }

    const container = slideContainerRef.current;
    const innerDiv = container?.querySelector('[data-slide-content="true"]') as HTMLElement | null;
    if (!container || !innerDiv) {
      return;
    }

    const clipboardData = e.clipboardData;
    if (!clipboardData) {
      return;
    }

    const rect = innerDiv.getBoundingClientRect();
    const zoom = presentation?.zoom ?? 1;
    const centerX = rect.width / 2 / zoom;
    const centerY = rect.height / 3 / zoom;
    const pastedElements: HTMLElement[] = [];

    const items = clipboardData.items;
    const types = clipboardData.types;
    let handled = false;

    const finalize = () => {
      if (pastedElements.length > 0) {
        saveAndRestoreSelectionForNewElements(pastedElements, {
          markUnsaved: true,
          clearClipboard: true,
        });
      }
    };

    if (types.includes('text/plain')) {
      const plainText = clipboardData.getData('text/plain');
      if (plainText && plainText.startsWith('__noppt_elements__:')) {
        e.preventDefault();
        try {
          const jsonStr = plainText.substring('__noppt_elements__:'.length);
          const elements = JSON.parse(jsonStr);
          let minLeft = Infinity,
            minTop = Infinity,
            maxRight = -Infinity,
            maxBottom = -Infinity;
          elements.forEach((item: any) => {
            minLeft = Math.min(minLeft, item.left);
            minTop = Math.min(minTop, item.top);
            maxRight = Math.max(maxRight, item.left + item.width);
            maxBottom = Math.max(maxBottom, item.top + item.height);
          });
          const groupCenterX = (minLeft + maxRight) / 2;
          const groupCenterY = (minTop + maxBottom) / 2;
          const pasted = pasteElementsFromData(elements, groupCenterX, groupCenterY, 0);
          pastedElements.push(...pasted);
        } catch {
          // ignore
        }
        if (pastedElements.length > 0) {
          handled = true;
          finalize();
          return;
        }
      }
      if (plainText && plainText.startsWith('__noppt_slides__:')) {
        e.preventDefault();
        handlePasteSlideAsImage();
        return;
      }
    }

    if (types.includes('text/html')) {
      const html = clipboardData.getData('text/html');
      if (html) {
        e.preventDefault();
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = sanitizeHtml(html);
        const tables = tempDiv.querySelectorAll('table');

        if (tables.length > 0) {
          tables.forEach((table, idx) => {
            const tableEl = createTableFromHtml(
              html,
              centerX - 200 + idx * 20,
              centerY - 50 + idx * 20,
            );
            getSlideAppendTarget(innerDiv).appendChild(tableEl);
            pastedElements.push(tableEl);
          });
        } else {
          const nopptCandidates: HTMLElement[] = [];
          tempDiv.querySelectorAll<HTMLElement>('*').forEach((el) => {
            const s = el.style;
            if (s.position === 'absolute' && (s.left || s.top || s.right || s.bottom)) {
              nopptCandidates.push(el);
            }
          });
          const directChildren = Array.from(tempDiv.children) as HTMLElement[];
          const firstAbsoluteChild = directChildren.find(
            (c) =>
              c.style?.position === 'absolute' &&
              (c.style.left || c.style.top || c.style.right || c.style.bottom),
          );

          if (firstAbsoluteChild && nopptCandidates.length === directChildren.length) {
            directChildren.forEach((origEl, idx) => {
              const extracted = origEl.cloneNode(true) as HTMLElement;
              extracted.classList.remove('noppt-selected');
              extracted.style.boxShadow = '';
              if (!extracted.style.left && !extracted.style.top) {
                extracted.style.left = `${centerX - 200 + idx * 20}px`;
                extracted.style.top = `${centerY - 50 + idx * 20}px`;
              }
              extracted.style.position = 'absolute';
              stripPastedIds(extracted);
              getSlideAppendTarget(innerDiv).appendChild(extracted);
              pastedElements.push(extracted);
            });
          } else {
            const richTextEl = createRichTextFromHtml(html, centerX - 200, centerY - 50);
            if (richTextEl.innerText?.trim()) {
              getSlideAppendTarget(innerDiv).appendChild(richTextEl);
              pastedElements.push(richTextEl);
            }
          }
        }
        handled = true;
        finalize();
        return;
      }
    }

    if (!handled) {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            const reader = new FileReader();
            reader.onload = () => {
              const dataUrl = reader.result as string;
              const img = createImageElement(dataUrl, centerX - 150, centerY - 100);
              img.className = 'noppt-image-element';
              img.onload = () => {
                const naturalWidth = (img as HTMLImageElement).naturalWidth;
                const naturalHeight = (img as HTMLImageElement).naturalHeight;
                const maxW = 400;
                const maxH = 300;
                const ratio = Math.min(maxW / naturalWidth, maxH / naturalHeight, 1);
                img.style.width = `${naturalWidth * ratio}px`;
                img.style.height = `${naturalHeight * ratio}px`;
                img.style.left = `${centerX - (naturalWidth * ratio) / 2}px`;
                img.style.top = `${centerY - (naturalHeight * ratio) / 2}px`;
                saveSlideHtmlRef.current(true);
              };
              getSlideAppendTarget(innerDiv).appendChild(img);
              pastedElements.push(img);
              finalize();
            };
            reader.readAsDataURL(file);
            handled = true;
            break;
          }
        }
      }
      if (handled) {
        return;
      }
    }

    if (!handled && types.includes('text/plain')) {
      const text = clipboardData.getData('text/plain');
      if (text && text.trim()) {
        const textEl = createTextElement(text.trim(), centerX - 150, centerY - 20);
        getSlideAppendTarget(innerDiv).appendChild(textEl);
        pastedElements.push(textEl);
        handled = true;
      }
    }

    finalize();
  };
  const handlePasteEventRef = useRef(handlePasteEvent);
  handlePasteEventRef.current = handlePasteEvent;

  const handleCopyElementsRef = useRef(handleCopyElements);
  handleCopyElementsRef.current = handleCopyElements;

  const handlePasteSlideAsImageRef = useRef(handlePasteSlideAsImage);
  handlePasteSlideAsImageRef.current = handlePasteSlideAsImage;

  const handlePasteTextRef = useRef(handlePasteText);
  handlePasteTextRef.current = handlePasteText;

  const handlePasteHtmlRef = useRef(handlePasteHtml);
  handlePasteHtmlRef.current = handlePasteHtml;

  const handlePasteImageRef = useRef(handlePasteImage);
  handlePasteImageRef.current = handlePasteImage;

  const readElementsFromClipboardRef = useRef(readElementsFromClipboard);
  readElementsFromClipboardRef.current = readElementsFromClipboard;

  const handleCancelPaste = () => {
    setIsPasteMode(false);
    setClipboardElements([]);
    setIsFormatBrushMode(false);
    setFormatBrushData(null);
  };
  const handleCancelPasteRef = useRef(handleCancelPaste);
  handleCancelPasteRef.current = handleCancelPaste;

  return {
    clipboardElements,
    setClipboardElements,
    isPasteMode,
    setIsPasteMode,
    clipboardSourceSlideId,
    setClipboardSourceSlideId,
    tabIdRef,
    checkClipboard,
    clearClipboard,
    clearClipboardRef,
    readElementsFromClipboard,
    readElementsFromClipboardRef,
    stripPastedIds,
    pasteElementsFromData,
    handleCopyElements,
    handleCopyElementsRef,
    handleCopySlideAsImage,
    handlePasteAtPosition,
    handlePasteAtPositionRef,
    handlePasteWithOffset,
    handlePasteFromClipboard,
    handlePasteFromClipboardRef,
    handlePasteEvent,
    handlePasteEventRef,
    handleCancelPaste,
    handleCancelPasteRef,
    handlePasteSlideAsImage,
    handlePasteSlideAsImageRef,
    handlePasteAsImage,
    handlePasteText,
    handlePasteTextRef,
    handlePasteHtml,
    handlePasteHtmlRef,
    handlePasteImage,
    handlePasteImageRef,
  };
}
