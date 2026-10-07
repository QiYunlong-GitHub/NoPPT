/**
 * render.ts feature flag 集成测试：确定性 Deck 路径 ↔ generateSlideHtmlSafe 回退。
 *
 * 锁定 `options.deterministicDeckPreview` 的三态语义：
 * - 不传 / true → 走确定性 Deck 管线（planToDeck → deckSlideToHtml）；
 * - false → 回退既有 LLM-HTML 路径（generateSlideHtmlSafe）。
 *
 * 说明：Deck 路径为纯计算、不调 LLM，因此真实调用即可覆盖；
 *      legacy 路径用 `vi.mock` 桩掉单页生成，避免真实网络请求。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../generate-slide', () => ({
  generateSlideHtmlSafe: vi.fn(async () => '<div data-noppt-page="1">mock-html</div>'),
}));

import { generateSlideHtmlSafe } from '../generate-slide';
import { renderSlides } from '../render';
import type { AgentDeps } from '../deps';

const genSpy = vi.mocked(generateSlideHtmlSafe);

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
    title: '演示',
    primaryColor: '#2563eb',
    slides: Array.from({ length: slideCount }, (_, i) => ({
      pageType: 'content-no-image',
      title: `页 ${i + 1}`,
      keyPoints: ['要点一', '要点二'],
      needsImage: false,
    })),
  } as any;
}

beforeEach(() => {
  genSpy.mockClear();
});

describe('renderSlides · feature flag deterministicDeckPreview', () => {
  it('flag=false → 回退 generateSlideHtmlSafe（LLM-HTML 路径）', async () => {
    const result = await renderSlides(makeDeps(), 'topic', makePlan(2), makeDesign(), {
      deterministicDeckPreview: false,
    } as any);

    expect(genSpy).toHaveBeenCalledTimes(2);
    // legacy 路径产物会经 postProcessSlideHtml 包装，故断言 mock 内容存活而非逐字节相等
    for (const s of result) expect(s.html).toContain('mock-html');
  });

  it('flag=true → 走确定性 Deck 路径，不再调用 generateSlideHtmlSafe', async () => {
    const result = await renderSlides(makeDeps(), 'topic', makePlan(2), makeDesign(), {
      deterministicDeckPreview: true,
    } as any);

    expect(genSpy).not.toHaveBeenCalled();
    expect(result).toHaveLength(2);
    for (const s of result) {
      expect(s.html).toContain('data-canonical-root="true"');
      expect(s.html).toContain('data-logical-width="1280"');
      expect(s.deck).toBeDefined();
    }
  });

  it('flag 不传 → 默认走确定性 Deck 路径（已切默认）', async () => {
    const result = await renderSlides(makeDeps(), 'topic', makePlan(1), makeDesign());

    expect(genSpy).not.toHaveBeenCalled();
    expect(result).toHaveLength(1);
    expect(result[0].html).toContain('data-canonical-root="true"');
    expect(result[0].deck).toBeDefined();
  });

  it('两条路径返回结构一致（title / html / pageType）', async () => {
    const legacy = await renderSlides(makeDeps(), 'topic', makePlan(1), makeDesign(), {
      deterministicDeckPreview: false,
    } as any);
    const deckPath = await renderSlides(makeDeps(), 'topic', makePlan(1), makeDesign(), {
      deterministicDeckPreview: true,
    } as any);

    for (const r of [legacy[0], deckPath[0]]) {
      expect(typeof r.title).toBe('string');
      expect(typeof r.html).toBe('string');
      expect(r.pageType).toBeTruthy();
    }
    expect(deckPath[0].pageType).toBe('content-no-image');
  });
});
