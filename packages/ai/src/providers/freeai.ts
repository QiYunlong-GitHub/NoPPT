import { BaseProvider, formatMessages, truncate } from './base';
import type {
  ChatMessage,
  ChatOptions,
  ChatResponse,
  ModelConfig,
  ImageGenerationOptions,
  GeneratedImage,
} from '../types';

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
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        const errorMsg = `FreeAI API error: ${response.status} ${JSON.stringify(error)}`;
        this.logError('chat', new Error(errorMsg));
        throw new Error(errorMsg);
      }

      const data = await response.json();
      const duration = Date.now() - startTime;

      const result = {
        content: data.choices[0]?.message?.content || '',
        model: data.model,
        usage: data.usage
          ? {
              promptTokens: data.usage.prompt_tokens,
              completionTokens: data.usage.completion_tokens,
              totalTokens: data.usage.total_tokens,
            }
          : undefined,
      };

      this.logResponse('chat', {
        durationMs: duration,
        model: result.model,
        usage: result.usage,
        contentPreview: truncate(result.content, 1000),
        contentLength: result.content.length,
        finishReason: data.choices[0]?.finish_reason,
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
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        const errorMsg = `FreeAI API error: ${response.status} ${JSON.stringify(error)}`;
        this.logError('streamChat', new Error(errorMsg));
        throw new Error(errorMsg);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let fullContent = '';
      let model = opts.model;
      let chunkCount = 0;

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value);
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') continue;

              try {
                const parsed = JSON.parse(data);
                const content = parsed.choices?.[0]?.delta?.content || '';
                if (parsed.model) model = parsed.model;
                if (content) {
                  fullContent += content;
                  chunkCount++;
                  onChunk(content);
                }
              } catch {
                // ignore parse errors
              }
            }
          }
        }
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
        const data = await response.json();
        const models = Array.isArray(data) ? data.map((m: any) => m.id || m.name) : [];
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
    const fullOptions: ImageGenerationOptions = { ...(options || {}), model, size, n };
    const scene = (options as any)?.scene as string | undefined;
    const writeTrace = (extra: any) => {
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
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        const errorMsg = `FreeAI image generation error: ${response.status} ${JSON.stringify(error)}`;
        const err = new Error(errorMsg);
        this.logError('generateImage', err);
        writeTrace({ error: { message: err.message, stack: err.stack } });
        throw err;
      }

      const data = await response.json();
      const duration = Date.now() - startTime;

      const results =
        data.data?.map((item: any) => ({
          url: item.url,
          revisedPrompt: item.revised_prompt,
        })) || [];

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
