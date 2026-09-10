import type { Presentation } from '@noppt/core';
import type { ModelConfig, StageModelConfigs, ModelRoutingConfig, PresentationPlan, DesignProposal, RenderedSlide, CritiqueConfig, LogConfig } from '@noppt/ai';
import { useSettingsStore } from '@/stores/settings';
import { translate } from '@/i18n';

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

// 开发环境直连后端 localhost:3001，绕过 Vite 代理（避免 Windows 下 http-proxy 转发大请求体时报 EACCES）
const API_BASE = import.meta.env.DEV
  ? 'http://localhost:3001/api'
  : '/api';

/** 当前界面语言对应的 Accept-Language 头，使后端返回的错误文案跟随设置页语言。 */
function localeHeaders(): Record<string, string> {
  const locale = useSettingsStore.getState().interfaceSettings.language;
  return { 'Accept-Language': locale };
}

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${url}`, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
      ...localeHeaders(),
    },
    ...options,
  });

  if (!response.ok) {
    throw new Error(`API Error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

export const workspaceApi = {
  get(): Promise<WorkspaceInfo> {
    return request<WorkspaceInfo>('/workspace');
  },
  update(name: string): Promise<WorkspaceInfo> {
    return request<WorkspaceInfo>('/workspace', {
      method: 'PUT',
      body: JSON.stringify({ name }),
    });
  },
};

export const presentationApi = {
  list(): Promise<PresentationListItem[]> {
    return request<PresentationListItem[]>('/presentations');
  },
  get(id: string): Promise<Presentation> {
    return request<Presentation>(`/presentations/${id}`);
  },
  create(data?: { title?: string; width?: number; height?: number }): Promise<Presentation> {
    return request<Presentation>('/presentations', {
      method: 'POST',
      body: JSON.stringify(data || {}),
    });
  },
  save(id: string, presentation: Presentation): Promise<Presentation> {
    return request<Presentation>(`/presentations/${id}`, {
      method: 'PUT',
      body: JSON.stringify(presentation),
    });
  },
  /**
   * 轻量更新元信息（标题、描述），避免发送整个大体积 Presentation 对象
   */
  updateMeta(id: string, meta: { title?: string; description?: string }): Promise<Presentation> {
    return request<Presentation>(`/presentations/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(meta),
    });
  },
  /**
   * 后端内部完成复制：避免前端把大 slides JSON 在 HTTP 上往返
   */
  duplicate(id: string): Promise<Presentation> {
    return request<Presentation>(`/presentations/${id}/duplicate`, {
      method: 'POST',
    });
  },
  remove(id: string): Promise<{ success: boolean }> {
    return request<{ success: boolean }>(`/presentations/${id}`, {
      method: 'DELETE',
    });
  },
  clearAll(): Promise<{ success: boolean; count: number }> {
    return request<{ success: boolean; count: number }>('/presentations', {
      method: 'DELETE',
    });
  },
  getChatHistory(id: string): Promise<ChatMessage[]> {
    return request<ChatMessage[]>(`/presentations/${id}/chat`);
  },
  saveChatHistory(id: string, messages: ChatMessage[]): Promise<{ success: boolean }> {
    return request<{ success: boolean }>(`/presentations/${id}/chat`, {
      method: 'PUT',
      body: JSON.stringify(messages),
    });
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
    return request<Presentation>('/ai/generate', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  planPresentation(data: GeneratePresentationParams): Promise<PresentationPlan> {
    return request<PresentationPlan>('/ai/plan', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  generateFromPlan(data: GeneratePresentationParams & { plan: PresentationPlan }): Promise<Presentation> {
    return request<Presentation>('/ai/generate-from-plan', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  generateDesignProposals(data: GeneratePresentationParams & { plan: PresentationPlan; proposalCount?: number }): Promise<DesignProposal[]> {
    return request<DesignProposal[]>('/ai/design-proposals', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  renderSlides(data: GeneratePresentationParams & { plan: PresentationPlan; design: DesignProposal; startIndex?: number; endIndex?: number }): Promise<RenderedSlide[]> {
    return request<RenderedSlide[]>('/ai/render-slides', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  regenerateSlide(data: GeneratePresentationParams & { plan: PresentationPlan; design: DesignProposal; slideIndex: number }): Promise<RenderedSlide> {
    return request<RenderedSlide>('/ai/regenerate-slide', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  assembleImages(data: GeneratePresentationParams & { plan: PresentationPlan; design: DesignProposal; slides: RenderedSlide[] }): Promise<RenderedSlide[]> {
    return request<RenderedSlide[]>('/ai/assemble-images', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  finalizePresentation(data: GeneratePresentationParams & { plan: PresentationPlan; design: DesignProposal; slides: RenderedSlide[] }): Promise<Presentation> {
    return request<Presentation>('/ai/finalize', {
      method: 'POST',
      body: JSON.stringify(data),
    });
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
    return request<AssetInfo[]>(`/assets/${presentationId}${query}`);
  },
  upload(presentationId: string, type: 'image' | 'video', file: File): Promise<AssetInfo> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('type', type);
    return fetch(`${API_BASE}/assets/${presentationId}/upload`, {
      method: 'POST',
      headers: localeHeaders(),
      body: formData,
    }).then((res) => res.json());
  },
  remove(presentationId: string, type: 'image' | 'video', filename: string): Promise<{ success: boolean }> {
    return request<{ success: boolean }>(`/assets/${presentationId}/${type}/${filename}`, {
      method: 'DELETE',
    });
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

/** 草稿读取失败时抛出的可读错误（区分过期 / 不存在 / 越权）。 */
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
    const response = await fetch(`${API_BASE}/drafts/${encodeURIComponent(draftId)}?${query.toString()}`, {
      headers: localeHeaders(),
    });
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
      const locale = useSettingsStore.getState().interfaceSettings.language;
      throw new DraftFetchError(kind, body?.message || translate(locale, '草稿读取失败'));
    }
    return response.json();
  },
};

export const logsApi = {
  getAILogs(presentationId: string): Promise<AILogEntry[]> {
    return request<AILogEntry[]>(`/logs/ai/${presentationId}`);
  },
};

export interface AppConfig {
  apiConfig: Record<string, { apiKey: string; baseUrl: string; models: string[] }>;
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
    providers: Record<string, {
      apiKey: string;
      baseUrl: string;
      gatewayVendor?: string;
      models: Array<{
        modelName: string;
        sizes: Array<{ width: number; height: number; label?: string }>;
        pixelRanges?: Array<{ minPixels: number; maxPixels: number; label?: string }>;
      }>;
    }>;
  };
}

export const configApi = {
  get(): Promise<AppConfig> {
    return request<AppConfig>('/config');
  },
  save(config: Partial<AppConfig>): Promise<AppConfig> {
    return request<AppConfig>('/config', {
      method: 'PUT',
      body: JSON.stringify(config),
    });
  },
  reset(): Promise<AppConfig> {
    return request<AppConfig>('/config/reset', {
      method: 'POST',
    });
  },
};
