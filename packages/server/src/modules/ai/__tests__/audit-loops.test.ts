// ================================================================
// AiService · 审计重试循环（audit-loops.ts 外置三方法）—— 行为锁定测试（characterization）
//
// 目的：锁定「Phase 5 外置」后三个方法的既有控制流，保证纯搬移不改变行为：
//   buildHtmlAuditHookImpl / runPostImageVlmTriageLoopImpl / runAuditImageRegenerationLoopImpl
// 它们通过 .call(this) 由 ai.service.ts 的薄壳委托调用，this.* 全部经 AiService 实例解析。
//
// 这里锁定的关键分支（用最小 fake this，无需完整 AiService）：
//   1) buildHtmlAuditHookImpl：内联自检关闭 / vlmProvider 为 null → 返回的 hook 透传 slides；
//      自检开启且 vlmProvider 存在 → 委托 runHtmlPlaceholderAuditLoop 并返回其结果。
//   2) runPostImageVlmTriageLoopImpl：imageProvider 缺失 / vlmProvider 为 null → {regeneratedCount:0,attempts:0}。
//   3) runAuditImageRegenerationLoopImpl：imageProvider 缺失 → {regeneratedCount:0,attempts:0}。
// 更深的 VLM 重生成闭环由 ai-service-postprocess* 测试经 postProcessPresentation 间接覆盖。
// ================================================================
import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';

const {
  runVlmCritiqueMock,
  runHtmlPlaceholderAuditLoopMock,
  triageSlideIssuesMock,
} = vi.hoisted(() => ({
  runVlmCritiqueMock: vi.fn(),
  runHtmlPlaceholderAuditLoopMock: vi.fn(),
  triageSlideIssuesMock: vi.fn(),
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

vi.mock('../html-audit-loop', () => ({
  runHtmlPlaceholderAuditLoop: runHtmlPlaceholderAuditLoopMock,
}));
vi.mock('../triage-vlm-issues', () => ({
  triageSlideIssues: triageSlideIssuesMock,
}));

import {
  buildHtmlAuditHookImpl,
  runPostImageVlmTriageLoopImpl,
  runAuditImageRegenerationLoopImpl,
} from '../audit/audit-loops';

const agent = { regenerateSingleSlide: vi.fn() } as any;

function makeSlides(n = 1): any[] {
  return Array.from({ length: n }, (_, i) => ({ html: `<div>s${i}</div>` }));
}

describe('audit-loops · buildHtmlAuditHookImpl · 短路护栏', () => {
  it('内联自检关闭（critique.enabled=false）→ 返回的 hook 透传 slides', async () => {
    const hook = buildHtmlAuditHookImpl.call(
      {},
      {
        agent,
        topic: 't',
        options: { critique: { enabled: false } },
        maxRetries: 1,
        slideWidth: 100,
        slideHeight: 100,
      } as any,
    );
    expect(typeof hook).toBe('function');
    const slides = makeSlides();
    const out = await hook(slides, { plan: {} as any, design: {} as any });
    expect(out).toBe(slides);
  });

  it('vlmProvider 为 null → hook 透传 slides', async () => {
    const hook = buildHtmlAuditHookImpl.call(
      { auditService: { getVlmProvider: async () => null } },
      {
        agent,
        topic: 't',
        options: { critique: { enabled: true, vlmPlaceholder: true } },
        maxRetries: 1,
        slideWidth: 100,
        slideHeight: 100,
      } as any,
    );
    const slides = makeSlides();
    const out = await hook(slides, { plan: {} as any, design: {} as any });
    expect(out).toBe(slides);
  });

  it('自检开启且 vlmProvider 存在 → 委托 runHtmlPlaceholderAuditLoop 并返回其结果', async () => {
    const slides = makeSlides();
    runHtmlPlaceholderAuditLoopMock.mockResolvedValue(slides);
    const hook = buildHtmlAuditHookImpl.call(
      { auditService: { getVlmProvider: async () => ({}) } },
      {
        agent,
        topic: 't',
        options: { critique: { enabled: true, vlmPlaceholder: true } },
        maxRetries: 2,
        slideWidth: 100,
        slideHeight: 100,
      } as any,
    );
    const out = await hook(slides, { plan: {} as any, design: {} as any });
    expect(runHtmlPlaceholderAuditLoopMock).toHaveBeenCalledTimes(1);
    expect(out).toBe(slides);
  });
});

describe('audit-loops · runPostImageVlmTriageLoopImpl · 短路护栏', () => {
  const base = {
    result: { id: 'p1', slides: makeSlides() } as any,
    plan: undefined,
    design: undefined,
    agent,
    imageProvider: null,
    imageOptions: {},
    traceSessionId: 's',
    topic: 't',
    maxRetries: 2,
    slideWidth: 100,
    slideHeight: 100,
    generationOptions: {},
  } as any;

  it('imageProvider 缺失 → {regeneratedCount:0,attempts:0}', async () => {
    const r = await runPostImageVlmTriageLoopImpl.call({}, base);
    expect(r).toEqual({ regeneratedCount: 0, attempts: 0 });
  });

  it('vlmProvider 为 null → {regeneratedCount:0,attempts:0}', async () => {
    const r = await runPostImageVlmTriageLoopImpl.call(
      { auditService: { getVlmProvider: async () => null } },
      { ...base, imageProvider: { generateImage: vi.fn() } },
    );
    expect(r).toEqual({ regeneratedCount: 0, attempts: 0 });
  });
});

describe('audit-loops · runAuditImageRegenerationLoopImpl · 短路护栏', () => {
  it('imageProvider 缺失 → {regeneratedCount:0,attempts:0}', async () => {
    const r = await runAuditImageRegenerationLoopImpl.call(
      {},
      {
        result: { id: 'p1', slides: makeSlides() } as any,
        plan: undefined,
        imageProvider: null,
        imageConfig: {},
        traceSessionId: 's',
        topic: 't',
        maxRetries: 2,
        designContext: { style: '', primaryColor: '', fontFamily: '', iconStyle: '' },
      } as any,
    );
    expect(r).toEqual({ regeneratedCount: 0, attempts: 0 });
  });
});
