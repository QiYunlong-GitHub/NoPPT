import { describe, it, expect } from 'vitest';
import {
  sanitizePresentationHtml,
  reconstructPresentation,
  getDefaultChatMessages,
  type HistoryEntry,
} from '../presentation-utils';

// ================================================================
// presentation-utils —— 行为锁定测试（characterization test）
//
// 背景：这三个纯函数与 HistoryEntry 类型从 stores/presentation.ts
//       外置而来，是 store 拆分（阶段 6）的第一步。本文件锁定其
//       外置后的实际行为，作为后续继续切分 store 的回归护栏。
// ================================================================

function makePresentation(slideCount = 2) {
  const slides = Array.from({ length: slideCount }, (_, i) => ({
    id: `s-${i}`,
    title: `页 ${i + 1}`,
    html: `<div data-noppt-page="${i + 1}">内容 ${i + 1}</div>`,
    notes: '',
    hidden: false,
    index: i,
    createdAt: 0,
    updatedAt: 0,
  }));
  return {
    id: 'p-1',
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

describe('sanitizePresentationHtml（行为锁定）', () => {
  it('清理各页 HTML 中的 script 标签，保留正文文本', () => {
    const p = makePresentation(1);
    p.slides[0].html = '<div>正文</div><script>alert(1)</script>';
    const out = sanitizePresentationHtml(p);
    expect(out.slides[0].html).not.toContain('<script');
    expect(out.slides[0].html).toContain('正文');
  });

  it('保持演示结构与页数不变', () => {
    const p = makePresentation(3);
    const out = sanitizePresentationHtml(p);
    expect(out.id).toBe(p.id);
    expect(out.slides).toHaveLength(3);
  });
});

describe('reconstructPresentation（行为锁定）', () => {
  it('从 full 快照 + slide 增量重建演示', () => {
    const base = makePresentation(2);
    const history: HistoryEntry[] = [
      { type: 'full', presentation: base },
      { type: 'slide', slideId: base.slides[0].id, html: '<div>已更新</div>' },
    ];
    const result = reconstructPresentation(history, 1);
    expect(result).not.toBeNull();
    expect(result!.slides[0].html).toBe('<div>已更新</div>');
    // 未被增量覆盖的页保持快照原值
    expect(result!.slides[1].html).toBe(base.slides[1].html);
  });

  it('无 full 快照时返回 null', () => {
    const history: HistoryEntry[] = [
      { type: 'slide', slideId: 's-0', html: '<div>x</div>' },
    ];
    expect(reconstructPresentation(history, 0)).toBeNull();
  });

  it('深拷贝快照，修改结果不影响历史条目', () => {
    const base = makePresentation(1);
    const history: HistoryEntry[] = [{ type: 'full', presentation: base }];
    const result = reconstructPresentation(history, 0)!;
    result.slides[0].html = '<div>被改</div>';
    expect((history[0] as any).presentation.slides[0].html).not.toBe('<div>被改</div>');
  });
});

describe('getDefaultChatMessages（行为锁定）', () => {
  it('返回单条 assistant 欢迎消息，scope 为 current', () => {
    const msgs = getDefaultChatMessages();
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe('assistant');
    expect(msgs[0].scope).toBe('current');
    expect(typeof msgs[0].content).toBe('string');
    expect(msgs[0].content.length).toBeGreaterThan(0);
  });

  it('每次调用返回等價的新数组（不共享引用）', () => {
    const a = getDefaultChatMessages();
    const b = getDefaultChatMessages();
    expect(a).not.toBe(b);
    expect(a[0].content).toBe(b[0].content);
  });
});
