// AIModelSettings 内联 handler 外置（Phase 6 抽取，零行为变更）。
//
// 原组件把这些 handler 定义为依赖组件作用域 `settings` / `providerConfig` /
// `activeImageProvider` 的闭包。此处改为「显式接收 settings 参数的纯函数」，
// 函数名完全保留；组件侧通过 `bindAIModelSettingsHandlers(settings)` 一次性
// 解构回原名字，JSX 调用面零改动。
import { t } from '@/i18n';
import { useSettingsStore } from '@/stores/settings';

type SettingsState = ReturnType<typeof useSettingsStore.getState>;

export type RoutingStageKey = 'planning' | 'content' | 'editing' | 'audit' | 'auditVlm';

function getProviderConfig(settings: SettingsState) {
  return settings.apiConfig[settings.defaultModelProvider];
}

function getActiveImageProvider(settings: SettingsState) {
  return settings.imageGeneration.providers[settings.imageGeneration.activeProvider];
}

export function buildModelOptions(settings: SettingsState) {
  const options: Array<{ value: string; label: string; disabled: boolean; disabledReason?: string }> = [];
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
}

export function getRoutingValue(settings: SettingsState, stage: RoutingStageKey): string {
  const modelOptions = buildModelOptions(settings);
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
}

export function handleRoutingChange(settings: SettingsState, stage: RoutingStageKey, value: string) {
  const [provider, modelIndexStr] = value.split(':');
  const modelIndex = parseInt(modelIndexStr, 10);
  if (provider && !isNaN(modelIndex)) {
    settings.updateModelRouting({
      [stage]: { provider: provider as any, modelIndex },
    });
  }
}

export function handleProviderConfigChange(
  settings: SettingsState,
  key: 'apiKey' | 'baseUrl',
  value: string,
) {
  const updateFn = {
    openai: settings.updateOpenAIConfig,
    anthropic: settings.updateAnthropicConfig,
    ollama: settings.updateOllamaConfig,
    freeai: settings.updateFreeAIConfig,
    v0: settings.updateV0Config,
    'company-gateway': settings.updateCompanyGatewayConfig,
  }[settings.defaultModelProvider];
  updateFn?.({ [key]: value } as any);
}

export function addTextModel(settings: SettingsState) {
  const updateFn = {
    openai: settings.updateOpenAIConfig,
    anthropic: settings.updateAnthropicConfig,
    ollama: settings.updateOllamaConfig,
    freeai: settings.updateFreeAIConfig,
    v0: settings.updateV0Config,
    'company-gateway': settings.updateCompanyGatewayConfig,
  }[settings.defaultModelProvider];
  const currentModels = [...(getProviderConfig(settings).models || [])];
  currentModels.push('');
  updateFn?.({ models: currentModels } as any);
}

export function removeTextModel(settings: SettingsState, index: number) {
  const updateFn = {
    openai: settings.updateOpenAIConfig,
    anthropic: settings.updateAnthropicConfig,
    ollama: settings.updateOllamaConfig,
    freeai: settings.updateFreeAIConfig,
    v0: settings.updateV0Config,
    'company-gateway': settings.updateCompanyGatewayConfig,
  }[settings.defaultModelProvider];
  const currentModels = [...(getProviderConfig(settings).models || [])];
  currentModels.splice(index, 1);
  if (currentModels.length === 0) currentModels.push('');
  updateFn?.({ models: currentModels } as any);
}

export function updateTextModel(settings: SettingsState, index: number, value: string) {
  const updateFn = {
    openai: settings.updateOpenAIConfig,
    anthropic: settings.updateAnthropicConfig,
    ollama: settings.updateOllamaConfig,
    freeai: settings.updateFreeAIConfig,
    v0: settings.updateV0Config,
    'company-gateway': settings.updateCompanyGatewayConfig,
  }[settings.defaultModelProvider];
  const currentModels = [...(getProviderConfig(settings).models || [])];
  currentModels[index] = value;
  updateFn?.({ models: currentModels } as any);
}

export function setTextModelAsDefault(settings: SettingsState, index: number) {
  if (index === 0) return;
  const updateFn = {
    openai: settings.updateOpenAIConfig,
    anthropic: settings.updateAnthropicConfig,
    ollama: settings.updateOllamaConfig,
    freeai: settings.updateFreeAIConfig,
    v0: settings.updateV0Config,
    'company-gateway': settings.updateCompanyGatewayConfig,
  }[settings.defaultModelProvider];
  const currentModels = [...(getProviderConfig(settings).models || [])];
  const [movedModel] = currentModels.splice(index, 1);
  currentModels.unshift(movedModel);
  updateFn?.({ models: currentModels } as any);
}

export function updateActiveImageProvider(settings: SettingsState, config: any) {
  settings.updateImageProviderConfig(settings.imageGeneration.activeProvider, config);
}

export function addImageModel(settings: SettingsState) {
  const newModel = {
    modelName: '',
    sizes: [{ width: 1024, height: 1024, label: '1024×1024' }],
  };
  const currentModels = [...(getActiveImageProvider(settings).models || [])];
  currentModels.push(newModel);
  updateActiveImageProvider(settings, { models: currentModels });
}

export function removeImageModel(settings: SettingsState, modelIndex: number) {
  const currentModels = [...(getActiveImageProvider(settings).models || [])];
  currentModels.splice(modelIndex, 1);
  updateActiveImageProvider(settings, { models: currentModels });
}

export function updateImageModelName(settings: SettingsState, modelIndex: number, modelName: string) {
  const currentModels = [...(getActiveImageProvider(settings).models || [])];
  currentModels[modelIndex] = { ...currentModels[modelIndex], modelName };
  updateActiveImageProvider(settings, { models: currentModels });
}

export function setImageModelAsDefault(settings: SettingsState, modelIndex: number) {
  if (modelIndex === 0) return;
  const currentModels = [...(getActiveImageProvider(settings).models || [])];
  const [movedModel] = currentModels.splice(modelIndex, 1);
  currentModels.unshift(movedModel);
  updateActiveImageProvider(settings, { models: currentModels });
}

export function addImageSize(settings: SettingsState, modelIndex: number) {
  const currentModels = [...(getActiveImageProvider(settings).models || [])];
  const model = { ...currentModels[modelIndex] };
  model.sizes = [...(model.sizes || []), { width: 1024, height: 1024, label: '1024×1024' }];
  currentModels[modelIndex] = model;
  updateActiveImageProvider(settings, { models: currentModels });
}

export function removeImageSize(settings: SettingsState, modelIndex: number, sizeIndex: number) {
  const currentModels = [...(getActiveImageProvider(settings).models || [])];
  const model = { ...currentModels[modelIndex] };
  model.sizes = [...(model.sizes || [])];
  model.sizes.splice(sizeIndex, 1);
  if (model.sizes.length === 0) model.sizes = [{ width: 1024, height: 1024, label: '1024×1024' }];
  currentModels[modelIndex] = model;
  updateActiveImageProvider(settings, { models: currentModels });
}

export function updateImageSize(
  settings: SettingsState,
  modelIndex: number,
  sizeIndex: number,
  field: 'width' | 'height',
  value: number,
) {
  const currentModels = [...(getActiveImageProvider(settings).models || [])];
  const model = { ...currentModels[modelIndex] };
  model.sizes = [...(model.sizes || [])];
  const size = { ...model.sizes[sizeIndex] };
  size[field] = value;
  size.label = `${size.width}×${size.height}`;
  model.sizes[sizeIndex] = size;
  currentModels[modelIndex] = model;
  updateActiveImageProvider(settings, { models: currentModels });
}

export function addPixelRange(settings: SettingsState, modelIndex: number) {
  const currentModels = [...(getActiveImageProvider(settings).models || [])];
  const model = { ...currentModels[modelIndex] };
  if ((model.pixelRanges?.length || 0) >= 1) {
    return;
  }
  model.pixelRanges = [
    ...(model.pixelRanges || []),
    { minPixels: 0, maxPixels: 1024 * 1024, label: t('标准') },
  ];
  currentModels[modelIndex] = model;
  updateActiveImageProvider(settings, { models: currentModels });
}

export function removePixelRange(settings: SettingsState, modelIndex: number, rangeIndex: number) {
  const currentModels = [...(getActiveImageProvider(settings).models || [])];
  const model = { ...currentModels[modelIndex] };
  model.pixelRanges = [...(model.pixelRanges || [])];
  model.pixelRanges.splice(rangeIndex, 1);
  currentModels[modelIndex] = model;
  updateActiveImageProvider(settings, { models: currentModels });
}

export function updatePixelRange(
  settings: SettingsState,
  modelIndex: number,
  rangeIndex: number,
  field: 'minPixels' | 'maxPixels' | 'label',
  value: number | string,
) {
  const currentModels = [...(getActiveImageProvider(settings).models || [])];
  const model = { ...currentModels[modelIndex] };
  model.pixelRanges = [...(model.pixelRanges || [])];
  const range = { ...model.pixelRanges[rangeIndex] };
  (range as any)[field] = value;
  model.pixelRanges[rangeIndex] = range;
  currentModels[modelIndex] = model;
  updateActiveImageProvider(settings, { models: currentModels });
}

export function selectImageProvider(
  settings: SettingsState,
  provider: SettingsState['imageGeneration']['activeProvider'],
) {
  settings.updateImageGeneration({ activeProvider: provider });
}

export function bindAIModelSettingsHandlers(settings: SettingsState) {
  return {
    buildModelOptions: () => buildModelOptions(settings),
    getRoutingValue: (stage: RoutingStageKey) => getRoutingValue(settings, stage),
    handleRoutingChange: (stage: RoutingStageKey, value: string) =>
      handleRoutingChange(settings, stage, value),
    handleProviderConfigChange: (key: 'apiKey' | 'baseUrl', value: string) =>
      handleProviderConfigChange(settings, key, value),
    addTextModel: () => addTextModel(settings),
    removeTextModel: (index: number) => removeTextModel(settings, index),
    updateTextModel: (index: number, value: string) => updateTextModel(settings, index, value),
    setTextModelAsDefault: (index: number) => setTextModelAsDefault(settings, index),
    updateActiveImageProvider: (config: any) => updateActiveImageProvider(settings, config),
    addImageModel: () => addImageModel(settings),
    removeImageModel: (modelIndex: number) => removeImageModel(settings, modelIndex),
    updateImageModelName: (modelIndex: number, modelName: string) =>
      updateImageModelName(settings, modelIndex, modelName),
    setImageModelAsDefault: (modelIndex: number) => setImageModelAsDefault(settings, modelIndex),
    addImageSize: (modelIndex: number) => addImageSize(settings, modelIndex),
    removeImageSize: (modelIndex: number, sizeIndex: number) =>
      removeImageSize(settings, modelIndex, sizeIndex),
    updateImageSize: (
      modelIndex: number,
      sizeIndex: number,
      field: 'width' | 'height',
      value: number,
    ) => updateImageSize(settings, modelIndex, sizeIndex, field, value),
    addPixelRange: (modelIndex: number) => addPixelRange(settings, modelIndex),
    removePixelRange: (modelIndex: number, rangeIndex: number) =>
      removePixelRange(settings, modelIndex, rangeIndex),
    updatePixelRange: (
      modelIndex: number,
      rangeIndex: number,
      field: 'minPixels' | 'maxPixels' | 'label',
      value: number | string,
    ) => updatePixelRange(settings, modelIndex, rangeIndex, field, value),
    selectImageProvider: (provider: SettingsState['imageGeneration']['activeProvider']) =>
      selectImageProvider(settings, provider),
    providerConfig: getProviderConfig(settings),
    activeImageProvider: getActiveImageProvider(settings),
  };
}
