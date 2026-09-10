import { useState } from 'react';
import {
  OpenAIProvider,
  FreeAIProvider,
  AnthropicProvider,
} from '@noppt/ai';
import { useSettingsStore } from '@/stores';

interface TestConnectionState {
  testing: boolean;
  testResult: 'success' | 'error' | null;
}

export function useTestConnection() {
  const settings = useSettingsStore();
  
  const [connectionState, setConnectionState] = useState<TestConnectionState>({
    testing: false,
    testResult: null,
  });

  const testConnection = async () => {
    setConnectionState((prev) => ({
      ...prev,
      testing: true,
      testResult: null,
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
        }));
      } else if (settings.defaultModelProvider === 'freeai') {
        const provider = new FreeAIProvider({
          apiKey: providerConfig.apiKey,
          baseUrl: providerConfig.baseUrl,
          model: testModel,
        });
        const valid = await provider.validateConfig();
        setConnectionState((prev) => ({
          ...prev,
          testResult: valid ? 'success' : 'error',
        }));
      } else if (settings.defaultModelProvider === 'anthropic') {
        const provider = new AnthropicProvider({
          apiKey: providerConfig.apiKey,
          baseUrl: providerConfig.baseUrl,
          model: testModel,
        });
        const valid = await provider.validateConfig();
        setConnectionState((prev) => ({
          ...prev,
          testResult: valid ? 'success' : 'error',
        }));
      } else {
        const provider = new OpenAIProvider({
          apiKey: providerConfig.apiKey,
          baseUrl: providerConfig.baseUrl,
          model: testModel,
        });
        const valid = await provider.validateConfig();
        setConnectionState((prev) => ({
          ...prev,
          testResult: valid ? 'success' : 'error',
        }));
      }
    } catch {
      setConnectionState((prev) => ({
        ...prev,
        testResult: 'error',
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
