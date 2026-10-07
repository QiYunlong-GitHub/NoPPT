import { describe, expect, it } from 'vitest';
import {
  CHART_BACKENDS,
  DECK_CHART_KINDS,
  DECK_SHAPE_SVG_STRATEGY,
  DECK_SHAPE_TO_PPTX,
  PX_PER_INCH,
  SLIDE_H_IN,
  SLIDE_H_PX,
  SLIDE_W_IN,
  SLIDE_W_PX,
  clampToSlide,
  hasValueAxis,
  inToPx,
  isDeck,
  isDeckNode,
  isDeckShapeType,
  isSingleSeriesChart,
  normalizeColor,
  normalizeDeck,
  normalizeRect,
  pxToIn,
  rectToInch,
  snapRect8,
  splitH,
  splitV,
} from '../index';

describe('geometry', () => {
  it('1280x720 px 与 LAYOUT_WIDE 13.333x7.5 inch 无损对应', () => {
    expect(SLIDE_W_PX / PX_PER_INCH).toBeCloseTo(SLIDE_W_IN, 10);
    expect(SLIDE_H_PX / PX_PER_INCH).toBeCloseTo(SLIDE_H_IN, 10);
    expect(SLIDE_H_IN).toBe(7.5);
    expect(SLIDE_W_IN).toBeCloseTo(13.3333, 3);
  });

  it('px ↔ inch 往返无误差', () => {
    expect(inToPx(pxToIn(1280))).toBeCloseTo(1280, 6);
    expect(inToPx(pxToIn(720))).toBeCloseTo(720, 6);
    const r = rectToInch({ x: 96, y: 48, w: 640, h: 360 });
    expect(r).toEqual({ x: 1, y: 0.5, w: 6.6667, h: 3.75 });
  });

  it('clampToSlide 把越界矩形钳回画布', () => {
    expect(clampToSlide({ x: -20, y: -10, w: 2000, h: 100 })).toEqual({
      x: 0,
      y: 0,
      w: 1280,
      h: 100,
    });
  });

  it('splitH / splitV 按权重切分且不溢出', () => {
    const cols = splitH({ x: 0, y: 0, w: 1200, h: 600 }, [1, 1], 0);
    expect(cols).toHaveLength(2);
    expect(cols[0].w + cols[1].w).toBeCloseTo(1200, 6);

    const rows = splitV({ x: 0, y: 0, w: 1200, h: 600 }, [2, 1], 0);
    expect(rows[0].h).toBeCloseTo(400, 6);
    expect(rows[1].h).toBeCloseTo(200, 6);
  });

  it('snapRect8 对齐 8pt 网格', () => {
    expect(snapRect8({ x: 3, y: 5, w: 101, h: 99 })).toEqual({ x: 0, y: 8, w: 104, h: 96 });
  });
});

describe('chart-kinds', () => {
  it('每个图表类型都有 svg 与 pptx 双后端配置', () => {
    for (const kind of DECK_CHART_KINDS) {
      const b = CHART_BACKENDS[kind];
      expect(b, kind).toBeDefined();
      expect(typeof b.svg).toBe('string');
      expect(typeof b.pptx.type).toBe('string');
    }
  });

  it('饼图/环图无数值轴，柱图有', () => {
    expect(hasValueAxis('pie')).toBe(false);
    expect(hasValueAxis('donut')).toBe(false);
    expect(hasValueAxis('bar')).toBe(true);
    expect(isSingleSeriesChart('donut')).toBe(true);
    expect(isSingleSeriesChart('bar')).toBe(false);
  });

  it('堆叠语义被正确映射到 PptxGenJS barGrouping', () => {
    expect(CHART_BACKENDS.bar.pptx.barGrouping).toBe('clustered');
    expect(CHART_BACKENDS.barStacked.pptx.barGrouping).toBe('stacked');
    expect(CHART_BACKENDS.barStacked100.pptx.barGrouping).toBe('percentStacked');
    expect(CHART_BACKENDS.donut.pptx.holeSize).toBe(50);
    expect(CHART_BACKENDS.lineSmooth.pptx.lineSmooth).toBe(true);
  });
});

describe('shapes', () => {
  it('每个形状都有 pptx preset 映射与 svg 降级策略', () => {
    const keys = Object.keys(DECK_SHAPE_TO_PPTX);
    expect(keys.length).toBeGreaterThanOrEqual(40);
    for (const k of keys) {
      expect(DECK_SHAPE_TO_PPTX[k as keyof typeof DECK_SHAPE_TO_PPTX]).toBeTruthy();
      expect(DECK_SHAPE_SVG_STRATEGY[k as keyof typeof DECK_SHAPE_SVG_STRATEGY]).toBeTruthy();
    }
  });

  it('isDeckShapeType 识别合法形状名', () => {
    expect(isDeckShapeType('roundRect')).toBe(true);
    expect(isDeckShapeType('notAShape')).toBe(false);
    expect(isDeckShapeType(undefined)).toBe(false);
  });
});

describe('guards', () => {
  it('normalizeColor 归一化为 6 位无 # 大写 HEX', () => {
    expect(normalizeColor('#2563eb')).toBe('2563EB');
    expect(normalizeColor('2563eb')).toBe('2563EB');
    expect(normalizeColor('#abc')).toBe('AABBCC');
    expect(normalizeColor('rgb(37, 99, 235)')).toBe('2563EB');
    expect(normalizeColor('white')).toBe('FFFFFF');
    expect(normalizeColor(null, '111111')).toBe('111111');
    expect(normalizeColor('nonsense', '111111')).toBe('111111');
  });

  it('normalizeRect 钳制非法输入', () => {
    expect(normalizeRect(null)).toEqual({ x: 0, y: 0, w: 0, h: 0 });
    expect(normalizeRect({ x: -5, y: -5, w: 99999, h: 10 })).toEqual({
      x: 0,
      y: 0,
      w: 1280,
      h: 10,
    });
  });

  it('isDeckNode 校验 kind 与 rect', () => {
    expect(isDeckNode({ kind: 'text', rect: { x: 0, y: 0, w: 10, h: 10 } })).toBe(true);
    expect(isDeckNode({ kind: 'unknown', rect: { x: 0, y: 0, w: 10, h: 10 } })).toBe(false);
    expect(isDeckNode({ kind: 'text' })).toBe(false);
  });

  it('normalizeDeck 丢弃脏数据但保留可用 slide', () => {
    const deck = normalizeDeck({
      title: 'demo',
      slides: [
        {
          id: 's1',
          nodes: [{ kind: 'text', rect: { x: 0, y: 0, w: 100, h: 50 }, paragraphs: '标题' }],
        },
        { id: 's2', nodes: 'not-an-array' },
        null,
      ],
    });
    expect(deck).not.toBeNull();
    expect(deck!.slides).toHaveLength(1);
    expect(deck!.slides[0].nodes[0].kind).toBe('text');
    expect(isDeck(deck)).toBe(true);
  });

  it('normalizeDeck 拒绝非 deck 输入', () => {
    expect(normalizeDeck(null)).toBeNull();
    expect(normalizeDeck({ slides: [] })).toBeNull();
  });
});
