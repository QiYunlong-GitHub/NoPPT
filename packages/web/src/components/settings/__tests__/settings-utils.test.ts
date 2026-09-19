import { describe, it, expect } from 'vitest';
import {
  isCorsError,
  sanitizeConfigForExport,
  getDefaultModelPlaceholder,
  getApiKeyPlaceholder,
  getBaseUrlHint,
} from '../utils';

describe('isCorsError', () => {
  it('识别 TypeError: Failed to fetch 为 CORS 错误', () => {
    expect(isCorsError(new TypeError('Failed to fetch'))).toBe(true);
  });

  it('识别包含 Failed to fetch 的字符串为 CORS 错误', () => {
    expect(isCorsError('NetworkError: Failed to fetch (CORS)')).toBe(true);
  });

  it('非 Failed to fetch 的 TypeError 不是 CORS 错误', () => {
    expect(isCorsError(new TypeError('Cannot read properties of undefined'))).toBe(false);
  });

  it('普通 Error / null / undefined 不是 CORS 错误', () => {
    expect(isCorsError(new Error('boom'))).toBe(false);
    expect(isCorsError(null)).toBe(false);
    expect(isCorsError(undefined)).toBe(false);
  });
});

describe('sanitizeConfigForExport', () => {
  const buildConfig = () => ({
    apiConfig: {
      openai: { apiKey: 'sk-secret-openai', baseUrl: 'https://api.openai.com' },
      anthropic: { apiKey: 'sk-secret-anthropic' },
    },
    imageGeneration: {
      activeProvider: 'openai',
      providers: {
        openai: { apiKey: 'img-secret', model: 'dall-e-3' },
      },
    },
    other: 'keep-me',
  });

  it('清空 apiConfig 下每个 provider 的 apiKey', () => {
    const cfg = buildConfig();
    const out = sanitizeConfigForExport(cfg);
    expect(out.apiConfig.openai.apiKey).toBe('');
    expect(out.apiConfig.anthropic.apiKey).toBe('');
  });

  it('清空 imageGeneration.providers 下每个 provider 的 apiKey', () => {
    const cfg = buildConfig();
    const out = sanitizeConfigForExport(cfg);
    expect(out.imageGeneration.providers.openai.apiKey).toBe('');
  });

  it('保留非密钥字段（baseUrl / model / other）', () => {
    const cfg = buildConfig();
    const out = sanitizeConfigForExport(cfg);
    expect(out.apiConfig.openai.baseUrl).toBe('https://api.openai.com');
    expect(out.imageGeneration.providers.openai.model).toBe('dall-e-3');
    expect(out.other).toBe('keep-me');
  });

  it('不修改入参原对象（深一层不被污染）', () => {
    const cfg = buildConfig();
    sanitizeConfigForExport(cfg);
    expect(cfg.apiConfig.openai.apiKey).toBe('sk-secret-openai');
    expect(cfg.imageGeneration.providers.openai.apiKey).toBe('img-secret');
  });

  it('无 apiConfig / imageGeneration 时原样返回', () => {
    const cfg = { theme: 'dark' as const };
    const out = sanitizeConfigForExport(cfg);
    expect(out).toEqual({ theme: 'dark' });
  });
});

describe('getDefaultModelPlaceholder', () => {
  it('各 provider 返回对应示例', () => {
    expect(getDefaultModelPlaceholder('freeai')).toContain('qwen7b');
    expect(getDefaultModelPlaceholder('v0')).toContain('v0-1.5-md');
    expect(getDefaultModelPlaceholder('anthropic')).toContain('claude-3-5-sonnet');
    expect(getDefaultModelPlaceholder('ollama')).toContain('llama3.1');
    expect(getDefaultModelPlaceholder('company-gateway')).toContain('公司网关');
  });

  it('未知 provider 回退到通用示例', () => {
    expect(getDefaultModelPlaceholder('openai')).toContain('gpt-4o-mini');
    expect(getDefaultModelPlaceholder('whatever')).toContain('gpt-4o-mini');
  });
});

describe('getApiKeyPlaceholder', () => {
  it('freeai / v0 有专属占位，其余回退 sk-...', () => {
    expect(getApiKeyPlaceholder('freeai')).toBe('sk-free-...');
    expect(getApiKeyPlaceholder('v0')).toBe('v0_...');
    expect(getApiKeyPlaceholder('openai')).toBe('sk-...');
    expect(getApiKeyPlaceholder('anthropic')).toBe('sk-...');
  });
});

describe('getBaseUrlHint', () => {
  it('各 provider 返回对应提示文案', () => {
    expect(getBaseUrlHint('freeai')).toContain('Free.ai');
    expect(getBaseUrlHint('v0')).toContain('v0 Platform');
    expect(getBaseUrlHint('anthropic')).toContain('Anthropic');
    expect(getBaseUrlHint('ollama')).toContain('localhost:11434');
    expect(getBaseUrlHint('company-gateway')).toContain('网关');
  });

  it('未知 provider 回退到 OpenAI 兼容提示', () => {
    expect(getBaseUrlHint('openai')).toContain('OpenAI 兼容');
  });
});
