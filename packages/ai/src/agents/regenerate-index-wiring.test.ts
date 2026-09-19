import { describe, it, expect, vi } from 'vitest';
import { HTMLPresentationAgent } from './html-presentation-agent';
import type {
  ReferenceVisualAttributes,
  CategoryReference,
} from '../utils/reference-attribute-resolver';
import * as refAttr from '../utils/reference-attribute-resolver';

function buildAgent(): HTMLPresentationAgent {
  const dummy = {
    name: 'stub',
    config: {},
    supportsStreaming: false,
    chat: async () => ({
      content: '<main class="slide"><h1>再生页</h1></main>',
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    }),
  } as any;
  return new HTMLPresentationAgent(dummy);
}

const emptyCat: CategoryReference = { uploaded: false, style: {} } as CategoryReference;

function makeRva(globalHtml: string): ReferenceVisualAttributes {
  return {
    global: { uploaded: true, referenceHtml: globalHtml, style: {} } as CategoryReference,
    byCategory: { cover: { ...emptyCat }, content: { ...emptyCat }, summary: { ...emptyCat } },
    source: 'merged-category-assembled',
  };
}

describe('regenerateSingleSlide 透传 pageIndexInCategory（防重生成路径静默回退到 0）', () => {
  it('重生成第 2 张内容页时，generateSlideHtml 末位实参为真实分类内序号 1（而非默认 0）', async () => {
    const agent = buildAgent();
    // 截获翻页序号的接线点：regenerateSingleSlide → generateSlideHtml 末位实参 pageIndexInCategory
    // 会透传给 formatReferenceOverrideForPage(refViz, pageType, pageIndexInCategory)。
    // 跨模块函数可被 vi.spyOn 稳定拦截（模块内同名调用会被打包器内联，改在跨模块边界断言）。
    const spy = vi
      .spyOn(refAttr as any, 'formatReferenceOverrideForPage')
      .mockReturnValue('');

    const plan: any = {
      slides: [
        { pageType: 'cover' },
        { pageType: 'content-cards', keyPoints: ['要点一', '要点二'] },
        { pageType: 'content-cards', keyPoints: ['要点A', '要点B'] },
      ],
    };
    const design: any = {
      density: 'normal',
      iconStyle: 'bullet',
      fontFamily: 'serif',
      colorTheme: 'light',
    };
    const options: any = { referenceVisualAttributes: makeRva('<div class="ref"></div>') };

    await agent.regenerateSingleSlide(
      'topic',
      plan,
      design,
      2,
      options,
      undefined,
      undefined,
      'placeholder',
    );

    expect(spy).toHaveBeenCalled();
    // 第 3 页（索引 2）是所属 content 分类内的第 2 页 → 序号应为 1，绝不是默认 0
    expect(spy.mock.calls[0][2]).toBe(1);
  });
});
