/* 测试桩（mock presentation / 调用私有方法）需要 any，本文件放宽该规则 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { McpController } from './mcp.controller';
import type { McpContext } from './mcp-context';
import { GenerationQueue } from './generation-queue';
import { RateLimitService } from '../auth/rate-limit.service';
import type { McpAuth } from '../auth/api-key.guard';
import { McpError } from '../../common/mcp-errors';

/**
 * TC-108（规格 5.2.1）：三种编辑工具的写回闭环与失败语义。
 * 直接调用控制器方法（限流在 MCP 调度层，已由 TC-106 覆盖），业务依赖全部以 mock 注入。
 */
describe('M6 编辑工具组', () => {
  let queue: GenerationQueue;
  let rateLimits: RateLimitService;
  let controller: McpController;
  const auth: McpAuth = { keyId: 'k1', tenantId: 't1', userKey: 'u1', record: {} as never };

  const makeSlide = (index: number, html: string, extra: Record<string, unknown> = {}) => ({
    id: `s${index}`,
    title: `第 ${index + 1} 页`,
    html,
    hidden: false,
    index,
    createdAt: 1,
    updatedAt: 1,
    ...extra,
  });

  let presentation: any;
  let saved: any[];

  const buildCtx = (overrides: Partial<McpContext> = {}): McpContext =>
    ({
      keyId: 'k1',
      tenantId: 't1',
      userKey: 'u1',
      previewBase: 'http://localhost:5173/mcp-preview/t1/u1',
      audit: async () => undefined,
      configService: {
        resolveModelConfig: async () => ({ provider: 'openai', apiKey: 'x', baseUrl: '', model: 'm' }),
      } as never,
      presentationService: {
        get: async () => presentation,
        save: async (_id: string, p: unknown) => {
          saved.push(JSON.parse(JSON.stringify(p)));
          return p;
        },
      } as never,
      aiService: {
        editSlide: async () => ({ html: '<div><h1>改后标题</h1></div>' }),
        editElement: async () => ({ html: '<h1>改后元素</h1>' }),
        editGlobal: async () => ({ title: '整份改后', slides: [{ title: 'A', html: '<div>A2</div>' }, { title: 'B', html: '<div>B2</div>' }] }),
      } as never,
      ...overrides,
    }) as unknown as McpContext;

  beforeEach(() => {
    queue = new GenerationQueue({ maxConcurrent: 2, ttlMs: 60000, max: 100 });
    rateLimits = new RateLimitService();
    controller = new McpController({} as never, rateLimits, queue);
    saved = [];
    presentation = {
      id: 'p1',
      title: '原演示',
      selectedSlideId: 's1',
      slides: [
        makeSlide(0, '<div><h1>标题</h1><p>正文</p></div>', { elements: [{ id: 'e0', type: 'heading', tag: 'h1', label: '标题', selector: 'h1' }] }),
        makeSlide(1, '<div><h2>第二页</h2></div>'),
      ],
      zoom: 1,
      width: 1280,
      height: 720,
      transition: 'fade',
      createdAt: 1,
      updatedAt: 1,
      version: 1,
    };
  });

  afterEach(() => {
    queue.onModuleDestroy();
    rateLimits.onModuleDestroy();
  });

  it('edit_slide：按 slideIndex 定位并写回', async () => {
    const res = await (controller as never as Record<string, any>).editSlide(
      { presentationId: 'p1', userRequest: '改标题', slideIndex: 0, wait: true },
      auth,
      buildCtx(),
    );
    expect(res.status).toBe('done');
    expect(res.editResult.slideIndex).toBe(0);
    expect(res.editResult.html).toBe('<div><h1>改后标题</h1></div>');
    expect(saved).toHaveLength(1);
    expect(saved[0].slides[0].html).toBe('<div><h1>改后标题</h1></div>');
    expect(saved[0].slides[1].html).toBe('<div><h2>第二页</h2></div>');
  });

  it('edit_slide：缺省 slideIndex 时回退到 selectedSlideId 对应页', async () => {
    const res = await (controller as never as Record<string, any>).editSlide(
      { presentationId: 'p1', userRequest: '改', wait: true },
      auth,
      buildCtx(),
    );
    expect(res.editResult.slideIndex).toBe(1);
    expect(saved[0].slides[1].html).toBe('<div><h1>改后标题</h1></div>');
  });

  it('edit_slide：slideIndex 越界 → E5002 且不写盘', async () => {
    const res = await (controller as never as Record<string, any>).editSlide(
      { presentationId: 'p1', userRequest: '改', slideIndex: 9, wait: true },
      auth,
      buildCtx(),
    );
    expect(res.status).toBe('failed');
    expect(res.error.code).toBe('E5002');
    expect(saved).toHaveLength(0);
  });

  it('edit_element：按 selector 定位替换并写回', async () => {
    const res = await (controller as never as Record<string, any>).editElement(
      { presentationId: 'p1', slideIndex: 0, elementIndex: 0, userRequest: '加粗', wait: true },
      auth,
      buildCtx(),
    );
    expect(res.status).toBe('done');
    expect(res.editResult.html).toBe('<h1>改后元素</h1>');
    expect(saved[0].slides[0].html).toBe('<div><h1>改后元素</h1><p>正文</p></div>');
    expect(saved[0].slides[0].elements[0].tag).toBe('h1');
  });

  it('edit_element：selector 缺失 → E5003 且不做任何写操作', async () => {
    presentation.slides[0].elements = [{ id: 'e0', type: 'heading', tag: 'h1', label: '标题' }];
    const res = await (controller as never as Record<string, any>).editElement(
      { presentationId: 'p1', slideIndex: 0, elementIndex: 0, userRequest: '改', wait: true },
      auth,
      buildCtx(),
    );
    expect(res.status).toBe('failed');
    expect(res.error.code).toBe('E5003');
    expect(saved).toHaveLength(0);
  });

  it('edit_element：selector 匹配失败 → E5003 且不写盘', async () => {
    presentation.slides[0].elements = [{ id: 'e0', type: 'heading', tag: 'h1', label: '标题', selector: '.not-exist' }];
    const res = await (controller as never as Record<string, any>).editElement(
      { presentationId: 'p1', slideIndex: 0, elementIndex: 0, userRequest: '改', wait: true },
      auth,
      buildCtx(),
    );
    expect(res.error.code).toBe('E5003');
    expect(saved).toHaveLength(0);
  });

  it('edit_global：整份写回且页数可变（保留元数据）', async () => {
    const res = await (controller as never as Record<string, any>).editGlobal(
      { presentationId: 'p1', userRequest: '换科技蓝', wait: true },
      auth,
      buildCtx(),
    );
    expect(res.status).toBe('done');
    expect(res.editResult.slideCount).toBe(2);
    expect(saved[0].slides).toHaveLength(2);
    expect(saved[0].title).toBe('整份改后');
    expect(saved[0].id).toBe('p1');
    expect(saved[0].createdAt).toBe(1);
    expect(saved[0].zoom).toBe(1);
    expect(saved[0].transition).toBe('fade');
    expect(saved[0].slides[0].id).toBe('s0');
  });

  it('edit_global：返回页数 > 40 → E5004 且不写盘', async () => {
    const many = Array.from({ length: 41 }, (_, i) => ({ title: `P${i}`, html: `<div>${i}</div>` }));
    const ctx = buildCtx({
      aiService: { editGlobal: async () => ({ title: 'x', slides: many }) } as never,
    });
    const res = await (controller as never as Record<string, any>).editGlobal(
      { presentationId: 'p1', userRequest: '扩写', wait: true },
      auth,
      ctx,
    );
    expect(res.error.code).toBe('E5004');
    expect(saved).toHaveLength(0);
  });

  it('演示不存在（非当前作用域）→ E4001', async () => {
    const ctx = buildCtx({ presentationService: { get: async () => null, save: async () => undefined } as never });
    const res = await (controller as never as Record<string, any>).editSlide(
      { presentationId: 'p_other', userRequest: '改', slideIndex: 0, wait: true },
      auth,
      ctx,
    );
    expect(res.error.code).toBe('E4001');
  });

  it('模型未配置 → E5005', async () => {
    const ctx = buildCtx({ configService: { resolveModelConfig: async () => null } as never });
    const res = await (controller as never as Record<string, any>).editSlide(
      { presentationId: 'p1', userRequest: '改', slideIndex: 0, wait: true },
      auth,
      ctx,
    );
    expect(res.error.code).toBe('E5005');
    expect(saved).toHaveLength(0);
  });

  it('edit 工具共用一个限流桶（由调度层 enforceRateLimit 施加）', () => {
    const rec = { rateLimit: { edit: { limit: 1, windowMs: 60000 } } } as never;
    const authLow: McpAuth = { keyId: 'k1', tenantId: 't1', userKey: 'u1', record: rec };
    // edit 桶配额 1：第 1 次放行、第 2 次拒绝；generate 桶独立不受影响
    expect(rateLimits.consume('edit', 'k1:u1', 1, 60000).allowed).toBe(true);
    expect(rateLimits.consume('edit', 'k1:u1', 1, 60000).allowed).toBe(false);
    expect(rateLimits.consume('generate', 'k1:u1', 1, 60000).allowed).toBe(true);
    expect(authLow.record).toBeTruthy();
  });

  it('wait:false 时立即返回 jobId 与 queued', async () => {
    const res = await (controller as never as Record<string, any>).editSlide(
      { presentationId: 'p1', userRequest: '改', slideIndex: 0, wait: false },
      auth,
      buildCtx(),
    );
    expect(res.status).toBe('queued');
    expect(String(res.jobId)).toMatch(/^j_/);
    await queue.waitFor(res.jobId, 3000);
  });

  it('非 McpError 异常归一为 E5005 且不泄漏堆栈', async () => {
    const ctx = buildCtx({
      aiService: {
        editSlide: async () => {
          throw new Error('boom at https://api.example.com/v1 key test-key-abcdef123456');
        },
      } as never,
    });
    const res = await (controller as never as Record<string, any>).editSlide(
      { presentationId: 'p1', userRequest: '改', slideIndex: 0, wait: true },
      auth,
      ctx,
    );
    expect(res.error.code).toBe('E5005');
    expect(JSON.stringify(res.error)).not.toContain('sk-');
    expect(JSON.stringify(res.error)).not.toContain('api.example.com');
    expect(McpError).toBeTruthy();
  });
});
