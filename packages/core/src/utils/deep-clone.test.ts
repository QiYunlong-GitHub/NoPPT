import { describe, expect, it } from 'vitest';
import { deepClone } from './deep-clone';

describe('deepClone current contract', () => {
  it('returns primitives and functions unchanged', () => {
    const fn = () => 'ok';
    expect(deepClone(1)).toBe(1);
    expect(deepClone(null)).toBeNull();
    expect(deepClone(fn)).toBe(fn);
  });

  it('clones dates, arrays, and enumerable object data', () => {
    const source = {
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      values: [1, { label: 'nested' }],
    };
    const clone = deepClone(source);
    expect(clone).not.toBe(source);
    expect(clone.createdAt).not.toBe(source.createdAt);
    expect(clone.createdAt.getTime()).toBe(source.createdAt.getTime());
    expect(clone.values).not.toBe(source.values);
    expect(clone.values[1]).not.toBe(source.values[1]);
    expect(clone.values[1]).toEqual({ label: 'nested' });
  });

  it('preserves sparse array holes under the current map-based behavior', () => {
    const source = [] as Array<string | undefined>;
    source[1] = 'value';
    const clone = deepClone(source);
    expect(0 in clone).toBe(false);
    expect(clone[1]).toBe('value');
  });

  it('documents that circular objects are outside the current contract', () => {
    const source: { self?: unknown } = {};
    source.self = source;
    expect(() => deepClone(source)).toThrow(RangeError);
  });
});
