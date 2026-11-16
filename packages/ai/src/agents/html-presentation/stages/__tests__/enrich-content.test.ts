/**
 * enrich-content 回归测试：稀疏检测、单次批量扩写、失败回退、数值守卫、parity。
 */
import { describe, expect, it, vi } from 'vitest';
import type { AgentDeps } from '../deps';
import type { PresentationPlan, SlidePlan } from '../../../../types';
import {
  enrichSparseContent,
  isSparseSlide,
  mergeSlidePatch,
} from '../enrich-content';

function makeDeps(chatImpl: (messages: any[], options?: any) => Promise<{ content: string }>): AgentDeps {
  const contentProvider = {
    name: 'mock-content',
    config: {},
    chat: vi.fn(chatImpl),
  } as any;
  const planningProvider = { ...contentProvider, name: 'mock-planning', chat: vi.fn() } as any;
  return {
    provider: contentProvider,
    planningProvider,
    contentProvider,
    editingProvider: contentProvider,
    language: 'zh',
  } as AgentDeps;
}

const sparsePlan = (overrides: Partial<SlidePlan> = {}): PresentationPlan => ({
  title: '测试演示',
  primaryColor: '#EA580C',
  slides: [
    {
      pageType: 'comparison-deep-dive',
      title: '厄尔尼诺与拉尼娜冷暖两相',
      keyPoints: [
        '海表温度异常方向：东太平洋冷暖偏离常年',
        '南美西岸降水倾向：秘鲁沿岸旱涝与渔业受影响',
        '西太平洋降水倾向：降雨偏少或偏多改变旱涝风险',
      ],
      needsImage: false,
      ...overrides,
    },
  ],
});

const reply = (slides: any[]): { content: string } => ({
  content: JSON.stringify({ slides }),
});

describe('isSparseSlide · 稀疏判定', () => {
  it('短句少要点的内容页判为稀疏', () => {
    expect(isSparseSlide(sparsePlan().slides[0])).toBe(true);
  });

  it('封面/总结/目录不参与扩写', () => {
    for (const pageType of ['cover', 'summary', 'toc'] as const) {
      expect(isSparseSlide({ ...sparsePlan().slides[0], pageType })).toBe(false);
    }
  });

  it('内容充足且有 typed 字段的页不判稀疏', () => {
    const slide: SlidePlan = {
      pageType: 'content-no-image',
      title: '充实页',
      keyPoints: Array.from({ length: 6 }, (_, i) => `结论${i}：这是一条18字以上的具体证据断言语句示例说明`),
      needsImage: false,
    };
    expect(isSparseSlide(slide)).toBe(false);
  });
});

describe('mergeSlidePatch · 只改内容不改版式', () => {
  it('comparison-deep-dive 只合并 keyPoints，不写入 metricValues（避免严格校验失败）', () => {
    const slide = sparsePlan().slides[0];
    const merged = mergeSlidePatch(slide, {
      keyPoints: ['维度A：断言一', '维度B：断言二', '维度C：断言三', '维度D：断言四'],
      metricValues: [90, 75, 999, -5],
      advantageIndices: [0, 9, 2],
    });
    expect(merged.pageType).toBe('comparison-deep-dive');
    expect(merged.title).toBe(slide.title);
    expect(merged.keyPoints).toHaveLength(4);
    expect(merged.metricValues).toBeUndefined();
    expect(merged.advantageIndices).toBeUndefined();
  });

  it('metricValues 长度不匹配时丢弃，不写入越界数据', () => {
    const slide = sparsePlan().slides[0];
    const merged = mergeSlidePatch(slide, {
      keyPoints: ['A：一', 'B：二', 'C：三', 'D：四'],
      metricValues: [80],
    });
    expect(merged.metricValues).toBeUndefined();
  });

  it('omission 指标不会被当作真实 metric 合并', () => {
    const slide = sparsePlan().slides[0];
    const merged = mergeSlidePatch(slide, {
      metricItems: [{ kind: 'omission', contentId: 'x', order: 0, originalText: '空', reason: 'value_not_separable', status: 'needs_review' }],
    });
    expect(merged.metricItems).toBeUndefined();
  });

  it('content-cards 只合并 cardItems，不串改其它页型字段', () => {
    const slide: SlidePlan = {
      pageType: 'content-cards',
      title: '卡片页',
      keyPoints: ['旧要点'],
      needsImage: false,
    };
    const merged = mergeSlidePatch(slide, {
      keyPoints: ['新要点'],
      cardItems: [{ title: '标题', body: '这是一段十八字以上的具体证据断言说明' }],
      metricValues: [80, 60],
    });
    expect(merged.cardItems?.[0].body).toContain('具体证据');
    expect(merged.metricValues).toBeUndefined();
    expect(merged.pageType).toBe('content-cards');
  });
});

describe('enrichSparseContent · 单次调用与回退', () => {
  it('用 contentProvider 调用一次，planningProvider 不被调用', async () => {
    const plan = sparsePlan();
    const deps = makeDeps(async () => reply([{
      index: 0,
      keyPoints: ['维度A：断言', '维度B：断言', '维度C：断言', '维度D：断言'],
      metricValues: [90, 80, 70, 60],
      advantageIndices: [0],
    }]));
    const result = await enrichSparseContent(deps, plan, {
      enabled: true,
      referenceText: '权威素材：厄尔尼诺海温距平超0.5℃',
    });
    expect((deps.contentProvider.chat as any).mock.calls.length).toBe(1);
    expect((deps.planningProvider.chat as any).mock.calls.length).toBe(0);
    expect(result.enrichedCount).toBe(1);
    expect(result.plan.slides[0].keyPoints).toHaveLength(4);
    expect(result.plan.slides[0].pageType).toBe('comparison-deep-dive');
  });

  it('关闭开关时零调用，直接跳过', async () => {
    const deps = makeDeps(async () => reply([]));
    const plan = sparsePlan();
    const result = await enrichSparseContent(deps, plan, { enabled: false, referenceText: '' });
    expect(result.skipped).toBe(true);
    expect((deps.contentProvider.chat as any).mock.calls.length).toBe(0);
    expect(result.plan).toBe(plan);
  });

  it('LLM 抛错时回退原 plan，不阻断', async () => {
    const deps = makeDeps(async () => { throw new Error('network down'); });
    const plan = sparsePlan();
    const result = await enrichSparseContent(deps, plan, { enabled: true, referenceText: '' });
    expect(result.plan).toBe(plan);
    expect(result.enrichedCount).toBe(0);
  });

  it('非法 JSON 时回退原 plan', async () => {
    const deps = makeDeps(async () => ({ content: '这不是 JSON，也不是代码块' }));
    const plan = sparsePlan();
    const result = await enrichSparseContent(deps, plan, { enabled: true, referenceText: '' });
    expect(result.plan).toBe(plan);
  });

  it('没有稀疏页时零调用', async () => {
    const deps = makeDeps(async () => reply([]));
    const plan: PresentationPlan = {
      title: 'X',
      primaryColor: '#000000',
      slides: [{
        pageType: 'content-no-image',
        title: 'P',
        keyPoints: Array.from({ length: 6 }, (_, i) => `结论${i}：这是足够长的一句带证据的断言语句示例内容`),
        needsImage: false,
      }],
    };
    const result = await enrichSparseContent(deps, plan, { enabled: true, referenceText: '' });
    expect(result.skipped).toBe(true);
    expect((deps.contentProvider.chat as any).mock.calls.length).toBe(0);
  });

  it('多个稀疏页合并为一次 LLM 请求', async () => {
    const plan: PresentationPlan = {
      title: 'X',
      primaryColor: '#000000',
      slides: [
        sparsePlan().slides[0],
        { ...sparsePlan().slides[0], title: '第二页' },
      ],
    };
    const deps = makeDeps(async () => reply([]));
    await enrichSparseContent(deps, plan, { enabled: true, referenceText: '' });
    expect((deps.contentProvider.chat as any).mock.calls.length).toBe(1);
  });
});
