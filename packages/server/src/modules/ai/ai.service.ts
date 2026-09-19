import {
  collectImageRefs,
  isLocalAssetUrl,
  replaceImageUrlInHtml,
  mapRatioToSize,
  extractRatioFromImgTag,
  _serverHasBareText,
  ensureSemanticWrapping,
} from './utils/html-string';
import { Injectable, BadRequestException } from '@nestjs/common';
import type {
  ModelConfig,
  StageModelConfigs,
  ContentDensity,
  ImagePreference,
  ColorTheme,
  ImageSize,
  IconStyle,
  LogConfig,
  PresentationPlan,
  DesignProposal,
  RenderedSlide,
  CritiqueConfig,
  SlidePageType,
  ReferenceVisualAttributes,
  CategoryReference,
  ReferenceContext,
} from '@noppt/ai';
import {
  OpenAIProvider,
  AnthropicProvider,
  FreeAIProvider,
  QwenImageProvider,
  SeedreamProvider,
  createChatProvider,
  extractReferenceHtmlAttributes,
  extractReferenceImageAttributes,
  mergeReferenceAttrs,
  assembleReferenceVisualAttributes,
  formatBeijingTime,
  setLogConfig,
  normalizeLogConfig,
  isConsoleDetailed,
  simpleLog,
  isFileDetailed,
  openTraceSession,
  closeTraceSession,
  setSessionStage,
  getLLMTraces,
  getImageTraces,
  replaceImagePlaceholderWithRealSrc,
  type VlmTextProvider,
  type TraceableProvider,
  type LLMCallTrace,
  type ImageGenerationTrace,
  countStyleRules,
} from '@noppt/ai';
import {
  HTMLPresentationAgent,
  extractSlideCountSpec,
  extractPageStructureHints,
  IMAGE_PLACEHOLDER,
  type HTMLPresentation,
} from '@noppt/ai/agents';
import {
  styleViolationSignal,
  exceedsThreshold,
  collectStyleViolationSamples,
  formatStyleViolationSamplesSummary,
  type StyleViolationBreakdown,
  resolveEffectivePrimaryColor,
  resolveReferencePrimaryColor,
  resolveDeckReferencePrimaryColor,
  resolveFinalPagePrimaryColor,
  getReferencePaletteForPage,
  isStructurePage,
} from '@noppt/ai';
import type { Presentation, Slide } from '@noppt/core';
import { LayoutEngine } from '@noppt/core';
import { SlideRenderer, runVlmCritique, type VlmReviewResult } from '@noppt/audit';
import { StorageService } from '../../common/storage.service';
import { LogsService } from '../logs/logs.service';
import { AuditService } from '../audit/audit.service';
import { ConfigService } from '../config/config.service';
import { sanitizeHtmlServerSide } from '../../utils/sanitize';
import { join } from 'path';
import { buildHtmlAuditHookImpl, runPostImageVlmTriageLoopImpl, runAuditImageRegenerationLoopImpl } from './audit/audit-loops';
import { existsSync, readFileSync } from 'fs';
import * as os from 'os';
import { runHtmlPlaceholderAuditLoop } from './html-audit-loop';
import { triageSlideIssues } from './triage-vlm-issues';
import { computeRefAttrsHash as _computeRefAttrsHash } from './reference/reference-attrs';
import { collectAppliedReferenceFields as _collectAppliedReferenceFields, buildReferenceBrief as _buildReferenceBrief, attachMasterLogoSources as _attachMasterLogoSources } from './reference/reference-brief';
import { injectOrphanImageIntoSlide as _injectOrphanImageIntoSlide, inferImagePreferenceFromPresentation as _inferImagePreferenceFromPresentation, visibleTextLength as _visibleTextLengthFn, rescueOrphanImages as _rescueOrphanImages } from './postprocess/orphan-image';
import { postProcessPresentationImpl } from './postprocess/presentation';
import { resolveReferenceForGeneration as _resolveReferenceForGeneration, resolveFinalEffectivePrimary as _resolveFinalEffectivePrimary } from './reference/resolve-for-generation';
import { backfillReferenceOriginalSources as _backfillReferenceOriginalSources, persistReferenceOriginals as _persistReferenceOriginals } from './reference/reference-originals';

export interface GeneratePresentationRequest {
  topic: string;
  modelConfig?: ModelConfig;
  modelConfigs?: StageModelConfigs;
  imageConfig?: {
    enabled: boolean;
    useDefaultProvider: boolean;
    provider?: string;
    model?: string;
    size?: string;
    gatewayVendor?: string;
    allModels?: Array<{
      modelName: string;
      sizes: Array<{ width: number; height: number; label?: string }>;
      pixelRanges?: Array<{ minPixels: number; maxPixels: number; label?: string }>;
    }>;
    routing?: {
      enabled: boolean;
      coverModelIndex?: number;
      contentModelIndex?: number;
      secondaryModelIndex?: number;
    };
    modelConfig?: ModelConfig & { provider?: string };
  };
  style?: string;
  audience?: string;
  slideCount?: number;
  slideCountMin?: number;
  slideCountMax?: number;
  density?: ContentDensity;
  imagePreference?: ImagePreference;
  colorTheme?: ColorTheme;
  primaryColor?: string;
  backgroundEnabled?: boolean;
  iconStyle?: IconStyle;
  fontFamily?: 'sans' | 'serif' | 'mono';
  referenceHtml?: string;
  referenceImage?: string;
  referenceHtmlCover?: string;
  referenceHtmlContent?: string;
  referenceHtmlSummary?: string;
  referenceHtmlGlobal?: string;
  referenceImageCover?: string;
  referenceImageContent?: string;
  referenceImageSummary?: string;
  referenceImageGlobal?: string;
  referenceImageCoverOriginal?: string;
  referenceImageContentOriginal?: string;
  referenceImageSummaryOriginal?: string;
  refAttrsVersion?: string;
  /**
   * RAG 文本素材（M8）：由 Hermes 侧检索/解析/联网搜索后整理的内容稿。
   * 与 `referenceHtml`（版式/视觉参考）语义不同——这是**内容素材**，
   * 会在 planning 阶段以「权威素材」段注入大纲 prompt。
   */
  referenceText?: string;
  presentationId?: string;
  traceSessionId?: string;
  slideWidth?: number;
  slideHeight?: number;
  /** 生成内容的输出语言（前端传入 UI 语言码）；缺省中文。 */
  language?: 'zh-CN' | 'en';
  logSettings?: LogConfig;
  critique?: CritiqueConfig;
  enableAudit?: boolean;
}

export interface PlanPresentationRequest extends GeneratePresentationRequest {}

export interface GenerateFromPlanRequest extends GeneratePresentationRequest {
  plan: PresentationPlan;
}

export interface DesignProposalsRequest extends GeneratePresentationRequest {
  plan: PresentationPlan;
  /** 设计方案数：1 用于全自动降本；默认 3 用于引导式 3 选 1。非数字或 <1 视为 3；>20 cap 为 20。 */
  proposalCount?: number;
}

export interface RenderSlidesRequest extends GeneratePresentationRequest {
  plan: PresentationPlan;
  design: DesignProposal;
  startIndex?: number;
  endIndex?: number;
}

export interface AssembleImagesRequest extends GeneratePresentationRequest {
  plan: PresentationPlan;
  design: DesignProposal;
  slides: RenderedSlide[];
}

export interface RegenerateSlideRequest extends GeneratePresentationRequest {
  plan: PresentationPlan;
  design: DesignProposal;
  slideIndex: number;
  slides?: RenderedSlide[];
}

export interface FinalizeRequest extends GeneratePresentationRequest {
  plan: PresentationPlan;
  design: DesignProposal;
  slides: RenderedSlide[];
}

export interface EditSlideRequest {
  modelConfig?: ModelConfig;
  modelConfigs?: StageModelConfigs;
  presentationId?: string;
  currentHtml: string;
  userRequest: string;
  primaryColor?: string;
  logSettings?: LogConfig;
}

export interface EditElementRequest {
  modelConfig?: ModelConfig;
  modelConfigs?: StageModelConfigs;
  presentationId?: string;
  elementHtml: string;
  userRequest: string;
  logSettings?: LogConfig;
}

export interface EditGlobalRequest {
  modelConfig?: ModelConfig;
  modelConfigs?: StageModelConfigs;
  presentationId?: string;
  presentation: HTMLPresentation;
  currentSlideIndex: number;
  userRequest: string;
  logSettings?: LogConfig;
}



// —— r6 Task1: 后处理版本标识日志（模块级防重复打印，确保每个进程只打一次）——
let postProcessVersionLogged = false;

// —— r6 Task5: 慢模型 / 会话级连续超时告警状态（模块级）——
const slowModelWarned = new Set<string>();
const sessionTimeoutCount = new Map<string, number>();

function getSessionKey(trace: string | undefined): string {
  return trace || 'anon';
}


// —— Task1 / FR-1: server 端终局防线已重构为三分量结构化 styleViolationSignal（见 @noppt/ai 包）。
// 旧的 hexToHsl / hueDelta / 单数字 styleViolationSignal 函数已被 ai 包版本替代并统一维护，
// 避免 server 内与 agent 内两份实现漂移导致误判差异（本规格 AC-4 根因之一）。
// ai.service.ts 中所有旧 styleViolationSignal(number) 调用点已替换为 breakdown + exceedsThreshold 版本。

@Injectable()
export class AiService {
  constructor(
    private readonly storage: StorageService,
    private readonly logsService: LogsService,
    private readonly auditService: AuditService,
    private readonly configService: ConfigService,
  ) {
    // r6 Task1: 打印后处理版本标识（进程级仅一次）。
    // @noppt/ai 的 POST_VERSION_SIG 当前未被 server 可用的类型入口导出（ai 包在另一侧改造中），
    // 故此处用字符串常量，需与 packages/ai/src/agents/html-presentation-agent.ts 的
    // `export const POST_VERSION_SIG` 值保持同步。
    const POST_VERSION_SIG = 'enforceSinglePalette:sanitizeStyleSyntax:assertGrid8pt:r4';
    if (!postProcessVersionLogged) {
      console.log(`[POST] 后处理版本已加载: ${POST_VERSION_SIG}`);
      postProcessVersionLogged = true;
    }
  }

  private createProvider(config: ModelConfig) {
    switch (config.provider) {
      case 'openai':
      case 'company-gateway':
        return new OpenAIProvider(config);
      case 'anthropic':
        return new AnthropicProvider(config);
      case 'freeai':
        return new FreeAIProvider(config);
      case 'qwen':
        return new QwenImageProvider(config as any);
      case 'seedream':
        return new SeedreamProvider(config as any);
      default:
        return new OpenAIProvider(config);
    }
  }

  private createImageProvider(config: any, gatewayVendor?: string) {
    const effectiveProvider =
      config.provider === 'company-gateway' ? gatewayVendor || 'openai' : config.provider;
    switch (effectiveProvider) {
      case 'openai':
        return new OpenAIProvider(config);
      case 'qwen':
        return new QwenImageProvider(config);
      case 'seedream':
        return new SeedreamProvider(config);
      case 'freeai':
        return new FreeAIProvider(config);
      default:
        return new OpenAIProvider(config);
    }
  }

  private createAgentContext(req: GeneratePresentationRequest, traceSessionId?: string) {
    const { modelConfig, modelConfigs, imageConfig, imagePreference, presentationId, logSettings } =
      req;

    const logSettingsNormalized: LogConfig = {
      consoleVerbosity: 'detailed',
      fileVerbosity: 'detailed',
      ...normalizeLogConfig(logSettings || {}),
    };
    setLogConfig(logSettingsNormalized);
    const consoleDetailedLocal: boolean = logSettingsNormalized.consoleVerbosity === 'detailed';
    const fileDetailedLocal: boolean = logSettingsNormalized.fileVerbosity === 'detailed';
    if (consoleDetailedLocal) {
      console.log(
        `[${formatBeijingTime()}] [AI:LOG] 本次请求 logSettings：req=${
          logSettings ? JSON.stringify(logSettings) : '(未传)'
        } → normalized=${JSON.stringify(logSettingsNormalized)}`,
      );
    } else {
      simpleLog(
        'AI:LOG',
        `本次请求 logSettings 最终：console=${logSettingsNormalized.consoleVerbosity} file=${logSettingsNormalized.fileVerbosity}`,
        {
          raw: logSettings ? JSON.stringify(logSettings) : 'absent',
        },
      );
    }

    const requestWantsImages: boolean =
      imagePreference === 'all' ||
      imagePreference === 'content-only' ||
      imagePreference === 'minimal';
    const imageSwitchOff: boolean = !imageConfig?.enabled;
    if (requestWantsImages && imageSwitchOff) {
      const prefTextMap: Record<string, string> = {
        all: '全生成（封面/目录/内容/总结页均配图）',
        'content-only': '仅内容页配图',
        minimal: '精简（关键页配图）',
      };
      const prefText = prefTextMap[imagePreference || ''] || imagePreference;
      const msg =
        `配置冲突：你在「高级排版选项」中选择了"配图偏好 = ${prefText}"，` +
        `但在「设置 → AI图片生成」中未开启"自动生成配图"开关。` +
        `请先前往「设置 → AI图片生成」打开开关并配置好模型后再重试，` +
        `或把本次的「配图偏好」改为"不生成图片（none）"。`;
      console.warn(`[${formatBeijingTime()}] [AI:CONFIG-CONFLICT] ${msg}`);
      throw new BadRequestException(msg);
    }

    const planningConfig = modelConfigs?.planning || modelConfig!;
    const contentConfig: ModelConfig = { ...(modelConfigs?.content || modelConfig!), disableThinking: (modelConfigs?.content || modelConfig!)?.disableThinking ?? true };
    const editingConfig = modelConfigs?.editing || modelConfig!;

    const planningProvider = this.createProvider(planningConfig);
    const contentProvider = this.createProvider(contentConfig);
    const editingProvider = this.createProvider(editingConfig);

    const effectiveTraceSessionId =
      traceSessionId ||
      presentationId ||
      `trace_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    openTraceSession(effectiveTraceSessionId);
    (planningProvider as TraceableProvider).activeTraceSessionId = effectiveTraceSessionId;
    (contentProvider as TraceableProvider).activeTraceSessionId = effectiveTraceSessionId;
    (editingProvider as TraceableProvider).activeTraceSessionId = effectiveTraceSessionId;

    let imageProvider: any = null;
    if (imageConfig?.enabled) {
      if (imageConfig.useDefaultProvider) {
        const mergedConfig = {
          provider: imageConfig.modelConfig?.provider || imageConfig.provider,
          apiKey: planningConfig.apiKey,
          baseUrl: imageConfig.modelConfig?.baseUrl || '',
          model: imageConfig.model || imageConfig.modelConfig?.model || 'dall-e-3',
        };
        if (consoleDetailedLocal) {
          console.log(
            `[${formatBeijingTime()}] [AI] Image provider merged config (useDefaultProvider):`,
            {
              provider: mergedConfig.provider,
              baseUrl: mergedConfig.baseUrl,
              model: mergedConfig.model,
              gatewayVendor: imageConfig.gatewayVendor,
              hasApiKey: !!mergedConfig.apiKey,
            },
          );
        } else {
          simpleLog('AI:IMG', '开始生成图片', {
            provider: mergedConfig.provider,
            model: mergedConfig.model,
          });
        }
        imageProvider = this.createImageProvider(mergedConfig as any, imageConfig.gatewayVendor);
      } else if (imageConfig.modelConfig) {
        const mergedConfig = {
          ...imageConfig.modelConfig,
          baseUrl: imageConfig.modelConfig.baseUrl || '',
          model: imageConfig.model || imageConfig.modelConfig.model,
        };
        if (consoleDetailedLocal) {
          console.log(`[${formatBeijingTime()}] [AI] Image provider config (separate key):`, {
            provider: mergedConfig.provider,
            baseUrl: mergedConfig.baseUrl,
            model: mergedConfig.model,
            gatewayVendor: imageConfig.gatewayVendor,
            hasApiKey: !!mergedConfig.apiKey,
          });
        } else {
          simpleLog('AI:IMG', '开始生成图片', {
            provider: mergedConfig.provider,
            model: mergedConfig.model,
          });
        }
        imageProvider = this.createImageProvider(mergedConfig as any, imageConfig.gatewayVendor);
      }
      if (imageProvider && typeof imageProvider === 'object') {
        (imageProvider as TraceableProvider).activeTraceSessionId = effectiveTraceSessionId;
      }
    }

    const agent = new HTMLPresentationAgent(planningProvider, {
      planningProvider,
      contentProvider,
      editingProvider,
    });

    const imageOptions = imageConfig?.enabled
      ? {
          enabled: true,
          model: imageConfig.model,
          size: imageConfig.size as ImageSize,
          allModels: imageConfig.allModels,
          routing: imageConfig.routing,
        }
      : undefined;

    return {
      agent,
      planningProvider,
      contentProvider,
      editingProvider,
      imageProvider,
      imageOptions,
      traceSessionId: effectiveTraceSessionId,
      consoleDetailedLocal,
      fileDetailedLocal,
      logSettingsNormalized,
      planningConfig,
      contentConfig,
      editingConfig,
    };
  }

  async generatePresentation(req: GeneratePresentationRequest): Promise<Presentation> {
    const {
      topic,
      modelConfig,
      modelConfigs,
      imageConfig,
      style,
      audience,
      slideCount,
      slideCountMin,
      slideCountMax,
      density,
      imagePreference,
      colorTheme,
      primaryColor,
      backgroundEnabled,
      iconStyle,
      fontFamily,
      referenceHtml,
      referenceImage,
      referenceText,
      presentationId,
      slideWidth,
      slideHeight,
      logSettings,
      enableAudit,
      language,
    } = req;

    // ——— 注入本次请求的日志级别（覆盖默认配置）———
    // 关键：使用"本次请求的本地变量"而不是依赖全局 runtimeConfig 判断，
    //      避免多请求并发下全局单例被别的请求污染。
    const logSettingsNormalized: LogConfig = {
      consoleVerbosity: 'detailed',
      fileVerbosity: 'detailed',
      ...normalizeLogConfig(logSettings || {}),
    };
    setLogConfig(logSettingsNormalized);
    // 本地副本：console/文件 是否详细。**所有 if 分支都用这两个变量判断，不依赖全局 isXxxDetailed()**。
    const consoleDetailedLocal: boolean = logSettingsNormalized.consoleVerbosity === 'detailed';
    const fileDetailedLocal: boolean = logSettingsNormalized.fileVerbosity === 'detailed';
    if (consoleDetailedLocal) {
      console.log(
        `[${formatBeijingTime()}] [AI:LOG] 本次请求 logSettings：req=${
          logSettings ? JSON.stringify(logSettings) : '(未传)'
        } → normalized=${JSON.stringify(logSettingsNormalized)}`,
      );
    } else {
      simpleLog(
        'AI:LOG',
        `本次请求 logSettings 最终：console=${logSettingsNormalized.consoleVerbosity} file=${logSettingsNormalized.fileVerbosity}`,
        {
          raw: logSettings ? JSON.stringify(logSettings) : 'absent',
        },
      );
    }

    if (consoleDetailedLocal) {
      console.log(`[${formatBeijingTime()}] [AI] === 开始生成演示文稿 ===`);
      console.log(`[${formatBeijingTime()}] [AI] topic:`, topic);
      console.log(
        `[${formatBeijingTime()}] [AI] style:`,
        style,
        '| audience:',
        audience,
        '| density:',
        density,
      );
      console.log(
        `[${formatBeijingTime()}] [AI] imagePreference:`,
        imagePreference,
        '| colorTheme:',
        colorTheme,
      );
      console.log(`[${formatBeijingTime()}] [AI] slideCount:`, {
        exact: slideCount,
        min: slideCountMin,
        max: slideCountMax,
      });
    } else {
      simpleLog('AI', '开始生成幻灯片', {
        topic: topic.length > 30 ? topic.substring(0, 30) + '…' : topic,
        style: style || '-',
        slides: slideCount || 'auto',
      });
    }

    // ================ ★ 配置一致性校验（修复：高级排版选项 vs 设置页开关冲突）★ ================
    // 场景：用户在生成页高级选项里选了 imagePreference=all / content-only / minimal（"我要生成图片"），
    //       但在「设置 → AI图片生成」里的总开关 imageConfig.enabled=false（"我关掉了图片生成"）。
    // 旧代码：静默把 imageProvider=null, imageOptions=undefined 传给 Agent
    //       → Agent plan.slides 里 needsImage=true，但实际生成阶段 provider 为空 → 不可预期的
    //         报错/NOPPT 占位图保留/空图等各种不一致。
    // 新逻辑（三档处理）：
    //   1) pref=none / 与开关一致 → 没问题
    //   2) pref=all / content-only / minimal，且 enabled=false  → 直接 BadRequest，明确提示用户去打开开关
    //   3) （防御）plan 阶段 needsImage=true 但实际 imageOptions=undefined → agent 内部兜底转 none
    const requestWantsImages: boolean =
      imagePreference === 'all' ||
      imagePreference === 'content-only' ||
      imagePreference === 'minimal';
    const imageSwitchOff: boolean = !imageConfig?.enabled;
    if (requestWantsImages && imageSwitchOff) {
      const prefTextMap: Record<string, string> = {
        all: '全生成（封面/目录/内容/总结页均配图）',
        'content-only': '仅内容页配图',
        minimal: '精简（关键页配图）',
      };
      const prefText = prefTextMap[imagePreference || ''] || imagePreference;
      const msg =
        `配置冲突：你在「高级排版选项」中选择了"配图偏好 = ${prefText}"，` +
        `但在「设置 → AI图片生成」中未开启"自动生成配图"开关。` +
        `请先前往「设置 → AI图片生成」打开开关并配置好模型后再重试，` +
        `或把本次的「配图偏好」改为"不生成图片（none）"。`;
      console.warn(`[${formatBeijingTime()}] [AI:CONFIG-CONFLICT] ${msg}`);
      throw new BadRequestException(msg);
    }
    // ================ ★ END: 一致性校验 ★ ================

    const planningConfig = modelConfigs?.planning || modelConfig!;
    const contentConfig: ModelConfig = { ...(modelConfigs?.content || modelConfig!), disableThinking: (modelConfigs?.content || modelConfig!)?.disableThinking ?? true };
    const editingConfig = modelConfigs?.editing || modelConfig!;

    if (
      !/plus|max/i.test(String(contentConfig?.model || '').toLowerCase()) &&
      /flash/i.test(String(contentConfig?.model || '').toLowerCase())
    ) {
      console.warn(
        `[MODEL] 当前生成模型为 flash 档（${contentConfig?.model}），质量建议 ≥ plus 档；如需高质量请调整模型路由（不影响本次流程）。`,
      );
    }

    const planningProvider = this.createProvider(planningConfig);
    const contentProvider = this.createProvider(contentConfig);
    const editingProvider = this.createProvider(editingConfig);

    // ——— 打开 LLM 调用追踪会话（无截断完整报文），并绑定到三个 provider ———
    // 如果已有 presentationId 就复用，否则生成临时 traceId，保证 provider 第一次 chat 之前 sessionId 就存在
    const traceSessionId =
      presentationId || `trace_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    openTraceSession(traceSessionId);
    (planningProvider as TraceableProvider).activeTraceSessionId = traceSessionId;
    (contentProvider as TraceableProvider).activeTraceSessionId = traceSessionId;
    (editingProvider as TraceableProvider).activeTraceSessionId = traceSessionId;
    // 稍后在生成结束后 closeTraceSession(traceSessionId) 取出所有 traces

    let imageProvider: any = null;
    if (imageConfig?.enabled) {
      if (imageConfig.useDefaultProvider) {
        const mergedConfig = {
          provider: imageConfig.modelConfig?.provider || imageConfig.provider,
          apiKey: planningConfig.apiKey,
          baseUrl: imageConfig.modelConfig?.baseUrl || '',
          model: imageConfig.model || imageConfig.modelConfig?.model || 'dall-e-3',
        };
        if (consoleDetailedLocal) {
          console.log(
            `[${formatBeijingTime()}] [AI] Image provider merged config (useDefaultProvider):`,
            {
              provider: mergedConfig.provider,
              baseUrl: mergedConfig.baseUrl,
              model: mergedConfig.model,
              gatewayVendor: imageConfig.gatewayVendor,
              hasApiKey: !!mergedConfig.apiKey,
            },
          );
        } else {
          simpleLog('AI:IMG', '开始生成图片', {
            provider: mergedConfig.provider,
            model: mergedConfig.model,
          });
        }
        imageProvider = this.createImageProvider(mergedConfig as any, imageConfig.gatewayVendor);
      } else if (imageConfig.modelConfig) {
        const mergedConfig = {
          ...imageConfig.modelConfig,
          baseUrl: imageConfig.modelConfig.baseUrl || '',
          model: imageConfig.model || imageConfig.modelConfig.model,
        };
        if (consoleDetailedLocal) {
          console.log(`[${formatBeijingTime()}] [AI] Image provider config (separate key):`, {
            provider: mergedConfig.provider,
            baseUrl: mergedConfig.baseUrl,
            model: mergedConfig.model,
            gatewayVendor: imageConfig.gatewayVendor,
            hasApiKey: !!mergedConfig.apiKey,
          });
        } else {
          simpleLog('AI:IMG', '开始生成图片', {
            provider: mergedConfig.provider,
            model: mergedConfig.model,
          });
        }
        imageProvider = this.createImageProvider(mergedConfig as any, imageConfig.gatewayVendor);
      }
      // ——— 关键：给 imageProvider 也绑定 trace session id，这样 generateImage 内部的 recordTrace() 才能正确写入
      if (imageProvider && typeof imageProvider === 'object') {
        (imageProvider as TraceableProvider).activeTraceSessionId = traceSessionId;
      }
    }

    const agent = new HTMLPresentationAgent(planningProvider, {
      planningProvider,
      contentProvider,
      editingProvider,
    });

    const imageOptions = imageConfig?.enabled
      ? {
          enabled: true,
          model: imageConfig.model,
          size: imageConfig.size as ImageSize,
          allModels: imageConfig.allModels,
          routing: imageConfig.routing,
        }
      : undefined;

    const htmlAuditMaxRetries = req.critique?.maxRetries ?? 1;

    // r6 Task5: 对内容大调用（整次 generatePresentation 内涵盖规划/内容/图片）做耗时与超时告警。
    // 包装点说明：在整个生成调用外围 try/finally，覆盖最贴近生成的大耗时路径；若内部 content 级
    // 更细的超时（agent 内部重试 catch）则位于 @noppt/ai，本服务不做改动。
    const genKey = getSessionKey(traceSessionId);
    let presentation: HTMLPresentation;
    const genT0 = Date.now();
    // 提升声明：referenceVisualAttributes 在 try 内赋值，但在 try/finally 之后的
    // postProcessPresentation(...) 入参中仍需使用（FR-15 等依赖 generationOptions.referenceVisualAttributes）。
    let referenceVisualAttributes: ReferenceVisualAttributes | null | undefined;
    let referenceHtmlBrief = '';
    try {
      const refGen = await this.resolveReferenceForGeneration(req);
      referenceVisualAttributes = refGen.referenceVisualAttributes;
      referenceHtmlBrief = refGen.referenceHtmlBrief;
      const referenceOriginals = await this.persistReferenceOriginals(req);
      this.attachMasterLogoSources(referenceVisualAttributes, referenceOriginals);
      presentation = await agent.generatePresentation(topic, {
        style,
        audience,
        slideCount,
        slideCountMin,
        slideCountMax,
        density: density || 'normal',
        imagePreference: imagePreference || 'content-only',
        colorTheme,
        primaryColor,
        imageOptions,
        imageProvider: imageProvider || undefined,
        referenceImage: referenceImage || undefined,
        referenceHtml: referenceHtml || undefined,
        referenceText: referenceText || undefined,
        referenceVisualAttributes,
        referenceHtmlBrief,
        slideWidth: slideWidth || 1280,
        slideHeight: slideHeight || 720,
        backgroundEnabled: backgroundEnabled || false,
        iconStyle: iconStyle || 'auto',
        fontFamily: fontFamily || 'sans',
        language: (language === 'en' ? 'en' : 'zh') as 'en' | 'zh',
        onProgress: () => {},
        critique: req.critique,
        postHtmlAuditHook: this.buildHtmlAuditHook({
          referenceVisualAttributes,
          referenceHtmlBrief,
          agent,
          topic,
          options: {
            style,
            audience,
            slideCount,
            slideCountMin,
            slideCountMax,
            density: density || 'normal',
            imagePreference: imagePreference || 'content-only',
            colorTheme,
            primaryColor,
            imageOptions,
            referenceImage: referenceImage || undefined,
            referenceHtml: referenceHtml || undefined,
            referenceVisualAttributes,
            slideWidth: slideWidth || 1280,
            slideHeight: slideHeight || 720,
            backgroundEnabled: backgroundEnabled || false,
            iconStyle: iconStyle || 'auto',
            fontFamily: fontFamily || 'sans',
            language: language === 'en' ? 'en' : 'zh',
            critique: req.critique,
            onProgress: () => {},
          },
          maxRetries: htmlAuditMaxRetries,
          slideWidth: slideWidth || 1280,
          slideHeight: slideHeight || 720,
        }),
      });
    } catch (genErr) {
      // r6 Task5: 会话级连续超时告警（不自动切换、不重试）
      const gMsg = genErr instanceof Error ? genErr.message : String(genErr);
      if (/fetch failed|ETIMEDOUT|timeout|ECONN|socket/i.test(gMsg)) {
        const c = (sessionTimeoutCount.get(genKey) || 0) + 1;
        sessionTimeoutCount.set(genKey, c);
        if (c % 2 === 0) {
          console.warn('[MODEL] 连续 2 次超时，请检查模型网关或切换模型', {
            key: genKey,
            model: contentConfig?.model,
          });
        }
      }
      throw genErr;
    } finally {
      // r6 Task5: 单次生成耗时过长提示（每模型去重一次）
      const genDt = Date.now() - genT0;
      const genModel = String(contentConfig?.model || 'anon');
      if (genDt > 120000 && !slowModelWarned.has(genModel)) {
        console.warn(`[MODEL] 单次生成耗时过长(${genModel} ${genDt}ms)，建议切换 plus/max 档`);
        slowModelWarned.add(genModel);
      }
    }

    return await this.postProcessPresentation(presentation, {
      presentationId,
      slideWidth,
      slideHeight,
      consoleDetailedLocal,
      fileDetailedLocal,
      traceSessionId,
      topic,
      style,
      audience,
      slideCount,
      slideCountMin,
      slideCountMax,
      density,
      imagePreference,
      colorTheme,
      primaryColor,
      backgroundEnabled,
      iconStyle,
      fontFamily,
      referenceHtml,
      referenceImage,
      logSettings,
      logSettingsNormalized,
      planningConfig,
      contentConfig,
      editingConfig,
      imageConfig,
      imageProvider,
      plan: (presentation as any).plan,
      design: (presentation as any).design,
      agent,
      generationOptions: {
        style,
        audience,
        slideCount,
        slideCountMin,
        slideCountMax,
        density: density || 'normal',
        imagePreference: imagePreference || 'content-only',
        colorTheme,
        primaryColor,
        imageOptions,
        referenceImage: referenceImage || undefined,
        referenceHtml: referenceHtml || undefined,
        referenceVisualAttributes,
        slideWidth: slideWidth || 1280,
        slideHeight: slideHeight || 720,
        backgroundEnabled: backgroundEnabled || false,
        iconStyle: iconStyle || 'auto',
        fontFamily: fontFamily || 'sans',
        critique: req.critique,
      },
      enableAudit,
    });
  }

  async planPresentation(req: PlanPresentationRequest): Promise<PresentationPlan> {
    const {
      topic,
      modelConfig,
      modelConfigs,
      imageConfig,
      style,
      audience,
      slideCount,
      slideCountMin,
      slideCountMax,
      density,
      imagePreference,
      colorTheme,
      primaryColor,
      backgroundEnabled,
      iconStyle,
      fontFamily,
      referenceHtml,
      referenceText,
      slideWidth,
      slideHeight,
      presentationId,
      logSettings,
    } = req;

    const logSettingsNormalized: LogConfig = {
      consoleVerbosity: 'detailed',
      fileVerbosity: 'detailed',
      ...normalizeLogConfig(logSettings || {}),
    };
    setLogConfig(logSettingsNormalized);
    const consoleDetailedLocal: boolean = logSettingsNormalized.consoleVerbosity === 'detailed';
    const fileDetailedLocal: boolean = logSettingsNormalized.fileVerbosity === 'detailed';
    if (consoleDetailedLocal) {
      console.log(
        `[${formatBeijingTime()}] [AI:LOG] 本次请求 logSettings：req=${
          logSettings ? JSON.stringify(logSettings) : '(未传)'
        } → normalized=${JSON.stringify(logSettingsNormalized)}`,
      );
    } else {
      simpleLog(
        'AI:LOG',
        `本次请求 logSettings 最终：console=${logSettingsNormalized.consoleVerbosity} file=${logSettingsNormalized.fileVerbosity}`,
        {
          raw: logSettings ? JSON.stringify(logSettings) : 'absent',
        },
      );
    }

    if (consoleDetailedLocal) {
      console.log(`[${formatBeijingTime()}] [AI] === 开始规划演示文稿（仅计划阶段）===`);
      console.log(`[${formatBeijingTime()}] [AI] topic:`, topic);
      console.log(
        `[${formatBeijingTime()}] [AI] style:`,
        style,
        '| audience:',
        audience,
        '| density:',
        density,
      );
      console.log(
        `[${formatBeijingTime()}] [AI] imagePreference:`,
        imagePreference,
        '| colorTheme:',
        colorTheme,
      );
      console.log(`[${formatBeijingTime()}] [AI] slideCount:`, {
        exact: slideCount,
        min: slideCountMin,
        max: slideCountMax,
      });
    } else {
      simpleLog('AI', '开始规划幻灯片', {
        topic: topic.length > 30 ? topic.substring(0, 30) + '…' : topic,
        style: style || '-',
        slides: slideCount || 'auto',
      });
    }

    const requestWantsImages: boolean =
      imagePreference === 'all' ||
      imagePreference === 'content-only' ||
      imagePreference === 'minimal';
    const imageSwitchOff: boolean = !imageConfig?.enabled;
    if (requestWantsImages && imageSwitchOff) {
      const prefTextMap: Record<string, string> = {
        all: '全生成（封面/目录/内容/总结页均配图）',
        'content-only': '仅内容页配图',
        minimal: '精简（关键页配图）',
      };
      const prefText = prefTextMap[imagePreference || ''] || imagePreference;
      const msg =
        `配置冲突：你在「高级排版选项」中选择了"配图偏好 = ${prefText}"，` +
        `但在「设置 → AI图片生成」中未开启"自动生成配图"开关。` +
        `请先前往「设置 → AI图片生成」打开开关并配置好模型后再重试，` +
        `或把本次的「配图偏好」改为"不生成图片（none）"。`;
      console.warn(`[${formatBeijingTime()}] [AI:CONFIG-CONFLICT] ${msg}`);
      throw new BadRequestException(msg);
    }

    const planningConfig = modelConfigs?.planning || modelConfig!;
    const contentConfig: ModelConfig = { ...(modelConfigs?.content || modelConfig!), disableThinking: (modelConfigs?.content || modelConfig!)?.disableThinking ?? true };
    const editingConfig = modelConfigs?.editing || modelConfig!;

    const planningProvider = this.createProvider(planningConfig);
    const contentProvider = this.createProvider(contentConfig);
    const editingProvider = this.createProvider(editingConfig);

    const traceSessionId =
      presentationId || `trace_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    openTraceSession(traceSessionId);
    (planningProvider as TraceableProvider).activeTraceSessionId = traceSessionId;
    (contentProvider as TraceableProvider).activeTraceSessionId = traceSessionId;
    (editingProvider as TraceableProvider).activeTraceSessionId = traceSessionId;

    const agent = new HTMLPresentationAgent(planningProvider, {
      planningProvider,
      contentProvider,
      editingProvider,
    });

    let slideSpec:
      | { exact: number; min?: undefined; max?: undefined }
      | { min: number; max: number; exact?: undefined };
    if (typeof slideCountMin === 'number' && typeof slideCountMax === 'number') {
      const min = Math.max(1, Math.min(slideCountMin, slideCountMax));
      const max = Math.max(1, Math.max(slideCountMin, slideCountMax));
      slideSpec = { min, max };
    } else if (typeof slideCount === 'number') {
      slideSpec = { exact: Math.max(1, slideCount) };
    } else {
      const topicSpec = extractSlideCountSpec(topic);
      slideSpec = topicSpec || { exact: 8 };
    }

    const pageHints = extractPageStructureHints(topic);

    // Task 2/3：4 类参考属性全文提取 + 图片 VLM 提取 + assemble（替代旧的 slice(0,500) 截断）
    const refAttrRes = await this.resolveReferenceVisualAttributes(req);
    const referenceVisualAttributes = refAttrRes.referenceVisualAttributes ?? null;
    const refAttrsVersion = refAttrRes.refAttrsVersion;
    // FR-2.x：参考主色纳入单源链（参考 > 用户显式 > 默认蓝），落实架构「参考最高优先级」
    const refDeckPrimary = resolveDeckReferencePrimaryColor(referenceVisualAttributes);
    const resolvedPrimaryColor =
      refDeckPrimary ??
      (primaryColor && /^#[0-9a-fA-F]{6}$/.test(primaryColor) ? primaryColor : '#2563eb');
    const referenceOriginals = await this.persistReferenceOriginals(req);
    this.attachMasterLogoSources(referenceVisualAttributes, referenceOriginals);
    const referenceHtmlBrief = this.buildReferenceBrief(referenceVisualAttributes);

    let plan: PresentationPlan | null = null;
    let planError: Error | null = null;
    try {
      plan = await agent.generatePlan(
        topic,
        style || 'business',
        audience || '',
        slideSpec,
        density || 'normal',
        imagePreference || 'content-only',
        resolvedPrimaryColor,
        () => {},
        backgroundEnabled || false,
        pageHints,
        iconStyle || 'auto',
        fontFamily || 'sans',
        colorTheme,
        referenceHtmlBrief,
        imageConfig?.enabled ?? false,
        referenceVisualAttributes,
        // 第 17 参：RAG 文本素材（referenceText）。透传给 buildPlanningPrompt 注入「权威素材」段。
        // 与 HTML/视觉那路的 referenceHtmlBrief / referenceVisualAttributes 相互独立、互不影响。
        referenceText || '',
      );

      if (consoleDetailedLocal) {
        console.log(
          `[${formatBeijingTime()}] [AI] Plan generated: ${plan.slides.length} slides, title: "${plan.title}"`,
        );
      }

      if (plan) plan.refAttrsVersion = refAttrsVersion;
      return plan;
    } catch (err) {
      planError = err instanceof Error ? err : new Error(String(err));
      throw err;
    } finally {
      // 引导式分步模式：planPresentation 是独立于 generateFromPlan 的 HTTP 请求，两者之间若
      // 进程重启/热更新/上下文重建，内存 sessions 映射会被清空，导致规划阶段的 LLM 报文
      // 无法被后续 generateFromPlan 的 closeTraceSession 收集 → 最终 ai-log.jsonl 中
      // generate-presentation 的 llmCalls 里完全找不到 planning 调用。
      //
      // 修复：planPresentation 结束前**立即**把当前内存中已有的 traces 持久化到
      // ai-log.jsonl（新增一条 type=plan），保证规划报文不因跨步骤的进程级事件而丢失。
      //   - 写 type=plan 日志：含 request + plan JSON + llmCalls[]（零截断）
      //   - 若有 presentationId，内存 session 仍然存活（不 close），供后续步骤继续追加。
      if (presentationId && fileDetailedLocal) {
        try {
          const planLLMTraces = getLLMTraces(traceSessionId);
          const planImgTraces = getImageTraces(traceSessionId);
          simpleLog('AI:LOG', `[planPresentation] 立即写入 type=plan 持久化痕迹`, {
            llmTraces: planLLMTraces.length,
            imgTraces: planImgTraces.length,
            hasPlan: String(!!plan),
            hasError: String(!!planError),
          });
          await this.logsService.logAICall(presentationId, 'plan', {
            request: {
              topic,
              style,
              audience,
              slideCount,
              slideCountMin,
              slideCountMax,
              density,
              imagePreference,
              colorTheme,
              primaryColor,
              backgroundEnabled,
              iconStyle,
              fontFamily,
              referenceHtmlLength: referenceHtml?.length || 0,
              modelConfigs: {
                planning: {
                  provider: planningConfig.provider,
                  model: planningConfig.model,
                  baseUrl: planningConfig.baseUrl,
                },
                content: {
                  provider: contentConfig.provider,
                  model: contentConfig.model,
                  baseUrl: contentConfig.baseUrl,
                },
              },
            },
            response: plan
              ? {
                  plan: {
                    title: plan.title,
                    description: plan.description || null,
                    narrativeArc: (plan as any).narrativeArc || null,
                    primaryColor: plan.primaryColor || null,
                    slideCount: plan.slides?.length || 0,
                    slides: (plan.slides || []).map((s: any) => ({
                      pageType: s?.pageType,
                      title: s?.title,
                      keyPoints: s?.keyPoints,
                      imagePrompt: s?.imagePrompt,
                      imageRatio: s?.imageRatio,
                      needsImage: s?.needsImage,
                    })),
                  },
                }
              : {
                  error: planError
                    ? { message: planError.message, stack: planError.stack || '' }
                    : null,
                },
            llmCalls: planLLMTraces.map((t) => ({
              stage: t.stage,
              provider: t.provider,
              model: t.model,
              durationMs: t.durationMs,
              startedAt: new Date(t.startedAt).toISOString(),
              endedAt: new Date(t.endedAt).toISOString(),
              request: { messages: t.request.messages, options: t.request.options },
              response: t.response
                ? { content: t.response.content, usage: (t.response as any).usage }
                : undefined,
              error: t.error ? { message: t.error.message, stack: t.error.stack } : undefined,
            })),
            imageGenerationCalls: planImgTraces,
          });
        } catch (logErr) {
          console.warn(
            `[${formatBeijingTime()}] [AI:LOG] planPresentation 写 type=plan 日志失败（不影响 plan 返回）:`,
            logErr instanceof Error ? logErr.message : logErr,
          );
        }
      }
      // 引导式模式的下一步（design-proposals / generate-from-plan / finalize）仍会继续
      // 往该 session 追加 traces；仅在无 presentationId 独立调用时在此关闭。
      if (!presentationId) {
        closeTraceSession(traceSessionId);
      }
    }
  }

  // Task 2/3：4 类参考属性提取 + assemble（HTML 全文解析 + 图片 VLM 五档降级）
  private async buildReferenceVisualAttributes(
    req: GeneratePresentationRequest,
  ): Promise<ReferenceVisualAttributes | null> {
    // 单份 referenceHtml 回落防护：HTML 通道不再把单份参考同时灌入 cover/content/summary 三个分类，
    // 而是只写入 global 槽（结构层门控见 reference-attribute-resolver 的 resolveStructureSource：
    // global 仅定向兜底 content 结构，绝不污染 cover/summary）。图片通道回落（imgCover/imgContent/imgSummary）
    // 保持不变，避免扩大范围影响文生图 seed 链路。
    const htmlCover = req.referenceHtmlCover;
    const htmlContent = req.referenceHtmlContent;
    const htmlSummary = req.referenceHtmlSummary;
    const htmlGlobal = req.referenceHtmlGlobal ?? req.referenceHtml;
    const imgCover = req.referenceImageCover ?? req.referenceImage;
    const imgContent = req.referenceImageContent ?? req.referenceImage;
    const imgSummary = req.referenceImageSummary ?? req.referenceImage;
    const imgGlobal = req.referenceImageGlobal ?? req.referenceImage;

    const cH = htmlCover ? extractReferenceHtmlAttributes(htmlCover) : undefined;
    const coH = htmlContent ? extractReferenceHtmlAttributes(htmlContent) : undefined;
    const sH = htmlSummary ? extractReferenceHtmlAttributes(htmlSummary) : undefined;
    const gH = htmlGlobal ? extractReferenceHtmlAttributes(htmlGlobal) : undefined;

    // FR-参考克隆：可观测——打印各分类参考的画布命中 / 调色板 / 骨架长度，便于排查「参考到底抽到了什么」
    const refParseLog: Array<[string, CategoryReference | undefined]> = [
      ['cover', cH],
      ['content', coH],
      ['summary', sH],
      ['global', gH],
    ];
    for (const [tag, r] of refParseLog) {
      if (!r) continue;
      console.log(
        `[REF-PARSE] ${tag}: canvas=${r.structure?.canvasSelector ?? '-'} ` +
          `bg=${r.palette?.canvasBg ?? '-'} decoration=${r.visual?.decoration ?? '-'} ` +
          `palette=[${r.palette?.primary ?? '-'}${r.palette?.accents?.length ? '/' + r.palette.accents.join('/') : ''}] ` +
          `multiColor=${r.palette?.isMultiColor ?? false} skeletonLen=${r.referenceHtml?.length ?? 0}`,
      );
    }

    let vlmProvider: VlmTextProvider | undefined;
    // 捕获参考属性 VLM 提取的原始请求/响应报文，供稍后写入 <presentationId>/ai-log.jsonl（type=reference-parse）。
    // 这样 scripts/extract-ai-log.js 才能把"你是 PPT 版面属性提取器"这类报文解析并独立保存成文件。
    const refTraces: Array<{
      url: string;
      model: string;
      provider: string;
      messages: any[];
      responseText: string;
      durationMs: number;
      startedAt: number;
      endedAt: number;
    }> = [];
    if (imgCover || imgContent || imgSummary || imgGlobal) {
      try {
        const vlmCfg = await this.configService.resolveModelConfig('auditVlm');
        if (vlmCfg) {
          const chat = createChatProvider(vlmCfg);
          vlmProvider = {
            async generateText({ prompt, imageDataUrl }) {
              const content: any[] = [];
              if (imageDataUrl)
                content.push({ type: 'image_url', image_url: { url: imageDataUrl } });
              content.push({ type: 'text', text: prompt });
              const startedAt = Date.now();
              let responseText = '';
              try {
                const res = await chat.chat([{ role: 'user', content } as any]);
                responseText = typeof res === 'string' ? res : (res?.content ?? '');
              } finally {
                const endedAt = Date.now();
                refTraces.push({
                  url: imageDataUrl || '',
                  model: (chat as any).config?.model || vlmCfg.model || '',
                  provider: (chat as any).name || vlmCfg.provider || 'auditVlm',
                  messages: content,
                  responseText,
                  durationMs: endedAt - startedAt,
                  startedAt,
                  endedAt,
                });
              }
              return responseText;
            },
          };
        }
      } catch {
        vlmProvider = undefined;
      }
    }

    // 去重：当多个分类槽位回退到同一张全局参考图时，只按 URL 对每张图做一次 VLM 提取，
    // 结果复用于指向它的所有分类槽位。避免 Promise.all 在毫秒级并发发出 N 个字节级完全相同的
    // 请求（网关易被限流/排队，导致响应空或截断、以及日志中大量重复 REQUEST）。
    const imgSlots: Array<{ key: 'cover' | 'content' | 'summary' | 'global'; url: string }> = [
      { key: 'cover', url: imgCover },
      { key: 'content', url: imgContent },
      { key: 'summary', url: imgSummary },
      { key: 'global', url: imgGlobal },
    ].filter(
      (s): s is { key: 'cover' | 'content' | 'summary' | 'global'; url: string } =>
        !!s.url && !!vlmProvider,
    );

    const urlToResult = new Map<string, CategoryReference | undefined>();
    const distinctUrls = [...new Set(imgSlots.map((s) => s.url))];
    await Promise.all(
      distinctUrls.map(async (url) => {
        // _categoryHint 形参在 extractReferenceImageAttributes 内部未使用，按 URL 去重安全
        urlToResult.set(url, await extractReferenceImageAttributes(url, vlmProvider!, undefined));
      }),
    );

    // 把本次参考属性 VLM 提取的原始报文写入 <presentationId>/ai-log.jsonl（type=reference-parse）。
    // 仅在真实发生 VLM 调用（recompute，非缓存命中）时记录；供 scripts/extract-ai-log.js
    // 解析导出 12-refparse-*.json / 12-refparse-*-llm.md / reference-images/reference-image-input-*.png。
    const refPresId = req.presentationId;
    if (refPresId && refTraces.length > 0) {
      try {
        const catsByUrl = new Map<string, string[]>();
        for (const s of imgSlots) {
          if (!catsByUrl.has(s.url)) catsByUrl.set(s.url, []);
          catsByUrl.get(s.url)!.push(s.key);
        }
        for (const t of refTraces) {
          const cats = catsByUrl.get(t.url) || ['unknown'];
          const result = urlToResult.get(t.url);
          await this.logsService.logAICall(refPresId, 'reference-parse', {
            category: cats,
            source:
              t.url.length > 120 ? `${t.url.slice(0, 60)}…[dataURL ${t.url.length} chars]` : t.url,
            sessionId: req.traceSessionId || undefined,
            model: t.model,
            provider: t.provider,
            cacheHit: false,
            appliedFields:
              result && typeof result === 'object' && result.style
                ? Object.keys(result.style as Record<string, unknown>)
                : [],
            result: result || undefined,
            llmCalls: [
              {
                stage: 'reference-parse',
                provider: t.provider,
                model: t.model,
                // 与 chat.chat([{ role: 'user', content }]) 入参格式一致，确保脚本 messagesToMarkdown / callHasImage 能提取 VLM 输入图
                request: { messages: [{ role: 'user', content: t.messages }] },
                response: { content: t.responseText },
                durationMs: t.durationMs,
                startedAt: t.startedAt,
                endedAt: t.endedAt,
              },
            ],
          });
        }
      } catch (e) {
        simpleLog('REF-PARSE', '写入 ai-log.jsonl(reference-parse) 失败（不影响生成）', {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    // HTML 通道参考解析记录（channel='html'）：不依赖 VLM，仅记录解析结果与字段置信度，
    // 供下次同类问题在报文内自证（四类参考是否上传成功、抽到了哪些属性、样式规则数）。
    if (refPresId) {
      try {
        const htmlEntries = [
          { key: 'cover' as const, html: htmlCover, result: cH },
          { key: 'content' as const, html: htmlContent, result: coH },
          { key: 'summary' as const, html: htmlSummary, result: sH },
          { key: 'global' as const, html: htmlGlobal, result: gH },
        ];
        for (const e of htmlEntries) {
          if (!e.html || !e.result?.uploaded) continue;
          await this.logsService.logAICall(refPresId, 'reference-parse', {
            channel: 'html',
            category: [e.key],
            source: 'html',
            sessionId: req.traceSessionId || undefined,
            cacheHit: false,
            htmlLength: e.html.length,
            styleRulesCount: countStyleRules(e.html),
            appliedFields:
              e.result.style && typeof e.result.style === 'object'
                ? Object.keys(e.result.style as Record<string, unknown>)
                : [],
            result: e.result,
            // 无 llmCalls：HTML 通道不走 VLM
          });
        }
      } catch (e) {
        simpleLog('REF-PARSE-HTML', '写入 ai-log.jsonl(reference-parse, html) 失败（不影响生成）', {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    const cI = urlToResult.get(imgCover);
    const coI = urlToResult.get(imgContent);
    const sI = urlToResult.get(imgSummary);
    const gI = urlToResult.get(imgGlobal);

    const coverRef = mergeReferenceAttrs(cH, cI);
    const contentRef = mergeReferenceAttrs(coH, coI);
    const summaryRef = mergeReferenceAttrs(sH, sI);
    const globalRef = mergeReferenceAttrs(gH, gI);

    if (!coverRef.uploaded && !contentRef.uploaded && !summaryRef.uploaded && !globalRef.uploaded)
      return null;

    const rva = assembleReferenceVisualAttributes({ coverRef, contentRef, summaryRef, globalRef });
    // FR-15：把各类别上传的原始参考图地址挂到 byCategory/global，供文生图按分类选取 img2img seed。
    // imgCover/imgContent/imgSummary 已含 `?? req.referenceImage` 回退（全局图兜底），与旧字段语义一致。
    rva.byCategory.cover.referenceImageUrl = imgCover;
    rva.byCategory.content.referenceImageUrl = imgContent;
    rva.byCategory.summary.referenceImageUrl = imgSummary;
    rva.global.referenceImageUrl = imgGlobal;
    return rva;
  }

  // Task 3.5 / FR-14：跨步骤参考属性一致性。以参考字段内容拼接求 sha1 作为版本号。
  private computeRefAttrsHash(req: GeneratePresentationRequest): string {
    return _computeRefAttrsHash(req);
  }

  // 解析参考属性：优先复用缓存（回传版本号 + 内容 hash 一致），否则就地重算并持久化。
  private async resolveReferenceVisualAttributes(req: GeneratePresentationRequest): Promise<{
    referenceVisualAttributes: ReferenceVisualAttributes | null;
    refAttrsVersion: string;
    source: 'reused' | 'recomputed';
  }> {
    const hash = this.computeRefAttrsHash(req);
    const presentationId = req.presentationId;
    const reqVersion = req.refAttrsVersion;

    let referenceVisualAttributes: ReferenceVisualAttributes | null = null;
    let source: 'reused' | 'recomputed' = 'recomputed';

    // 兜底：即使前端漏回传 refAttrsVersion（如 auto 模式闭包过期），只要同 presentationId 且参考字段一致
    // （hash 相同），就直接复用磁盘缓存，避免同一份参考图被反复 VLM 提取。字段确实变化（hash 不同）时
    // 不会命中，仍会 recompute；仅当 reqVersion 存在且 !==hash 才告警 mismatch。
    const cached = presentationId ? this.storage.loadReferenceAttrs(presentationId, hash) : null;
    if (cached) {
      referenceVisualAttributes = cached as ReferenceVisualAttributes;
      source = 'reused';
    } else if (reqVersion && reqVersion !== hash) {
      console.warn(
        `[REF-CACHE] presentationId=${presentationId ?? '-'} hash mismatch: reqVersion=${reqVersion} computed=${hash} → recompute`,
      );
    }

    if (!referenceVisualAttributes) {
      referenceVisualAttributes = await this.buildReferenceVisualAttributes(req);
      source = 'recomputed';
      if (referenceVisualAttributes && presentationId) {
        try {
          await this.storage.saveReferenceAttrs(presentationId, hash, referenceVisualAttributes);
        } catch (e) {
          console.warn(`[REF-CACHE] save failed:`, e);
        }
      }
    }

    console.log(
      `[REF-CACHE] presentationId=${presentationId ?? '-'} hash=${hash} hit=${source === 'reused'} source=${source}`,
    );
    // 缓存命中时也写一条 reference-parse 记录（cacheHit=true），让排查脚本能完整呈现"复用了哪份参考属性"，
    // 避免下次同类问题在报文里完全看不到参考解析痕迹（无 llmCalls、无 VLM 报文但仍有解析结果）。
    if (source === 'reused' && presentationId) {
      try {
        const htmlCover = req.referenceHtmlCover ?? '';
        const htmlContent = req.referenceHtmlContent ?? '';
        const htmlSummary = req.referenceHtmlSummary ?? '';
        const htmlGlobal = req.referenceHtmlGlobal ?? req.referenceHtml ?? '';
        const brief = this.buildReferenceBrief(referenceVisualAttributes);
        await this.logsService.logAICall(presentationId, 'reference-parse', {
          channel: 'html',
          category: ['cache'],
          source: 'cache-hit',
          sessionId: req.traceSessionId || undefined,
          cacheHit: true,
          refAttrsVersion: hash,
          referenceHtmlCoverLength: htmlCover.length,
          referenceHtmlContentLength: htmlContent.length,
          referenceHtmlSummaryLength: htmlSummary.length,
          referenceHtmlGlobalLength: htmlGlobal.length,
          referenceHtmlBriefLength: brief.length,
          appliedFields: this.collectAppliedReferenceFields(referenceVisualAttributes),
          result: referenceVisualAttributes ?? undefined,
          llmCalls: [],
        });
      } catch (e) {
        simpleLog('REF-PARSE-CACHE', '写入 cacheHit reference-parse 记录失败（不影响生成）', {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
    // 单一出口补齐：命中磁盘属性缓存时，RVA JSON 内本无 src/尺寸，需在返回前用落盘原图兜底，
    // 一处覆盖全部 8 个生成入口（含 renderSlides / regenerateSlide / finalizePresentation / assembleImages），
    // 消除「只 resolve 未 attach」导致的母版 LOGO 与参考背景图不显示（缺陷 D 残留）。
    this.backfillReferenceOriginalSources(referenceVisualAttributes, presentationId);
    return { referenceVisualAttributes, refAttrsVersion: hash, source };
  }

  /** 汇总 RVA 中全部已应用字段名（去重），用于参考解析记录的 appliedFields 概览。 */
  private collectAppliedReferenceFields(rva: ReferenceVisualAttributes | null): string[] {
    return _collectAppliedReferenceFields(rva);
  }

  // 单一出口补齐「参考原图 URL + 尺寸」：用已落盘文件兜底回写 master.logo.src / refW / refH / referenceImageUrl。
  // 与 attachMasterLogoSources 职责区分：后者本论新上传原图→落盘；本方法缓存命中/未重传时从磁盘兜底。
  // 两者幂等（同值覆盖），且在 4 个已覆盖入口会重复执行，无副作用。失败仅 warn，绝不中断生成。
  private backfillReferenceOriginalSources(
    referenceVisualAttributes: ReferenceVisualAttributes | null | undefined,
    presentationId: string | undefined,
  ): void {
    return _backfillReferenceOriginalSources(referenceVisualAttributes, presentationId, this.storage);
  }

  // 将参考图片原图副本（Q7）按 presentationId 暂存，供后续母版 LOGO 开窗复用（FR-16）。
  // 返回各分类暂存后可访问的 URL 映射，供 applyMasterLogoSources 回写到 master.logo.src。
  private async persistReferenceOriginals(req: GeneratePresentationRequest): Promise<{
    cover?: { url: string; width?: number; height?: number };
    content?: { url: string; width?: number; height?: number };
    summary?: { url: string; width?: number; height?: number };
  }> {
    return _persistReferenceOriginals(req, this.storage);
  }

  // FR-16：消费 persistReferenceOriginals 产出的原图 URL，按分类回写到 RVA 的 master.logo.src，
  // 使 P1 CSS 开窗复用路径在渲染母版 LOGO 时生效。
  private attachMasterLogoSources(
    referenceVisualAttributes: ReferenceVisualAttributes | null | undefined,
    originals: {
      cover?: { url: string; width?: number; height?: number };
      content?: { url: string; width?: number; height?: number };
      summary?: { url: string; width?: number; height?: number };
    },
  ): void {
    return _attachMasterLogoSources(referenceVisualAttributes, originals);
  }

  private buildReferenceBrief(attrs: ReferenceVisualAttributes | null): string {
    return _buildReferenceBrief(attrs);
  }

  /**
   * 统一解析「参考视觉属性 + 参考 HTML 摘要(brief)」，供所有生成入口（plan / design-proposals /
   * generateFromPlan / renderSlides / regenerateSlide / assembleImages / finalizePresentation）复用。
   * 修复：此前 buildReferenceBrief 仅在 planPresentation 一处计算，导致 renderSlides 等后续步骤的内容/
   * 设计 prompt 完全拿不到参考摘要（只看到 3~4 行干瘪覆盖指令 + 误导性的「用户未上传参考文件 HTML」），
   * 用户上传的分类参考 HTML 在生成结果中毫无体现。这里把分类参考的提取结果组装成 brief 随 options 注入。
   */
  private async resolveReferenceForGeneration(req: GeneratePresentationRequest): Promise<{
    referenceVisualAttributes?: ReferenceVisualAttributes;
    referenceHtmlBrief: string;
    refAttrsVersion: string;
  }> {
    return _resolveReferenceForGeneration(req, (r) => this.resolveReferenceVisualAttributes(r));
  }

  async generateFromPlan(req: GenerateFromPlanRequest): Promise<Presentation> {
    const {
      topic,
      plan,
      modelConfig,
      modelConfigs,
      imageConfig,
      style,
      audience,
      slideCount,
      slideCountMin,
      slideCountMax,
      density,
      imagePreference,
      colorTheme,
      primaryColor,
      backgroundEnabled,
      iconStyle,
      fontFamily,
      referenceHtml,
      referenceImage,
      presentationId,
      slideWidth,
      slideHeight,
      logSettings,
      enableAudit,
      language,
    } = req;

    const logSettingsNormalized: LogConfig = {
      consoleVerbosity: 'detailed',
      fileVerbosity: 'detailed',
      ...normalizeLogConfig(logSettings || {}),
    };
    setLogConfig(logSettingsNormalized);
    const consoleDetailedLocal: boolean = logSettingsNormalized.consoleVerbosity === 'detailed';
    const fileDetailedLocal: boolean = logSettingsNormalized.fileVerbosity === 'detailed';
    if (consoleDetailedLocal) {
      console.log(
        `[${formatBeijingTime()}] [AI:LOG] 本次请求 logSettings：req=${
          logSettings ? JSON.stringify(logSettings) : '(未传)'
        } → normalized=${JSON.stringify(logSettingsNormalized)}`,
      );
    } else {
      simpleLog(
        'AI:LOG',
        `本次请求 logSettings 最终：console=${logSettingsNormalized.consoleVerbosity} file=${logSettingsNormalized.fileVerbosity}`,
        {
          raw: logSettings ? JSON.stringify(logSettings) : 'absent',
        },
      );
    }

    if (consoleDetailedLocal) {
      console.log(`[${formatBeijingTime()}] [AI] === 从计划生成演示文稿 ===`);
      console.log(`[${formatBeijingTime()}] [AI] topic:`, topic);
      console.log(`[${formatBeijingTime()}] [AI] plan slides:`, plan.slides.length);
    } else {
      simpleLog('AI', '从计划生成幻灯片', {
        topic: topic.length > 30 ? topic.substring(0, 30) + '…' : topic,
        slides: plan.slides.length,
      });
    }

    const requestWantsImages: boolean =
      imagePreference === 'all' ||
      imagePreference === 'content-only' ||
      imagePreference === 'minimal';
    const imageSwitchOff: boolean = !imageConfig?.enabled;
    if (requestWantsImages && imageSwitchOff) {
      const prefTextMap: Record<string, string> = {
        all: '全生成（封面/目录/内容/总结页均配图）',
        'content-only': '仅内容页配图',
        minimal: '精简（关键页配图）',
      };
      const prefText = prefTextMap[imagePreference || ''] || imagePreference;
      const msg =
        `配置冲突：你在「高级排版选项」中选择了"配图偏好 = ${prefText}"，` +
        `但在「设置 → AI图片生成」中未开启"自动生成配图"开关。` +
        `请先前往「设置 → AI图片生成」打开开关并配置好模型后再重试，` +
        `或把本次的「配图偏好」改为"不生成图片（none）"。`;
      console.warn(`[${formatBeijingTime()}] [AI:CONFIG-CONFLICT] ${msg}`);
      throw new BadRequestException(msg);
    }

    const planningConfig = modelConfigs?.planning || modelConfig!;
    const contentConfig: ModelConfig = { ...(modelConfigs?.content || modelConfig!), disableThinking: (modelConfigs?.content || modelConfig!)?.disableThinking ?? true };
    const editingConfig = modelConfigs?.editing || modelConfig!;

    const planningProvider = this.createProvider(planningConfig);
    const contentProvider = this.createProvider(contentConfig);
    const editingProvider = this.createProvider(editingConfig);

    const traceSessionId =
      presentationId || `trace_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    openTraceSession(traceSessionId);
    (planningProvider as TraceableProvider).activeTraceSessionId = traceSessionId;
    (contentProvider as TraceableProvider).activeTraceSessionId = traceSessionId;
    (editingProvider as TraceableProvider).activeTraceSessionId = traceSessionId;

    let imageProvider: any = null;
    if (imageConfig?.enabled) {
      if (imageConfig.useDefaultProvider) {
        const mergedConfig = {
          provider: imageConfig.modelConfig?.provider || imageConfig.provider,
          apiKey: planningConfig.apiKey,
          baseUrl: imageConfig.modelConfig?.baseUrl || '',
          model: imageConfig.model || imageConfig.modelConfig?.model || 'dall-e-3',
        };
        if (consoleDetailedLocal) {
          console.log(
            `[${formatBeijingTime()}] [AI] Image provider merged config (useDefaultProvider):`,
            {
              provider: mergedConfig.provider,
              baseUrl: mergedConfig.baseUrl,
              model: mergedConfig.model,
              gatewayVendor: imageConfig.gatewayVendor,
              hasApiKey: !!mergedConfig.apiKey,
            },
          );
        } else {
          simpleLog('AI:IMG', '开始生成图片', {
            provider: mergedConfig.provider,
            model: mergedConfig.model,
          });
        }
        imageProvider = this.createImageProvider(mergedConfig as any, imageConfig.gatewayVendor);
      } else if (imageConfig.modelConfig) {
        const mergedConfig = {
          ...imageConfig.modelConfig,
          baseUrl: imageConfig.modelConfig.baseUrl || '',
          model: imageConfig.model || imageConfig.modelConfig.model,
        };
        if (consoleDetailedLocal) {
          console.log(`[${formatBeijingTime()}] [AI] Image provider config (separate key):`, {
            provider: mergedConfig.provider,
            baseUrl: mergedConfig.baseUrl,
            model: mergedConfig.model,
            gatewayVendor: imageConfig.gatewayVendor,
            hasApiKey: !!mergedConfig.apiKey,
          });
        } else {
          simpleLog('AI:IMG', '开始生成图片', {
            provider: mergedConfig.provider,
            model: mergedConfig.model,
          });
        }
        imageProvider = this.createImageProvider(mergedConfig as any, imageConfig.gatewayVendor);
      }
      if (imageProvider && typeof imageProvider === 'object') {
        (imageProvider as TraceableProvider).activeTraceSessionId = traceSessionId;
      }
    }

    const agent = new HTMLPresentationAgent(planningProvider, {
      planningProvider,
      contentProvider,
      editingProvider,
    });

    const imageOptions = imageConfig?.enabled
      ? {
          enabled: true,
          model: imageConfig.model,
          size: imageConfig.size as ImageSize,
          allModels: imageConfig.allModels,
          routing: imageConfig.routing,
        }
      : undefined;

    const htmlAuditMaxRetries = req.critique?.maxRetries ?? 1;
    const { referenceVisualAttributes, referenceHtmlBrief } =
      await this.resolveReferenceForGeneration(req);
    const referenceOriginals = await this.persistReferenceOriginals(req);
    this.attachMasterLogoSources(referenceVisualAttributes, referenceOriginals);
    const genOptions = {
      style,
      audience,
      slideCount,
      slideCountMin,
      slideCountMax,
      density: density || 'normal',
      imagePreference: imagePreference || 'content-only',
      colorTheme,
      primaryColor,
      imageOptions,
      imageProvider: imageProvider || undefined,
      referenceImage: referenceImage || undefined,
      referenceHtml: referenceHtml || undefined,
      referenceText: req.referenceText || undefined,
      referenceVisualAttributes,
      referenceHtmlBrief,
      slideWidth: slideWidth || 1280,
      slideHeight: slideHeight || 720,
      backgroundEnabled: backgroundEnabled || false,
      iconStyle: iconStyle || 'auto',
      fontFamily: fontFamily || 'sans',
      language: (language === 'en' ? 'en' : 'zh') as 'en' | 'zh',
      onProgress: () => {},
      critique: req.critique,
      postHtmlAuditHook: this.buildHtmlAuditHook({
        referenceVisualAttributes,
        agent,
        topic,
        options: {
          style,
          audience,
          slideCount,
          slideCountMin,
          slideCountMax,
          density: density || 'normal',
          imagePreference: imagePreference || 'content-only',
          colorTheme,
          primaryColor,
          imageOptions,
          referenceImage: referenceImage || undefined,
          referenceHtml: referenceHtml || undefined,
          referenceVisualAttributes,
          slideWidth: slideWidth || 1280,
          slideHeight: slideHeight || 720,
          backgroundEnabled: backgroundEnabled || false,
          iconStyle: iconStyle || 'auto',
          fontFamily: fontFamily || 'sans',
          language: language === 'en' ? 'en' : 'zh',
          critique: req.critique,
          onProgress: () => {},
        },
        maxRetries: htmlAuditMaxRetries,
        slideWidth: slideWidth || 1280,
        slideHeight: slideHeight || 720,
      }),
    };

    const presentation = await agent.generateFromPlan(topic, plan, genOptions, traceSessionId);

    return await this.postProcessPresentation(presentation, {
      presentationId,
      slideWidth,
      slideHeight,
      consoleDetailedLocal,
      fileDetailedLocal,
      traceSessionId,
      topic,
      style,
      audience,
      slideCount,
      slideCountMin,
      slideCountMax,
      density,
      imagePreference,
      colorTheme,
      primaryColor,
      backgroundEnabled,
      iconStyle,
      fontFamily,
      referenceHtml,
      referenceImage,
      logSettings,
      logSettingsNormalized,
      planningConfig,
      contentConfig,
      editingConfig,
      imageConfig,
      imageProvider,
      plan,
      design: (presentation as any).design,
      agent,
      generationOptions: genOptions,
      enableAudit,
    });
  }

  async generateDesignProposals(req: DesignProposalsRequest): Promise<DesignProposal[]> {
    const {
      topic,
      plan,
      style,
      audience,
      density,
      imagePreference,
      colorTheme,
      primaryColor,
      fontFamily,
      backgroundEnabled,
      iconStyle,
      referenceHtml,
      slideWidth,
      slideHeight,
      presentationId,
      critique,
      traceSessionId,
      proposalCount,
    } = req;

    const effectiveSessionId = traceSessionId || presentationId;
    const ctx = this.createAgentContext(req, effectiveSessionId);

    const { referenceVisualAttributes, referenceHtmlBrief } =
      await this.resolveReferenceForGeneration(req);
    const referenceOriginals = await this.persistReferenceOriginals(req);
    this.attachMasterLogoSources(referenceVisualAttributes, referenceOriginals);

    try {
      const options = {
        style,
        audience,
        referenceVisualAttributes,
        referenceHtmlBrief,
        density,
        imagePreference,
        colorTheme,
        primaryColor,
        fontFamily,
        backgroundEnabled,
        iconStyle,
        referenceHtml,
        slideWidth,
        slideHeight,
        imageOptions: ctx.imageOptions,
        imageProvider: ctx.imageProvider || undefined,
        onProgress: () => {},
        critique,
        proposalCount,
        postHtmlAuditHook: this.buildHtmlAuditHook({
          agent: ctx.agent,
          topic,
          options: {
            style,
            audience,
            referenceVisualAttributes,
            density,
            imagePreference,
            colorTheme,
            primaryColor,
            fontFamily,
            backgroundEnabled,
            iconStyle,
            referenceHtml,
            slideWidth,
            slideHeight,
            imageOptions: ctx.imageOptions,
            onProgress: () => {},
            critique,
          },
          maxRetries: critique?.maxRetries ?? 1,
          slideWidth,
          slideHeight,
          startIndex: 0,
        }),
      };

      return await ctx.agent.generateDesignProposals(topic, plan, options, ctx.traceSessionId);
    } finally {
      if (!traceSessionId && !presentationId) closeTraceSession(ctx.traceSessionId);
    }
  }

  async renderSlides(req: RenderSlidesRequest): Promise<RenderedSlide[]> {
    const {
      topic,
      plan,
      design,
      style,
      audience,
      imagePreference,
      referenceHtml,
      slideWidth,
      slideHeight,
      presentationId,
      critique,
      startIndex,
      endIndex,
      traceSessionId,
    } = req;

    const effectiveSessionId = traceSessionId || presentationId;
    const ctx = this.createAgentContext(req, effectiveSessionId);

    const { referenceVisualAttributes, referenceHtmlBrief } =
      await this.resolveReferenceForGeneration(req);
    try {
      const options = {
        style,
        audience,
        referenceVisualAttributes,
        referenceHtmlBrief,
        density: design.density,
        imagePreference,
        colorTheme: design.colorTheme,
        primaryColor: design.primaryColor,
        fontFamily: design.fontFamily,
        backgroundEnabled: req.backgroundEnabled,
        iconStyle: design.iconStyle,
        referenceHtml,
        slideWidth,
        slideHeight,
        imageOptions: ctx.imageOptions,
        imageProvider: ctx.imageProvider || undefined,
        onProgress: () => {},
        critique,
        startIndex,
        endIndex,
        postHtmlAuditHook: this.buildHtmlAuditHook({
          referenceVisualAttributes,
          referenceHtmlBrief,
          agent: ctx.agent,
          topic,
          options: {
            style,
            audience,
            density: design.density,
            imagePreference,
            colorTheme: design.colorTheme,
            primaryColor: design.primaryColor,
            fontFamily: design.fontFamily,
            backgroundEnabled: req.backgroundEnabled,
            iconStyle: design.iconStyle,
            referenceHtml,
            slideWidth,
            slideHeight,
            imageOptions: ctx.imageOptions,
            onProgress: () => {},
            critique,
          },
          maxRetries: critique?.maxRetries ?? 1,
          slideWidth,
          slideHeight,
          startIndex,
        }),
      };

      return await ctx.agent.renderSlides(topic, plan, design, options, ctx.traceSessionId);
    } finally {
      if (!traceSessionId && !presentationId) closeTraceSession(ctx.traceSessionId);
    }
  }

  async regenerateSlide(req: RegenerateSlideRequest): Promise<RenderedSlide> {
    const {
      topic,
      plan,
      design,
      slideIndex,
      style,
      audience,
      imagePreference,
      referenceHtml,
      slideWidth,
      slideHeight,
      presentationId,
      critique,
      traceSessionId,
    } = req;

    const effectiveSessionId = traceSessionId || presentationId;
    const ctx = this.createAgentContext(req, effectiveSessionId);

    const { referenceVisualAttributes, referenceHtmlBrief } =
      await this.resolveReferenceForGeneration(req);
    try {
      const options = {
        style,
        audience,
        referenceVisualAttributes,
        referenceHtmlBrief,
        density: design.density,
        imagePreference,
        colorTheme: design.colorTheme,
        primaryColor: design.primaryColor,
        fontFamily: design.fontFamily,
        backgroundEnabled: req.backgroundEnabled,
        iconStyle: design.iconStyle,
        referenceHtml,
        slideWidth,
        slideHeight,
        imageOptions: ctx.imageOptions,
        imageProvider: ctx.imageProvider || undefined,
        onProgress: () => {},
        critique,
      };

      return await ctx.agent.regenerateSingleSlide(
        topic,
        plan,
        design,
        slideIndex,
        options,
        ctx.traceSessionId,
        undefined,
        'placeholder',
        req.slides?.[slideIndex]?.html,
      );
    } finally {
      if (!traceSessionId && !presentationId) closeTraceSession(ctx.traceSessionId);
    }
  }

  async assembleImages(req: AssembleImagesRequest): Promise<RenderedSlide[]> {
    const {
      topic,
      plan,
      design,
      slides,
      style,
      audience,
      density,
      imagePreference,
      colorTheme,
      primaryColor,
      fontFamily,
      backgroundEnabled,
      iconStyle,
      referenceHtml,
      slideWidth,
      slideHeight,
      presentationId,
      traceSessionId,
    } = req;

    const effectiveSessionId = traceSessionId || presentationId;
    const ctx = this.createAgentContext(req, effectiveSessionId);

    // 与 finalizePresentation 对齐：显式解析参考属性，避免下游 generationOptions 缺来源（回归修复一致性）。
    const { referenceVisualAttributes, referenceHtmlBrief } =
      await this.resolveReferenceForGeneration(req);

    try {
      const options = {
        style,
        audience,
        density,
        imagePreference,
        colorTheme,
        primaryColor,
        fontFamily,
        backgroundEnabled,
        iconStyle,
        referenceHtml,
        referenceVisualAttributes,
        referenceHtmlBrief,
        slideWidth,
        slideHeight,
        imageOptions: ctx.imageOptions,
        imageProvider: ctx.imageProvider || undefined,
        onProgress: () => {},
      };

      return await ctx.agent.assembleImages(
        topic,
        slides,
        plan,
        design,
        options,
        ctx.traceSessionId,
      );
    } finally {
      if (!traceSessionId && !presentationId) closeTraceSession(ctx.traceSessionId);
    }
  }

  async finalizePresentation(req: FinalizeRequest): Promise<Presentation> {
    const {
      topic,
      plan,
      design,
      slides,
      style,
      audience,
      slideCount,
      slideCountMin,
      slideCountMax,
      density,
      imagePreference,
      colorTheme,
      primaryColor,
      backgroundEnabled,
      iconStyle,
      fontFamily,
      referenceHtml,
      referenceImage,
      presentationId,
      slideWidth,
      slideHeight,
      logSettings,
      enableAudit,
      traceSessionId,
    } = req;

    const effectiveSessionId = traceSessionId || presentationId;
    const ctx = this.createAgentContext(req, effectiveSessionId);

    // FR-A（回归修复）：终局重放依赖 generationOptions.referenceVisualAttributes 取参考主色；
    // 分步模式下本方法此前未传该字段，导致 finalMainColor 回落 design 默认蓝 #2563eb，把参考红色全量重染。
    // 这里显式解析（缓存命中零 I/O）并写入 options（即下游的 generationOptions），与 generateFromPlan 对齐。
    const { referenceVisualAttributes, referenceHtmlBrief } =
      await this.resolveReferenceForGeneration(req);

    try {
      const options = {
        style,
        audience,
        slideCount,
        slideCountMin,
        slideCountMax,
        density,
        imagePreference,
        colorTheme,
        primaryColor,
        fontFamily,
        backgroundEnabled,
        iconStyle,
        referenceHtml,
        referenceVisualAttributes,
        referenceHtmlBrief,
        slideWidth,
        slideHeight,
        imageOptions: ctx.imageOptions,
        imageProvider: ctx.imageProvider || undefined,
        onProgress: () => {},
      };

      const presentation = await ctx.agent.finalizePresentation(
        topic,
        slides,
        plan,
        design,
        options,
        ctx.traceSessionId,
      );

      return await this.postProcessPresentation(presentation, {
        presentationId,
        slideWidth,
        slideHeight,
        consoleDetailedLocal: ctx.consoleDetailedLocal,
        fileDetailedLocal: ctx.fileDetailedLocal,
        traceSessionId: ctx.traceSessionId,
        topic,
        style,
        audience,
        slideCount,
        slideCountMin,
        slideCountMax,
        density,
        imagePreference,
        colorTheme,
        primaryColor,
        backgroundEnabled,
        iconStyle,
        fontFamily,
        referenceHtml,
        referenceImage,
        logSettings,
        logSettingsNormalized: ctx.logSettingsNormalized,
        planningConfig: ctx.planningConfig,
        contentConfig: ctx.contentConfig,
        editingConfig: ctx.editingConfig,
        imageConfig: req.imageConfig,
        imageProvider: ctx.imageProvider,
        plan,
        design,
        agent: ctx.agent,
        generationOptions: options,
        enableAudit,
      });
    } finally {
      // 安全网：postProcessPresentation 内部已在正常流程中 closeTraceSession；
      // 此处兜底，防止 postProcess 内部异常时 trace session 泄漏。
      // 注意：finally 在 await postProcessPresentation() 完成之后才执行，不会提前关闭。
      closeTraceSession(ctx.traceSessionId);
    }
  }

  private async postProcessPresentation(
    presentation: HTMLPresentation,
    params: {
      presentationId?: string;
      slideWidth?: number;
      slideHeight?: number;
      consoleDetailedLocal: boolean;
      fileDetailedLocal: boolean;
      traceSessionId: string;
      topic: string;
      style?: string;
      audience?: string;
      slideCount?: number;
      slideCountMin?: number;
      slideCountMax?: number;
      density?: ContentDensity;
      imagePreference?: ImagePreference;
      colorTheme?: ColorTheme;
      primaryColor?: string;
      backgroundEnabled?: boolean;
      iconStyle?: IconStyle;
      fontFamily?: string;
      referenceHtml?: string;
      referenceImage?: string;
      logSettings?: LogConfig;
      logSettingsNormalized: LogConfig;
      planningConfig: ModelConfig;
      contentConfig: ModelConfig;
      editingConfig: ModelConfig;
      imageConfig?: any;
      imageProvider?: any;
      plan?: PresentationPlan;
      design?: DesignProposal;
      agent?: HTMLPresentationAgent;
      generationOptions?: any;
      enableAudit?: boolean;    },
  ): Promise<Presentation> {
    return postProcessPresentationImpl.call(this, presentation, params);
  }

  /**
   * 5 级 single-source primary 链（FR-3 / Task4）：参考 deck 主色优先，否则 5 级回退，
   * 并写回 presentation.design 与 generationOptions。纯逻辑（无 this.* 外部依赖），便于行为锁定测试。
   */
  private resolveFinalEffectivePrimary(
    presentation: Presentation,
    generationOptions: any,
    opts: { primaryColor?: string; colorTheme?: any; design?: any },
  ): string {
    return _resolveFinalEffectivePrimary(presentation, generationOptions, opts);
  }

  /**
   * 孤儿配图救援：扫描磁盘上未被 HTML 引用的图片，按 imagePreference 回填到内容页 / 封面 / 总结。
   * 纯编排（依赖 this.storage / this.injectOrphanImage* / this.inferImagePreferenceFromPresentation /
   * this.slideHasMeaningfulBody）；返回成功救援的孤儿图数量。便于行为锁定测试。
   */
  private rescueOrphanImages(result: Presentation, detailed: boolean): number {
    return _rescueOrphanImages(result, detailed, {
      storage: this.storage,
      injectOrphanImageIntoSlide: this.injectOrphanImageIntoSlide.bind(this),
      injectOrphanImageIntoBackground: this.injectOrphanImageIntoBackground.bind(this),
      slideHasMeaningfulBody: this.slideHasMeaningfulBody.bind(this),
      inferImagePreferenceFromPresentation: _inferImagePreferenceFromPresentation,
    });
  }

  private createEditContext(req: {
    modelConfig?: ModelConfig;
    modelConfigs?: StageModelConfigs;
    presentationId?: string;
    logSettings?: LogConfig;
  }) {
    const { modelConfig, modelConfigs, presentationId, logSettings } = req;

    const logSettingsNormalized: LogConfig = {
      consoleVerbosity: 'detailed',
      fileVerbosity: 'detailed',
      ...normalizeLogConfig(logSettings || {}),
    };
    setLogConfig(logSettingsNormalized);
    const consoleDetailedLocal = logSettingsNormalized.consoleVerbosity === 'detailed';
    const fileDetailedLocal = logSettingsNormalized.fileVerbosity === 'detailed';

    const editingConfig = modelConfigs?.editing || modelConfig!;
    const editingProvider = this.createProvider(editingConfig);

    const effectiveTraceSessionId =
      presentationId || `edit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    openTraceSession(effectiveTraceSessionId);
    (editingProvider as TraceableProvider).activeTraceSessionId = effectiveTraceSessionId;

    const agent = new HTMLPresentationAgent(editingProvider, { editingProvider });

    return {
      agent,
      editingProvider,
      editingConfig,
      traceSessionId: effectiveTraceSessionId,
      consoleDetailedLocal,
      fileDetailedLocal,
      logSettingsNormalized,
    };
  }

  private async writeEditLog(
    presentationId: string | undefined,
    traceSessionId: string,
    type: string,
    data: Record<string, unknown>,
    editingConfig: ModelConfig,
    fileDetailed: boolean,
  ) {
    const llmTraces: LLMCallTrace[] = getLLMTraces(traceSessionId);
    closeTraceSession(traceSessionId);

    if (!presentationId) return;

    const routingInfo = { editing: `${editingConfig.provider}/${editingConfig.model}` };

    if (fileDetailed) {
      await this.logsService.logAICall(presentationId, type, {
        ...data,
        llmCalls: llmTraces.map((t) => ({
          stage: t.stage,
          provider: t.provider,
          model: t.model,
          durationMs: t.durationMs,
          startedAt: new Date(t.startedAt).toISOString(),
          endedAt: new Date(t.endedAt).toISOString(),
          request: {
            messages: t.request.messages,
            options: t.request.options,
          },
          response: t.response
            ? {
                content: t.response.content,
                model: t.response.model,
                usage: t.response.usage,
              }
            : undefined,
          error: t.error,
        })),
        llmCallCount: llmTraces.length,
        model: editingConfig.model,
        provider: editingConfig.provider,
        routing: routingInfo,
      });
    } else {
      await this.logsService.logAICall(presentationId, type, {
        ...data,
        llmCallCount: llmTraces.length,
        model: editingConfig.model,
        provider: editingConfig.provider,
        routing: routingInfo,
      });
    }
  }

  async editSlide(req: EditSlideRequest): Promise<{ html: string }> {
    const timestamp = formatBeijingTime();
    const startTime = Date.now();

    const ctx = this.createEditContext(req);
    const { currentHtml, userRequest, primaryColor, presentationId } = req;

    if (ctx.consoleDetailedLocal) {
      console.log(`\n[${timestamp}] [AI:EDIT] ========== editSlide 开始 ==========`);
      console.log(
        `[${timestamp}] [AI:EDIT] 用户指令: ${userRequest.length > 200 ? userRequest.substring(0, 200) + '...' : userRequest}`,
      );
      console.log(`[${timestamp}] [AI:EDIT] 当前HTML长度: ${currentHtml.length} chars`);
      console.log(
        `[${timestamp}] [AI:EDIT] 编辑模型: ${ctx.editingConfig.provider}/${ctx.editingConfig.model}`,
      );
    }

    try {
      const html = await ctx.agent.modifySlide(currentHtml, userRequest, primaryColor || '#2563eb');
      const duration = Date.now() - startTime;

      if (ctx.consoleDetailedLocal) {
        console.log(
          `[${formatBeijingTime()}] [AI:EDIT] editSlide 完成: ${currentHtml.length} → ${html.length} chars, 耗时=${duration}ms`,
        );
        console.log(`[${formatBeijingTime()}] [AI:EDIT] ========== editSlide 结束 ==========\n`);
      }

      await this.writeEditLog(
        presentationId,
        ctx.traceSessionId,
        'edit-slide',
        {
          request: {
            userRequest,
            currentHtmlLength: currentHtml.length,
            primaryColor: primaryColor || '#2563eb',
            model: {
              provider: ctx.editingConfig.provider,
              model: ctx.editingConfig.model,
              baseUrl: ctx.editingConfig.baseUrl,
            },
          },
          response: {
            htmlLength: html.length,
            html,
          },
          duration,
        },
        ctx.editingConfig,
        ctx.fileDetailedLocal,
      );

      return { html };
    } catch (error: any) {
      closeTraceSession(ctx.traceSessionId);
      console.error(`[${formatBeijingTime()}] [AI:EDIT] editSlide 失败:`, error);
      throw error;
    }
  }

  async editElement(req: EditElementRequest): Promise<{ html: string }> {
    const timestamp = formatBeijingTime();
    const startTime = Date.now();

    const ctx = this.createEditContext(req);
    const { elementHtml, userRequest, presentationId } = req;

    const tagMatch = elementHtml.match(/^<([a-zA-Z0-9]+)/);
    const tagName = tagMatch ? tagMatch[1] : 'unknown';

    if (ctx.consoleDetailedLocal) {
      console.log(`\n[${timestamp}] [AI:EDIT] ========== editElement 开始 ==========`);
      console.log(
        `[${timestamp}] [AI:EDIT] 用户指令: ${userRequest.length > 200 ? userRequest.substring(0, 200) + '...' : userRequest}`,
      );
      console.log(
        `[${timestamp}] [AI:EDIT] 元素类型: <${tagName}>, HTML长度: ${elementHtml.length} chars`,
      );
      console.log(
        `[${timestamp}] [AI:EDIT] 编辑模型: ${ctx.editingConfig.provider}/${ctx.editingConfig.model}`,
      );
    }

    try {
      const html = await ctx.agent.modifyElement(elementHtml, userRequest);
      const duration = Date.now() - startTime;

      if (ctx.consoleDetailedLocal) {
        console.log(
          `[${formatBeijingTime()}] [AI:EDIT] editElement 完成: ${elementHtml.length} → ${html.length} chars, 耗时=${duration}ms`,
        );
        console.log(`[${formatBeijingTime()}] [AI:EDIT] ========== editElement 结束 ==========\n`);
      }

      await this.writeEditLog(
        presentationId,
        ctx.traceSessionId,
        'edit-element',
        {
          request: {
            userRequest,
            elementTag: tagName,
            elementHtmlLength: elementHtml.length,
            elementHtml,
            model: {
              provider: ctx.editingConfig.provider,
              model: ctx.editingConfig.model,
              baseUrl: ctx.editingConfig.baseUrl,
            },
          },
          response: {
            htmlLength: html.length,
            html,
          },
          duration,
        },
        ctx.editingConfig,
        ctx.fileDetailedLocal,
      );

      return { html };
    } catch (error: any) {
      closeTraceSession(ctx.traceSessionId);
      console.error(`[${formatBeijingTime()}] [AI:EDIT] editElement 失败:`, error);
      throw error;
    }
  }

  async editGlobal(req: EditGlobalRequest): Promise<HTMLPresentation> {
    const timestamp = formatBeijingTime();
    const startTime = Date.now();

    const ctx = this.createEditContext(req);
    const { presentation, currentSlideIndex, userRequest, presentationId } = req;

    const totalHtmlLen = presentation.slides.reduce((sum, s) => sum + s.html.length, 0);

    if (ctx.consoleDetailedLocal) {
      console.log(`\n[${timestamp}] [AI:EDIT] ========== editGlobal 开始 ==========`);
      console.log(
        `[${timestamp}] [AI:EDIT] 用户指令: ${userRequest.length > 200 ? userRequest.substring(0, 200) + '...' : userRequest}`,
      );
      console.log(
        `[${timestamp}] [AI:EDIT] 演示文稿: "${presentation.title}", 共 ${presentation.slides.length} 页, 总HTML长度: ${totalHtmlLen} chars`,
      );
      console.log(`[${timestamp}] [AI:EDIT] 当前页: 第 ${currentSlideIndex + 1} 页`);
      console.log(
        `[${timestamp}] [AI:EDIT] 编辑模型: ${ctx.editingConfig.provider}/${ctx.editingConfig.model}`,
      );
    }

    try {
      const result = await ctx.agent.modifyGlobal(presentation, currentSlideIndex, userRequest);
      const duration = Date.now() - startTime;
      const resultHtmlLen = result.slides.reduce((sum, s) => sum + s.html.length, 0);

      if (ctx.consoleDetailedLocal) {
        console.log(
          `[${formatBeijingTime()}] [AI:EDIT] editGlobal 完成: 返回 ${result.slides.length} 页, 总HTML长度: ${resultHtmlLen} chars, 耗时=${duration}ms`,
        );
        if (result.slides.length !== presentation.slides.length) {
          console.log(
            `[${formatBeijingTime()}] [AI:EDIT] 页数变化: ${presentation.slides.length} → ${result.slides.length}`,
          );
        }
        console.log(`[${formatBeijingTime()}] [AI:EDIT] ========== editGlobal 结束 ==========\n`);
      }

      await this.writeEditLog(
        presentationId,
        ctx.traceSessionId,
        'edit-global',
        {
          request: {
            userRequest,
            presentationTitle: presentation.title,
            slideCount: presentation.slides.length,
            totalHtmlLength: totalHtmlLen,
            currentSlideIndex,
            model: {
              provider: ctx.editingConfig.provider,
              model: ctx.editingConfig.model,
              baseUrl: ctx.editingConfig.baseUrl,
            },
          },
          response: {
            title: result.title,
            slideCount: result.slides.length,
            totalHtmlLength: resultHtmlLen,
            slides: result.slides.map((s, i) => ({
              index: i + 1,
              title: s.title,
              htmlLength: s.html.length,
              html: s.html,
            })),
          },
          duration,
        },
        ctx.editingConfig,
        ctx.fileDetailedLocal,
      );

      return result;
    } catch (error: any) {
      closeTraceSession(ctx.traceSessionId);
      console.error(`[${formatBeijingTime()}] [AI:EDIT] editGlobal 失败:`, error);
      throw error;
    }
  }

  /**
   * 判断 slide HTML 是否有足够有意义的正文内容（用于孤儿配图救援的候选筛选）。
   * 放宽判定：不强制要求 ul/ol/li，只要有非空裸文本、<p>、<div>、<span>、列表等均可。
   * 同时剔除“标题 + 大量空 div/注释”这类实际无内容的情况。
   */
  private slideHasMeaningfulBody(html: string): boolean {
    if (!html) return false;
    let stripped = html.replace(/^<div\b[^>]*>/i, '').replace(/<\/div>\s*$/i, '');
    stripped = stripped.replace(/<h[12]\b[^>]*>[\s\S]*?<\/h[12]>/gi, '');
    const textOnly = stripped
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .trim();
    return textOnly.length >= 6;
  }

  private inlineLocalImagesForScreenshot(html: string, presentationId: string): string {
    if (!html) return html;
    return html.replace(
      /(<img[^>]*src\s*=\s*["'])(\/data\/workspace\/presentations\/[^"']+)(["'][^>]*>)/gi,
      (_match, pre: string, urlPath: string, post: string) => {
        try {
          const relative = urlPath.replace(/^\/data\/workspace\//, '');
          const filePath = join(this.storage.getWorkspaceDir(), relative);
          if (existsSync(filePath)) {
            const lowerPath = filePath.toLowerCase();
            const ext = lowerPath.endsWith('.png')
              ? 'image/png'
              : lowerPath.endsWith('.jpg') || lowerPath.endsWith('.jpeg')
                ? 'image/jpeg'
                : lowerPath.endsWith('.webp')
                  ? 'image/webp'
                  : lowerPath.endsWith('.gif')
                    ? 'image/gif'
                    : 'image/png';
            const buf = readFileSync(filePath);
            const dataUri = `data:${ext};base64,${buf.toString('base64')}`;
            return pre + dataUri + post;
          }
        } catch {
          // fall through: keep original URL
        }
        return pre + urlPath + post;
      },
    );
  }

  private async captureSlideScreenshot(
    renderer: InstanceType<typeof SlideRenderer>,
    html: string,
    idx: number,
    tmpDir: string,
  ): Promise<string | null> {
    const page = await renderer.renderSlide(html);
    try {
      const shotPath = join(tmpDir, `slide-${idx}-${Date.now()}.png`);
      await renderer.captureScreenshot(page, shotPath);
      return shotPath;
    } catch (e) {
      console.warn(`[AI:VLM-LOOP] 第 ${idx + 1} 页截图失败:`, e instanceof Error ? e.message : e);
      return null;
    } finally {
      await page.close();
    }
  }

  private vlmHasBlockingIssue(vlm: VlmReviewResult): boolean {
    return vlm.issues.some((i) => i.severity === 'error' || i.severity === 'warn');
  }

  private buildVlmFeedback(vlm: VlmReviewResult): string {
    const items = vlm.issues
      .filter((i) => i.severity === 'error' || i.severity === 'warn')
      .map((issue, i) => {
        const cause = issue.metadata?.rootCause ? `【根因:${issue.metadata.rootCause}】` : '';
        return `${i + 1}. [${issue.severity}]${cause} ${issue.message}${issue.fixSuggestion ? ` → 建议: ${issue.fixSuggestion}` : ''}`;
      });
    if (items.length === 0) return '';
    return `【VLM 视觉评审反馈，请针对性修复】\n${items.join('\n')}`;
  }

  private async generateAndLocalizeImage(params: {
    imageProvider: any;
    imagePrompt: string;
    targetSize: string;
    presentationId: string;
    slideIdx: number;
    imageOptions: any;
    referenceImageByCategory?: Partial<Record<'cover' | 'content' | 'summary' | 'global', string>>;
    referenceCategory?: string;
  }): Promise<string | null> {
    const {
      imageProvider,
      imagePrompt,
      targetSize,
      presentationId,
      slideIdx,
      imageOptions,
      referenceImageByCategory,
      referenceCategory,
    } = params;
    try {
      const images = await imageProvider.generateImage(imagePrompt, {
        model: imageOptions?.model,
        size: targetSize,
        quality: imageOptions?.quality,
        n: 1,
        // FR-15：把分类参考图 seed 透传给 provider（provider 内部按 referenceCategory 选取）
        referenceImageByCategory,
        referenceCategory,
      });
      if (images && images.length > 0 && images[0].url) {
        const localUrl = await this.storage.saveImageFromUrl(presentationId, images[0].url);
        simpleLog('AI:VLM-LOOP', `第 ${slideIdx + 1} 页图片重生成成功`, {
          size: targetSize,
          localUrl,
        });
        return localUrl;
      }
    } catch (e) {
      console.warn(
        `[AI:VLM-LOOP] 第 ${slideIdx + 1} 页图片重生成失败:`,
        e instanceof Error ? e.message : e,
      );
    }
    return null;
  }


  private buildHtmlAuditHook(params: {
    agent: HTMLPresentationAgent;
    topic: string;
    referenceVisualAttributes?: ReferenceVisualAttributes;
    referenceHtmlBrief?: string;
    options: any;
    maxRetries: number;
    slideWidth: number;
    slideHeight: number;
    startIndex?: number;
  }) {
    return buildHtmlAuditHookImpl.call(this, params);
  }

  private async runPostImageVlmTriageLoop(params: {
    result: Presentation;
    plan: PresentationPlan | undefined;
    design: DesignProposal | undefined;
    agent: HTMLPresentationAgent;
    imageProvider: any;
    imageOptions: any;
    traceSessionId: string;
    topic: string;
    maxRetries: number;
    slideWidth: number;
    slideHeight: number;
    generationOptions: any;
    primaryColor?: string;
    colorTheme?: ColorTheme;
  }): Promise<{ regeneratedCount: number; attempts: number }> {
    return runPostImageVlmTriageLoopImpl.call(this, params);
  }

  private async runAuditImageRegenerationLoop(params: {
    result: Presentation;
    plan: PresentationPlan | undefined;
    imageProvider: any;
    imageConfig: any;
    traceSessionId: string;
    topic: string;
    maxRetries: number;
    designContext: { style: string; primaryColor: string; fontFamily: string; iconStyle: string };
    referenceContext?: ReferenceContext;
    referenceVisualAttributes?: ReferenceVisualAttributes;
  }): Promise<{ regeneratedCount: number; attempts: number }> {
    return runAuditImageRegenerationLoopImpl.call(this, params);
  }


  /**
   * 兜底：将磁盘上孤立存在的本地配图 URL 注入到“纯文字内容页”slide HTML 中，
   * 自动重构为“左图右文 45:55”标准结构。
   * 与 agent 侧的 injectImagePlaceholderForContentSlide 策略一致，但这里直接使用本地 URL。
   * 增强：对裸文本（未被 <p>/<li> 包裹的正文）也能正确提取和展示。
   *
   * ——— FR-2 同构补洞（防御闭环最高优先级项 1/2）：保护版式（comparison-deep-dive 等高级版式）
   * 有固定的左图右文/多卡/表格/时序结构，禁止被整体重建为左图右文/上图下文。
   * 优先使用显式 pageType（调用方如果手头有 slide 元信息就传入），否则再从 HTML 的
   * data-layout 属性兜底。两者任一命中保护名单就直接返回原 html，不做结构改写。
   */
  private injectOrphanImageIntoSlide(
    html: string,
    localImageUrl: string,
    opts: { pageType?: SlidePageType | string } = {},
  ): string {
    return _injectOrphanImageIntoSlide(html, localImageUrl, opts);
  }

  /** 可见文本长度（去标签/注释/空白），用于「图片注入不得吞文本」的不变量校验 */
  private _visibleTextLength(html: string): number {
    return _visibleTextLengthFn(html);
  }

  /**
   * B-3 · 启发式推断 imagePreference（当 presentation.imagePreference 未被显式提供时使用）。
   *   - cover 有 <img> 且 summary 有 <img> 且 >70% 内容页有 <img> → 'all'
   *   - cover 无 <img> 且 summary 无 <img>，但 30%-100% 内容页有 <img> → 'content-only'
   *   - 0 < 有图占比 < 15% → 'minimal'
   *   - 全部无图 → 'none'
   *   - 其它 → 'content-only'（默认最常见）
   *
   * 【注意】阈值下调：之前 0 < ratio < 30% → 'minimal' 过于激进，导致即使存在 1-2 张图也
   * 被打为 minimal，从而孤儿救援 maxFill 被限制为 2 张、cover/summary 的 BG 注入不触发。
   * 15% 以下才认定为 minimal，更符合"尽量少配图"的语义。
   */
  private inferImagePreferenceFromPresentation(result: {
    slides: Array<{ html: string; title?: string; pageType?: string }>;
  }): ImagePreference {
    return _inferImagePreferenceFromPresentation(result);
  }

  /**
   * B-3 · 将孤儿配图作为【背景大图】注入 cover/summary 风格的 slide。
   *   - 新增一个 absolute 定位的 <div class="orphan-bg"> 包住 <img> + 半透明蒙层（让标题可读）
   *   - 与原有内容叠加，不破坏原有的 h1/标题/描述 排版
   * 如果注入失败，fallback 到 injectOrphanImageIntoSlide 的左图右文布局。
   *
   * ——— 防御闭环项 2/2：高级版式保护（扩展 PROTECTED_LAYOUT_FOR_INJECT）：
   * comparison-deep-dive / cards / timeline 等不是 cover/summary 风格，如果被启发式误判成 summary，
   * 绝不能给其叠加 absolute 背景大图；更不允许 fallback 到左图右文重建。
   * 显式 pageType（若调用方传入）与 HTML data-layout 任一命中保护即 return 原 html。
   */
  private injectOrphanImageIntoBackground(
    html: string,
    localImageUrl: string,
    kind: 'cover' | 'summary',
    opts: { pageType?: SlidePageType | string } = {},
  ): string {
    if (!html || !localImageUrl) return html;
    if (/<img\b/i.test(html)) return html;
    // 结构页（封面/目录/总结）在任何偏好下都不配图（含背景大图）——与参考模板保持一致
    if (
      typeof opts.pageType === 'string' &&
      isStructurePage(opts.pageType.toLowerCase())
    ) {
      return html;
    }
    // ——— FR-2 同构（扩展版）：保护版式既不做 BG 大图叠加，也不回退触发 orphan-slide 45:55 overwrite
    const PROTECTED_LAYOUT_FOR_INJECT: ReadonlySet<string> = new Set([
      'comparison-deep-dive',
      'content-value-showcase',
      'content-stats-highlight',
      'content-compare',
      'content-timeline',
      'content-table',
      'content-image-background',
      'content-zigzag',
      'content-cards',
    ]);
    const explicitPt = typeof opts.pageType === 'string' ? opts.pageType.toLowerCase() : undefined;
    const layoutFromHtml = (html.match(
      /<\s*(?:div|section|article)\b[^>]*\bdata-layout\s*=\s*["']?([a-z0-9-]+)["']?[^>]*>/i,
    ) || [])[1]?.toLowerCase();
    if (
      (explicitPt && PROTECTED_LAYOUT_FOR_INJECT.has(explicitPt)) ||
      (layoutFromHtml && PROTECTED_LAYOUT_FOR_INJECT.has(layoutFromHtml))
    ) {
      return html;
    }
    const outerOpen = html.match(/^(<div[^>]*>)/i);
    if (!outerOpen) {
      // 兜底：退化成左图右文（透传 pageType 保护）
      return this.injectOrphanImageIntoSlide(html, localImageUrl, opts);
    }
    const openTag = outerOpen[1];
    const closeIdx = html.lastIndexOf('</div>');
    if (closeIdx < openTag.length)
      return this.injectOrphanImageIntoSlide(html, localImageUrl, opts);
    const inner = html.substring(openTag.length, closeIdx);

    // 蒙层强度：封面稍深保证标题白字可读；总结稍浅
    const overlay = kind === 'cover' ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0.3)';
    const bgLayer = `
<div class="orphan-bg orphan-bg--${kind}" style="position:absolute;inset:0;overflow:hidden;border-radius:inherit;margin:0;padding:0;z-index:0;pointer-events:none;">
  <img src="${localImageUrl}" data-image-ratio="16:9" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;margin:0;padding:0;border:0;">
  <div aria-hidden="true" style="position:absolute;inset:0;background:linear-gradient(180deg, ${overlay} 0%, rgba(0,0,0,0.25) 40%, rgba(0,0,0,0.55) 100%);margin:0;padding:0;"></div>
</div>`;
    // 在原内容最外层加 position:relative（如果没有），让 absolute 背景层定位正确
    let newOpenTag = openTag;
    if (!/position\s*:\s*(relative|absolute|fixed)/i.test(openTag)) {
      newOpenTag = openTag
        .replace(/^(<div)/i, `<div style="position:relative;"`)
        .replace(/style\s*=\s*"([^"]*)"/i, (m, innerStyle) => {
          if (innerStyle && /position\s*:/i.test(innerStyle)) return m;
          return `style="${innerStyle ? innerStyle + ';' : ''}position:relative;"`;
        });
    }
    const rebuilt = `${newOpenTag}${bgLayer}${inner}</div>`;
    if (!rebuilt.includes(localImageUrl))
      return this.injectOrphanImageIntoSlide(html, localImageUrl, opts);
    return rebuilt;
  }

}
