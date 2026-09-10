import { BaseProvider, formatMessages, truncate } from './base';
import type {
  ChatMessage,
  ChatOptions,
  ChatResponse,
  ModelConfig,
  ImageGenerationOptions,
  GeneratedImage,
} from '../types';
import { pageTypeToCategory } from '../types';
import { getSessionStage, type ImageGenerationTrace } from '../utils/llm-tracer';

// FR-15：从分类参考图映射中，按 slide pageType 选取 img2img seed。
// 查找链：对应分类（cover/content/summary）→ global → undefined。
function pickCategorySeed(
  map: Partial<Record<'cover' | 'content' | 'summary' | 'global', string>> | undefined,
  category: string | undefined,
): string | undefined {
  if (!map) return undefined;
  const cat = pageTypeToCategory(category ?? 'content');
  return map[cat] || map.global || undefined;
}

export class QwenImageProvider extends BaseProvider {
  name = 'qwen-image';
  config: ModelConfig;

  constructor(config: Omit<ModelConfig, 'provider'>) {
    super();
    this.config = {
      ...config,
      provider: 'openai',
    };
  }

  private getBaseUrl(): string {
    return this.config.baseUrl || 'https://dashscope.aliyuncs.com/api/v1';
  }

  private normalizeSize(size: string): string {
    return size.replace('x', '*');
  }

  async chat(messages: ChatMessage[], _options?: Partial<ChatOptions>): Promise<ChatResponse> {
    this.logRequest('chat', { messages: formatMessages(messages), supported: false });
    const error = new Error('QwenImageProvider is for image generation only, chat is not supported');
    this.logError('chat', error);
    throw error;
  }

  async streamChat(
    messages: ChatMessage[],
    _onChunk: (chunk: string) => void,
    _options?: Partial<ChatOptions>,
  ): Promise<ChatResponse> {
    this.logRequest('streamChat', { messages: formatMessages(messages), supported: false });
    const error = new Error('QwenImageProvider is for image generation only, streamChat is not supported');
    this.logError('streamChat', error);
    throw error;
  }

  async validateConfig(): Promise<boolean> {
    if (!this.config.apiKey) return false;
    try {
      this.logRequest('validateConfig', { action: 'test image generation' });
      const testImages = await this.generateImage('测试连接', { n: 1, size: '1024x1024' });
      const valid = testImages.length > 0;
      this.logResponse('validateConfig', { success: valid, imageCount: testImages.length });
      return valid;
    } catch (e) {
      this.logError('validateConfig', e);
      return false;
    }
  }

  async getModels(): Promise<string[]> {
    this.logRequest('getModels', { note: 'returning static model list' });
    try {
      const models = [
        'qwen-image-2.0-pro',
        'qwen-image-2.0',
        'qwen-image-max',
        'qwen-image-plus',
        'qwen-image',
      ];
      this.logResponse('getModels', { success: true, modelCount: models.length, models });
      return models;
    } catch (e) {
      this.logError('getModels', e);
      return [];
    }
  }

  async generateImage(prompt: string, options?: ImageGenerationOptions): Promise<GeneratedImage[]> {
    const baseUrl = this.getBaseUrl();
    const model = options?.model || this.config.model || 'qwen-image-2.0-pro';
    const size = options?.size || '1024x1024';
    const n = options?.n || 1;
    const dashScopeSize = this.normalizeSize(size);
    // FR-15：优先按 slide pageType 从分类参考图（referenceImageByCategory）选取 img2img seed，
    // 否则回退到旧字段 referenceImage（逐字节兼容：仅传全局 referenceImage 时，RVA 会把它同步进
    // byCategory.*，故选取结果与改造前完全一致）。
    const referenceImage =
      pickCategorySeed(options?.referenceImageByCategory, options?.referenceCategory) ??
      options?.referenceImage;

    this.logRequest('generateImage', {
      endpoint: '/services/aigc/multimodal-generation/generation',
      model,
      size,
      dashScopeSize,
      n,
      prompt: truncate(prompt, 300),
      hasReferenceImage: !!referenceImage,
      promptExtend: true,
      watermark: false,
    });

    const startTime = Date.now();
    // 收集完整 options 用于 trace（零截断）
    const fullOptions: ImageGenerationOptions = { ...(options || {}), model, size, n };
    // scene 从 options 扩展字段里读取（由 html-presentation-agent 注入），便于日志定位 slide
    const scene = (options as any)?.scene as string | undefined;

    const writeTrace = (trace: Omit<ImageGenerationTrace, 'type' | 'stage' | 'provider' | 'model' | 'size' | 'startedAt' | 'endedAt' | 'durationMs' | 'request'> & Partial<Pick<ImageGenerationTrace, 'request'>>) => {
      const stage = this.activeTraceSessionId ? (getSessionStage(this.activeTraceSessionId) || 'other') : 'other';
      const endedAt = Date.now();
      this.recordTrace({
        type: 'image',
        stage,
        provider: this.name,
        model,
        size,
        scene,
        request: {
          // 注意：这里 prompt 零截断，与实际发送给模型的完全一致
          prompt,
          options: fullOptions,
        },
        startedAt: startTime,
        endedAt,
        durationMs: endedAt - startTime,
        ...trace,
      } as ImageGenerationTrace);
    };

    try {
      const content: Array<{ text?: string; image?: string }> = [];
      
      if (referenceImage) {
        content.push({ image: referenceImage });
      }
      content.push({ text: prompt });

      const url = `${baseUrl}/services/aigc/multimodal-generation/generation`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model,
          input: {
            messages: [
              {
                role: 'user',
                content,
              },
            ],
          },
          parameters: {
            size: dashScopeSize,
            n,
            prompt_extend: true,
            watermark: false,
          },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        const errorMsg = `Qwen image generation error: ${response.status} ${errorText}\nURL: ${url}`;
        this.logError('generateImage', {
          status: response.status,
          statusText: response.statusText,
          error: errorText,
          url,
        });
        const err = new Error(errorMsg);
        writeTrace({
          error: { message: err.message, stack: err.stack },
        });
        throw err;
      }

      const data = await response.json();
      const duration = Date.now() - startTime;

      this.logResponse('generateImage', {
        durationMs: duration,
        requestId: data.request_id,
        statusCode: data.code,
        hasOutput: !!data.output,
        choicesCount: data.output?.choices?.length || 0,
      });

      const choices = data.output?.choices || [];
      const images: GeneratedImage[] = [];

      for (const choice of choices) {
        const contents = choice.message?.content || [];
        for (const content of contents) {
          if (content.image) {
            images.push({
              url: content.image,
              revisedPrompt: content.revised_prompt,
            });
          }
        }
      }

      this.logResponse('generateImage', {
        durationMs: duration,
        imageCount: images.length,
        images: images.map((img, idx) => ({
          index: idx,
          urlPreview: img.url ? truncate(img.url, 100) : '',
          hasUrl: !!img.url,
          hasRevisedPrompt: !!img.revisedPrompt,
        })),
      });

      // 成功：写入完整 trace（images 零截断，含原始 url 和 revisedPrompt）
      writeTrace({
        response: {
          images,
          raw: data,
        },
      });

      return images;
    } catch (e) {
      this.logError('generateImage', e);
      // 异常：写入完整 trace（error 零截断）
      if (e instanceof Error) {
        writeTrace({
          error: { message: e.message, stack: e.stack },
        });
      } else {
        writeTrace({
          error: { message: String(e) },
        });
      }
      throw e;
    }
  }
}
