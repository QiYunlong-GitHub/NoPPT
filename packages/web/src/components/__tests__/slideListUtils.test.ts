import { describe, it, expect } from 'vitest';
import { getRangeSelection } from '../slideListUtils';

const slides = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];

describe('getRangeSelection（从 SlideListPanel shift 多选抽出）', () => {
  it('正向区间（lastIndex < index）含端点', () => {
    expect(getRangeSelection(slides, 1, 3)).toEqual(new Set(['b', 'c', 'd']));
  });

  it('反向区间（lastIndex > index）同样含端点', () => {
    expect(getRangeSelection(slides, 3, 1)).toEqual(new Set(['b', 'c', 'd']));
  });

  it('相同索引仅选中该页', () => {
    expect(getRangeSelection(slides, 2, 2)).toEqual(new Set(['c']));
  });

  it('从首頁到末页选中全部', () => {
    expect(getRangeSelection(slides, 0, 3)).toEqual(new Set(['a', 'b', 'c', 'd']));
  });
});
