// ================================================================
// SlideListPanel —— 行为锁定测试（characterization test）
//
// 背景：SlideListPanel（987 行）零覆盖。Phase 6 计划将其拆分为
//       子组件 + 纯函数（保留 action/selector 名、零行为变更）。
//       本文件先锁定「渲染页数 = 演示页数」与「点击条目选中对应页」
//       两条最基本行为，确保搬移不引发回归。
// ================================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import SlideListPanel from '../SlideListPanel';
import { I18nProvider } from '@/i18n/I18nProvider';
import { usePresentationStore } from '@/stores/presentation';

// jsdom 不实现 ResizeObserver，组件挂载时会用到，需打桩。
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverMock);

const uid = () => `s-${Math.random().toString(36).slice(2, 9)}`;

function makePresentation(slideCount = 2) {
  const slides = Array.from({ length: slideCount }, (_, i) => ({
    id: uid(),
    title: `页 ${i + 1}`,
    html: `<div data-noppt-page="${i + 1}">内容 ${i + 1}</div>`,
    notes: '',
    hidden: false,
    index: i,
    createdAt: 0,
    updatedAt: 0,
  }));
  return {
    id: `p-${uid()}`,
    title: '测试演示',
    description: '',
    author: '',
    slides,
    selectedSlideId: slides[0].id,
    zoom: 1,
    width: 1280,
    height: 720,
    transition: 'none',
    createdAt: 0,
    updatedAt: 0,
    version: 1,
    tags: [],
  } as any;
}

beforeEach(() => {
  cleanup();
  usePresentationStore.setState({
    presentation: null,
    isLoading: false,
    error: null,
    hasUnsavedChanges: false,
  } as any);
});

describe('SlideListPanel（行为锁定）', () => {
  it('渲染出与演示页数一致的幻灯片条目', () => {
    const p = makePresentation(3);
    usePresentationStore.getState().setPresentation(p, false, true);
    const { container } = render(
      <I18nProvider>
        <SlideListPanel />
      </I18nProvider>,
    );
    // 每个幻灯片条目为 draggable 的 div
    const items = container.querySelectorAll('[draggable="true"]');
    expect(items.length).toBe(3);
  });

  it('点击幻灯片条目选中对应页（selectedSlideId 更新）', () => {
    const p = makePresentation(3);
    usePresentationStore.getState().setPresentation(p, false, true);
    const { container } = render(
      <I18nProvider>
        <SlideListPanel />
      </I18nProvider>,
    );
    const items = container.querySelectorAll('[draggable="true"]');
    // 点击第二页
    fireEvent.click(items[1]);
    expect(usePresentationStore.getState().presentation?.selectedSlideId).toBe(p.slides[1].id);
  });
});
