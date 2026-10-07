import { useState } from 'react';
import { OpenAIProvider, FreeAIProvider, AnthropicProvider } from '@noppt/ai/providers';
import { useSettingsStore } from '@/stores';
import { isCorsError } from './utils';

interface TestConnectionState {
  testing: boolean;
  testResult: 'success' | 'error' | null;
  /** 失败时的原始错误信息（用于 UI 展示，便于定位是 CORS / 401 / 404 等） */
  testError: string | null;
  /** 失败是否由浏览器跨域（CORS）导致 */
  isCors: boolean;
}

export function useTestConnection() {
  const settings = useSettingsStore();

  const [connectionState, setConnectionState] = useState<TestConnectionState>({
    testing: false,
    testResult: null,
    testError: null,
    isCors: false,
  });

  const testConnection = async () => {
    setConnectionState((prev) => ({
      ...prev,
      testing: true,
      testResult: null,
      testError: null,
      isCors: false,
    }));

    try {
      const providerConfig = settings.apiConfig[settings.defaultModelProvider];
      const testModel = providerConfig.models[0] || '';

      if (settings.defaultModelProvider === 'v0') {
        const response = await fetch(`${providerConfig.baseUrl}/user`, {
          headers: {
            Authorization: `Bearer ${providerConfig.apiKey}`,
          },
        });
        setConnectionState((prev) => ({
          ...prev,
          testResult: response.ok ? 'success' : 'error',
          testError: response.ok ? null : `HTTP ${response.status} ${response.statusText}`,
        }));
      } else if (settings.defaultModelProvider === 'freeai') {
        const provider = new FreeAIProvider({
          apiKey: providerConfig.apiKey,
          baseUrl: providerConfig.baseUrl,
          model: testModel,
        });
        // 直接调用 chat() 而非 validateConfig()：后者会吞掉异常只返回 false，拿不到真实错误。
        await provider.chat([{ role: 'user', content: 'hi' }], { maxTokens: 5 });
        setConnectionState((prev) => ({
          ...prev,
          testResult: 'success',
        }));
      } else if (settings.defaultModelProvider === 'anthropic') {
        const provider = new AnthropicProvider({
          apiKey: providerConfig.apiKey,
          baseUrl: providerConfig.baseUrl,
          model: testModel,
        });
        await provider.chat([{ role: 'user', content: 'hi' }], { maxTokens: 5 });
        setConnectionState((prev) => ({
          ...prev,
          testResult: 'success',
        }));
      } else {
        const provider = new OpenAIProvider({
          apiKey: providerConfig.apiKey,
          baseUrl: providerConfig.baseUrl,
          model: testModel,
          userCode: providerConfig.userCode || '',
        });
        await provider.chat([{ role: 'user', content: 'hi' }], { maxTokens: 5 });
        setConnectionState((prev) => ({
          ...prev,
          testResult: 'success',
        }));
      }
    } catch (e) {
      setConnectionState((prev) => ({
        ...prev,
        testResult: 'error',
        testError: e instanceof Error ? e.message : String(e),
        isCors: isCorsError(e),
      }));
    } finally {
      setConnectionState((prev) => ({
        ...prev,
        testing: false,
      }));
    }
  };

  return {
    ...connectionState,
    testConnection,
  };
}
