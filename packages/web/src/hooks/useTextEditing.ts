import { useState, useRef, type MutableRefObject } from 'react';
import { getSlideAppendTarget as _getSlideAppendTarget } from '@/utils/selection';
import { getLinePrefixInfo as _getLinePrefixInfo } from '@/utils/listFormatting';
import { toggleListInRange as _toggleListInRange } from '@/utils/listDom';

interface SelectionStyles {
  fontSize: string;
  fontWeight: string;
  fontStyle: string;
  textDecoration: string;
  color: string;
  backgroundColor: string;
  fontFamily: string;
  textAlign: string;
  lineHeight: string;
}

interface UseTextEditingParams {
  slideContainerRef: MutableRefObject<HTMLDivElement | null>;
  presentation: { zoom?: number } | null | undefined;
  setRightPanelTab: (tab: 'property' | 'ai') => void;
  setShowPropertyPanel: (show: boolean) => void;
  markUnsaved: () => void;
  saveSlideHtmlRef: MutableRefObject<(addToHistory?: boolean, slideId?: string) => void>;
  highlightElementRef: MutableRefObject<(el: HTMLElement, highlight: boolean) => void>;
  updateSelectedElementsRef: MutableRefObject<(elements: HTMLElement[]) => HTMLElement[]>;
}

export function useTextEditing({
  slideContainerRef,
  presentation,
  setRightPanelTab,
  setShowPropertyPanel,
  markUnsaved,
  saveSlideHtmlRef,
  highlightElementRef,
  updateSelectedElementsRef,
}: UseTextEditingParams) {
  const [isTextEditing, setIsTextEditing] = useState(false);
  const editingElementRef = useRef<HTMLElement | null>(null);
  const savedSelectionRangeRef = useRef<Range | null>(null);
  const [selectionStyles, setSelectionStyles] = useState<SelectionStyles | null>(null);
  const [selectionListType, setSelectionListType] = useState<'ul' | 'ol' | null>(null);
  const [selectionListStyleType, setSelectionListStyleType] = useState<string>('');
  const fakeSelectionOverlayRef = useRef<HTMLDivElement | null>(null);

  const getSlideAppendTarget = (innerDiv: HTMLElement): HTMLElement => _getSlideAppendTarget(innerDiv);
  const getLinePrefixInfo = (line: string): { type: 'ul' | 'ol' | null; style: string; content: string } => _getLinePrefixInfo(line);

  const hideFakeSelection = () => {
    if (fakeSelectionOverlayRef.current && fakeSelectionOverlayRef.current.parentNode) {
      fakeSelectionOverlayRef.current.parentNode.removeChild(fakeSelectionOverlayRef.current);
    }
    fakeSelectionOverlayRef.current = null;
  };

  const updateStylesFromRange = (range: Range) => {
    let textNode: Text | null = null;
    const walker = document.createTreeWalker(
      range.commonAncestorContainer,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          if (range.intersectsNode(node)) {
            return NodeFilter.FILTER_ACCEPT;
          }
          return NodeFilter.FILTER_REJECT;
        },
      }
    );

    textNode = walker.nextNode() as Text | null;

    let element: HTMLElement | null = null;

    if (textNode) {
      element = textNode.parentElement;
    } else {
      const container = range.commonAncestorContainer;
      if (container.nodeType === Node.ELEMENT_NODE) {
        element = container as HTMLElement;
      } else {
        element = container.parentElement;
      }
    }

    if (element) {
      const computedStyle = window.getComputedStyle(element);

      const isBold = document.queryCommandState('bold');
      const isItalic = document.queryCommandState('italic');
      const isUnderline = document.queryCommandState('underline');
      const isStrikeThrough = document.queryCommandState('strikeThrough');

      const textDecorations: string[] = [];
      if (isUnderline) textDecorations.push('underline');
      if (isStrikeThrough) textDecorations.push('line-through');

      setSelectionStyles({
        fontSize: computedStyle.fontSize,
        fontWeight: isBold ? '700' : computedStyle.fontWeight,
        fontStyle: isItalic ? 'italic' : computedStyle.fontStyle,
        textDecoration: textDecorations.join(' ') || 'none',
        color: computedStyle.color,
        backgroundColor: computedStyle.backgroundColor,
        fontFamily: computedStyle.fontFamily,
        textAlign: computedStyle.textAlign,
        lineHeight: computedStyle.lineHeight,
      });

      const selectedText = range.toString();
      if (selectedText) {
        const lines = selectedText.split('\n');
        const firstLineInfo = getLinePrefixInfo(lines[0]);
        const allSameType = lines.every(line => {
          const info = getLinePrefixInfo(line);
          return info.type === firstLineInfo.type;
        });
        if (allSameType && firstLineInfo.type) {
          setSelectionListType(firstLineInfo.type);
          setSelectionListStyleType(firstLineInfo.style);
        } else {
          setSelectionListType(null);
          setSelectionListStyleType('');
        }
      } else {
        setSelectionListType(null);
        setSelectionListStyleType('');
      }
    }
  };

  const updateSelectionStyles = () => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) {
      setSelectionStyles(null);
      return;
    }

    const currentRange = sel.getRangeAt(0);
    const isInEditor = editingElementRef.current && editingElementRef.current.contains(currentRange.startContainer);

    if (!isInEditor) {
      return;
    }

    updateStylesFromRange(currentRange);
  };

  const startTableCellEditing = (cell: HTMLElement) => {
    cell.contentEditable = 'true';
    cell.style.cursor = 'text';
    cell.style.userSelect = 'text';
    cell.focus();
    setIsTextEditing(true);
    setRightPanelTab('property');
    editingElementRef.current = cell;

    const range = document.createRange();
    range.selectNodeContents(cell);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);

    updateSelectionStyles();
  };

  const startTextEditing = (element: HTMLElement, clickX?: number, clickY?: number) => {
    element.contentEditable = 'true';
    element.style.cursor = 'text';
    element.style.userSelect = 'text';
    element.focus();
    setIsTextEditing(true);
    setRightPanelTab('property');
    editingElementRef.current = element;

    const range = document.createRange();
    const sel = window.getSelection();

    if (clickX !== undefined && clickY !== undefined && document.caretRangeFromPoint) {
      const caretRange = document.caretRangeFromPoint(clickX, clickY);
      if (caretRange && element.contains(caretRange.startContainer)) {
        range.setStart(caretRange.startContainer, caretRange.startOffset);
        range.collapse(true);
      } else {
        range.selectNodeContents(element);
        range.collapse(false);
      }
    } else {
      range.selectNodeContents(element);
      range.collapse(false);
    }

    sel?.removeAllRanges();
    sel?.addRange(range);

    updateSelectionStyles();
  };

  const stopTextEditing = () => {
    if (editingElementRef.current) {
      editingElementRef.current.contentEditable = 'false';
      editingElementRef.current.style.cursor = 'pointer';
      editingElementRef.current.style.userSelect = 'none';
      editingElementRef.current.blur();
      hideFakeSelection();
      editingElementRef.current = null;
    }
    savedSelectionRangeRef.current = null;
    setIsTextEditing(false);
    setSelectionStyles(null);
    markUnsaved();
    saveSlideHtmlRef.current(true);
  };

  const splitTextElement = () => {
    if (!isTextEditing || !editingElementRef.current) return;

    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;

    const range = sel.getRangeAt(0);
    if (!range) return;

    const container = slideContainerRef.current;
    const innerDiv = container?.querySelector('[data-slide-content="true"]') as HTMLElement | null;
    if (!container || !innerDiv) return;

    const editingElement = editingElementRef.current;
    const zoom = presentation?.zoom ?? 1;
    const innerRect = innerDiv.getBoundingClientRect();

    const selectedText = range.toString();
    if (!selectedText.trim()) return;

    const rangeRect = range.getBoundingClientRect();
    const parentEl = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
      ? range.commonAncestorContainer as HTMLElement
      : (range.commonAncestorContainer as Text).parentElement;

    if (!parentEl) return;

    const computedStyle = window.getComputedStyle(parentEl);
    const fontSize = computedStyle.fontSize;
    const fontWeight = computedStyle.fontWeight;
    const color = computedStyle.color;
    const fontFamily = computedStyle.fontFamily;
    const textAlign = parentEl.style.textAlign || computedStyle.textAlign;

    const extractedContent = range.extractContents();

    const innerElements = extractedContent.querySelectorAll('*');
    innerElements.forEach((el) => {
      const element = el as HTMLElement;
      element.style.cursor = '';
      element.style.userSelect = '';
      element.removeAttribute('contenteditable');
    });

    const tagName = editingElement.tagName.toLowerCase();
    const newElementTag = tagName === 'div' ? 'p' : tagName;
    const newElement = document.createElement(newElementTag);
    newElement.style.position = 'absolute';
    newElement.style.left = `${(rangeRect.left - innerRect.left) / zoom}px`;
    newElement.style.top = `${(rangeRect.top - innerRect.top) / zoom}px`;
    newElement.style.minWidth = `${rangeRect.width / zoom}px`;
    newElement.style.margin = '0';
    newElement.style.fontSize = fontSize;
    newElement.style.fontWeight = fontWeight;
    newElement.style.color = color;
    newElement.style.fontFamily = fontFamily;
    newElement.style.textAlign = textAlign;
    newElement.style.lineHeight = computedStyle.lineHeight;
    newElement.style.cursor = 'pointer';
    newElement.style.userSelect = 'none';

    while (extractedContent.firstChild) {
      newElement.appendChild(extractedContent.firstChild);
    }

    getSlideAppendTarget(innerDiv).appendChild(newElement);

    editingElement.contentEditable = 'false';
    editingElement.style.cursor = 'pointer';
    editingElement.style.userSelect = 'none';
    editingElementRef.current = null;
    savedSelectionRangeRef.current = null;
    setIsTextEditing(false);
    setSelectionStyles(null);

    highlightElementRef.current(newElement, true);
    updateSelectedElementsRef.current([newElement]);
    setShowPropertyPanel(true);
    setRightPanelTab('property');

    markUnsaved();
    saveSlideHtmlRef.current(true);
  };

  const showFakeSelection = () => {
    if (!savedSelectionRangeRef.current || !editingElementRef.current || !slideContainerRef.current) return;

    hideFakeSelection();

    const range = savedSelectionRangeRef.current;
    const rects = range.getClientRects();
    if (rects.length === 0) return;

    const slideRect = slideContainerRef.current.getBoundingClientRect();
    const zoom = presentation?.zoom ?? 1;

    const overlay = document.createElement('div');
    overlay.setAttribute('data-noppt-fake-selection-overlay', 'true');
    overlay.style.position = 'absolute';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100%';
    overlay.style.height = '100%';
    overlay.style.pointerEvents = 'none';
    overlay.style.zIndex = '100';

    for (let i = 0; i < rects.length; i++) {
      const rect = rects[i];
      const highlight = document.createElement('div');
      highlight.style.position = 'absolute';
      highlight.style.backgroundColor = 'rgba(59, 130, 246, 0.3)';
      highlight.style.borderRadius = '1px';
      highlight.style.left = `${(rect.left - slideRect.left) / zoom}px`;
      highlight.style.top = `${(rect.top - slideRect.top) / zoom}px`;
      highlight.style.width = `${rect.width / zoom}px`;
      highlight.style.height = `${rect.height / zoom}px`;
      overlay.appendChild(highlight);
    }

    slideContainerRef.current.appendChild(overlay);
    fakeSelectionOverlayRef.current = overlay;
  };

  const resolveListRange = (): Range | null => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const currentRange = sel.getRangeAt(0);
      if (editingElementRef.current && editingElementRef.current.contains(currentRange.startContainer)) {
        return currentRange;
      }
    }
    if (savedSelectionRangeRef.current) {
      return savedSelectionRangeRef.current.cloneRange();
    }
    return null;
  };

  const applyListToSelection = (listType: 'ul' | 'ol', styleOverride?: string, toggle: boolean = false) => {
    if (!editingElementRef.current) return;
    const range = resolveListRange();
    if (!range) return;

    const styleKey = styleOverride || (listType === 'ul' ? 'disc' : 'decimal');
    const result = _toggleListInRange(range, listType, styleKey, toggle);

    setSelectionListType(result.resultType);
    setSelectionListStyleType(result.resultStyle);

    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      savedSelectionRangeRef.current = sel.getRangeAt(0).cloneRange();
    } else {
      savedSelectionRangeRef.current = range.cloneRange();
    }

    updateSelectionStyles();
    markUnsaved();
  };

  const handleSelectionUnorderedList = () => applyListToSelection('ul', undefined, true);
  const handleSelectionOrderedList = () => applyListToSelection('ol', undefined, true);

  const applyListWithStyle = (listType: 'ul' | 'ol', styleType: string) => {
    applyListToSelection(listType, styleType, false);
  };

  const handleSelectionListStyleType = (styleType: string) => {
    applyListWithStyle('ul', styleType);
  };

  const restoreSavedSelection = () => {
    if (savedSelectionRangeRef.current) {
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(savedSelectionRangeRef.current.cloneRange());
      return true;
    }
    return false;
  };

  const applyFormatToSelection = (command: string, value?: string) => {
    const hadFocus = editingElementRef.current?.contains(document.activeElement);

    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
      if (!restoreSavedSelection()) return;
    }

    if (!hadFocus && editingElementRef.current) {
      editingElementRef.current.focus();
    }

    document.execCommand(command, false, value);

    const currentSel = window.getSelection();
    if (currentSel && currentSel.rangeCount > 0 && !currentSel.isCollapsed) {
      savedSelectionRangeRef.current = currentSel.getRangeAt(0).cloneRange();
    }

    updateSelectionStyles();
    markUnsaved();
  };

  const applyFontSizeToSelection = (size: number) => {
    let range: Range | null = null;
    const sel = window.getSelection();

    if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
      const currentRange = sel.getRangeAt(0);
      if (editingElementRef.current && editingElementRef.current.contains(currentRange.startContainer)) {
        range = currentRange;
      }
    }

    if (!range && savedSelectionRangeRef.current) {
      range = savedSelectionRangeRef.current.cloneRange();
    }

    if (!range || !editingElementRef.current) return;

    const hadFocus = editingElementRef.current.contains(document.activeElement);

    hideFakeSelection();

    const span = document.createElement('span');
    span.style.fontSize = `${size}px`;
    span.setAttribute('data-font-size-span', 'true');

    const fragment = range.extractContents();
    span.appendChild(fragment);
    range.insertNode(span);

    range.selectNodeContents(span);

    savedSelectionRangeRef.current = range.cloneRange();

    if (hadFocus && sel) {
      sel.removeAllRanges();
      sel.addRange(range);
      updateSelectionStyles();
    } else {
      setSelectionStyles((prev) => prev ? { ...prev, fontSize: `${size}px` } : prev);
      showFakeSelection();
    }

    markUnsaved();
  };

  const applyFontFamilyToSelection = (fontFamily: string) => {
    let range: Range | null = null;
    const sel = window.getSelection();

    if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
      const currentRange = sel.getRangeAt(0);
      if (editingElementRef.current && editingElementRef.current.contains(currentRange.startContainer)) {
        range = currentRange;
      }
    }

    if (!range && savedSelectionRangeRef.current) {
      range = savedSelectionRangeRef.current.cloneRange();
    }

    if (!range || !editingElementRef.current) return;

    const hadFocus = editingElementRef.current.contains(document.activeElement);

    hideFakeSelection();

    const span = document.createElement('span');
    span.style.fontFamily = fontFamily;
    span.setAttribute('data-font-family-span', 'true');

    const fragment = range.extractContents();
    span.appendChild(fragment);
    range.insertNode(span);

    range.selectNodeContents(span);

    savedSelectionRangeRef.current = range.cloneRange();

    if (hadFocus && sel) {
      sel.removeAllRanges();
      sel.addRange(range);
      updateSelectionStyles();
    } else {
      setSelectionStyles((prev) => prev ? { ...prev, fontFamily } : prev);
      showFakeSelection();
    }

    markUnsaved();
  };

  const applyColorToSelection = (color: string) => {
    applyFormatToSelection('foreColor', color);
  };

  const applyBoldToSelection = () => {
    applyFormatToSelection('bold');
  };

  const applyItalicToSelection = () => {
    applyFormatToSelection('italic');
  };

  const applyUnderlineToSelection = () => {
    applyFormatToSelection('underline');
  };

  const applyStrikethroughToSelection = () => {
    applyFormatToSelection('strikeThrough');
  };

  const applyBackgroundColorToSelection = (color: string) => {
    applyFormatToSelection('hiliteColor', color);
  };

  const applyAlignToSelection = (align: 'left' | 'center' | 'right' | 'justify') => {
    const commandMap = {
      left: 'justifyLeft',
      center: 'justifyCenter',
      right: 'justifyRight',
      justify: 'justifyFull',
    };
    applyFormatToSelection(commandMap[align]);
  };

  return {
    isTextEditing,
    setIsTextEditing,
    editingElementRef,
    savedSelectionRangeRef,
    selectionStyles,
    setSelectionStyles,
    selectionListType,
    setSelectionListType,
    selectionListStyleType,
    setSelectionListStyleType,
    fakeSelectionOverlayRef,
    startTableCellEditing,
    startTextEditing,
    stopTextEditing,
    splitTextElement,
    updateSelectionStyles,
    updateStylesFromRange,
    showFakeSelection,
    hideFakeSelection,
    resolveListRange,
    applyListToSelection,
    handleSelectionUnorderedList,
    handleSelectionOrderedList,
    applyListWithStyle,
    handleSelectionListStyleType,
    restoreSavedSelection,
    applyFormatToSelection,
    applyFontSizeToSelection,
    applyFontFamilyToSelection,
    applyColorToSelection,
    applyBoldToSelection,
    applyItalicToSelection,
    applyUnderlineToSelection,
    applyStrikethroughToSelection,
    applyBackgroundColorToSelection,
    applyAlignToSelection,
  };
}
