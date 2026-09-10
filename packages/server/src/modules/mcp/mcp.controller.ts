import { Controller, Injectable, Logger, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { IncomingMessage, ServerResponse } from 'http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { JSDOM } from 'jsdom';
import { z } from 'zod';
import type { HTMLPresentation, StageModelConfigs, ImageSize } from '@noppt/ai';
import type { Presentation, Slide } from '@noppt/core';
import type { GeneratePresentationRequest } from '../ai/ai.service';

// ⚠️ 以下三个必须是**值导入**（非 import type）：McpController 为 @Injectable，
// Nest 依赖 design:paramtypes 元数据做构造注入，type-only 导入会导致元数据丢失。
import { ApiKeyService } from '../auth/api-key.service';
import type { McpAuth } from '../auth/api-key.guard';
import { authenticateRequest } from '../auth/api-key.guard';
import { RateLimitService } from '../auth/rate-limit.service';
import { enforceRateLimit } from '../auth/rate-limit.guard';
import { McpError, toMcpError } from '../../common/mcp-errors';
import { readMcpEnv } from '../../common/env';
import { getRequestLocale, translate } from '../../i18n/locale';
import type { Locale } from '../../i18n/types';
import type { McpContext } from './mcp-context';
import { buildMcpContext } from './mcp-context';
import { GenerationQueue } from './generation-queue';
import type { McpJob, McpJobTool } from './generation-queue';
import { buildSelfContainedDeck } from './deck-builder';
import { assertReferenceSizes, truncateReferenceText } from './reference-input';
import { buildOpenUrl, createDraft } from './draft-store';

/** MCP 工具返回值结构（规格 3.3）。用 type 而非 interface，以匹配 SDK 的松散索引签名。 */
type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

type ToolHandler = (
  args: Record<string, unknown>,
  auth: McpAuth,
  ctx: McpContext,
) => Promise<Record<string, unknown>>;

const STYLE_ENUM = ['business', 'tech', 'academic', 'creative'] as const;
const COLOR_THEME_ENUM = ['blue', 'purple', 'green', 'orange', 'teal', 'gray'] as const;
const MAX_SLIDES = 40;
/** `wait=true` 时同步等待上限（规格附录 B）。 */
const MAX_WAIT_MS = 60_000;

const GenerateArgsSchema = z.object({
  topic: z.string().min(1, 'topic 必填').max(500),
  referenceText: z.string().optional(),
  referenceHtml: z.string().optional(),
  referenceImage: z.string().optional(),
  slideCount: z.number().int().min(1).max(MAX_SLIDES).optional(),
  style: z.enum(STYLE_ENUM).optional(),
  audience: z.string().optional(),
  colorTheme: z.enum(COLOR_THEME_ENUM).optional(),
  imageEnabled: z.boolean().optional(),
  sourceCount: z.number().int().nonnegative().optional(),
  wait: z.boolean().optional(),
});

const GetArgsSchema = z.object({
  jobId: z.string().min(1),
  wait: z.boolean().optional(),
  timeoutMs: z.number().int().positive().max(120_000).optional(),
});

const EditSlideArgsSchema = z.object({
  presentationId: z.string().min(1),
  userRequest: z.string().min(1).max(500),
  slideIndex: z.number().int().min(0).optional(),
  primaryColor: z.string().optional(),
  wait: z.boolean().optional(),
});

const EditElementArgsSchema = z.object({
  presentationId: z.string().min(1),
  slideIndex: z.number().int().min(0),
  elementIndex: z.number().int().min(0),
  userRequest: z.string().min(1).max(500),
  wait: z.boolean().optional(),
});

const EditGlobalArgsSchema = z.object({
  presentationId: z.string().min(1),
  userRequest: z.string().min(1).max(500),
  currentSlideIndex: z.number().int().min(0).optional(),
  wait: z.boolean().optional(),
});

const ExportArgsSchema = z.object({ presentationId: z.string().min(1) });

/**
 * `noppt_prepare_outline_draft`（第 8 个工具）：**只备料、不生成**。
 * 用于「IM 拟题 + Web 确认生成」形态——Hermes 自拟主题与 RAG 素材后存草稿，
 * 拿回深链交给用户，由用户在 NoPPT Web 配置页确认后才走原生流水线。
 */
const PrepareDraftArgsSchema = z.object({
  topic: z.string().min(1, 'topic 必填').max(500),
  referenceText: z.string().optional(),
  /** 素材来源标识（如「企业知识库 / RAG」「飞书对话上下文」），仅用于前端展示 */
  referenceSource: z.string().max(100).optional(),
  slideCount: z.number().int().min(1).max(MAX_SLIDES).optional(),
  style: z.enum(STYLE_ENUM).optional(),
  audience: z.string().max(200).optional(),
  colorTheme: z.enum(COLOR_THEME_ENUM).optional(),
  fontFamily: z.enum(['sans', 'serif', 'mono']).optional(),
  iconStyle: z.string().max(50).optional(),
  mode: z.enum(['auto', 'guided']).optional(),
});

function ok(payload: Record<string, unknown>): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
}

function fail(err: unknown, locale: Locale = 'zh-CN'): ToolResult {
  const e = toMcpError(err);
  return { content: [{ type: 'text', text: JSON.stringify(e.toBody(locale)) }], isError: true };
}

/** 把 zod 校验失败映射为规格错误码（E3001 缺 topic / E3005 schema 失败 / E3002 越界）。 */
function fromZod(err: z.ZodError): McpError {
  const first = err.issues?.[0];
  const field = first?.path?.join('.') || '';
  const code = first?.code;
  // topic 缺失（zod v4 对「必填但缺省」报 invalid_type + input=undefined）→ E3001
  const topicMissing = field === 'topic' && (first as { input?: unknown })?.input === undefined;
  if (topicMissing || (field === 'topic' && code === 'too_small')) {
    return new McpError('E3001');
  }
  if (code === 'invalid_type' && !first?.message?.includes('undefined')) {
    return new McpError('E3005', undefined, {
      detail: `${field || 'body'} ${first?.message || ''}`.trim(),
    });
  }
  if (code === 'too_big' || code === 'too_small' || code === 'invalid_value') {
    return new McpError('E3002', undefined, {
      detail: `${field || 'body'} ${first?.message || ''}`.trim(),
    });
  }
  return new McpError('E3005', undefined, {
    detail: `${field || 'body'} ${first?.message || ''}`.trim(),
  });
}

function parseArgs<T extends z.ZodTypeAny>(schema: T, raw: unknown): z.infer<T> {
  const res = schema.safeParse(raw ?? {});
  if (!res.success) throw fromZod(res.error);
  return res.data;
}

@Injectable()
@Controller('mcp')
export class McpController {
  private readonly logger = new Logger(McpController.name);

  constructor(
    private readonly apiKeyService: ApiKeyService,
    public readonly rateLimitService: RateLimitService,
    private readonly queue: GenerationQueue,
  ) {}

  /**
   * `POST /api/mcp`：stateless Streamable HTTP。
   * 认证失败（E1xxx）→ HTTP 401；其余错误 → HTTP 200 + `isError:true`（规格 3.2）。
   */
  @Post()
  async handleMcp(@Req() req: Request, @Res() res: Response): Promise<void> {
    const locale = getRequestLocale(req);
    let auth: McpAuth;
    try {
      auth = await authenticateRequest(req, this.apiKeyService);
    } catch (e) {
      const err = toMcpError(e);
      if (!res.headersSent) res.status(401).json(err.toBody(locale));
      return;
    }

    let ctx: McpContext;
    try {
      ctx = buildMcpContext(auth, req.headers as Record<string, unknown>);
    } catch (e) {
      // 作用域段非法（如身份头含中文/路径穿越字符）→ E4002
      const err = toMcpError(e);
      const status = err.code === 'E4002' ? 400 : 500;
      if (!res.headersSent) res.status(status).json(err.toBody(locale));
      return;
    }

    const server = this.createServer(auth, ctx, locale);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless：每请求独立，不维护 session
      enableJsonResponse: true,
    });
    res.on('close', () => {
      void transport.close().catch(() => undefined);
      void server.close().catch(() => undefined);
    });

    try {
      await server.connect(transport);
      // SDK 期望 Node 原生 IncomingMessage；Express 的 Request 在结构上兼容
      await transport.handleRequest(
        req as unknown as IncomingMessage,
        res as unknown as ServerResponse,
      );
    } catch (e) {
      this.logger.error(`MCP 请求处理失败：${e instanceof Error ? e.message : String(e)}`);
      if (!res.headersSent)
        res
          .status(500)
          .json({ error: 'internal_error', message: translate('MCP 请求处理失败', locale) });
    }
  }

  /** 组装每请求的 MCP Server 与 8 个工具。 */
  private createServer(auth: McpAuth, ctx: McpContext, locale: Locale): Server {
    const server = new Server(
      { name: 'noppt-mcp', version: '1.0.0' },
      { capabilities: { tools: {} } },
    );

    const handlers: Record<string, { bucket?: 'generate' | 'edit'; run: ToolHandler }> = {
      noppt_generate: { bucket: 'generate', run: (args) => this.generate(args, auth, ctx) },
      noppt_get_presentation: { run: (args) => this.getPresentation(args, auth, ctx) },
      noppt_edit_slide: { bucket: 'edit', run: (args) => this.editSlide(args, auth, ctx) },
      noppt_edit_element: { bucket: 'edit', run: (args) => this.editElement(args, auth, ctx) },
      noppt_edit_global: { bucket: 'edit', run: (args) => this.editGlobal(args, auth, ctx) },
      noppt_export_html: { run: (args) => this.exportHtml(args, auth, ctx, locale) },
      noppt_list_templates: { run: () => Promise.resolve(this.listTemplates()) },
      noppt_prepare_outline_draft: { run: (args) => this.prepareOutlineDraft(args, ctx) },
    };

    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: this.toolDefinitions(),
    }));

    server.setRequestHandler(CallToolRequestSchema, async (request): Promise<ToolResult> => {
      const name = String(request.params?.name || '');
      const entry = handlers[name];
      if (!entry) {
        return fail(new McpError('E3005', undefined, { detail: `未知工具：${name}` }), locale);
      }
      const args = (request.params?.arguments ?? {}) as Record<string, unknown>;
      try {
        if (entry.bucket) enforceRateLimit(this.rateLimitService, entry.bucket, auth);
        const payload = await entry.run(args, auth, ctx);
        // `wait=true` 时任务结果直接随本次调用返回：失败即按 MCP 语义标记 isError（规格 2.7）
        if (payload && payload.status === 'failed' && payload.error) {
          return { content: [{ type: 'text', text: JSON.stringify(payload) }], isError: true };
        }
        return ok(payload);
      } catch (e) {
        return fail(e, locale);
      }
    });

    return server;
  }

  private toolDefinitions() {
    return [
      {
        name: 'noppt_generate',
        description:
          '生成一份演示（异步）。调用前请先完成信息收集：检索知识库 / 解析用户上传文件 / 联网搜索。' +
          '意图映射：用户给的是资料内容（文档/网页文字）→ referenceText；用户说「以这个为模板 / 参考这种风格样式」且上传 HTML → referenceHtml，' +
          '上传图片 → referenceImage（图片转 base64 data URL 内联）；不要要求用户提供全文；topic 只写主题；' +
          '.pptx 不能作为模板，需提示另存为 HTML 或截图。返回 jobId，用 noppt_get_presentation 轮询。',
        inputSchema: {
          type: 'object',
          required: ['topic'],
          properties: {
            topic: {
              type: 'string',
              maxLength: 500,
              description: '演示主题（仅主题，不含素材全文）',
            },
            referenceText: {
              type: 'string',
              maxLength: 20000,
              description: 'RAG 文本素材（知识库/文件/搜索整理稿）',
            },
            referenceHtml: {
              type: 'string',
              description: '版式/视觉参考 HTML（内联），非内容素材',
            },
            referenceImage: { type: 'string', description: '参考图 data URL 或 http(s) URL' },
            slideCount: { type: 'integer', minimum: 1, maximum: MAX_SLIDES },
            style: { type: 'string', enum: [...STYLE_ENUM] },
            audience: { type: 'string' },
            colorTheme: { type: 'string', enum: [...COLOR_THEME_ENUM] },
            imageEnabled: { type: 'boolean', default: true },
            sourceCount: { type: 'integer', description: '素材来源条数，仅审计用' },
            wait: { type: 'boolean', default: false, description: 'true 时最多同步等待 60s' },
          },
        },
      },
      {
        name: 'noppt_get_presentation',
        description:
          '轮询异步任务状态（generate / edit_slide / edit_element / edit_global 通用）。',
        inputSchema: {
          type: 'object',
          required: ['jobId'],
          properties: {
            jobId: { type: 'string' },
            wait: { type: 'boolean', default: false },
            timeoutMs: { type: 'integer', description: '同步等待上限，默认 60000' },
          },
        },
      },
      {
        name: 'noppt_edit_slide',
        description: '编辑指定单页（0-based；缺省为当前选中页或第 0 页）。',
        inputSchema: {
          type: 'object',
          required: ['presentationId', 'userRequest'],
          properties: {
            presentationId: { type: 'string' },
            userRequest: { type: 'string', maxLength: 500 },
            slideIndex: { type: 'integer', minimum: 0 },
            primaryColor: { type: 'string' },
            wait: { type: 'boolean', default: true },
          },
        },
      },
      {
        name: 'noppt_edit_element',
        description:
          '按 elements[elementIndex].selector 定位并编辑单个元素。selector 缺失或匹配失败直接报错且不做任何写操作。',
        inputSchema: {
          type: 'object',
          required: ['presentationId', 'slideIndex', 'elementIndex', 'userRequest'],
          properties: {
            presentationId: { type: 'string' },
            slideIndex: { type: 'integer', minimum: 0 },
            elementIndex: { type: 'integer', minimum: 0 },
            userRequest: { type: 'string', maxLength: 500 },
            wait: { type: 'boolean', default: true },
          },
        },
      },
      {
        name: 'noppt_edit_global',
        description: '整份演示级编辑（配色/字体/页数可变）。返回页数 > 40 时报错。',
        inputSchema: {
          type: 'object',
          required: ['presentationId', 'userRequest'],
          properties: {
            presentationId: { type: 'string' },
            userRequest: { type: 'string', maxLength: 500 },
            currentSlideIndex: { type: 'integer', minimum: 0 },
            wait: { type: 'boolean', default: true },
          },
        },
      },
      {
        name: 'noppt_export_html',
        description: '导出自包含 HTML（资源内联 data URL，可离线打开）。',
        inputSchema: {
          type: 'object',
          required: ['presentationId'],
          properties: { presentationId: { type: 'string' } },
        },
      },
      {
        name: 'noppt_list_templates',
        description: '列出可用的 style / colorTheme 枚举与内置模板。',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'noppt_prepare_outline_draft',
        description:
          '【只备料、不生成】把自拟的演示主题与 RAG 素材存为草稿，返回一条深链（openUrl），' +
          '由用户在 NoPPT Web 的「AI 生成演示」配置页确认后再生成。' +
          '当用户只描述了需求、尚未要求立刻产出 PPT，或需要用户先把关主题/素材时使用本工具；' +
          '若用户明确要求直接产出成片，请改用 noppt_generate。' +
          'referenceText 填知识库/对话上下文整理出的权威素材，会在 planning 阶段注入大纲 prompt；' +
          '素材长度按 slideCount 分档自动裁剪（每页约 800 字，上限 20000）。',
        inputSchema: {
          type: 'object',
          required: ['topic'],
          properties: {
            topic: { type: 'string', maxLength: 500, description: '自拟的演示主题（≤500 字）' },
            referenceText: { type: 'string', description: 'RAG / 对话上下文整理出的权威素材文本' },
            referenceSource: {
              type: 'string',
              maxLength: 100,
              description: '素材来源标识，如「企业知识库 / RAG」，仅前端展示',
            },
            slideCount: { type: 'integer', minimum: 1, maximum: MAX_SLIDES },
            style: { type: 'string', enum: [...STYLE_ENUM] },
            audience: { type: 'string', maxLength: 200 },
            colorTheme: { type: 'string', enum: [...COLOR_THEME_ENUM] },
            fontFamily: { type: 'string', enum: ['sans', 'serif', 'mono'] },
            iconStyle: { type: 'string', maxLength: 50 },
            mode: {
              type: 'string',
              enum: ['auto', 'guided'],
              default: 'auto',
              description: '配置页预选的生成模式，默认全自动',
            },
          },
        },
      },
    ];
  }

  // ——————————————————————————— 工具实现 ———————————————————————————

  private async generate(
    rawArgs: Record<string, unknown>,
    auth: McpAuth,
    ctx: McpContext,
  ): Promise<Record<string, unknown>> {
    const args = parseArgs(GenerateArgsSchema, rawArgs);
    const env = readMcpEnv();

    // 素材大小校验 + referenceText 硬截断（规格 2.5.8）
    assertReferenceSizes(
      { referenceHtml: args.referenceHtml, referenceImage: args.referenceImage },
      env,
    );
    const { referenceText, truncated } = truncateReferenceText(
      args.referenceText,
      env.maxRefTextChars,
    );

    const jobId = this.queue.enqueue(
      'generate',
      ctx,
      {
        ...args,
        referenceText,
        truncated,
      },
      async (jobCtx, jobArgs, jobIdInQueue) => this.runGenerate(jobCtx, jobArgs, jobIdInQueue),
    );

    const base = { jobId, tool: 'generate' as const, truncated };
    if (args.wait) {
      const job = await this.queue.waitFor(jobId, MAX_WAIT_MS);
      return { ...base, ...this.jobPayload(job) };
    }
    return { ...base, status: 'queued' };
  }

  /** 生成任务主体：解析模型配置 → 调 AiService（scoped）→ 写审计。 */
  private async runGenerate(
    ctx: McpContext,
    args: Record<string, unknown>,
    jobId: string,
  ): Promise<Record<string, unknown>> {
    const startedAt = Date.now();
    const tool = 'generate';
    const referenceText = typeof args.referenceText === 'string' ? args.referenceText : undefined;

    await ctx.audit({
      keyId: ctx.keyId,
      tenantId: ctx.tenantId,
      userKey: ctx.userKey,
      jobId,
      tool,
      startedAt,
      status: 'running',
      referenceTextChars: referenceText?.length ?? 0,
      hasReferenceHtml: !!args.referenceHtml,
      hasReferenceImage: !!args.referenceImage,
      truncated: !!args.truncated,
      sourceCount: typeof args.sourceCount === 'number' ? args.sourceCount : undefined,
    });

    try {
      const modelConfigs = await this.resolveStageModelConfigs(ctx);
      const { imageConfig, imagePreference, degraded } = await this.resolveImageConfig(
        ctx,
        args.imageEnabled !== false,
      );
      // M8：`referenceText` 由 `GeneratePresentationRequest` 新增字段承载（见 ai.service.ts）。
      const generateRequest: GeneratePresentationRequest & { referenceText?: string } = {
        topic: String(args.topic),
        modelConfigs,
        style: args.style as string | undefined,
        audience: args.audience as string | undefined,
        slideCount: args.slideCount as number | undefined,
        colorTheme: args.colorTheme as never,
        imagePreference: imagePreference as never,
        imageConfig: imageConfig as never,
        referenceHtml: args.referenceHtml as string | undefined,
        referenceImage: args.referenceImage as string | undefined,
        referenceText,
      };
      const presentation = await ctx.aiService.generatePresentation(generateRequest);

      const result = {
        presentationId: presentation.id,
        title: presentation.title,
        slideCount: presentation.slides?.length ?? 0,
        viewUrl: `${ctx.previewBase}/${presentation.id}`,
        imagesDegraded: degraded,
        // 轮询结果同样回传截断标记（规格 2.5.8：超长截断需对调用方可见）
        truncated: !!args.truncated,
      };
      await this.auditFinish(ctx, jobId, tool, startedAt, 'done', {
        presentationId: presentation.id,
      });
      return result;
    } catch (e) {
      await this.auditFinish(ctx, jobId, tool, startedAt, 'failed', {
        error: toMcpError(e).toBody().error,
      });
      throw e;
    }
  }

  /**
   * `noppt_prepare_outline_draft`：只落草稿并返回深链，**绝不触发 LLM、不生成演示**。
   * 返回的 `note` 明确提示「仅备料，未生成」，避免模型误判为已产出成片。
   */
  private async prepareOutlineDraft(
    rawArgs: Record<string, unknown>,
    ctx: McpContext,
  ): Promise<Record<string, unknown>> {
    const args = parseArgs(PrepareDraftArgsSchema, rawArgs);
    const startedAt = Date.now();

    const rec = await createDraft(
      {
        topic: args.topic,
        referenceText: args.referenceText,
        style: args.style,
        audience: args.audience,
        slideCount: args.slideCount,
        colorTheme: args.colorTheme,
        fontFamily: args.fontFamily,
        iconStyle: args.iconStyle,
        mode: args.mode,
      },
      { tenant: ctx.tenantId, user: ctx.userKey },
      args.referenceSource,
    );

    await ctx.audit({
      keyId: ctx.keyId,
      tenantId: ctx.tenantId,
      userKey: ctx.userKey,
      jobId: `draft_${rec.draftId}`,
      tool: 'prepare_outline_draft',
      startedAt,
      finishedAt: Date.now(),
      durationMs: Date.now() - startedAt,
      status: 'done',
      referenceTextChars: rec.meta.referenceTextChars,
      truncated: rec.meta.truncated,
    });

    return {
      draftId: rec.draftId,
      openUrl: buildOpenUrl(rec),
      expiresAt: new Date(rec.expiresAt).toISOString(),
      mode: rec.params.mode,
      topic: rec.params.topic,
      meta: {
        referenceTextChars: rec.meta.referenceTextChars,
        originalChars: rec.meta.originalChars,
        limitApplied: rec.meta.limitApplied,
        truncated: rec.meta.truncated,
        source: rec.meta.source,
      },
      note: '仅备料，未生成演示。请把 openUrl 发给用户，由其在 NoPPT Web 配置页确认后生成。',
    };
  }

  private async getPresentation(
    rawArgs: Record<string, unknown>,
    _auth: McpAuth,
    _ctx: McpContext,
  ): Promise<Record<string, unknown>> {
    const args = parseArgs(GetArgsSchema, rawArgs);
    let job = this.queue.get(args.jobId as string);
    if (!job) throw new McpError('E5006', undefined, { jobId: String(args.jobId) });
    const terminal = job.status === 'done' || job.status === 'failed';
    if (!terminal && (args.wait || args.timeoutMs)) {
      job = await this.queue.waitFor(args.jobId as string, args.timeoutMs ?? MAX_WAIT_MS);
    }
    return this.jobPayload(job);
  }

  /** 统一的任务轮询返回体（规格 3.3.2）。 */
  private jobPayload(job: McpJob): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      jobId: job.jobId,
      status: job.status,
      tool: job.tool,
    };
    if (job.status === 'done') {
      Object.assign(payload, job.result ?? {});
      payload.error = null;
    } else if (job.status === 'failed') {
      payload.error = job.error ?? { code: 'E5005', message: '任务失败' };
    }
    return payload;
  }

  private async exportHtml(
    rawArgs: Record<string, unknown>,
    _auth: McpAuth,
    ctx: McpContext,
    locale: Locale,
  ): Promise<Record<string, unknown>> {
    const args = parseArgs(ExportArgsSchema, rawArgs);
    const presentation = await this.loadScopedPresentation(ctx, args.presentationId as string);
    const deck = await buildSelfContainedDeck(presentation, ctx.storage, locale);
    return { format: 'html', content: deck.html, slideCount: presentation.slides.length };
  }

  private listTemplates(): Record<string, unknown> {
    return {
      styles: [
        { id: 'business', name: '商务' },
        { id: 'tech', name: '科技' },
        { id: 'academic', name: '学术' },
        { id: 'creative', name: '创意' },
      ],
      colorThemes: COLOR_THEME_ENUM.map((id) => ({ id })),
      templates: [
        { id: 'business', name: '商务' },
        { id: 'tech', name: '科技' },
        { id: 'academic', name: '学术' },
        { id: 'creative', name: '创意' },
      ],
    };
  }

  // ——————————————————————————— 编辑工具（M6） ———————————————————————————

  private async editSlide(
    rawArgs: Record<string, unknown>,
    auth: McpAuth,
    ctx: McpContext,
  ): Promise<Record<string, unknown>> {
    const args = parseArgs(EditSlideArgsSchema, rawArgs);
    const jobId = this.queue.enqueue(
      'edit_slide',
      ctx,
      args as Record<string, unknown>,
      async (jobCtx, jobArgs, id) => this.runEdit('edit_slide', jobCtx, jobArgs, id),
    );
    return await this.finishOrQueue(jobId, args.wait !== false);
  }

  private async editElement(
    rawArgs: Record<string, unknown>,
    auth: McpAuth,
    ctx: McpContext,
  ): Promise<Record<string, unknown>> {
    const args = parseArgs(EditElementArgsSchema, rawArgs);
    const jobId = this.queue.enqueue(
      'edit_element',
      ctx,
      args as Record<string, unknown>,
      async (jobCtx, jobArgs, id) => this.runEdit('edit_element', jobCtx, jobArgs, id),
    );
    return await this.finishOrQueue(jobId, args.wait !== false);
  }

  private async editGlobal(
    rawArgs: Record<string, unknown>,
    auth: McpAuth,
    ctx: McpContext,
  ): Promise<Record<string, unknown>> {
    const args = parseArgs(EditGlobalArgsSchema, rawArgs);
    const jobId = this.queue.enqueue(
      'edit_global',
      ctx,
      args as Record<string, unknown>,
      async (jobCtx, jobArgs, id) => this.runEdit('edit_global', jobCtx, jobArgs, id),
    );
    return await this.finishOrQueue(jobId, args.wait !== false);
  }

  private async finishOrQueue(jobId: string, wait: boolean): Promise<Record<string, unknown>> {
    if (!wait) return { jobId, status: 'queued' };
    const job = await this.queue.waitFor(jobId, MAX_WAIT_MS);
    return this.jobPayload(job);
  }

  private async runEdit(
    tool: McpJobTool,
    ctx: McpContext,
    args: Record<string, unknown>,
    jobId: string,
  ): Promise<Record<string, unknown>> {
    const startedAt = Date.now();
    const presentationId = String(args.presentationId);
    await ctx.audit({
      keyId: ctx.keyId,
      tenantId: ctx.tenantId,
      userKey: ctx.userKey,
      jobId,
      tool,
      startedAt,
      status: 'running',
      presentationId,
    });

    try {
      const modelConfigs = await this.resolveStageModelConfigs(ctx);
      const presentation = await this.loadScopedPresentation(ctx, presentationId);
      let result: Record<string, unknown>;

      if (tool === 'edit_slide') {
        const index = this.resolveSlideIndex(presentation, args.slideIndex as number | undefined);
        const slide = presentation.slides[index];
        if (!slide) throw new McpError('E5002', undefined, { index });
        const { html } = await ctx.aiService.editSlide({
          modelConfigs,
          presentationId,
          currentHtml: slide.html,
          userRequest: String(args.userRequest),
          primaryColor: args.primaryColor as string | undefined,
        });
        slide.html = html;
        slide.updatedAt = Date.now();
        await ctx.presentationService.save(presentation.id, presentation);
        result = { presentationId, editResult: { slideIndex: index, html } };
      } else if (tool === 'edit_element') {
        const slideIndex = Number(args.slideIndex);
        const elementIndex = Number(args.elementIndex);
        const slide = presentation.slides[slideIndex];
        if (!slide) throw new McpError('E5002', undefined, { index: slideIndex });
        const element = slide.elements?.[elementIndex];
        const selector = element?.selector;
        if (!selector) {
          throw new McpError('E5003', undefined, { slideIndex, elementIndex });
        }
        const dom = new JSDOM(`<body>${slide.html}</body>`);
        const node = dom.window.document.querySelector(selector);
        if (!node) {
          // 动态 selector 无法参数化，保留原始中文文案（en 环境回退中文）
          throw new McpError('E5003', `selector 在当前页未匹配到节点：${selector}`);
        }
        const { html } = await ctx.aiService.editElement({
          modelConfigs,
          presentationId,
          elementHtml: node.outerHTML,
          userRequest: String(args.userRequest),
        });
        node.outerHTML = html;
        slide.html = dom.window.document.body.innerHTML;
        slide.updatedAt = Date.now();
        if (element) {
          const tagMatch = /^<([a-zA-Z][\w-]*)/.exec(html.trim());
          if (tagMatch) element.tag = tagMatch[1];
        }
        await ctx.presentationService.save(presentation.id, presentation);
        result = { presentationId, editResult: { slideIndex, elementIndex, html } };
      } else {
        const htmlPresentation: HTMLPresentation = {
          title: presentation.title,
          slides: presentation.slides.map((s) => ({
            title: s.title,
            html: s.html,
            notes: s.notes,
          })),
          width: presentation.width,
          height: presentation.height,
        };
        const updated = await ctx.aiService.editGlobal({
          modelConfigs,
          presentationId,
          presentation: htmlPresentation,
          currentSlideIndex: Number(args.currentSlideIndex ?? 0),
          userRequest: String(args.userRequest),
        });
        const nextSlides = updated?.slides ?? [];
        if (nextSlides.length > MAX_SLIDES) {
          throw new McpError('E5004', undefined, { count: nextSlides.length, max: MAX_SLIDES });
        }
        const now = Date.now();
        presentation.slides = nextSlides.map((s, i) => {
          const prev = presentation.slides[i];
          return {
            id: prev?.id || `${presentation.id}-s${i}`,
            title: s.title || prev?.title || `第 ${i + 1} 页`,
            html: s.html || '',
            notes: s.notes ?? prev?.notes,
            elements: prev?.elements,
            hidden: prev?.hidden ?? false,
            index: i,
            createdAt: prev?.createdAt ?? now,
            updatedAt: now,
          } as Slide;
        });
        if (updated?.title) presentation.title = updated.title;
        await ctx.presentationService.save(presentation.id, presentation);
        result = {
          presentationId,
          editResult: {
            slideCount: presentation.slides.length,
            slides: presentation.slides.map((s, i) => ({
              index: i,
              title: s.title,
              htmlLength: s.html.length,
            })),
          },
        };
      }

      await this.auditFinish(ctx, jobId, tool, startedAt, 'done', { presentationId });
      return result;
    } catch (e) {
      await this.auditFinish(ctx, jobId, tool, startedAt, 'failed', {
        presentationId,
        error: toMcpError(e).toBody().error,
      });
      throw e;
    }
  }

  // ——————————————————————————— 公共辅助 ———————————————————————————

  /**
   * 读取当前作用域内的演示。
   * 读不到一律按「不属于当前作用域」处理（E4001）——presentationId 为 uuid，
   * 作用域目录天然隔离，无需额外比对（规格 2.6 / E4001）。
   */
  private async loadScopedPresentation(
    ctx: McpContext,
    presentationId: string,
  ): Promise<Presentation> {
    const presentation = await ctx.presentationService.get(presentationId);
    if (!presentation) {
      throw new McpError('E4001', undefined, { id: presentationId });
    }
    return presentation;
  }

  private resolveSlideIndex(presentation: Presentation, requested?: number): number {
    if (typeof requested === 'number' && Number.isFinite(requested)) {
      if (requested < 0 || requested >= presentation.slides.length) {
        // 动态文案（含页数），保留原始中文（en 环境回退中文）
        throw new McpError(
          'E5002',
          `slideIndex ${requested} 越界（共 ${presentation.slides.length} 页）`,
        );
      }
      return requested;
    }
    const selected = presentation.slides.findIndex((s) => s.id === presentation.selectedSlideId);
    return selected >= 0 ? selected : 0;
  }

  /** 从 ConfigService 解析各阶段模型配置（服务器级 config.json）。 */
  private async resolveStageModelConfigs(ctx: McpContext): Promise<StageModelConfigs> {
    const stages = ['planning', 'content', 'editing', 'audit', 'auditVlm'] as const;
    const resolved: Partial<Record<(typeof stages)[number], unknown>> = {};
    for (const stage of stages) {
      const cfg = await ctx.configService.resolveModelConfig(stage);
      if (cfg) resolved[stage] = cfg;
    }
    const primary = resolved.planning ?? resolved.content;
    if (!primary) {
      throw new McpError('E5005', '服务端尚未配置可用的模型，请先在「设置」中完成模型配置');
    }
    const fallback = resolved.content ?? primary;
    return {
      planning: primary,
      content: fallback,
      editing: resolved.editing ?? fallback,
      audit: resolved.audit ?? fallback,
      auditVlm: resolved.auditVlm ?? fallback,
    } as StageModelConfigs;
  }

  /** 由服务器级图片配置推导 imageConfig；未配置时降级为不生成配图（imagePreference=none）。 */
  private async resolveImageConfig(
    ctx: McpContext,
    imageEnabled: boolean,
  ): Promise<{ imageConfig: Record<string, unknown>; imagePreference: string; degraded: boolean }> {
    if (!imageEnabled) {
      return {
        imageConfig: { enabled: false, useDefaultProvider: true },
        imagePreference: 'none',
        degraded: false,
      };
    }
    const config = await ctx.configService.getConfig();
    const ig = config?.imageGeneration;
    const providerConfig = ig?.providers?.[ig.activeProvider];
    const model = providerConfig?.models?.[0];
    if (!ig?.enabled || !providerConfig || !model) {
      return {
        imageConfig: { enabled: false, useDefaultProvider: true },
        imagePreference: 'none',
        degraded: true,
      };
    }
    const size = model.sizes?.[0];
    return {
      imageConfig: {
        enabled: true,
        useDefaultProvider: !!ig.useDefaultApiKey,
        provider: ig.activeProvider,
        model: model.modelName,
        size: size ? (`${size.width}x${size.height}` as ImageSize) : undefined,
        modelConfig: {
          provider: ig.activeProvider,
          apiKey: providerConfig.apiKey || '',
          baseUrl: providerConfig.baseUrl || '',
        },
      },
      imagePreference: 'content-only',
      degraded: false,
    };
  }

  private async auditFinish(
    ctx: McpContext,
    jobId: string,
    tool: string,
    startedAt: number,
    status: string,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    const finishedAt = Date.now();
    await ctx.audit({
      keyId: ctx.keyId,
      tenantId: ctx.tenantId,
      userKey: ctx.userKey,
      jobId,
      tool,
      startedAt,
      finishedAt,
      durationMs: finishedAt - startedAt,
      status,
      ...extra,
    });
  }
}
