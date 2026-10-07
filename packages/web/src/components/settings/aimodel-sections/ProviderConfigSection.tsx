import { t } from '@/i18n';
import { Plus, X, Check, AlertCircle, Info, Star } from 'lucide-react';
import { modelProviders, quickModelOptions } from '../constants';
import { getApiKeyPlaceholder, getBaseUrlHint, getDefaultModelPlaceholder } from '../utils';
import type { AIModelSettingsStore, AIModelHandlers } from './types';

interface ProviderConfigSectionProps {
  settings: AIModelSettingsStore;
  handlers: AIModelHandlers;
  onTestConnection: () => Promise<void>;
  testing: boolean;
  testResult: 'success' | 'error' | null;
  /** 测试连接失败时的原始错误信息（可选，缺省不展示） */
  testError?: string | null;
  /** 失败是否为浏览器跨域（CORS）导致 */
  isCors?: boolean;
}

function ProviderModelList({
  settings,
  handlers,
}: {
  settings: AIModelSettingsStore;
  handlers: AIModelHandlers;
}) {
  const {
    providerConfig,
    handleProviderConfigChange,
    addTextModel,
    updateTextModel,
    setTextModelAsDefault,
    removeTextModel,
  } = handlers;
  return (
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
        {settings.defaultModelProvider === 'company-gateway' && t('，配置文件中模型用分号(;)分隔')}
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
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">{t('快速选择添加：')}</p>
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
  );
}

function ProviderTestConnection({
  settings,
  handlers,
  onTestConnection,
  testing,
  testResult,
  testError,
  isCors,
}: ProviderConfigSectionProps) {
  const { providerConfig } = handlers;
  return (
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
      {testError && (
        <div
          className={`mt-2 p-3 border rounded-lg ${
            isCors
              ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800'
              : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
          }`}
        >
          {isCors ? (
            <>
              <p className="text-sm font-medium text-amber-800 dark:text-amber-300 flex items-center gap-2">
                <AlertCircle className="w-4 h-4" />
                {t('跨域访问受限（CORS）')}
              </p>
              <p className="text-xs text-amber-700 dark:text-amber-400 mt-2">
                {t('浏览器安全策略阻止了前端直接调用该 API')}
              </p>
              {settings.defaultModelProvider === 'company-gateway' && (
                <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
                  {t('实际生成由服务端发起，不受浏览器跨域限制，仍可正常出片')}
                </p>
              )}
              <p className="text-xs text-amber-600 dark:text-amber-500 mt-2 font-mono break-all">
                {testError}
              </p>
            </>
          ) : (
            <p className="text-xs text-red-700 dark:text-red-400 font-mono whitespace-pre-wrap break-all">
              {testError}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function ProviderConfigSection({
  settings,
  handlers,
  onTestConnection,
  testing,
  testResult,
  testError,
  isCors,
}: ProviderConfigSectionProps) {
  const { providerConfig, handleProviderConfigChange } = handlers;
  return (
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
              {settings.defaultModelProvider === 'company-gateway'
                ? t('域账号 / API Key')
                : t('API Key')}
            </label>
            {settings.defaultModelProvider === 'company-gateway' ? (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={providerConfig.userCode || ''}
                  onChange={(e) => handleProviderConfigChange('userCode', e.target.value)}
                  placeholder={t('域账号')}
                  className="w-1/5 px-3 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"
                />
                <input
                  type="password"
                  value={providerConfig.apiKey}
                  onChange={(e) => handleProviderConfigChange('apiKey', e.target.value)}
                  placeholder={getApiKeyPlaceholder(settings.defaultModelProvider)}
                  className="flex-1 px-3 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"
                />
              </div>
            ) : (
              <input
                type="password"
                value={providerConfig.apiKey}
                onChange={(e) => handleProviderConfigChange('apiKey', e.target.value)}
                placeholder={getApiKeyPlaceholder(settings.defaultModelProvider)}
                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"
              />
            )}
            {settings.defaultModelProvider === 'company-gateway' && (
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                {t('域账号将作为请求头 X-Sany-User-Code 随网关请求发送')}
              </p>
            )}
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
        <ProviderModelList settings={settings} handlers={handlers} />
        <ProviderTestConnection
          settings={settings}
          handlers={handlers}
          onTestConnection={onTestConnection}
          testing={testing}
          testResult={testResult}
          testError={testError}
          isCors={isCors}
        />
      </div>
    </section>
  );
}
