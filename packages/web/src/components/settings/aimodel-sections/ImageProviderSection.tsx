import { t } from '@/i18n';
import { Sparkles, Check, AlertCircle, Info } from 'lucide-react';
import { imageProviders } from '../constants';
import type { AIModelSettingsStore, AIModelHandlers } from './types';
import { ImageModelList } from './ImageModelSection';
import { ImageRoutingConfig } from './ImageRoutingSection';

interface ImageProviderSectionProps {
  settings: AIModelSettingsStore;
  handlers: AIModelHandlers;
  showRoutingHelp: string | null;
  setShowRoutingHelp: (key: string | null) => void;
  imageTesting: boolean;
  imageTestResult: 'success' | 'error' | null;
  imageTestError: string | null;
  imageTestIsCors: boolean;
  onImageTestConnection: () => Promise<void>;
}

export function ImageProviderSection({
  settings,
  handlers,
  showRoutingHelp,
  setShowRoutingHelp,
  imageTesting,
  imageTestResult,
  imageTestError,
  imageTestIsCors,
  onImageTestConnection,
}: ImageProviderSectionProps) {
  const { updateActiveImageProvider, selectImageProvider, activeImageProvider } = handlers;
  return (
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
            <ImageProviderSelector settings={settings} handlers={handlers} />

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

              <ImageProviderApiFields
                settings={settings}
                activeImageProvider={activeImageProvider}
                updateActiveImageProvider={updateActiveImageProvider}
              />
              <ImageModelList
                settings={settings}
                activeImageProvider={activeImageProvider}
                handlers={handlers}
              />
              <ImageRoutingConfig
                settings={settings}
                activeImageProvider={activeImageProvider}
                showRoutingHelp={showRoutingHelp}
                setShowRoutingHelp={setShowRoutingHelp}
              />
              <ImageTestConnection
                settings={settings}
                activeImageProvider={activeImageProvider}
                onImageTestConnection={onImageTestConnection}
                imageTesting={imageTesting}
                imageTestResult={imageTestResult}
                imageTestError={imageTestError}
                imageTestIsCors={imageTestIsCors}
              />
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function ImageProviderSelector({
  settings,
  handlers,
}: {
  settings: AIModelSettingsStore;
  handlers: AIModelHandlers;
}) {
  const { selectImageProvider } = handlers;
  return (
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
    </>
  );
}

function ImageProviderApiFields({
  settings,
  activeImageProvider,
  updateActiveImageProvider,
}: {
  settings: AIModelSettingsStore;
  activeImageProvider: AIModelHandlers['activeImageProvider'];
  updateActiveImageProvider: AIModelHandlers['updateActiveImageProvider'];
}) {
  return (
    <>
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
    </>
  );
}

function ImageTestConnection({
  settings,
  activeImageProvider,
  onImageTestConnection,
  imageTesting,
  imageTestResult,
  imageTestError,
  imageTestIsCors,
}: {
  settings: AIModelSettingsStore;
  activeImageProvider: AIModelHandlers['activeImageProvider'];
  onImageTestConnection: () => Promise<void>;
  imageTesting: boolean;
  imageTestResult: 'success' | 'error' | null;
  imageTestError: string | null;
  imageTestIsCors: boolean;
}) {
  return (
    <>
      {/* 测试连接 */}
      <div className="pt-3 border-t border-slate-200 dark:border-slate-700">
        <div className="flex items-center gap-3">
          <button
            onClick={onImageTestConnection}
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
    </>
  );
}
