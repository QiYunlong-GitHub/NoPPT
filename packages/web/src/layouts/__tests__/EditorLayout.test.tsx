// ================================================================
// EditorLayout —— 行为锁定测试（characterization / 回归基线）
//
// 背景：EditorLayout.tsx（~1984 行）零覆盖，含大量 useRef / useEffect /
//       全局事件监听与深度 ref 耦合的画布选区区。本次仅下沉「展示型区块」
//       （顶部工具栏 / 右键上下文菜单 / 图标样式菜单 / 演示列表弹窗），
//       画布选区区留父组件。
//       本文件只验证 EditorLayout 自身渲染（工具栏/菜单/弹窗），把重兄弟
//       组件（SlideListPanel / PropertyPanel / AIChatPanel / 两个 Overlay /
//       SelectionBreadcrumb）打桩隔离 jsdom 脆弱点，作为下沉回归底线。
// ================================================================
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider } from '@/i18n/I18nProvider';
import EditorLayout from '../EditorLayout';
import { usePresentationStore } from '@/stores/presentation';
import type { Presentation } from '@noppt/core';

// 隔离非本次范围的重组件，避免其 jsdom 依赖干扰基线稳定性
vi.mock('@/components/SlideListPanel', () => ({ default: () => null }));
vi.mock('@/components/AIChatPanel', () => ({ default: () => null }));
vi.mock('@/components/PropertyPanel', () => ({ default: () => null }));
vi.mock('@/components/SelectionOverlay', () => ({ SelectionOverlay: () => null }));
vi.mock('@/components/GuidesOverlay', () => ({ GuidesOverlay: () => null }));
vi.mock('@/components/SelectionBreadcrumb', () => ({ default: () => null }));

// EditorLayout 在 presentation 为空时直接 return null，必须注入最小演示数据才能渲染工具栏
const minimalPresentation: Presentation = {
  id: 'p1',
  title: 'Test Presentation',
  slides: [{ id: 's1', title: 'S1', html: '<div></div>', hidden: false, index: 0, createdAt: 0, updatedAt: 0 }],
  selectedSlideId: 's1',
  zoom: 1,
  width: 1280,
  height: 720,
  transition: 'none',
  createdAt: 0,
  updatedAt: 0,
  version: 1,
};

beforeAll(() => {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverMock);
  // 选中恢复等 effect 用到 requestAnimationFrame，置为 no-op 防止异步副作用
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  if (!window.matchMedia) {
    vi.stubGlobal('matchMedia', () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
    }));
  }
});

beforeEach(() => {
  usePresentationStore.setState({ presentation: minimalPresentation });
});

afterEach(() => {
  cleanup();
  usePresentationStore.setState({ presentation: null });
});

function renderEditor() {
  return render(
    <MemoryRouter>
      <I18nProvider>
        <EditorLayout />
      </I18nProvider>
    </MemoryRouter>,
  );
}

describe('EditorLayout（行为锁定 / 回归基线）', () => {
  it('完整挂载且不抛错', () => {
    const { container } = renderEditor();
    expect(container.firstChild).toBeTruthy();
  });

  it('顶部工具栏渲染关键按钮（图标按钮用 title 断言）', () => {
    const { getByTitle, getByText } = renderEditor();
    // 仅「演示」按钮有可见文本
    expect(getByText('演示')).toBeTruthy();
    expect(getByTitle(/保存/)).toBeTruthy();
    expect(getByTitle(/撤销/)).toBeTruthy();
    expect(getByTitle(/重做/)).toBeTruthy();
    expect(getByTitle(/导出/)).toBeTruthy();
    expect(getByTitle(/图标风格/)).toBeTruthy();
    expect(getByTitle(/插入图片/)).toBeTruthy();
  });

  it('初始不渲染演示列表弹窗与上下文菜单（仅工具栏标题按钮存在）', () => {
    const { queryByText, getByTitle } = renderEditor();
    // 工具栏「打开演示」按钮存在（title），但弹窗标题（可见文本）未出现
    expect(getByTitle(/打开演示/)).toBeTruthy();
    expect(queryByText('打开演示')).toBeNull();
    // 图标风格菜单默认收起
    expect(queryByText('全局应用到所有页')).toBeNull();
  });
});
