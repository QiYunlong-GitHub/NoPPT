export function isCorsError(error: unknown): boolean {
  if (error instanceof TypeError && error.message === 'Failed to fetch') {
    return true;
  }
  if (typeof error === 'string' && error.includes('Failed to fetch')) {
    return true;
  }
  return false;
}

export function sanitizeConfigForExport(config: any): any {
  const sanitized = { ...config };
  if (sanitized.apiConfig) {
    sanitized.apiConfig = {};
    for (const key of Object.keys(config.apiConfig)) {
      sanitized.apiConfig[key] = {
        ...config.apiConfig[key],
        apiKey: '',
      };
    }
  }
  if (sanitized.imageGeneration && sanitized.imageGeneration.providers) {
    sanitized.imageGeneration = {
      ...sanitized.imageGeneration,
      providers: { ...sanitized.imageGeneration.providers },
    };
    for (const key of Object.keys(sanitized.imageGeneration.providers)) {
      sanitized.imageGeneration.providers[key] = {
        ...sanitized.imageGeneration.providers[key],
        apiKey: '',
      };
    }
  }
  return sanitized;
}

export function getDefaultModelPlaceholder(provider: string): string {
  switch (provider) {
    case 'freeai': return '例如：qwen7b、qwen-coder、openai/gpt-4o-mini';
    case 'v0': return '例如：v0-1.5-md';
    case 'anthropic': return '例如：claude-3-5-sonnet-20241022';
    case 'ollama': return '例如：llama3.1';
    case 'company-gateway': return '请输入公司网关模型名称';
    default: return '例如：gpt-4o-mini';
  }
}

export function getApiKeyPlaceholder(provider: string): string {
  switch (provider) {
    case 'freeai': return 'sk-free-...';
    case 'v0': return 'v0_...';
    default: return 'sk-...';
  }
}

export function getBaseUrlHint(provider: string): string {
  switch (provider) {
    case 'freeai': return 'Free.ai API 地址，默认为官方地址';
    case 'v0': return 'v0 Platform API 地址，默认为官方地址';
    case 'anthropic': return 'Anthropic API 地址，默认为官方地址，也可配置兼容代理地址';
    case 'ollama': return 'Ollama 本地服务地址，默认 http://localhost:11434/v1';
    case 'company-gateway': return '公司内网 API 网关地址，格式：https://{网关域名}/ai-api';
    default: return '支持 OpenAI 兼容接口，可配置第三方代理地址';
  }
}
