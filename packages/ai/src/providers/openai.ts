import { BaseProvider, formatMessages, truncate } from './base';
import type {
  ChatMessage,
  ChatOptions,
  ChatResponse,
  ModelConfig,
  ImageGenerationOptions,
  GeneratedImage,
} from '../types';

export class OpenAIProvider extends BaseProvider {
  name = 'openai';
  config: ModelConfig;

  constructor(config: Omit<ModelConfig, 'provider'>) {
    super();
    this.config = {
      ...config,
      provider: 'openai',
    };
  }

  /**
   * 组装透传到底层请求体的额外字段（extraBody），并在 config.disableThinking 时注入关闭思考参数。
   * 推理模型（DeepSeek 等）默认把 token 写入 reasoning_content，会使 message.content 为空；关闭思考后正文直出 content。
   * 不同推理引擎关闭思考的参数形式不同，这里两种都下发（端点会忽略不支持的字段，安全）：
   *  - 百炼/DashScope 及混合思考模型（deepseek-v4 系列）：顶层 enable_thinking:false
   *  - vLLM / SGLang（PAI Model Gallery 的 maas.aliyuncs.com 端点通常为此类）：chat_template_kwargs.enable_thinking:false
   */
  private resolveExtraBody(options?: Partial<ChatOptions>): Record<string, any> {
    const extra: Record<string, any> = {
      ...(this.config.defaultOptions?.extraBody || {}),
      ...(options?.extraBody || {}),
    };
    if (this.config.disableThinking) {
      extra.enable_thinking = false;
      const ctk =
        extra.chat_template_kwargs && typeof extra.chat_template_kwargs === 'object'
          ? extra.chat_template_kwargs
          : {};
      ctk.enable_thinking = false;
      extra.chat_template_kwargs = ctk;
    }
    return extra;
  }

  async chat(messages: ChatMessage[], options?: Partial<ChatOptions>): Promise<ChatResponse> {
    const opts = this.mergeOptions(options);
    const baseUrl = this.config.baseUrl || 'https://api.openai.com/v1';

    this.logRequest('chat', {
      endpoint: '/chat/completions',
      model: opts.model,
      temperature: opts.temperature,
      maxTokens: opts.maxTokens,
      messages: formatMessages(messages),
      messageCount: messages.length,
    });

    const startTime = Date.now();

    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
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
          ...this.resolveExtraBody(options),
        }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        const errorMsg = `OpenAI API error: ${response.status} ${JSON.stringify(error)}`;
        throw new Error(errorMsg);
      }

      const data = await response.json();
      const duration = Date.now() - startTime;

      const message = data.choices?.[0]?.message;
      const finishReason = data.choices?.[0]?.finish_reason;
      const result: ChatResponse = {
        content: message?.content || '',
        model: data.model,
        usage: data.usage
          ? {
              promptTokens: data.usage.prompt_tokens,
              completionTokens: data.usage.completion_tokens,
              totalTokens: data.usage.total_tokens,
            }
          : undefined,
        reasoningContent: message?.reasoning_content || undefined,
        finishReason,
      };

      this.logResponse('chat', {
        durationMs: duration,
        model: result.model,
        usage: result.usage,
        contentPreview: truncate(result.content, 1000),
        contentLength: result.content.length,
        finishReason,
        reasoningPreview: result.reasoningContent ? truncate(result.reasoningContent, 300) : undefined,
        reasoningLength: result.reasoningContent?.length || 0,
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

  /**
   * 读取 SSE 流并累加正文/思考内容。抽离为独立方法以降低嵌套深度（门禁 max-depth）；
   * 返回最终 model、reasoning_content 与 finish_reason。
   */
  private async readStream(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    onContent: (text: string) => void,
  ): Promise<{ model: string; reasoning: string; finishReason?: string }> {
    const decoder = new TextDecoder();
    let buffer = '';
    let model = '';
    let fullReasoning = '';
    let finishReason: string | undefined;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed === '' || !trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6).trim();
        if (data === '[DONE]') continue;
        try {
          const parsed = JSON.parse(data);
          model = parsed.model || model;
          const choice = parsed.choices?.[0];
          if (choice?.finish_reason) finishReason = choice.finish_reason;
          const content = choice?.delta?.content;
          const reasoning = choice?.delta?.reasoning_content;
          if (content) onContent(content);
          if (reasoning) fullReasoning += reasoning;
        } catch {
          // ignore parse errors
        }
      }
    }
    return { model, reasoning: fullReasoning, finishReason };
  }

  async streamChat(
    messages: ChatMessage[],
    onChunk: (chunk: string) => void,
    options?: Partial<ChatOptions>,
  ): Promise<ChatResponse> {
    const opts = this.mergeOptions({ ...options, stream: true });
    const baseUrl = this.config.baseUrl || 'https://api.openai.com/v1';

    this.logRequest('streamChat', {
      endpoint: '/chat/completions',
      model: opts.model,
      temperature: opts.temperature,
      maxTokens: opts.maxTokens,
      messages: formatMessages(messages),
      messageCount: messages.length,
      stream: true,
    });

    const startTime = Date.now();

    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
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
          ...this.resolveExtraBody(options),
        }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        const errorMsg = `OpenAI API error: ${response.status} ${JSON.stringify(error)}`;
        throw new Error(errorMsg);
      }

      const reader = response.body?.getReader();
      let fullContent = '';
      let fullReasoning = '';
      let model = opts.model;
      let chunkCount = 0;
      let finishReason: string | undefined;

      if (reader) {
        const res = await this.readStream(reader, (text) => {
          fullContent += text;
          chunkCount++;
          onChunk(text);
        });
        if (res.model) model = res.model;
        fullReasoning = res.reasoning;
        finishReason = res.finishReason;
      }

      const duration = Date.now() - startTime;

      this.logResponse('streamChat', {
        durationMs: duration,
        model,
        chunkCount,
        contentPreview: truncate(fullContent, 1000),
        contentLength: fullContent.length,
        finishReason,
        reasoningLength: fullReasoning.length,
      });

      this.recordTrace({
        provider: this.name,
        model,
        request: { messages, options: opts },
        response: { content: fullContent, model, reasoningContent: fullReasoning, finishReason },
        startedAt: startTime,
        endedAt: Date.now(),
        durationMs: duration,
      });

      return {
        content: fullContent,
        model,
        reasoningContent: fullReasoning || undefined,
        finishReason,
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
    const baseUrl = this.config.baseUrl || 'https://api.openai.com/v1';
    this.logRequest('getModels', { endpoint: '/models' });
    try {
      const response = await fetch(`${baseUrl}/models`, {
        headers: {
          Authorization: `Bearer ${this.config.apiKey || ''}`,
        },
      });
      if (!response.ok) {
        this.logResponse('getModels', { success: false, status: response.status });
        return [];
      }
      const data = await response.json();
      const models = data.data?.map((m: { id: string }) => m.id) || [];
      this.logResponse('getModels', { success: true, modelCount: models.length });
      return models;
    } catch (e) {
      this.logError('getModels', e);
      return [];
    }
  }

  async generateImage(prompt: string, options?: ImageGenerationOptions): Promise<GeneratedImage[]> {
    const baseUrl = this.config.baseUrl || 'https://api.openai.com/v1';
    const model = options?.model || this.config.model || 'dall-e-3';
    const size = options?.size || '1024x1024';
    const quality = options?.quality || 'standard';
    const n = options?.n || 1;
    const style = options?.style || 'vivid';

    this.logRequest('generateImage', {
      endpoint: '/images/generations',
      model,
      size,
      quality,
      n,
      style,
      prompt: truncate(prompt, 300),
    });

    const startTime = Date.now();

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
          quality,
          style,
        }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        const errorMsg = `OpenAI image generation error: ${response.status} ${JSON.stringify(error)}`;
        this.logError('generateImage', new Error(errorMsg));
        throw new Error(errorMsg);
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

      return results;
    } catch (e) {
      this.logError('generateImage', e);
      throw e;
    }
  }
}
