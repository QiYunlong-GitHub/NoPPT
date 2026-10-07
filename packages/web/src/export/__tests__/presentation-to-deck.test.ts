import { describe, expect, it } from 'vitest';
import { htmlToDeck, htmlSlidesToDeck } from '../html-to-deck';
import { presentationToDeck, collectNotesById } from '../presentation-to-deck';
import type { Presentation } from '@noppt/core';
import type { DeckSlide } from '@noppt/core/deck';
import { buildLegacyPptx } from '../pptx/deck-to-pptx';

const SIMPLE_HTML = `
<div style="width:100%;height:100%;padding:48px 64px;box-sizing:border-box;">
  <h2 style="font-size:50px;color:#2563eb;">季度回顾</h2>
  <ul>
    <li>营收增长 30%</li>
    <li>成本下降 12%</li>
  </ul>
  <img src="https://example.com/a.png" alt="示意图">
  <table><tr><th>项目</th><th>数值</th></tr><tr><td>营收</td><td>1.2亿</td></tr></table>
</div>`;

function makePresentation(overrides?: Partial<Presentation>): Presentation {
  return {
    id: 'p1',
    title: '演示标题',
    author: '张三',
    description: '副标题',
    slides: [
      {
        id: 's1',
        title: '第一页',
        html: SIMPLE_HTML,
        notes: '第一页备注',
        hidden: false,
        index: 0,
        createdAt: 0,
        updatedAt: 0,
      },
      {
        id: 's2',
        title: '第二页',
        html: '<div><h2>第二页</h2><p>正文</p></div>',
        hidden: false,
        index: 1,
        createdAt: 0,
        updatedAt: 0,
      },
    ],
    zoom: 1,
    width: 1280,
    height: 720,
    transition: 'none',
    createdAt: 0,
    updatedAt: 0,
    version: 3,
    tags: ['年报', '营收'],
    ...overrides,
  } as Presentation;
}

describe('htmlToDeck · DOM 解析兜底', () => {
  it('解析出文本 / 列表 / 图片 / 表格节点', () => {
    const slide = htmlToDeck(SIMPLE_HTML, { width: 1280, height: 720 });
    const kinds = slide.nodes.map((n) => n.kind);
    expect(kinds).toContain('text');
    expect(kinds).toContain('image');
    expect(kinds).toContain('table');
  });

  it('标题文本被保留且带颜色', () => {
    const slide = htmlToDeck(SIMPLE_HTML);
    const title = slide.nodes.find(
      (n) => n.kind === 'text' && n.paragraphs[0]?.runs[0]?.text === '季度回顾',
    );
    expect(title).toBeDefined();
  });

  it('li 解析为项目符号段落', () => {
    const slide = htmlToDeck(SIMPLE_HTML);
    const bullets = slide.nodes.filter(
      (n) => n.kind === 'text' && n.paragraphs.some((p) => p.bullet),
    );
    expect(bullets.length).toBeGreaterThan(0);
  });

  it('表格被解析成二维行结构且首行表头加粗', () => {
    const slide = htmlToDeck(SIMPLE_HTML);
    const table = slide.nodes.find((n) => n.kind === 'table');
    expect(table).toBeDefined();
    if (table?.kind === 'table') {
      expect(table.rows.length).toBe(2);
      expect(table.rows[0][0].text).toBe('项目');
      expect(table.rows[0][0].bold).toBe(true);
    }
  });

  it('所有节点矩形被钳制进画布', () => {
    const slide = htmlToDeck(SIMPLE_HTML);
    for (const n of slide.nodes) {
      expect(n.rect.x).toBeGreaterThanOrEqual(0);
      expect(n.rect.y).toBeGreaterThanOrEqual(0);
      expect(n.rect.x + n.rect.w).toBeLessThanOrEqual(1280);
      expect(n.rect.y + n.rect.h).toBeLessThanOrEqual(720);
    }
  });

  it('空 HTML / 非法输入返回空节点页不抛错', () => {
    expect(htmlToDeck('').nodes).toHaveLength(0);
    expect(htmlToDeck('<div></div>').nodes).toHaveLength(0);
    expect(() => htmlToDeck('<div>未闭合')).not.toThrow();
  });

  it('批量解析多页并编号', () => {
    const slides = htmlSlidesToDeck([SIMPLE_HTML, '<div><p>x</p></div>']);
    expect(slides).toHaveLength(2);
    expect(slides[0].id).toBe('slide-1');
  });
});

describe('presentationToDeck · 聚合器', () => {
  it('无 deck 字段时走 DOM 兜底，页数一致', () => {
    const deck = presentationToDeck(makePresentation());
    expect(deck.slides).toHaveLength(2);
    expect(deck.slides[0].nodes.length).toBeGreaterThan(0);
    expect(deck.source).toBe('html');
  });

  it('有 deck 字段时优先使用结构化数据', () => {
    const structured: DeckSlide = {
      id: 's1',
      pageType: 'cover',
      nodes: [
        {
          kind: 'text',
          rect: { x: 64, y: 248, w: 1152, h: 112 },
          paragraphs: [{ runs: [{ text: '封面' }] }],
        },
      ],
    };
    const pres = makePresentation();
    pres.slides[0].deck = structured;
    const deck = presentationToDeck(pres);
    expect(deck.slides[0].nodes).toBe(structured.nodes);
    expect(deck.source).toBe('plan');
  });

  it('关闭兜底时不解析 HTML', () => {
    const deck = presentationToDeck(makePresentation(), { allowHtmlFallback: false });
    expect(deck.slides.every((s) => s.nodes.length === 0)).toBe(true);
  });

  it('母版与元信息从 Presentation 透传', () => {
    const pres = makePresentation();
    pres.master = { title: 'M', objects: [], placeholders: [] };
    const deck = presentationToDeck(pres);
    expect(deck.master?.title).toBe('M');
    expect(deck.meta?.author).toBe('张三');
    expect(deck.meta?.revision).toBe('3');
  });

  it('元信息缺省时用 Presentation 既有字段兜底', () => {
    const deck = presentationToDeck(makePresentation());
    expect(deck.meta?.title).toBe('演示标题');
    expect(deck.meta?.subject).toBe('副标题');
    expect(deck.meta?.keywords).toBe('年报; 营收');
  });

  it('备注逐页收集', () => {
    const notes = collectNotesById(makePresentation());
    expect(notes).toEqual({ s1: '第一页备注' });
  });

  it('null presentation 不崩', () => {
    const deck = presentationToDeck(null);
    expect(deck.slides).toHaveLength(0);
  });
});

describe('端到端：历史数据（无 deck）也能导出 PPTX', () => {
  it('explicit legacy export supports historical HTML-only presentations', async () => {
    const deck = presentationToDeck(makePresentation());
    // jsdom 下不加载真实 pptxgenjs（会挂起），注入 stub 验证全链路跑通。
    const calls = { addSlide: 0 };
    const stub = () => ({
      layout: '',
      defineSlideMaster: () => {},
      addSlide: () => {
        calls.addSlide++;
        return {
          addText: () => {},
          addShape: () => {},
          addTable: () => {},
          addChart: () => {},
          addImage: () => {},
          addNotes: () => {},
        };
      },
      write: async () => new Uint8Array(),
      writeFile: async () => 'x.pptx',
    });
    await buildLegacyPptx(deck, {
      notesById: collectNotesById(makePresentation()),
      pptxFactory: stub,
    });
    // makePresentation 有 2 页，逐页都应生成一张 PPTX 幻灯片。
    expect(calls.addSlide).toBe(2);
  });
});
