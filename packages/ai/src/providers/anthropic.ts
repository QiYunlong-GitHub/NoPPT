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

type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | {
      type: 'image';
      source: { type: 'base64'; media_type: string; data: string } | { type: 'url'; url: string };
    };

export class AnthropicProvider extends BaseProvider {
  name = 'anthropic';
  config: ModelConfig;

  constructor(config: Omit<ModelConfig, 'provider'>) {
    super();
    this.config = {
      ...config,
      provider: 'anthropic',
    };
  }

  private convertMessages(
    messages: ChatMessage[],
  ): Array<{ role: 'user' | 'assistant'; content: string | AnthropicContentBlock[] }> {
    return messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: this.convertContent(m.content),
      }));
  }

  private convertContent(
    content: string | import('../types').ContentPart[],
  ): string | AnthropicContentBlock[] {
    if (typeof content === 'string') return content;
    const blocks: AnthropicContentBlock[] = [];
    for (const part of content) {
      if (part.type === 'text') {
        blocks.push({ type: 'text', text: part.text });
      } else if (part.type === 'image_url') {
        const url = part.image_url?.url || '';
        if (url.startsWith('data:')) {
          const match = url.match(/^data:([^;]+);base64,(.*)$/);
          if (match) {
            blocks.push({
              type: 'image',
              source: {
                type: 'base64',
                media_type: match[1] || 'image/png',
                data: match[2],
              },
            });
          }
        } else if (url) {
          blocks.push({
            type: 'image',
            source: { type: 'url', url },
          });
        }
      }
    }
    return blocks.length > 0 ? blocks : '';
  }

  private getSystemPrompt(messages: ChatMessage[]): string | undefined {
    const systemMsg = messages.find((m) => m.role === 'system');
    if (!systemMsg) return undefined;
    if (typeof systemMsg.content === 'string') return systemMsg.content;
    return systemMsg.content
      .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
      .map((p) => p.text)
      .join('\n');
  }

  async chat(messages: ChatMessage[], options?: Partial<ChatOptions>): Promise<ChatResponse> {
    const opts = this.mergeOptions(options);
    const baseUrl = this.config.baseUrl || 'https://api.anthropic.com/v1';
    const systemPrompt = this.getSystemPrompt(messages);
    const anthropicMessages = this.convertMessages(messages);

    this.logRequest('chat', {
      endpoint: '/messages',
      model: opts.model,
      temperature: opts.temperature,
      maxTokens: opts.maxTokens,
      topP: opts.topP,
      messages: formatMessages(messages),
      messageCount: messages.length,
      hasSystemPrompt: !!systemPrompt,
      anthropicVersion: '2023-06-01',
    });

    const startTime = Date.now();

    try {
      const body: Record<string, unknown> = {
        model: opts.model,
        messages: anthropicMessages,
        max_tokens: opts.maxTokens,
        temperature: opts.temperature,
        top_p: opts.topP,
        stream: false,
      };

      if (systemPrompt) {
        body.system = systemPrompt;
      }

      const response = await fetch(`${baseUrl}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.config.apiKey || '',
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
        signal: options?.signal,
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        const errorMsg = `Anthropic API error: ${response.status} ${JSON.stringify(error)}`;
        this.logError('chat', new Error(errorMsg));
        throw new Error(errorMsg);
      }

      const data = asResponseRecord(await response.json());
      const duration = Date.now() - startTime;
      const content = responseRecords(data, 'content')[0];
      const usage = responseRecord(data, 'usage');
      const result: ChatResponse = {
        content: responseString(content ?? {}, 'text') ?? '',
        model: responseString(data, 'model') ?? opts.model,
        usage: usage
          ? {
              promptTokens: responseNumber(usage, 'input_tokens') ?? 0,
              completionTokens: responseNumber(usage, 'output_tokens') ?? 0,
              totalTokens:
                (responseNumber(usage, 'input_tokens') ?? 0) +
                (responseNumber(usage, 'output_tokens') ?? 0),
            }
          : undefined,
        finishReason: responseString(data, 'stop_reason'),
      };

      this.logResponse('chat', {
        durationMs: duration,
        model: result.model,
        usage: result.usage,
        contentPreview: truncate(result.content, 1000),
        contentLength: result.content.length,
        stopReason: responseString(data, 'stop_reason'),
        stopSequence: responseString(data, 'stop_sequence'),
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
    const baseUrl = this.config.baseUrl || 'https://api.anthropic.com/v1';
    const systemPrompt = this.getSystemPrompt(messages);
    const anthropicMessages = this.convertMessages(messages);

    this.logRequest('streamChat', {
      endpoint: '/messages',
      model: opts.model,
      temperature: opts.temperature,
      maxTokens: opts.maxTokens,
      topP: opts.topP,
      messages: formatMessages(messages),
      messageCount: messages.length,
      hasSystemPrompt: !!systemPrompt,
      stream: true,
      anthropicVersion: '2023-06-01',
    });

    const startTime = Date.now();

    try {
      const body: Record<string, unknown> = {
        model: opts.model,
        messages: anthropicMessages,
        max_tokens: opts.maxTokens,
        temperature: opts.temperature,
        top_p: opts.topP,
        stream: true,
      };

      if (systemPrompt) {
        body.system = systemPrompt;
      }

      const response = await fetch(`${baseUrl}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.config.apiKey || '',
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
        signal: options?.signal,
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        const errorMsg = `Anthropic API error: ${response.status} ${JSON.stringify(error)}`;
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
              const parsedModel = responseString(parsed, 'model');
              if (parsedModel) model = parsedModel;
              const eventType = responseString(parsed, 'type');
              const delta = responseRecord(parsed, 'delta');
              if (
                eventType === 'content_block_delta' &&
                responseString(delta ?? {}, 'type') === 'text_delta'
              ) {
                const text = responseString(delta ?? {}, 'text');
                if (text) {
                  fullContent += text;
                  chunkCount++;
                  onChunk(text);
                }
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
    try {
      this.logRequest('validateConfig', { action: 'test chat connection' });
      await this.chat([{ role: 'user', content: 'hi' }], { maxTokens: 5 });
      this.logResponse('validateConfig', { success: true });
      return true;
    } catch (e) {
      this.logError('validateConfig', e);
      return false;
    }
  }

  async getModels(): Promise<string[]> {
    this.logRequest('getModels', {
      note: 'Anthropic does not provide a models API endpoint, returning static list',
    });
    try {
      const models = [
        'claude-3-opus-20240229',
        'claude-3-sonnet-20240229',
        'claude-3-haiku-20240307',
        'claude-3-5-sonnet-20240620',
        'claude-2.1',
        'claude-2.0',
        'claude-instant-1.2',
      ];
      this.logResponse('getModels', { success: true, modelCount: models.length, models });
      return models;
    } catch (e) {
      this.logError('getModels', e);
      return [];
    }
  }

  async generateImage(
    prompt: string,
    _options?: ImageGenerationOptions,
  ): Promise<GeneratedImage[]> {
    this.logRequest('generateImage', {
      prompt: truncate(prompt, 300),
      supported: false,
    });
    const error = new Error('Image generation is not supported by Anthropic provider');
    this.logError('generateImage', error);
    throw error;
  }
}
