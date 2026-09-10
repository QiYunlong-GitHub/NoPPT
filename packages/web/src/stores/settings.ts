import { create } from 'zustand';
import type {
  ModelConfig,
  RouteStage,
  ModelRef,
  ModelRoutingConfig,
  StageModelConfigs,
  ImageModelRoutingConfig,
} from '@noppt/ai';
import { storage } from '@/utils/storage';
import { configApi } from '@/utils/api';
import { t } from '@/i18n';

export type ModelProvider = 'openai' | 'anthropic' | 'ollama' | 'freeai' | 'v0' | 'company-gateway';

export type ImageProvider =
  'openai' | 'qwen' | 'seedream' | 'freeai' | 'ollama' | 'company-gateway';

export type ImageGatewayVendor = 'openai' | 'qwen' | 'seedream';

export interface ImageSize {
  width: number;
  height: number;
  label?: string;
}

export interface PixelRange {
  minPixels: number;
  maxPixels: number;
  label?: string;
}

export interface ImageModelConfig {
  modelName: string;
  sizes: ImageSize[];
  pixelRanges?: PixelRange[];
}

interface ApiProviderConfig {
  apiKey: string;
  baseUrl: string;
  models: string[];
}

export interface ImageProviderConfig {
  apiKey: string;
  baseUrl: string;
  models: ImageModelConfig[];
  gatewayVendor?: ImageGatewayVendor;
}

interface ImageRoutingProviderConfig {
  enabled: boolean;
  coverModelIndex?: number;
  contentModelIndex?: number;
  secondaryModelIndex?: number;
}

// 旧配置迁移使用的辅助类型
interface OldImageProviderConfig extends ImageProviderConfig {
  enabled?: boolean;
}

interface InterfaceSettings {
  theme: 'light' | 'dark' | 'auto';
  language: 'zh-CN' | 'en';
  defaultZoom: number;
  showGrid: boolean;
  snapToGrid: boolean;
  gridSize: number;
}

interface ExportSettings {
  defaultFormat: 'html' | 'pdf' | 'png';
  pdfQuality: 'low' | 'medium' | 'high';
  pngScale: number;
  includeSpeakerNotes: boolean;
}

interface EditorSettings {
  autoSave: boolean;
  autoSaveInterval: number;
  undoHistoryLimit: number;
  defaultSlideWidth: number;
  defaultSlideHeight: number;
}

export type LogVerbosity = 'detailed' | 'simple';

export interface LogSettings {
  consoleVerbosity: LogVerbosity;
  fileVerbosity: LogVerbosity;
}

interface ImageGenerationSettings {
  enabled: boolean;
  useDefaultApiKey: boolean;
  activeProvider: ImageProvider;
  providers: Record<ImageProvider, ImageProviderConfig>;
  routing: Record<ImageProvider, ImageRoutingProviderConfig>;
}

export type AuditStrictness = 'strict' | 'normal' | 'relaxed';

export interface AuditSettings {
  enabled: boolean;
  strictness: AuditStrictness;
  autoFix: boolean;
  maxRegenerationRetries: number;
  llmReview: boolean;
  vlmReview: boolean;
  engines: {
    layout: boolean;
    visual: boolean;
    content: boolean;
    fidelity: boolean;
  };
  thresholds: {
    pass: number;
    warn: number;
  };
}

export interface InlineSelfCheckSettings {
  enabled: boolean;
  llmCritique: boolean;
  vlmPlaceholder: boolean;
  maxRetries: number;
  threshold: number;
}

type ConfigSource = 'file' | 'local' | 'default';

interface SettingsState {
  apiConfig: Record<ModelProvider, ApiProviderConfig>;
  defaultModelProvider: ModelProvider;
  modelRouting: ModelRoutingConfig;
  interfaceSettings: InterfaceSettings;
  exportSettings: ExportSettings;
  editorSettings: EditorSettings;
  logSettings: LogSettings;
  imageGeneration: ImageGenerationSettings;
  auditSettings: AuditSettings;
  inlineSelfCheckSettings: InlineSelfCheckSettings;
  configSource: ConfigSource;

  loadSettings: () => Promise<void>;
  saveSettings: () => Promise<void>;
  resetSettings: () => Promise<void>;
  updateOpenAIConfig: (config: Partial<ApiProviderConfig>) => void;
  updateAnthropicConfig: (config: Partial<ApiProviderConfig>) => void;
  updateOllamaConfig: (config: Partial<ApiProviderConfig>) => void;
  updateFreeAIConfig: (config: Partial<ApiProviderConfig>) => void;
  updateV0Config: (config: Partial<ApiProviderConfig>) => void;
  updateCompanyGatewayConfig: (config: Partial<ApiProviderConfig>) => void;
  setDefaultProvider: (provider: ModelProvider) => void;
  updateModelRouting: (routing: Partial<ModelRoutingConfig>) => void;
  updateInterfaceSettings: (settings: Partial<InterfaceSettings>) => void;
  updateExportSettings: (settings: Partial<ExportSettings>) => void;
  updateEditorSettings: (settings: Partial<EditorSettings>) => void;
  updateLogSettings: (settings: Partial<LogSettings>) => void;
  updateImageGeneration: (config: Partial<ImageGenerationSettings>) => void;
  updateAuditSettings: (config: Partial<AuditSettings>) => void;
  updateInlineSelfCheckSettings: (config: Partial<InlineSelfCheckSettings>) => void;
  updateImageProviderConfig: (
    provider: ImageProvider,
    config: Partial<ImageProviderConfig>,
  ) => void;
  setImageRoutingConfig: (
    provider: ImageProvider,
    config: Partial<ImageRoutingProviderConfig>,
  ) => void;
  getModelConfig: () => ModelConfig;
  getModelConfigsForStages: () => StageModelConfigs;
  getImageGenerationConfig: () => {
    provider: ImageProvider;
    apiKey: string;
    baseUrl: string;
    model: string;
    size: string;
    useDefaultApiKey: boolean;
    gatewayVendor?: ImageGatewayVendor;
    allModels: Array<{
      modelName: string;
      sizes: ImageSize[];
      pixelRanges?: PixelRange[];
    }>;
    routing: ImageRoutingProviderConfig;
  };
  hasApiKey: () => boolean;
  getProviderLabel: (provider?: ModelProvider) => string;
}

const STORAGE_KEY = 'noppt-settings';

const defaultImageProviders: Record<ImageProvider, ImageProviderConfig> = {
  openai: {
    apiKey: '',
    baseUrl: 'https://api.openai.com/v1',
    models: [
      {
        modelName: 'dall-e-3',
        sizes: [
          { width: 1792, height: 1024, label: '1792×1024 (横屏)' },
          { width: 1024, height: 1792, label: '1024×1792 (竖屏)' },
          { width: 1024, height: 1024, label: '1024×1024 (方形)' },
        ],
      },
      {
        modelName: 'dall-e-2',
        sizes: [
          { width: 1024, height: 1024, label: '1024×1024' },
          { width: 512, height: 512, label: '512×512' },
          { width: 256, height: 256, label: '256×256' },
        ],
      },
    ],
  },
  qwen: {
    apiKey: '',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: [
      {
        modelName: 'qwen-image-2.0-pro',
        sizes: [
          { width: 2048, height: 2048, label: '2048×2048 (1:1 方形)' },
          { width: 2688, height: 1536, label: '2688×1536 (16:9 宽屏)' },
          { width: 1536, height: 2688, label: '1536×2688 (9:16 竖长)' },
          { width: 2368, height: 1728, label: '2368×1728 (4:3 横版)' },
          { width: 1728, height: 2368, label: '1728×2368 (3:4 竖版)' },
        ],
        pixelRanges: [
          { minPixels: 512 * 512, maxPixels: 2048 * 2048, label: '标准 (0.26MP-4.2MP)' },
        ],
      },
      {
        modelName: 'qwen-image-max',
        sizes: [
          { width: 1664, height: 928, label: '1664×928 (16:9 宽屏)' },
          { width: 1472, height: 1104, label: '1472×1104 (4:3 横版)' },
          { width: 1328, height: 1328, label: '1328×1328 (1:1 方形)' },
          { width: 1104, height: 1472, label: '1104×1472 (3:4 竖版)' },
          { width: 928, height: 1664, label: '928×1664 (9:16 竖长)' },
        ],
      },
      {
        modelName: 'qwen-image-plus',
        sizes: [
          { width: 1664, height: 928, label: '1664×928 (16:9 宽屏)' },
          { width: 1472, height: 1104, label: '1472×1104 (4:3 横版)' },
          { width: 1328, height: 1328, label: '1328×1328 (1:1 方形)' },
          { width: 1104, height: 1472, label: '1104×1472 (3:4 竖版)' },
          { width: 928, height: 1664, label: '928×1664 (9:16 竖长)' },
        ],
      },
      {
        modelName: 'wanx2.1-t2i-turbo',
        sizes: [{ width: 1024, height: 1024, label: '1024×1024' }],
      },
    ],
  },
  seedream: {
    apiKey: '',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    models: [
      {
        modelName: 'doubao-seedream-5.0-lite',
        sizes: [
          { width: 2048, height: 2048, label: '2048×2048 (1:1 方形)' },
          { width: 2848, height: 1600, label: '2848×1600 (16:9 宽屏)' },
          { width: 2304, height: 1728, label: '2304×1728 (4:3 横版)' },
          { width: 2496, height: 1664, label: '2496×1664 (3:2 中幅)' },
          { width: 3136, height: 1344, label: '3136×1344 (21:9 超宽)' },
          { width: 1728, height: 2304, label: '1728×2304 (3:4 竖版)' },
          { width: 1664, height: 2496, label: '1664×2496 (2:3 竖中幅)' },
          { width: 1600, height: 2848, label: '1600×2848 (9:16 竖长)' },
        ],
        pixelRanges: [{ minPixels: 3686400, maxPixels: 16777216, label: '标准 (3.5MP-16MP)' }],
      },
    ],
  },
  freeai: {
    apiKey: '',
    baseUrl: 'https://api.free.ai/v1',
    models: [
      {
        modelName: 'flux-dev',
        sizes: [{ width: 1024, height: 1024, label: '1024×1024' }],
      },
    ],
  },
  ollama: {
    apiKey: '',
    baseUrl: 'http://localhost:11434/v1',
    models: [
      {
        modelName: 'flux-dev',
        sizes: [{ width: 1024, height: 1024, label: '1024×1024' }],
      },
    ],
  },
  'company-gateway': {
    apiKey: '',
    baseUrl: 'https://your-company-gateway.example.com/ai-api',
    gatewayVendor: 'seedream',
    models: [
      {
        modelName: 'doubao-seedream-5.0-lite',
        sizes: [
          { width: 2048, height: 2048, label: '2048×2048 (1:1 方形)' },
          { width: 2848, height: 1600, label: '2848×1600 (16:9 宽屏)' },
          { width: 2304, height: 1728, label: '2304×1728 (4:3 横版)' },
          { width: 2496, height: 1664, label: '2496×1664 (3:2 中幅)' },
          { width: 3136, height: 1344, label: '3136×1344 (21:9 超宽)' },
          { width: 1728, height: 2304, label: '1728×2304 (3:4 竖版)' },
          { width: 1664, height: 2496, label: '1664×2496 (2:3 竖中幅)' },
          { width: 1600, height: 2848, label: '1600×2848 (9:16 竖长)' },
        ],
        pixelRanges: [{ minPixels: 3686400, maxPixels: 16777216, label: '标准 (3.5MP-16MP)' }],
      },
    ],
  },
};

const defaultSettings: Omit<
  SettingsState,
  | 'configSource'
  | 'loadSettings'
  | 'saveSettings'
  | 'resetSettings'
  | 'updateOpenAIConfig'
  | 'updateAnthropicConfig'
  | 'updateOllamaConfig'
  | 'updateFreeAIConfig'
  | 'updateV0Config'
  | 'updateCompanyGatewayConfig'
  | 'setDefaultProvider'
  | 'updateModelRouting'
  | 'updateInterfaceSettings'
  | 'updateExportSettings'
  | 'updateEditorSettings'
  | 'updateLogSettings'
  | 'updateImageGeneration'
  | 'updateAuditSettings'
  | 'updateInlineSelfCheckSettings'
  | 'updateImageProviderConfig'
  | 'setImageRoutingConfig'
  | 'getModelConfig'
  | 'getModelConfigsForStages'
  | 'getImageGenerationConfig'
  | 'hasApiKey'
  | 'getProviderLabel'
> = {
  apiConfig: {
    openai: {
      apiKey: '',
      baseUrl: 'https://api.openai.com/v1',
      models: ['gpt-4o-mini'],
    },
    anthropic: {
      apiKey: '',
      baseUrl: 'https://api.anthropic.com/v1',
      models: ['claude-3-5-sonnet-20241022'],
    },
    ollama: {
      apiKey: '',
      baseUrl: 'http://localhost:11434/v1',
      models: ['llama3.1'],
    },
    freeai: {
      apiKey: '',
      baseUrl: 'https://api.free.ai/v1',
      models: ['qwen-coder'],
    },
    v0: {
      apiKey: '',
      baseUrl: 'https://api.v0.dev/v1',
      models: ['v0-1.5-md'],
    },
    'company-gateway': {
      apiKey: '',
      baseUrl: 'https://your-company-gateway.example.com/ai-api',
      models: [],
    },
  },
  defaultModelProvider: 'openai',
  modelRouting: {
    planning: { provider: 'openai', modelIndex: 0 },
    content: { provider: 'openai', modelIndex: 0 },
    editing: { provider: 'openai', modelIndex: 0 },
    audit: { provider: 'openai', modelIndex: 0 },
    auditVlm: { provider: 'openai', modelIndex: 0 },
  },
  interfaceSettings: {
    theme: 'light',
    language: 'zh-CN',
    defaultZoom: 100,
    showGrid: false,
    snapToGrid: false,
    gridSize: 20,
  },
  exportSettings: {
    defaultFormat: 'html',
    pdfQuality: 'high',
    pngScale: 2,
    includeSpeakerNotes: false,
  },
  editorSettings: {
    autoSave: true,
    autoSaveInterval: 30000,
    undoHistoryLimit: 50,
    defaultSlideWidth: 1280,
    defaultSlideHeight: 720,
  },
  logSettings: {
    consoleVerbosity: 'detailed',
    fileVerbosity: 'detailed',
  },
  imageGeneration: {
    enabled: false,
    useDefaultApiKey: true,
    activeProvider: 'openai',
    providers: defaultImageProviders,
    routing: {
      openai: { enabled: false },
      qwen: { enabled: false },
      seedream: { enabled: false },
      freeai: { enabled: false },
      ollama: { enabled: false },
      'company-gateway': { enabled: false },
    },
  },
  auditSettings: {
    enabled: true,
    strictness: 'normal',
    autoFix: true,
    maxRegenerationRetries: 1,
    llmReview: true,
    vlmReview: true,
    engines: {
      layout: true,
      visual: true,
      content: true,
      fidelity: true,
    },
    thresholds: {
      pass: 70,
      warn: 50,
    },
  },
  inlineSelfCheckSettings: {
    enabled: true,
    llmCritique: true,
    vlmPlaceholder: true,
    maxRetries: 1,
    threshold: 7,
  },
};

function migrateOldConfig(config: any): any {
  if (!config) return config;
  const migrated = { ...config };

  if (migrated.apiConfig) {
    for (const key of Object.keys(migrated.apiConfig)) {
      const provider = migrated.apiConfig[key];
      if (provider && provider.model !== undefined && !provider.models) {
        provider.models = provider.model ? [provider.model] : [];
        delete provider.model;
      }
    }
  }

  if (migrated.imageGeneration) {
    const oldImg = migrated.imageGeneration;
    let providers: Record<string, ImageProviderConfig> = migrated.imageGeneration.providers
      ? { ...migrated.imageGeneration.providers }
      : { ...defaultImageProviders };

    for (const key of Object.keys(defaultImageProviders)) {
      if (!providers[key]) {
        providers[key] = { ...defaultImageProviders[key as ImageProvider] };
      }
    }

    if (oldImg.provider && !oldImg.activeProvider) {
      migrated.imageGeneration.activeProvider = oldImg.provider;
    }

    if (
      oldImg.provider &&
      (oldImg.model || oldImg.size || oldImg.baseUrl || oldImg.apiKey || oldImg.gatewayVendor) &&
      !providers[oldImg.provider]?.models?.length
    ) {
      const providerKey = oldImg.provider as ImageProvider;
      const existingProvider = providers[providerKey] || defaultImageProviders[providerKey];
      const modelName = oldImg.model || '';
      let sizes: ImageSize[] = existingProvider?.models?.[0]?.sizes || [
        { width: 1024, height: 1024 },
      ];

      if (oldImg.size) {
        const parts = oldImg.size.split('x');
        if (parts.length === 2) {
          const w = parseInt(parts[0]);
          const h = parseInt(parts[1]);
          if (!isNaN(w) && !isNaN(h)) {
            sizes = [{ width: w, height: h, label: oldImg.size }];
          }
        }
      }

      providers[providerKey] = {
        ...existingProvider,
        apiKey: oldImg.apiKey || existingProvider?.apiKey || '',
        baseUrl: oldImg.baseUrl || existingProvider?.baseUrl || '',
        gatewayVendor: oldImg.gatewayVendor || existingProvider?.gatewayVendor,
        models: modelName ? [{ modelName, sizes }] : existingProvider?.models || [],
      };
    }

    migrated.imageGeneration.providers = providers;
    delete migrated.imageGeneration.provider;
    delete migrated.imageGeneration.apiKey;
    delete migrated.imageGeneration.baseUrl;
    delete migrated.imageGeneration.model;
    delete migrated.imageGeneration.size;
  }

  if (!migrated.modelRouting) {
    const defaultProvider = migrated.defaultModelProvider || 'openai';
    migrated.modelRouting = {
      planning: { provider: defaultProvider, modelIndex: 0 },
      content: { provider: defaultProvider, modelIndex: 0 },
      editing: { provider: defaultProvider, modelIndex: 0 },
      audit: { provider: defaultProvider, modelIndex: 0 },
      auditVlm: { provider: defaultProvider, modelIndex: 0 },
    };
  } else {
    if (!migrated.modelRouting.audit) {
      migrated.modelRouting.audit = { ...migrated.modelRouting.content };
    }
    if (!migrated.modelRouting.auditVlm) {
      migrated.modelRouting.auditVlm = { ...migrated.modelRouting.content };
    }
  }

  if (migrated.imageGeneration && !migrated.imageGeneration.routing) {
    migrated.imageGeneration.routing = {
      openai: { enabled: false },
      qwen: { enabled: false },
      seedream: { enabled: false },
      freeai: { enabled: false },
      ollama: { enabled: false },
      'company-gateway': { enabled: false },
    };
  }

  if (!migrated.inlineSelfCheckSettings) {
    migrated.inlineSelfCheckSettings = {
      enabled: true,
      llmCritique: true,
      vlmPlaceholder: true,
      maxRetries: 1,
      threshold: 7,
    };
  }

  return migrated;
}

function mergeConfig(base: any, saved: any): any {
  if (!saved) return base;
  saved = migrateOldConfig(saved);
  const result = { ...base };
  for (const key of Object.keys(saved)) {
    if (
      typeof saved[key] === 'object' &&
      saved[key] !== null &&
      !Array.isArray(saved[key]) &&
      typeof base[key] === 'object' &&
      base[key] !== null
    ) {
      result[key] = mergeConfig(base[key], saved[key]);
    } else if (saved[key] !== undefined) {
      result[key] = saved[key];
    }
  }
  // 防御：logSettings 字段 normalize，避免老数据/脏数据把正确值污染成 undefined
  if (result.logSettings && typeof result.logSettings === 'object') {
    const valid: LogVerbosity[] = ['detailed', 'simple'];
    const cur: LogSettings = result.logSettings;
    result.logSettings = {
      consoleVerbosity: valid.includes(cur.consoleVerbosity) ? cur.consoleVerbosity : 'detailed',
      fileVerbosity: valid.includes(cur.fileVerbosity) ? cur.fileVerbosity : 'detailed',
    };
  }
  return result;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...defaultSettings,
  configSource: 'default',

  loadSettings: async () => {
    let source: ConfigSource = 'default';
    let loadedConfig: any = defaultSettings;

    try {
      const serverConfig = await configApi.get();
      if (serverConfig) {
        loadedConfig = mergeConfig(defaultSettings, serverConfig);
        source = 'file';
        storage.set(STORAGE_KEY, loadedConfig);
      }
    } catch (e) {
      console.log('[Settings] Failed to load config from server, trying local storage:', e);
    }

    if (source === 'default') {
      try {
        const saved = storage.get<Partial<SettingsState>>(STORAGE_KEY, {});
        if (saved && Object.keys(saved).length > 0) {
          loadedConfig = mergeConfig(defaultSettings, saved);
          source = 'local';
        }
      } catch (e) {
        console.error('[Settings] Failed to load settings from local storage:', e);
      }
    }

    set({
      ...loadedConfig,
      configSource: source,
    });
  },

  saveSettings: async () => {
    const {
      apiConfig,
      defaultModelProvider,
      modelRouting,
      interfaceSettings,
      exportSettings,
      editorSettings,
      logSettings,
      imageGeneration,
      auditSettings,
      inlineSelfCheckSettings,
    } = get();

    const configToSave = {
      apiConfig,
      defaultModelProvider,
      modelRouting,
      interfaceSettings,
      exportSettings,
      editorSettings,
      logSettings,
      imageGeneration,
      auditSettings,
      inlineSelfCheckSettings,
    };

    storage.set(STORAGE_KEY, configToSave);

    try {
      const savedConfig = await configApi.save(configToSave);
      if (savedConfig) {
        set({ configSource: 'file' });
        console.log('[Settings] Config saved to server file');
      }
    } catch (e) {
      console.warn('[Settings] Failed to save config to server, saved locally only:', e);
      set({ configSource: 'local' });
    }
  },

  resetSettings: async () => {
    set({ ...defaultSettings, configSource: 'default' });
    storage.remove(STORAGE_KEY);

    try {
      await configApi.reset();
      console.log('[Settings] Config reset on server');
    } catch (e) {
      console.warn('[Settings] Failed to reset config on server:', e);
    }
  },

  updateOpenAIConfig: (config) => {
    set((state) => ({
      apiConfig: {
        ...state.apiConfig,
        openai: {
          ...state.apiConfig.openai,
          ...config,
        },
      },
    }));
  },

  updateAnthropicConfig: (config) => {
    set((state) => ({
      apiConfig: {
        ...state.apiConfig,
        anthropic: {
          ...state.apiConfig.anthropic,
          ...config,
        },
      },
    }));
  },

  updateOllamaConfig: (config) => {
    set((state) => ({
      apiConfig: {
        ...state.apiConfig,
        ollama: {
          ...state.apiConfig.ollama,
          ...config,
        },
      },
    }));
  },

  updateFreeAIConfig: (config) => {
    set((state) => ({
      apiConfig: {
        ...state.apiConfig,
        freeai: {
          ...state.apiConfig.freeai,
          ...config,
        },
      },
    }));
  },

  updateV0Config: (config) => {
    set((state) => ({
      apiConfig: {
        ...state.apiConfig,
        v0: {
          ...state.apiConfig.v0,
          ...config,
        },
      },
    }));
  },

  updateCompanyGatewayConfig: (config) => {
    set((state) => ({
      apiConfig: {
        ...state.apiConfig,
        'company-gateway': {
          ...state.apiConfig['company-gateway'],
          ...config,
        },
      },
    }));
  },

  setDefaultProvider: (provider) => {
    set({ defaultModelProvider: provider });
  },

  updateModelRouting: (routing) => {
    set((state) => ({
      modelRouting: {
        ...state.modelRouting,
        ...routing,
      },
    }));
  },

  updateInterfaceSettings: (settings) => {
    set((state) => ({
      interfaceSettings: {
        ...state.interfaceSettings,
        ...settings,
      },
    }));
  },

  updateExportSettings: (settings) => {
    set((state) => ({
      exportSettings: {
        ...state.exportSettings,
        ...settings,
      },
    }));
  },

  updateEditorSettings: (settings) => {
    set((state) => ({
      editorSettings: {
        ...state.editorSettings,
        ...settings,
      },
    }));
  },

  updateLogSettings: (settings) => {
    const valid: LogVerbosity[] = ['detailed', 'simple'];
    const patch: Partial<LogSettings> = {};
    if (settings && valid.includes(settings.consoleVerbosity!))
      patch.consoleVerbosity = settings.consoleVerbosity;
    if (settings && valid.includes(settings.fileVerbosity!))
      patch.fileVerbosity = settings.fileVerbosity;
    set((state) => ({
      logSettings: {
        ...state.logSettings,
        ...patch,
      },
    }));
  },

  updateImageGeneration: (config) => {
    set((state) => ({
      imageGeneration: {
        ...state.imageGeneration,
        ...config,
      },
    }));
  },

  updateAuditSettings: (config) => {
    set((state) => ({
      auditSettings: {
        ...state.auditSettings,
        ...config,
      },
    }));
  },

  updateInlineSelfCheckSettings: (config) => {
    set((state) => ({
      inlineSelfCheckSettings: {
        ...state.inlineSelfCheckSettings,
        ...config,
      },
    }));
  },

  updateImageProviderConfig: (provider, config) => {
    set((state) => ({
      imageGeneration: {
        ...state.imageGeneration,
        providers: {
          ...state.imageGeneration.providers,
          [provider]: {
            ...state.imageGeneration.providers[provider],
            ...config,
          },
        },
      },
    }));
  },

  getModelConfig: () => {
    const { apiConfig, defaultModelProvider } = get();
    const config = apiConfig[defaultModelProvider];
    const model = config?.models?.[0] || 'gpt-4o-mini';
    return {
      provider: defaultModelProvider,
      apiKey: config?.apiKey || '',
      baseUrl: config?.baseUrl || '',
      model,
    };
  },

  getModelConfigsForStages: (): StageModelConfigs => {
    const { apiConfig, modelRouting, defaultModelProvider } = get();

    const resolveModelConfig = (ref: ModelRef): ModelConfig => {
      const provider = (ref.provider || defaultModelProvider) as ModelProvider;
      const config = apiConfig[provider];
      const model = config?.models?.[ref.modelIndex] || config?.models?.[0] || 'gpt-4o-mini';
      return {
        provider,
        apiKey: config?.apiKey || '',
        baseUrl: config?.baseUrl || '',
        model,
      };
    };

    return {
      planning: resolveModelConfig(modelRouting.planning),
      content: resolveModelConfig(modelRouting.content),
      editing: resolveModelConfig(modelRouting.editing),
      audit: resolveModelConfig(modelRouting.audit || modelRouting.content),
      auditVlm: resolveModelConfig(modelRouting.auditVlm || modelRouting.content),
    };
  },

  getImageGenerationConfig: () => {
    const { imageGeneration, apiConfig, defaultModelProvider } = get();
    const activeProvider = imageGeneration.activeProvider;
    const providerConfig = imageGeneration.providers[activeProvider];
    const routingConfig = imageGeneration.routing[activeProvider] || { enabled: false };
    const firstModel = providerConfig?.models?.[0];
    const firstSize = firstModel?.sizes?.[0];
    const sizeStr = firstSize ? `${firstSize.width}x${firstSize.height}` : '1024x1024';

    const allModels = (providerConfig?.models || []).map((m) => ({
      modelName: m.modelName,
      sizes: m.sizes || [],
      pixelRanges: m.pixelRanges,
    }));

    const base = {
      provider: activeProvider,
      baseUrl: providerConfig?.baseUrl || '',
      model: firstModel?.modelName || '',
      size: sizeStr,
      gatewayVendor: providerConfig?.gatewayVendor,
      allModels,
      routing: routingConfig,
    };

    if (imageGeneration.useDefaultApiKey) {
      const defaultConfig = apiConfig[defaultModelProvider];
      return {
        ...base,
        apiKey: defaultConfig?.apiKey || '',
        useDefaultApiKey: true,
      };
    }
    return {
      ...base,
      apiKey: providerConfig?.apiKey || '',
      useDefaultApiKey: false,
    };
  },

  setImageRoutingConfig: (provider: ImageProvider, config: Partial<ImageRoutingProviderConfig>) => {
    set((state) => ({
      imageGeneration: {
        ...state.imageGeneration,
        routing: {
          ...state.imageGeneration.routing,
          [provider]: {
            ...state.imageGeneration.routing[provider],
            ...config,
          },
        },
      },
    }));
    get().saveSettings();
  },

  hasApiKey: () => {
    const { apiConfig, defaultModelProvider } = get();
    if (defaultModelProvider === 'ollama') {
      return true;
    }
    return !!apiConfig[defaultModelProvider]?.apiKey;
  },

  getProviderLabel: (provider?: ModelProvider) => {
    const p = provider || get().defaultModelProvider;
    const labels: Record<ModelProvider, string> = {
      openai: t('OpenAI 兼容接口'),
      anthropic: t('Anthropic (Claude)'),
      ollama: t('Ollama (本地模型)'),
      freeai: t('Free.ai (380+ 模型)'),
      v0: t('v0 by Vercel (UI 生成)'),
      'company-gateway': t('公司 API 网关'),
    };
    return labels[p] || p;
  },
}));
