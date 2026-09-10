import { useEffect, useState, useRef } from 'react';
import { Dragger } from '@/utils/Dragger';
import { ResizeGesture, type ResizeDirection, type ResizeResult } from '@/utils/Resizer';
import { calculateGuides, type GuideLine, type ElementRect } from '@/utils/SmartGuides';
import {
  getElementByPath as _getElementByPath,
  getElementPath as _getElementPath,
  isSlideRootWrapper as _isSlideRootWrapper,
  isTextContent as _isTextContent,
  isVisualContainer as _isVisualContainer,
  isLayoutContainer as _isLayoutContainer,
} from '@/utils/selection';

export interface ClipboardElement {
  html: string;
  width: number;
  height: number;
  left: number;
  top: number;
}

export interface ContextMenuState {
  x: number;
  y: number;
  type: 'element' | 'slide';
  hasSlideClipboard?: boolean;
  hasElementClipboard?: boolean;
  hasTextClipboard?: boolean;
  hasHtmlClipboard?: boolean;
  hasImageClipboard?: boolean;
}

interface UseSelectionParams {
  slideContainerRef: React.RefObject<HTMLDivElement | null>;
  contentRef: React.RefObject<HTMLDivElement | null>;
  presentationZoom: number;
  isTextEditing: boolean;
  editingElementRef: React.RefObject<HTMLElement | null>;
  isPasteMode: boolean;
  clipboardElements: ClipboardElement[];
  isFormatBrushMode: boolean;
  formatBrushData: Record<string, string> | null;
  keyHeldRef: React.MutableRefObject<{ i: boolean; o: boolean }>;
  keepAspectRatioRef: React.MutableRefObject<boolean>;
  hasUnsavedChangesRef: React.MutableRefObject<boolean>;
  contextMenu: ContextMenuState | null;
  setContextMenu: React.Dispatch<React.SetStateAction<ContextMenuState | null>>;
  setShowPropertyPanel: React.Dispatch<React.SetStateAction<boolean>>;
  setRightPanelTab: React.Dispatch<React.SetStateAction<'property' | 'ai'>>;
  setIsFormatBrushMode: React.Dispatch<React.SetStateAction<boolean>>;
  setFormatBrushData: React.Dispatch<React.SetStateAction<Record<string, string> | null>>;
  stopTextEditingRef: React.MutableRefObject<() => void>;
  handlePasteAtPositionRef: React.MutableRefObject<(clientX: number, clientY: number) => void>;
  handleFormatBrushApplyRef: React.MutableRefObject<(element: HTMLElement) => void>;
  findSelectableElement: (target: HTMLElement, mode?: 'inner' | 'outer' | 'deep' | 'parent') => HTMLElement | null;
  isTextElement: (element: HTMLElement) => boolean;
  normalizeWhitespaceTextNodes: () => void;
  ensureElementIds: () => void;
  saveSlideHtmlRef: React.MutableRefObject<(addToHistory?: boolean, slideId?: string) => void>;
  markUnsaved: () => void;
  clearClipboardRef: React.MutableRefObject<() => void>;
}

export function useSelection({
  slideContainerRef,
  contentRef,
  presentationZoom,
  isTextEditing,
  editingElementRef,
  isPasteMode,
  clipboardElements,
  isFormatBrushMode,
  formatBrushData,
  keyHeldRef,
  keepAspectRatioRef,
  hasUnsavedChangesRef,
  contextMenu,
  setContextMenu,
  setShowPropertyPanel,
  setRightPanelTab,
  setIsFormatBrushMode,
  setFormatBrushData,
  stopTextEditingRef,
  handlePasteAtPositionRef,
  handleFormatBrushApplyRef,
  findSelectableElement,
  isTextElement,
  normalizeWhitespaceTextNodes,
  ensureElementIds,
  saveSlideHtmlRef,
  markUnsaved,
  clearClipboardRef,
}: UseSelectionParams) {
  const [selectedElements, setSelectedElements] = useState<HTMLElement[]>([]);
  const isSelectingRef = useRef(false);
  const [selectionBox, setSelectionBox] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const selectionStartRef = useRef<{ x: number; y: number } | null>(null);
  const selectedElementsRef = useRef<HTMLElement[]>([]);
  const selectedElementPathsRef = useRef<string[]>([]);
  const isRestoringSelectionRef = useRef(false);
  const [resizeBox, setResizeBox] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [guides, setGuides] = useState<GuideLine[]>([]);
  const draggerRef = useRef<Dragger | null>(null);
  const resizerRef = useRef<ResizeGesture | null>(null);

  const isSlideRootWrapper = (element: HTMLElement, innerDiv: HTMLElement): boolean => _isSlideRootWrapper(element, innerDiv);
  const isTextContent = (element: HTMLElement): boolean => _isTextContent(element);
  const isVisualContainer = (element: HTMLElement, excludeElement?: HTMLElement): boolean => {
    const ___iv = slideContainerRef.current?.querySelector('[data-slide-content="true"]') as HTMLElement | null;
    return _isVisualContainer(element, ___iv, excludeElement);
  };
  const isLayoutContainer = (element: HTMLElement): boolean => _isLayoutContainer(element);

  const updateResizeBox = () => {
    const elements = selectedElementsRef.current;
    if (elements.length === 0) {
      setResizeBox(null);
      return;
    }

    const container = slideContainerRef.current;
    const innerDiv = container?.querySelector('[data-slide-content="true"]');
    if (!container || !innerDiv) return;

    const containerRect = innerDiv.getBoundingClientRect();
    const zoom = presentationZoom;

    let minLeft = Infinity, minTop = Infinity, maxRight = -Infinity, maxBottom = -Infinity;

    elements.forEach((el) => {
      const rect = el.getBoundingClientRect();
      const left = (rect.left - containerRect.left) / zoom;
      const top = (rect.top - containerRect.top) / zoom;
      const right = (rect.right - containerRect.left) / zoom;
      const bottom = (rect.bottom - containerRect.top) / zoom;
      minLeft = Math.min(minLeft, left);
      minTop = Math.min(minTop, top);
      maxRight = Math.max(maxRight, right);
      maxBottom = Math.max(maxBottom, bottom);
    });

    setResizeBox({
      x: minLeft,
      y: minTop,
      width: maxRight - minLeft,
      height: maxBottom - minTop,
    });
  };

  const getElementSlideRect = (el: HTMLElement): ElementRect => {
    const innerDiv = slideContainerRef.current?.querySelector('[data-slide-content="true"]') as HTMLElement | null;
    if (!innerDiv) return { left: 0, top: 0, width: 0, height: 0 };
    const containerRect = innerDiv.getBoundingClientRect();
    const z = presentationZoom;
    const rect = el.getBoundingClientRect();
    return {
      left: (rect.left - containerRect.left) / z,
      top: (rect.top - containerRect.top) / z,
      width: rect.width / z,
      height: rect.height / z,
    };
  };

  const collectOtherRects = (excludeEls: HTMLElement[]): ElementRect[] => {
    const innerDiv = slideContainerRef.current?.querySelector('[data-slide-content="true"]') as HTMLElement | null;
    if (!innerDiv) return [];

    const allElements = Array.from(innerDiv.querySelectorAll('*')).filter(
      (el) => el instanceof HTMLElement,
    ) as HTMLElement[];
    const excludeSet = new Set(excludeEls);

    const candidates = allElements.filter((el) => {
      if (excludeSet.has(el)) return false;
      if (isSlideRootWrapper(el, innerDiv)) return false;
      return (
        isTextContent(el) ||
        isVisualContainer(el) ||
        el.classList.contains('noppt-group-element') ||
        el.classList.contains('noppt-slide-image-element')
      );
    });

    const topLevel = candidates.filter((element) => {
      let parent = element.parentElement as HTMLElement | null;
      while (parent && parent !== innerDiv) {
        if (
          !isSlideRootWrapper(parent, innerDiv) &&
          (isTextContent(parent) || isVisualContainer(parent))
        ) {
          return false;
        }
        if (
          parent.classList.contains('noppt-group-element') ||
          parent.classList.contains('noppt-slide-image-element')
        ) {
          return false;
        }
        parent = parent.parentElement as HTMLElement | null;
      }
      return true;
    });

    return topLevel.map((el) => getElementSlideRect(el));
  };

  const getCollectiveBBox = (rects: ElementRect[]): ElementRect => {
    if (rects.length === 0) return { left: 0, top: 0, width: 0, height: 0 };
    let minLeft = Infinity;
    let minTop = Infinity;
    let maxRight = -Infinity;
    let maxBottom = -Infinity;
    for (const r of rects) {
      minLeft = Math.min(minLeft, r.left);
      minTop = Math.min(minTop, r.top);
      maxRight = Math.max(maxRight, r.left + r.width);
      maxBottom = Math.max(maxBottom, r.top + r.height);
    }
    return { left: minLeft, top: minTop, width: maxRight - minLeft, height: maxBottom - minTop };
  };

  useEffect(() => {
    updateResizeBox();
  }, [selectedElements]);

  useEffect(() => {
    return () => {
      draggerRef.current?.destroy();
      resizerRef.current?.destroy();
    };
  }, []);

  const getElementPath = (element: HTMLElement): string => {
    const innerDiv = slideContainerRef.current?.querySelector('[data-slide-content="true"]') as HTMLElement | null;
    return _getElementPath(element, innerDiv);
  };

  const getElementByPath = (path: string): HTMLElement | null => {
    const innerDiv = slideContainerRef.current?.querySelector('[data-slide-content="true"]') as HTMLElement | null;
    return _getElementByPath(path, innerDiv);
  };

  const cleanSelectedElements = (elements: HTMLElement[]): HTMLElement[] => {
    if (!elements || elements.length === 0) return [];
    const container = slideContainerRef.current;
    if (!container) return elements;
    const innerDiv = container.querySelector('[data-slide-content="true"]') as HTMLElement | null;
    if (!innerDiv) return elements;
    return elements.filter((el) => el && el.isConnected && !isSlideRootWrapper(el, innerDiv));
  };

  const updateSelectedElements = (elements: HTMLElement[]): HTMLElement[] => {
    const cleaned = cleanSelectedElements(elements);
    selectedElementsRef.current = cleaned;
    setSelectedElements(cleaned);
    return cleaned;
  };

  const highlightElement = (element: HTMLElement, selected: boolean) => {
    if (selected) {
      element.classList.add('noppt-selected');
    } else {
      element.classList.remove('noppt-selected');
    }
  };

  const commitElementTransform = (el: HTMLElement) => {
    const match = el.style.transform.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/);
    if (match) {
      const tx = parseFloat(match[1]);
      const ty = parseFloat(match[2]);
      if (tx !== 0 || ty !== 0) {
        const styleLeft = parseFloat(el.style.left) || 0;
        const styleTop = parseFloat(el.style.top) || 0;
        el.style.left = `${styleLeft + tx}px`;
        el.style.top = `${styleTop + ty}px`;
      }
      el.style.transform = el.style.transform.replace(/translate\([^)]+\)\s*/g, '').trim();
    }
  };

  const commitAllSelectedTransforms = () => {
    selectedElementsRef.current.forEach((el) => commitElementTransform(el));
  };

  const saveAndRestoreSelectionForNewElements = (
    newElements: HTMLElement[],
    options: { markUnsaved?: boolean; clearClipboard?: boolean } = {},
  ) => {
    if (!newElements || newElements.length === 0) return;
    const { markUnsaved: shouldMarkUnsaved = false, clearClipboard: shouldClearClipboard = false } = options;

    normalizeWhitespaceTextNodes();
    ensureElementIds();
    selectedElementPathsRef.current = newElements
      .filter((el) => el && el.isConnected)
      .map((el) => getElementPath(el));
    saveSlideHtmlRef.current(true);
    if (selectedElementPathsRef.current.length > 0) {
      isRestoringSelectionRef.current = true;
      requestAnimationFrame(() => {
        const restored: HTMLElement[] = [];
        selectedElementPathsRef.current.forEach((path) => {
          const el = getElementByPath(path);
          if (el) restored.push(el);
        });
        const finalRestored = updateSelectedElements(restored);
        finalRestored.forEach((el) => highlightElement(el, true));
        if (finalRestored.length > 0) {
          setShowPropertyPanel(true);
          setRightPanelTab('property');
        }
        isRestoringSelectionRef.current = false;
      });
    }
    if (shouldMarkUnsaved) markUnsaved();
    if (shouldClearClipboard) clearClipboardRef.current();
  };

  const saveAndRestoreSelection = () => {
    normalizeWhitespaceTextNodes();
    ensureElementIds();

    if (selectedElementsRef.current.length > 0) {
      selectedElementPathsRef.current = selectedElementsRef.current.map((el) => getElementPath(el));
    }

    if (hasUnsavedChangesRef.current) {
      saveSlideHtmlRef.current(true);
    }

    if (selectedElementPathsRef.current.length > 0) {
      isRestoringSelectionRef.current = true;
      requestAnimationFrame(() => {
        const restored: HTMLElement[] = [];
        selectedElementPathsRef.current.forEach((path) => {
          const el = getElementByPath(path);
          if (el) {
            restored.push(el);
          }
        });
        selectedElementsRef.current.forEach((el) => {
          if (!restored.includes(el)) {
            highlightElement(el, false);
          }
        });
        const finalRestored = updateSelectedElements(restored);
        finalRestored.forEach((el) => highlightElement(el, true));
        setShowPropertyPanel(finalRestored.length > 0);
        isRestoringSelectionRef.current = false;
      });
    }
  };

  const getSlidePoint = (e: PointerEvent | MouseEvent) => {
    const innerDiv = contentRef.current;
    if (!innerDiv) return { x: 0, y: 0 };
    const rect = innerDiv.getBoundingClientRect();
    const z = presentationZoom;
    return { x: (e.clientX - rect.left) / z, y: (e.clientY - rect.top) / z };
  };

  const handleSlidePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const container = slideContainerRef.current;
    if (!container) return;

    const innerDiv = container.querySelector('[data-slide-content="true"]') as HTMLElement | null;
    if (!innerDiv) return;

    if (contextMenu) {
      setContextMenu(null);
    }

    if (e.button === 2) {
      return;
    }

    if (isTextEditing) {
      if (editingElementRef.current && !editingElementRef.current.contains(target)) {
        stopTextEditingRef.current();
      }
      return;
    }

    if (isPasteMode && clipboardElements.length > 0) {
      e.preventDefault();
      handlePasteAtPositionRef.current(e.clientX, e.clientY);
      return;
    }

    if (isFormatBrushMode && formatBrushData) {
      const element = findSelectableElement(target, 'inner');
      if (element && isTextElement(element)) {
        e.preventDefault();
        clearSelection();
        addToSelection(element);
        handleFormatBrushApplyRef.current(element);
        setIsFormatBrushMode(false);
        setFormatBrushData(null);
        return;
      }
    }

    const resizeHandle = target.closest('[data-resize-handle]');
    if (resizeHandle && selectedElementsRef.current.length === 1) {
      e.preventDefault();
      e.stopPropagation();
      const direction = resizeHandle.getAttribute('data-resize-handle') as ResizeDirection;
      const el = selectedElementsRef.current[0];

      const transformMatch = el.style.transform.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/);
      let tx = 0, ty = 0;
      if (transformMatch) {
        tx = parseFloat(transformMatch[1]);
        ty = parseFloat(transformMatch[2]);
      }

      const styleLeft = parseFloat(el.style.left) || 0;
      const styleTop = parseFloat(el.style.top) || 0;
      const styleWidth = parseFloat(el.style.width) || el.offsetWidth;
      const styleHeight = parseFloat(el.style.height) || el.offsetHeight;

      const effectiveLeft = styleLeft + tx;
      const effectiveTop = styleTop + ty;

      const originalTransform = el.style.transform;
      const originalLeft = el.style.left;
      const originalTop = el.style.top;
      const originalWidth = el.style.width;
      const originalHeight = el.style.height;
      const originalMaxWidth = el.style.maxWidth;
      const originalMaxHeight = el.style.maxHeight;

      if (tx !== 0 || ty !== 0) {
        el.style.left = `${effectiveLeft}px`;
        el.style.top = `${effectiveTop}px`;
        const newTransform = el.style.transform.replace(/translate\([^)]+\)\s*/g, '').trim();
        el.style.transform = newTransform;
      }

      const isGroup = el.getAttribute('data-element-type') === 'group';
      const contentWrapper = isGroup ? (el.querySelector('.noppt-group-content') as HTMLElement | null) : null;
      const initialScaleX = isGroup ? parseFloat(el.getAttribute('data-group-scale-x') || '1') : 1;
      const initialScaleY = isGroup ? parseFloat(el.getAttribute('data-group-scale-y') || '1') : 1;
      const originalGroupScaleX = el.getAttribute('data-group-scale-x');
      const originalGroupScaleY = el.getAttribute('data-group-scale-y');
      const originalContentTransform = contentWrapper ? contentWrapper.style.transform : '';

      const startRect = {
        left: effectiveLeft,
        top: effectiveTop,
        width: styleWidth,
        height: styleHeight,
      };

      resizerRef.current?.destroy();
      resizerRef.current = new ResizeGesture({
        direction,
        getPoint: getSlidePoint,
        getStartRect: () => startRect,
        keepAspectRatio: (ev) => keepAspectRatioRef.current || ev.shiftKey,
        threshold: 3,
        onMove: (rect: ResizeResult) => {
          el.style.left = `${rect.left}px`;
          el.style.top = `${rect.top}px`;
          el.style.width = `${rect.width}px`;
          el.style.height = `${rect.height}px`;
          el.style.maxWidth = 'none';
          el.style.maxHeight = 'none';

          if (isGroup && contentWrapper) {
            const ratioX = rect.width / startRect.width;
            const ratioY = rect.height / startRect.height;
            const newScaleX = initialScaleX * ratioX;
            const newScaleY = initialScaleY * ratioY;
            contentWrapper.style.transform = `scale(${newScaleX}, ${newScaleY})`;
            el.setAttribute('data-group-scale-x', String(newScaleX));
            el.setAttribute('data-group-scale-y', String(newScaleY));
          }

          updateResizeBox();
        },
        onEnd: (rect, cancelled, distance) => {
          if (cancelled) {
            el.style.left = originalLeft;
            el.style.top = originalTop;
            el.style.width = originalWidth;
            el.style.height = originalHeight;
            el.style.maxWidth = originalMaxWidth;
            el.style.maxHeight = originalMaxHeight;
            el.style.transform = originalTransform;
            if (isGroup && contentWrapper) {
              contentWrapper.style.transform = originalContentTransform;
              if (originalGroupScaleX !== null) el.setAttribute('data-group-scale-x', originalGroupScaleX);
              else el.removeAttribute('data-group-scale-x');
              if (originalGroupScaleY !== null) el.setAttribute('data-group-scale-y', originalGroupScaleY);
              else el.removeAttribute('data-group-scale-y');
            }
            updateResizeBox();
          } else if (distance > 3) {
            commitAllSelectedTransforms();
            normalizeWhitespaceTextNodes();
            ensureElementIds();
            saveSlideHtmlRef.current(true);
            markUnsaved();
            updateResizeBox();
          }
          resizerRef.current = null;
        },
      });
      resizerRef.current.start(e.nativeEvent);
      return;
    }

    let selectMode: 'inner' | 'outer' | 'deep' | 'parent' = 'inner';
    if (keyHeldRef.current.i) selectMode = 'inner';
    else if (keyHeldRef.current.o) selectMode = 'outer';
    else if (e.ctrlKey && e.altKey) selectMode = 'deep';
    else if (e.altKey) selectMode = 'parent';

    const element = findSelectableElement(target, selectMode);

    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      if (element) {
        e.preventDefault();
        toggleElementSelection(element);
      }
      return;
    }

    const selectedEl = target.closest('.noppt-selected') as HTMLElement | null;
    if (selectedEl && selectedElementsRef.current.length > 0) {
      e.preventDefault();

      const actualSelected = Array.from(
        innerDiv.querySelectorAll('.noppt-selected')
      ) as HTMLElement[];
      if (actualSelected.length > 0) {
        updateSelectedElements(actualSelected);
      }

      const elementPositions = selectedElementsRef.current.map((el) => {
        const match = el.style.transform.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/);
        let tx = 0, ty = 0;
        if (match) { tx = parseFloat(match[1]); ty = parseFloat(match[2]); }
        return { el, tx, ty, originalTransform: el.style.transform };
      });

      const initialRects = elementPositions.map(({ el }) => getElementSlideRect(el));
      const otherRects = collectOtherRects(selectedElementsRef.current);
      const slideWidth = slideContainerRef.current?.offsetWidth ?? 0;
      const slideHeight = slideContainerRef.current?.offsetHeight ?? 0;

      draggerRef.current?.destroy();
      draggerRef.current = new Dragger({
        getPoint: getSlidePoint,
        threshold: 3,
        onMove: (ctx) => {
          const movedRects = initialRects.map((r) => ({
            left: r.left + ctx.dx,
            top: r.top + ctx.dy,
            width: r.width,
            height: r.height,
          }));
          const draggedBBox = getCollectiveBBox(movedRects);
          const snap = calculateGuides([draggedBBox], otherRects, slideWidth, slideHeight);

          elementPositions.forEach(({ el, tx, ty }) => {
            el.style.transform = `translate(${tx + ctx.dx + snap.dx}px, ${ty + ctx.dy + snap.dy}px)`;
          });
          setGuides(snap.guides);
          updateResizeBox();
        },
        onEnd: (ctx) => {
          setGuides([]);
          if (ctx.cancelled) {
            elementPositions.forEach(({ el, originalTransform }) => {
              el.style.transform = originalTransform;
            });
            updateResizeBox();
          } else if (ctx.distance > 3) {
            commitAllSelectedTransforms();
            normalizeWhitespaceTextNodes();
            ensureElementIds();
            saveSlideHtmlRef.current(true);
            markUnsaved();
            updateResizeBox();
          }
          draggerRef.current = null;
        },
      });
      draggerRef.current.start(e.nativeEvent);
      return;
    }

    if (element) {
      clearSelection();
      addToSelection(element);

      const tag = element.tagName.toLowerCase();
      if (['span', 'strong', 'em', 'b', 'i', 'u', 'a', 'sup', 'sub'].includes(tag)) {
        const parentStyle = element.parentElement ? window.getComputedStyle(element.parentElement) : null;
        const parentIsLayout = parentStyle && (parentStyle.display.includes('flex') || parentStyle.display.includes('grid'));
        if (!parentIsLayout) {
          element.style.display = 'inline-block';
        }
      }

      const match = element.style.transform.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/);
      let tx = 0, ty = 0;
      if (match) { tx = parseFloat(match[1]); ty = parseFloat(match[2]); }
      const originalTransform = element.style.transform;
      const elementPositions = [{ el: element, tx, ty, originalTransform }];

      const initialRect = getElementSlideRect(element);
      const otherRects = collectOtherRects([element]);
      const slideWidth = slideContainerRef.current?.offsetWidth ?? 0;
      const slideHeight = slideContainerRef.current?.offsetHeight ?? 0;

      draggerRef.current?.destroy();
      draggerRef.current = new Dragger({
        getPoint: getSlidePoint,
        threshold: 3,
        onMove: (ctx) => {
          const movedRect = {
            left: initialRect.left + ctx.dx,
            top: initialRect.top + ctx.dy,
            width: initialRect.width,
            height: initialRect.height,
          };
          const snap = calculateGuides([movedRect], otherRects, slideWidth, slideHeight);

          elementPositions.forEach(({ el, tx: etx, ty: ety }) => {
            el.style.transform = `translate(${etx + ctx.dx + snap.dx}px, ${ety + ctx.dy + snap.dy}px)`;
          });
          setGuides(snap.guides);
          updateResizeBox();
        },
        onEnd: (ctx) => {
          setGuides([]);
          if (ctx.cancelled) {
            elementPositions.forEach(({ el, originalTransform: ot }) => {
              el.style.transform = ot;
            });
            updateResizeBox();
          } else if (ctx.distance > 3) {
            commitAllSelectedTransforms();
            normalizeWhitespaceTextNodes();
            ensureElementIds();
            saveSlideHtmlRef.current(true);
            markUnsaved();
            updateResizeBox();
          }
          draggerRef.current = null;
        },
      });
      draggerRef.current.start(e.nativeEvent);
      return;
    }

    const rect = innerDiv.getBoundingClientRect();
    const z = presentationZoom;
    const x = (e.clientX - rect.left) / z;
    const y = (e.clientY - rect.top) / z;

    clearSelection();
    isSelectingRef.current = true;
    selectionStartRef.current = { x, y };
    setSelectionBox({ x, y, width: 0, height: 0 });
  };

  const handleSlidePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const container = slideContainerRef.current;
    const innerDiv = container?.querySelector('[data-slide-content="true"]') as HTMLElement | null;
    if (!container || !innerDiv) return;

    if (isTextEditing) return;

    const rect = innerDiv.getBoundingClientRect();
    const zoom = presentationZoom;
    const currentX = (e.clientX - rect.left) / zoom;
    const currentY = (e.clientY - rect.top) / zoom;

    if (!isSelectingRef.current || !selectionStartRef.current) return;

    const startX = selectionStartRef.current.x;
    const startY = selectionStartRef.current.y;

    const x = Math.min(startX, currentX);
    const y = Math.min(startY, currentY);
    const width = Math.abs(currentX - startX);
    const height = Math.abs(currentY - startY);

    setSelectionBox({ x, y, width, height });

    const allElements = Array.from(innerDiv.querySelectorAll('*')).filter((el) => el instanceof HTMLElement) as HTMLElement[];
    const allCandidates = allElements.filter((el) => {
      if (isSlideRootWrapper(el, innerDiv)) return false;
      return (
        isTextContent(el) ||
        isVisualContainer(el, innerDiv) ||
        el.classList.contains('noppt-group-element') ||
        el.classList.contains('noppt-slide-image-element')
      );
    });
    const newSelected: HTMLElement[] = [];

    allCandidates.forEach((element) => {
      let parent = element.parentElement as HTMLElement | null;
      let hasSelectableAncestor = false;
      while (parent && parent !== innerDiv) {
        if (!isSlideRootWrapper(parent, innerDiv) &&
            (isTextContent(parent) || isVisualContainer(parent, innerDiv))) {
          hasSelectableAncestor = true;
          break;
        }
        if (parent.classList.contains('noppt-group-element') || parent.classList.contains('noppt-slide-image-element')) {
          hasSelectableAncestor = true;
          break;
        }
        parent = parent.parentElement as HTMLElement | null;
      }
      if (hasSelectableAncestor) return;

      const elRect = element.getBoundingClientRect();
      const elLeft = (elRect.left - rect.left) / zoom;
      const elTop = (elRect.top - rect.top) / zoom;
      const elRight = (elRect.right - rect.left) / zoom;
      const elBottom = (elRect.bottom - rect.top) / zoom;
      const elWidth = elRight - elLeft;
      const elHeight = elBottom - elTop;

      const overlapLeft = Math.max(elLeft, x);
      const overlapTop = Math.max(elTop, y);
      const overlapRight = Math.min(elRight, x + width);
      const overlapBottom = Math.min(elBottom, y + height);

      if (overlapLeft < overlapRight && overlapTop < overlapBottom) {
        const overlapArea = (overlapRight - overlapLeft) * (overlapBottom - overlapTop);
        const elArea = elWidth * elHeight;
        if (elArea > 0 && overlapArea / elArea >= 0.3) {
          newSelected.push(element);
        }
      }
    });

    const filteredNewSelected = newSelected.filter((el) => !isSlideRootWrapper(el, innerDiv));

    selectedElementsRef.current.forEach((el) => {
      if (!filteredNewSelected.includes(el)) {
        highlightElement(el, false);
      }
    });
    filteredNewSelected.forEach((el) => {
      if (!selectedElementsRef.current.includes(el)) {
        highlightElement(el, true);
      }
    });
    updateSelectedElements(filteredNewSelected);
    if (filteredNewSelected.length > 0) {
      setShowPropertyPanel(true);
      setRightPanelTab('property');
    }
  };

  const handleSlidePointerUp = () => {
    if (isSelectingRef.current) {
      isSelectingRef.current = false;
      setSelectionBox(null);
      selectionStartRef.current = null;
    }
  };

  const toggleElementSelection = (element: HTMLElement) => {
    if (selectedElementsRef.current.includes(element)) {
      highlightElement(element, false);
      const newSelected = selectedElementsRef.current.filter((el) => el !== element);
      updateSelectedElements(newSelected);
      if (newSelected.length === 0) {
        setShowPropertyPanel(false);
      }
    } else {
      highlightElement(element, true);
      const newSelected = [...selectedElementsRef.current, element];
      updateSelectedElements(newSelected);
      setShowPropertyPanel(true);
      setRightPanelTab('property');
    }
  };

  const addToSelection = (element: HTMLElement) => {
    highlightElement(element, true);
    updateSelectedElements([element]);
    setShowPropertyPanel(true);
    setRightPanelTab('property');
  };

  const clearSelection = () => {
    if (hasUnsavedChangesRef.current) {
      saveSlideHtmlRef.current();
    }
    selectedElementsRef.current.forEach((el) => {
      highlightElement(el, false);
    });
    updateSelectedElements([]);
    setShowPropertyPanel(false);
  };

  return {
    selectedElements,
    setSelectedElements,
    selectedElementsRef,
    selectedElementPathsRef,
    isRestoringSelectionRef,
    isSelectingRef,
    selectionBox,
    selectionStartRef,
    resizeBox,
    setResizeBox,
    updateResizeBox,
    guides,
    saveAndRestoreSelectionForNewElements,
    saveAndRestoreSelection,
    cleanSelectedElements,
    updateSelectedElements,
    highlightElement,
    commitAllSelectedTransforms,
    getElementPath,
    getElementByPath,
    isSlideRootWrapper,
    isTextContent,
    isVisualContainer,
    isLayoutContainer,
    handleSlidePointerDown,
    handleSlidePointerMove,
    handleSlidePointerUp,
    toggleElementSelection,
    addToSelection,
    clearSelection,
  };
}
