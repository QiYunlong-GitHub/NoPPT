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
  applyMasterLogoSources,
  applyReferenceImageUrlSources,
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
import { createHash } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import * as os from 'os';
import { runHtmlPlaceholderAuditLoop } from './html-audit-loop';
import { triageSlideIssues } from './triage-vlm-issues';

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

/** 轻量 provider 错误分类，用于给审计相关 warn 日志标注 (quota)/(network) 标记。 */
function classifyProviderError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/403|quota|insufficient|exhausted|rate limit|429/i.test(msg)) return 'quota';
  if (/ECONN|ETIMEDOUT|timeout|network|fetch failed|socket/i.test(msg)) return 'network';
  return '';
}

/** 在既有 warn 文案上追加 provider 错误标记段（如 "(quota)" / "(network)" / ""）。 */
function tagAuditProviderError(prefix: string, e: unknown): string {
  const kind = classifyProviderError(e);
  return kind ? `${prefix} (${kind})` : prefix;
}

// —— r6 Task1: 后处理版本标识日志（模块级防重复打印，确保每个进程只打一次）——
let postProcessVersionLogged = false;

// —— r6 Task5: 慢模型 / 会话级连续超时告警状态（模块级）——
const slowModelWarned = new Set<string>();
const sessionTimeoutCount = new Map<string, number>();

function getSessionKey(trace: string | undefined): string {
  return trace || 'anon';
}

// —— r6 Task3: server 侧最简兜底 HTML（白背景 + 主色渐变标题 + 主色卡片列表）——
// FR-4 改造：移除旧的 #f3f4f6 中性灰药丸（与用户主题无关、造成视觉灾难），
// 改为与 LLM 设计风格一致的白底 + 主色渐变标题 + 主色卡片（活力橙/蓝/紫均自消毒通过）。
// 新增参数 primaryColor（默认 #2563eb 蓝兼容旧调用）；字号 H2 50px / 正文 19px = 2.63 满足字号层次审计。
function escapeHtmlText(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function darkenColorHex(hex: string, pct: number = 20): string {
  const m = /^#([0-9a-fA-F]{6})/.exec(hex);
  if (!m) return hex;
  const r = Math.max(0, parseInt(m[1].slice(0, 2), 16) - Math.round(255 * (pct / 100)));
  const g = Math.max(0, parseInt(m[1].slice(2, 4), 16) - Math.round(255 * (pct / 100)));
  const b = Math.max(0, parseInt(m[1].slice(4, 6), 16) - Math.round(255 * (pct / 100)));
  const to2 = (n: number) => n.toString(16).padStart(2, '0');
  return `#${to2(r)}${to2(g)}${to2(b)}`;
}

function buildFallbackSlideHtml(
  title: string,
  keyPoints: string[],
  slideWidth: number,
  slideHeight: number,
  primaryColor: string = '#2563eb',
): string {
  const padX = Math.max(32, Math.round((64 * slideWidth) / 1280 / 8) * 8);
  const padY = Math.max(24, Math.round((48 * slideHeight) / 720 / 8) * 8);
  const safeTitle = escapeHtmlText(title);
  const darker = darkenColorHex(primaryColor, 20);
  // 8 位 alpha 附加：将 primaryColor #RRGGBB → #RRGGBB08 / #RRGGBB10 / #RRGGBB15
  const pc08 = `${primaryColor}08`;
  const pc10 = `${primaryColor}10`;
  const pc15 = `${primaryColor}15`;
  const pc14 = `${primaryColor}14`;
  const pc1f = `${primaryColor}1f`;
  const items = keyPoints
    .map((p) => {
      const k = escapeHtmlText(p);
      return `<li style="display:flex;align-items:center;gap:16px;padding:16px 24px;border-radius:12px;background:linear-gradient(135deg,${pc08},${pc10});border-left:5px solid ${primaryColor};box-shadow:0 4px 16px ${pc15};list-style:none;margin:0;">
  <span style="width:40px;height:40px;border-radius:12px;background:linear-gradient(135deg,${pc14},${pc1f});display:flex;align-items:center;justify-content:center;flex-shrink:0;">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="${primaryColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
  </span>
  <span style="font-size:19px;font-weight:500;color:#111827;line-height:1.6;flex:1;min-width:0;overflow-wrap:break-word;word-break:break-word;">${k}</span>
</li>`;
    })
    .join('');
  return `<div style="width:100%;height:100%;overflow:hidden;box-sizing:border-box;padding:${padY}px ${padX}px;display:flex;flex-direction:column;background-color:#fff;">
  <h2 style="margin:0 0 32px 0;font-size:50px;font-weight:700;line-height:1.25;letter-spacing:-0.01em;background:linear-gradient(135deg,${primaryColor},${darker});-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;overflow-wrap:break-word;word-break:break-word;">${safeTitle || '&nbsp;'}</h2>
  ${
    items
      ? `<ul style="margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:16px;">${items}</ul>`
      : ''
  }
</div>`;
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
    const contentConfig = modelConfigs?.content || modelConfig!;
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
    const contentConfig = modelConfigs?.content || modelConfig!;
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
    const contentConfig = modelConfigs?.content || modelConfig!;
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
  // REF_ATTRS_EXTRACTOR_VERSION 改变即代表参考提取逻辑变更（如「结构克隆」改造），
  // 必须让旧缓存失效——否则修复不生效。
  private static readonly REF_ATTRS_EXTRACTOR_VERSION = 'v2-structure';
  private computeRefAttrsHash(req: GeneratePresentationRequest): string {
    const fields = [
      AiService.REF_ATTRS_EXTRACTOR_VERSION,
      req.referenceHtml ?? '',
      req.referenceImage ?? '',
      req.referenceHtmlCover ?? '',
      req.referenceHtmlContent ?? '',
      req.referenceHtmlSummary ?? '',
      req.referenceHtmlGlobal ?? '',
      req.referenceImageCover ?? '',
      req.referenceImageContent ?? '',
      req.referenceImageSummary ?? '',
      req.referenceImageGlobal ?? '',
    ];
    return createHash('sha1').update(fields.join('\u0001')).digest('hex');
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
    if (!rva) return [];
    const appliedFields = new Set<string>();
    for (const c of [
      rva.global,
      rva.byCategory.cover,
      rva.byCategory.content,
      rva.byCategory.summary,
    ]) {
      if (!c?.uploaded || !c.style) continue;
      for (const k of Object.keys(c.style)) appliedFields.add(k);
    }
    return appliedFields.size ? Array.from(appliedFields) : [];
  }

  // 单一出口补齐「参考原图 URL + 尺寸」：用已落盘文件兜底回写 master.logo.src / refW / refH / referenceImageUrl。
  // 与 attachMasterLogoSources 职责区分：后者本论新上传原图→落盘；本方法缓存命中/未重传时从磁盘兜底。
  // 两者幂等（同值覆盖），且在 4 个已覆盖入口会重复执行，无副作用。失败仅 warn，绝不中断生成。
  private backfillReferenceOriginalSources(
    referenceVisualAttributes: ReferenceVisualAttributes | null | undefined,
    presentationId: string | undefined,
  ): void {
    if (!referenceVisualAttributes || !presentationId) return;
    try {
      const originals: {
        cover?: { url: string; width?: number; height?: number };
        content?: { url: string; width?: number; height?: number };
        summary?: { url: string; width?: number; height?: number };
      } = {};
      let count = 0;
      for (const slot of ['cover', 'content', 'summary'] as const) {
        try {
          const ex = this.storage.readReferenceOriginalImage(presentationId, slot);
          if (ex) {
            originals[slot] = ex;
            count++;
          }
        } catch (e) {
          console.warn(`[REF-CACHE] read existing original image failed (${slot}):`, e);
        }
      }
      if (count === 0) return;
      applyMasterLogoSources(referenceVisualAttributes, originals);
      applyReferenceImageUrlSources(referenceVisualAttributes, originals);
      console.log(`[REF-CACHE] 单一出口补齐 src/尺寸: 命中 ${count} 个槽位`);
    } catch (e) {
      console.warn('[REF-LOGO] backfill reference original sources failed:', e);
    }
  }

  // 将参考图片原图副本（Q7）按 presentationId 暂存，供后续母版 LOGO 开窗复用（FR-16）。
  // 返回各分类暂存后可访问的 URL 映射，供 applyMasterLogoSources 回写到 master.logo.src。
  private async persistReferenceOriginals(req: GeneratePresentationRequest): Promise<{
    cover?: { url: string; width?: number; height?: number };
    content?: { url: string; width?: number; height?: number };
    summary?: { url: string; width?: number; height?: number };
  }> {
    const presentationId = req.presentationId;
    const result: {
      cover?: { url: string; width?: number; height?: number };
      content?: { url: string; width?: number; height?: number };
      summary?: { url: string; width?: number; height?: number };
    } = {};
    if (!presentationId) return result;
    const slots: Array<['cover' | 'content' | 'summary', string | undefined]> = [
      ['cover', req.referenceImageCoverOriginal],
      ['content', req.referenceImageContentOriginal],
      ['summary', req.referenceImageSummaryOriginal],
    ];
    for (const [slot, dataUrl] of slots) {
      if (dataUrl) {
        try {
          result[slot] = await this.storage.saveReferenceOriginalImage(
            presentationId,
            slot,
            dataUrl,
          );
        } catch (e) {
          console.warn(`[REF-CACHE] save original image failed (${slot}):`, e);
        }
      } else {
        // 分步生成 / 缓存命中：本轮未重新上传原图 dataURL，但上一轮已落盘 → 直接复用磁盘文件，
        // 使 content/summary 的 master.logo.src 跨步骤不丢失（FR-16 修正）。
        try {
          const existing = this.storage.readReferenceOriginalImage(presentationId, slot);
          if (existing) result[slot] = existing;
        } catch (e) {
          console.warn(`[REF-CACHE] read existing original image failed (${slot}):`, e);
        }
      }
    }
    return result;
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
    if (!referenceVisualAttributes) return;
    try {
      applyMasterLogoSources(referenceVisualAttributes, originals);
      // FR-0：同步把各分类参考原图 URL 回写到 referenceImageUrl，使封面/总结页 hero 背景走落盘 URL（避免 base64 内联膨胀）
      applyReferenceImageUrlSources(referenceVisualAttributes, originals);
    } catch (e) {
      console.warn('[REF-LOGO] attach master logo sources failed:', e);
    }
  }

  private buildReferenceBrief(attrs: ReferenceVisualAttributes | null): string {
    if (!attrs) return '';
    const parts = [
      attrs.byCategory.cover.briefText,
      attrs.byCategory.content.briefText,
      attrs.byCategory.summary.briefText,
      attrs.global.briefText,
    ].filter((p): p is string => !!p && p.length > 0);
    return parts.join('\n\n');
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
    const { referenceVisualAttributes, refAttrsVersion, source } =
      await this.resolveReferenceVisualAttributes(req);
    const referenceHtmlBrief = this.buildReferenceBrief(referenceVisualAttributes);
    // 可观测：统一在生成入口记录四类参考 HTML 长度与 brief 长度、版本号与来源，
    // 便于在报文/日志中判断"参考文件是否上传成功、抽到了哪些内容"。
    const htmlCover = req.referenceHtmlCover ?? '';
    const htmlContent = req.referenceHtmlContent ?? '';
    const htmlSummary = req.referenceHtmlSummary ?? '';
    const htmlGlobal = req.referenceHtmlGlobal ?? req.referenceHtml ?? '';
    console.log(
      `[REF-GEN] refAttrsVersion=${refAttrsVersion} source=${source} ` +
        `htmlLen: cover=${htmlCover.length} content=${htmlContent.length} summary=${htmlSummary.length} global=${htmlGlobal.length} ` +
        `briefLen=${referenceHtmlBrief.length} rva=${referenceVisualAttributes ? 'present' : 'null'}`,
    );
    return {
      referenceVisualAttributes: referenceVisualAttributes ?? undefined,
      referenceHtmlBrief,
      refAttrsVersion,
    };
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
    const contentConfig = modelConfigs?.content || modelConfig!;
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
      enableAudit?: boolean;
    },
  ): Promise<Presentation> {
    const {
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
      design,
      agent,
      generationOptions,
      enableAudit,
    } = params;

    const finalWidth = presentation.width || slideWidth || 1280;
    const finalHeight = presentation.height || slideHeight || 720;

    // —— Task4 / FR-3: 单源 primary 链（5 级优先级 resolveEffectivePrimaryColor）——
    // 全链路所有需要 primaryColor 的子阶段均从 finalEffectivePrimary 派生，
    // 彻底消除「design?.primaryColor / plan?.primaryColor / 局部 primaryColor 互相冲突」
    // 导致的 styleViolationSignal 错主题色误判（本规格 spec 3.9 根因）。
    // 额外：开发环境下若最终值与任何候选冲突，打印详细来源。
    // FR-2.x：参考主色纳入终局单源链（参考 > 用户 > 默认蓝），与 3512 triage / 903 主管线一致；
    // 避免无参考覆盖时回落默认蓝 #2563eb（缺口2：此前此处 5 级链缺参考分支，会把 design.primaryColor 写回蓝色，与红色成品冲突）。
    const refDeckPrimaryForFinal = resolveDeckReferencePrimaryColor(
      (generationOptions as any)?.referenceVisualAttributes ?? null,
    );
    const finalEffectivePrimary = refDeckPrimaryForFinal
      ? refDeckPrimaryForFinal
      : resolveEffectivePrimaryColor(
          { primaryColor, colorTheme },
          {
            primaryColor:
              (design as any)?.primaryColor ?? (presentation as any).design?.primaryColor,
            colorTheme: (design as any)?.colorTheme ?? (presentation as any).design?.colorTheme,
          },
          '#2563eb',
        );
    // 如果 presentation.result 内 design.primaryColor（旧值）与 5 级链结果不一致 → 写回修正 presentation
    {
      const presDesign = (presentation as any).design;
      if (presDesign && typeof presDesign === 'object') {
        if (
          presDesign.primaryColor &&
          presDesign.primaryColor.toLowerCase() !== finalEffectivePrimary
        ) {
          console.warn(
            `[DESIGN] presentation.design.primaryColor(${presDesign.primaryColor}) 与 5 级链结果(${finalEffectivePrimary}) 不一致，已覆盖（colorTheme=${colorTheme ?? 'N/A'} primaryColorOption=${primaryColor ?? 'N/A'}）。`,
          );
        }
        presDesign.primaryColor = finalEffectivePrimary;
        if (colorTheme) presDesign.colorTheme = colorTheme;
      }
    }
    if (generationOptions) {
      generationOptions.primaryColor = finalEffectivePrimary;
      if (colorTheme) generationOptions.colorTheme = colorTheme;
    }
    console.log(
      `[DESIGN-SINGLE-SOURCE] 终局 primaryColor=${finalEffectivePrimary}（用户 primaryColor=${
        primaryColor ?? 'N/A'
      } | colorTheme=${colorTheme ?? 'N/A'} | design.colorTheme=${
        (design as any)?.colorTheme ?? 'N/A'
      } | design.primaryColor=${(design as any)?.primaryColor ?? 'N/A'}${refDeckPrimaryForFinal ? ` | refDeckPrimary=${refDeckPrimaryForFinal} reference-first` : ''}）。`,
    );

    let result: Presentation;
    if (presentationId) {
      result = {
        id: presentationId,
        title: presentation.title,
        slides: [],
        selectedSlideId: '',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        width: finalWidth,
        height: finalHeight,
      } as Presentation;
    } else {
      result = LayoutEngine.createPresentation(presentation.title, finalWidth, finalHeight);
    }

    result.slides = presentation.slides.map((slide, index) =>
      LayoutEngine.normalizeAISlide({
        id: LayoutEngine.createSlide(index).id,
        title: slide.title,
        html: slide.html,
        notes: slide.notes,
        hidden: false,
        index,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );

    // ———— 溢出风险指数估算日志（便于后续观察上图下文/纯文字页溢出率） ————
    try {
      const padYMatch = result.slides[0]?.html.match(/padding\s*:\s*(\d+)px\s+\d+px/i);
      const padY = padYMatch ? parseInt(padYMatch[1]) : 48;
      const availH = finalHeight - padY * 2;
      for (let i = 0; i < result.slides.length; i++) {
        const s = result.slides[i];
        const h = s.html;
        const hasH2 = /<h2\b/i.test(h);
        const liCount = (h.match(/<li\b/gi) || []).length;
        // 同时检测两种垂直图片布局：TOP（imgWrap在list前）和 BOTTOM（list在imgWrap前，即下文上图DOM换序）
        // 先分别找 H2 后第一个 imgWrap(带flex:0 0 XX%且内部有img) 和 第一个 <ul/ol>
        let layoutMode: 'top' | 'bottom' | null = null;
        let imgFlexPct: number | null = null;
        if (hasH2 && liCount > 0) {
          const h2M = h.match(/<h2\b[^>]*>[\s\S]*?<\/h2>/i);
          if (h2M && h2M.index !== undefined) {
            const after = h.slice(h2M.index + h2M[0].length);
            const imgM = after.match(/<img\b/i);
            const listM = after.match(/<(ul|ol)\b/i);
            if (imgM && listM && imgM.index != null && listM.index != null) {
              // 找 <img 之前最近的 div(flex:0 0 XX%)
              const beforeImg = after.slice(0, imgM.index);
              const divFlexM = beforeImg.match(
                /<div\b[^>]*style="[^"]*flex\s*:\s*0\s+0\s+(\d+)(?:\.\d+)?%[^"]*"[^>]*>(?=[^>]*$)/,
              );
              // 上面的断言可能太严格，退一步：取 beforeImg 中最后一个 <div style="...flex:0 0 XX%"> 的匹配
              let lastFlex: RegExpMatchArray | null = null;
              const re = /<div\b[^>]*style="[^"]*flex\s*:\s*0\s+0\s+(\d+)(?:\.\d+)?%[^"]*"[^>]*>/gi;
              let mm: RegExpExecArray | null;
              while ((mm = re.exec(beforeImg)) !== null) lastFlex = mm;
              if (lastFlex) {
                imgFlexPct = parseFloat(lastFlex[1]);
                layoutMode = imgM.index < listM.index ? 'top' : 'bottom';
              } else if (divFlexM) {
                imgFlexPct = parseFloat(divFlexM[1]);
                layoutMode = imgM.index < listM.index ? 'top' : 'bottom';
              }
            }
          }
        }
        const hasVerticalImg = layoutMode != null;
        const imgH = imgFlexPct != null ? (availH * imgFlexPct) / 100 : 0;
        const h2H = hasH2 ? 44 * 1.25 + 32 : 0;
        const avgLiH =
          liCount > 0 && /padding\s*:\s*12px\s+20px/i.test(h)
            ? 12 * 2 + 20 * 1.4 + 12
            : 16 * 2 + 24 * 1.4 + 16;
        const liH =
          liCount > 0
            ? avgLiH *
              (hasVerticalImg && /display\s*:\s*grid/i.test(h) ? Math.ceil(liCount / 2) : liCount)
            : 0;
        const estH = h2H + imgH + liH;
        const ratio = availH > 0 ? estH / availH : 0;
        const level: 'low' | 'mid' | 'high' = ratio > 1.05 ? 'high' : ratio > 0.92 ? 'mid' : 'low';
        const isGrid = /display\s*:\s*grid/i.test(h);
        if (level !== 'low' || hasVerticalImg) {
          const msgBase =
            `risk=${level} estH=${estH.toFixed(0)}px avail=${availH}px ratio=${ratio.toFixed(2)} ` +
            `vLayout=${layoutMode ?? 'none'} imgFlex=${imgFlexPct ?? 0}% liCount=${liCount} grid=${isGrid}`;
          if (level === 'high') {
            console.warn(
              `[${formatBeijingTime()}] [AI:OVERFLOW-RISK] slide ${i + 1} "${s.title}": ${msgBase}`,
            );
          } else if (consoleDetailedLocal && hasVerticalImg) {
            console.log(
              `[${formatBeijingTime()}] [AI:OVERFLOW-RISK] slide ${i + 1} "${s.title}": ${msgBase}`,
            );
          }
        }
      }
    } catch (e) {
      // 日志绝不影响主流程
      void e;
    }

    if (presentation.transition) {
      (result as any).transition = presentation.transition;
    }
    if (presentation.primaryColor) {
      (result as any).primaryColor = presentation.primaryColor;
    }
    // ———— B-3 · 显式透传 imagePreference 到 result ————
    // 这是孤儿救援逻辑 L335 的 explicitPref 来源：如果这里漏掉，explicitPref=undefined，
    // 会 fallback 到 inferImagePreferenceFromPresentation，从而误判成 minimal（因为
    // 救援之前本来就没图），最终 cover/summary 的 BG 注入永远不触发，陷入"没图→infer minimal
    // →不填→还是没图"的死循环。
    if ((presentation as any).imagePreference) {
      (result as any).imagePreference = (presentation as any).imagePreference;
    }

    if (!presentationId) {
      this.storage.ensurePresentationDir(result.id);
    }

    const IMAGE_PLACEHOLDER = 'https://NOPPT_IMAGE_PLACEHOLDER';
    const imgUrlCache = new Map<string, string>();
    const detailed = consoleDetailedLocal;
    let downloadedCount = 0;
    let bareTextFixed = 0;

    if (detailed) {
      console.log(`[${formatBeijingTime()}] [AI] Image config enabled:`, imageConfig?.enabled);
      console.log(
        `[${formatBeijingTime()}] [AI] Image useDefaultProvider:`,
        imageConfig?.useDefaultProvider,
      );
    }

    for (let slideIndex = 0; slideIndex < result.slides.length; slideIndex++) {
      const slide = result.slides[slideIndex];
      // ⚠️【B-3 Server 端同步兜底】先过一遍语义化修复，再处理占位符/下载图片/孤儿图片。
      // 这样即使 AI 端漏掉裸文本（例如非标准流程生成的 HTML），Server 侧仍然保证无裸文本。
      const preLength = slide.html.length;
      slide.html = this.ensureSemanticWrapping(slide.html);
      if (slide.html.length !== preLength) {
        bareTextFixed++;
        if (detailed) {
          console.log(
            `[${formatBeijingTime()}] [AI] Slide ${slideIndex + 1} "${slide.title}" cleaned bare text (${preLength} → ${slide.html.length} chars) by server-side ensureSemanticWrapping`,
          );
        }
      }
      const hasPlaceholder = slide.html.includes(IMAGE_PLACEHOLDER);
      if (hasPlaceholder && detailed) {
        console.log(
          `[${formatBeijingTime()}] [AI] Slide ${slideIndex + 1} "${slide.title}" has image placeholder - removing (image gen failed or disabled)`,
        );
      }
      if (hasPlaceholder) {
        slide.html = slide.html.replace(
          /<div[^>]*>\s*<img[^>]*src=["']https:\/\/NOPPT_IMAGE_PLACEHOLDER["'][^>]*>\s*<\/div>/gi,
          '',
        );
        slide.html = slide.html.replace(
          /<img[^>]*src=["']https:\/\/NOPPT_IMAGE_PLACEHOLDER["'][^>]*>/gi,
          '',
        );
      }

      const imgRegex = /<img[^>]*src\s*=\s*["']([^"']*)["'][^>]*>/gi;
      let match;
      const imgsToReplace: Array<{ original: string; replacement: string }> = [];

      while ((match = imgRegex.exec(slide.html)) !== null) {
        const originalUrl = match[1]
          .trim()
          .replace(/^`|`$/g, '')
          .trim()
          .replace(/^["']|["']$/g, '')
          .trim();

        const isPlaceholder =
          originalUrl === IMAGE_PLACEHOLDER || originalUrl.includes('NOPPT_IMAGE_PLACEHOLDER');
        if (isPlaceholder) {
          imgsToReplace.push({ original: match[0], replacement: '' });
          continue;
        }

        if (
          originalUrl &&
          !originalUrl.startsWith('/data/') &&
          !originalUrl.startsWith('http://localhost') &&
          !originalUrl.startsWith('#') &&
          !originalUrl.startsWith('data:')
        ) {
          if (!imgUrlCache.has(originalUrl)) {
            try {
              if (detailed) {
                console.log(
                  `[${formatBeijingTime()}] [AI] Downloading image from URL: ${originalUrl.substring(0, 100)}...`,
                );
              }
              const localPath = await this.storage.saveImageFromUrl(result.id, originalUrl);
              imgUrlCache.set(originalUrl, localPath);
              downloadedCount++;
              if (detailed) {
                console.log(`[${formatBeijingTime()}] [AI] Image saved locally to: ${localPath}`);
              }
            } catch (e) {
              console.error(`[${formatBeijingTime()}] [AI] Failed to download/save image:`, e);
              imgUrlCache.set(originalUrl, originalUrl);
            }
          }
          const localUrl = imgUrlCache.get(originalUrl);
          if (localUrl && localUrl !== originalUrl) {
            imgsToReplace.push({ original: originalUrl, replacement: localUrl });
          }
        }
      }

      for (const { original, replacement } of imgsToReplace) {
        slide.html = slide.html.split(original).join(replacement);
      }

      const bgImgRegex = /background-image\s*:\s*[^;]*url\(\s*['"]?([^'")]+)['"]?\s*\)[^;]*;?/gi;
      let bgMatch;
      const bgImgsToReplace: Array<{ original: string; url: string; replacement: string }> = [];

      while ((bgMatch = bgImgRegex.exec(slide.html)) !== null) {
        const originalUrl = bgMatch[1]
          .trim()
          .replace(/^`|`$/g, '')
          .trim()
          .replace(/^["']|["']$/g, '')
          .trim();

        const isPlaceholder =
          originalUrl.includes('NOPPT_BG_PLACEHOLDER') ||
          originalUrl.includes('NOPPT_IMAGE_PLACEHOLDER');
        if (isPlaceholder) {
          continue;
        }

        if (
          originalUrl &&
          !originalUrl.startsWith('/data/') &&
          !originalUrl.startsWith('http://localhost') &&
          !originalUrl.startsWith('#') &&
          !originalUrl.startsWith('data:')
        ) {
          if (!imgUrlCache.has(originalUrl)) {
            try {
              if (detailed) {
                console.log(
                  `[${formatBeijingTime()}] [AI] Downloading background image from URL: ${originalUrl.substring(0, 100)}...`,
                );
              }
              const localPath = await this.storage.saveImageFromUrl(result.id, originalUrl);
              imgUrlCache.set(originalUrl, localPath);
              downloadedCount++;
              if (detailed) {
                console.log(
                  `[${formatBeijingTime()}] [AI] Background image saved locally to: ${localPath}`,
                );
              }
            } catch (e) {
              console.error(
                `[${formatBeijingTime()}] [AI] Failed to download/save background image:`,
                e,
              );
              imgUrlCache.set(originalUrl, originalUrl);
            }
          }
          const localUrl = imgUrlCache.get(originalUrl);
          if (localUrl && localUrl !== originalUrl) {
            const newBgDecl = bgMatch[0].replace(originalUrl, localUrl);
            bgImgsToReplace.push({
              original: bgMatch[0],
              url: originalUrl,
              replacement: newBgDecl,
            });
          }
        }
      }

      for (const { original, replacement } of bgImgsToReplace) {
        slide.html = slide.html.split(original).join(replacement);
      }
    }

    if (!detailed && (downloadedCount > 0 || bareTextFixed > 0)) {
      simpleLog('AI:POST', '后处理完成', {
        images: downloadedCount,
        bareTextFixed,
        slides: result.slides.length,
      });
    }

    // ========== 兜底：扫描磁盘孤儿配图 → 回填到无图内容页 / 封面 / 总结 ==========
    // B-3 扩展：感知 imagePreference
    //  - 优先使用 presentation.imagePreference（AI 包透传）；否则启发式推断
    //  - pref=all 下 cover/summary 不再过滤，优先使用背景大图注入
    //  - 新增 injectOrphanImageIntoBackground 给 cover/summary 用
    let orphanRescued = 0;
    try {
      const imagesDir = this.storage.getImagesDir(result.id);
      const allFiles = this.storage.listDir(imagesDir);
      const imageFiles = allFiles.filter((f) => /\.(png|jpe?g|webp)$/i.test(f));
      const htmlSoup = result.slides.map((s) => s.html).join('\n');
      const orphans = imageFiles.filter((name) => !htmlSoup.includes(name));
      if (orphans.length > 0) {
        if (detailed) {
          console.log(
            `[${formatBeijingTime()}] [AI] Found ${orphans.length} orphan images on disk, trying to rescue:`,
            orphans,
          );
        }

        // B-3 · step1：确定本次生成的 imagePreference
        const explicitPref = (result as any).imagePreference as ImagePreference | undefined;
        const pref = explicitPref || this.inferImagePreferenceFromPresentation(result);
        if (detailed) {
          console.log(
            `[${formatBeijingTime()}] [AI]   effective imagePreference: ${pref} (explicit=${Boolean(explicitPref)})`,
          );
        }

        let orphanIdx = 0;
        const orphanUrlAt = (i: number) =>
          `/data/workspace/presentations/${result.id}/assets/images/${orphans[i]}`;

        // B-3 · step2：all 模式优先回填封面（第一张 cover-like）和总结（最后一张 summary-like）
        const singleSlideMode = result.slides.length === 1;
        if (
          (pref === 'all' || pref === 'content-only' || singleSlideMode) &&
          result.slides.length > 0
        ) {
          const tryInjectCoverSummary = (index: number, kind: 'cover' | 'summary') => {
            if (orphanIdx >= orphans.length) return;
            const slide = result.slides[index];
            if (!slide) return;
            if (/<img\b/i.test(slide.html)) return;
            if (pref !== 'all' && !singleSlideMode) return;
            const orphanUrl = orphanUrlAt(orphanIdx);
            const rebuilt = this.injectOrphanImageIntoBackground(slide.html, orphanUrl, kind, {
              pageType: (slide as any).pageType,
            });
            if (rebuilt !== slide.html) {
              if (detailed) {
                console.log(
                  `[${formatBeijingTime()}] [AI]   + slide ${index + 1} "${slide.title}" <-- ${orphans[orphanIdx]} (${kind} BG injection)`,
                );
              }
              slide.html = rebuilt;
              orphanIdx++;
            }
          };
          tryInjectCoverSummary(0, 'cover');
          tryInjectCoverSummary(result.slides.length - 1, 'summary');
        }

        if (orphanIdx < orphans.length) {
          const rescueFew = pref === 'minimal' || pref === 'none';
          const maxFill = rescueFew ? Math.min(2, orphans.length) : orphans.length;
          for (
            let s = 0;
            s < result.slides.length && orphanIdx < orphans.length && orphanIdx < maxFill;
            s++
          ) {
            const slide = result.slides[s];
            if (/<img\b/i.test(slide.html)) continue;
            if (pref !== 'all' && !singleSlideMode) {
              const isCoverLike =
                /font-size:\s*[7-9]\dpx|font-size:\s*1\d{2,}px|<h1\b|目录|总结|感谢|开启.*纪元|结论/i.test(
                  `${slide.title} ${slide.html}`,
                );
              if (isCoverLike) continue;
            }
            if (!this.slideHasMeaningfulBody(slide.html)) continue;
            const orphanUrl = orphanUrlAt(orphanIdx);
            const rebuilt = this.injectOrphanImageIntoSlide(slide.html, orphanUrl, {
              pageType: (slide as any).pageType,
            });
            if (rebuilt !== slide.html) {
              if (detailed) {
                console.log(
                  `[${formatBeijingTime()}] [AI]   + slide ${s + 1} "${slide.title}" <-- ${orphans[orphanIdx]}`,
                );
              }
              slide.html = rebuilt;
              orphanIdx++;
            }
          }
        }
        orphanRescued = orphanIdx;
        if (orphanIdx > 0) {
          if (detailed) {
            console.log(
              `[${formatBeijingTime()}] [AI] Orphan rescue complete: ${orphanIdx}/${orphans.length} attached (pref=${pref})`,
            );
          } else {
            simpleLog('AI:ORPHAN', '孤儿配图救援完成', {
              rescued: `${orphanIdx}/${orphans.length}`,
              pref,
            });
          }
        } else if (orphans.length > 0) {
          console.warn(
            `[${formatBeijingTime()}] [AI] Orphan rescue: none of ${orphans.length} could be injected (pref=${pref})`,
          );
        }
      }
    } catch (orphanErr) {
      console.warn(
        `[${formatBeijingTime()}] [AI] Orphan image rescue skipped due to error:`,
        orphanErr,
      );
    }

    // ========== 终局兜底（写入磁盘前的最后防线）==========
    let finalGuardFixed = 0;
    let finalGuardRescued = 0;
    try {
      // ——— 防线 1：裸文本终局校正 ———
      for (let idx = 0; idx < result.slides.length; idx++) {
        const slide = result.slides[idx];
        const prevLen = slide.html.length;
        slide.html = this.ensureSemanticWrapping(slide.html);
        if (slide.html.length !== prevLen) {
          finalGuardFixed++;
          if (detailed) {
            console.log(
              `[${formatBeijingTime()}] [AI] [FINAL-GUARD-1] slide ${idx + 1} "${slide.title}" final bare-text cleanup (${prevLen}→${slide.html.length})`,
            );
          }
        }
      }
      // ——— 防线 2：孤儿图片终局注入 ———
      try {
        const imagesDir2 = this.storage.getImagesDir(result.id);
        const allFiles2 = this.storage.listDir(imagesDir2);
        const imageFiles2 = allFiles2.filter((f) => /\.(png|jpe?g|webp)$/i.test(f));
        const soup2 = result.slides.map((s) => s.html).join('\n');
        const orphans2 = imageFiles2.filter((name) => !soup2.includes(name));
        if (orphans2.length > 0) {
          if (detailed) {
            console.log(
              `[${formatBeijingTime()}] [AI] [FINAL-GUARD-2] found ${orphans2.length} unplaced images after main guard, retry rescue...`,
            );
          }
          const explicitPref2 = (result as any).imagePreference as ImagePreference | undefined;
          const pref2 = explicitPref2 || this.inferImagePreferenceFromPresentation(result);
          const singleSlide2 = result.slides.length === 1;
          const urlOf = (i: number) =>
            `/data/workspace/presentations/${result.id}/assets/images/${orphans2[i]}`;
          let oi = 0;
          const rescueFew2 = pref2 === 'minimal' || pref2 === 'none';
          const maxF = rescueFew2 ? Math.min(2, orphans2.length) : orphans2.length;
          for (
            let sIdx = 0;
            sIdx < result.slides.length && oi < orphans2.length && oi < maxF;
            sIdx++
          ) {
            const slide = result.slides[sIdx];
            if (/<img\b/i.test(slide.html)) continue;
            if (pref2 !== 'all' && !singleSlide2) {
              const cLike =
                /font-size:\s*[7-9]\dpx|font-size:\s*1\d{2,}px|<h1\b|目录|总结|感谢|开启.*纪元|结论/i.test(
                  `${slide.title} ${slide.html}`,
                );
              if (cLike) continue;
            }
            if (!this.slideHasMeaningfulBody(slide.html)) continue;
            const rebuilt = this.injectOrphanImageIntoSlide(slide.html, urlOf(oi), {
              pageType: (slide as any).pageType,
            });
            if (rebuilt !== slide.html) {
              if (detailed) {
                console.log(
                  `[${formatBeijingTime()}] [AI] [FINAL-GUARD-2] slide ${sIdx + 1} "${slide.title}" <-- ${orphans2[oi]}`,
                );
              }
              slide.html = rebuilt;
              oi++;
            }
          }
          finalGuardRescued = oi;
          if (oi > 0 && detailed) {
            console.log(
              `[${formatBeijingTime()}] [AI] [FINAL-GUARD-2] rescued ${oi}/${orphans2.length} images via final guard`,
            );
          }
        }
      } catch (e2) {
        console.warn(
          `[${formatBeijingTime()}] [AI] [FINAL-GUARD-2] skipped due to error:`,
          (e2 as Error).message,
        );
      }
    } catch (finalGuardErr) {
      console.warn(
        `[${formatBeijingTime()}] [AI] [FINAL-GUARD] skipped due to error:`,
        (finalGuardErr as Error).message,
      );
    }

    if (!detailed) {
      simpleLog('AI', '生成完成', {
        slides: result.slides.length,
        title: result.title.length > 30 ? result.title.substring(0, 30) + '…' : result.title,
        orphanRescued,
        finalGuardFixed,
        finalGuardRescued,
      });
    }

    // =============== 终局写盘：无论本次是新建（!presentationId）还是覆盖已有 pres（有 presentationId），
    // 只要 AI 生成完了，就强制把完整 result（含 <img> 的 layout）写回磁盘，
    // 彻底解决「前端 editor 模式下后端跳过写盘，前端 savePresentation 竞态导致 presentation.json 保存残缺裸文本版本」的根因。
    {
      // 🛡️ 写盘前最终 XSS 防线：服务端 HTML 白名单 sanitize，与前端 security.ts 保持一致
      for (const slide of result.slides) {
        if (slide.html && typeof slide.html === 'string') {
          slide.html = sanitizeHtmlServerSide(slide.html);
        }
      }

      // —— finalGuard：写盘前对每页 HTML 重放后处理全链（兜底任何未 post 的通道产物）——
      const finalSanitizeStat = { pages: result.slides.length, reapplied: 0, assertionFailed: 0 };
      // FR-3 / Task 4：finalMainColor 由函数入口的 finalEffectivePrimary 派生，
      // 并在下方「逐页」用参考主色（resolveReferencePrimaryColor）前置裁决后覆盖（参考 > 用户显式 > 默认蓝）。
      const slideW = slideWidth || finalWidth || 1280;
      const slideH = slideHeight || finalHeight || 720;
      // FR-A（回归修复）：参考属性来源兜底。generationOptions 在分步 finalizePresentation 等路径可能未带来源，
      // 此时用 presentationId + req 字段回源重解析（resolveReferenceVisualAttributes 内部走 sha1 缓存，命中零 I/O），
      // 确保逐页参考主色裁决不丢失（否则回落默认蓝，把参考红色重染）。
      let rva: ReferenceVisualAttributes | null | undefined =
        generationOptions?.referenceVisualAttributes;
      if (!rva) {
        try {
          rva =
            (
              await this.resolveReferenceVisualAttributes({
                presentationId,
                referenceHtml,
                referenceImage,
              } as any)
            ).referenceVisualAttributes ?? undefined;
        } catch {
          rva = undefined;
        }
      }

      for (const [i, slide] of result.slides.entries()) {
        if (!slide.html || typeof slide.html !== 'string') continue;
        const raw = slide.html;
        // FR-2.x：逐页用参考主色前置裁决——若该页对应分类/全局上传了参考图且含合法主色则以此为准，
        // 否则回落 finalEffectivePrimary（与今日行为完全一致，向后兼容）。
        // FR-0/FR-4：优先用 slide 自身 pageType；缺失（如前端 editor 落盘的残缺版本）时按位置兜底，
        // 避免 pageTypeToCategory('') 一律回落 'content'，使封面/总结取到各自参考色而非默认蓝。
        const rawPageType = String((slide as any)?.pageType ?? '').toLowerCase();
        const pageType =
          rawPageType ||
          (i === 0 ? 'cover' : i === result.slides.length - 1 ? 'summary' : 'content');
        // 终局逐页取色三级链：分类参考主色 → deck 级参考主色 → finalEffectivePrimary（用户显式/默认蓝）。
        // 修复收尾缺口：某分类参考图缺失（或 VLM 未抽出主色）且 global 也无主色时，取 deck 级参考红，
        // 避免该页回落默认蓝 #2563eb（plan 第 ④ 项）。
        const pageRefPrimary = resolveReferencePrimaryColor(rva ?? undefined, pageType);
        const finalMainColor = resolveFinalPagePrimaryColor(
          rva ?? undefined,
          pageType,
          finalEffectivePrimary,
        );
        // 参考撞色板 / 标题色 / 正文色 / 描边色 → 终局越权信号白名单，避免参考多色页被误判越权而反复重放。
        const cat =
          pageType === 'cover' || pageType === 'page-cover'
            ? 'cover'
            : pageType === 'summary' ||
                pageType === 'conclusion' ||
                pageType === 'ending' ||
                pageType === 'end'
              ? 'summary'
              : 'content';
        const slidePalette = rva ? getReferencePaletteForPage(rva, pageType) : undefined;
        const styleRef = rva ? (rva.byCategory[cat] ?? rva.global) : undefined;
        const allowedAccentHexes = new Set<string>(
          [
            ...(slidePalette?.accents || []),
            slidePalette?.strokeColor,
            slidePalette?.primary,
            (styleRef as any)?.style?.titleColor,
            (styleRef as any)?.style?.bodyColor,
          ]
            .filter((c): c is string => !!c)
            .map((c) => c.toLowerCase()),
        );
        if (!pageRefPrimary && finalMainColor !== finalEffectivePrimary) {
          console.log(
            `[FINAL] 第 ${i + 1} 页(${pageType}) 分类参考主色缺失 → deck 级参考主色 ${finalMainColor} 兜底（避免回落默认蓝）`,
          );
        }
        const proofOfViolation = styleViolationSignal(raw, finalMainColor, { allowedAccentHexes }); // breakdown: StyleViolationBreakdown
        const proofSamples = collectStyleViolationSamples(raw, proofOfViolation);
        // NFR-5 / Task 9: 只要 signal>0 立即打印三分量明细（便于以后调查误判）
        if (proofOfViolation.total > 0) {
          console.warn(
            `[FINAL][WARN] 第 ${i + 1} 页 "${slide.title?.slice(0, 30) || ''}" 样式越权信号存在 pre-replay：` +
              `total=${proofOfViolation.total} ` +
              `(neutralFont22_29=${proofOfViolation.neutralFont22_29} ` +
              `neutralPxSticky=${proofOfViolation.neutralPxSticky} ` +
              `colorViolations=${proofOfViolation.colorViolations}) ` +
              `samples=${formatStyleViolationSamplesSummary(finalMainColor, proofSamples)}`,
          );
        }
        // FR-1 Q1 / Task 1.4：仅当任一分量超过阈值时才重放 postProcessHtmlSnapshot
        // （而不是任何 total>0 就重放）
        if (exceedsThreshold(proofOfViolation) && agent) {
          try {
            const before = slide.html;
            slide.html = agent.postProcessHtmlSnapshot(slide.html, {
              primaryColor: finalMainColor,
              slideWidth: slideW,
              slideHeight: slideH,
              backgroundEnabled,
              fontFamily: (fontFamily || design?.fontFamily || 'sans') as 'sans' | 'serif' | 'mono',
              // FR：终局重放把参考标题色接入后处理（与生成期主色/参考色链路同源），
              // 使浅底 heading 的中性色升级为目标参考标题色，深底仍强制白字（enforceHeadingColorOnLightBg）。
              referenceVisualAttributes: generationOptions?.referenceVisualAttributes ?? undefined,
              pageType,
            });
            if (slide.html !== before) finalSanitizeStat.reapplied++;
          } catch (e) {
            console.warn(
              '[FINAL] postProcessHtmlSnapshot 重放失败:',
              e instanceof Error ? e.message : e,
            );
          }
        }
        // 重放后再断言
        let after = slide.html;
        const remain: StyleViolationBreakdown = styleViolationSignal(after, finalMainColor, {
          allowedAccentHexes,
        });
        let remain2: StyleViolationBreakdown = {
          neutralFont22_29: 0,
          neutralPxSticky: 0,
          colorViolations: 0,
          total: 0,
        };
        if (exceedsThreshold(remain) && agent) {
          try {
            after = agent.postProcessHtmlSnapshot(after, {
              primaryColor: finalMainColor,
              slideWidth: slideW,
              slideHeight: slideH,
              backgroundEnabled,
              fontFamily: (fontFamily || design?.fontFamily || 'sans') as 'sans' | 'serif' | 'mono',
              // FR：终局重放把参考标题色接入后处理（与生成期主色/参考色链路同源），
              // 使浅底 heading 的中性色升级为目标参考标题色，深底仍强制白字（enforceHeadingColorOnLightBg）。
              referenceVisualAttributes: generationOptions?.referenceVisualAttributes ?? undefined,
              pageType,
            });
            slide.html = after;
          } catch (_) {
            /* 二次重放异常忽略，保留现状 */
          }
          remain2 = styleViolationSignal(after, finalMainColor, { allowedAccentHexes });
        }

        if (exceedsThreshold(remain2)) {
          // ——— 防御闭环项 3（L6.5 Fallback 降级保护）：高级版式（comparison-deep-dive / cards /
          // timeline / table / value-showcase / stats-highlight / zigzag / image-background…）
          // 禁止用极简 fallback 整页替换，否则原本 5 条对比/卡片/时序信息全部丢失、无法给用户
          // 做人工复核。策略：保留主结构，只在日志中打印更详尽的告警并同样记 sanitizationFailed
          // （audit 依然能拿到 issue 结构化结果，前端也仍能通过 style 引擎做进一步补救）。
          const NEVER_FALLBACK_FOR_ADVANCED: ReadonlySet<string> = new Set([
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
          const explicitLayout = String((slide as any)?.pageType ?? '').toLowerCase() || undefined;
          const layoutFromHtml2 = (after.match(
            /<\s*(?:div|section|article)\b[^>]*\bdata-layout\s*=\s*["']?([a-z0-9-]+)["']?[^>]*>/i,
          ) || [])[1]?.toLowerCase();
          const isProtectedAdvancedLayout =
            (explicitLayout && NEVER_FALLBACK_FOR_ADVANCED.has(explicitLayout)) ||
            (layoutFromHtml2 && NEVER_FALLBACK_FOR_ADVANCED.has(layoutFromHtml2));

          const slidePlanSrc = (plan && (plan as any).slides && (plan as any).slides[i]) as any;
          const fbTitle = String((slide as any)?.title || slidePlanSrc?.title || '');
          const samples2 = collectStyleViolationSamples(after, remain2);
          const detailsForStorage = {
            breakdown: remain2,
            samples: samples2,
            expectedPrimary: finalMainColor,
          };
          // 无论是否替换，都把 sanitizationFailed 条目写入以便审计追溯
          if (!(result as any).sanitizationFailed)
            (result as any).sanitizationFailed = { pages: [] };
          (result as any).sanitizationFailed.pages.push({
            index: i + 1,
            // remain: 保持旧字段兼容（存 breakdown.total 作为数字）
            remain: remain2.total,
            breakdown: remain2,
            samples: samples2,
            fallbackApplied: !isProtectedAdvancedLayout,
            protectedAdvancedSkipped: isProtectedAdvancedLayout,
          } as any);
          finalSanitizeStat.assertionFailed++;

          if (isProtectedAdvancedLayout) {
            // —— 保护版式路径：不替换 slide.html，仅打更详细的告警并记标记（sanitization 生成一个 skipped-advanced 类型 issue）
            (slide as any)._sanitizationFallbackSkippedForAdvanced = {
              index: i + 1,
              title: fbTitle,
              pageType: explicitLayout || layoutFromHtml2 || '',
              remain: remain2.total,
              breakdown: remain2,
              samples: samples2,
              expectedPrimary: finalMainColor,
              fallbackApplied: false,
            };
            console.warn(
              `[FINAL] 第 ${i + 1} 页二次消毒仍超阈值，但检测到其为【高级版式】pageType=${explicitLayout || layoutFromHtml2}，` +
                `为避免丢失结构化内容不执行整页 fallback 替换（${fbTitle.slice(0, 20)}）。` +
                ` breakdown=(${remain2.neutralFont22_29}/${remain2.neutralPxSticky}/${remain2.colorViolations}) ` +
                `total=${remain2.total}。samples=${formatStyleViolationSamplesSummary(finalMainColor, samples2)}。` +
                ` 保留原始 HTML，仅写入 sanitizationFailed.pages[${i}]（fallbackApplied=false, protectedAdvancedSkipped=true）。`,
            );
          } else {
            // —— 普通版式路径：继续应用 FR-4 主色化兜底整页替换
            const fbKeyPoints: string[] = Array.isArray(slidePlanSrc?.keyPoints)
              ? slidePlanSrc.keyPoints.map((k: unknown) => String(k))
              : [];
            slide.html = buildFallbackSlideHtml(
              fbTitle,
              fbKeyPoints,
              slideW,
              slideH,
              finalMainColor,
            );
            // AC-8 / Task10b：在 slide 对象上打标记（_sanitizationFallbackApplied），
            // auditEngine 的 sanitization engine 消费它 → 生成结构化 sanitization-fallback-applied issue 并写入 latest-report。
            // 标记结构刻意与 sanitizationFailed.pages[n] 对齐，便于 audit 端透传 metadata。
            (slide as any)._sanitizationFallbackApplied = {
              index: i + 1,
              title: fbTitle,
              remain: remain2.total,
              breakdown: remain2,
              samples: samples2,
              expectedPrimary: finalMainColor,
              fallbackApplied: true,
            };
            console.error(
              `[FINAL] 第 ${i + 1} 页二次消毒仍超阈值 → 已应用主色化兜底 fallback（${fbTitle.slice(0, 20)}）。` +
                ` breakdown=(${remain2.neutralFont22_29}/${remain2.neutralPxSticky}/${remain2.colorViolations})` +
                ` total=${remain2.total}。samples=${formatStyleViolationSamplesSummary(finalMainColor, samples2)}。` +
                ` 详情已写入 sanitizationFailed.pages[${i}]。`,
            );
          }
        } else if (exceedsThreshold(remain) && !agent) {
          finalSanitizeStat.assertionFailed++;
          const remainSamples = collectStyleViolationSamples(after, remain);
          console.warn(
            `[FINAL] 消毒断言超阈值但无 agent 可二次处理，仅记 warn 不换页：idx=${i + 1} ` +
              `breakdown=(${remain.neutralFont22_29}/${remain.neutralPxSticky}/${remain.colorViolations}) total=${remain.total} ` +
              `samples=${formatStyleViolationSamplesSummary(finalMainColor, remainSamples)} ` +
              `frag=${after.slice(0, 180)}`,
          );
        }
      }
      simpleLog('AI:FINAL', '终局消毒防线（三分量阈值化 v2）', finalSanitizeStat);

      const presentationFile = join(
        this.storage.getPresentationDir(result.id),
        'presentation.json',
      );
      result.updatedAt = Date.now();
      // 防御性校验（无论详细/简单模式都打日志）：终局 <img> 数量，便于以后再次排查「图片消失」类问题
      const slideImgReport = result.slides.map((s, idx) => ({
        idx: idx + 1,
        title: s.title.length > 20 ? s.title.substring(0, 20) + '…' : s.title,
        htmlLen: s.html.length,
        imgCount: (s.html.match(/<img\b/gi) || []).length,
        hasBg: /background-image\s*:/i.test(s.html) ? 1 : 0,
      }));
      simpleLog('AI:SAVE', `终局写盘 presentation.json`, {
        id: result.id,
        presentationIdIn: presentationId || '(new)',
        slides: result.slides.length,
        totalImg: slideImgReport.reduce((n, r) => n + r.imgCount, 0),
        slidesReport: slideImgReport,
      });
      await this.storage.writeJsonFile(presentationFile, result);
    }

    // =============== 自动审核（可选，enableAudit=true 时触发）===============
    // 在终局写盘之后执行：布局自动修复 + 视觉/内容/保真度量化评估 + 报告持久化。
    // 审核失败绝不阻断主流程，仅记录日志。
    // 生效优先级：请求显式传入 enableAudit > 全局 auditSettings.enabled
    // FR-3(e) / FR-7 / AC-5：audit designContext.primaryColor 必须使用单源 finalEffectivePrimary，
    // 禁止使用默认蓝 #2563eb（否则 Content 引擎文案出现"主色 #2563eb 未使用"这种与配置矛盾的 fatal 级 issue，
    // 同时错误分诊导致 regenerateSingleSlide 预算耗尽 fallback）。
    const auditMainColor = finalEffectivePrimary;
    const auditDesignContext = {
      style: style || 'business',
      primaryColor: auditMainColor,
      fontFamily: fontFamily || 'sans',
      iconStyle: iconStyle || 'auto',
    };
    // 原则 P-2 / FR-17.2：从生成请求的参考属性推导 hasReference，让 audit 引擎感知"本演示遵循用户参考意图"，
    // 从而在通用规范类偏差上放宽（不判 fatal），仅在 L0 无障碍底线上否决。
    const referenceContext: ReferenceContext | undefined = (() => {
      const rva = (generationOptions as any)?.referenceVisualAttributes;
      if (!rva) return undefined;
      const cats = rva.byCategory || {};
      const anyUploaded =
        !!rva.global?.uploaded ||
        !!cats.cover?.uploaded ||
        !!cats.content?.uploaded ||
        !!cats.summary?.uploaded;
      if (!anyUploaded) return undefined;
      const source: 'html' | 'image' | 'none' =
        rva.source === 'image-only' ? 'image' : rva.source === 'html-only' ? 'html' : 'html';
      const appliedFields: string[] = [];
      for (const c of ['cover', 'content', 'summary', 'global'] as const) {
        const cr = c === 'global' ? rva.global : cats[c];
        if (cr?.uploaded) appliedFields.push(c);
      }
      return { hasReference: true, source, appliedFields };
    })();
    let auditEnabled = enableAudit;
    let auditAppConfig: any = null;
    if (auditEnabled === undefined) {
      try {
        auditAppConfig = await this.configService.getConfig();
        auditEnabled = auditAppConfig.auditSettings?.enabled ?? false;
      } catch {
        auditEnabled = false;
      }
    }
    if (auditEnabled) {
      try {
        if (!auditAppConfig) {
          auditAppConfig = await this.configService.getConfig();
        }
        const auditSettings = auditAppConfig.auditSettings || {};
        const maxRegenRetries = auditSettings.maxRegenerationRetries ?? 0;

        // ——— 第 1 步：初次审核（全引擎 + 布局自动修复）———
        const auditResult = await this.auditService.auditPresentationFromData(result, result.id, {
          plan,
          designContext: auditDesignContext,
          referenceContext,
        });
        const errorCount = auditResult.issues.filter((i) => i.severity === 'error').length;
        const warnCount = auditResult.issues.filter((i) => i.severity === 'warn').length;
        const fixedCount = auditResult.fixSummary?.fixedCount ?? 0;

        if (auditResult.fixSummary && auditResult.fixSummary.fixedCount > 0) {
          for (let i = 0; i < result.slides.length; i++) {
            result.slides[i].html = sanitizeHtmlServerSide(result.slides[i].html);
          }
          result.updatedAt = Date.now();
          await this.storage.writeJsonFile(
            join(this.storage.getPresentationDir(result.id), 'presentation.json'),
            result,
          );
        }

        // —— 模型档位建议（仅 flash 档 + 审核有 error 时给出，不弹窗）——
        if (
          errorCount > 0 &&
          /flash/i.test(String(contentConfig?.model || '')) &&
          !/plus|max/i.test(String(contentConfig?.model || ''))
        ) {
          (result as any).modelRecommendation = {
            message: '建议将生成模型提升至 plus / max 档以降低重复生成与质量返工',
            model: contentConfig?.model || '',
          };
          simpleLog('AI:MODEL', '模型档位建议', { model: contentConfig?.model });
        }

        // ——— 第 2 步：图片插入后的 VLM 分诊闭环 ———
        // VLM 评审带图幻灯片，根据 rootCause 分诊为 HTML/图片/二者，精准重生成。
        // 最多重试 maxRegenerationRetries 次，触发上限后保留最优版本。
        let imageRegenCount = 0;
        let imageRegenAttempts = 0;
        if (imageProvider && maxRegenRetries > 0 && auditSettings.vlmReview !== false && agent) {
          try {
            const triageResult = await this.runPostImageVlmTriageLoop({
              result,
              plan: plan || (presentation as any).plan,
              design: design || (presentation as any).design,
              agent,
              imageProvider,
              imageOptions: imageConfig?.enabled
                ? {
                    model: imageConfig.model,
                    size: imageConfig.size,
                    quality: imageConfig.quality,
                  }
                : undefined,
              traceSessionId,
              topic,
              maxRetries: maxRegenRetries,
              slideWidth: finalWidth,
              slideHeight: finalHeight,
              generationOptions: generationOptions || {},
              primaryColor: finalEffectivePrimary,
              colorTheme,
            });
            imageRegenCount = triageResult.regeneratedCount;
            imageRegenAttempts = triageResult.attempts;

            // ——— 第 3 步：最终审核（仅在确实重生成了内容时执行，刷新 latest-report.json 反映最终画面）———
            if (imageRegenCount > 0) {
              await this.auditService.auditPresentationFromData(result, result.id, {
                plan,
                designContext: auditDesignContext,
                referenceContext,
              });
            }
          } catch (regenErr) {
            console.warn(
              `${formatBeijingTime()} ${tagAuditProviderError('[AI:AUDIT-IMG] VLM 分诊重生成闭环异常（不影响生成结果）', regenErr)}:`,
              regenErr instanceof Error ? regenErr.message : regenErr,
            );
          }
        }

        simpleLog('AI:AUDIT', '自动审核完成', {
          id: result.id,
          score: auditResult.overallScore,
          result: auditResult.overallResult,
          errors: errorCount,
          warns: warnCount,
          autoFixed: fixedCount,
          imageRegenerated: imageRegenCount,
          imageRegenAttempts,
          regenerationRequired: auditResult.regenerationRequired,
        });
      } catch (auditErr) {
        console.warn(
          `${formatBeijingTime()} ${tagAuditProviderError('[AI:AUDIT] 审核流程异常（不影响生成结果）', auditErr)}:`,
          auditErr instanceof Error ? auditErr.message : auditErr,
        );
      }
    }

    // ——— 文件日志：根据 fileVerbosity 决定详细程度 ———
    // 用本地变量判断（见开头的 logSettingsNormalized），避免并发下全局 runtimeConfig 被别的请求污染
    const fileDetailed = fileDetailedLocal;
    // 无论什么模式，先取出 traces（规划/内容/编辑 3 阶段 + 图片生成 完整 request/response 报文，**零截断**）
    // —— 核心承诺：这里的 traces.messages/prompt/response.content 等与实际发送/收到的内容完全一致，
    //    没有任何 truncate/裁剪，方便对比定位根源。
    // 必须先分别取 llmTraces 和 imageTraces，再 closeTraceSession（关闭后 session 从内存中删除）
    const llmTraces: LLMCallTrace[] = getLLMTraces(traceSessionId);
    const imageTraces: ImageGenerationTrace[] = getImageTraces(traceSessionId);
    closeTraceSession(traceSessionId);
    // 诊断日志：无论什么模式都在控制台打一行，便于以后判断是"fileDetailed=false 没写"还是"traces=[] 空"
    simpleLog('AI:LOG', `写入 ai-log.jsonl 前的诊断`, {
      fileDetailed: String(fileDetailed),
      llmTraces: llmTraces.length,
      // 图片生成相关 traces 数量（便于判断为什么日志里看不到图片报文）
      imageTraces: imageTraces.length,
      logVerbosity: logSettingsNormalized.fileVerbosity,
      reqLogSettings: logSettings ? JSON.stringify(logSettings) : 'absent',
    });
    const routingInfo = {
      planning: `${planningConfig.provider}/${planningConfig.model}`,
      content: `${contentConfig.provider}/${contentConfig.model}`,
      editing: `${editingConfig.provider}/${editingConfig.model}`,
    };
    if (fileDetailed) {
      // =============== 详细模式：完整报文 + 每页最终 HTML 零截断 ===============
      // 写入字段：
      //   1. request.*                —— 全部用户输入参数（含 modelConfigs/imageConfig/referenceHtml 长度等）
      //   2. request.referenceHtml?   —— 完整参考 HTML 原文（用于排查参考文件的影响）
      //   3. request.referenceImage?  —— 完整参考图 base64 原文
      //   4. response.presentation    —— 标题/配色/尺寸/转场/imagePreference 等
      //   5. response.slides          —— 每页完整 title + html + notes + imagePrompt（**不做长度限制**）
      //                                   这是排查"为什么某页是大片空白/裸文本/没有图"的最直接证据
      //   6. response.postProcessing  —— 下载图片数、裸文本修复、孤儿救援、终局防线等统计
      //   7. llmCalls: LLMCallTrace[] —— 3 个阶段的完整请求 messages + 完整响应 content
      //      每条 trace 包含：stage / provider / model / request.messages[] / request.options
      //                      / response.content/usage 或 error.message+stack
      //                      / startedAt / endedAt / durationMs
      await this.logsService.logAICall(result.id, 'generate-presentation', {
        request: {
          presentationIdIn: presentationId || null,
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
          slideWidth,
          slideHeight,
          referenceHtmlLength: referenceHtml?.length || 0,
          referenceHtml, // 完整原文，方便排查参考文件问题
          referenceImageLength: referenceImage?.length || 0,
          referenceImage, // 完整 base64，方便排查参考图问题
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
            editing: {
              provider: editingConfig.provider,
              model: editingConfig.model,
              baseUrl: editingConfig.baseUrl,
            },
          },
          imageConfig: imageConfig
            ? {
                enabled: imageConfig.enabled,
                useDefaultProvider: imageConfig.useDefaultProvider,
                provider: imageConfig.provider,
                model: imageConfig.model,
                size: imageConfig.size,
                gatewayVendor: imageConfig.gatewayVendor,
                allModels: imageConfig.allModels,
                routing: imageConfig.routing,
              }
            : undefined,
        },
        response: {
          presentation: {
            id: result.id,
            title: presentation.title,
            slideCount: presentation.slides.length,
            primaryColor: presentation.primaryColor,
            transition: (presentation as any).transition,
            imagePreference: (presentation as any).imagePreference,
            width: finalWidth,
            height: finalHeight,
            description: presentation.description,
          },
          // 每页最终 HTML 完整原文（终局防线之后、写盘前的快照），无任何截断
          slides: result.slides.map((s, i) => ({
            index: i + 1,
            title: s.title,
            notes: s.notes,
            htmlLength: s.html.length,
            hasImage: /<img\b/i.test(s.html),
            hasBgImage: /background-image/i.test(s.html),
            html: s.html, // ← 关键：完整 HTML 原文
            imagePrompt: (s as any).imagePrompt,
            imageRatio: (s as any).imageRatio,
            pageType: (s as any).pageType,
            elements: (s as any).elements,
          })),
          postProcessing: {
            downloadedImages: downloadedCount,
            bareTextFixedSlides: bareTextFixed,
            orphanRescued,
            finalGuard: { bareTextFixed: finalGuardFixed, orphanRescued: finalGuardRescued },
          },
        },
        // 核心：3 阶段 LLM 调用完整报文（messages/options/response/error 零截断）
        llmCalls: llmTraces.map((t) => ({
          stage: t.stage,
          provider: t.provider,
          model: t.model,
          durationMs: t.durationMs,
          startedAt: new Date(t.startedAt).toISOString(),
          endedAt: new Date(t.endedAt).toISOString(),
          // 以下字段**不做任何截断**，完整复制原文，保证排查时的原始证据
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
        // —— 新增：图片生成完整报文（prompt / options / images / revisedPrompt / error 零截断）——
        // 用于排查：半边图像、颜色错误、大面积纯色空白、prompt_extend 改写失控 等问题
        imageGenerationCalls: imageTraces.map((t) => ({
          stage: t.stage,
          provider: t.provider,
          model: t.model,
          size: t.size,
          scene: t.scene,
          durationMs: t.durationMs,
          startedAt: new Date(t.startedAt).toISOString(),
          endedAt: new Date(t.endedAt).toISOString(),
          // 完整请求（零截断）：prompt 原文 + 所有 options（含 model/size/n/referenceImage）
          request: t.request,
          // 完整响应（零截断）：images[].url / revisedPrompt（这是 prompt_extend 改写后的真实 prompt，对排查颜色/构图错误至关重要）
          response: t.response
            ? {
                images: t.response.images.map((img) => ({
                  url: img.url,
                  revisedPrompt: img.revisedPrompt,
                })),
                // 平台原始响应（如果不是太大），方便对比 images 字段和平台返回的一致性
                rawPreview:
                  t.response.raw && typeof t.response.raw === 'object'
                    ? {
                        request_id: (t.response.raw as any).request_id,
                        code: (t.response.raw as any).code,
                        message: (t.response.raw as any).message,
                        usage: (t.response.raw as any).usage,
                        outputChoicesCount: (t.response.raw as any).output?.choices?.length,
                      }
                    : undefined,
              }
            : undefined,
          error: t.error,
        })),
        imageGenerationCallCount: imageTraces.length,
        model: planningConfig.model,
        provider: planningConfig.provider,
        routing: routingInfo,
      });
    } else {
      // 简单模式：仅记录基础摘要，不记录 messages/response.html 等大字段
      await this.logsService.logAICall(result.id, 'generate-presentation', {
        request: { topic, style, audience, slideCount, density, imagePreference, colorTheme },
        response: {
          presentation: {
            title: presentation.title,
            slideCount: presentation.slides.length,
          },
        },
        llmCallCount: llmTraces.length,
        // 简单模式也保留数量级信息，便于后续判断"有没有触发图片生成"
        imageGenerationCallCount: imageTraces.length,
        model: planningConfig.model,
        provider: planningConfig.provider,
        routing: routingInfo,
      });
    }

    return result;
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

  private collectImageRefs(html: string): {
    imgs: Array<{ fullMatch: string; src: string }>;
    bgImages: Array<{ fullMatch: string; url: string }>;
  } {
    const imgs: Array<{ fullMatch: string; src: string }> = [];
    const imgRegex = /<img[^>]*src\s*=\s*["']([^"']*)["'][^>]*>/gi;
    let m: RegExpExecArray | null;
    while ((m = imgRegex.exec(html)) !== null) {
      const src = m[1]
        .trim()
        .replace(/^`|`$/g, '')
        .trim()
        .replace(/^["']|["']$/g, '')
        .trim();
      if (src) imgs.push({ fullMatch: m[0], src });
    }
    const bgImages: Array<{ fullMatch: string; url: string }> = [];
    const bgRegex = /background-image\s*:\s*[^;]*url\(\s*['"]?([^'")]+)['"]?\s*\)[^;]*;?/gi;
    while ((m = bgRegex.exec(html)) !== null) {
      const url = m[1]
        .trim()
        .replace(/^`|`$/g, '')
        .trim()
        .replace(/^["']|["']$/g, '')
        .trim();
      if (url) bgImages.push({ fullMatch: m[0], url });
    }
    return { imgs, bgImages };
  }

  private isLocalAssetUrl(url: string): boolean {
    if (!url) return false;
    if (url.startsWith('data:')) return false;
    if (url.startsWith('#')) return false;
    if (url.startsWith('http://localhost')) return false;
    if (url.includes('NOPPT_IMAGE_PLACEHOLDER') || url.includes('NOPPT_BG_PLACEHOLDER'))
      return false;
    return url.startsWith('/data/');
  }

  private replaceImageUrlInHtml(html: string, oldUrl: string, newUrl: string): string {
    let out = html;
    const imgRegex = /(<img[^>]*src\s*=\s*["'])([^"']*)(["'][^>]*>)/gi;
    out = out.replace(imgRegex, (match, pre, src, post) => {
      if (src.trim() === oldUrl) return pre + newUrl + post;
      return match;
    });
    const bgRegex = /(background-image\s*:\s*[^;]*url\(\s*['"]?)([^'")]+)(['"]?\s*\)[^;]*;?)/gi;
    out = out.replace(bgRegex, (match, pre, url, post) => {
      if (url.trim() === oldUrl) return pre + newUrl + post;
      return match;
    });
    return out;
  }

  private mapRatioToSize(ratio: string | undefined, fallback: string | undefined): string {
    if (ratio) {
      const r = ratio.replace(/\s+/g, '');
      if (r === '16:9') return '1792x1024';
      if (r === '4:3') return '1024x1024';
      if (r === '21:9') return '1792x1024';
      if (r === '1:1') return '1024x1024';
    }
    return fallback || '1024x1024';
  }

  private extractRatioFromImgTag(fullMatch: string): string | undefined {
    const m = fullMatch.match(/data-image-ratio\s*=\s*["']([^"']+)["']/i);
    return m ? m[1] : undefined;
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
    const {
      agent,
      topic,
      options,
      maxRetries,
      slideWidth,
      slideHeight,
      startIndex = 0,
      referenceHtmlBrief,
    } = params;
    const htmlOnlyOptions = {
      ...options,
      referenceVisualAttributes: params.referenceVisualAttributes,
      referenceHtmlBrief,
      imageProvider: undefined,
    };
    return async (
      slides: RenderedSlide[],
      ctx: { plan: PresentationPlan; design: DesignProposal; traceSessionId?: string },
    ): Promise<RenderedSlide[]> => {
      // —— 内联自检开关：总关 / VLM 占位子关 → 直接跳过 HTML 占位审核闭环 ——
      const critiqueCfg = (options as any)?.critique;
      if (!critiqueCfg || critiqueCfg.enabled === false || critiqueCfg.vlmPlaceholder === false) {
        simpleLog(
          'AI:HTML-AUDIT',
          `因内联自检开关关闭（enabled=${critiqueCfg?.enabled ?? 'undefined'}，vlmPlaceholder=${critiqueCfg?.vlmPlaceholder ?? 'undefined'}），跳过 HTML 占位审核闭环（共 ${slides.length} 页）`,
        );
        return slides;
      }
      const vlmProvider = await this.auditService.getVlmProvider();
      if (!vlmProvider) return slides;
      const previousVlmSession = (vlmProvider as TraceableProvider).activeTraceSessionId;
      if (ctx.traceSessionId) {
        (vlmProvider as TraceableProvider).activeTraceSessionId = ctx.traceSessionId;
      }
      try {
        simpleLog(
          'AI:HTML-AUDIT',
          `开始 HTML 占位符审核闭环（${slides.length} 页，最多重试 ${maxRetries} 次）`,
        );
        return await runHtmlPlaceholderAuditLoop({
          slides,
          vlmProvider,
          slideWidth,
          slideHeight,
          maxRetries,
          onlyAfterLlmPass: true,
          traceSessionId: ctx.traceSessionId,
          onProgress: options.onProgress,
          regenerateSlideFn: async (idx: number, feedback: string) => {
            // AC-6 / Task6：HTML 占位符审计闭环也需 originalHtml 注入，budget 耗尽保留原 HTML
            const originalHtml = slides[idx]?.html || '';
            return agent.regenerateSingleSlide(
              topic,
              ctx.plan,
              ctx.design,
              startIndex + idx,
              htmlOnlyOptions,
              ctx.traceSessionId,
              feedback,
              'placeholder-audit',
              originalHtml,
            );
          },
        });
      } finally {
        (vlmProvider as TraceableProvider).activeTraceSessionId = previousVlmSession;
      }
    };
  }

  /**
   * 步骤 3：图片插入后的 VLM 分诊闭环
   * 对每页带图幻灯片截图 → VLM 评审 → rootCause 分诊 → HTML/图片/二者重生成
   * 触发最大次数后取最优版本。
   */
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
    const {
      result,
      plan,
      design,
      agent,
      imageProvider,
      imageOptions,
      traceSessionId,
      topic,
      maxRetries,
      slideWidth,
      slideHeight,
      generationOptions,
      primaryColor,
      colorTheme,
    } = params;

    // FR-15：从 generationOptions.referenceVisualAttributes 抽取分类参考图 seed 映射，
    // 供循环内图片重生成按 slide pageType 选取 img2img seed。
    const referenceSeedMap:
      Partial<Record<'cover' | 'content' | 'summary' | 'global', string>> | undefined = (() => {
      const rva = (generationOptions as any)?.referenceVisualAttributes;
      if (!rva || !rva.byCategory) return undefined;
      return {
        cover: rva.byCategory.cover?.referenceImageUrl,
        content: rva.byCategory.content?.referenceImageUrl,
        summary: rva.byCategory.summary?.referenceImageUrl,
        global: rva.global?.referenceImageUrl,
      };
    })();

    // —— FR-3 / 单源 primary：复用 5 级优先级 resolveEffectivePrimaryColor 确保与主流程一致 ——
    // 此前 finalEffectivePrimary 仅在 postProcessPresentation 作用域存在，
    // runPostImageVlmTriageLoop 是独立方法，因此此处按同一链再求一次，避免 regenOptions
    // 把 primaryColor 写回为 undefined → 内部 fallback #2563eb → styleViolationSignal 错判主题色。
    // FR-2.x：参考主色也纳入此链（参考 > 用户显式），使 triage 重生成与终局防线使用同一参考色。
    const refDeckPrimaryForTriage = resolveDeckReferencePrimaryColor(
      (generationOptions as any)?.referenceVisualAttributes ?? null,
    );
    const finalEffectivePrimary = resolveEffectivePrimaryColor(
      { primaryColor: refDeckPrimaryForTriage ?? primaryColor, colorTheme },
      {
        primaryColor: (design as any)?.primaryColor,
        colorTheme: (design as any)?.colorTheme,
      },
      '#2563eb',
    );

    if (!imageProvider || typeof imageProvider.generateImage !== 'function') {
      return { regeneratedCount: 0, attempts: 0 };
    }

    const vlmProvider = await this.auditService.getVlmProvider();
    if (!vlmProvider) {
      return { regeneratedCount: 0, attempts: 0 };
    }

    let renderer: InstanceType<typeof SlideRenderer> | null = null;
    try {
      renderer = new SlideRenderer({ width: slideWidth, height: slideHeight });
      await renderer.initialize();
    } catch (e) {
      console.warn(
        '[AI:VLM-LOOP] 渲染器初始化失败，跳过步骤3闭环:',
        e instanceof Error ? e.message : e,
      );
      return { regeneratedCount: 0, attempts: 0 };
    }

    const tmpDir = os.tmpdir();
    const previousProviderSession = (imageProvider as TraceableProvider).activeTraceSessionId;
    (imageProvider as TraceableProvider).activeTraceSessionId = traceSessionId;
    const previousVlmSession = (vlmProvider as TraceableProvider).activeTraceSessionId;
    (vlmProvider as TraceableProvider).activeTraceSessionId = traceSessionId;

    let totalRegenerated = 0;
    let attempt = 0;

    try {
      while (attempt < maxRetries) {
        attempt++;
        simpleLog(
          'AI:AUDIT',
          `[RETRY] stage=audit attempt=${attempt}/${maxRetries} loop=vlm-triage`,
        );
        setSessionStage(traceSessionId, 'post-image-vlm-triage');
        simpleLog('AI:VLM-LOOP', `开始第 ${attempt} 轮终局 VLM 分诊评审`);

        const slidesToCheck: number[] = [];
        for (let i = 0; i < result.slides.length; i++) {
          const s = result.slides[i];
          if ((s as any).hidden) continue;
          const hasImg = /<img\b/i.test(s.html);
          const hasPlaceholder = s.html.includes(IMAGE_PLACEHOLDER);
          if (hasImg || hasPlaceholder) slidesToCheck.push(i);
        }

        if (slidesToCheck.length === 0) break;

        let hadRegeneration = false;

        for (const idx of slidesToCheck) {
          const slide = result.slides[idx];
          const inlinedHtml = this.inlineLocalImagesForScreenshot(slide.html, result.id);
          const shotPath = await this.captureSlideScreenshot(renderer, inlinedHtml, idx, tmpDir);
          if (!shotPath) continue;

          const vlm = await runVlmCritique(vlmProvider, shotPath, idx, slide.title, 'final');
          if (!this.vlmHasBlockingIssue(vlm)) continue;

          const triage = triageSlideIssues(vlm.issues);
          const feedback = this.buildVlmFeedback(vlm);
          simpleLog('AI:VLM-LOOP', `第 ${idx + 1} 页 VLM 评审不通过，分诊结果: ${triage}`, {
            issueCount: vlm.issues.length,
            score: vlm.score,
          });

          const slidePlan = plan?.slides?.[idx];
          const ratio = (slide as any).imageRatio || (slidePlan as any)?.imageRatio || '4:3';
          const targetSize = this.mapRatioToSize(ratio, imageOptions?.size);

          if (triage === 'image') {
            const originalPrompt =
              (slidePlan as any)?.imagePrompt ||
              `${topic} - ${slide.title || ''}，商务级专业插画品质，细腻细节，高完成度画面，整体配色与主题协调`;
            const enhancedPrompt = `${originalPrompt}\n\n【视觉评审反馈，请针对性改进图片本身，避免之前的问题】\n${feedback}`;
            const newUrl = await this.generateAndLocalizeImage({
              imageProvider,
              imagePrompt: enhancedPrompt,
              targetSize,
              presentationId: result.id,
              slideIdx: idx,
              imageOptions,
              referenceImageByCategory: referenceSeedMap,
              referenceCategory: slide.pageType,
            });
            if (newUrl) {
              if (slide.html.includes(IMAGE_PLACEHOLDER)) {
                slide.html = replaceImagePlaceholderWithRealSrc(slide.html, newUrl, ratio as any);
              } else {
                const { imgs } = this.collectImageRefs(slide.html);
                const localImgs = imgs.filter((ref) => this.isLocalAssetUrl(ref.src));
                if (localImgs.length > 0) {
                  slide.html = this.replaceImageUrlInHtml(slide.html, localImgs[0].src, newUrl);
                }
              }
              totalRegenerated++;
              hadRegeneration = true;
            }
          } else if (triage === 'html' || triage === 'both') {
            // 2025-07 P1-B 修复：VLM issue 若全部为「warn 级别」（原 severity ∈ {minor/important} 映射链），
            //   且没有 fatal(error) 级 issue → 不触发整页 HTML regenerate。
            // 原因：「对齐松散 / 图标密度高」这种视觉 minor/warn 类建议一旦交给 regenerateSingleSlide 整页重写，
            //   LLM 会把 metric 数值、H2 标题、进度条比例、badge 文案 全部重做 → 内容漂移 & 样式畸形。
            // 保护策略：
            //   - triage === 'html' 且 非 fatal → 直接跳过 HTML 重写；
            //   - triage === 'both' 且 非 fatal → 允许图片 regenerate，但跳过 HTML。
            // TODO(#R1-followup): 提供 auditSettings.allowMinorHtmlRegen 扩展位，若后续需要强审核模式可显式打开。
            const hasVlmFatal = vlm.issues.some((i) => i.severity === 'error');
            const allNonFatal = vlm.issues.length > 0 && !hasVlmFatal;
            if (allNonFatal && triage === 'html') {
              console.info(
                `[AI:VLM-LOOP] slide ${idx + 1} 全是非 fatal VLM issue（均为 warn/info 级视觉建议），按 P1-B 政策不整页 HTML 重写（避免灾难性劣化）：` +
                  JSON.stringify(vlm.issues.map((i) => `${i.severity}:${i.ruleId || i.message}`)),
              );
              continue;
            }
            if (!plan || !design) {
              console.warn(
                `[AI:VLM-LOOP] 第 ${idx + 1} 页需要 HTML 重生成但缺少 plan/design，跳过`,
              );
              continue;
            }
            try {
              // FR-3(d) / FR-6 / AC-6 / AC-4 调用点改造：
              // - regenOptions.primaryColor / colorTheme 显式写回单源值（finalEffectivePrimary / 入参 colorTheme），
              //   防止展开对象时 undefined 覆盖 → regenerateSingleSlide 内部 fallback 蓝 #2563eb → styleViolationSignal 错判活力橙。
              // - imagePreference 显式保留（FR-6）：即使 imageProvider/imageOptions 被置 undefined，
              //   LLM prompt 仍会按偏好要求 LLM 生成 NOPPT_IMAGE_PLACEHOLDER，便于 Line 2994 检测占位再重图。
              // - 第 9 形参 originalHtml = slide.html（AC-6 / Task6）：budget 超支时 agent 返回原 HTML，不再被替换成 generateFallbackSlide。
              const regenOptions = {
                ...(generationOptions || {}),
                imageProvider: undefined,
                imageOptions: undefined,
                primaryColor: finalEffectivePrimary,
                colorTheme: colorTheme ?? (generationOptions?.colorTheme as ColorTheme | undefined),
                imagePreference:
                  (generationOptions?.imagePreference as ImagePreference | undefined) ??
                  'content-only',
                referenceVisualAttributes:
                  (generationOptions as any)?.referenceVisualAttributes ?? undefined,
              };

              // P1-B triage==='both' && allNonFatal → 跳过 HTML regenerate，仅尝试图片侧生成（若 imageProvider 存在）
              const skipHtmlRegen = allNonFatal && triage === 'both';
              let regenerated: Awaited<ReturnType<HTMLPresentationAgent['regenerateSingleSlide']>> =
                null;
              if (!skipHtmlRegen) {
                const originalHtmlBeforeRegen: string = slide.html;
                regenerated = await agent.regenerateSingleSlide(
                  topic,
                  plan,
                  design,
                  idx,
                  regenOptions,
                  traceSessionId,
                  feedback,
                  'vlm-triage',
                  originalHtmlBeforeRegen,
                );
                if (regenerated) {
                  // FR-6: triage==='html' 且 pageType 为带图类，验证占位符未丢（若丢则写 warn，不阻断）
                  const needImgType =
                    /image/i.test(regenerated.pageType || '') ||
                    /cover/i.test(regenerated.pageType || '');
                  if (
                    triage === 'html' &&
                    needImgType &&
                    !regenerated.html.includes(IMAGE_PLACEHOLDER) &&
                    !/<img\b/i.test(regenerated.html)
                  ) {
                    console.warn(
                      `[AI:VLM-LOOP] 第 ${idx + 1} 页 pageType=${regenerated.pageType} 本应为带图结构，但 regenerated HTML 丢失图片占位符。` +
                        `建议修复 LLM prompt 约束（已保留原始 slide.html 作为备选但本次实际使用 regenerated 版本）。`,
                    );
                  }
                  slide.html = regenerated.html;
                  (slide as any).imagePrompt = regenerated.imagePrompt;
                  (slide as any).imageRatio = regenerated.imageRatio;
                  (slide as any).pageType = regenerated.pageType;
                  totalRegenerated++;
                  hadRegeneration = true;
                }
              } else {
                console.info(
                  `[AI:VLM-LOOP] slide ${idx + 1} triage=both 且全部 issue 非 fatal；按 P1-B 政策保留原 HTML，仅走图片侧（若有图且可生成）。`,
                );
                hadRegeneration = true; // 仍标记为发生过处理（图片侧可能写回）
              }

              if (
                (skipHtmlRegen || (regenerated && regenerated.html.includes(IMAGE_PLACEHOLDER))) &&
                imageProvider?.generateImage
              ) {
                const newRatio = (
                  skipHtmlRegen ? ratio : regenerated?.imageRatio || ratio
                ) as string;
                const newSize = this.mapRatioToSize(newRatio, imageOptions?.size);
                const regenTitle = regenerated?.title || slide.title || '';
                const regenImgPrompt =
                  regenerated?.imagePrompt ||
                  (slidePlan as any)?.imagePrompt ||
                  `${topic} - ${regenTitle}，商务级专业插画品质`;
                const imgPrompt =
                  triage === 'both'
                    ? `${regenImgPrompt}\n\n【视觉评审反馈，请针对性改进图片本身】\n${feedback}`
                    : regenImgPrompt;
                const newUrl = await this.generateAndLocalizeImage({
                  imageProvider,
                  imagePrompt: imgPrompt,
                  targetSize: newSize,
                  presentationId: result.id,
                  slideIdx: idx,
                  imageOptions,
                  referenceImageByCategory: referenceSeedMap,
                  referenceCategory: slide.pageType,
                });
                if (newUrl) {
                  slide.html = replaceImagePlaceholderWithRealSrc(
                    slide.html,
                    newUrl,
                    newRatio as any,
                  );
                }
              }
            } catch (e) {
              console.warn(
                `[AI:VLM-LOOP] 第 ${idx + 1} 页 HTML 重生成失败:`,
                e instanceof Error ? e.message : e,
              );
            }
          }
        }

        if (hadRegeneration) {
          for (let i = 0; i < result.slides.length; i++) {
            result.slides[i].html = sanitizeHtmlServerSide(result.slides[i].html);
          }
          (result as any).updatedAt = Date.now();
          await this.storage.writeJsonFile(
            join(this.storage.getPresentationDir(result.id), 'presentation.json'),
            result,
          );
        } else {
          break;
        }
      }
    } finally {
      (imageProvider as TraceableProvider).activeTraceSessionId = previousProviderSession;
      (vlmProvider as TraceableProvider).activeTraceSessionId = previousVlmSession;
      if (renderer) {
        try {
          await renderer.close();
        } catch {
          /* ignore */
        }
      }
    }

    return { regeneratedCount: totalRegenerated, attempts: attempt };
  }

  /**
   * 审核图片重生成闭环：VLM 视觉评审发现图片问题后，
   * 把 fixSuggestion 拼入原始 prompt 重新生成图片并替换，受 maxRegenerationRetries 控制。
   */
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
    const {
      result,
      plan,
      imageProvider,
      imageConfig,
      traceSessionId,
      topic,
      maxRetries,
      designContext,
    } = params;
    // FR-15：分类参考图 seed 映射，供循环内图片重生成按 slide pageType 选取 img2img seed。
    const referenceSeedMap:
      Partial<Record<'cover' | 'content' | 'summary' | 'global', string>> | undefined = (() => {
      const rva = params.referenceVisualAttributes;
      if (!rva || !rva.byCategory) return undefined;
      return {
        cover: rva.byCategory.cover?.referenceImageUrl,
        content: rva.byCategory.content?.referenceImageUrl,
        summary: rva.byCategory.summary?.referenceImageUrl,
        global: rva.global?.referenceImageUrl,
      };
    })();
    let totalRegenerated = 0;
    let attempt = 0;

    if (!imageProvider || typeof imageProvider.generateImage !== 'function') {
      return { regeneratedCount: 0, attempts: 0 };
    }

    const previousProviderSession = (imageProvider as TraceableProvider).activeTraceSessionId;
    (imageProvider as TraceableProvider).activeTraceSessionId = traceSessionId;

    try {
      while (attempt < maxRetries) {
        attempt++;
        simpleLog(
          'AI:AUDIT',
          `[RETRY] stage=audit attempt=${attempt}/${maxRetries} loop=image-regen`,
        );
        setSessionStage(traceSessionId, 'audit-image-regen');

        const report = await this.auditService.auditPresentationFromData(result, result.id, {
          plan,
          designContext,
          referenceContext: params.referenceContext,
        });

        const visibleSlides = result.slides.filter((s) => !(s as any).hidden);
        const visibleToReal: number[] = [];
        result.slides.forEach((s, realIdx) => {
          if (!(s as any).hidden) visibleToReal.push(realIdx);
        });

        const imageIssues = report.issues.filter(
          (i) =>
            i.engine === 'visual' &&
            (i.severity === 'error' || i.severity === 'warn') &&
            i.metadata?.source === 'vlm' &&
            i.metadata?.imageRelated === true,
        );

        if (imageIssues.length === 0) {
          if (attempt > 1) {
            simpleLog('AI:AUDIT-IMG', `第 ${attempt} 轮审核无图片问题，闭环结束`, {
              id: result.id,
            });
          }
          break;
        }

        const issuesBySlide = new Map<number, string[]>();
        for (const issue of imageIssues) {
          if (issue.slideIndex < 0 || issue.slideIndex >= visibleToReal.length) continue;
          const realIdx = visibleToReal[issue.slideIndex];
          const arr = issuesBySlide.get(realIdx) || [];
          if (issue.fixSuggestion) arr.push(issue.fixSuggestion);
          else if (issue.message) arr.push(issue.message);
          issuesBySlide.set(realIdx, arr);
        }

        if (issuesBySlide.size === 0) break;

        const concurrency = 2;
        let running = 0;
        const queue: Array<() => Promise<void>> = [];
        let slideRegenCount = 0;

        for (const [realIdx, suggestions] of issuesBySlide) {
          queue.push(async () => {
            const slide = result.slides[realIdx];
            const { imgs, bgImages } = this.collectImageRefs(slide.html);
            const localImgs = imgs.filter((ref) => this.isLocalAssetUrl(ref.src));
            const localBg = bgImages.filter((ref) => this.isLocalAssetUrl(ref.url));

            if (localImgs.length === 0 && localBg.length === 0) return;

            const slidePlan = plan?.slides?.[realIdx] as any;
            const originalPrompt =
              slidePlan?.imagePrompt ||
              `${topic} - ${slide.title || ''}，商务级专业插画品质，细腻细节，高完成度画面，整体配色与主题协调`;
            const feedback = suggestions.map((s, i) => `${i + 1}. ${s}`).join('\n');
            const enhancedPrompt = `${originalPrompt}\n\n【视觉评审反馈，请针对性改进，避免之前的问题】\n${feedback}`;

            const tasks: Array<{
              oldUrl: string;
              newUrl: string;
              kind: 'img' | 'bg';
              ratio?: string;
            }> = [];

            for (const ref of localImgs) {
              const ratio = this.extractRatioFromImgTag(ref.fullMatch);
              const size = this.mapRatioToSize(ratio, imageConfig?.size);
              try {
                const images = await imageProvider.generateImage(enhancedPrompt, {
                  size,
                  n: 1,
                  referenceImageByCategory: referenceSeedMap,
                  referenceCategory: slide.pageType,
                });
                if (images && images.length > 0 && images[0].url) {
                  const localPath = await this.storage.saveImageFromUrl(result.id, images[0].url);
                  tasks.push({ oldUrl: ref.src, newUrl: localPath, kind: 'img', ratio });
                  simpleLog('AI:AUDIT-IMG', `第 ${attempt} 轮重生成内容配图`, {
                    id: result.id,
                    slide: realIdx + 1,
                    oldUrl: ref.src,
                    newUrl: localPath,
                    size,
                  });
                }
              } catch (e) {
                console.warn(
                  `[${formatBeijingTime()}] [AI:AUDIT-IMG] 第 ${realIdx + 1} 页内容配图重生成失败:`,
                  e instanceof Error ? e.message : e,
                );
              }
            }

            for (const ref of localBg) {
              try {
                const images = await imageProvider.generateImage(enhancedPrompt, {
                  size: '1792x1024',
                  n: 1,
                  referenceImageByCategory: referenceSeedMap,
                  referenceCategory: slide.pageType,
                });
                if (images && images.length > 0 && images[0].url) {
                  const localPath = await this.storage.saveImageFromUrl(result.id, images[0].url);
                  tasks.push({ oldUrl: ref.url, newUrl: localPath, kind: 'bg' });
                  simpleLog('AI:AUDIT-IMG', `第 ${attempt} 轮重生成背景图`, {
                    id: result.id,
                    slide: realIdx + 1,
                    oldUrl: ref.url,
                    newUrl: localPath,
                  });
                }
              } catch (e) {
                console.warn(
                  `[${formatBeijingTime()}] [AI:AUDIT-IMG] 第 ${realIdx + 1} 页背景图重生成失败:`,
                  e instanceof Error ? e.message : e,
                );
              }
            }

            if (tasks.length > 0) {
              for (const t of tasks) {
                slide.html = this.replaceImageUrlInHtml(slide.html, t.oldUrl, t.newUrl);
              }
              slideRegenCount += tasks.length;
            }
          });
        }

        const runNext = async (): Promise<void> => {
          if (queue.length === 0) return;
          const task = queue.shift()!;
          running++;
          try {
            await task();
          } finally {
            running--;
            if (running < concurrency && queue.length > 0) await runNext();
          }
        };
        const runners: Promise<void>[] = [];
        for (let i = 0; i < Math.min(concurrency, queue.length); i++) runners.push(runNext());
        await Promise.all(runners);

        if (slideRegenCount > 0) {
          totalRegenerated += slideRegenCount;
          for (let i = 0; i < result.slides.length; i++) {
            result.slides[i].html = sanitizeHtmlServerSide(result.slides[i].html);
          }
          (result as any).updatedAt = Date.now();
          await this.storage.writeJsonFile(
            join(this.storage.getPresentationDir(result.id), 'presentation.json'),
            result,
          );
          simpleLog('AI:AUDIT-IMG', `第 ${attempt} 轮完成，重生成 ${slideRegenCount} 张图片`, {
            id: result.id,
            slideCount: issuesBySlide.size,
          });
        } else {
          break;
        }
      }
    } finally {
      (imageProvider as TraceableProvider).activeTraceSessionId = previousProviderSession;
    }

    return { regeneratedCount: totalRegenerated, attempts: attempt };
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
    if (!html || !localImageUrl) return html;
    if (/<img\b/i.test(html)) return html;
    // ——— FR-2 同构（Server 侧 L5.3 + L5.4 共用入口）———
    const PROTECTED_LAYOUT_FOR_INJECT: ReadonlySet<string> = new Set([
      'comparison-deep-dive',
      'content-value-showcase',
      'content-stats-highlight',
      'content-compare',
      'content-timeline',
      'content-table',
      // 以下虽然主要出现在 AI 端 NEVER_UPGRADE_FOR_IMAGE（cards/zigzag/image-background 等），
      // 但为了与 AI 端白名单覆盖面一致，这里一并扩展保护，避免未来 orphan 救援意外 overwrite：
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
    if (!outerOpen) return html;
    const openTag = outerOpen[1];
    const closeIdx = html.lastIndexOf('</div>');
    if (closeIdx < openTag.length) return html;
    const innerRaw = html.substring(openTag.length, closeIdx);
    const h2Match = innerRaw.match(/<h2\b[^>]*>[\s\S]*?<\/h2>/i);
    const h2Part = h2Match ? h2Match[0] : '';
    const afterH2 = h2Match ? innerRaw.substring(h2Match.index! + h2Match[0].length) : innerRaw;

    let contentRaw = afterH2.trim();
    if (contentRaw) {
      contentRaw = this.normalizeBodyLinesToParagraphs(contentRaw);
    }
    if (!contentRaw) return html;

    const imageCol = `<div style="flex:0 0 45%;display:flex;align-items:stretch;min-height:0;min-width:0;overflow:hidden;border-radius:16px;"><img src="${localImageUrl}" data-image-ratio="4:3" style="width:100%;height:100%;object-fit:cover;border-radius:16px;display:block;"></div>`;
    const contentCol = `<div style="flex:0 0 55%;display:flex;flex-direction:column;gap:16px;min-height:0;min-width:0;overflow:hidden;justify-content:space-evenly;">${contentRaw}</div>`;
    const row = `<div style="flex:1;display:flex;gap:40px;align-items:stretch;min-height:0;min-width:0;">${imageCol}${contentCol}</div>`;
    const rebuilt = `${openTag}${h2Part}${row}</div>`;
    if (!rebuilt.includes(localImageUrl)) return html;
    return rebuilt;
  }

  /**
   * 将 h2 后的混合内容规整：把每行裸文本（非空、非纯注释、非已有块级标签包裹）包装成
   * 带样式的 <p> 段落，保证左图右文布局下文字整齐可读。
   */
  private normalizeBodyLinesToParagraphs(raw: string): string {
    if (!raw) return '';
    const cleaned = raw.replace(/<!--[\s\S]*?-->/g, '');
    const BLOCK_TAG_RE = /^\s*<(p|ul|ol|div|h[3-6]|table|blockquote|pre|section|article)\b/i;
    const lines = cleaned.split(/\r?\n/);
    const parts: string[] = [];
    let bufferLines: string[] = [];

    const flushBuffer = () => {
      if (bufferLines.length === 0) return;
      const joined = bufferLines.join(' ').trim();
      if (joined) {
        parts.push(
          `<p style="font-size:24px;color:#374151;margin:0;font-weight:600;line-height:1.5;overflow-wrap:break-word;word-break:break-word;">${joined}</p>`,
        );
      }
      bufferLines = [];
    };

    for (const line of lines) {
      const t = line.trim();
      if (!t) {
        flushBuffer();
        continue;
      }
      if (BLOCK_TAG_RE.test(t)) {
        flushBuffer();
        parts.push(line);
      } else {
        const strippedLine = t.replace(/^<p(\s[^>]*)?>\s*<\/p>$/i, '').trim();
        if (strippedLine) bufferLines.push(strippedLine);
      }
    }
    flushBuffer();

    return parts.join('\n');
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
    const slides = result.slides || [];
    if (slides.length === 0) return 'content-only';
    const hasImg = (h: string) => /<img\b/i.test(h);
    const isStructureLike = (
      idx: number,
      s: { title?: string; pageType?: string; html: string },
    ) => {
      if (s.pageType === 'cover' || s.pageType === 'toc' || s.pageType === 'summary') return true;
      if (idx === 0) return true; // 第一张按封面看
      if (idx === slides.length - 1) return true; // 最后一张按总结看
      return /font-size:\s*[7-9]\dpx|font-size:\s*1\d{2,}px|<h1\b|目录|总结|感谢|开启.*纪元|结论/i.test(
        `${s.title} ${s.html}`,
      );
    };
    const structureIdxs = slides.map((s, i) => isStructureLike(i, s));
    const contentIdxs = structureIdxs.map((x) => !x);
    const contentSlides = slides.filter((_, i) => contentIdxs[i]);
    const first = slides[0];
    const last = slides[slides.length - 1];
    const coverHasImage = hasImg(first.html);
    const summaryHasImage = hasImg(last.html);
    const contentWithImage = contentSlides.filter((s) => hasImg(s.html)).length;
    const contentImageRatio =
      contentSlides.length > 0 ? contentWithImage / contentSlides.length : 0;
    const totalWithImage = slides.filter((s) => hasImg(s.html)).length;
    const totalRatio = totalWithImage / slides.length;
    if (totalRatio === 0) return 'none';
    if (coverHasImage && summaryHasImage && totalRatio >= 0.7) return 'all';
    if (totalRatio < 0.15) return 'minimal';
    return 'content-only';
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

  /**
   * B3S：O(N) 裸文本快速探测。命中（有裸文本）返回 true，否则返回 false。
   * 用于 Server 端 ensureSemanticWrapping 的前置短路：
   *   - 无裸文本时直接 return 原 html（避免全量重建引发 style 属性被反复序列化）
   *   - 有裸文本时才跑完整的栈式包裹逻辑
   */
  private _serverHasBareText(html: string): boolean {
    const TEXT_TAGS = new Set([
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'p',
      'li',
      'figcaption',
      'td',
      'th',
      'label',
      'button',
      'pre',
      'code',
      'blockquote',
      'sup',
      'sub',
      'textarea',
      'option',
      'title',
      'style',
      'script',
      'noscript',
      'span',
      'strong',
      'em',
      'b',
      'i',
      'u',
      'a',
      'br',
      'font',
      'mark',
      'small',
      'del',
      'ins',
      's',
      'q',
      'abbr',
      'time',
    ]);
    const CONTAINER_TAGS = new Set([
      'div',
      'section',
      'article',
      'aside',
      'nav',
      'main',
      'header',
      'footer',
      'body',
      'figure',
      'ul',
      'ol',
      'table',
      'thead',
      'tbody',
      'tfoot',
      'tr',
      'form',
      'details',
      'summary',
      'hgroup',
    ]);
    const SELF_CLOSING = new Set([
      'br',
      'img',
      'hr',
      'input',
      'meta',
      'link',
      'wbr',
      'area',
      'base',
      'col',
      'embed',
      'source',
      'track',
    ]);
    const n = html.length;
    // 维护"当前帧 inTextCtx"栈：每当 push 一个新容器/文本标签就入栈，弹栈时恢复父上下文
    const ctxStack: boolean[] = [false];
    let i = 0;
    while (i < n) {
      const ch = html[i];
      if (ch !== '<') {
        // 当前上下文：栈顶 inTextCtx；false（容器层）+ 非空白 = 裸文本
        if (!ctxStack[ctxStack.length - 1] && !/\s/.test(ch)) return true;
        i++;
        continue;
      }
      if (html.startsWith('<!--', i)) {
        const end = html.indexOf('-->', i);
        i = end === -1 ? n : end + 3;
        continue;
      }
      if (html.startsWith('<![CDATA[', i)) {
        const end = html.indexOf(']]>', i);
        i = end === -1 ? n : end + 3;
        continue;
      }
      if (html.startsWith('<!', i) || html.startsWith('<?', i)) {
        const end = html.indexOf('>', i);
        i = end === -1 ? n : end + 1;
        continue;
      }
      const tagEnd = html.indexOf('>', i);
      if (tagEnd === -1) {
        i++;
        continue;
      }
      const tagFull = html.slice(i, tagEnd + 1);
      const tm = tagFull.match(/^<\/?([a-zA-Z0-9]+)/);
      if (!tm) {
        i = tagEnd + 1;
        continue;
      }
      const tn = tm[1].toLowerCase();
      const closing = tagFull[1] === '/';
      const selfCls = tagFull.endsWith('/>') || SELF_CLOSING.has(tn);
      if (selfCls) {
        // 自闭合标签出现在容器层不算裸文本，是合法内容
        i = tagEnd + 1;
        continue;
      }
      if (!closing) {
        const inTextCtx = TEXT_TAGS.has(tn);
        const isContainer = !inTextCtx && CONTAINER_TAGS.has(tn);
        if (isContainer || inTextCtx) {
          ctxStack.push(inTextCtx);
        } else {
          // 未知标签：视为文本上下文（避免误伤未入表标签）
          ctxStack.push(true);
        }
      } else {
        // 闭合标签：弹栈
        if (ctxStack.length > 1) ctxStack.pop();
      }
      i = tagEnd + 1;
    }
    return false;
  }

  /**
   * ensureSemanticWrapping —— Server 端与 AI 端等价的裸文本终极兜底
   * （基于栈的深度优先扫描，详见 AI 端同名方法注释）
   *
   * B3S 优化：先 O(N) 快速探测是否存在裸文本——不存在则直接返回原字符串，
   * 避免全量重建 HTML（重建过程会重排 style Map → 字符顺序变化、属性重建，
   * 容易引发下游 sanitize 再序列化时的"属性打架"现象）。
   */
  private ensureSemanticWrapping(html: string): string {
    if (!html) return html;
    // B3S：快速无裸文本短路——99% 的 AI 幻灯片无裸文本，直接原样返回，style 属性不动
    if (!this._serverHasBareText(html)) {
      return html;
    }

    const DEFAULT_P_STYLE =
      'font-size:24px;color:#374151;font-weight:600;line-height:2.0;overflow-wrap:break-word;word-break:break-word;';
    const TEXT_TAGS = new Set([
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'p',
      'li',
      'figcaption',
      'td',
      'th',
      'label',
      'button',
      'pre',
      'code',
      'blockquote',
      'sup',
      'sub',
      'textarea',
      'option',
      'title',
      'style',
      'script',
      'noscript',
    ]);
    const CONTAINER_TAGS = new Set([
      'div',
      'section',
      'article',
      'aside',
      'nav',
      'main',
      'header',
      'footer',
      'body',
      'figure',
      'ul',
      'ol',
      'table',
      'thead',
      'tbody',
      'tfoot',
      'tr',
      'form',
      'details',
      'summary',
    ]);

    interface StackFrame {
      tagName: string;
      openTagFull: string;
      inTextContext: boolean;
      pendingBare: string;
      isContainer: boolean;
      innerBuffer: string;
    }
    const stack: StackFrame[] = [
      {
        tagName: '__root__',
        openTagFull: '',
        inTextContext: false,
        pendingBare: '',
        isContainer: false,
        innerBuffer: '',
      },
    ];

    const flushBare = (frame: StackFrame) => {
      if (!frame.pendingBare) return;
      const lines = frame.pendingBare.split(/\r?\n/);
      let generated = '';
      for (const raw of lines) {
        const t = raw.trim();
        if (!t) continue;
        generated += `<p style="margin:0;${DEFAULT_P_STYLE}">${t}</p>`;
      }
      frame.innerBuffer += generated;
      frame.pendingBare = '';
    };

    let i = 0;
    const n = html.length;
    while (i < n) {
      if (html[i] === '<') {
        if (html.startsWith('<!--', i)) {
          const end = html.indexOf('-->', i);
          const j = end === -1 ? n : end + 3;
          const top = stack[stack.length - 1];
          if (top.inTextContext || !top.isContainer) {
            top.innerBuffer += html.slice(i, j);
          } else {
            flushBare(top);
            top.innerBuffer += html.slice(i, j);
          }
          i = j;
          continue;
        }
        if (html.startsWith('<![CDATA[', i)) {
          const end = html.indexOf(']]>', i);
          const j = end === -1 ? n : end + 3;
          stack[stack.length - 1].innerBuffer += html.slice(i, j);
          i = j;
          continue;
        }
        if (html.startsWith('<!', i) || html.startsWith('<?', i)) {
          const end = html.indexOf('>', i);
          const j = end === -1 ? n : end + 1;
          stack[stack.length - 1].innerBuffer += html.slice(i, j);
          i = j;
          continue;
        }
        const tagEnd = html.indexOf('>', i);
        if (tagEnd === -1) {
          const top = stack[stack.length - 1];
          if (top.inTextContext || !top.isContainer) top.innerBuffer += html[i];
          else top.pendingBare += html[i];
          i++;
          continue;
        }
        const tagFull = html.slice(i, tagEnd + 1);
        const tagMatch = tagFull.match(/^<\/?([a-zA-Z0-9]+)/);
        if (!tagMatch) {
          const top = stack[stack.length - 1];
          if (top.inTextContext || !top.isContainer) top.innerBuffer += tagFull;
          else top.pendingBare += tagFull;
          i = tagEnd + 1;
          continue;
        }
        const tagName = tagMatch[1].toLowerCase();
        const isClosing = tagFull[1] === '/';
        const selfClosingSingleton = new Set([
          'br',
          'img',
          'hr',
          'input',
          'meta',
          'link',
          'wbr',
          'area',
          'base',
          'col',
          'embed',
          'source',
          'track',
        ]);
        const isSelfClosing = tagFull.endsWith('/>') || selfClosingSingleton.has(tagName);

        if (isSelfClosing) {
          const top = stack[stack.length - 1];
          if (!top.inTextContext && top.isContainer) flushBare(top);
          top.innerBuffer += tagFull;
          i = tagEnd + 1;
          continue;
        }

        if (!isClosing) {
          const top = stack[stack.length - 1];
          if (!top.inTextContext && top.isContainer) flushBare(top);
          const inTextContext = top.inTextContext || TEXT_TAGS.has(tagName);
          const isContainer = !inTextContext && CONTAINER_TAGS.has(tagName);
          stack.push({
            tagName,
            openTagFull: tagFull,
            inTextContext,
            pendingBare: '',
            isContainer,
            innerBuffer: '',
          });
          i = tagEnd + 1;
          continue;
        } else {
          let popIdx = -1;
          for (let k = stack.length - 1; k >= 1; k--) {
            if (stack[k].tagName === tagName) {
              popIdx = k;
              break;
            }
          }
          if (popIdx === -1) {
            const top = stack[stack.length - 1];
            if (top.inTextContext || !top.isContainer) top.innerBuffer += tagFull;
            else top.pendingBare += tagFull;
            i = tagEnd + 1;
            continue;
          }
          const popped = stack.splice(popIdx)[0];
          if (popped.isContainer) flushBare(popped);
          const closing = `</${popped.tagName}>`;
          const assembled = popped.openTagFull + popped.innerBuffer + closing;
          const newTop = stack[stack.length - 1];
          if (!newTop.inTextContext && newTop.isContainer) flushBare(newTop);
          newTop.innerBuffer += assembled;
          i = tagEnd + 1;
          continue;
        }
      } else {
        const top = stack[stack.length - 1];
        if (top.inTextContext || !top.isContainer) {
          top.innerBuffer += html[i];
        } else {
          top.pendingBare += html[i];
        }
        i++;
      }
    }
    while (stack.length > 1) {
      const popped = stack.pop()!;
      if (popped.isContainer) flushBare(popped);
      const assembled =
        popped.openTagFull +
        popped.innerBuffer +
        (popped.tagName !== '__root__' ? `</${popped.tagName}>` : '');
      stack[stack.length - 1].innerBuffer += assembled;
    }
    if (stack[0].isContainer) flushBare(stack[0]);
    return stack[0].innerBuffer;
  }
}
