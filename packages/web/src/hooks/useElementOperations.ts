import { useRef, type MutableRefObject } from 'react';
import { getSlideAppendTarget as _getSlideAppendTarget } from '@/utils/selection';
import { t } from '@/i18n';

type AlignType = 'left' | 'right' | 'top' | 'bottom' | 'center-h' | 'center-v' | 'distribute-h' | 'distribute-v' | 'center-slide-h' | 'center-slide-v';
type SingleAlignType = 'left' | 'right' | 'top' | 'bottom' | 'center-h' | 'center-v' | 'center-slide-h' | 'center-slide-v';
type MoveDirection = 'up' | 'down' | 'left' | 'right';

interface PresentationLike {
  zoom?: number;
  [key: string]: any;
}

interface SlideLike {
  [key: string]: any;
}

interface UseElementOperationsParams {
  currentSlide: SlideLike | null | undefined;
  presentation: PresentationLike | null | undefined;
  slideContainerRef: MutableRefObject<HTMLDivElement | null>;
  selectedElementsRef: MutableRefObject<HTMLElement[]>;
  cleanSelectedElements: (elements: HTMLElement[]) => HTMLElement[];
  updateSelectedElements: (elements: HTMLElement[]) => HTMLElement[];
  highlightElement: (el: HTMLElement, highlight: boolean) => void;
  saveSlideHtml: (addToHistory?: boolean, slideId?: string) => void;
  markUnsaved: () => void;
  updateResizeBox: () => void;
  saveAndRestoreSelection: () => void;
  setShowPropertyPanel: (show: boolean) => void;
  setRightPanelTab: (tab: 'property' | 'ai') => void;
  showToast: (message: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
  commitAllSelectedTransforms: () => void;
}

export function useElementOperations({
  currentSlide,
  presentation,
  slideContainerRef,
  selectedElementsRef,
  cleanSelectedElements,
  updateSelectedElements,
  highlightElement,
  saveSlideHtml,
  markUnsaved,
  updateResizeBox,
  saveAndRestoreSelection,
  setShowPropertyPanel,
  setRightPanelTab,
  showToast,
  commitAllSelectedTransforms,
}: UseElementOperationsParams) {
  const getSlideAppendTarget = (innerDiv: HTMLElement): HTMLElement => _getSlideAppendTarget(innerDiv);

  const handleBindElements = () => {
    if (!currentSlide || !presentation) return;

    let elements = cleanSelectedElements(selectedElementsRef.current);
    if (elements.length < 2) {
      showToast(t('请选择至少2个元素进行绑定'), 'warning');
      return;
    }

    const container = slideContainerRef.current;
    const innerDiv = container?.querySelector('[data-slide-content="true"]') as HTMLElement | null;
    if (!container || !innerDiv) return;

    const zoom = presentation.zoom ?? 1;

    const elementInfos: { el: HTMLElement; left: number; top: number; width: number; height: number }[] = [];
    let minLeft = Infinity, minTop = Infinity, maxRight = -Infinity, maxBottom = -Infinity;

    elements.forEach((el) => {
      const rect = el.getBoundingClientRect();
      const containerRect = innerDiv.getBoundingClientRect();
      const left = (rect.left - containerRect.left) / zoom;
      const top = (rect.top - containerRect.top) / zoom;
      const width = rect.width / zoom;
      const height = rect.height / zoom;
      elementInfos.push({ el, left, top, width, height });
      minLeft = Math.min(minLeft, left);
      minTop = Math.min(minTop, top);
      maxRight = Math.max(maxRight, left + width);
      maxBottom = Math.max(maxBottom, top + height);
    });

    const groupWidth = maxRight - minLeft;
    const groupHeight = maxBottom - minTop;

    const groupEl = document.createElement('div');
    groupEl.className = 'noppt-group-element';
    groupEl.style.position = 'absolute';
    groupEl.style.left = `${minLeft}px`;
    groupEl.style.top = `${minTop}px`;
    groupEl.style.width = `${groupWidth}px`;
    groupEl.style.height = `${groupHeight}px`;
    groupEl.style.userSelect = 'none';
    groupEl.style.cursor = 'move';
    groupEl.style.boxSizing = 'border-box';
    groupEl.setAttribute('data-element-type', 'group');
    groupEl.setAttribute('data-group-scale-x', '1');
    groupEl.setAttribute('data-group-scale-y', '1');

    const contentWrapper = document.createElement('div');
    contentWrapper.className = 'noppt-group-content';
    contentWrapper.style.width = `${groupWidth}px`;
    contentWrapper.style.height = `${groupHeight}px`;
    contentWrapper.style.position = 'relative';
    contentWrapper.style.pointerEvents = 'none';
    contentWrapper.style.transformOrigin = 'top left';

    const sortedInfos = [...elementInfos].sort((a, b) => {
      const position = a.el.compareDocumentPosition(b.el);
      if (position & Node.DOCUMENT_POSITION_FOLLOWING) {
        return -1;
      } else if (position & Node.DOCUMENT_POSITION_PRECEDING) {
        return 1;
      }
      return 0;
    });

    sortedInfos.forEach(({ el, left, top }) => {
      el.style.boxShadow = '';
      el.classList.remove('noppt-selected');
      el.style.position = 'absolute';
      el.style.left = `${left - minLeft}px`;
      el.style.top = `${top - minTop}px`;
      el.style.transform = 'none';

      contentWrapper.appendChild(el);
    });

    groupEl.appendChild(contentWrapper);
    getSlideAppendTarget(innerDiv).appendChild(groupEl);

    saveSlideHtml(true);
    const finalSelected = updateSelectedElements([groupEl]);
    finalSelected.forEach((el) => highlightElement(el, true));
    if (finalSelected.length > 0) {
      setShowPropertyPanel(true);
      setRightPanelTab('property');
    }
    showToast(t('已绑定 {n} 个元素', { n: elements.length }), 'success');
  };

  const handleUnbindElements = () => {
    if (!currentSlide || !presentation) return;

    const elements = selectedElementsRef.current;
    const groupElements = elements.filter(el =>
      el.getAttribute('data-element-type') === 'group' ||
      el.classList.contains('noppt-group-element')
    );

    if (groupElements.length === 0) {
      showToast(t('请选择绑定对象进行解绑'), 'warning');
      return;
    }

    const container = slideContainerRef.current;
    const innerDiv = container?.querySelector('[data-slide-content="true"]') as HTMLElement | null;
    if (!container || !innerDiv) return;

    const zoom = presentation.zoom ?? 1;
    const allUnboundElements: HTMLElement[] = [];

    groupElements.forEach((groupEl) => {
      const contentWrapper = groupEl.querySelector('.noppt-group-content') as HTMLElement | null;
      if (!contentWrapper) return;

      const groupRect = groupEl.getBoundingClientRect();
      const containerRect = innerDiv.getBoundingClientRect();
      const groupLeft = (groupRect.left - containerRect.left) / zoom;
      const groupTop = (groupRect.top - containerRect.top) / zoom;

      const scaleX = parseFloat(groupEl.getAttribute('data-group-scale-x') || '1');
      const scaleY = parseFloat(groupEl.getAttribute('data-group-scale-y') || '1');

      const children = Array.from(contentWrapper.children) as HTMLElement[];
      children.forEach((child) => {
        const childRect = child.getBoundingClientRect();
        const containerRect = innerDiv.getBoundingClientRect();

        const finalLeft = (childRect.left - containerRect.left) / zoom;
        const finalTop = (childRect.top - containerRect.top) / zoom;
        const finalWidth = childRect.width / zoom;
        const finalHeight = childRect.height / zoom;

        child.style.position = 'absolute';
        child.style.left = `${finalLeft}px`;
        child.style.top = `${finalTop}px`;
        child.style.width = `${finalWidth}px`;
        child.style.height = `${finalHeight}px`;
        child.style.transform = 'none';

        getSlideAppendTarget(innerDiv).appendChild(child);
        allUnboundElements.push(child);
      });

      groupEl.remove();
    });

    if (allUnboundElements.length > 0) {
      saveSlideHtml(true);
      const finalElements = updateSelectedElements(allUnboundElements);
      finalElements.forEach(el => highlightElement(el, true));
      if (finalElements.length > 0) {
        setShowPropertyPanel(true);
        setRightPanelTab('property');
      }
      showToast(t('已解绑为 {n} 个元素', { n: finalElements.length }), 'success');
    }
  };

  const alignElements = (type: AlignType) => {
    if (selectedElementsRef.current.length < 2) return;

    const container = slideContainerRef.current;
    const innerDiv = container?.querySelector('[data-slide-content="true"]');
    if (!container || !innerDiv) return;

    const zoom = presentation?.zoom ?? 1;
    const containerRect = innerDiv.getBoundingClientRect();

    const elementData = selectedElementsRef.current.map((el) => {
      const rect = el.getBoundingClientRect();
      return {
        element: el,
        left: (rect.left - containerRect.left) / zoom,
        top: (rect.top - containerRect.top) / zoom,
        right: (rect.right - containerRect.left) / zoom,
        bottom: (rect.bottom - containerRect.top) / zoom,
        width: rect.width / zoom,
        height: rect.height / zoom,
      };
    });

    switch (type) {
      case 'left': {
        const minLeft = Math.min(...elementData.map((d) => d.left));
        elementData.forEach(({ element, left }) => {
          const delta = minLeft - left;
          const match = element.style.transform.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/);
          let tx = 0, ty = 0;
          if (match) { tx = parseFloat(match[1]); ty = parseFloat(match[2]); }
          element.style.transform = `translate(${tx + delta}px, ${ty}px)`;
        });
        break;
      }
      case 'right': {
        const maxRight = Math.max(...elementData.map((d) => d.right));
        elementData.forEach(({ element, right }) => {
          const delta = maxRight - right;
          const match = element.style.transform.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/);
          let tx = 0, ty = 0;
          if (match) { tx = parseFloat(match[1]); ty = parseFloat(match[2]); }
          element.style.transform = `translate(${tx + delta}px, ${ty}px)`;
        });
        break;
      }
      case 'top': {
        const minTop = Math.min(...elementData.map((d) => d.top));
        elementData.forEach(({ element, top }) => {
          const delta = minTop - top;
          const match = element.style.transform.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/);
          let tx = 0, ty = 0;
          if (match) { tx = parseFloat(match[1]); ty = parseFloat(match[2]); }
          element.style.transform = `translate(${tx}px, ${ty + delta}px)`;
        });
        break;
      }
      case 'bottom': {
        const maxBottom = Math.max(...elementData.map((d) => d.bottom));
        elementData.forEach(({ element, bottom }) => {
          const delta = maxBottom - bottom;
          const match = element.style.transform.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/);
          let tx = 0, ty = 0;
          if (match) { tx = parseFloat(match[1]); ty = parseFloat(match[2]); }
          element.style.transform = `translate(${tx}px, ${ty + delta}px)`;
        });
        break;
      }
      case 'center-h': {
        const avgLeft = elementData.reduce((sum, d) => sum + d.left, 0) / elementData.length;
        const avgRight = elementData.reduce((sum, d) => sum + d.right, 0) / elementData.length;
        const centerX = (avgLeft + avgRight) / 2;
        elementData.forEach(({ element, left, right }) => {
          const elCenter = (left + right) / 2;
          const delta = centerX - elCenter;
          const match = element.style.transform.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/);
          let tx = 0, ty = 0;
          if (match) { tx = parseFloat(match[1]); ty = parseFloat(match[2]); }
          element.style.transform = `translate(${tx + delta}px, ${ty}px)`;
        });
        break;
      }
      case 'center-v': {
        const avgTop = elementData.reduce((sum, d) => sum + d.top, 0) / elementData.length;
        const avgBottom = elementData.reduce((sum, d) => sum + d.bottom, 0) / elementData.length;
        const centerY = (avgTop + avgBottom) / 2;
        elementData.forEach(({ element, top, bottom }) => {
          const elCenter = (top + bottom) / 2;
          const delta = centerY - elCenter;
          const match = element.style.transform.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/);
          let tx = 0, ty = 0;
          if (match) { tx = parseFloat(match[1]); ty = parseFloat(match[2]); }
          element.style.transform = `translate(${tx}px, ${ty + delta}px)`;
        });
        break;
      }
      case 'center-slide-h': {
        const minLeft = Math.min(...elementData.map((d) => d.left));
        const maxRight = Math.max(...elementData.map((d) => d.right));
        const groupWidth = maxRight - minLeft;
        const containerWidth = containerRect.width / zoom;
        const targetLeft = (containerWidth - groupWidth) / 2;
        const deltaX = targetLeft - minLeft;
        elementData.forEach(({ element, left }) => {
          const match = element.style.transform.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/);
          let tx = 0, ty = 0;
          if (match) { tx = parseFloat(match[1]); ty = parseFloat(match[2]); }
          element.style.transform = `translate(${tx + deltaX}px, ${ty}px)`;
        });
        break;
      }
      case 'center-slide-v': {
        const minTop = Math.min(...elementData.map((d) => d.top));
        const maxBottom = Math.max(...elementData.map((d) => d.bottom));
        const groupHeight = maxBottom - minTop;
        const containerHeight = containerRect.height / zoom;
        const targetTop = (containerHeight - groupHeight) / 2;
        const deltaY = targetTop - minTop;
        elementData.forEach(({ element, top }) => {
          const match = element.style.transform.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/);
          let tx = 0, ty = 0;
          if (match) { tx = parseFloat(match[1]); ty = parseFloat(match[2]); }
          element.style.transform = `translate(${tx}px, ${ty + deltaY}px)`;
        });
        break;
      }
      case 'distribute-h': {
        const sorted = [...elementData].sort((a, b) => a.left - b.left);
        const minLeft = sorted[0].left;
        const maxRight = sorted[sorted.length - 1].right;
        const totalWidth = maxRight - minLeft;
        const totalElementWidth = sorted.reduce((sum, d) => sum + d.width, 0);
        const gap = (totalWidth - totalElementWidth) / (sorted.length - 1);
        let currentLeft = minLeft;
        sorted.forEach(({ element, left, width }) => {
          const delta = currentLeft - left;
          const match = element.style.transform.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/);
          let tx = 0, ty = 0;
          if (match) { tx = parseFloat(match[1]); ty = parseFloat(match[2]); }
          element.style.transform = `translate(${tx + delta}px, ${ty}px)`;
          currentLeft += width + gap;
        });
        break;
      }
      case 'distribute-v': {
        const sorted = [...elementData].sort((a, b) => a.top - b.top);
        const minTop = sorted[0].top;
        const maxBottom = sorted[sorted.length - 1].bottom;
        const totalHeight = maxBottom - minTop;
        const totalElementHeight = sorted.reduce((sum, d) => sum + d.height, 0);
        const gap = (totalHeight - totalElementHeight) / (sorted.length - 1);
        let currentTop = minTop;
        sorted.forEach(({ element, top, height }) => {
          const delta = currentTop - top;
          const match = element.style.transform.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/);
          let tx = 0, ty = 0;
          if (match) { tx = parseFloat(match[1]); ty = parseFloat(match[2]); }
          element.style.transform = `translate(${tx}px, ${ty + delta}px)`;
          currentTop += height + gap;
        });
        break;
      }
    }

    commitAllSelectedTransforms();
    saveSlideHtml(true);
    markUnsaved();
    updateResizeBox();
  };

  const alignSingleElement = (type: SingleAlignType) => {
    if (selectedElementsRef.current.length !== 1) return;

    const container = slideContainerRef.current;
    const innerDiv = container?.querySelector('[data-slide-content="true"]');
    if (!container || !innerDiv) return;

    const zoom = presentation?.zoom ?? 1;
    const containerRect = innerDiv.getBoundingClientRect();
    const element = selectedElementsRef.current[0];
    const rect = element.getBoundingClientRect();

    const elementLeft = (rect.left - containerRect.left) / zoom;
    const elementTop = (rect.top - containerRect.top) / zoom;
    const elementWidth = rect.width / zoom;
    const elementHeight = rect.height / zoom;
    const containerWidth = containerRect.width / zoom;
    const containerHeight = containerRect.height / zoom;

    const match = element.style.transform.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/);
    let tx = 0, ty = 0;
    if (match) { tx = parseFloat(match[1]); ty = parseFloat(match[2]); }

    let deltaX = 0;
    let deltaY = 0;

    switch (type) {
      case 'left':
        deltaX = -elementLeft;
        break;
      case 'right':
        deltaX = containerWidth - elementWidth - elementLeft;
        break;
      case 'top':
        deltaY = -elementTop;
        break;
      case 'bottom':
        deltaY = containerHeight - elementHeight - elementTop;
        break;
      case 'center-h':
      case 'center-slide-h':
        deltaX = (containerWidth - elementWidth) / 2 - elementLeft;
        break;
      case 'center-v':
      case 'center-slide-v':
        deltaY = (containerHeight - elementHeight) / 2 - elementTop;
        break;
    }

    element.style.transform = `translate(${tx + deltaX}px, ${ty + deltaY}px)`;
    commitAllSelectedTransforms();
    saveSlideHtml(true);
    markUnsaved();
    updateResizeBox();
  };

  const moveSelectedElements = (direction: MoveDirection, amount: number = 5) => {
    if (selectedElementsRef.current.length === 0) return;

    const deltaMap = {
      up: { x: 0, y: -amount },
      down: { x: 0, y: amount },
      left: { x: -amount, y: 0 },
      right: { x: amount, y: 0 },
    };
    const delta = deltaMap[direction];

    selectedElementsRef.current.forEach((element) => {
      const match = element.style.transform.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/);
      let tx = 0, ty = 0;
      if (match) { tx = parseFloat(match[1]); ty = parseFloat(match[2]); }
      element.style.transform = `translate(${tx + delta.x}px, ${ty + delta.y}px)`;
    });

    commitAllSelectedTransforms();
    saveSlideHtml(true);
    markUnsaved();
    updateResizeBox();
  };

  const reorderElements = (newOrder: HTMLElement[]) => {
    const container = slideContainerRef.current;
    const innerDiv = container?.querySelector('[data-slide-content="true"]');
    if (!container || !innerDiv) return;

    const fragment = document.createDocumentFragment();
    newOrder.forEach((el) => {
      fragment.appendChild(el);
    });
    innerDiv.appendChild(fragment);
  };

  const bringToFront = () => {
    if (selectedElementsRef.current.length === 0) return;

    const container = slideContainerRef.current;
    const innerDiv = container?.querySelector('[data-slide-content="true"]');
    if (!container || !innerDiv) return;

    const allChildren = Array.from(innerDiv.children) as HTMLElement[];
    const selectedSet = new Set(selectedElementsRef.current);

    const unselected: HTMLElement[] = [];
    const selected: HTMLElement[] = [];

    allChildren.forEach((el) => {
      if (selectedSet.has(el)) {
        selected.push(el);
      } else {
        unselected.push(el);
      }
    });

    if (selected.length === 0 || selected.length === allChildren.length) return;

    const newOrder = [...unselected, ...selected];
    reorderElements(newOrder);

    markUnsaved();
    saveAndRestoreSelection();
  };

  const sendToBack = () => {
    if (selectedElementsRef.current.length === 0) return;

    const container = slideContainerRef.current;
    const innerDiv = container?.querySelector('[data-slide-content="true"]');
    if (!container || !innerDiv) return;

    const allChildren = Array.from(innerDiv.children) as HTMLElement[];
    const selectedSet = new Set(selectedElementsRef.current);

    const unselected: HTMLElement[] = [];
    const selected: HTMLElement[] = [];

    allChildren.forEach((el) => {
      if (selectedSet.has(el)) {
        selected.push(el);
      } else {
        unselected.push(el);
      }
    });

    if (selected.length === 0 || selected.length === allChildren.length) return;

    const newOrder = [...selected, ...unselected];
    reorderElements(newOrder);

    markUnsaved();
    saveAndRestoreSelection();
  };

  const bringForward = () => {
    if (selectedElementsRef.current.length === 0) return;

    const container = slideContainerRef.current;
    const innerDiv = container?.querySelector('[data-slide-content="true"]');
    if (!container || !innerDiv) return;

    const allChildren = Array.from(innerDiv.children) as HTMLElement[];
    const selectedSet = new Set(selectedElementsRef.current);

    if (selectedSet.size === allChildren.length) return;

    const newOrder: HTMLElement[] = [];
    let i = 0;

    while (i < allChildren.length) {
      const el = allChildren[i];
      if (selectedSet.has(el)) {
        const selectedGroup: HTMLElement[] = [];
        while (i < allChildren.length && selectedSet.has(allChildren[i])) {
          selectedGroup.push(allChildren[i]);
          i++;
        }
        if (i < allChildren.length) {
          newOrder.push(allChildren[i]);
          newOrder.push(...selectedGroup);
          i++;
        } else {
          newOrder.push(...selectedGroup);
        }
      } else {
        newOrder.push(el);
        i++;
      }
    }

    let changed = false;
    for (let j = 0; j < allChildren.length; j++) {
      if (allChildren[j] !== newOrder[j]) {
        changed = true;
        break;
      }
    }
    if (!changed) return;

    reorderElements(newOrder);

    markUnsaved();
    saveAndRestoreSelection();
  };

  const sendBackward = () => {
    if (selectedElementsRef.current.length === 0) return;

    const container = slideContainerRef.current;
    const innerDiv = container?.querySelector('[data-slide-content="true"]');
    if (!container || !innerDiv) return;

    const allChildren = Array.from(innerDiv.children) as HTMLElement[];
    const selectedSet = new Set(selectedElementsRef.current);

    if (selectedSet.size === allChildren.length) return;

    const newOrder: HTMLElement[] = [];
    let i = allChildren.length - 1;

    while (i >= 0) {
      const el = allChildren[i];
      if (selectedSet.has(el)) {
        const selectedGroup: HTMLElement[] = [];
        while (i >= 0 && selectedSet.has(allChildren[i])) {
          selectedGroup.unshift(allChildren[i]);
          i--;
        }
        if (i >= 0) {
          newOrder.unshift(allChildren[i]);
          newOrder.unshift(...selectedGroup);
          i--;
        } else {
          newOrder.unshift(...selectedGroup);
        }
      } else {
        newOrder.unshift(el);
        i--;
      }
    }

    let changed = false;
    for (let j = 0; j < allChildren.length; j++) {
      if (allChildren[j] !== newOrder[j]) {
        changed = true;
        break;
      }
    }
    if (!changed) return;

    reorderElements(newOrder);

    markUnsaved();
    saveAndRestoreSelection();
  };

  const bringToFrontRef = useRef(bringToFront);
  bringToFrontRef.current = bringToFront;

  const sendToBackRef = useRef(sendToBack);
  sendToBackRef.current = sendToBack;

  const bringForwardRef = useRef(bringForward);
  bringForwardRef.current = bringForward;

  const sendBackwardRef = useRef(sendBackward);
  sendBackwardRef.current = sendBackward;

  return {
    handleBindElements,
    handleUnbindElements,
    alignElements,
    alignSingleElement,
    moveSelectedElements,
    reorderElements,
    bringToFront,
    sendToBack,
    bringForward,
    sendBackward,
    bringToFrontRef,
    sendToBackRef,
    bringForwardRef,
    sendBackwardRef,
  };
}
