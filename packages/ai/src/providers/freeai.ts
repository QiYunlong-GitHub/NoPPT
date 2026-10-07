import { BaseProvider, formatMessages, truncate } from './base';
import type {
  ChatMessage,
  ChatOptions,
  ChatResponse,
  ModelConfig,
  ImageGenerationOptions,
  GeneratedImage,
} from '../types';
import { consumeSse } from './sse';
import {
  asResponseRecord,
  responseNumber,
  responseRecord,
  responseRecords,
  responseString,
} from './response-helpers';

export class FreeAIProvider extends BaseProvider {
  name = 'freeai';
  config: ModelConfig;

  constructor(config: Omit<ModelConfig, 'provider'>) {
    super();
    this.config = {
      ...config,
      provider: 'freeai',
    };
  }

  private getBaseUrl(): string {
    return this.config.baseUrl || 'https://api.free.ai/v1';
  }

  async chat(messages: ChatMessage[], options?: Partial<ChatOptions>): Promise<ChatResponse> {
    const opts = this.mergeOptions(options);
    const baseUrl = this.getBaseUrl();

    this.logRequest('chat', {
      endpoint: '/chat/',
      model: opts.model,
      temperature: opts.temperature,
      maxTokens: opts.maxTokens,
      topP: opts.topP,
      messages: formatMessages(messages),
      messageCount: messages.length,
    });

    const startTime = Date.now();

    try {
      const response = await fetch(`${baseUrl}/chat/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey || ''}`,
        },
        body: JSON.stringify({
          model: opts.model,
          messages,
          temperature: opts.temperature,
          max_tokens: opts.maxTokens,
          top_p: opts.topP,
          stream: false,
        }),
        signal: options?.signal,
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        const errorMsg = `FreeAI API error: ${response.status} ${JSON.stringify(error)}`;
        this.logError('chat', new Error(errorMsg));
        throw new Error(errorMsg);
      }

      const data = asResponseRecord(await response.json());
      const duration = Date.now() - startTime;
      const choice = responseRecords(data, 'choices')[0];
      const message = choice ? responseRecord(choice, 'message') : undefined;
      const usage = responseRecord(data, 'usage');
      const result: ChatResponse = {
        content: responseString(message ?? {}, 'content') ?? '',
        model: responseString(data, 'model') ?? opts.model,
        usage: usage
          ? {
              promptTokens: responseNumber(usage, 'prompt_tokens') ?? 0,
              completionTokens: responseNumber(usage, 'completion_tokens') ?? 0,
              totalTokens: responseNumber(usage, 'total_tokens') ?? 0,
            }
          : undefined,
        finishReason: responseString(choice ?? {}, 'finish_reason'),
      };

      this.logResponse('chat', {
        durationMs: duration,
        model: result.model,
        usage: result.usage,
        contentPreview: truncate(result.content, 1000),
        contentLength: result.content.length,
        finishReason: result.finishReason,
      });

      this.recordTrace({
        provider: this.name,
        model: result.model || opts.model,
        request: { messages, options: opts },
        response: result,
        startedAt: startTime,
        endedAt: Date.now(),
        durationMs: duration,
      });

      return result;
    } catch (e) {
      this.logError('chat', e);
      this.recordTrace({
        provider: this.name,
        model: opts.model,
        request: { messages, options: opts },
        error: { message: (e as Error).message, stack: (e as Error).stack },
        startedAt: startTime,
        endedAt: Date.now(),
        durationMs: Date.now() - startTime,
      });
      throw e;
    }
  }

  async streamChat(
    messages: ChatMessage[],
    onChunk: (chunk: string) => void,
    options?: Partial<ChatOptions>,
  ): Promise<ChatResponse> {
    const opts = this.mergeOptions({ ...options, stream: true });
    const baseUrl = this.getBaseUrl();

    this.logRequest('streamChat', {
      endpoint: '/chat/',
      model: opts.model,
      temperature: opts.temperature,
      maxTokens: opts.maxTokens,
      topP: opts.topP,
      messages: formatMessages(messages),
      messageCount: messages.length,
      stream: true,
    });

    const startTime = Date.now();

    try {
      const response = await fetch(`${baseUrl}/chat/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey || ''}`,
        },
        body: JSON.stringify({
          model: opts.model,
          messages,
          temperature: opts.temperature,
          max_tokens: opts.maxTokens,
          top_p: opts.topP,
          stream: true,
        }),
        signal: options?.signal,
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        const errorMsg = `FreeAI API error: ${response.status} ${JSON.stringify(error)}`;
        this.logError('streamChat', new Error(errorMsg));
        throw new Error(errorMsg);
      }

      const reader = response.body?.getReader();
      let fullContent = '';
      let model = opts.model;
      let chunkCount = 0;

      if (reader) {
        await consumeSse(
          reader,
          (data) => {
            try {
              const parsed = asResponseRecord(JSON.parse(data));
              const choice = responseRecords(parsed, 'choices')[0];
              const delta = choice ? responseRecord(choice, 'delta') : undefined;
              const content = responseString(delta ?? {}, 'content') || '';
              const parsedModel = responseString(parsed, 'model');
              if (parsedModel) model = parsedModel;
              if (content) {
                fullContent += content;
                chunkCount++;
                onChunk(content);
              }
            } catch {
              // Ignore malformed provider events, but never catch stream AbortError here.
            }
          },
          options?.signal,
        );
      }

      const duration = Date.now() - startTime;

      this.logResponse('streamChat', {
        durationMs: duration,
        model,
        chunkCount,
        contentPreview: truncate(fullContent, 1000),
        contentLength: fullContent.length,
      });

      this.recordTrace({
        provider: this.name,
        model,
        request: { messages, options: opts },
        response: { content: fullContent, model },
        startedAt: startTime,
        endedAt: Date.now(),
        durationMs: duration,
      });

      return {
        content: fullContent,
        model,
      };
    } catch (e) {
      this.logError('streamChat', e);
      this.recordTrace({
        provider: this.name,
        model: opts.model,
        request: { messages, options: opts },
        error: { message: (e as Error).message, stack: (e as Error).stack },
        startedAt: startTime,
        endedAt: Date.now(),
        durationMs: Date.now() - startTime,
      });
      throw e;
    }
  }

  async validateConfig(): Promise<boolean> {
    if (!this.config.apiKey) return false;

    this.logRequest('validateConfig', { action: 'test chat connection' });

    try {
      const baseUrl = this.getBaseUrl();
      const startTime = Date.now();
      const response = await fetch(`${baseUrl}/chat/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model || 'qwen7b',
          messages: [{ role: 'user', content: 'Hi' }],
          max_tokens: 5,
          stream: false,
        }),
      });
      const duration = Date.now() - startTime;
      const success = response.ok;
      this.logResponse('validateConfig', {
        success,
        status: response.status,
        durationMs: duration,
      });
      return success;
    } catch (e) {
      this.logError('validateConfig', e);
      return false;
    }
  }

  async getModels(): Promise<string[]> {
    const baseUrl = this.getBaseUrl();
    this.logRequest('getModels', { endpoint: '/models' });

    try {
      const startTime = Date.now();
      const response = await fetch(`${baseUrl}/models`, {
        headers: {
          Authorization: `Bearer ${this.config.apiKey || ''}`,
        },
      });
      const duration = Date.now() - startTime;

      if (response.ok) {
        const data: unknown = await response.json();
        const models = Array.isArray(data)
          ? data
              .filter(
                (item): item is Record<string, unknown> =>
                  typeof item === 'object' && item !== null,
              )
              .map((item) =>
                typeof item.id === 'string'
                  ? item.id
                  : typeof item.name === 'string'
                    ? item.name
                    : '',
              )
              .filter(Boolean)
          : [];
        this.logResponse('getModels', {
          success: true,
          status: response.status,
          durationMs: duration,
          modelCount: models.length,
        });
        return models;
      } else {
        this.logResponse('getModels', {
          success: false,
          status: response.status,
          durationMs: duration,
        });
        return [];
      }
    } catch (e) {
      this.logError('getModels', e);
      return [];
    }
  }

  async generateImage(prompt: string, options?: ImageGenerationOptions): Promise<GeneratedImage[]> {
    const baseUrl = this.getBaseUrl();
    const model = options?.model || this.config.model || 'flux-dev';
    const size = options?.size || '1024x1024';
    const n = options?.n || 1;

    this.logRequest('generateImage', {
      endpoint: '/images/generations',
      model,
      size,
      n,
      prompt: truncate(prompt, 300),
      watermark: false,
    });

    const startTime = Date.now();
    const traceOptions = { ...options };
    delete traceOptions.signal;
    const fullOptions: ImageGenerationOptions = { ...traceOptions, model, size, n };
    const scene = options?.scene;
    const writeTrace = (extra: {
      response?: { images: GeneratedImage[]; raw?: unknown };
      error?: { message: string; stack?: string };
    }) => {
      const endedAt = Date.now();
      this.recordTrace({
        type: 'image',
        provider: this.name,
        model,
        size,
        scene,
        request: { prompt, options: fullOptions },
        startedAt: startTime,
        endedAt,
        durationMs: endedAt - startTime,
        ...extra,
      });
    };

    try {
      const response = await fetch(`${baseUrl}/images/generations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey || ''}`,
        },
        body: JSON.stringify({
          model,
          prompt,
          n,
          size,
          watermark: false,
        }),
        signal: options?.signal,
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        const errorMsg = `FreeAI image generation error: ${response.status} ${JSON.stringify(error)}`;
        const err = new Error(errorMsg);
        this.logError('generateImage', err);
        writeTrace({ error: { message: err.message, stack: err.stack } });
        throw err;
      }

      const data = asResponseRecord(await response.json());
      const duration = Date.now() - startTime;
      const results = responseRecords(data, 'data')
        .map((item): GeneratedImage | undefined => {
          const url = responseString(item, 'url');
          return url
            ? {
                url,
                ...(responseString(item, 'revised_prompt')
                  ? { revisedPrompt: responseString(item, 'revised_prompt') }
                  : {}),
              }
            : undefined;
        })
        .filter((item): item is GeneratedImage => Boolean(item));

      this.logResponse('generateImage', {
        durationMs: duration,
        imageCount: results.length,
        images: results.map((r: GeneratedImage) => ({
          urlPreview: r.url ? truncate(r.url, 100) : '',
          hasUrl: !!r.url,
        })),
      });

      writeTrace({ response: { images: results, raw: data } });
      return results;
    } catch (e) {
      this.logError('generateImage', e);
      if (e instanceof Error) {
        writeTrace({ error: { message: e.message, stack: e.stack } });
      } else {
        writeTrace({ error: { message: String(e) } });
      }
      throw e;
    }
  }
}
