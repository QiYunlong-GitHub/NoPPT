// ================================================================
// AiService · 后处理巨型编排主体（postProcessPresentation）—— 行为锁定测试（characterization）
//
// 目的：在把 postProcessPresentation(2224–3370) 外置到 postprocess/presentation.ts（Phase 5）之前，
// 先锁定「现状编排行为」：
//   1) 返回 Presentation，slides 数与输入一致（LayoutEngine.normalizeAISlide 映射）；
//   2) 入口即调用 5 级 single-source primary 链（resolveFinalEffectivePrimary），
//      并把终局主色写回 presentation.design.primaryColor（用户 primaryColor 优先于 design）；
//   3) 命中「孤儿配图救援」编排（rescueOrphanImages 被调用，无盘上孤儿时返回 0，不抛错）。
//
// 通过 Object.create 打桩 storage / logsService / resolveReferenceVisualAttributes，
// 并令 enableAudit=false（跳过审核块，避免 configService/auditService/VLM 闭环），
// 使方法在无效浏览器/无 LLM 环境下确定性跑通。
// ================================================================
import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AiService } from '../ai.service';

const svc = Object.create(AiService.prototype) as any;

beforeEach(() => {
  vi.restoreAllMocks();
  // —— 桩：storage（终局写盘 / 孤儿扫描都走它，但 listDir 返回空 → 无孤儿）——
  svc.storage = {
    ensurePresentationDir: vi.fn(async () => {}),
    getImagesDir: vi.fn(() => '/tmp/noppt-test/images'),
    listDir: vi.fn(() => []),
    getPresentationDir: vi.fn(() => '/tmp/noppt-test'),
    writeJsonFile: vi.fn(async () => {}),
    saveImageFromUrl: vi.fn(async () => '/data/x.png'),
    readReferenceOriginalImage: vi.fn(() => undefined),
    saveReferenceOriginalImage: vi.fn(async () => ({ url: '/data/x.png' })),
  };
  svc.logsService = { logAICall: vi.fn(async () => {}) };
  // 参考属性缺失时回源解析 → 返回空，逐页参考主色裁决回落 finalEffectivePrimary
  svc.resolveReferenceVisualAttributes = vi.fn(async () => ({ referenceVisualAttributes: null }));
});

function baseParams(overrides: Record<string, unknown> = {}): any {
  return {
    presentationId: 'pres-lock-1',
    slideWidth: 1280,
    slideHeight: 720,
    consoleDetailedLocal: false,
    fileDetailedLocal: false,
    traceSessionId: 'trace-lock-1',
    topic: 'Demo',
    style: 'business',
    audience: 'dev',
    density: 'normal',
    imagePreference: 'all',
    colorTheme: undefined,
    primaryColor: '#2563eb',
    backgroundEnabled: true,
    iconStyle: 'auto',
    fontFamily: 'sans',
    referenceHtml: '',
    referenceImage: '',
    logSettings: undefined,
    logSettingsNormalized: { consoleVerbosity: 'simple', fileVerbosity: 'simple' },
    planningConfig: { provider: 'openai', model: 'gpt-4o' },
    contentConfig: { provider: 'openai', model: 'gpt-4o' },
    editingConfig: { provider: 'openai', model: 'gpt-4o' },
    imageConfig: undefined,
    imageProvider: undefined,
    plan: undefined,
    design: { primaryColor: '#999999' },
    agent: undefined,
    generationOptions: { referenceVisualAttributes: null },
    enableAudit: false,
    integrityCandidateWriter: {
      writeCandidatePresentation: vi.fn(async (candidate: unknown) => {
        await svc.storage.writeJsonFile('/tmp/noppt-test/presentation.json', candidate);
        return candidate;
      }),
    },
    integrityRunId: 'run-lock-1',
    ...overrides,
  };
}

describe('AiService · 后处理编排主体（postProcessPresentation）· 装配与委派', () => {
  it('返回 Presentation，slides 数与输入一致（LayoutEngine.normalizeAISlide 映射）', async () => {
    const presentation: any = {
      title: 'Lock Demo',
      width: 1280,
      height: 720,
      design: { primaryColor: '#999999' },
      slides: [
        { title: 'S1', html: '<div>Hello world</div>', pageType: 'content' },
        { title: 'S2', html: '<section>Bye</section>', pageType: 'content' },
      ],
    };
    const result = await svc.postProcessPresentation(presentation, baseParams());
    expect(result).toBeDefined();
    expect(result.slides).toHaveLength(2);
    expect(result.id).toBe('pres-lock-1');
    expect(result.width).toBe(1280);
    expect(result.height).toBe(720);
  });

  it('入口调用 5 级 single-source primary 链，并把终局主色写回 presentation.design（用户 primaryColor 优先于 design）', async () => {
    const resolveSpy = vi.spyOn(svc, 'resolveFinalEffectivePrimary');
    const presentation: any = {
      title: 'Lock Demo',
      design: { primaryColor: '#999999' },
      slides: [{ title: 'S1', html: '<div>Hello</div>', pageType: 'content' }],
    };
    await svc.postProcessPresentation(presentation, baseParams());
    expect(resolveSpy).toHaveBeenCalledTimes(1);
    // 用户 primaryColor(#2563eb) 优先于 design.primaryColor(#999999) → 终局 #2563eb，并写回 design
    expect(presentation.design.primaryColor).toBe('#2563eb');
  });

  it('命中孤儿配图救援编排（rescueOrphanImages 被调用；无盘上孤儿时返回 0，不抛错）', async () => {
    const orphanSpy = vi.spyOn(svc, 'rescueOrphanImages');
    const presentation: any = {
      title: 'Lock Demo',
      design: { primaryColor: '#999999' },
      slides: [{ title: 'S1', html: '<div>Hello</div>', pageType: 'content' }],
    };
    const result = await svc.postProcessPresentation(presentation, baseParams());
    expect(orphanSpy).toHaveBeenCalledTimes(1);
    // storage.listDir 返回空 → 无孤儿 → 救援计数 0
    expect(orphanSpy.mock.results[0].value).toBe(0);
    // 终局写盘确实被调用
    expect(svc.storage.writeJsonFile).toHaveBeenCalledTimes(1);
    expect(result).toBeDefined();
  });

  it('referenceVisualAttributes 缺失时回源解析（resolveReferenceVisualAttributes 被调用一次）', async () => {
    const presentation: any = {
      title: 'Lock Demo',
      design: { primaryColor: '#999999' },
      slides: [{ title: 'S1', html: '<div>Hello</div>', pageType: 'content' }],
    };
    await svc.postProcessPresentation(presentation, baseParams());
    expect(svc.resolveReferenceVisualAttributes).toHaveBeenCalledTimes(1);
  });

  it('server 端重建 slides 时透传 agent(finalize) 产出的 deck 节点树（端到端落盘 presentation.json）', async () => {
    const deckSlide: any = {
      id: 'slide-0',
      title: 'S1',
      nodes: [
        {
          kind: 'text',
          rect: { x: 0, y: 0, w: 100, h: 50 },
          paragraphs: [{ runs: [{ text: 'Hello' }] }],
        },
      ],
    };
    const presentation: any = {
      title: 'Deck Lock Demo',
      design: { primaryColor: '#999999' },
      slides: [{ title: 'S1', html: '<div>Hello</div>', pageType: 'content', deck: deckSlide }],
    };
    const result = await svc.postProcessPresentation(presentation, baseParams());
    // 1) 返回对象保留 deck（与输入一致）
    expect(result.slides[0].deck).toBeDefined();
    expect(result.slides[0].deck).toEqual(deckSlide);
    // 2) 终局写盘（presentation.json）的内容也包含 deck —— 真正的端到端落盘
    const writeCalls = (svc.storage.writeJsonFile as any).mock.calls;
    expect(writeCalls.length).toBeGreaterThan(0);
    const persisted = writeCalls[writeCalls.length - 1][1]; // (path, content)
    expect(persisted.slides[0].deck).toEqual(deckSlide);
  });
});
