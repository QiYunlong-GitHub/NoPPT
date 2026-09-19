import { useEffect } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';

export interface ElementPixelSize {
  width: string;
  height: string;
  widthNum: number;
  heightNum: number;
}

export interface UseComputedStyleSyncParams {
  selectedElements: HTMLElement[];
  isTextElement: (el: HTMLElement) => boolean;
  getElementPixelSize: (el: HTMLElement, zoom?: number) => ElementPixelSize;
  setIsMultiSelect: (value: boolean) => void;
  setElementType: (
    value: 'text' | 'image' | 'container' | 'mixed' | null,
  ) => void;
  setAllTextElements: (value: boolean) => void;
  setLocalStyles: Dispatch<SetStateAction<Record<string, string>>>;
  setAspectRatio: (value: number) => void;
  setPosition: (value: { left: number; top: number }) => void;
  originalPositionRef: MutableRefObject<{ left: number; top: number }>;
  slideContainerRef: MutableRefObject<Element | null>;
}

// 计算样式同步 effect：当选中元素变化（selectedElements）时，重新计算并更新
// 多选状态、元素类型、本地样式快照、宽高比与相对位置。
// 该逻辑原位于 PropertyPanel.tsx 主组件的巨型 useEffect 内，此处逐字迁移，
// 仅把依赖（setter / ref / 辅助函数）以显式参数注入，执行时机与依赖数组保持不变。
export function useComputedStyleSync(params: UseComputedStyleSyncParams): void {
  const {
    selectedElements,
    isTextElement,
    getElementPixelSize,
    setIsMultiSelect,
    setElementType,
    setAllTextElements,
    setLocalStyles,
    setAspectRatio,
    setPosition,
    originalPositionRef,
    slideContainerRef,
  } = params;

  useEffect(() => {
    if (!selectedElements || selectedElements.length === 0) {
      setIsMultiSelect(false);
      setElementType(null);
      setAllTextElements(false);
      setLocalStyles({});
      return;
    }
    setIsMultiSelect(selectedElements.length > 1);
    const allText = selectedElements.every((el) => isTextElement(el));
    setAllTextElements(allText);
    if (selectedElements.length === 1) {
      const element = selectedElements[0];
      const tagName = element.tagName.toLowerCase();
      if (tagName === 'img' || tagName === 'video') {
        setElementType('image');
      } else if (isTextElement(element)) {
        setElementType('text');
      } else {
        setElementType('container');
      }
      const computedStyle = window.getComputedStyle(element);
      const slideContent = element.closest('[data-slide-content="true"]');
      const slideContainer = element.closest('[data-slide-zoom]');
      slideContainerRef.current = slideContainer;
      const zoom = slideContainer
        ? parseFloat(slideContainer.getAttribute('data-slide-zoom') || '1')
        : 1;
      const { width, height, widthNum, heightNum } = getElementPixelSize(element, zoom);
      setLocalStyles({
        fontSize: computedStyle.fontSize,
        fontWeight: computedStyle.fontWeight,
        fontStyle: computedStyle.fontStyle,
        textDecoration: computedStyle.textDecorationLine,
        color: computedStyle.color,
        backgroundColor: element.style.backgroundColor || computedStyle.backgroundColor,
        fontFamily: computedStyle.fontFamily,
        textAlign: element.style.textAlign || computedStyle.textAlign,
        width,
        height,
        borderRadius: element.style.borderRadius || computedStyle.borderRadius,
        boxShadow:
          element.style.boxShadow ||
          (computedStyle.boxShadow !== 'none' ? computedStyle.boxShadow : ''),
        backdropFilter:
          element.style.backdropFilter ||
          (computedStyle.backdropFilter !== 'none' ? computedStyle.backdropFilter : ''),
        border:
          element.style.border ||
          (computedStyle.borderStyle !== 'none'
            ? `${computedStyle.borderWidth} ${computedStyle.borderStyle} ${computedStyle.borderColor}`
            : ''),
      });
      if (widthNum > 0 && heightNum > 0) {
        setAspectRatio(widthNum / heightNum);
      }
      if (slideContainer && slideContent) {
        const containerRect = slideContent.getBoundingClientRect();
        const elementRect = element.getBoundingClientRect();
        const left = (elementRect.left - containerRect.left) / zoom;
        const top = (elementRect.top - containerRect.top) / zoom;
        setPosition({ left, top });
        originalPositionRef.current = { left, top };
      }
    } else {
      const types = new Set<string>();
      selectedElements.forEach((el) => {
        const tagName = el.tagName.toLowerCase();
        if (tagName === 'img' || tagName === 'video') {
          types.add('image');
        } else if (isTextElement(el)) {
          types.add('text');
        } else {
          types.add('container');
        }
      });
      setElementType(
        types.size > 1 ? 'mixed' : (types.values().next().value as 'text' | 'image' | 'container'),
      );
      const firstEl = selectedElements[0];
      const computedStyle = window.getComputedStyle(firstEl);
      const slideContent = firstEl.closest('[data-slide-content="true"]');
      const slideContainer = firstEl.closest('[data-slide-zoom]');
      slideContainerRef.current = slideContainer;
      const zoom = slideContainer
        ? parseFloat(slideContainer.getAttribute('data-slide-zoom') || '1')
        : 1;
      const { width, height } = getElementPixelSize(firstEl, zoom);
      if (allText) {
        setLocalStyles({
          fontSize: computedStyle.fontSize,
          fontWeight: computedStyle.fontWeight,
          fontStyle: computedStyle.fontStyle,
          textDecoration: computedStyle.textDecorationLine,
          color: computedStyle.color,
          backgroundColor: firstEl.style.backgroundColor || computedStyle.backgroundColor,
          fontFamily: computedStyle.fontFamily,
          textAlign: firstEl.style.textAlign || computedStyle.textAlign,
          width,
          height,
          borderRadius: firstEl.style.borderRadius || computedStyle.borderRadius,
          boxShadow:
            firstEl.style.boxShadow ||
            (computedStyle.boxShadow !== 'none' ? computedStyle.boxShadow : ''),
          backdropFilter:
            firstEl.style.backdropFilter ||
            (computedStyle.backdropFilter !== 'none' ? computedStyle.backdropFilter : ''),
          border:
            firstEl.style.border ||
            (computedStyle.borderStyle !== 'none'
              ? `${computedStyle.borderWidth} ${computedStyle.borderStyle} ${computedStyle.borderColor}`
              : ''),
        });
      } else {
        setLocalStyles({
          width,
          height,
          borderRadius: firstEl.style.borderRadius || computedStyle.borderRadius,
          boxShadow:
            firstEl.style.boxShadow ||
            (computedStyle.boxShadow !== 'none' ? computedStyle.boxShadow : ''),
          backdropFilter:
            firstEl.style.backdropFilter ||
            (computedStyle.backdropFilter !== 'none' ? computedStyle.backdropFilter : ''),
          border:
            firstEl.style.border ||
            (computedStyle.borderStyle !== 'none'
              ? `${computedStyle.borderWidth} ${computedStyle.borderStyle} ${computedStyle.borderColor}`
              : ''),
          backgroundColor: firstEl.style.backgroundColor || computedStyle.backgroundColor,
        });
      }
      if (slideContainer && slideContent) {
        const containerRect = slideContent.getBoundingClientRect();
        const elementRect = firstEl.getBoundingClientRect();
        const left = (elementRect.left - containerRect.left) / zoom;
        const top = (elementRect.top - containerRect.top) / zoom;
        setPosition({ left, top });
        originalPositionRef.current = { left, top };
      }
    }
  }, [selectedElements]);
}
