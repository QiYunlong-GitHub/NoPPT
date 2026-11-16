/**
 * 逐页内容密度自适应回归：稀疏页放大视觉块、稠密页收紧间距，
 * 且生产链路（planToDeck）必须把裁决结果写进 layoutParams。
 */

import { describe, expect, it } from 'vitest';
import type { PresentationPlan, SlidePlan } from '../../../../types';
import {
  DECK_BODY_RECT,
  DEFAULT_DECK_LAYOUT_CONTEXT,
  type DeckLayoutContext,
} from '../layout-templates';
import { planToDeck } from '../plan-to-deck';
import {
  densityGap,
  fillRowRects,
  measureContentVolume,
  resolveContentDensity,
} from '../content-density';

const SPARSE: SlidePlan = {
  pageType: 'content-no-image',
  title: '稀疏页',
  keyPoints: ['海温偏高', '信风减弱', '降水增多'],
  needsImage: false,
};
const DENSE: SlidePlan = {
  pageType: 'content-no-image',
  title: '稠密页',
  keyPoints: Array.from({ length: 6 }, (_, i) =>
    `第${i + 1}项观测结论：海表温度距平持续偏高，同时伴随环流调整与降水异常，需要结合多年资料判断。`),
  needsImage: false,
};

function context(overrides: Partial<DeckLayoutContext> = {}): DeckLayoutContext {
  return { ...DEFAULT_DECK_LAYOUT_CONTEXT, ...overrides };
}

describe('逐页内容密度自适应', () => {
  it('内容量统计以 typed 字段与裸 keyPoints 的较大者为准', () => {
    expect(measureContentVolume(SPARSE)).toEqual({ units: 3, chars: 12 });
    const typed = measureContentVolume({
      ...SPARSE,
      cardItems: [
        { contentId: 'c1', title: '判定阈值', body: '海温距平连续五个月超过0.5℃即判定为事件' },
        { contentId: 'c2', title: '观测周期', body: '每隔2至7年出现一次，持续约9至12个月后消退' },
      ],
    });
    expect(typed.units).toBe(3);
    expect(typed.chars).toBeGreaterThan(12);
  });

  it('稀疏 → spacious，稠密 → compact；窄屏更紧、宽屏更松', () => {
    const standard = context();
    expect(resolveContentDensity(SPARSE, standard)).toBe('spacious');
    expect(resolveContentDensity(DENSE, standard)).toBe('compact');
    expect(resolveContentDensity(SPARSE, context({ viewportProfile: 'wide' }))).toBe('spacious');
    expect(resolveContentDensity(DENSE, context({ viewportProfile: 'narrow' }))).toBe('compact');
  });

  it('fillRowRects 铺满正文区、行不重叠、不越界（含 12 行与超大 gap）', () => {
    for (const count of [1, 3, 5, 8, 12]) {
      for (const gap of [0, 16, 24, 200]) {
        const rows = fillRowRects(DECK_BODY_RECT, count, gap);
        expect(rows).toHaveLength(count);
        expect(rows.every((row) => row.h >= 24)).toBe(true);
        expect(rows[rows.length - 1].y + rows[rows.length - 1].h)
          .toBeLessThanOrEqual(DECK_BODY_RECT.y + DECK_BODY_RECT.h);
        for (let i = 1; i < rows.length; i += 1) {
          expect(rows[i].y).toBeGreaterThanOrEqual(rows[i - 1].y + rows[i - 1].h);
        }
      }
    }
  });

  it('densityGap 随密度收紧并落在 8pt 网格内', () => {
    const compact = densityGap(context({ density: 'compact' }));
    const standard = densityGap(context({ density: 'standard' }));
    const spacious = densityGap(context({ density: 'spacious' }));
    expect(compact).toBeLessThan(standard);
    expect(standard).toBeLessThan(spacious);
    expect([compact, standard, spacious].every((value) => value % 8 === 0)).toBe(true);
  });

  it('planToDeck 把逐页密度写入 layoutParams（不再恒 standard）', () => {
    const plan: PresentationPlan = {
      title: '密度回归',
      primaryColor: '#EA580C',
      slides: [SPARSE, DENSE],
    };
    const deck = planToDeck(plan);
    expect(deck.slides[0].layoutParams?.density).toBe('spacious');
    expect(deck.slides[1].layoutParams?.density).toBe('compact');
  });
});
