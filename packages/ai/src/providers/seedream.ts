import { BaseProvider, truncate } from './base';
import type {
  ChatMessage,
  ChatOptions,
  ChatResponse,
  ModelConfig,
  ImageGenerationOptions,
  GeneratedImage,
} from '../types';

export class SeedreamProvider extends BaseProvider {
  name = 'seedream';
  config: ModelConfig;

  constructor(config: Omit<ModelConfig, 'provider'>) {
    super();
    this.config = {
      ...config,
      provider: 'openai',
    };
  }

  private getBaseUrl(): string {
    return this.config.baseUrl || 'https://ark.cn-beijing.volces.com/api/v3';
  }

  async chat(_messages: ChatMessage[], _options?: Partial<ChatOptions>): Promise<ChatResponse> {
    throw new Error('SeedreamProvider is for image generation only, chat is not supported');
  }

  async streamChat(
    _messages: ChatMessage[],
    _onChunk: (chunk: string) => void,
    _options?: Partial<ChatOptions>,
  ): Promise<ChatResponse> {
    throw new Error('SeedreamProvider is for image generation only, streamChat is not supported');
  }

  async validateConfig(): Promise<boolean> {
    if (!this.config.apiKey) return false;
    try {
      this.logRequest('validateConfig', { action: 'test image generation' });
      const testImages = await this.generateImage('test', { n: 1, size: '1024x1024' });
      const valid = testImages.length > 0;
      this.logResponse('validateConfig', { success: valid, imageCount: testImages.length });
      return valid;
    } catch (e) {
      this.logError('validateConfig', e);
      return false;
    }
  }

  async getModels(): Promise<string[]> {
    return ['seedream-5.0-lite', 'seedream-5.0', 'seedream-4.5', 'seedream-4', 'seedream-3.0'];
  }

  async generateImage(prompt: string, options?: ImageGenerationOptions): Promise<GeneratedImage[]> {
    const baseUrl = this.getBaseUrl();
    const model = options?.model || this.config.model || 'seedream-5.0-lite';
    const size = options?.size || '1024x1024';
    const n = options?.n || 1;

    this.logRequest('generateImage', {
      endpoint: '/images/generations',
      model,
      size,
      n,
      prompt: truncate(prompt, 300),
      responseFormat: 'url',
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
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model,
          prompt,
          n,
          size,
          response_format: 'url',
          watermark: false,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        this.logError('generateImage', {
          status: response.status,
          statusText: response.statusText,
          error: errorText,
        });
        const err = new Error(`Seedream image generation error: ${response.status} ${errorText}`);
        writeTrace({ error: { message: err.message, stack: err.stack } });
        throw err;
      }

      const data = await response.json();
      const duration = Date.now() - startTime;

      this.logResponse('generateImage', {
        durationMs: duration,
        model: data.model,
        created: data.created,
        hasData: !!data.data,
        dataLength: data.data?.length,
        firstItemKeys: data.data?.[0] ? Object.keys(data.data[0]) : [],
        usage: data.usage,
      });

      const results: GeneratedImage[] = [];
      if (data.data && Array.isArray(data.data)) {
        for (let i = 0; i < data.data.length; i++) {
          const item = data.data[i];
          let imageUrl = item.url || item.b64_json || '';
          if (imageUrl) {
            imageUrl = imageUrl
              .trim()
              .replace(/^`|`$/g, '')
              .trim()
              .replace(/^["']|["']$/g, '')
              .trim();
          }
          console.log(
            `[LLM:${this.name}] Extracted image URL ${i + 1}:`,
            imageUrl ? imageUrl.substring(0, 150) + '...' : 'EMPTY',
          );

          if (imageUrl) {
            results.push({
              url:
                imageUrl.startsWith('data:') || imageUrl.startsWith('http')
                  ? imageUrl
                  : item.b64_json
                    ? `data:image/png;base64,${item.b64_json}`
                    : imageUrl,
              revisedPrompt: item.revised_prompt,
            });
          }
        }
      }

      writeTrace({ response: { images: results, raw: data } });
      console.log(`[LLM:${this.name}] Returning ${results.length} images\n`);
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
