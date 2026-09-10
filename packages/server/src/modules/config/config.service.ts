import { Injectable } from '@nestjs/common';
import { StorageService } from '../../common/storage.service';
import { join } from 'path';
import { existsSync } from 'fs';
import type { ModelConfig } from '@noppt/ai';

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

export interface ApiProviderConfig {
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

export interface InterfaceSettings {
  theme: 'light' | 'dark' | 'auto';
  language: 'zh-CN' | 'en';
  defaultZoom: number;
  showGrid: boolean;
  snapToGrid: boolean;
  gridSize: number;
}

export interface ExportSettings {
  defaultFormat: 'html' | 'pdf' | 'png';
  pdfQuality: 'low' | 'medium' | 'high';
  pngScale: number;
  includeSpeakerNotes: boolean;
}

export interface EditorSettings {
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

export interface ImageGenerationSettings {
  enabled: boolean;
  useDefaultApiKey: boolean;
  activeProvider: ImageProvider;
  providers: Record<ImageProvider, ImageProviderConfig>;
}

export interface ModelRef {
  provider: ModelProvider;
  modelIndex: number;
}

export interface ModelRoutingConfig {
  planning: ModelRef;
  content: ModelRef;
  editing: ModelRef;
  audit: ModelRef;
  auditVlm: ModelRef;
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
    sanitization: boolean;
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

export interface AppConfig {
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
}

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
          { width: 2048, height: 2048, label: '2048×2048 (方形)' },
          { width: 2048, height: 1152, label: '2048×1152 (16:9)' },
          { width: 1152, height: 2048, label: '1152×2048 (9:16)' },
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
        modelName: 'seedream-5.0-lite',
        // 覆盖全系列常见比例，避免仅配置方形尺寸后用户请求 21:9 时走方案A拿到方形
        sizes: [
          { width: 1024, height: 1024, label: '1024×1024 (1:1)' },
          { width: 2048, height: 2048, label: '2048×2048 (1:1)' },
          { width: 2848, height: 1600, label: '2848×1600 (16:9)' },
          { width: 1600, height: 2848, label: '1600×2848 (9:16)' },
          { width: 3136, height: 1344, label: '3136×1344 (21:9)' },
          { width: 2304, height: 1728, label: '2304×1728 (4:3)' },
          { width: 1728, height: 2304, label: '1728×2304 (3:4)' },
        ],
        pixelRanges: [
          { minPixels: 0, maxPixels: 1048576, label: '标准质量 (1M 以内)' },
          { minPixels: 1048577, maxPixels: 4194304, label: '高清 (1M-4M)' },
        ],
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
    gatewayVendor: 'openai',
    models: [],
  },
};

@Injectable()
export class ConfigService {
  private configPath: string;

  constructor(private readonly storage: StorageService) {
    this.configPath = join(process.cwd(), 'data', 'config.json');
  }

  getDefaultConfig(): AppConfig {
    return {
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
          sanitization: true,
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
  }

  private migrateOldConfig(config: any): any {
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
      let providers = migrated.imageGeneration.providers
        ? { ...migrated.imageGeneration.providers }
        : { ...defaultImageProviders };

      for (const key of Object.keys(defaultImageProviders)) {
        if (!providers[key]) {
          providers[key] = { ...defaultImageProviders[key] };
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
        const existingProvider =
          providers[oldImg.provider] || defaultImageProviders[oldImg.provider];
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

        providers[oldImg.provider] = {
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
        migrated.modelRouting.audit = {
          ...(migrated.modelRouting.content || { provider: 'openai', modelIndex: 0 }),
        };
      }
      if (!migrated.modelRouting.auditVlm) {
        migrated.modelRouting.auditVlm = {
          ...(migrated.modelRouting.content || { provider: 'openai', modelIndex: 0 }),
        };
      }
    }

    if (!migrated.auditSettings) {
      migrated.auditSettings = {
        enabled: true,
        strictness: 'normal',
        autoFix: true,
        maxRegenerationRetries: 1,
        llmReview: true,
        vlmReview: false,
        engines: { layout: true, visual: true, content: true, fidelity: true, sanitization: true },
        thresholds: { pass: 70, warn: 50 },
      };
    } else {
      if (migrated.auditSettings.llmReview === undefined) migrated.auditSettings.llmReview = true;
      if (migrated.auditSettings.vlmReview === undefined) migrated.auditSettings.vlmReview = false;
      if (!migrated.auditSettings.engines) {
        migrated.auditSettings.engines = {
          layout: true,
          visual: true,
          content: true,
          fidelity: true,
          sanitization: true,
        };
      } else if ((migrated.auditSettings.engines as any).sanitization === undefined) {
        (migrated.auditSettings.engines as any).sanitization = true;
      }
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

  async getConfig(): Promise<AppConfig> {
    const defaultConfig = this.getDefaultConfig();
    let config = this.storage.readJsonFile<AppConfig>(this.configPath, defaultConfig);

    config = this.migrateOldConfig(config);

    if (!existsSync(this.configPath)) {
      await this.storage.writeJsonFile(this.configPath, defaultConfig);
    }

    return this.mergeWithDefaults(config, defaultConfig);
  }

  async resolveModelConfig(stage: keyof ModelRoutingConfig): Promise<ModelConfig | null> {
    const config = await this.getConfig();
    const ref = config.modelRouting?.[stage];
    if (!ref) return null;
    const provider = (ref.provider || config.defaultModelProvider) as ModelProvider;
    const providerConfig = config.apiConfig?.[provider];
    if (!providerConfig) return null;
    const model = providerConfig.models?.[ref.modelIndex] || providerConfig.models?.[0] || '';
    if (!model) return null;
    return {
      provider,
      apiKey: providerConfig.apiKey || '',
      baseUrl: providerConfig.baseUrl || '',
      model,
    };
  }

  async saveConfig(config: Partial<AppConfig>): Promise<AppConfig> {
    const currentConfig = await this.getConfig();
    const mergedConfig = this.mergeDeep(currentConfig, config);
    await this.storage.writeJsonFile(this.configPath, mergedConfig);
    return mergedConfig;
  }

  async resetConfig(): Promise<AppConfig> {
    const defaultConfig = this.getDefaultConfig();
    await this.storage.writeJsonFile(this.configPath, defaultConfig);
    return defaultConfig;
  }

  private mergeWithDefaults(config: AppConfig, defaults: AppConfig): AppConfig {
    return this.mergeDeep(defaults, config);
  }

  private mergeDeep(target: any, source: any): any {
    const result = { ...target };
    for (const key in source) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        result[key] = this.mergeDeep(result[key] || {}, source[key]);
      } else if (source[key] !== undefined) {
        result[key] = source[key];
      }
    }
    return result;
  }
}
