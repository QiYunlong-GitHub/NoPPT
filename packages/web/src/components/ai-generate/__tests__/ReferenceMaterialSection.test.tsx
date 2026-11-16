import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ReferenceMaterialSection } from '../ReferenceMaterialSection';

const baseProps = {
  showReference: true,
  setShowReference: vi.fn(),
  referenceText: '',
  referenceTruncated: false,
  referenceOriginalChars: 0,
  referenceInitial: '',
  updateReferenceText: vi.fn(),
  effectiveReferenceLimit: 20000,
  referenceOverLimit: false,
};

afterEach(() => cleanup());

describe('ReferenceMaterialSection · 主题色优先级明示', () => {
  it('存在参考素材时展示新的配色优先级，不再写「参考覆盖手动设置」', () => {
    render(<ReferenceMaterialSection {...baseProps} referenceText="权威素材" />);
    expect(screen.getByText(/配色优先级：配置界面选定的主题色/)).toBeTruthy();
    expect(screen.getByText(/全篇统一使用封面模板色系/)).toBeTruthy();
    expect(screen.queryByText(/分类参考主色 → 全局参考主色 → 手动设置/)).toBeNull();
  });

  it('无参考素材时不展示配色优先级提示', () => {
    render(<ReferenceMaterialSection {...baseProps} />);
    expect(screen.queryByText(/配色优先级：配置界面选定的主题色/)).toBeNull();
  });
});
