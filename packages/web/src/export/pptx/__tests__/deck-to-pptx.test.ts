// pptxgenjs 在 jsdom 下加载会挂起，而 Node 环境可正常加载；本文件只做纯构造与
// 断言（不依赖 DOM），因此切到 node 环境运行。
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Deck, DeckSlide } from '@noppt/core/deck';
import { buildPptx, deckToPptxBlob } from '../deck-to-pptx';
import { resolveSlideNotes } from '../notes';
import { mixHex, toPptxFill } from '../attrs';
import { paragraphsToPptxText } from '../text';

function slide(overrides?: Partial<DeckSlide>): DeckSlide {
  return {
    id: 's1',
    pageType: 'content-cards',
    title: '标题页',
    notes: '这是备注',
    nodes: [
      {
        kind: 'text',
        rect: { x: 64, y: 48, w: 1152, h: 72 },
        paragraphs: [{ runs: [{ text: '主标题', bold: true, fontSize: 50, color: '2563EB' }] }],
        role: 'title',
      },
      {
        kind: 'shape',
        rect: { x: 64, y: 144, w: 560, h: 240 },
        shape: 'roundRect',
        fill: { type: 'solid', color: 'F9FAFB' },
        line: { color: 'E5E7EB', width: 1 },
      },
      {
        kind: 'table',
        rect: { x: 64, y: 400, w: 560, h: 200 },
        rows: [
          [{ text: '项目' }, { text: '数值' }],
          [{ text: '营收' }, { text: '1.2亿' }],
        ],
        header: true,
        colW: [280, 280],
      },
      {
        kind: 'chart',
        rect: { x: 656, y: 144, w: 560, h: 456 },
        chart: {
          kind: 'bar',
          categories: ['Q1', 'Q2', 'Q3'],
          series: [{ name: '营收', values: [10, 20, 30] }],
          showLegend: true,
          showValue: true,
        },
      },
    ],
    ...overrides,
  };
}

function deck(overrides?: Partial<Deck>): Deck {
  return {
    title: '季度汇报',
    slides: [slide()],
    master: {
      title: 'NOPPT_MASTER',
      background: { type: 'solid', color: 'FFFFFF' },
      margin: [48, 64, 48, 64],
      objects: [],
      placeholders: [
        { name: 'title', type: 'title', rect: { x: 64, y: 48, w: 1152, h: 72 } },
        { name: 'body', type: 'body', rect: { x: 64, y: 120, w: 1152, h: 552 } },
      ],
      slideNumber: { x: 1136, y: 640, w: 80, h: 32, align: 'right', color: '6B7280', fontSize: 14 },
    },
    theme: {
      primary: '2563EB',
      primaryDark: '1D4ED8',
      background: 'FFFFFF',
      text: '1F2937',
      textMuted: '6B7280',
    },
    meta: {
      title: '季度汇报',
      author: 'NoPPT',
      subject: '2026 Q1',
      keywords: '营收;增长',
      revision: '1.0',
    },
    source: 'plan',
    ...overrides,
  };
}

describe('deck-to-pptx', () => {
  it('buildPptx 渲染母版 / 文本 / 形状 / 表格 / 图表不抛错', async () => {
    const pptx = await buildPptx(deck());
    const slides = (pptx as unknown as { slides: unknown[] }).slides;
    expect(slides).toHaveLength(1);
  });

  it('元信息写入 PPTX core properties', async () => {
    const pptx = await buildPptx(deck());
    const p = pptx as unknown as Record<string, unknown>;
    expect(p.title).toBe('季度汇报');
    expect(p.author).toBe('NoPPT');
    expect(p.subject).toBe('2026 Q1');
    expect(p.revision).toBe('1.0');
  });

  it('版式固定为 LAYOUT_WIDE（16:9，与 1280x720 px 无损对应）', async () => {
    const pptx = await buildPptx(deck());
    expect((pptx as unknown as { layout: string }).layout).toBe('LAYOUT_WIDE');
  });

  it('多页 deck 页数与顺序一致', async () => {
    const pptx = await buildPptx(
      deck({ slides: [slide({ id: 'a' }), slide({ id: 'b' }), slide({ id: 'c' })] }),
    );
    expect((pptx as unknown as { slides: unknown[] }).slides).toHaveLength(3);
  });

  it('产出真实 Blob（体积 > 0）', async () => {
    const blob = await deckToPptxBlob(deck());
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
  });

  it('占位图片默认跳过，不产生无效 URL', async () => {
    const pptx = await buildPptx(
      deck({
        slides: [
          slide({
            nodes: [
              {
                kind: 'image',
                rect: { x: 0, y: 0, w: 200, h: 200 },
                src: 'noppt:image-placeholder',
                alt: '待补图',
              },
            ],
          }),
        ],
      }),
    );
    expect((pptx as unknown as { slides: unknown[] }).slides).toHaveLength(1);
  });

  it('脏数据（越界坐标 / 空节点 / 非法颜色）不崩', async () => {
    const pptx = await buildPptx(
      deck({
        slides: [
          {
            id: 'x',
            nodes: [
              {
                kind: 'text',
                rect: { x: -500, y: 9999, w: 99999, h: 99999 },
                paragraphs: [{ runs: [{ text: 'x', color: 'not-a-color' }] }],
              },
              { kind: 'shape', rect: { x: 0, y: 0, w: 10, h: 10 }, shape: 'notAShape' as never },
              {
                kind: 'chart',
                rect: { x: 0, y: 0, w: 10, h: 10 },
                chart: { kind: 'bar', series: [] },
              },
            ],
          },
        ],
      }),
    );
    expect((pptx as unknown as { slides: unknown[] }).slides).toHaveLength(1);
  });

  it('非法 deck 抛出明确错误', async () => {
    await expect(buildPptx(null as unknown as Deck)).rejects.toThrow();
    await expect(buildPptx({ slides: [] } as unknown as Deck)).rejects.toThrow();
  });

  it('进度回调按页触发', async () => {
    const seen: number[] = [];
    await buildPptx(deck({ slides: [slide({ id: 'a' }), slide({ id: 'b' })] }), {
      onProgress: (done) => seen.push(done),
    });
    expect(seen).toEqual([1, 2]);
  });

  it('pptxFactory 注入：测试不加载真实 pptxgenjs', async () => {
    const calls = {
      defineSlideMaster: 0,
      addSlide: 0,
      addText: 0,
      addShape: 0,
      addTable: 0,
      addChart: 0,
    };
    const stub = () => ({
      layout: '',
      defineSlideMaster: () => {
        calls.defineSlideMaster++;
      },
      addSlide: () => {
        calls.addSlide++;
        return {
          addText: () => {
            calls.addText++;
          },
          addShape: () => {
            calls.addShape++;
          },
          addTable: () => {
            calls.addTable++;
          },
          addChart: () => {
            calls.addChart++;
          },
          addImage: () => {},
          addNotes: () => {},
        };
      },
      write: async () => new Uint8Array(),
      writeFile: async () => 'x.pptx',
    });
    // 每页含 1 个文本/形状/表格/图表节点，2 页 → 各调用 2 次。
    const pptx = await buildPptx(deck({ slides: [slide(), slide()] }), { pptxFactory: stub });
    expect(calls.defineSlideMaster).toBe(1);
    expect(calls.addSlide).toBe(2);
    expect(calls.addText).toBe(2);
    expect(calls.addShape).toBe(2);
    expect(calls.addTable).toBe(2);
    expect(calls.addChart).toBe(2);
    expect(typeof pptx.writeFile).toBe('function');
  });
});

describe('notes', () => {
  it('slide.notes 优先于 deck notes', () => {
    expect(resolveSlideNotes('演讲者备注', 'deck 备注')).toBe('演讲者备注');
  });
  it('都没有备注时返回 null（不生成空备注页）', () => {
    expect(resolveSlideNotes(undefined, undefined)).toBeNull();
    expect(resolveSlideNotes('   ', '')).toBeNull();
  });
  it('超长备注被截断', () => {
    const long = 'x'.repeat(9000);
    const out = resolveSlideNotes(long)!;
    expect(out.length).toBeLessThanOrEqual(4000);
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('attrs', () => {
  it('渐变填充降级为纯色中点', () => {
    const fill = toPptxFill({
      type: 'gradient',
      gradient: {
        angle: 135,
        stops: [
          { color: '000000', offset: 0 },
          { color: 'FFFFFF', offset: 1 },
        ],
      },
    });
    expect(fill?.type).toBe('solid');
    expect(fill?.color).toBe('808080');
  });
  it('mixHex 边界与中点', () => {
    expect(mixHex('000000', 'FFFFFF', 0)).toBe('000000');
    expect(mixHex('000000', 'FFFFFF', 1)).toBe('FFFFFF');
    expect(mixHex('000000', 'FFFFFF', 0.5)).toBe('808080');
  });
});

describe('text', () => {
  it('多段落除最后一段外都带 breakLine', () => {
    const out = paragraphsToPptxText([
      { runs: [{ text: 'A' }] },
      { runs: [{ text: 'B' }] },
      { runs: [{ text: 'C' }] },
    ]);
    expect(out).toHaveLength(3);
    expect(out[0].options?.breakLine).toBe(true);
    expect(out[2].options?.breakLine).toBeUndefined();
  });
  it('justify 降级为 left（PptxGenJS 不支持 justify）', () => {
    const out = paragraphsToPptxText([{ runs: [{ text: 'A' }], align: 'justify' }]);
    expect(out[0].options?.align).toBe('left');
  });
});
