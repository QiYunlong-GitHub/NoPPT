import { useState } from 'react';
import { useSettingsStore } from '@/stores/settings';
import { t } from '@/i18n';
import { isCorsError } from './utils';
import { bindAIModelSettingsHandlers } from './AIModelSettings.handlers';
import { OpenAIProvider, FreeAIProvider, AnthropicProvider, QwenImageProvider, SeedreamProvider } from '@noppt/ai';
import { LlmProviderSection } from './aimodel-sections/LlmProviderSection';
import { ProviderConfigSection } from './aimodel-sections/ProviderConfigSection';
import { RoutingSection } from './aimodel-sections/RoutingSection';
import { InlineSelfCheckSection } from './aimodel-sections/InlineSelfCheckSection';
import { AuditSettingsSection } from './aimodel-sections/AuditSettingsSection';
import { ImageProviderSection } from './aimodel-sections/ImageProviderSection';

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
  const handlers = bindAIModelSettingsHandlers(settings);
  const [imageTesting, setImageTesting] = useState(false);
  const [imageTestResult, setImageTestResult] = useState<'success' | 'error' | null>(null);
  const [imageTestError, setImageTestError] = useState<string | null>(null);
  const [imageTestIsCors, setImageTestIsCors] = useState(false);
  const [showRoutingHelp, setShowRoutingHelp] = useState<string | null>(null);

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

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        <LlmProviderSection settings={settings} />
        <ProviderConfigSection
          settings={settings}
          handlers={handlers}
          onTestConnection={onTestConnection}
          testing={testing}
          testResult={testResult}
        />
        <RoutingSection
          handlers={handlers}
          showRoutingHelp={showRoutingHelp}
          setShowRoutingHelp={setShowRoutingHelp}
        />
        <InlineSelfCheckSection settings={settings} />
        <AuditSettingsSection settings={settings} />
        <ImageProviderSection
          settings={settings}
          handlers={handlers}
          showRoutingHelp={showRoutingHelp}
          setShowRoutingHelp={setShowRoutingHelp}
          imageTesting={imageTesting}
          imageTestResult={imageTestResult}
          imageTestError={imageTestError}
          imageTestIsCors={imageTestIsCors}
          onImageTestConnection={handleImageTestConnection}
        />
        <section className="bg-blue-50 dark:bg-slate-800 rounded-xl shadow-sm border border-blue-200 dark:border-slate-700">
          <div className="px-6 py-4">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white mb-2">
              {t('隐私提示')}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              {t(
                '所有 AI 配置（API Key、模型名称等）仅保存在您的浏览器本地存储中，不会上传到服务器。您的演示内容会通过 NoPPT 后端调用 AI 服务生成。',
              )}
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
