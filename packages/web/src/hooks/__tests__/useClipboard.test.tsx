import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { useClipboard } from '../useClipboard';

// ================================================================
// useClipboard —— 行为锁定测试（characterization test）
//
// 背景：useClipboard.ts（约 1805 行）零覆盖，是阶段 6 抽取子组件/纯函数的起点。
//       本文件先锁定「返回的处理器/状态表面」与几条可无副作用验证的纯行为，
//       保证后续抽取（保留函数名 / 不改行为）有回归护栏。
// ================================================================
afterEach(() => cleanup());

function noop() {}

function baseRef<T>(value: T) {
  return { current: value } as { current: T };
}

function makeClipboardParams(): any {
  return {
    currentSlide: null,
    presentation: null,
    selectedSlideId: null,
    slideContainerRef: baseRef<HTMLDivElement | null>(null),
    selectedElementsRef: baseRef<HTMLElement[]>([]),
    clipboardElements: [],
    setClipboardElements: vi.fn(),
    isPasteMode: false,
    setIsPasteMode: vi.fn(),
    clipboardSourceSlideId: null,
    setClipboardSourceSlideId: vi.fn(),
    tabIdRef: baseRef('tab-1'),
    setContextMenu: vi.fn(),
    setShowPropertyPanel: vi.fn(),
    setRightPanelTab: vi.fn(),
    setIsFormatBrushMode: vi.fn(),
    setFormatBrushData: vi.fn(),
    showToast: vi.fn(),
    saveSlideHtmlRef: baseRef(noop),
    updateSelectedElements: vi.fn((e: any[]) => e),
    highlightElement: vi.fn(),
    saveAndRestoreSelectionForNewElements: vi.fn(),
  };
}

// 与 useClipboard 末尾 return 的处理器/状态一一对应（抽取不得改名/删项）
const CLIPBOARD_KEYS = [
  'clipboardElements',
  'setClipboardElements',
  'isPasteMode',
  'setIsPasteMode',
  'clipboardSourceSlideId',
  'setClipboardSourceSlideId',
  'tabIdRef',
  'checkClipboard',
  'clearClipboard',
  'clearClipboardRef',
  'readElementsFromClipboard',
  'readElementsFromClipboardRef',
  'stripPastedIds',
  'pasteElementsFromData',
  'handleCopyElements',
  'handleCopyElementsRef',
  'handleCopySlideAsImage',
  'handlePasteAtPosition',
  'handlePasteAtPositionRef',
  'handlePasteWithOffset',
  'handlePasteFromClipboard',
  'handlePasteFromClipboardRef',
  'handlePasteEvent',
  'handlePasteEventRef',
  'handleCancelPaste',
  'handleCancelPasteRef',
  'handlePasteSlideAsImage',
  'handlePasteSlideAsImageRef',
  'handlePasteAsImage',
  'handlePasteText',
  'handlePasteTextRef',
  'handlePasteHtml',
  'handlePasteHtmlRef',
  'handlePasteImage',
  'handlePasteImageRef',
];

function renderClipboardHook(p: any) {
  const holder: { api: any } = { api: null };
  function Comp() {
    holder.api = useClipboard(p as any);
    return null;
  }
  render(<Comp />);
  return holder;
}

describe('useClipboard（行为锁定）', () => {
  it('返回稳定的处理器/状态表面', () => {
    const holder = renderClipboardHook(makeClipboardParams());
    for (const key of CLIPBOARD_KEYS) {
      expect(holder.api).toHaveProperty(key);
    }
  });

  it('stripPastedIds 移除根与后代的 data-noppt-id', () => {
    const root = document.createElement('div');
    root.setAttribute('data-noppt-id', 'root');
    const child = document.createElement('span');
    child.setAttribute('data-noppt-id', 'child');
    root.appendChild(child);

    const holder = renderClipboardHook(makeClipboardParams());
    act(() => {
      holder.api.stripPastedIds(root);
    });
    expect(root.hasAttribute('data-noppt-id')).toBe(false);
    expect(child.hasAttribute('data-noppt-id')).toBe(false);
  });

  it('clearClipboard 重置剪贴板状态（无 clipboard API 也不抛）', async () => {
    const origClipboard = (navigator as any).clipboard;
    Object.defineProperty(navigator, 'clipboard', {
      value: undefined,
      configurable: true,
    });

    const holder = renderClipboardHook(makeClipboardParams());
    await act(async () => {
      await holder.api.clearClipboard();
    });

    expect(holder.api.clipboardElements).toEqual([]);
    expect(holder.api.isPasteMode).toBe(false);
    expect(holder.api.clipboardSourceSlideId).toBeNull();

    Object.defineProperty(navigator, 'clipboard', {
      value: origClipboard,
      configurable: true,
    });
  });
});
