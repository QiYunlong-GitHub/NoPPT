// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const { loadPresentation, storeState } = vi.hoisted(() => {
  const loadPresentation = vi.fn();
  return {
    loadPresentation,
    storeState: {
      loadPresentation,
      presentation: {
        id: 'p1',
        title: 'Preview',
        slides: [
          { id: 's1', title: 'One', html: '<div>one</div>' },
          { id: 's2', title: 'Two', html: '<div>two</div>' },
        ],
        width: 1280,
        height: 720,
        transition: 'none',
      },
    },
  };
});

vi.mock('@/stores/presentation', () => ({
  usePresentationStore: (selector: (state: typeof storeState) => unknown) => selector(storeState),
}));

import PreviewPage from './PreviewPage';

describe('PreviewPage controls', () => {
  it('exposes names and button types for navigation controls', () => {
    render(
      <MemoryRouter initialEntries={['/preview/p1']}>
        <Routes>
          <Route path="/preview/:id" element={<PreviewPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(loadPresentation).toHaveBeenCalledWith('p1');
    expect(screen.getByRole('button', { name: '上一页' })).toHaveAttribute('type', 'button');
    expect(screen.getByRole('button', { name: '下一页' })).toHaveAttribute('type', 'button');
    expect(screen.getByRole('button', { name: '关闭预览' })).toHaveAttribute('type', 'button');
    expect(screen.getByRole('button', { name: '第 1 页' })).toHaveAttribute('type', 'button');
    expect(screen.getByRole('button', { name: '第 2 页' })).toHaveAttribute('type', 'button');
  });
});
