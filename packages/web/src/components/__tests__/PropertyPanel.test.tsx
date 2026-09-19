// ================================================================
// PropertyPanel —— 行为锁定测试（characterization test）
//
// 背景：PropertyPanel（1948 行，含 140 行 useEffect + 约 1140 行 JSX）零覆盖。
//       Phase 5 计划抽出 useComputedStyleSync / updaters / sections，
//       本文件先锁定「无选中不渲染 / 有选中才渲染」这条最基本行为。
// ================================================================
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import PropertyPanel from '../PropertyPanel';

afterEach(() => cleanup());

/** 构造一个带 data-element-type 的选中元素，模拟画布上的选中态 */
function makeElement(type: string): HTMLElement {
  const el = document.createElement('div');
  el.setAttribute('data-element-type', type);
  el.style.fontSize = '16px';
  document.body.appendChild(el);
  return el;
}

const baseProps = {
  onClose: vi.fn(),
  onDelete: vi.fn(),
  onChange: vi.fn(),
} as any;

describe('PropertyPanel（行为锁定）', () => {
  it('无选中元素时不渲染（返回 null）', () => {
    const { container } = render(<PropertyPanel {...baseProps} selectedElements={[]} />);
    expect(container.innerHTML).toBe('');
  });

  it('有选中元素时渲染出面板主体', () => {
    const el = makeElement('text');
    const { container } = render(<PropertyPanel {...baseProps} selectedElements={[el]} />);
    expect(container.firstChild).toBeTruthy();
    el.remove();
  });
});
