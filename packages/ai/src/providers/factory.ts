import type { ModelConfig } from '../types';
import { OpenAIProvider } from './openai';
import { AnthropicProvider } from './anthropic';
import { FreeAIProvider } from './freeai';
import { V0Provider } from './v0';
import type { AIModelProvider } from './base';

export function createChatProvider(config: ModelConfig): AIModelProvider {
  switch (config.provider) {
    case 'anthropic':
      return new AnthropicProvider(config);
    case 'freeai':
      return new FreeAIProvider(config);
    case 'v0':
      return new V0Provider(config);
    case 'openai':
    case 'company-gateway':
    case 'ollama':
    case 'custom':
    default:
      return new OpenAIProvider(config);
  }
}
