// ================================================================
// AiService · 审计重试循环（runHtmlPlaceholderAuditLoop）—— 行为锁定测试（characterization）
//
// 目的：在把审计循环外置（Phase 5）之前/之中锁定「现状行为」，保证后续纯搬移不变：
//   1) 三个短路护栏（maxRetries<=0 / vlmProvider 为 null / 空 slides）→ 原样返回，不触发 VLM；
//   2) VLM 无阻塞问题 → 保留原页，passed=true；
//   3) VLM 有 error 级阻塞问题 → 调用 regenerateSlideFn 重试，且无阻塞后保留最优；
//   4) 重试中 regenerateSlideFn 返回 null → 终止重试，保留历史最优（passed 反映最后是否阻塞）；
//   5) onlyAfterLlmPass 且该页 LLM critique 未通过 → 整页跳过（频控），不消耗 VLM 配额。
//
// 渲染（SlideRenderer）与 VLM 评审（runVlmCritique）通过 vi.mock('@noppt/audit') 桩掉，
// 使测试在无浏览器环境下确定性运行。
// ================================================================
import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { runVlmCritiqueMock } = vi.hoisted(() => ({
  runVlmCritiqueMock: vi.fn(),
}));

vi.mock('@noppt/audit', () => ({
  SlideRenderer: class {
    async initialize() {}
    async renderSlide() {
      return { close: async () => {} };
    }
    async captureScreenshot() {}
    async close() {}
  },
  runVlmCritique: runVlmCritiqueMock,
}));

import { runHtmlPlaceholderAuditLoop } from '../html-audit-loop';
import type { RenderedSlide } from '@noppt/ai';

function makeSlide(html: string, critique?: RenderedSlide['critique']): RenderedSlide {
  return { html, title: 'slide', critique } as RenderedSlide;
}

const noopRegenerate = vi.fn(async () => null);

beforeEach(() => {
  vi.restoreAllMocks();
  runVlmCritiqueMock.mockReset();
});

describe('AiService · 审计循环（runHtmlPlaceholderAuditLoop）· 短路护栏', () => {
  it('maxRetries <= 0 → 原样返回，不调用 VLM', async () => {
    const slides = [makeSlide('<div>a</div>')];
    const out = await runHtmlPlaceholderAuditLoop({
      slides,
      vlmProvider: {} as any,
      maxRetries: 0,
      regenerateSlideFn: noopRegenerate,
    });
    expect(out).toBe(slides);
    expect(runVlmCritiqueMock).not.toHaveBeenCalled();
    expect(noopRegenerate).not.toHaveBeenCalled();
  });

  it('vlmProvider 为 null → 原样返回', async () => {
    const slides = [makeSlide('<div>a</div>')];
    const out = await runHtmlPlaceholderAuditLoop({
      slides,
      vlmProvider: null,
      maxRetries: 2,
      regenerateSlideFn: noopRegenerate,
    });
    expect(out).toBe(slides);
    expect(runVlmCritiqueMock).not.toHaveBeenCalled();
  });

  it('空 slides → 返回空数组', async () => {
    const out = await runHtmlPlaceholderAuditLoop({
      slides: [],
      vlmProvider: {} as any,
      maxRetries: 2,
      regenerateSlideFn: noopRegenerate,
    });
    expect(out).toEqual([]);
    expect(runVlmCritiqueMock).not.toHaveBeenCalled();
  });
});

describe('AiService · 审计循环（runHtmlPlaceholderAuditLoop）· 重试 / 再生逻辑', () => {
  it('VLM 无阻塞问题 → 保留原页，passed=true，attempts=1', async () => {
    runVlmCritiqueMock.mockResolvedValue({ issues: [], score: 90 });
    const slides = [makeSlide('<div>ok</div>', { score: 8, passed: false, attempts: 1, issues: [] })];
    const out = await runHtmlPlaceholderAuditLoop({
      slides,
      vlmProvider: {} as any,
      maxRetries: 3,
      regenerateSlideFn: noopRegenerate,
    });
    expect(out).toHaveLength(1);
    expect(out[0].html).toContain('ok');
    expect(out[0].critique?.passed).toBe(true);
    // attempts = (原 attempts ?? 1) + 实际重试次数(0) = 1 + 0
    expect(out[0].critique?.attempts).toBe(1);
    expect(noopRegenerate).not.toHaveBeenCalled();
  });

  it('VLM 有 error 阻塞 → 调用 regenerateSlideFn 重试，无阻塞后保留再生版本(passed=true)', async () => {
    const improved = makeSlide('<div>improved</div>', { score: 9, passed: true, attempts: 1, issues: [] });
    runVlmCritiqueMock
      .mockResolvedValueOnce({ issues: [{ severity: 'error', message: '遮挡' }], score: 40 })
      .mockResolvedValueOnce({ issues: [], score: 95 });
    const regenerate = vi.fn(async () => improved);
    const slides = [makeSlide('<div>bad</div>', { score: 4, passed: false, attempts: 1, issues: [] })];
    const out = await runHtmlPlaceholderAuditLoop({
      slides,
      vlmProvider: {} as any,
      maxRetries: 3,
      regenerateSlideFn: regenerate,
    });
    expect(regenerate).toHaveBeenCalledTimes(1);
    expect(out[0].html).toContain('improved');
    expect(out[0].critique?.passed).toBe(true);
    // attempts = (1) + 重试 1 次 = 2
    expect(out[0].critique?.attempts).toBe(2);
  });

  it('重试中 regenerateSlideFn 返回 null → 终止重试，保留历史最优，passed 反映最终是否阻塞', async () => {
    runVlmCritiqueMock.mockResolvedValue({ issues: [{ severity: 'error', message: '遮挡' }], score: 30 });
    const regenerate = vi.fn(async () => null);
    const slides = [makeSlide('<div>bad</div>', { score: 4, passed: false, attempts: 1, issues: [] })];
    const out = await runHtmlPlaceholderAuditLoop({
      slides,
      vlmProvider: {} as any,
      maxRetries: 3,
      regenerateSlideFn: regenerate,
    });
    expect(regenerate).toHaveBeenCalledTimes(1);
    // 保留原页（历史最优）
    expect(out[0].html).toContain('bad');
    expect(out[0].critique?.passed).toBe(false);
    // 第 1 次阻塞→进入重试（attempt 0→1）→ regenerate 返回 null → break；attempts = 原1 + 1 = 2
    expect(out[0].critique?.attempts).toBe(2);
  });

  it('达到最大重试次数仍阻塞 → 保留历史最优，passed=false', async () => {
    runVlmCritiqueMock.mockResolvedValue({ issues: [{ severity: 'error', message: '遮挡' }], score: 30 });
    const regenerate = vi.fn(async () => makeSlide('<div>still-bad</div>'));
    const slides = [makeSlide('<div>bad</div>', { score: 4, passed: false, attempts: 1, issues: [] })];
    const out = await runHtmlPlaceholderAuditLoop({
      slides,
      vlmProvider: {} as any,
      maxRetries: 2,
      regenerateSlideFn: regenerate,
    });
    // 第 1 次阻塞→重试；第 2 次阻塞→达到 maxRetries 退出
    expect(regenerate).toHaveBeenCalledTimes(2);
    expect(out[0].critique?.passed).toBe(false);
  });
});

describe('AiService · 审计循环（runHtmlPlaceholderAuditLoop）· onlyAfterLlmPass 频控', () => {
  it('LLM critique 未通过 → 整页跳过，不消耗 VLM 配额', async () => {
    const slides = [
      makeSlide('<div>skip</div>', { score: 3, passed: false, attempts: 1, issues: ['x'] }),
    ];
    const out = await runHtmlPlaceholderAuditLoop({
      slides,
      vlmProvider: {} as any,
      maxRetries: 3,
      onlyAfterLlmPass: true,
      regenerateSlideFn: noopRegenerate,
    });
    expect(runVlmCritiqueMock).not.toHaveBeenCalled();
    expect(out[0].html).toContain('skip');
  });

  it('LLM critique 已通过 → 正常进入 VLM 评审', async () => {
    runVlmCritiqueMock.mockResolvedValue({ issues: [], score: 90 });
    const slides = [
      makeSlide('<div>pass</div>', { score: 8, passed: true, attempts: 1, issues: [] }),
    ];
    await runHtmlPlaceholderAuditLoop({
      slides,
      vlmProvider: {} as any,
      maxRetries: 3,
      onlyAfterLlmPass: true,
      regenerateSlideFn: noopRegenerate,
    });
    expect(runVlmCritiqueMock).toHaveBeenCalledTimes(1);
  });
});
