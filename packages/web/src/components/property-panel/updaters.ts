import type { Dispatch, MutableRefObject, SetStateAction } from 'react';

export interface PropertyUpdaterDeps {
  selectedElements: HTMLElement[];
  setLocalStyles: Dispatch<SetStateAction<Record<string, string>>>;
  setPosition: Dispatch<SetStateAction<{ left: number; top: number }>>;
  originalPositionRef: MutableRefObject<{ left: number; top: number }>;
  onChange: () => void;
  onMove?: (direction: 'up' | 'down' | 'left' | 'right', amount: number) => void;
  keepAspectRatio?: boolean;
  isMultiSelect: boolean;
  aspectRatio: number;
  position: { left: number; top: number };
  localStyles: Record<string, string>;
}

export interface PropertyUpdaters {
  updateStyle: (property: string, value: string) => void;
  adjustFontSize: (delta: number) => void;
  adjustFontSizeTo: (size: number) => void;
  adjustFontFamilyTo: (fontFamily: string) => void;
  adjustPosition: (direction: 'up' | 'down' | 'left' | 'right', amount?: number) => void;
  updateWidth: (value: number) => void;
  updateHeight: (value: number) => void;
  updatePositionX: (value: number) => void;
  updatePositionY: (value: number) => void;
  handlePositionXBlur: () => void;
  handlePositionYBlur: () => void;
  handleWidthBlur: () => void;
  handleHeightBlur: () => void;
}

// 尺寸 / 位置 / 字号 / 字族等样式更新函数簇。
// 原位于 PropertyPanel.tsx 主组件内（约 454–650 行），此处逐字迁移为纯函数工厂，
// 改为显式接收「选中元素集合 + 状态更新器 + 相关状态」参数，避免依赖组件闭包，
// 便于后续 JSX 区块组件复用。行为与原实现完全一致。
export function createPropertyUpdaters(deps: PropertyUpdaterDeps): PropertyUpdaters {
  const {
    selectedElements,
    setLocalStyles,
    setPosition,
    originalPositionRef,
    onChange,
    onMove,
    keepAspectRatio,
    isMultiSelect,
    aspectRatio,
    position,
    localStyles,
  } = deps;

  const updateStyle = (property: string, value: string) => {
    if (!selectedElements || selectedElements.length === 0) return;
    selectedElements.forEach((element) => {
      (element.style as any)[property] = value;
    });
    setLocalStyles((prev) => ({ ...prev, [property]: value }));
    onChange();
  };

  const adjustFontSize = (delta: number) => {
    if (!selectedElements || selectedElements.length === 0) return;
    selectedElements.forEach((element) => {
      const computedStyle = window.getComputedStyle(element);
      const currentSize = parseFloat(computedStyle.fontSize);
      const newSize = Math.max(8, Math.min(200, currentSize + delta));
      element.style.fontSize = `${newSize}px`;
    });
    const firstEl = selectedElements[0];
    const computedStyle = window.getComputedStyle(firstEl);
    const currentSize = parseFloat(computedStyle.fontSize);
    const newSize = Math.max(8, Math.min(200, currentSize + delta));
    setLocalStyles((prev) => ({ ...prev, fontSize: `${newSize}px` }));
    onChange();
  };

  const adjustFontSizeTo = (size: number) => {
    if (!selectedElements || selectedElements.length === 0) return;
    const newSize = Math.max(8, Math.min(200, size));
    selectedElements.forEach((element) => {
      element.style.fontSize = `${newSize}px`;
    });
    setLocalStyles((prev) => ({ ...prev, fontSize: `${newSize}px` }));
    onChange();
  };

  const adjustFontFamilyTo = (fontFamily: string) => {
    if (!selectedElements || selectedElements.length === 0) return;
    selectedElements.forEach((element) => {
      element.style.fontFamily = fontFamily;
    });
    setLocalStyles((prev) => ({ ...prev, fontFamily }));
    onChange();
  };

  const adjustPosition = (direction: 'up' | 'down' | 'left' | 'right', amount: number = 5) => {
    if (onMove) {
      onMove(direction, amount);
    }
  };

  const updateWidth = (value: number) => {
    if (!selectedElements || selectedElements.length === 0) return;
    const newWidth = value;
    selectedElements.forEach((element) => {
      const isGroup = element.getAttribute('data-element-type') === 'group';
      const contentWrapper = element.querySelector('.noppt-group-content') as HTMLElement | null;
      element.style.width = `${newWidth}px`;
      element.style.maxWidth = 'none';
      if (keepAspectRatio && !isMultiSelect) {
        const newHeight = newWidth / aspectRatio;
        element.style.height = `${newHeight}px`;
        element.style.maxHeight = 'none';
        if (isGroup && contentWrapper) {
          const initialScaleX = parseFloat(element.getAttribute('data-group-scale-x') || '1');
          const initialScaleY = parseFloat(element.getAttribute('data-group-scale-y') || '1');
          const startWidth = element.offsetWidth;
          const startHeight = element.offsetHeight;
          const ratioX = newWidth / startWidth;
          const ratioY = newHeight / startHeight;
          const newScaleX = initialScaleX * ratioX;
          const newScaleY = initialScaleY * ratioY;
          contentWrapper.style.transform = `scale(${newScaleX}, ${newScaleY})`;
          element.setAttribute('data-group-scale-x', String(newScaleX));
          element.setAttribute('data-group-scale-y', String(newScaleY));
        }
      } else if (isGroup && contentWrapper) {
        const initialScaleX = parseFloat(element.getAttribute('data-group-scale-x') || '1');
        const startWidth = element.offsetWidth;
        const ratioX = newWidth / startWidth;
        const newScaleX = initialScaleX * ratioX;
        contentWrapper.style.transform = `scale(${newScaleX}, ${parseFloat(element.getAttribute('data-group-scale-y') || '1')})`;
        element.setAttribute('data-group-scale-x', String(newScaleX));
      }
    });
    setLocalStyles((prev) => {
      const updated: Record<string, string> = { ...prev, width: `${newWidth}px` };
      if (keepAspectRatio && !isMultiSelect) {
        updated.height = `${newWidth / aspectRatio}px`;
      }
      return updated;
    });
    onChange();
  };

  const updateHeight = (value: number) => {
    if (!selectedElements || selectedElements.length === 0) return;
    const newHeight = value;
    selectedElements.forEach((element) => {
      const isGroup = element.getAttribute('data-element-type') === 'group';
      const contentWrapper = element.querySelector('.noppt-group-content') as HTMLElement | null;
      element.style.height = `${newHeight}px`;
      element.style.maxHeight = 'none';
      if (keepAspectRatio && !isMultiSelect) {
        const newWidth = newHeight * aspectRatio;
        element.style.width = `${newWidth}px`;
        element.style.maxWidth = 'none';
        if (isGroup && contentWrapper) {
          const initialScaleX = parseFloat(element.getAttribute('data-group-scale-x') || '1');
          const initialScaleY = parseFloat(element.getAttribute('data-group-scale-y') || '1');
          const startWidth = element.offsetWidth;
          const startHeight = element.offsetHeight;
          const ratioX = newWidth / startWidth;
          const ratioY = newHeight / startHeight;
          const newScaleX = initialScaleX * ratioX;
          const newScaleY = initialScaleY * ratioY;
          contentWrapper.style.transform = `scale(${newScaleX}, ${newScaleY})`;
          element.setAttribute('data-group-scale-x', String(newScaleX));
          element.setAttribute('data-group-scale-y', String(newScaleY));
        }
      } else if (isGroup && contentWrapper) {
        const initialScaleY = parseFloat(element.getAttribute('data-group-scale-y') || '1');
        const startHeight = element.offsetHeight;
        const ratioY = newHeight / startHeight;
        const newScaleY = initialScaleY * ratioY;
        contentWrapper.style.transform = `scale(${parseFloat(element.getAttribute('data-group-scale-x') || '1')}, ${newScaleY})`;
        element.setAttribute('data-group-scale-y', String(newScaleY));
      }
    });
    setLocalStyles((prev) => {
      const updated: Record<string, string> = { ...prev, height: `${newHeight}px` };
      if (keepAspectRatio && !isMultiSelect) {
        updated.width = `${newHeight * aspectRatio}px`;
      }
      return updated;
    });
    onChange();
  };

  const updatePositionX = (value: number) => {
    if (!selectedElements || selectedElements.length === 0) return;
    const deltaX = value - position.left;
    selectedElements.forEach((element) => {
      let currentTx = 0;
      let currentTy = 0;
      const transform = element.style.transform;
      if (transform && transform.includes('translate')) {
        const match = transform.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/);
        if (match) {
          currentTx = parseFloat(match[1]);
          currentTy = parseFloat(match[2]);
        }
      }
      element.style.transform = `translate(${currentTx + deltaX}px, ${currentTy}px)`;
    });
    setPosition((prev) => ({ ...prev, left: value }));
    originalPositionRef.current.left = value;
    onChange();
  };

  const updatePositionY = (value: number) => {
    if (!selectedElements || selectedElements.length === 0) return;
    const deltaY = value - position.top;
    selectedElements.forEach((element) => {
      let currentTx = 0;
      let currentTy = 0;
      const transform = element.style.transform;
      if (transform && transform.includes('translate')) {
        const match = transform.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/);
        if (match) {
          currentTx = parseFloat(match[1]);
          currentTy = parseFloat(match[2]);
        }
      }
      element.style.transform = `translate(${currentTx}px, ${currentTy + deltaY}px)`;
    });
    setPosition((prev) => ({ ...prev, top: value }));
    originalPositionRef.current.top = value;
    onChange();
  };

  const handlePositionXBlur = () => {
    if (position.left < 0) {
      updatePositionX(0);
    }
  };

  const handlePositionYBlur = () => {
    if (position.top < 0) {
      updatePositionY(0);
    }
  };

  const handleWidthBlur = () => {
    const w = parseFloat(localStyles.width || '0');
    if (w < 10) {
      updateWidth(10);
    }
  };

  const handleHeightBlur = () => {
    const h = parseFloat(localStyles.height || '0');
    if (h < 10) {
      updateHeight(10);
    }
  };

  return {
    updateStyle,
    adjustFontSize,
    adjustFontSizeTo,
    adjustFontFamilyTo,
    adjustPosition,
    updateWidth,
    updateHeight,
    updatePositionX,
    updatePositionY,
    handlePositionXBlur,
    handlePositionYBlur,
    handleWidthBlur,
    handleHeightBlur,
  };
}
