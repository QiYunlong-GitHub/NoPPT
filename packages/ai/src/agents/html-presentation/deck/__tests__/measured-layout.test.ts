import { describe, expect, it } from 'vitest';
import { SLIDE_H_PX, SLIDE_W_PX } from '@noppt/core/deck';
import type { SlidePlan } from '../../../../types';
import {
  DECK_BODY_RECT,
  DEFAULT_DECK_LAYOUT_CONTEXT,
  allocateVerticalRegions,
  fitTextRect,
  layoutSlideNodes,
  measureText,
  resolveViewportProfile,
  type DeckLayoutContext,
} from '../layout-templates';

const LONG_TITLE = '厄尔尼诺：现象、影响与应对——从海表温度异常到全球气候风险的完整分析';

function context(viewportWidth: number, viewportHeight: number): DeckLayoutContext {
  return {
    ...DEFAULT_DECK_LAYOUT_CONTEXT,
    viewport: { width: viewportWidth, height: viewportHeight },
    viewportProfile: resolveViewportProfile(viewportWidth, viewportHeight),
  };
}

function textOf(node: { kind: string; paragraphs?: Array<{ runs: Array<{ text: string }> }> }): string {
  return node.kind === 'text'
    ? (node.paragraphs ?? []).flatMap((paragraph) => paragraph.runs.map((run) => run.text)).join('')
    : '';
}

function inLogicalCanvas(rect: { x: number; y: number; w: number; h: number }): boolean {
  return rect.x >= 0 && rect.y >= 0 && rect.x + rect.w <= SLIDE_W_PX && rect.y + rect.h <= SLIDE_H_PX;
}

describe('measured logical layout primitives', () => {
  it('measures mixed CJK/Latin text and reports wrapping without dropping text', () => {
    const result = measureText(LONG_TITLE, {
      fontSize: 92,
      maxWidth: 520,
      lineHeight: 1.12,
      fontFamily: 'system-ui',
    });

    expect(result.status).toBe('measured');
    expect(result.lines.join('')).toBe(LONG_TITLE);
    expect(result.lineCount).toBeGreaterThan(1);
    expect(result.height).toBeGreaterThan(result.lineHeight);
  });

  it('makes a long title fit by shrinking deterministically after wrapping', () => {
    const result = fitTextRect(LONG_TITLE, { x: 64, y: 220, w: 1152, h: 112 }, {
      fontSize: 92,
      minFontSize: 36,
      lineHeight: 1.12,
      fontFamily: 'system-ui',
    });

    expect(result.status).toBe('pass');
    expect(result.text).toBe(LONG_TITLE);
    expect(result.fontSize).toBeLessThan(92);
    expect(result.rect.y + result.rect.h).toBeLessThanOrEqual(SLIDE_H_PX);
    expect(result.lines.join('')).toBe(LONG_TITLE);
  });

  it('returns an explicit failure when measurement inputs are invalid', () => {
    const result = fitTextRect(LONG_TITLE, { x: 0, y: 0, w: 0, h: 0 }, { fontSize: 0 });

    expect(['fail', 'unverified']).toContain(result.status);
    expect(result.reason).toBeTruthy();
    expect(result.text).toBe(LONG_TITLE);
  });

  it('allocates non-overlapping vertical regions inside the logical body', () => {
    const result = allocateVerticalRegions(DECK_BODY_RECT, [
      { id: 'title', text: LONG_TITLE, fontSize: 50, minFontSize: 32, weight: 2 },
      { id: 'body', text: '海表温度异常升高，导致全球气候风险和极端天气事件增加。', fontSize: 24, weight: 3 },
      { id: 'summary', text: '保留完整事实信息并明确应对路径。', fontSize: 22, weight: 1 },
    ], { gap: 16, fontFamily: 'system-ui' });

    expect(result.status).toBe('pass');
    expect(result.regions).toHaveLength(3);
    for (const region of result.regions) {
      expect(inLogicalCanvas(region.rect)).toBe(true);
      expect(region.text).toBeTruthy();
    }
    expect(result.regions[0].rect.y + result.regions[0].rect.h + 16).toBeLessThanOrEqual(result.regions[1].rect.y);
    expect(result.regions[1].rect.y + result.regions[1].rect.h + 16).toBeLessThanOrEqual(result.regions[2].rect.y);
  });
});

describe('viewport profiles and measured page layouts', () => {
  it.each([
    [800, 600, 'narrow'],
    [1280, 720, 'standard'],
    [1600, 900, 'wide'],
  ] as const)('resolves %sx%s as the %s profile', (width, height, expected) => {
    expect(resolveViewportProfile(width, height)).toBe(expected);
  });

  it.each([
    [800, 600],
    [1280, 720],
    [1600, 900],
  ] as const)('keeps a long cover title complete and in bounds at %sx%s', (width, height) => {
    const slide: SlidePlan = {
      pageType: 'cover',
      title: LONG_TITLE,
      keyPoints: ['海表温度异常升高', '全球气候风险增加', '需要协同应对'],
      needsImage: false,
    };
    const nodes = layoutSlideNodes(slide, context(width, height));
    const title = nodes.find((node) => node.role === 'title' && node.kind === 'text');

    expect(title).toBeDefined();
    expect(inLogicalCanvas(title!.rect)).toBe(true);
    expect(textOf(title!)).toBe(LONG_TITLE);
    expect(title!.kind === 'text' && title!.paragraphs[0]?.runs[0]?.text).toBe(LONG_TITLE);
  });

  it('uses measured heights for summary, cards, compare, and stats content', () => {
    const longBody = '完整策略说明需要保留在卡片中，并根据真实文本需求分配高度，不能依赖固定空白区域。';
    const plans: SlidePlan[] = [
      {
        pageType: 'summary', title: '总结', keyPoints: ['结论一', '结论二', '结论三'], needsImage: false,
        summaryItems: [
          { contentId: 's1', text: '结论一', role: 'point' },
          { contentId: 's2', text: '结论二', role: 'action' },
          { contentId: 's3', text: '结论三', role: 'takeaway' },
        ],
      },
      {
        pageType: 'content-cards', title: '策略', keyPoints: [longBody, longBody, longBody], needsImage: false,
        cardItems: [
          { contentId: 'c1', title: '策略一', body: longBody },
          { contentId: 'c2', title: '策略二', body: longBody },
          { contentId: 'c3', title: '策略三', body: longBody },
        ],
      },
      {
        pageType: 'content-compare', title: '对比', keyPoints: ['左一', '右一'], needsImage: false,
        comparisonItems: [
          { contentId: 'cmp1', text: '左侧完整说明', column: 'left', order: 0, bullet: true },
          { contentId: 'cmp2', text: '右侧完整说明', column: 'right', order: 1, bullet: true },
        ],
      },
      {
        pageType: 'content-stats-highlight', title: '指标', keyPoints: ['全球温度升高'], needsImage: false,
        metricItems: [{ kind: 'metric', contentId: 'm1', order: 0, label: '全球温度', value: '0.2°C' }],
        metricValues: [50],
      },
    ];

    for (const plan of plans) {
      const nodes = layoutSlideNodes(plan, context(800, 600));
      expect(nodes.length).toBeGreaterThan(1);
      expect(nodes.every((node) => inLogicalCanvas(node.rect))).toBe(true);
      const content = nodes.filter((node) => node.kind === 'text' && node.role !== 'title');
      expect(content.length).toBeGreaterThan(0);
      expect(content.every((node) => textOf(node).trim().length > 0)).toBe(true);
    }
  });
});
