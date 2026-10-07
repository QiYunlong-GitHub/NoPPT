/**
 * deck-to-html parity 测试。
 *
 * 基准来源：`LLM-HTML-BEHAVIOR-SNAPSHOT.md`（§2 根容器 / §3 标题 / §5 图片 / §6 表格 /
 * §7 图表 / §9 白名单 / §11 常量 / §12 审计约束）。
 *
 * 说明（重要）：快照 §13 已确认仓库内**没有** golden HTML 样本，且现状 HTML 由
 * `generateSlideHtmlSafe` 经真实 LLM 调用产出——单测内无法"首次采集"出有代表性的
 * golden 样本（mock 产物不代表真实 LLM 行为）。因此本文件采用**契约式 parity**：
 * 断言 deckToHtml 产物必须满足现状 LLM-HTML 赖以通过审计/后处理的那些**不变量**，
 * 而非与 LLM 输出做逐字节 golden diff。
 */

import { describe, expect, it } from 'vitest';
import { DECK_IMAGE_PLACEHOLDER } from '@noppt/core/deck';
import type {
  DeckChartNode,
  DeckImageNode,
  DeckSlide,
  DeckTableNode,
  DeckTextNode,
} from '@noppt/core/deck';
import { buildLayoutContext } from '../plan-to-deck';
import { deckSlideToHtml } from '../deck-to-html';
import { DECK_NEUTRAL } from '../layout-templates';
import { sanitizeSlideHtml } from '../../html-sanitize';

/** 与 §11 常量一致的安全区（8pt 网格）。 */
const RECT = { x: 64, y: 48, w: 1152, h: 624 };

function ctx() {
  return buildLayoutContext({ title: 't', primaryColor: '#2563eb', slides: [] });
}

function titleSlide(): DeckSlide {
  const title: DeckTextNode = {
    kind: 'text',
    rect: RECT,
    role: 'title',
    paragraphs: [{ runs: [{ text: '封面标题' }] }],
  };
  return { id: 's1', pageType: 'cover', title: '封面标题', nodes: [title] };
}

function imageSlide(src: string, alt?: string): DeckSlide {
  const img: DeckImageNode = { kind: 'image', rect: RECT, src, alt };
  return { id: 's2', pageType: 'content-image-left', title: '配图页', nodes: [img] };
}

function chartSlide(): DeckSlide {
  const chart: DeckChartNode = {
    kind: 'chart',
    rect: RECT,
    chart: {
      kind: 'bar',
      title: '季度增长',
      categories: ['Q1', 'Q2'],
      series: [{ name: '营收', values: [12, 30] }],
    },
  };
  return { id: 's3', pageType: 'content-chart-bar', title: '图表页', nodes: [chart] };
}

function tableSlide(): DeckSlide {
  const table: DeckTableNode = {
    kind: 'table',
    rect: RECT,
    header: true,
    rows: [
      [{ text: '项目' }, { text: '数值' }],
      [{ text: '营收' }, { text: '1200' }],
    ],
  };
  return { id: 's4', pageType: 'content-table', title: '表格页', nodes: [table] };
}

describe('deck-to-html · §2 根容器约定', () => {
  it('产出 canonical responsive logical-canvas root，并带 box-sizing', () => {
    const html = deckSlideToHtml(titleSlide(), ctx());
    expect(html).toMatch(/^<div[^>]*data-canonical-root="true"/);
    expect(html).toContain('data-logical-width="1280"');
    expect(html).toContain('data-logical-height="720"');
    expect(html).toContain('aspect-ratio:1280 / 720');
    expect(html).toContain('width:100%');
    expect(html).toContain('max-width:1280px');
    expect(html).toContain('box-sizing:border-box');
  });

  it('文本节点使用可见溢出，避免已测量正文被 canonical renderer 静默裁切', () => {
    expect(deckSlideToHtml(titleSlide(), ctx())).toContain('overflow:visible');
  });

  it('严禁用 inset 定位（历史坑：母版层被剥成 0 尺寸）', () => {
    for (const s of [
      titleSlide(),
      imageSlide(DECK_IMAGE_PLACEHOLDER),
      chartSlide(),
      tableSlide(),
    ]) {
      expect(deckSlideToHtml(s, ctx())).not.toMatch(/\binset\s*:/);
    }
  });

  it('定位一律使用 top/left/right/bottom 四边属性', () => {
    const html = deckSlideToHtml(tableSlide(), ctx());
    // 表格外层定位
    expect(html).toContain(`left:${RECT.x}px`);
    expect(html).toContain(`top:${RECT.y}px`);
  });

  it('8pt 网格：节点坐标/尺寸均为 8 的倍数', () => {
    const html = deckSlideToHtml(titleSlide(), ctx());
    for (const v of [RECT.x, RECT.y, RECT.w, RECT.h]) expect(v % 8).toBe(0);
    expect(html).toContain(`width:${RECT.w}px`);
    expect(html).toContain(`height:${RECT.h}px`);
  });
});

describe('deck-to-html · §3 标题语义（审计 extractSlideTitle 兜底）', () => {
  it('标题节点默认输出 <h2>', () => {
    expect(deckSlideToHtml(titleSlide(), ctx())).toContain('<h2');
  });

  it('指定 headingForTitle 时输出对应语义标签（cover→h1）', () => {
    const html = deckSlideToHtml(titleSlide(), ctx(), { headingForTitle: 'h1' });
    expect(html).toContain('<h1');
    expect(html).not.toContain('<h2');
  });

  it('DeckSlide.title 已写入（审计优先取 slide.title）', () => {
    expect(titleSlide().title).toBeTruthy();
  });
});

describe('deck-to-html · §5 图片（★ 最易踩坑）', () => {
  it('占位图渲染为可见灰块，绝不输出无效 URL 的 <img>', () => {
    const html = deckSlideToHtml(imageSlide(DECK_IMAGE_PLACEHOLDER, '一只猫'), ctx());
    expect(html).not.toContain('<img');
    expect(html).not.toContain(DECK_IMAGE_PLACEHOLDER);
    expect(html).toMatch(new RegExp(`background:\\s*#?${DECK_NEUTRAL.border}`, 'i'));
    expect(html).toContain('一只猫');
  });

  it('真实图渲染为 <img object-fit:cover>', () => {
    const html = deckSlideToHtml(imageSlide('https://cdn.example.com/a.png', 'alt'), ctx());
    expect(html).toContain('<img');
    expect(html).toContain('https://cdn.example.com/a.png');
    expect(html).toContain('object-fit:cover');
  });
});

describe('deck-to-html · §6/§7 表格与图表', () => {
  it('表格产出 table/tr 结构', () => {
    const html = deckSlideToHtml(tableSlide(), ctx());
    expect(html).toContain('<table');
    expect(html).toContain('<tr');
  });

  it('图表产出原生 SVG 图元（bar→rect / line→polyline / pie-donut→path）', () => {
    const html = deckSlideToHtml(chartSlide(), ctx());
    expect(html).toContain('<svg');
    expect(html).toMatch(/<(rect|polyline|path)\b/);
  });

  it('NFR-2 静默降级：畸形图表不抛错且输出占位', () => {
    const broken: DeckSlide = {
      id: 's5',
      pageType: 'content-chart-bar',
      title: '坏图',
      nodes: [
        {
          kind: 'chart',
          rect: RECT,
          // 缺失 series：渲染必然失败 → 应静默降级而非抛错
          chart: { kind: 'bar' } as never,
        },
      ],
    };
    expect(() => deckSlideToHtml(broken, ctx())).not.toThrow();
    expect(deckSlideToHtml(broken, ctx())).toContain('图表');
  });
});

describe('deck-to-html · §9 安全白名单 parity 兜底', () => {
  it('产物经 sanitizeSlideHtml 后结构/文字不被剥离', () => {
    for (const s of [
      titleSlide(),
      imageSlide('https://cdn.example.com/a.png'),
      chartSlide(),
      tableSlide(),
    ]) {
      const html = deckSlideToHtml(s, ctx());
      const cleaned = sanitizeSlideHtml(html);
      expect(cleaned).toContain('position:relative');
      expect(cleaned).toContain('1280px');
      expect(cleaned.length).toBeGreaterThan(0);
    }
  });

  it('SVG 图表可存活于白名单（svg/path/rect/polyline 已放行）', () => {
    const cleaned = sanitizeSlideHtml(deckSlideToHtml(chartSlide(), ctx()));
    expect(cleaned).toContain('<svg');
  });

  it('标题文字不被 sanitize 剥离（审计 extractSlideTitle 可用）', () => {
    const cleaned = sanitizeSlideHtml(deckSlideToHtml(titleSlide(), ctx()));
    expect(cleaned).toContain('封面标题');
  });
});

describe('deck-to-html · §12 审计 HTML 假设', () => {
  it('绝不生成 background-clip:text 黑块标题（detectBlackBlockTitle 恒阴）', () => {
    const html = deckSlideToHtml(titleSlide(), ctx());
    expect(html).not.toContain('background-clip:text');
    expect(html).not.toContain('background-clip: text');
  });

  it('根容器仅 position:relative，不带居中三件套（避免 rootContainerCentered 误报）', () => {
    const html = deckSlideToHtml(titleSlide(), ctx());
    const rootStyle = html.slice(0, html.indexOf('">'));
    expect(rootStyle).toContain('position:relative');
    expect(rootStyle).not.toContain('display:flex');
    expect(rootStyle).not.toContain('align-items:center');
    expect(rootStyle).not.toContain('justify-content:center');
  });
});
