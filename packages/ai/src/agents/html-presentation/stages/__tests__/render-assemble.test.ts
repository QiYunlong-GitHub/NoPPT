/**
 * stages/render.ts 与 stages/assemble.ts —— 行为锁定测试
 *
 * 目的：在从 render.ts / assemble.ts 切出 render-batch / assemble-images 之前，
 *       先锁定两个编排函数的「导出契约 + 空计划/索引裁剪边界」行为，
 *       确保后续搬移不改变任何运行时输出。
 *
 * 说明：这两个函数内部依赖 LLM 调用，完整生成路径需大量 mock；
 *       本文件先锁定「无需网络即可验证」的部分（导出契约、空输入、
 *       索引裁剪），为切分提供最小但真实的回归护栏。
 */

import { describe, it, expect, vi } from 'vitest';

// 桩掉单页生成，避免真实 LLM 调用；默认 critique.enabled=false 不会触发 critiqueSlide，
// 因此只需桩 generate-slide 即可覆盖「非空计划」的完整编排路径。
const MOCK_HTML = '<div data-noppt-page="1">mock-html</div>';
vi.mock('../generate-slide', () => ({
  generateSlideHtmlSafe: vi.fn(async () => MOCK_HTML),
}));

import { renderSlides } from '../render';
import { assembleImages } from '../assemble';
import type { AgentDeps } from '../deps';

function makeDeps(): AgentDeps {
  const provider = { name: 'mock', config: {} } as any;
  return {
    provider,
    planningProvider: provider,
    contentProvider: provider,
    editingProvider: provider,
    language: 'zh',
  } as AgentDeps;
}

function makeDesign() {
  return {
    density: 'normal',
    iconStyle: 'auto',
    fontFamily: 'sans',
    colorTheme: 'blue',
    primaryColor: '#2563eb',
  } as any;
}

function makePlan(slideCount: number) {
  return {
    slides: Array.from({ length: slideCount }, (_, i) => ({
      id: `s-${i}`,
      title: `页 ${i + 1}`,
      pageType: 'content',
      html: '',
      notes: '',
    })),
  } as any;
}

describe('stages 编排函数（导出契约）', () => {
  it('renderSlides 为异步函数', () => {
    expect(typeof renderSlides).toBe('function');
    expect(renderSlides.constructor.name).toBe('AsyncFunction');
    // (deps, _topic, plan, design, options?, traceSessionId?)
    expect(renderSlides.length).toBeGreaterThanOrEqual(4);
  });

  it('assembleImages 为异步函数', () => {
    expect(typeof assembleImages).toBe('function');
    expect(assembleImages.constructor.name).toBe('AsyncFunction');
    // (deps, topic, renderedSlides, plan, _design, options?, traceSessionId?)
    expect(assembleImages.length).toBeGreaterThanOrEqual(5);
  });
});

describe('renderSlides（边界行为锁定）', () => {
  it('空计划返回空数组，不触发任何生成', async () => {
    const result = await renderSlides(makeDeps(), 'topic', makePlan(0), makeDesign());
    expect(result).toEqual([]);
  });

  it('startIndex >= endIndex 时不渲染任何页', async () => {
    const result = await renderSlides(makeDeps(), 'topic', makePlan(3), makeDesign(), {
      startIndex: 2,
      endIndex: 2,
    } as any);
    expect(result).toEqual([]);
  });

  it('endIndex 为 0 时不渲染任何页', async () => {
    const result = await renderSlides(makeDeps(), 'topic', makePlan(3), makeDesign(), {
      startIndex: 0,
      endIndex: 0,
    } as any);
    expect(result).toEqual([]);
  });

  it('非空计划：逐页走生成路径，返回与页数一致的 RenderedSlide', async () => {
    const result = await renderSlides(makeDeps(), 'topic', makePlan(3), makeDesign());
    expect(result).toHaveLength(3);
    for (const s of result) {
      expect(typeof s.html).toBe('string');
      expect(typeof s.title).toBe('string');
    }
  });

  it('endIndex 裁剪：只渲染区间内的页', async () => {
    const result = await renderSlides(makeDeps(), 'topic', makePlan(4), makeDesign(), {
      startIndex: 1,
      endIndex: 3,
    } as any);
    expect(result).toHaveLength(2);
  });
});

describe('assembleImages（边界行为锁定）', () => {
  it('空渲染结果返回空数组', async () => {
    const result = await assembleImages(
      makeDeps(),
      'topic',
      [],
      makePlan(0),
      makeDesign(),
    );
    expect(result).toEqual([]);
  });

  it('未启用图片时原样回传渲染结果', async () => {
    const rendered = [
      { title: '页 1', html: '<div>a</div>', pageType: 'content' },
      { title: '页 2', html: '<div>b</div>', pageType: 'content' },
    ] as any;
    const result = await assembleImages(
      makeDeps(),
      'topic',
      rendered,
      makePlan(2),
      makeDesign(),
    );
    expect(result).toHaveLength(2);
    expect(result[0].html).toBe('<div>a</div>');
    expect(result[1].html).toBe('<div>b</div>');
  });
});
