import { describe, it, expect } from 'vitest';
import { mapReferenceLayoutToBuiltin } from './reference-attribute-resolver';

describe('mapReferenceLayoutToBuiltin (FR-18 §18.2 · 1:1 映射)', () => {
  const CASES: Array<[string, string]> = [
    ['table-dominant', 'content-table'],
    ['comparison', 'content-compare'],
    ['flowchart', 'content-flowchart'],
    ['org-chart', 'content-org-chart'],
    ['timeline', 'content-timeline'],
    ['pyramid', 'content-pyramid'],
    ['matrix-four-quadrant', 'content-matrix'],
    ['card-grid', 'content-cards'],
    ['big-image-caption', 'content-image-top'],
    ['pure-text-list', 'content-no-image'],
    ['three-section', 'content-three-section'],
    ['text-left-image-right', 'content-image-right'],
    ['image-left-text-right', 'content-image-left'],
    ['fullscreen-quote', 'content-quote'],
  ];

  it.each(CASES)('映射 %s → %s', (ref, builtin) => {
    expect(mapReferenceLayoutToBuiltin(ref as any)).toBe(builtin);
  });

  it('返回类型均为扩展后的内置 SlidePageType（不丢信息）', () => {
    for (const [ref] of CASES) {
      const out = mapReferenceLayoutToBuiltin(ref as any);
      expect(typeof out).toBe('string');
      expect(out).not.toBe(ref); // 映射后是内置版式名，而非参考标签
    }
  });

  it('未知枚举 / undefined / null 回退语义最近内置 Layout 且不抛错（NFR-2 降级）', () => {
    expect(() => mapReferenceLayoutToBuiltin('some-future-layout' as any)).not.toThrow();
    expect(mapReferenceLayoutToBuiltin('some-future-layout' as any)).toBe('content-no-image');
    expect(mapReferenceLayoutToBuiltin(undefined)).toBeUndefined();
    expect(mapReferenceLayoutToBuiltin(null)).toBeUndefined();
  });
});
