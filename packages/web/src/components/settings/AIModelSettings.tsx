import { t } from '@/i18n';
import { useState } from 'react';
import {
  Plus,
  X,
  Check,
  AlertCircle,
  Sparkles,
  Grid3X3,
  Info,
  Star,
  ClipboardList,
  FileCode2,
  Edit,
  HelpCircle,
  Route,
  Image,
  FileText,
  Layers,
  ShieldCheck,
  Eye,
  Wrench,
  Gauge,
  RotateCw,
  AlertTriangle,
} from 'lucide-react';
import {
  OpenAIProvider,
  FreeAIProvider,
  AnthropicProvider,
  QwenImageProvider,
  SeedreamProvider,
} from '@noppt/ai';
import { useSettingsStore } from '@/stores/settings';
import { useUIStore } from '@/stores/ui';
import { modelProviders, imageProviders, quickModelOptions } from './constants';
import {
  isCorsError,
  getDefaultModelPlaceholder,
  getApiKeyPlaceholder,
  getBaseUrlHint,
} from './utils';
interface AIModelSettingsProps {
  onTestConnection: () => Promise<void>;
  testing: boolean;
  testResult: 'success' | 'error' | null;
}
export default function AIModelSettings({
  onTestConnection,
  testing,
  testResult,
}: AIModelSettingsProps) {
  const settings = useSettingsStore();
  const showToast = useUIStore((s) => s.showToast);
  const providerConfig = settings.apiConfig[settings.defaultModelProvider];
  const activeImageProvider =
    settings.imageGeneration.providers[settings.imageGeneration.activeProvider];
  const [imageTesting, setImageTesting] = useState(false);
  const [imageTestResult, setImageTestResult] = useState<'success' | 'error' | null>(null);
  const [imageTestError, setImageTestError] = useState<string | null>(null);
  const [imageTestIsCors, setImageTestIsCors] = useState(false);
  const [showRoutingHelp, setShowRoutingHelp] = useState<string | null>(null);
  const routingStages = [
    {
      key: 'planning' as const,
      name: '大纲规划',
      desc: t('生成演示文稿结构规划（标题、页数、每页类型、要点）'),
      icon: ClipboardList,
      recommendation: '推荐使用推理能力强的模型（如GPT-4/Claude/DeepSeek-R1），规划质量更高',
      tip: '此阶段需要模型理解主题、分析逻辑结构、输出结构化JSON。强推理模型能生成更合理的内容大纲和页面类型分配。',
    },
    {
      key: 'content' as const,
      name: 'HTML内容生成',
      desc: t('逐页生成幻灯片HTML代码'),
      icon: FileCode2,
      recommendation: '推荐使用响应快速的模型（如GPT-4o-mini），并发生成时速度优势明显',
      tip: '此阶段需要模型严格遵循HTML规范和8pt网格系统，精确生成页面样式。并发生成3页，快速模型可显著缩短等待时间。',
    },
    {
      key: 'editing' as const,
      name: '对话编辑',
      desc: t('对话中修改单页或全局内容'),
      icon: Edit,
      recommendation: '推荐使用平衡型模型，兼顾理解能力和响应速度',
      tip: '此阶段需要模型理解用户的自然语言修改指令，精准修改现有HTML内容，同时保持整体风格一致。',
    },
    {
      key: 'audit' as const,
      name: '审核文本评审 (LLM)',
      desc: t('逐页评审幻灯片HTML的内容逻辑、层次与完成度'),
      icon: ShieldCheck,
      recommendation: '推荐使用指令遵循能力强的模型（如GPT-4o/Claude），评审更准确',
      tip: '生成结束后，审核机制将调用该模型逐页读取HTML源码，从哲学一致性、视觉层级、细节执行、功能性、创新性五个维度打分并给出问题。可在「审核设置」中开关。',
    },
    {
      key: 'auditVlm' as const,
      name: '审核视觉评审 (VLM)',
      desc: t('逐页查看渲染截图进行视觉设计评审'),
      icon: Eye,
      recommendation: '必须使用支持图片输入的多模态模型（如GPT-4o、Claude 3.5、Qwen-VL）',
      tip: '生成结束后，审核机制将把每页的渲染截图发送给该视觉大模型，基于真实渲染效果评审对齐、留白、色彩与专业完成度。请务必选择支持图片理解的多模态模型，否则会报错并被跳过。',
    },
  ];
  const buildModelOptions = () => {
    const options: Array<{
      value: string;
      label: string;
      disabled: boolean;
      disabledReason?: string;
    }> = [];
    const providers: Array<keyof typeof settings.apiConfig> = [
      'openai',
      'anthropic',
      'ollama',
      'freeai',
      'v0',
      'company-gateway',
    ];
    for (const provider of providers) {
      const config = settings.apiConfig[provider];
      if (!config) continue;
      const hasKey = provider === 'ollama' || !!config.apiKey;
      const models = config.models || [];
      for (let modelIndex = 0; modelIndex < models.length; modelIndex++) {
        const modelName = models[modelIndex];
        if (!modelName || !modelName.trim()) continue;
        const label = `${settings.getProviderLabel(provider)} / ${modelName}`;
        options.push({
          value: `${provider}:${modelIndex}`,
          label,
          disabled: !hasKey,
          disabledReason: !hasKey ? t('请先配置该提供商的API Key') : undefined,
        });
      }
    }
    return options;
  };
  const modelOptions = buildModelOptions();
  const getRoutingValue = (
    stage: 'planning' | 'content' | 'editing' | 'audit' | 'auditVlm',
  ): string => {
    const ref = settings.modelRouting[stage];
    const value = `${ref.provider}:${ref.modelIndex}`;
    const exists = modelOptions.some((o) => o.value === value);
    if (exists) return value;
    const provider = ref.provider as keyof typeof settings.apiConfig;
    const config = settings.apiConfig[provider];
    if (config?.models?.[0] && (provider === 'ollama' || config.apiKey)) {
      return `${provider}:0`;
    }
    const defaultProvider = settings.defaultModelProvider;
    const defaultConfig = settings.apiConfig[defaultProvider];
    if (defaultConfig?.models?.[0]) {
      return `${defaultProvider}:0`;
    }
    return modelOptions[0]?.value || '';
  };
  const handleRoutingChange = (
    stage: 'planning' | 'content' | 'editing' | 'audit' | 'auditVlm',
    value: string,
  ) => {
    const [provider, modelIndexStr] = value.split(':');
    const modelIndex = parseInt(modelIndexStr, 10);
    if (provider && !isNaN(modelIndex)) {
      settings.updateModelRouting({
        [stage]: { provider: provider as any, modelIndex },
      });
    }
  };
  const handleImageTestConnection = async () => {
    setImageTesting(true);
    setImageTestResult(null);
    setImageTestError(null);
    setImageTestIsCors(false);
    try {
      // 使用 getState() 确保获取最新的 store 状态，避免闭包陷阱
      const latestSettings = useSettingsStore.getState();
      const config = latestSettings.getImageGenerationConfig();
      let provider;
      const effectiveProvider =
        config.provider === 'company-gateway' ? config.gatewayVendor || 'openai' : config.provider;
      // 确保 qwen 图片生成使用正确的原生 DashScope API 路径
      let finalBaseUrl = config.baseUrl;
      if (effectiveProvider === 'qwen') {
        if (!finalBaseUrl || finalBaseUrl.includes('compatible-mode')) {
          finalBaseUrl = '/api/dashscope/api/v1';
        } else if (
          finalBaseUrl.includes('dashscope.aliyuncs.com') &&
          !finalBaseUrl.includes('/api/v1')
        ) {
          finalBaseUrl = finalBaseUrl.replace(/\/compatible-mode\/v1$/, '/api/v1');
        }
      }
      if (effectiveProvider === 'qwen') {
        provider = new QwenImageProvider({
          apiKey: config.apiKey,
          baseUrl: finalBaseUrl,
          model: config.model,
        });
      } else if (effectiveProvider === 'seedream') {
        // 火山引擎也使用代理避免 CORS
        if (finalBaseUrl && finalBaseUrl.includes('ark.cn-beijing.volces.com')) {
          finalBaseUrl = '/api/volcengine/api/v3';
        }
        provider = new SeedreamProvider({
          apiKey: config.apiKey,
          baseUrl: finalBaseUrl,
          model: config.model,
        });
      } else if (effectiveProvider === 'freeai') {
        provider = new FreeAIProvider({
          apiKey: config.apiKey,
          baseUrl: config.baseUrl,
          model: config.model,
        });
      } else {
        provider = new OpenAIProvider({
          apiKey: config.apiKey,
          baseUrl: config.baseUrl,
          model: config.model,
        });
      }
      const testImages = await provider.generateImage(t('测试连接'), {
        n: 1,
        size: config.size as any,
      });
      setImageTestResult(testImages.length > 0 ? 'success' : 'error');
    } catch (e) {
      const isCors = isCorsError(e);
      setImageTestResult('error');
      setImageTestIsCors(isCors);
      setImageTestError(e instanceof Error ? e.message : String(e));
    } finally {
      setImageTesting(false);
    }
  };
  const handleProviderConfigChange = (key: 'apiKey' | 'baseUrl', value: string) => {
    const updateFn = {
      openai: settings.updateOpenAIConfig,
      anthropic: settings.updateAnthropicConfig,
      ollama: settings.updateOllamaConfig,
      freeai: settings.updateFreeAIConfig,
      v0: settings.updateV0Config,
      'company-gateway': settings.updateCompanyGatewayConfig,
    }[settings.defaultModelProvider];
    updateFn?.({ [key]: value } as any);
  };
  const addTextModel = () => {
    const updateFn = {
      openai: settings.updateOpenAIConfig,
      anthropic: settings.updateAnthropicConfig,
      ollama: settings.updateOllamaConfig,
      freeai: settings.updateFreeAIConfig,
      v0: settings.updateV0Config,
      'company-gateway': settings.updateCompanyGatewayConfig,
    }[settings.defaultModelProvider];
    const currentModels = [...(providerConfig.models || [])];
    currentModels.push('');
    updateFn?.({ models: currentModels } as any);
  };
  const removeTextModel = (index: number) => {
    const updateFn = {
      openai: settings.updateOpenAIConfig,
      anthropic: settings.updateAnthropicConfig,
      ollama: settings.updateOllamaConfig,
      freeai: settings.updateFreeAIConfig,
      v0: settings.updateV0Config,
      'company-gateway': settings.updateCompanyGatewayConfig,
    }[settings.defaultModelProvider];
    const currentModels = [...(providerConfig.models || [])];
    currentModels.splice(index, 1);
    if (currentModels.length === 0) currentModels.push('');
    updateFn?.({ models: currentModels } as any);
  };
  const updateTextModel = (index: number, value: string) => {
    const updateFn = {
      openai: settings.updateOpenAIConfig,
      anthropic: settings.updateAnthropicConfig,
      ollama: settings.updateOllamaConfig,
      freeai: settings.updateFreeAIConfig,
      v0: settings.updateV0Config,
      'company-gateway': settings.updateCompanyGatewayConfig,
    }[settings.defaultModelProvider];
    const currentModels = [...(providerConfig.models || [])];
    currentModels[index] = value;
    updateFn?.({ models: currentModels } as any);
  };
  const setTextModelAsDefault = (index: number) => {
    if (index === 0) return;
    const updateFn = {
      openai: settings.updateOpenAIConfig,
      anthropic: settings.updateAnthropicConfig,
      ollama: settings.updateOllamaConfig,
      freeai: settings.updateFreeAIConfig,
      v0: settings.updateV0Config,
      'company-gateway': settings.updateCompanyGatewayConfig,
    }[settings.defaultModelProvider];
    const currentModels = [...(providerConfig.models || [])];
    const [movedModel] = currentModels.splice(index, 1);
    currentModels.unshift(movedModel);
    updateFn?.({ models: currentModels } as any);
  };
  const updateActiveImageProvider = (config: any) => {
    settings.updateImageProviderConfig(settings.imageGeneration.activeProvider, config);
  };
  const addImageModel = () => {
    const newModel = {
      modelName: '',
      sizes: [{ width: 1024, height: 1024, label: '1024×1024' }],
    };
    const currentModels = [...(activeImageProvider.models || [])];
    currentModels.push(newModel);
    updateActiveImageProvider({ models: currentModels });
  };
  const removeImageModel = (modelIndex: number) => {
    const currentModels = [...(activeImageProvider.models || [])];
    currentModels.splice(modelIndex, 1);
    updateActiveImageProvider({ models: currentModels });
  };
  const updateImageModelName = (modelIndex: number, modelName: string) => {
    const currentModels = [...(activeImageProvider.models || [])];
    currentModels[modelIndex] = { ...currentModels[modelIndex], modelName };
    updateActiveImageProvider({ models: currentModels });
  };
  const setImageModelAsDefault = (modelIndex: number) => {
    if (modelIndex === 0) return;
    const currentModels = [...(activeImageProvider.models || [])];
    const [movedModel] = currentModels.splice(modelIndex, 1);
    currentModels.unshift(movedModel);
    updateActiveImageProvider({ models: currentModels });
  };
  const addImageSize = (modelIndex: number) => {
    const currentModels = [...(activeImageProvider.models || [])];
    const model = { ...currentModels[modelIndex] };
    model.sizes = [...(model.sizes || []), { width: 1024, height: 1024, label: '1024×1024' }];
    currentModels[modelIndex] = model;
    updateActiveImageProvider({ models: currentModels });
  };
  const removeImageSize = (modelIndex: number, sizeIndex: number) => {
    const currentModels = [...(activeImageProvider.models || [])];
    const model = { ...currentModels[modelIndex] };
    model.sizes = [...(model.sizes || [])];
    model.sizes.splice(sizeIndex, 1);
    if (model.sizes.length === 0) model.sizes = [{ width: 1024, height: 1024, label: '1024×1024' }];
    currentModels[modelIndex] = model;
    updateActiveImageProvider({ models: currentModels });
  };
  const updateImageSize = (
    modelIndex: number,
    sizeIndex: number,
    field: 'width' | 'height',
    value: number,
  ) => {
    const currentModels = [...(activeImageProvider.models || [])];
    const model = { ...currentModels[modelIndex] };
    model.sizes = [...(model.sizes || [])];
    const size = { ...model.sizes[sizeIndex] };
    size[field] = value;
    size.label = `${size.width}×${size.height}`;
    model.sizes[sizeIndex] = size;
    currentModels[modelIndex] = model;
    updateActiveImageProvider({ models: currentModels });
  };
  const addPixelRange = (modelIndex: number) => {
    const currentModels = [...(activeImageProvider.models || [])];
    const model = { ...currentModels[modelIndex] };
    if ((model.pixelRanges?.length || 0) >= 1) {
      return;
    }
    model.pixelRanges = [
      ...(model.pixelRanges || []),
      { minPixels: 0, maxPixels: 1024 * 1024, label: t('标准') },
    ];
    currentModels[modelIndex] = model;
    updateActiveImageProvider({ models: currentModels });
  };
  const removePixelRange = (modelIndex: number, rangeIndex: number) => {
    const currentModels = [...(activeImageProvider.models || [])];
    const model = { ...currentModels[modelIndex] };
    model.pixelRanges = [...(model.pixelRanges || [])];
    model.pixelRanges.splice(rangeIndex, 1);
    currentModels[modelIndex] = model;
    updateActiveImageProvider({ models: currentModels });
  };
  const updatePixelRange = (
    modelIndex: number,
    rangeIndex: number,
    field: 'minPixels' | 'maxPixels' | 'label',
    value: number | string,
  ) => {
    const currentModels = [...(activeImageProvider.models || [])];
    const model = { ...currentModels[modelIndex] };
    model.pixelRanges = [...(model.pixelRanges || [])];
    const range = { ...model.pixelRanges[rangeIndex] };
    (range as any)[field] = value;
    model.pixelRanges[rangeIndex] = range;
    currentModels[modelIndex] = model;
    updateActiveImageProvider({ models: currentModels });
  };
  const selectImageProvider = (provider: typeof settings.imageGeneration.activeProvider) => {
    settings.updateImageGeneration({ activeProvider: provider });
  };
  return (
    <>
      <section className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-700">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
            {t('默认模型提供商')}
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            {t('选择用于 AI 生成演示内容的默认模型服务')}
          </p>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {modelProviders.map((provider) => {
              const Icon = provider.icon;
              return (
                <button
                  key={provider.value}
                  onClick={() => settings.setDefaultProvider(provider.value as any)}
                  className={`p-4 rounded-xl border-2 text-left transition-all ${
                    settings.defaultModelProvider === provider.value
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                      : 'border-slate-200 dark:border-slate-600 hover:border-slate-300 dark:hover:border-slate-500 bg-white dark:bg-slate-800'
                  }`}
                >
                  <div className="flex items-center gap-3 mb-2">
                    <div
                      className={`p-2 rounded-lg ${
                        settings.defaultModelProvider === provider.value
                          ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400'
                          : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400'
                      }`}
                    >
                      <Icon className="w-5 h-5" />
                    </div>
                    <span className="font-medium text-slate-900 dark:text-white">
                      {t(provider.label)}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{t(provider.hint)}</p>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* Provider Config */}
      <section className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-700">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
            {t(modelProviders.find((p) => p.value === settings.defaultModelProvider)?.label || '')}
            {t('配置')}
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            {t('配置 API 连接信息，所有数据仅保存在本地')}
          </p>
        </div>
        <div className="p-6 space-y-5">
          {settings.defaultModelProvider !== 'ollama' && (
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                API Key
              </label>
              <input
                type="password"
                value={providerConfig.apiKey}
                onChange={(e) => handleProviderConfigChange('apiKey', e.target.value)}
                placeholder={getApiKeyPlaceholder(settings.defaultModelProvider)}
                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"
              />
              {settings.defaultModelProvider === 'freeai' && (
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  {t('在')}
                  <a
                    href="https://free.ai/account/?tab=api"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline"
                  >
                    free.ai
                  </a>
                  {t('获取 API Key，注册即送 30K/天免费额度')}
                </p>
              )}
              {settings.defaultModelProvider === 'v0' && (
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  {t('在')}
                  <a
                    href="https://v0.dev/chat/settings/keys"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline"
                  >
                    v0.dev
                  </a>
                  {t('获取 API Key，Vercel 出品的高保真 UI 生成工具')}
                </p>
              )}
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
              API Base URL
            </label>
            <input
              type="text"
              value={providerConfig.baseUrl}
              onChange={(e) => handleProviderConfigChange('baseUrl', e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"
            />
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              {t(getBaseUrlHint(settings.defaultModelProvider))}
            </p>
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                {t('模型名称列表')}
              </label>
              <button
                onClick={addTextModel}
                className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                {t('添加模型')}
              </button>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
              {t('支持配置多个模型，默认使用第一个模型')}
              {settings.defaultModelProvider === 'company-gateway' &&
                t('，配置文件中模型用分号(;)分隔')}
            </p>
            <div className="space-y-2">
              {(providerConfig.models || ['']).map((modelName, index) => (
                <div key={index} className="flex items-center gap-2">
                  <span className="text-xs text-slate-400 w-6 text-center">{index + 1}.</span>
                  {index === 0 ? (
                    <span
                      className="px-1.5 py-0.5 text-[10px] font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 rounded flex items-center gap-0.5"
                      title={t('当前默认模型')}
                    >
                      <Star className="w-3 h-3 fill-current" />
                      {t('默认')}
                    </span>
                  ) : (
                    <button
                      onClick={() => setTextModelAsDefault(index)}
                      className="p-1 text-slate-400 hover:text-yellow-500 hover:bg-yellow-50 dark:hover:bg-yellow-900/20 rounded transition-colors"
                      title={t('设为默认模型（移动到第一位）')}
                    >
                      <Star className="w-4 h-4" />
                    </button>
                  )}
                  <input
                    type="text"
                    value={modelName}
                    onChange={(e) => updateTextModel(index, e.target.value)}
                    placeholder={getDefaultModelPlaceholder(settings.defaultModelProvider)}
                    className="flex-1 px-3 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"
                  />
                  {(providerConfig.models?.length || 0) > 1 && (
                    <button
                      onClick={() => removeTextModel(index)}
                      className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                      title={t('删除此模型')}
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
            {quickModelOptions[settings.defaultModelProvider] && (
              <div className="mt-3">
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
                  {t('快速选择添加：')}
                </p>
                <div className="flex flex-wrap gap-2">
                  {quickModelOptions[settings.defaultModelProvider].map((m) => (
                    <button
                      key={m.value}
                      onClick={() => {
                        const currentModels = [...(providerConfig.models || [])];
                        if (!currentModels.includes(m.value)) {
                          if (currentModels.length === 1 && currentModels[0] === '') {
                            currentModels[0] = m.value;
                          } else {
                            currentModels.push(m.value);
                          }
                          const updateFn = {
                            openai: settings.updateOpenAIConfig,
                            anthropic: settings.updateAnthropicConfig,
                            ollama: settings.updateOllamaConfig,
                            freeai: settings.updateFreeAIConfig,
                            v0: settings.updateV0Config,
                            'company-gateway': settings.updateCompanyGatewayConfig,
                          }[settings.defaultModelProvider];
                          updateFn?.({ models: currentModels } as any);
                        }
                      }}
                      className="px-3 py-1 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition-colors"
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="pt-3 border-t border-slate-200 dark:border-slate-700">
            <div className="flex items-center gap-3">
              <button
                onClick={onTestConnection}
                disabled={
                  (settings.defaultModelProvider !== 'ollama' && !providerConfig.apiKey) ||
                  testing ||
                  !providerConfig?.models?.length ||
                  !providerConfig?.models?.[0]
                }
                className="px-4 py-2 border border-slate-300 dark:border-slate-600 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {testing ? t('测试中...') : t('测试连接')}
              </button>
              {testResult === 'success' && (
                <span className="flex items-center gap-1 text-sm text-green-600 dark:text-green-400">
                  <Check className="w-4 h-4" />
                  {t('连接成功')}
                </span>
              )}
              {testResult === 'error' && (
                <span className="flex items-center gap-1 text-sm text-red-600 dark:text-red-400">
                  <AlertCircle className="w-4 h-4" />
                  {t('连接失败，请检查配置')}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
              <Info className="w-3.5 h-3.5 inline mr-1 -mt-0.5" />
              {t('将测试默认模型（第1个模型）：')}
              <code className="px-1 bg-slate-100 dark:bg-slate-700 rounded font-mono">
                {providerConfig?.models?.[0] || t('(未配置模型)')}
              </code>
              {providerConfig?.models && providerConfig.models.length > 1 && (
                <span>
                  {t('，共配置')}
                  {providerConfig.models.length}
                  {t('个模型')}
                </span>
              )}
            </p>
          </div>
        </div>
      </section>

      {/* 模型路由设置 */}
      <section className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-700">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
            {t('模型路由设置')}
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            {t('为不同生成阶段指定使用的模型，充分利用各模型的能力特点')}
          </p>
        </div>
        <div className="p-6 space-y-5">
          <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-700/50">
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider w-40">
                    {t('任务阶段')}
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    {t('使用模型')}
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                {routingStages.map((stage) => {
                  const Icon = stage.icon;
                  const currentValue = getRoutingValue(stage.key);
                  return (
                    <tr key={stage.key} className="hover:bg-slate-50 dark:hover:bg-slate-700/30">
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-2.5">
                          <div className="p-1.5 rounded-lg bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400">
                            <Icon className="w-4 h-4" />
                          </div>
                          <div>
                            <p className="text-sm font-medium text-slate-900 dark:text-white">
                              {stage.name}
                            </p>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                              {stage.desc}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <select
                          value={currentValue}
                          onChange={(e) => handleRoutingChange(stage.key, e.target.value)}
                          className="w-full max-w-md px-3 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                        >
                          {modelOptions.map((opt) => (
                            <option key={opt.value} value={opt.value} disabled={opt.disabled}>
                              {opt.label}
                              {opt.disabled ? ` (${opt.disabledReason})` : ''}
                            </option>
                          ))}
                        </select>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5 flex items-center gap-1">
                          <Sparkles className="w-3 h-3" />
                          {stage.recommendation}
                        </p>
                      </td>
                      <td className="px-4 py-4 text-center">
                        <div className="relative">
                          <button
                            onPointerEnter={() => setShowRoutingHelp(stage.key)}
                            onPointerLeave={() => setShowRoutingHelp(null)}
                            className="p-1.5 text-slate-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-full transition-colors"
                            title={t('了解详情')}
                          >
                            <HelpCircle className="w-4 h-4" />
                          </button>
                          {showRoutingHelp === stage.key && (
                            <div className="absolute right-0 top-full mt-2 w-64 p-3 bg-slate-800 dark:bg-slate-700 text-white text-xs rounded-lg shadow-xl z-20 text-left leading-relaxed">
                              {stage.tip}
                              <div className="absolute -top-1.5 right-3 w-3 h-3 bg-slate-800 dark:bg-slate-700 rotate-45"></div>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex items-start gap-2 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
            <Info className="w-4 h-4 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
            <p className="text-xs text-blue-800 dark:text-blue-300 leading-relaxed">
              {t(
                '下拉列表显示所有已配置API Key的提供商下的模型。灰色选项表示该提供商尚未配置API Key，请先在上方完成配置。图片生成使用下方独立的图片模型配置。',
              )}
            </p>
          </div>
        </div>
      </section>

      {/* 审核设置 */}
      <section className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-700">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                {t('AI 审核设置')}
              </h2>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                {t('生成完成后自动调用多引擎审核幻灯片，发现问题自动修复或重新生成')}
              </p>
            </div>
            <button
              onClick={() =>
                settings.updateAuditSettings({ enabled: !settings.auditSettings.enabled })
              }
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 ${settings.auditSettings.enabled ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-600'}`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${settings.auditSettings.enabled ? 'translate-x-6' : 'translate-x-1'}`}
              />
            </button>
          </div>
        </div>

        {settings.auditSettings.enabled && (
          <div className="p-6 space-y-6">
            <div className="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
              <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
                {t(
                  '审核功能会在生成完成后额外调用大模型进行评审，将产生额外的 API 费用。LLM 文本评审逐页读取 HTML 源码；VLM 视觉评审需发送截图，请确保 auditVlm 路由选择支持图片输入的多模态模型。',
                )}
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex items-start justify-between p-4 border border-slate-200 dark:border-slate-700 rounded-lg">
                <div className="flex-1 pr-4">
                  <div className="flex items-center gap-2 mb-1">
                    <FileCode2 className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                    <p className="text-sm font-medium text-slate-900 dark:text-white">
                      {t('LLM 文本评审')}
                    </p>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                    {t(
                      '调用「审核文本评审 (LLM)」路由模型，逐页分析 HTML 源码的内容逻辑、视觉层级、细节执行、功能性与创新性，输出结构化评分和问题列表',
                    )}
                  </p>
                </div>
                <button
                  onClick={() =>
                    settings.updateAuditSettings({ llmReview: !settings.auditSettings.llmReview })
                  }
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 ${settings.auditSettings.llmReview ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-600'}`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${settings.auditSettings.llmReview ? 'translate-x-6' : 'translate-x-1'}`}
                  />
                </button>
              </div>

              <div className="flex items-start justify-between p-4 border border-slate-200 dark:border-slate-700 rounded-lg">
                <div className="flex-1 pr-4">
                  <div className="flex items-center gap-2 mb-1">
                    <Eye className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                    <p className="text-sm font-medium text-slate-900 dark:text-white">
                      {t('VLM 视觉评审')}
                    </p>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                    {t(
                      '调用「审核视觉评审 (VLM)」路由模型，将每页渲染截图发送给多模态模型，基于真实渲染效果评审对齐、留白、色彩与专业完成度',
                    )}
                  </p>
                </div>
                <button
                  onClick={() =>
                    settings.updateAuditSettings({ vlmReview: !settings.auditSettings.vlmReview })
                  }
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 ${settings.auditSettings.vlmReview ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-600'}`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${settings.auditSettings.vlmReview ? 'translate-x-6' : 'translate-x-1'}`}
                  />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex items-start justify-between p-4 border border-slate-200 dark:border-slate-700 rounded-lg">
                <div className="flex-1 pr-4">
                  <div className="flex items-center gap-2 mb-1">
                    <Wrench className="w-4 h-4 text-green-600 dark:text-green-400" />
                    <p className="text-sm font-medium text-slate-900 dark:text-white">
                      {t('自动修复')}
                    </p>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                    {t(
                      '对可自动修复的问题（如卡片强制高度、图标错误包裹等）直接修改 HTML 并二次验证',
                    )}
                  </p>
                </div>
                <button
                  onClick={() =>
                    settings.updateAuditSettings({ autoFix: !settings.auditSettings.autoFix })
                  }
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 ${settings.auditSettings.autoFix ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-600'}`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${settings.auditSettings.autoFix ? 'translate-x-6' : 'translate-x-1'}`}
                  />
                </button>
              </div>

              <div className="p-4 border border-slate-200 dark:border-slate-700 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <Gauge className="w-4 h-4 text-orange-600 dark:text-orange-400" />
                  <p className="text-sm font-medium text-slate-900 dark:text-white">
                    {t('严格级别')}
                  </p>
                </div>
                <select
                  value={settings.auditSettings.strictness}
                  onChange={(e) =>
                    settings.updateAuditSettings({ strictness: e.target.value as any })
                  }
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                >
                  <option value="strict">{t('严格 - 高标准，适合正式汇报')}</option>
                  <option value="normal">{t('标准 - 平衡质量与效率（推荐）')}</option>
                  <option value="relaxed">{t('宽松 - 仅阻断严重问题')}</option>
                </select>
              </div>
            </div>

            <div className="p-4 border border-slate-200 dark:border-slate-700 rounded-lg">
              <div className="flex items-center gap-2 mb-3">
                <RotateCw className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                <p className="text-sm font-medium text-slate-900 dark:text-white">
                  {t('最大重新生成次数')}
                </p>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
                {t('当评审分数低于阈值且存在严重问题时，自动重新生成该页幻灯片的最大重试次数')}
              </p>
              <div className="flex items-center gap-3">
                {[0, 1, 2, 3].map((n) => (
                  <button
                    key={n}
                    onClick={() => settings.updateAuditSettings({ maxRegenerationRetries: n })}
                    className={`w-10 h-10 rounded-lg border-2 text-sm font-medium transition-all ${
                      settings.auditSettings.maxRegenerationRetries === n
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                        : 'border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-500'
                    }`}
                  >
                    {n}
                  </button>
                ))}
                <span className="text-xs text-slate-400 ml-2">
                  {settings.auditSettings.maxRegenerationRetries === 0
                    ? t('不重新生成')
                    : t('最多重试 {n} 次', { n: settings.auditSettings.maxRegenerationRetries })}
                </span>
              </div>
            </div>

            <div className="p-4 border border-slate-200 dark:border-slate-700 rounded-lg">
              <p className="text-sm font-medium text-slate-900 dark:text-white mb-3">
                {t('审核引擎开关')}
              </p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {(
                  [
                    { key: 'layout', name: '布局样式', desc: t('HTML结构与8pt网格') },
                    { key: 'visual', name: '视觉设计', desc: t('对比度/色彩/复杂度') },
                    { key: 'content', name: '内容质量', desc: t('逻辑/可访问性/LLM评审') },
                    { key: 'fidelity', name: '渲染保真', desc: t('截图与元数据对比') },
                  ] as const
                ).map(({ key, name, desc }) => (
                  <label
                    key={key}
                    className={`flex flex-col p-3 rounded-lg border-2 cursor-pointer transition-all ${
                      settings.auditSettings.engines[key]
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                        : 'border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 opacity-60'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-slate-900 dark:text-white">
                        {name}
                      </span>
                      <input
                        type="checkbox"
                        checked={settings.auditSettings.engines[key]}
                        onChange={(e) =>
                          settings.updateAuditSettings({
                            engines: { ...settings.auditSettings.engines, [key]: e.target.checked },
                          })
                        }
                        className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                      />
                    </div>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400">{desc}</span>
                  </label>
                ))}
              </div>
              <p className="text-xs text-slate-400 mt-3">
                {t(
                  '提示：内容质量引擎包含 LLM 文本评审；视觉设计引擎包含 VLM 视觉评审（需分别开启上方对应开关）',
                )}
              </p>
            </div>

            <div className="p-4 border border-slate-200 dark:border-slate-700 rounded-lg">
              <p className="text-sm font-medium text-slate-900 dark:text-white mb-3">
                {t('分数阈值（0-100）')}
              </p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-medium text-green-700 dark:text-green-400">
                      {t('通过分数')}
                    </label>
                    <span className="text-sm font-mono font-bold text-green-600 dark:text-green-400">
                      {settings.auditSettings.thresholds.pass}
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={settings.auditSettings.thresholds.pass}
                    onChange={(e) =>
                      settings.updateAuditSettings({
                        thresholds: {
                          ...settings.auditSettings.thresholds,
                          pass: parseInt(e.target.value),
                        },
                      })
                    }
                    className="w-full accent-green-600"
                  />
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                    {t('高于此分数视为通过')}
                  </p>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-medium text-amber-700 dark:text-amber-400">
                      {t('警告分数')}
                    </label>
                    <span className="text-sm font-mono font-bold text-amber-600 dark:text-amber-400">
                      {settings.auditSettings.thresholds.warn}
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={settings.auditSettings.thresholds.warn}
                    onChange={(e) =>
                      settings.updateAuditSettings({
                        thresholds: {
                          ...settings.auditSettings.thresholds,
                          warn: parseInt(e.target.value),
                        },
                      })
                    }
                    className="w-full accent-amber-600"
                  />
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                    {t('低于此分数触发重新生成')}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* 内联自检设置 */}
      <section className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-700">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-orange-600 dark:text-orange-400" />
                {t('AI 内联自检设置')}
              </h2>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                {t(
                  '在每页幻灯片 HTML 生成后立即调用 LLM 文本自检 + VLM 占位视觉自检，发现问题当场重试',
                )}
              </p>
            </div>
            <button
              onClick={() =>
                settings.updateInlineSelfCheckSettings({
                  enabled: !settings.inlineSelfCheckSettings.enabled,
                })
              }
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 ${settings.inlineSelfCheckSettings.enabled ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-600'}`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${settings.inlineSelfCheckSettings.enabled ? 'translate-x-6' : 'translate-x-1'}`}
              />
            </button>
          </div>
        </div>

        {settings.inlineSelfCheckSettings.enabled && (
          <div className="p-6 space-y-6">
            <div className="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
              <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
                {t(
                  '内联自检会在每页生成后立即调用模型，产生额外 API 费用但能尽早修复问题。VLM 占位视觉自检会发送渲染截图，请确保 auditVlm 路由选择支持图片输入的多模态模型。',
                )}
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex items-start justify-between p-4 border border-slate-200 dark:border-slate-700 rounded-lg">
                <div className="flex-1 pr-4">
                  <div className="flex items-center gap-2 mb-1">
                    <FileCode2 className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                    <p className="text-sm font-medium text-slate-900 dark:text-white">
                      {t('LLM 内联文本自检')}
                    </p>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                    {t(
                      '调用内容路由模型，逐页分析 HTML 源码的内容逻辑、视觉层级、细节执行与完成度，未通过当场重生成该页',
                    )}
                  </p>
                </div>
                <button
                  onClick={() =>
                    settings.updateInlineSelfCheckSettings({
                      llmCritique: !settings.inlineSelfCheckSettings.llmCritique,
                    })
                  }
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 ${settings.inlineSelfCheckSettings.llmCritique ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-600'}`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${settings.inlineSelfCheckSettings.llmCritique ? 'translate-x-6' : 'translate-x-1'}`}
                  />
                </button>
              </div>

              <div className="flex items-start justify-between p-4 border border-slate-200 dark:border-slate-700 rounded-lg">
                <div className="flex-1 pr-4">
                  <div className="flex items-center gap-2 mb-1">
                    <Eye className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                    <p className="text-sm font-medium text-slate-900 dark:text-white">
                      {t('VLM 内联占位视觉自检')}
                    </p>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                    {t(
                      '调用 auditVlm 路由多模态模型，将占位图渲染为灰色块后的截图发送 VLM，基于真实占位布局效果评审对齐、留白与专业完成度',
                    )}
                  </p>
                </div>
                <button
                  onClick={() =>
                    settings.updateInlineSelfCheckSettings({
                      vlmPlaceholder: !settings.inlineSelfCheckSettings.vlmPlaceholder,
                    })
                  }
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 ${settings.inlineSelfCheckSettings.vlmPlaceholder ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-600'}`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${settings.inlineSelfCheckSettings.vlmPlaceholder ? 'translate-x-6' : 'translate-x-1'}`}
                  />
                </button>
              </div>
            </div>

            <div className="p-4 border border-slate-200 dark:border-slate-700 rounded-lg">
              <div className="flex items-center gap-2 mb-3">
                <RotateCw className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                <p className="text-sm font-medium text-slate-900 dark:text-white">
                  {t('最大重新生成次数')}
                </p>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
                {t('当自检未通过时当场重做该页的最大次数（0 表示不重试）')}
              </p>
              <div className="flex items-center gap-3">
                {[0, 1, 2, 3].map((n) => (
                  <button
                    key={n}
                    onClick={() => settings.updateInlineSelfCheckSettings({ maxRetries: n })}
                    className={`w-10 h-10 rounded-lg border-2 text-sm font-medium transition-all ${
                      settings.inlineSelfCheckSettings.maxRetries === n
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                        : 'border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-500'
                    }`}
                  >
                    {n}
                  </button>
                ))}
                <span className="text-xs text-slate-400 ml-2">
                  {settings.inlineSelfCheckSettings.maxRetries === 0
                    ? t('不重新生成')
                    : t('最多重试 {n} 次', { n: settings.inlineSelfCheckSettings.maxRetries })}
                </span>
              </div>
            </div>

            <div className="p-4 border border-slate-200 dark:border-slate-700 rounded-lg">
              <div className="flex items-center gap-2 mb-3">
                <Gauge className="w-4 h-4 text-orange-600 dark:text-orange-400" />
                <p className="text-sm font-medium text-slate-900 dark:text-white">
                  {t('LLM 通过阈值（0-10）')}
                </p>
              </div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-medium text-green-700 dark:text-green-400">
                  {t('通过阈值')}
                </label>
                <span className="text-sm font-mono font-bold text-green-600 dark:text-green-400">
                  {settings.inlineSelfCheckSettings.threshold}
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="10"
                value={settings.inlineSelfCheckSettings.threshold}
                onChange={(e) =>
                  settings.updateInlineSelfCheckSettings({ threshold: parseInt(e.target.value) })
                }
                className="w-full accent-green-600"
              />
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                {t('高于此阈值视为通过，低于触发重生成')}
              </p>
            </div>
          </div>
        )}
      </section>

      {/* 图片生成配置 */}
      <section className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-700">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
            {t('AI 图片生成')}
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            {t('配置所有6个图片生成服务商，支持多模型、多尺寸、像素范围配置')}
          </p>
        </div>
        <div className="p-6 space-y-5">
          {/* 启用开关 */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-slate-900 dark:text-white">
                {t('自动生成配图')}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                {t('生成演示时，为每页自动生成 AI 配图')}
              </p>
            </div>
            <button
              onClick={() =>
                settings.updateImageGeneration({ enabled: !settings.imageGeneration.enabled })
              }
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${settings.imageGeneration.enabled ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-600'}`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${settings.imageGeneration.enabled ? 'translate-x-6' : 'translate-x-1'}`}
              />
            </button>
          </div>

          {settings.imageGeneration.enabled && (
            <>
              {/* 共用API Key开关 */}
              <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-700">
                <div>
                  <p className="text-sm font-medium text-slate-900 dark:text-white">
                    {t('与默认模型提供商共用 API Key')}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    {t('复用上方默认模型的 API Key')}
                  </p>
                </div>
                <button
                  onClick={() =>
                    settings.updateImageGeneration({
                      useDefaultApiKey: !settings.imageGeneration.useDefaultApiKey,
                    })
                  }
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${settings.imageGeneration.useDefaultApiKey ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-600'}`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${settings.imageGeneration.useDefaultApiKey ? 'translate-x-6' : 'translate-x-1'}`}
                  />
                </button>
              </div>

              {/* 服务商选择 */}
              <div className="pt-2 border-t border-slate-100 dark:border-slate-700">
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">
                  {t('选择要配置的图片生成服务商（6个服务商配置独立保存）')}
                </label>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {imageProviders.map((provider) => {
                    const Icon = provider.icon;
                    const isActive = settings.imageGeneration.activeProvider === provider.value;
                    const providerCfg =
                      settings.imageGeneration.providers[
                        provider.value as keyof typeof settings.imageGeneration.providers
                      ];
                    const hasModels = providerCfg.models && providerCfg.models.length > 0;
                    return (
                      <button
                        key={provider.value}
                        onClick={() => selectImageProvider(provider.value as any)}
                        className={`p-3 rounded-xl border-2 text-left transition-all ${
                          isActive
                            ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                            : 'border-slate-200 dark:border-slate-600 hover:border-slate-300 dark:hover:border-slate-500 bg-white dark:bg-slate-800'
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <div
                            className={`p-1.5 rounded-lg ${
                              isActive
                                ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400'
                                : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400'
                            }`}
                          >
                            <Icon className="w-4 h-4" />
                          </div>
                          <span className="font-medium text-sm text-slate-900 dark:text-white">
                            {t(provider.label)}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          {hasModels
                            ? t('已配置 {n} 个模型', { n: providerCfg.models.length })
                            : t(provider.hint)}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 当前选中服务商的详细配置 */}
              <div className="pt-4 border-t-2 border-slate-200 dark:border-slate-700">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                  {t(
                    imageProviders.find((p) => p.value === settings.imageGeneration.activeProvider)
                      ?.label || '',
                  )}
                  {t('配置')}
                </h3>

                {/* API Key */}
                {!settings.imageGeneration.useDefaultApiKey &&
                  settings.imageGeneration.activeProvider !== 'ollama' && (
                    <div className="mb-4">
                      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                        API Key
                      </label>
                      <input
                        type="password"
                        value={activeImageProvider?.apiKey || ''}
                        onChange={(e) => updateActiveImageProvider({ apiKey: e.target.value })}
                        placeholder="sk-..."
                        className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"
                      />
                      {settings.imageGeneration.activeProvider === 'qwen' && (
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                          {t('在')}
                          <a
                            href="https://dashscope.console.aliyun.com/"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:underline"
                          >
                            {t('阿里云百炼控制台')}
                          </a>
                          {t('获取 API Key')}
                        </p>
                      )}
                      {settings.imageGeneration.activeProvider === 'seedream' && (
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                          {t('在')}
                          <a
                            href="https://console.volcengine.com/visual/"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:underline"
                          >
                            {t('火山引擎控制台')}
                          </a>
                          {t('获取 API Key')}
                        </p>
                      )}
                    </div>
                  )}

                {/* API Base URL */}
                <div className="mb-4">
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    API Base URL
                  </label>
                  <input
                    type="text"
                    value={activeImageProvider?.baseUrl || ''}
                    onChange={(e) => updateActiveImageProvider({ baseUrl: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"
                  />
                </div>

                {/* 模型供应商类型 - 仅公司网关显示 */}
                {settings.imageGeneration.activeProvider === 'company-gateway' && (
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                      {t('模型供应商类型')}
                    </label>
                    <select
                      value={activeImageProvider?.gatewayVendor || 'openai'}
                      onChange={(e) =>
                        updateActiveImageProvider({ gatewayVendor: e.target.value as any })
                      }
                      className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                    >
                      <option value="openai">{t('OpenAI 兼容格式')}</option>
                      <option value="qwen">{t('阿里云百炼格式')}</option>
                      <option value="seedream">{t('字节火山引擎格式')}</option>
                    </select>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
                      {t('根据公司网关对接的实际模型供应商选择对应格式')}
                    </p>
                  </div>
                )}

                {/* 图片生成模型列表 */}
                <div className="mb-4">
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                      {t('模型列表')}
                    </label>
                    <button
                      onClick={addImageModel}
                      className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      {t('添加模型')}
                    </button>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
                    {t(
                      '支持配置多个模型，每个模型可独立配置尺寸列表和像素范围，默认使用第一个模型',
                    )}
                  </p>

                  <div className="space-y-4">
                    {(activeImageProvider?.models || []).map((imgModel, modelIndex) => (
                      <div
                        key={modelIndex}
                        className="border border-slate-200 dark:border-slate-700 rounded-lg p-4 bg-slate-50 dark:bg-slate-800/50"
                      >
                        <div className="flex items-center gap-2 mb-3">
                          <span className="text-xs font-medium text-slate-500 dark:text-slate-400 w-14">
                            {t('模型')}
                            {modelIndex + 1}
                          </span>
                          {modelIndex === 0 ? (
                            <span
                              className="px-1.5 py-0.5 text-[10px] font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 rounded flex items-center gap-0.5"
                              title={t('当前默认模型')}
                            >
                              <Star className="w-3 h-3 fill-current" />
                              {t('默认')}
                            </span>
                          ) : (
                            <button
                              onClick={() => setImageModelAsDefault(modelIndex)}
                              className="p-1 text-slate-400 hover:text-yellow-500 hover:bg-yellow-50 dark:hover:bg-yellow-900/20 rounded transition-colors"
                              title={t('设为默认模型（移动到第一位）')}
                            >
                              <Star className="w-4 h-4" />
                            </button>
                          )}
                          <input
                            type="text"
                            value={imgModel.modelName}
                            onChange={(e) => updateImageModelName(modelIndex, e.target.value)}
                            placeholder={t('输入模型名称，例如：dall-e-3')}
                            className="flex-1 px-2 py-1.5 border border-slate-300 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded text-sm font-mono"
                          />
                          {(activeImageProvider?.models?.length || 0) > 1 && (
                            <button
                              onClick={() => removeImageModel(modelIndex)}
                              className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                              title={t('删除此模型')}
                            >
                              <X className="w-4 h-4" />
                            </button>
                          )}
                        </div>

                        {/* 尺寸配置 */}
                        <div className="pl-0 border-l-2 border-slate-200 dark:border-slate-700 ml-2">
                          <div className="flex items-center justify-between mb-2 ml-3">
                            <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                              {t('可用图片尺寸')}
                            </span>
                            <button
                              onClick={() => addImageSize(modelIndex)}
                              className="flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 rounded transition-colors"
                            >
                              <Plus className="w-3 h-3" />
                              {t('添加尺寸')}
                            </button>
                          </div>
                          <p className="text-[11px] text-slate-500 dark:text-slate-500 mb-2 ml-3">
                            {t('每个尺寸配置宽（长）和高（宽），默认使用第一个尺寸')}
                          </p>
                          <div className="space-y-2 ml-3">
                            {(imgModel.sizes || []).map((size, sizeIndex) => (
                              <div key={sizeIndex} className="flex items-center gap-2">
                                <span className="text-[11px] text-slate-400 w-8">
                                  {sizeIndex + 1}.
                                </span>
                                {sizeIndex === 0 && (
                                  <span className="px-1 py-0.5 text-[9px] font-medium bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded shrink-0">
                                    {t('默认')}
                                  </span>
                                )}
                                <div className="flex items-center gap-1">
                                  <input
                                    type="number"
                                    value={size.width}
                                    onChange={(e) =>
                                      updateImageSize(
                                        modelIndex,
                                        sizeIndex,
                                        'width',
                                        parseInt(e.target.value) || 0,
                                      )
                                    }
                                    className="w-20 px-2 py-1 border border-slate-300 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded text-sm"
                                    min="1"
                                  />
                                  <span className="text-slate-400">×</span>
                                  <input
                                    type="number"
                                    value={size.height}
                                    onChange={(e) =>
                                      updateImageSize(
                                        modelIndex,
                                        sizeIndex,
                                        'height',
                                        parseInt(e.target.value) || 0,
                                      )
                                    }
                                    className="w-20 px-2 py-1 border border-slate-300 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded text-sm"
                                    min="1"
                                  />
                                  <span className="text-xs text-slate-400 ml-1">
                                    {size.width}×{size.height}
                                  </span>
                                </div>
                                {(imgModel.sizes?.length || 0) > 1 && (
                                  <button
                                    onClick={() => removeImageSize(modelIndex, sizeIndex)}
                                    className="p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                                    title={t('删除此尺寸')}
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* 像素范围配置 */}
                        <div className="pl-0 border-l-2 border-slate-200 dark:border-slate-700 ml-2 mt-3">
                          <div className="flex items-center justify-between mb-2 ml-3">
                            <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                              {t('总像素取值范围')}
                              <span className="text-slate-400 font-normal">
                                {t('（可选，最多1条）')}
                              </span>
                            </span>
                            <button
                              onClick={() => addPixelRange(modelIndex)}
                              disabled={(imgModel.pixelRanges?.length || 0) >= 1}
                              className={`flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded transition-colors ${
                                (imgModel.pixelRanges?.length || 0) >= 1
                                  ? 'text-slate-400 dark:text-slate-600 bg-slate-100 dark:bg-slate-800 cursor-not-allowed'
                                  : 'text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20'
                              }`}
                            >
                              <Plus className="w-3 h-3" />
                              {t('添加范围')}
                            </button>
                          </div>
                          <p className="text-[11px] text-slate-500 dark:text-slate-500 mb-2 ml-3">
                            {t('用于路由功能自动选择合适尺寸，配置像素下限和上限')}
                          </p>
                          {imgModel.pixelRanges && imgModel.pixelRanges.length > 0 ? (
                            <div className="space-y-2 ml-3">
                              {imgModel.pixelRanges.map((range, rangeIndex) => (
                                <div key={rangeIndex} className="flex items-center gap-2 flex-wrap">
                                  <input
                                    type="number"
                                    value={range.minPixels}
                                    onChange={(e) =>
                                      updatePixelRange(
                                        modelIndex,
                                        rangeIndex,
                                        'minPixels',
                                        parseInt(e.target.value) || 0,
                                      )
                                    }
                                    className="w-24 px-2 py-1 border border-slate-300 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded text-sm"
                                    min="0"
                                    placeholder={t('下限')}
                                  />
                                  <span className="text-slate-400">~</span>
                                  <input
                                    type="number"
                                    value={range.maxPixels}
                                    onChange={(e) =>
                                      updatePixelRange(
                                        modelIndex,
                                        rangeIndex,
                                        'maxPixels',
                                        parseInt(e.target.value) || 0,
                                      )
                                    }
                                    className="w-24 px-2 py-1 border border-slate-300 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded text-sm"
                                    min="0"
                                    placeholder={t('上限')}
                                  />
                                  <input
                                    type="text"
                                    value={range.label || ''}
                                    onChange={(e) =>
                                      updatePixelRange(
                                        modelIndex,
                                        rangeIndex,
                                        'label',
                                        e.target.value,
                                      )
                                    }
                                    className="w-28 px-2 py-1 border border-slate-300 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded text-sm"
                                    placeholder={t('标签（如高清）')}
                                  />
                                  <span className="text-[10px] text-slate-400">
                                    {Math.round((range.minPixels / 1024 / 1024) * 10) / 10}MP ~{' '}
                                    {Math.round((range.maxPixels / 1024 / 1024) * 10) / 10}MP
                                  </span>
                                  <button
                                    onClick={() => removePixelRange(modelIndex, rangeIndex)}
                                    className="p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                                    title={t('删除此范围')}
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-[11px] text-slate-400 ml-3 italic">
                              {t('未配置像素范围（可选配置）')}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                    {(!activeImageProvider?.models || activeImageProvider.models.length === 0) && (
                      <div className="text-center py-6 text-slate-400 dark:text-slate-500">
                        <p className="text-sm">{t('暂无模型，请点击上方"添加模型"按钮')}</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* 图片模型路由 */}
                <div className="mb-4 p-4 bg-blue-50 dark:bg-blue-900/10 rounded-lg border border-blue-200 dark:border-blue-800">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Route className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                        {t('图片模型路由')}
                      </label>
                      <button
                        onClick={() =>
                          setShowRoutingHelp(showRoutingHelp === 'image' ? null : 'image')
                        }
                        className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                        title={t('了解图片模型路由')}
                      >
                        <HelpCircle className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        className="sr-only peer"
                        checked={
                          settings.imageGeneration.routing[settings.imageGeneration.activeProvider]
                            ?.enabled || false
                        }
                        onChange={(e) =>
                          settings.setImageRoutingConfig(settings.imageGeneration.activeProvider, {
                            enabled: e.target.checked,
                          })
                        }
                      />
                      <div className="w-9 h-5 bg-slate-300 dark:bg-slate-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                    </label>
                  </div>

                  {showRoutingHelp === 'image' && (
                    <div className="mb-3 p-3 bg-blue-100 dark:bg-blue-900/20 rounded text-xs text-slate-600 dark:text-slate-400 space-y-1.5">
                      <p className="font-medium text-slate-700 dark:text-slate-300">
                        {t('自动选择策略：')}
                      </p>
                      <p>
                        1. <strong>{t('能力过滤')}</strong>
                        {t('：先筛选支持目标图片比例和像素范围的模型')}
                      </p>
                      <p>
                        2. <strong>{t('版本优先')}</strong>
                        {t(
                          '：高版本基础模型优于低版本增强模型（如 qwen-image-2.0 优于 qwen-image-plus）',
                        )}
                      </p>
                      <p>
                        3. <strong>{t('场景适配')}</strong>
                        {t('：封面用最高质量模型，次要页用最快模型，内容页平衡质量与速度')}
                      </p>
                      <p className="mt-2 text-blue-600 dark:text-blue-400">
                        {t('选择"自动选择"时使用上述策略，也可以手动为每种页面类型指定固定模型。')}
                      </p>
                    </div>
                  )}

                  {settings.imageGeneration.routing[settings.imageGeneration.activeProvider]
                    ?.enabled && (
                    <div className="space-y-3">
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-xs text-slate-500 dark:text-slate-400 border-b border-blue-200 dark:border-blue-800">
                              <th className="text-left py-2 pr-3 font-medium w-28">
                                {t('页面类型')}
                              </th>
                              <th className="text-left py-2 px-3 font-medium">{t('使用模型')}</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-blue-100 dark:divide-blue-900/30">
                            {[
                              {
                                key: 'cover' as const,
                                name: '封面',
                                icon: Image,
                                desc: t('首页封面，优先高质量'),
                              },
                              {
                                key: 'content' as const,
                                name: '内容页',
                                icon: FileText,
                                desc: t('图文内容页，平衡质量与速度'),
                              },
                              {
                                key: 'secondary' as const,
                                name: '次要页',
                                icon: Layers,
                                desc: t('目录/卡片/对比/时间线/表格/总结，优先速度'),
                              },
                            ].map(({ key, name, icon: Icon, desc }) => {
                              const routing =
                                settings.imageGeneration.routing[
                                  settings.imageGeneration.activeProvider
                                ];
                              const currentIndex =
                                routing?.[
                                  `${key}ModelIndex` as
                                    'coverModelIndex' | 'contentModelIndex' | 'secondaryModelIndex'
                                ];
                              const hasManual = currentIndex !== undefined && currentIndex >= 0;
                              return (
                                <tr key={key}>
                                  <td className="py-2.5 pr-3">
                                    <div className="flex items-center gap-2">
                                      <Icon className="w-4 h-4 text-slate-500 dark:text-slate-400 flex-shrink-0" />
                                      <div>
                                        <div className="font-medium text-slate-700 dark:text-slate-300">
                                          {name}
                                        </div>
                                        <div className="text-[11px] text-slate-500 dark:text-slate-400">
                                          {desc}
                                        </div>
                                      </div>
                                    </div>
                                  </td>
                                  <td className="py-2.5 px-3">
                                    <select
                                      className="w-full px-2.5 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                      value={hasManual ? String(currentIndex) : 'auto'}
                                      onChange={(e) => {
                                        const val = e.target.value;
                                        const field = `${key}ModelIndex` as
                                          | 'coverModelIndex'
                                          | 'contentModelIndex'
                                          | 'secondaryModelIndex';
                                        if (val === 'auto') {
                                          settings.setImageRoutingConfig(
                                            settings.imageGeneration.activeProvider,
                                            { [field]: undefined },
                                          );
                                        } else {
                                          settings.setImageRoutingConfig(
                                            settings.imageGeneration.activeProvider,
                                            { [field]: parseInt(val, 10) },
                                          );
                                        }
                                      }}
                                    >
                                      <option value="auto">{t('自动选择（推荐）')}</option>
                                      {(activeImageProvider?.models || []).map((m, i) => (
                                        <option key={i} value={String(i)}>
                                          {m.modelName}
                                        </option>
                                      ))}
                                    </select>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 px-0.5">
                        {t(
                          '次要页包含：目录、卡片、对比、时间线、表格、总结页。这些页面通常不需要配图，或配图质量要求较低。',
                        )}
                      </p>
                    </div>
                  )}

                  {!settings.imageGeneration.routing[settings.imageGeneration.activeProvider]
                    ?.enabled && (
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {t(
                        '启用后将根据页面类型自动选择最合适的图片模型。关闭时所有页面统一使用默认模型（第一个）。',
                      )}
                    </p>
                  )}
                </div>

                {/* 测试连接 */}
                <div className="pt-3 border-t border-slate-200 dark:border-slate-700">
                  <div className="flex items-center gap-3">
                    <button
                      onClick={handleImageTestConnection}
                      disabled={
                        imageTesting ||
                        (settings.imageGeneration.activeProvider !== 'ollama' &&
                        settings.imageGeneration.useDefaultApiKey
                          ? !settings.hasApiKey()
                          : !activeImageProvider?.apiKey &&
                            settings.imageGeneration.activeProvider !== 'ollama') ||
                        !activeImageProvider?.models?.length ||
                        !activeImageProvider?.models?.[0]?.modelName
                      }
                      className="px-4 py-2 border border-slate-300 dark:border-slate-600 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {imageTesting ? t('测试中...') : t('测试连接')}
                    </button>
                    {imageTestResult === 'success' && (
                      <span className="flex items-center gap-1 text-sm text-green-600 dark:text-green-400">
                        <Check className="w-4 h-4" />
                        {t('连接成功')}
                      </span>
                    )}
                    {imageTestResult === 'error' && (
                      <span className="flex items-center gap-1 text-sm text-red-600 dark:text-red-400">
                        <AlertCircle className="w-4 h-4" />
                        {t('连接失败')}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
                    <Info className="w-3.5 h-3.5 inline mr-1 -mt-0.5" />
                    {t('将测试默认配置：模型')}
                    <code className="px-1 bg-slate-100 dark:bg-slate-700 rounded font-mono">
                      {activeImageProvider?.models?.[0]?.modelName || t('(未配置模型)')}
                    </code>
                    {activeImageProvider?.models?.[0]?.sizes?.[0] && (
                      <span>
                        {t('，尺寸')}
                        <code className="px-1 bg-slate-100 dark:bg-slate-700 rounded font-mono">
                          {activeImageProvider.models[0].sizes[0].width}×
                          {activeImageProvider.models[0].sizes[0].height}
                        </code>
                      </span>
                    )}
                    {activeImageProvider?.models && activeImageProvider.models.length > 1 && (
                      <span>
                        {t('，共配置')}
                        {activeImageProvider.models.length}
                        {t('个模型')}
                      </span>
                    )}
                  </p>
                </div>
                {imageTestError && (
                  <div
                    className={`mt-2 p-3 border rounded-lg ${
                      imageTestIsCors
                        ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800'
                        : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
                    }`}
                  >
                    {imageTestIsCors ? (
                      <>
                        <p className="text-sm font-medium text-amber-800 dark:text-amber-300 flex items-center gap-2">
                          <AlertCircle className="w-4 h-4" />
                          {t('跨域访问受限（CORS）')}
                        </p>
                        <p className="text-xs text-amber-700 dark:text-amber-400 mt-2">
                          {t('浏览器安全策略阻止了前端直接调用该 API')}
                        </p>
                        <p className="text-xs text-amber-600 dark:text-amber-500 mt-2 font-mono break-all">
                          {imageTestError}
                        </p>
                      </>
                    ) : (
                      <p className="text-xs text-red-700 dark:text-red-400 font-mono whitespace-pre-wrap break-all">
                        {imageTestError}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </section>

      {/* 隐私提示 */}
      <section className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-5">
        <div className="flex gap-3">
          <div className="p-2 bg-blue-100 dark:bg-blue-900/50 rounded-lg shrink-0">
            <Info className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <h3 className="font-medium text-blue-900 dark:text-blue-300 mb-1">
              {t('数据隐私说明')}
            </h3>
            <p className="text-sm text-blue-800 dark:text-blue-400 leading-relaxed">
              {t(
                'NoPPT 采用本地优先策略，所有演示文稿数据和设置都保存在本地，不会上传到任何服务器。\n              仅在使用 AI 生成功能时，您输入的内容会发送到配置的模型 API 服务商。请选择可信的服务提供商。',
              )}
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
