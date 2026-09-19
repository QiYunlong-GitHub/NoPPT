// EditorLayout 内联 slide 容器胶水 wrapper 外置（Phase 6 抽取，零行为变更）。
//
// 原组件把 6 个只做「slideContainerRef.current.querySelector(...) 后转发给
// @/utils/selection 纯函数」的薄包装内联在组件体内。此处改为工厂函数，
// 接收 slideContainerRef 并返回同名 wrapper；组件侧一次性解构回原名字，
// 所有调用面（含传给 useSelection 的 isTextElement / findSelectableElement）零改动。
import type { RefObject } from 'react';
import {
  wrapTextInVisualContainers as _wrapTextInVisualContainers,
  isTextElement as _isTextElement,
  findSelectableElement as _findSelectableElement,
  getSlideAppendTarget as _getSlideAppendTarget,
  normalizeWhitespaceTextNodes as _normalizeWhitespaceTextNodes,
  ensureElementIds as _ensureElementIds,
} from '@/utils/selection';

export interface EditorSlideWrappers {
  wrapTextInVisualContainers: () => void;
  normalizeWhitespaceTextNodes: () => void;
  ensureElementIds: () => void;
  isTextElement: (element: HTMLElement) => boolean;
  getSlideAppendTarget: (innerDiv: HTMLElement) => HTMLElement;
  findSelectableElement: (
    target: HTMLElement,
    mode?: 'inner' | 'outer' | 'deep' | 'parent',
  ) => HTMLElement | null;
}

const SLIDE_CONTENT_SELECTOR = '[data-slide-content="true"]';

export function createEditorSlideWrappers(
  slideContainerRef: RefObject<HTMLElement | null>,
): EditorSlideWrappers {
  const queryInnerDiv = (): HTMLElement | null =>
    slideContainerRef.current?.querySelector(SLIDE_CONTENT_SELECTOR) as HTMLElement | null;

  const wrapTextInVisualContainers = () => {
    _wrapTextInVisualContainers(queryInnerDiv());
  };
  const normalizeWhitespaceTextNodes = () => {
    _normalizeWhitespaceTextNodes(queryInnerDiv());
  };
  const ensureElementIds = () => {
    _ensureElementIds(queryInnerDiv());
  };
  const isTextElement = (element: HTMLElement): boolean => _isTextElement(element);
  const getSlideAppendTarget = (innerDiv: HTMLElement): HTMLElement =>
    _getSlideAppendTarget(innerDiv);
  const findSelectableElement = (
    target: HTMLElement,
    mode: 'inner' | 'outer' | 'deep' | 'parent' = 'inner',
  ): HTMLElement | null => _findSelectableElement(target, queryInnerDiv(), mode);

  return {
    wrapTextInVisualContainers,
    normalizeWhitespaceTextNodes,
    ensureElementIds,
    isTextElement,
    getSlideAppendTarget,
    findSelectableElement,
  };
}
