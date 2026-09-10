import { describe, expect, it } from 'vitest';
import { DEFAULT_SLIDE_COUNT, referenceTextLimit } from './referenceTextLimit';

/** 与后端 draft-store.referenceTextLimit 同一公式：每页 800 字，3000~20000 封顶。 */
describe('referenceTextLimit', () => {
  it('按页数线性增长', () => {
    expect(referenceTextLimit(8)).toBe(6400);
    expect(referenceTextLimit(10)).toBe(8000);
    expect(referenceTextLimit(20)).toBe(16000);
  });

  it('低于下限时抬到 3000', () => {
    expect(referenceTextLimit(1)).toBe(3000);
    expect(referenceTextLimit(3)).toBe(3000);
  });

  it('非正数页数视为缺省（按 8 页计算）', () => {
    expect(referenceTextLimit(0)).toBe(6400);
    expect(referenceTextLimit(-5)).toBe(6400);
  });

  it('高于上限时压到 20000', () => {
    expect(referenceTextLimit(40)).toBe(20000);
    expect(referenceTextLimit(100)).toBe(20000);
  });

  it('缺省/非法页数按默认 8 页计算', () => {
    expect(referenceTextLimit()).toBe(6400);
    expect(referenceTextLimit(undefined)).toBe(6400);
    expect(referenceTextLimit(Number.NaN)).toBe(6400);
    expect(DEFAULT_SLIDE_COUNT).toBe(8);
  });
});
