import type { MutableRefObject } from 'react';
import type { ClipboardElement, ContextMenuState } from './useSelection';
import { t } from '@/i18n';

interface ClipboardCheckResult {
  hasSlideClipboard: boolean;
  hasElementClipboard: boolean;
  hasTextClipboard: boolean;
  hasHtmlClipboard: boolean;
  hasImageClipboard: boolean;
}

interface UseContextMenuParams {
  isTextEditing: boolean;
  clipboardElements: ClipboardElement[];
  contextMenu: ContextMenuState | null;
  setContextMenu: React.Dispatch<React.SetStateAction<ContextMenuState | null>>;
  selectedElementsRef: MutableRefObject<HTMLElement[]>;
  findSelectableElement: (
    target: HTMLElement,
    mode?: 'inner' | 'outer' | 'deep' | 'parent',
  ) => HTMLElement | null;
  clearSelection: () => void;
  addToSelection: (element: HTMLElement) => void;
  checkClipboard: () => Promise<ClipboardCheckResult>;
  handleDeleteElement: () => void;
  handleCopyElements: () => Promise<void>;
  handleCopySlideAsImage: () => Promise<void>;
  handlePasteAtPosition: (clientX: number, clientY: number) => void;
  readElementsFromClipboard: () => Promise<any[] | null>;
  pasteElementsFromData: (
    elements: any[],
    targetX: number,
    targetY: number,
    offset: number,
  ) => HTMLElement[];
  saveAndRestoreSelectionForNewElements: (
    newElements: HTMLElement[],
    options?: { markUnsaved?: boolean; clearClipboard?: boolean },
  ) => void;
  slideContainerRef: MutableRefObject<HTMLDivElement | null>;
  presentationZoom: number;
  showToast: (message: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
}

export function useContextMenu({
  isTextEditing,
  clipboardElements,
  contextMenu,
  setContextMenu,
  selectedElementsRef,
  findSelectableElement,
  clearSelection,
  addToSelection,
  checkClipboard,
  handleDeleteElement,
  handleCopyElements,
  handleCopySlideAsImage,
  handlePasteAtPosition,
  readElementsFromClipboard,
  pasteElementsFromData,
  saveAndRestoreSelectionForNewElements,
  slideContainerRef,
  presentationZoom,
  showToast,
}: UseContextMenuParams) {
  const handleContextMenu = async (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();

    if (isTextEditing) return;

    const target = e.target as HTMLElement;
    const element = findSelectableElement(target, e.altKey ? 'parent' : 'inner');
    const hasLocalElementClipboard = clipboardElements.length > 0;

    if (element) {
      if (!selectedElementsRef.current.includes(element)) {
        clearSelection();
        addToSelection(element);
      }
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        type: 'element',
        hasSlideClipboard: false,
        hasElementClipboard: hasLocalElementClipboard,
        hasTextClipboard: false,
        hasHtmlClipboard: false,
        hasImageClipboard: false,
      });
    } else {
      clearSelection();
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        type: 'slide',
        hasSlideClipboard: false,
        hasElementClipboard: hasLocalElementClipboard,
        hasTextClipboard: false,
        hasHtmlClipboard: false,
        hasImageClipboard: false,
      });
    }

    const clipboardInfo = await checkClipboard();
    setContextMenu((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        hasSlideClipboard: clipboardInfo.hasSlideClipboard,
        hasElementClipboard: prev.hasElementClipboard || clipboardInfo.hasElementClipboard,
        hasTextClipboard: clipboardInfo.hasTextClipboard,
        hasHtmlClipboard: clipboardInfo.hasHtmlClipboard,
        hasImageClipboard: clipboardInfo.hasImageClipboard,
      };
    });
  };

  const handleDeleteElementFromMenu = () => {
    setContextMenu(null);
    handleDeleteElement();
  };

  const handleCopyFromMenu = async () => {
    setContextMenu(null);
    await handleCopyElements();
  };

  const handleCutFromMenu = async () => {
    setContextMenu(null);
    await handleCopyElements();
    handleDeleteElement();
  };

  const handlePasteFromMenu = async () => {
    const x = contextMenu?.x;
    const y = contextMenu?.y;
    setContextMenu(null);

    if (clipboardElements.length > 0 && x !== undefined && y !== undefined) {
      handlePasteAtPosition(x, y);
      return;
    }

    const elements = await readElementsFromClipboard();
    if (elements && elements.length > 0 && x !== undefined && y !== undefined) {
      const container = slideContainerRef.current;
      const innerDiv = container?.querySelector(
        '[data-slide-content="true"]',
      ) as HTMLElement | null;
      if (!container || !innerDiv) return;

      const rect = innerDiv.getBoundingClientRect();
      const targetX = (x - rect.left) / presentationZoom;
      const targetY = (y - rect.top) / presentationZoom;

      const pasted = pasteElementsFromData(elements, targetX, targetY, 0);

      if (pasted.length > 0) {
        const pastedCount = pasted.length;
        saveAndRestoreSelectionForNewElements(pasted, { markUnsaved: false, clearClipboard: true });
        showToast(t('已粘贴 {n} 个元素', { n: pastedCount }), 'success');
      }
    }
  };

  const handleCopySlideImageFromMenu = async () => {
    setContextMenu(null);
    await handleCopySlideAsImage();
  };

  return {
    handleContextMenu,
    handleDeleteElementFromMenu,
    handleCopyFromMenu,
    handleCutFromMenu,
    handlePasteFromMenu,
    handleCopySlideImageFromMenu,
  };
}
