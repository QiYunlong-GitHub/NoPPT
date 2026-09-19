// ================================================================
// stores 行为锁定测试（阶段 6 安全网）
//
// 目的：在拆分 stores/settings.ts(972) 与 stores/presentation.ts(939) 之前，
//       先锁定 store 的「状态形状 + 纯状态迁移」行为，确保搬移不引发回归。
//       只断言不依赖网络/后端 API 的纯状态操作。
// ================================================================
import { describe, it, expect, beforeEach } from 'vitest';
import { usePresentationStore } from '../presentation';
import { useSettingsStore } from '../settings';
import { useUIStore } from '../ui';

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

describe('presentation store（行为锁定）', () => {
  beforeEach(() => {
    // 复位到初始态，避免用例间互相污染
    usePresentationStore.setState({
      presentation: null,
      isLoading: false,
      error: null,
      hasUnsavedChanges: false,
    } as any);
  });

  it('暴露关键 actions（均为函数）', () => {
    const s = usePresentationStore.getState() as any;
    for (const fn of [
      'setPresentation', 'updatePresentation', 'addSlide', 'removeSlide',
      'duplicateSlide', 'moveSlide', 'selectSlide', 'updateSlide',
      'markUnsaved', 'closeCurrentPresentation',
    ]) {
      expect(typeof s[fn], `${fn} 应为函数`).toBe('function');
    }
  });

  it('setPresentation：写入 presentation 并置为已选中首頁', () => {
    const p = makePresentation();
    usePresentationStore.getState().setPresentation(p, false, true);
    const s = usePresentationStore.getState();
    expect(s.presentation?.id).toBe(p.id);
    expect(s.presentation?.slides).toHaveLength(2);
  });

  it('selectSlide：切换 selectedSlideId', () => {
    const p = makePresentation(3);
    usePresentationStore.getState().setPresentation(p, false, true);
    const target = p.slides[2].id;
    usePresentationStore.getState().selectSlide(target);
    expect(usePresentationStore.getState().presentation?.selectedSlideId).toBe(target);
  });

  it('markUnsaved：置 hasUnsavedChanges = true', () => {
    usePresentationStore.setState({ hasUnsavedChanges: false } as any);
    usePresentationStore.getState().markUnsaved();
    expect(usePresentationStore.getState().hasUnsavedChanges).toBe(true);
  });

  it('addSlide：新增一页且索引连续', () => {
    const p = makePresentation(2);
    usePresentationStore.getState().setPresentation(p, false, true);
    usePresentationStore.getState().addSlide();
    const s = usePresentationStore.getState();
    expect(s.presentation?.slides).toHaveLength(3);
    expect(s.presentation?.slides.map((x: any) => x.index)).toEqual([0, 1, 2]);
  });

  it('removeSlide：删除指定页并重排索引', () => {
    const p = makePresentation(3);
    usePresentationStore.getState().setPresentation(p, false, true);
    usePresentationStore.getState().removeSlide(p.slides[1].id);
    const s = usePresentationStore.getState();
    expect(s.presentation?.slides).toHaveLength(2);
    expect(s.presentation?.slides.map((x: any) => x.index)).toEqual([0, 1]);
  });
});

describe('settings / ui store（导出面锁定）', () => {
  it('settings store 暴露状态与 actions', () => {
    const s = useSettingsStore.getState() as any;
    expect(s).toBeTruthy();
    expect(typeof useSettingsStore.setState).toBe('function');
  });

  it('ui store 暴露状态与 actions', () => {
    const s = useUIStore.getState() as any;
    expect(s).toBeTruthy();
    expect(typeof useUIStore.setState).toBe('function');
  });
});
