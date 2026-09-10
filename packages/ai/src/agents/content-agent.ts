import type { AIModelProvider } from '../providers/base';
import type { GeneratedOutline, GenerationCallback, ChatMessage } from '../types';
import { PRESENTATION_GENERATION_PROMPT, SYSTEM_PROMPT } from '../templates/generate-presentation';

export class ContentAgent {
  private provider: AIModelProvider;

  constructor(provider: AIModelProvider) {
    this.provider = provider;
  }

  async generatePresentation(
    topic: string,
    options?: {
      style?: 'business' | 'creative' | 'academic' | 'simple';
      slideCount?: number;
      language?: 'zh' | 'en';
      onProgress?: GenerationCallback;
    },
  ): Promise<GeneratedOutline> {
    const { style = 'business', slideCount = 10, language = 'zh', onProgress } = options || {};

    onProgress?.({
      phase: 'outline',
      current: 0,
      total: slideCount,
      message: '正在生成大纲...',
    });

    const userPrompt = this.buildUserPrompt(topic, style, slideCount, language);

    const messages: ChatMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ];

    const response = await this.provider.chat(messages, {
      temperature: 0.7,
      maxTokens: 8192,
    });

    const outline = this.parseOutline(response.content);

    onProgress?.({
      phase: 'complete',
      current: outline.slides.length,
      total: outline.slides.length,
      message: '生成完成',
    });

    return outline;
  }

  private buildUserPrompt(
    topic: string,
    style: string,
    slideCount: number,
    language: string,
  ): string {
    return `${PRESENTATION_GENERATION_PROMPT}

主题：${topic}
风格：${style}
卡片数量：约 ${slideCount} 张
语言：${language === 'zh' ? '中文' : 'English'}

请开始生成：`;
  }

  private parseOutline(content: string): GeneratedOutline {
    try {
      let jsonStr = content;

      const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (codeBlockMatch && codeBlockMatch[1]) {
        jsonStr = codeBlockMatch[1].trim();
      }

      const firstBrace = jsonStr.indexOf('{');
      const lastBrace = jsonStr.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        jsonStr = jsonStr.substring(firstBrace, lastBrace + 1);
      }

      const parsed = JSON.parse(jsonStr);
      return this.validateOutline(parsed);
    } catch (e) {
      console.warn('Failed to parse outline JSON:', e);
    }

    return {
      title: '演示文稿',
      slides: [
        {
          title: '内容',
          content: content,
          type: 'content',
        },
      ],
    };
  }

  private validateOutline(data: any): GeneratedOutline {
    if (!data || typeof data !== 'object') {
      throw new Error('Invalid outline format');
    }

    return {
      title: data.title || '演示文稿',
      description: data.description || '',
      slides: Array.isArray(data.slides)
        ? data.slides.map((s: any) => ({
            title: s.title || '',
            content: s.content || '',
            type: s.type || 'content',
            notes: s.notes || undefined,
            imagePrompt: s.imagePrompt || undefined,
          }))
        : [],
    };
  }

  async refineOutline(outline: GeneratedOutline, _feedback: string): Promise<GeneratedOutline> {
    // TODO: implement outline refinement
    return outline;
  }

  async expandCardContent(_title: string, content: string): Promise<string> {
    // TODO: implement card content expansion
    return content;
  }
}
