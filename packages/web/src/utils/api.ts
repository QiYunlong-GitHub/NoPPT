import type { Presentation } from '@noppt/core';
import type {
  ModelConfig,
  StageModelConfigs,
  ModelRoutingConfig,
  PresentationPlan,
  DesignProposal,
  RenderedSlide,
  CritiqueConfig,
  LogConfig,
} from '@noppt/ai';
import { storage } from '@/utils/storage';
import { getActiveLocale } from '@/i18n/localeState';
import { translate } from '@/i18n/translate';

export interface PresentationListItem {
  id: string;
  title: string;
  description?: string;
  createdAt: number;
  updatedAt: number;
  thumbnail?: string;
  slideCount: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  scope: 'current' | 'global' | 'selection';
  timestamp?: string;
}

export interface WorkspaceInfo {
  id: string;
  name: string;
  path: string;
  createdAt: number;
  updatedAt: number;
  presentationCount: number;
}

export interface AssetInfo {
  id: string;
  name: string;
  type: 'image' | 'video';
  size: number;
  url: string;
  createdAt: number;
}

export interface AILogEntry {
  id: string;
  timestamp: number;
  type: string;
  request: any;
  response: any;
  model: string;
  provider: string;
  duration?: number;
  error?: string;
}

export interface ApiParser<T> {
  (value: unknown): T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`Invalid ${label} response`);
  return value;
}

function requireString(value: unknown, field: string, label: string): string {
  if (typeof value !== 'string') throw new Error(`Invalid ${label} response: ${field}`);
  return value;
}

function requireFiniteNumber(value: unknown, field: string, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Invalid ${label} response: ${field}`);
  }
  return value;
}

export function parseWorkspaceInfo(value: unknown): WorkspaceInfo {
  const record = requireRecord(value, 'workspace');
  requireString(record.id, 'id', 'workspace');
  requireString(record.name, 'name', 'workspace');
  requireString(record.path, 'path', 'workspace');
  requireFiniteNumber(record.createdAt, 'createdAt', 'workspace');
  requireFiniteNumber(record.updatedAt, 'updatedAt', 'workspace');
  requireFiniteNumber(record.presentationCount, 'presentationCount', 'workspace');
  return value as WorkspaceInfo;
}

export function parsePresentation(value: unknown): Presentation {
  const record = requireRecord(value, 'presentation');
  if (!Array.isArray(record.slides)) throw new Error('Invalid presentation response: slides');
  record.slides.forEach((slide, index) => {
    const item = requireRecord(slide, `presentation slide ${index}`);
    requireString(item.id, 'id', 'presentation slide');
    requireString(item.title, 'title', 'presentation slide');
    requireString(item.html, 'html', 'presentation slide');
  });
  requireString(record.id, 'id', 'presentation');
  requireString(record.title, 'title', 'presentation');
  return value as Presentation;
}

export function parsePresentationList(value: unknown): PresentationListItem[] {
  if (!Array.isArray(value)) throw new Error('Invalid presentation list response');
  value.forEach((item, index) => {
    const record = requireRecord(item, `presentation list item ${index}`);
    requireString(record.id, 'id', 'presentation list item');
    requireString(record.title, 'title', 'presentation list item');
    requireFiniteNumber(record.createdAt, 'createdAt', 'presentation list item');
    requireFiniteNumber(record.updatedAt, 'updatedAt', 'presentation list item');
    requireFiniteNumber(record.slideCount, 'slideCount', 'presentation list item');
  });
  return value as PresentationListItem[];
}

export function parseAsset(value: unknown): AssetInfo {
  const record = requireRecord(value, 'asset');
  requireString(record.id, 'id', 'asset');
  requireString(record.name, 'name', 'asset');
  requireString(record.url, 'url', 'asset');
  if (record.type !== 'image' && record.type !== 'video')
    throw new Error('Invalid asset response: type');
  requireFiniteNumber(record.size, 'size', 'asset');
  requireFiniteNumber(record.createdAt, 'createdAt', 'asset');
  return value as AssetInfo;
}

export function parseAssetList(value: unknown): AssetInfo[] {
  if (!Array.isArray(value)) throw new Error('Invalid asset list response');
  return value.map(parseAsset);
}

export function parseChatMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) throw new Error('Invalid chat response');
  value.forEach((item, index) => {
    const record = requireRecord(item, `chat message ${index}`);
    requireString(record.id, 'id', 'chat message');
    requireString(record.content, 'content', 'chat message');
    if (!['user', 'assistant', 'system'].includes(String(record.role))) {
      throw new Error('Invalid chat message response: role');
    }
    if (!['current', 'global', 'selection'].includes(String(record.scope))) {
      throw new Error('Invalid chat message response: scope');
    }
  });
  return value as ChatMessage[];
}

export function parseSuccessResponse<T extends { success: boolean }>(value: unknown): T {
  const record = requireRecord(value, 'success');
  if (typeof record.success !== 'boolean') throw new Error('Invalid success response');
  return value as T;
}

// 开发环境直连后端 localhost:3001，绕过 Vite 代理（避免 Windows 下 http-proxy 转发大请求体时报 EACCES）
const API_BASE = import.meta.env.DEV ? 'http://localhost:3001/api' : '/api';

/** 当前界面语言对应的 Accept-Language 头，使后端返回的错误文案跟随设置页语言。 */
function localeHeaders(): Record<string, string> {
  const locale = getActiveLocale();
  return { 'Accept-Language': locale };
}

/** Build normal REST headers without changing caller-provided values. */
export function buildApiHeaders(
  callerHeaders?: HeadersInit,
  includeJsonContentType = true,
): Headers {
  const headers = new Headers(callerHeaders);
  if (includeJsonContentType && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (!headers.has('Accept-Language')) {
    headers.set('Accept-Language', localeHeaders()['Accept-Language']);
  }
  const configuredApiKey = import.meta.env.VITE_NOPPT_API_KEY?.trim();
  if (configuredApiKey && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${configuredApiKey}`);
  }
  return headers;
}

async function request<T>(
  url: string,
  options: RequestInit = {},
  parser?: ApiParser<T>,
): Promise<T> {
  const response = await fetch(`${API_BASE}${url}`, {
    ...options,
    headers: buildApiHeaders(options.headers),
  });

  if (!response.ok) {
    throw new Error(`API Error: ${response.status} ${response.statusText}`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error('Invalid API JSON response');
  }
  return parser ? parser(payload) : (payload as T);
}

export const workspaceApi = {
  get(): Promise<WorkspaceInfo> {
    return request<WorkspaceInfo>('/workspace', {}, parseWorkspaceInfo);
  },
  update(name: string): Promise<WorkspaceInfo> {
    return request<WorkspaceInfo>(
      '/workspace',
      {
        method: 'PUT',
        body: JSON.stringify({ name }),
      },
      parseWorkspaceInfo,
    );
  },
};

export const presentationApi = {
  list(): Promise<PresentationListItem[]> {
    return request<PresentationListItem[]>('/presentations', {}, parsePresentationList);
  },
  get(id: string): Promise<Presentation> {
    return request<Presentation>(`/presentations/${id}`, {}, parsePresentation);
  },
  create(data?: { title?: string; width?: number; height?: number }): Promise<Presentation> {
    return request<Presentation>(
      '/presentations',
      {
        method: 'POST',
        body: JSON.stringify(data || {}),
      },
      parsePresentation,
    );
  },
  save(id: string, presentation: Presentation): Promise<Presentation> {
    return request<Presentation>(
      `/presentations/${id}`,
      {
        method: 'PUT',
        body: JSON.stringify(presentation),
      },
      parsePresentation,
    );
  },
  /**
   * 轻量更新元信息（标题、描述），避免发送整个大体积 Presentation 对象
   */
  updateMeta(id: string, meta: { title?: string; description?: string }): Promise<Presentation> {
    return request<Presentation>(
      `/presentations/${id}`,
      {
        method: 'PATCH',
        body: JSON.stringify(meta),
      },
      parsePresentation,
    );
  },
  /**
   * 后端内部完成复制：避免前端把大 slides JSON 在 HTTP 上往返
   */
  duplicate(id: string): Promise<Presentation> {
    return request<Presentation>(
      `/presentations/${id}/duplicate`,
      {
        method: 'POST',
      },
      parsePresentation,
    );
  },
  remove(id: string): Promise<{ success: boolean }> {
    return request<{ success: boolean }>(
      `/presentations/${id}`,
      {
        method: 'DELETE',
      },
      parseSuccessResponse,
    );
  },
  clearAll(): Promise<{ success: boolean; count: number }> {
    return request<{ success: boolean; count: number }>(
      '/presentations',
      {
        method: 'DELETE',
      },
      parseSuccessResponse,
    );
  },
  getChatHistory(id: string): Promise<ChatMessage[]> {
    return request<ChatMessage[]>(`/presentations/${id}/chat`, {}, parseChatMessages);
  },
  saveChatHistory(id: string, messages: ChatMessage[]): Promise<{ success: boolean }> {
    return request<{ success: boolean }>(
      `/presentations/${id}/chat`,
      {
        method: 'PUT',
        body: JSON.stringify(messages),
      },
      parseSuccessResponse,
    );
  },
};

export interface GeneratePresentationParams {
  topic: string;
  modelConfig?: ModelConfig;
  modelConfigs?: StageModelConfigs;
  imageConfig?: {
    enabled: boolean;
    useDefaultProvider: boolean;
    provider?: string;
    model?: string;
    size?: string;
    quality?: string;
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
    modelConfig?: Omit<ModelConfig, 'provider'> & { provider?: string };
  };
  style?: string;
  audience?: string;
  slideCount?: number;
  slideCountMin?: number;
  slideCountMax?: number;
  density?: 'compact' | 'normal' | 'spacious';
  imagePreference?: 'all' | 'content-only' | 'minimal' | 'none';
  colorTheme?: 'blue' | 'purple' | 'green' | 'orange' | 'teal' | 'gray';
  backgroundEnabled?: boolean;
  iconStyle?: string;
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
   * RAG 文本素材 / 对话上下文整理的「权威素材」。
   * 由后端在 planning 阶段以「权威素材」段注入大纲 prompt（见 ai.service.ts）。
   * 来源：Hermes 通过 `noppt_prepare_outline_draft` 存的生成草稿，或用户在配置页手工填写。
   */
  referenceText?: string;
  presentationId?: string;
  traceSessionId?: string;
  slideWidth?: number;
  slideHeight?: number;
  logSettings?: {
    consoleVerbosity: 'detailed' | 'simple';
    fileVerbosity: 'detailed' | 'simple';
  };
  critique?: CritiqueConfig;
  enableAudit?: boolean;
  /** 生成语言：'follow'（跟随界面语言）在调用方已解析为 'zh-CN' | 'en' 后透传。 */
  language?: 'zh-CN' | 'en';
}

export const aiApi = {
  generatePresentation(data: GeneratePresentationParams): Promise<Presentation> {
    return request<Presentation>(
      '/ai/generate',
      {
        method: 'POST',
        body: JSON.stringify(data),
      },
      parsePresentation,
    );
  },

  planPresentation(data: GeneratePresentationParams): Promise<PresentationPlan> {
    return request<PresentationPlan>('/ai/plan', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  generateFromPlan(
    data: GeneratePresentationParams & { plan: PresentationPlan },
  ): Promise<Presentation> {
    return request<Presentation>(
      '/ai/generate-from-plan',
      {
        method: 'POST',
        body: JSON.stringify(data),
      },
      parsePresentation,
    );
  },

  generateDesignProposals(
    data: GeneratePresentationParams & { plan: PresentationPlan; proposalCount?: number },
  ): Promise<DesignProposal[]> {
    return request<DesignProposal[]>('/ai/design-proposals', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  renderSlides(
    data: GeneratePresentationParams & {
      plan: PresentationPlan;
      design: DesignProposal;
      startIndex?: number;
      endIndex?: number;
    },
  ): Promise<RenderedSlide[]> {
    return request<RenderedSlide[]>('/ai/render-slides', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  regenerateSlide(
    data: GeneratePresentationParams & {
      plan: PresentationPlan;
      design: DesignProposal;
      slideIndex: number;
    },
  ): Promise<RenderedSlide> {
    return request<RenderedSlide>('/ai/regenerate-slide', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  assembleImages(
    data: GeneratePresentationParams & {
      plan: PresentationPlan;
      design: DesignProposal;
      slides: RenderedSlide[];
    },
  ): Promise<RenderedSlide[]> {
    return request<RenderedSlide[]>('/ai/assemble-images', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  finalizePresentation(
    data: GeneratePresentationParams & {
      plan: PresentationPlan;
      design: DesignProposal;
      slides: RenderedSlide[];
    },
  ): Promise<Presentation> {
    return request<Presentation>(
      '/ai/finalize',
      {
        method: 'POST',
        body: JSON.stringify(data),
      },
      parsePresentation,
    );
  },

  editSlide(data: {
    modelConfigs?: StageModelConfigs;
    presentationId?: string;
    currentHtml: string;
    userRequest: string;
    primaryColor?: string;
    logSettings?: LogConfig;
  }): Promise<{ html: string }> {
    return request<{ html: string }>('/ai/edit-slide', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  editElement(data: {
    modelConfigs?: StageModelConfigs;
    presentationId?: string;
    elementHtml: string;
    userRequest: string;
    logSettings?: LogConfig;
  }): Promise<{ html: string }> {
    return request<{ html: string }>('/ai/edit-element', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  editGlobal(data: {
    modelConfigs?: StageModelConfigs;
    presentationId?: string;
    presentation: {
      title: string;
      description?: string;
      primaryColor?: string;
      transition?: string;
      slides: Array<{ title: string; html: string; notes?: string }>;
    };
    currentSlideIndex: number;
    userRequest: string;
    logSettings?: LogConfig;
  }): Promise<{
    title: string;
    description?: string;
    primaryColor?: string;
    transition?: string;
    slides: Array<{ title: string; html: string; notes?: string }>;
  }> {
    return request('/ai/edit-global', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
};

export const assetsApi = {
  list(presentationId: string, type?: 'image' | 'video'): Promise<AssetInfo[]> {
    const query = type ? `?type=${type}` : '';
    return request<AssetInfo[]>(`/assets/${presentationId}${query}`, {}, parseAssetList);
  },
  upload(presentationId: string, type: 'image' | 'video', file: File): Promise<AssetInfo> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('type', type);
    return fetch(`${API_BASE}/assets/${presentationId}/upload`, {
      method: 'POST',
      headers: buildApiHeaders(undefined, false),
      body: formData,
    }).then(async (res) => {
      if (!res.ok) throw new Error(`API Error: ${res.status} ${res.statusText}`);
      let payload: unknown;
      try {
        payload = await res.json();
      } catch {
        throw new Error('Invalid API JSON response');
      }
      return parseAsset(payload);
    });
  },
  remove(
    presentationId: string,
    type: 'image' | 'video',
    filename: string,
  ): Promise<{ success: boolean }> {
    return request<{ success: boolean }>(
      `/assets/${presentationId}/${type}/${filename}`,
      {
        method: 'DELETE',
      },
      parseSuccessResponse,
    );
  },
};

/**
 * 生成草稿预填视图（后端 `DraftPrefillView` 的前端镜像）。
 * 由 Hermes 的 `noppt_prepare_outline_draft` 写入，Web 端凭签名 token 读取。
 */
export interface DraftPrefill {
  draftId: string;
  topic: string;
  referenceText?: string;
  /** 素材来源标识，如「企业知识库 / RAG」「飞书对话上下文」 */
  referenceSource?: string;
  /** 素材长度上限（后端按页数分档计算） */
  referenceLimit: number;
  referenceTruncated: boolean;
  referenceOriginalChars: number;
  style?: string;
  audience?: string;
  slideCount?: number;
  colorTheme?: string;
  fontFamily?: string;
  iconStyle?: string;
  mode: 'auto' | 'guided';
  expiresAt: number;
}

export function parseDraftPrefill(value: unknown): DraftPrefill {
  const record = requireRecord(value, 'draft');
  requireString(record.draftId, 'draftId', 'draft');
  requireString(record.topic, 'topic', 'draft');
  requireFiniteNumber(record.referenceLimit, 'referenceLimit', 'draft');
  if (typeof record.referenceTruncated !== 'boolean')
    throw new Error('Invalid draft response: referenceTruncated');
  requireFiniteNumber(record.referenceOriginalChars, 'referenceOriginalChars', 'draft');
  if (record.mode !== 'auto' && record.mode !== 'guided')
    throw new Error('Invalid draft response: mode');
  requireFiniteNumber(record.expiresAt, 'expiresAt', 'draft');
  return value as DraftPrefill;
}

export class DraftFetchError extends Error {
  public readonly kind: 'expired' | 'not_found' | 'forbidden' | 'unknown';
  constructor(kind: DraftFetchError['kind'], message: string) {
    super(message);
    this.name = 'DraftFetchError';
    this.kind = kind;
  }
}

export const draftApi = {
  /** 拉取草稿预填参数：`GET /api/drafts/:id?tenant&user&token`。 */
  async get(draftId: string, tenant: string, user: string, token: string): Promise<DraftPrefill> {
    const query = new URLSearchParams({ tenant, user, token });
    const response = await fetch(
      `${API_BASE}/drafts/${encodeURIComponent(draftId)}?${query.toString()}`,
      {
        headers: localeHeaders(),
      },
    );
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const kind =
        body?.error === 'draft_expired'
          ? 'expired'
          : body?.error === 'draft_not_found'
            ? 'not_found'
            : body?.error === 'forbidden_scope' || body?.error === 'forbidden'
              ? 'forbidden'
              : 'unknown';
      const locale = getActiveLocale();
      throw new DraftFetchError(kind, body?.message || translate(locale, '草稿读取失败'));
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new DraftFetchError('unknown', translate(getActiveLocale(), '草稿读取失败'));
    }
    return parseDraftPrefill(payload);
  },
};

export const logsApi = {
  getAILogs(presentationId: string): Promise<AILogEntry[]> {
    return request<AILogEntry[]>(`/logs/ai/${presentationId}`);
  },
};

export interface AppConfig {
  apiConfig: Record<
    string,
    { apiKey?: string; userCode?: string; baseUrl: string; models: string[] }
  >;
  defaultModelProvider: string;
  modelRouting: ModelRoutingConfig;
  interfaceSettings: {
    theme: 'light' | 'dark' | 'auto';
    language: 'zh-CN' | 'en';
    defaultZoom: number;
    showGrid: boolean;
    snapToGrid: boolean;
    gridSize: number;
  };
  exportSettings: {
    defaultFormat: 'html' | 'pdf' | 'png';
    pdfQuality: 'low' | 'medium' | 'high';
    pngScale: number;
    includeSpeakerNotes: boolean;
  };
  editorSettings: {
    autoSave: boolean;
    autoSaveInterval: number;
    undoHistoryLimit: number;
    defaultSlideWidth: number;
    defaultSlideHeight: number;
  };
  logSettings: {
    consoleVerbosity: 'detailed' | 'simple';
    fileVerbosity: 'detailed' | 'simple';
  };
  imageGeneration: {
    enabled: boolean;
    useDefaultApiKey: boolean;
    activeProvider: string;
    providers: Record<
      string,
      {
        apiKey?: string;
        baseUrl: string;
        gatewayVendor?: string;
        models: Array<{
          modelName: string;
          sizes: Array<{ width: number; height: number; label?: string }>;
          pixelRanges?: Array<{ minPixels: number; maxPixels: number; label?: string }>;
        }>;
      }
    >;
  };
}

export function parsePublicConfig<T extends Partial<AppConfig>>(value: unknown): T {
  return requireRecord(value, 'config') as T;
}

export const parseConfig: ApiParser<AppConfig> = (value) => parsePublicConfig<AppConfig>(value);

export const configApi = {
  get(): Promise<AppConfig> {
    return request<AppConfig>('/config', {}, parseConfig);
  },
  save(config: Partial<AppConfig>): Promise<AppConfig> {
    return request<AppConfig>(
      '/config',
      {
        method: 'PUT',
        body: JSON.stringify(config),
      },
      parseConfig,
    );
  },
  reset(): Promise<AppConfig> {
    return request<AppConfig>(
      '/config/reset',
      {
        method: 'POST',
      },
      parseConfig,
    );
  },
};
