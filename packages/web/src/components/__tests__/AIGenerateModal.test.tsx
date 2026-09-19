// ================================================================
// AIGenerateModal —— 行为锁定测试（characterization test）
//
// 背景：packages/web 目前仅 3 个测试文件，AIGenerateModal（2447 行，
//       55 个 useState + 约 1200 行巨型 JSX）与 PropertyPanel 零覆盖。
//       Phase 5 计划收敛状态与拆分 JSX，本文件先锁定「可挂载 / 可关闭」
//       这两条最基础的行为，作为拆分后的回归底线。
//
// 说明：组件依赖 zustand 全局 store（无需 Provider），i18n 走 `t()` 直接调用，
//       因此可在 jsdom 下直接渲染。
// ================================================================
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import AIGenerateModal from '../AIGenerateModal';

afterEach(() => cleanup());

describe('AIGenerateModal（行为锁定）', () => {
  it('open=false 时不渲染任何内容', () => {
    const { container } = render(<AIGenerateModal open={false} onClose={vi.fn()} />);
    expect(container.innerHTML).toBe('');
  });

  it('open=true 时渲染弹窗，并展示标题「AI 生成演示文稿」', () => {
    render(<AIGenerateModal open onClose={vi.fn()} />);
    expect(screen.getByText('AI 生成演示文稿')).toBeTruthy();
  });

  it('open=true 时展示副标题「用一句话生成完整演示」', () => {
    render(<AIGenerateModal open onClose={vi.fn()} />);
    expect(screen.getByText('用一句话生成完整演示')).toBeTruthy();
  });

  it('渲染出的根节点非空（弹窗主体已挂载）', () => {
    const { container } = render(<AIGenerateModal open onClose={vi.fn()} />);
    expect(container.firstChild).toBeTruthy();
  });
});
