import { describe, it, expect } from 'vitest';
import {
  getCollectiveBBox,
  highlightElement,
  commitElementTransform,
} from '../selection/element-utils';

// ================================================================
// selection/element-utils —— 行为锁定测试（characterization test）
//
// 背景：这三个零闭包依赖的纯函数从 useSelection.ts 外置而来，
//       是选区几何与高亮的基础。本文件锁定其外置后的实际行为。
// ================================================================

describe('getCollectiveBBox（行为锁定）', () => {
  it('空数组返回零矩形', () => {
    expect(getCollectiveBBox([])).toEqual({ left: 0, top: 0, width: 0, height: 0 });
  });

  it('单个矩形原样返回', () => {
    expect(getCollectiveBBox([{ left: 5, top: 6, width: 10, height: 20 }])).toEqual({
      left: 5,
      top: 6,
      width: 10,
      height: 20,
    });
  });

  it('多个矩形取并集包围盒', () => {
    const bbox = getCollectiveBBox([
      { left: 10, top: 10, width: 10, height: 10 }, // 右 20 下 20
      { left: 0, top: 5, width: 40, height: 5 }, // 右 40 下 10
    ]);
    expect(bbox).toEqual({ left: 0, top: 5, width: 40, height: 15 });
  });
});

describe('highlightElement（行为锁定）', () => {
  it('selected 为 true 时加上 noppt-selected', () => {
    const el = document.createElement('div');
    highlightElement(el, true);
    expect(el.classList.contains('noppt-selected')).toBe(true);
  });

  it('selected 为 false 时移除 noppt-selected', () => {
    const el = document.createElement('div');
    el.classList.add('noppt-selected');
    highlightElement(el, false);
    expect(el.classList.contains('noppt-selected')).toBe(false);
  });
});

describe('commitElementTransform（行为锁定）', () => {
  it('把 translate 合并进 left/top 并清除 translate', () => {
    const el = document.createElement('div');
    el.style.left = '10px';
    el.style.top = '20px';
    el.style.transform = 'translate(5px, 7px)';
    commitElementTransform(el);
    expect(el.style.left).toBe('15px');
    expect(el.style.top).toBe('27px');
    expect(el.style.transform).toBe('');
  });

  it('translate 为 0 时不改 left/top，但仍移除 translate', () => {
    const el = document.createElement('div');
    el.style.left = '3px';
    el.style.top = '4px';
    el.style.transform = 'translate(0px, 0px)';
    commitElementTransform(el);
    expect(el.style.left).toBe('3px');
    expect(el.style.top).toBe('4px');
    expect(el.style.transform).toBe('');
  });

  it('无 translate 时保持原样', () => {
    const el = document.createElement('div');
    el.style.left = '1px';
    el.style.top = '2px';
    el.style.transform = 'rotate(45deg)';
    commitElementTransform(el);
    expect(el.style.left).toBe('1px');
    expect(el.style.top).toBe('2px');
    expect(el.style.transform).toBe('rotate(45deg)');
  });
});
