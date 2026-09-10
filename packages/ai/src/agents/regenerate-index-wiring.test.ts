import { describe, it, expect, vi } from 'vitest';
import { HTMLPresentationAgent } from './html-presentation-agent';
import type {
  ReferenceVisualAttributes,
  CategoryReference,
} from '../utils/reference-attribute-resolver';

function buildAgent(): HTMLPresentationAgent {
  const dummy = {
    name: 'stub',
    config: {},
    supportsStreaming: false,
    chat: async () => ({
      content: '',
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
    // 截获私有 generateSlideHtml，避免真实 LLM 调用，仅校验接线参数
    const spy = vi
      .spyOn(agent as any, 'generateSlideHtml')
      .mockImplementation(async () => '<div>stub</div>');

    const plan: any = {
      slides: [{ pageType: 'cover' }, { pageType: 'content-cards' }, { pageType: 'content-cards' }],
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
    const lastCall = spy.mock.calls[spy.mock.calls.length - 1];
    const lastArg = lastCall[lastCall.length - 1];
    // 第 3 页（索引 2）是所属 content 分类内的第 2 页 → 序号应为 1，绝不是默认 0
    expect(lastArg).toBe(1);
  });
});
