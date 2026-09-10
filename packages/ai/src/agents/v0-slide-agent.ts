import { V0Provider } from '../providers/v0';
import type { GeneratedOutline } from '../types';

export interface V0SlideOptions {
  style?: 'business' | 'creative' | 'academic' | 'simple';
  language?: 'zh' | 'en';
  slideWidth?: number;
  slideHeight?: number;
  onProgress?: (current: number, total: number, message: string) => void;
}

export interface GeneratedSlideHTML {
  index: number;
  title: string;
  html: string;
  demoUrl?: string;
}

const STYLE_DESCRIPTIONS: Record<string, string> = {
  business: '专业商务风格，使用蓝色系配色，简洁大气，适合企业汇报',
  creative: '创意设计风格，使用渐变色和现代排版，活泼有视觉冲击力',
  academic: '学术简洁风格，使用黑白灰配色，排版严谨，适合学术报告',
  simple: '极简风格，大量留白，专注内容本身',
};

export class V0SlideAgent {
  private provider: V0Provider;

  constructor(provider: V0Provider) {
    this.provider = provider;
  }

  async generateSlidesFromOutline(
    outline: GeneratedOutline,
    options?: V0SlideOptions,
  ): Promise<GeneratedSlideHTML[]> {
    const {
      style = 'business',
      language = 'zh',
      slideWidth = 960,
      slideHeight = 540,
      onProgress,
    } = options || {};

    const results: GeneratedSlideHTML[] = [];
    const total = outline.slides.length;

    for (let i = 0; i < outline.slides.length; i++) {
      const slide = outline.slides[i];
      onProgress?.(i + 1, total, `正在生成第 ${i + 1} 张幻灯片：${slide.title}`);

      try {
        const html = await this.generateSingleSlide(
          slide.title,
          slide.content,
          slide.type || 'content',
          {
            style,
            language,
            slideWidth,
            slideHeight,
            presentationTitle: outline.title,
            slideIndex: i,
            totalSlides: total,
          },
        );
        results.push({
          index: i,
          title: slide.title,
          html,
        });
      } catch (error) {
        console.error(`Failed to generate slide ${i + 1}:`, error);
        results.push({
          index: i,
          title: slide.title,
          html: this.generateFallbackHTML(slide.title, slide.content, slideWidth, slideHeight),
        });
      }
    }

    return results;
  }

  private async generateSingleSlide(
    title: string,
    content: string,
    type: string,
    options: {
      style: string;
      language: string;
      slideWidth: number;
      slideHeight: number;
      presentationTitle: string;
      slideIndex: number;
      totalSlides: number;
    },
  ): Promise<string> {
    const styleDesc = STYLE_DESCRIPTIONS[options.style] || STYLE_DESCRIPTIONS.business;
    const langDesc = options.language === 'zh' ? '中文' : 'English';

    const prompt = `生成一张演示文稿幻灯片的 HTML 页面。

要求：
1. 使用纯 HTML + Tailwind CSS（通过 CDN 引入），不要使用 React 或任何框架
2. 画布尺寸：${options.slideWidth}px × ${options.slideHeight}px
3. 风格：${styleDesc}
4. 语言：${langDesc}
5. 幻灯片类型：${type === 'title' ? '封面页（大标题 + 副标题）' : '内容页（标题 + 要点列表）'}
6. 整个页面用一个容器 div 包裹，宽高就是画布尺寸
7. 不要有任何外部依赖，除了 Tailwind CSS CDN
8. 内容要充实，排版要美观，有视觉层次感

幻灯片标题：${title}
${content ? `幻灯片内容要点：\n${content}` : ''}
演示文稿总标题：${options.presentationTitle}
第 ${options.slideIndex + 1} 页 / 共 ${options.totalSlides} 页

请直接输出完整的 HTML 代码，包含 <!DOCTYPE html> 和完整的页面结构。`;

    const response = await this.provider.chat([
      {
        role: 'system',
        content:
          '你是一个专业的 UI 设计师，擅长创建美观的演示文稿幻灯片。只输出 HTML 代码，不要有任何解释说明。',
      },
      { role: 'user', content: prompt },
    ]);

    return this.extractHTML(response.content);
  }

  private extractHTML(content: string): string {
    const htmlMatch =
      content.match(/<!DOCTYPE html>[\s\S]*<\/html>/i) || content.match(/<html[\s\S]*<\/html>/i);
    if (htmlMatch) {
      return htmlMatch[0];
    }

    const bodyMatch = content.match(/<body[\s\S]*<\/body>/i);
    if (bodyMatch) {
      return `<!DOCTYPE html>
<html>
<head>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
${bodyMatch[0]}
</html>`;
    }

    const divMatch =
      content.match(/```html\s*([\s\S]*?)\s*```/) || content.match(/```\s*([\s\S]*?)\s*```/);
    if (divMatch) {
      return `<!DOCTYPE html>
<html>
<head>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body>
${divMatch[1]}
</body>
</html>`;
    }

    return content;
  }

  private generateFallbackHTML(
    title: string,
    content: string,
    width: number,
    height: number,
  ): string {
    const lines = content.split('\n').filter((l) => l.trim());
    const listItems =
      lines.length > 1
        ? lines.map((l) => `<li class="mb-3 text-lg">${l.replace(/^[-•*]\s*/, '')}</li>`).join('')
        : `<p class="text-lg">${content}</p>`;

    return `<!DOCTYPE html>
<html>
<head>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="m-0 p-0">
  <div style="width:${width}px;height:${height}px;" class="bg-white flex flex-col justify-center px-16">
    <h1 class="text-4xl font-bold text-slate-800 mb-8">${title}</h1>
    ${lines.length > 1 ? `<ul class="list-disc pl-6 text-slate-600 space-y-2">${listItems}</ul>` : listItems}
  </div>
</body>
</html>`;
  }
}
