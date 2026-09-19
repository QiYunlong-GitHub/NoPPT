import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { useSelection } from '../useSelection';

// ================================================================
// useSelection —— 行为锁定测试（characterization test）
//
// 背景：useSelection.ts（约 894 行）零覆盖，且是阶段 6 抽取子组件/纯函数的起点。
//       本文件先锁定「返回的处理器/状态表面」与几条关键纯行为，保证后续抽取
//       （保留函数名 / 不改行为）有回归护栏。
// ================================================================
afterEach(() => cleanup());

function noop() {}

function baseRef<T>(value: T) {
  return { current: value } as { current: T };
}

function makeSelectionParams(): any {
  return {
    slideContainerRef: baseRef<HTMLDivElement | null>(null),
    contentRef: baseRef<HTMLDivElement | null>(null),
    presentationZoom: 1,
    isTextEditing: false,
    editingElementRef: baseRef<HTMLElement | null>(null),
    isPasteMode: false,
    clipboardElements: [],
    isFormatBrushMode: false,
    formatBrushData: null,
    keyHeldRef: baseRef({ i: false, o: false }),
    keepAspectRatioRef: baseRef(false),
    hasUnsavedChangesRef: baseRef(false),
    contextMenu: null,
    setContextMenu: vi.fn(),
    setShowPropertyPanel: vi.fn(),
    setRightPanelTab: vi.fn(),
    setIsFormatBrushMode: vi.fn(),
    setFormatBrushData: vi.fn(),
    stopTextEditingRef: baseRef(noop),
    handlePasteAtPositionRef: baseRef(noop),
    handleFormatBrushApplyRef: baseRef(noop),
    findSelectableElement: vi.fn(() => null),
    isTextElement: vi.fn(() => false),
    normalizeWhitespaceTextNodes: vi.fn(),
    ensureElementIds: vi.fn(),
    saveSlideHtmlRef: baseRef(noop),
    markUnsaved: vi.fn(),
    clearClipboardRef: baseRef(noop),
  };
}

// 与 useSelection 末尾 return 的处理器/状态一一对应（抽取不得改名/删项）
const SELECTION_KEYS = [
  'selectedElements',
  'setSelectedElements',
  'selectedElementsRef',
  'selectedElementPathsRef',
  'isRestoringSelectionRef',
  'isSelectingRef',
  'selectionBox',
  'selectionStartRef',
  'resizeBox',
  'setResizeBox',
  'updateResizeBox',
  'guides',
  'saveAndRestoreSelectionForNewElements',
  'saveAndRestoreSelection',
  'cleanSelectedElements',
  'updateSelectedElements',
  'highlightElement',
  'commitAllSelectedTransforms',
  'getElementPath',
  'getElementByPath',
  'isSlideRootWrapper',
  'isTextContent',
  'isVisualContainer',
  'isLayoutContainer',
  'handleSlidePointerDown',
  'handleSlidePointerMove',
  'handleSlidePointerUp',
  'toggleElementSelection',
  'addToSelection',
  'clearSelection',
];

function renderSelectionHook(p: any) {
  const holder: { api: any } = { api: null };
  function Comp() {
    holder.api = useSelection(p as any);
    return null;
  }
  render(<Comp />);
  return holder;
}

describe('useSelection（行为锁定）', () => {
  it('返回稳定的选择器/状态/处理器表面', () => {
    const holder = renderSelectionHook(makeSelectionParams());
    for (const key of SELECTION_KEYS) {
      expect(holder.api).toHaveProperty(key);
    }
  });

  it('clearSelection 清空选中数组并隐藏属性面板', () => {
    const p = makeSelectionParams();
    const holder = renderSelectionHook(p);
    act(() => {
      holder.api.clearSelection();
    });
    expect(holder.api.selectedElements).toEqual([]);
    expect(p.setShowPropertyPanel).toHaveBeenCalledWith(false);
  });

  it('clearSelection 存在未保存改动时触发保存', () => {
    const p = makeSelectionParams();
    p.hasUnsavedChangesRef = baseRef(true);
    const save = vi.fn();
    p.saveSlideHtmlRef = baseRef(save);
    const holder = renderSelectionHook(p);
    act(() => {
      holder.api.clearSelection();
    });
    expect(save).toHaveBeenCalled();
  });

  it('getElementPath / getElementByPath 在真实容器中可往返', () => {
    const container = document.createElement('div');
    const inner = document.createElement('div');
    inner.setAttribute('data-slide-content', 'true');
    const child = document.createElement('div');
    child.setAttribute('data-noppt-id', 'e1');
    inner.appendChild(child);
    container.appendChild(inner);
    document.body.appendChild(container);

    const p = makeSelectionParams();
    p.slideContainerRef = baseRef(container);
    const holder = renderSelectionHook(p);

    const path = holder.api.getElementPath(child);
    expect(typeof path).toBe('string');
    expect(path.length).toBeGreaterThan(0);
    expect(holder.api.getElementByPath(path)).toBe(child);

    container.remove();
  });

  it('cleanSelectedElements 过滤未连接元素', () => {
    const container = document.createElement('div');
    const inner = document.createElement('div');
    inner.setAttribute('data-slide-content', 'true');
    container.appendChild(inner);
    document.body.appendChild(container);

    const connected = document.createElement('div');
    inner.appendChild(connected);
    const orphan = document.createElement('div'); // 未挂载到文档，isConnected=false

    const p = makeSelectionParams();
    p.slideContainerRef = baseRef(container);
    const holder = renderSelectionHook(p);

    const result = holder.api.cleanSelectedElements([connected, orphan]);
    expect(result).toContain(connected);
    expect(result).not.toContain(orphan);

    container.remove();
  });
});
