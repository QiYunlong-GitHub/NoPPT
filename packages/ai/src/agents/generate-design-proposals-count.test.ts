import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AIModelProvider } from '../providers/base';
import { HTMLPresentationAgent } from './html-presentation-agent';
import type { PresentationPlan, RenderedSlide } from '../types';

const DUMMY_PLAN: PresentationPlan = {
  title: '测试主题',
  primaryColor: '#2563eb',
  slides: [
    { pageType: 'cover', title: '封面页', keyPoints: [], needsImage: false },
    { pageType: 'content-no-image', title: '内容页 1', keyPoints: [], needsImage: false },
  ],
};

const FAKE_FIRST_SLIDE: RenderedSlide = {
  title: 'T1',
  html: '<div data-noppt-page="1"></div>',
  pageType: 'cover',
  critique: { score: 8, passed: true, attempts: 1, issues: [] },
};

type ChatFn = (messages: Array<{ role: string; content: string }>, opts?: any) => Promise<{ content: string }>;

function buildAgent(mockChat?: ChatFn) {
  const contentProvider = { chat: vi.fn(mockChat ?? (async () => ({ content: '' }))) };
  const planningProvider = { chat: vi.fn(mockChat ?? (async () => ({ content: '' }))) };
  const agent = new HTMLPresentationAgent(contentProvider as any, {
    planningProvider: planningProvider as any,
    contentProvider: contentProvider as any,
  });
  return { agent, planningProvider, contentProvider };
}

function buildProposalsArray(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `proposal-${i + 1}`,
    name: `方案 ${i + 1}`,
    description: `描述 ${i + 1}`,
    primaryColor: '#ea580c',
    colorTheme: 'orange',
    fontFamily: 'sans',
    styleTheme: i === 0 ? 'glass' : i === 1 ? 'gradient' : 'none',
    density: i === 2 ? 'spacious' : 'normal',
    iconStyle: i === 0 ? 'line' : i === 1 ? 'filled' : 'none',
  }));
}

function mockReturnJson(provider: any, arr: any[]) {
  (provider.chat as any).mockImplementation(async () => ({
    content: JSON.stringify(arr),
  }));
}

describe('generateDesignProposals proposalCount（F-1~F-4 + AC-6）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Case A：proposalCount=1 → prompt 只提 proposal-1、渲染 1 次', async () => {
    const { agent, planningProvider } = buildAgent();
    mockReturnJson(planningProvider, buildProposalsArray(1));

    const renderSpy = vi
      .spyOn(agent as any, 'renderSlides')
      .mockResolvedValue([FAKE_FIRST_SLIDE]);

    const out = await (agent as any).generateDesignProposals('t', DUMMY_PLAN, { proposalCount: 1 }, undefined);
    const prompt = (planningProvider.chat as any).mock.calls[0][0][0].content as string;

    expect(prompt).toMatch(/"proposal-1"/);
    expect(prompt).not.toMatch(/"proposal-2"/);
    expect(prompt).not.toMatch(/"proposal-3"/);
    expect(prompt).not.toMatch(/3\s*个视觉|提出\s*3\s*个/);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('proposal-1');
    expect(renderSpy).toHaveBeenCalledTimes(1);
  });

  it('Case B：proposalCount 未传（默认 3）→ prompt 含 proposal-2/3，渲染 3 次', async () => {
    const { agent, planningProvider } = buildAgent();
    mockReturnJson(planningProvider, buildProposalsArray(3));

    const renderSpy = vi
      .spyOn(agent as any, 'renderSlides')
      .mockResolvedValue([FAKE_FIRST_SLIDE]);

    const out = await (agent as any).generateDesignProposals('t', DUMMY_PLAN, {}, undefined);
    const prompt = (planningProvider.chat as any).mock.calls[0][0][0].content as string;

    expect(prompt).toMatch(/"proposal-2"/);
    expect(prompt).toMatch(/"proposal-3"/);
    expect(prompt).toMatch(/提出 3 个视觉上差异明显的设计方向/);
    expect(out).toHaveLength(3);
    expect(renderSpy).toHaveBeenCalledTimes(3);
  });

  it.each([[0], [-1], [1.7], [NaN], ['banana' as any]])(
    'Case C：proposalCount=%s → 规范化 fallback 到 3',
    async (raw) => {
      const { agent, planningProvider } = buildAgent();
      mockReturnJson(planningProvider, buildProposalsArray(3));

      const renderSpy = vi
        .spyOn(agent as any, 'renderSlides')
        .mockResolvedValue([FAKE_FIRST_SLIDE]);

      const out = await (agent as any).generateDesignProposals(
        't',
        DUMMY_PLAN,
        { proposalCount: raw as any },
        undefined,
      );
      expect(out).toHaveLength(3);
      expect(renderSpy).toHaveBeenCalledTimes(3);
    },
  );

  it('Case D：LLM JSON 解析失败 fallback → proposalCount=1 仅 1 条 glass/normal/line，默认 3 条', async () => {
    const { agent, planningProvider } = buildAgent();
    (planningProvider.chat as any).mockRejectedValue(new Error('boom'));

    const renderSpy = vi
      .spyOn(agent as any, 'renderSlides')
      .mockResolvedValue([FAKE_FIRST_SLIDE]);

    const out1 = await (agent as any).generateDesignProposals('t', DUMMY_PLAN, { proposalCount: 1 }, undefined);
    expect(out1).toHaveLength(1);
    expect(out1[0].id).toBe('proposal-1');
    expect(out1[0].styleTheme).toBe('glass');
    expect(out1[0].density).toBe('normal');
    expect(out1[0].iconStyle).toBe('line');
    expect(renderSpy).toHaveBeenCalledTimes(1);

    renderSpy.mockClear();
    const out3 = await (agent as any).generateDesignProposals('t', DUMMY_PLAN, {}, undefined);
    expect(out3).toHaveLength(3);
    expect(out3.map((p: any) => p.id)).toEqual(['proposal-1', 'proposal-2', 'proposal-3']);
    expect(renderSpy).toHaveBeenCalledTimes(3);
  });

  it('Case E：引导式 prompt 关键段字节对比（不传 proposalCount）', async () => {
    const { agent, planningProvider } = buildAgent();
    (planningProvider.chat as any).mockRejectedValue(new Error('force-fallback-prompt-only'));

    try {
      await (agent as any).generateDesignProposals('t', DUMMY_PLAN, {}, undefined);
    } catch {
      /* ignore */
    }
    const prompt = (planningProvider.chat as any).mock.calls[0][0][0].content as string;

    const expectedSubstrings = [
      '基于以下演示文稿主题和幻灯片规划，提出 3 个视觉上差异明显的设计方向。',
      '- id: "proposal-1" / "proposal-2" / "proposal-3"',
      '请返回 3 个设计方案，每个方案包含：',
      '要求 3 个方案视觉上明显区分（通过风格质感、密度、图标风格等维度变化）。',
      '只返回 JSON 数组，不要任何其他文字或 Markdown 代码块标记。',
      '正式商务汇报禁止 emoji。',
    ];
    for (const s of expectedSubstrings) {
      expect(prompt).toContain(s);
    }
    expect(prompt).not.toContain('提出 1 个正式视觉设计方向');
    expect(prompt).not.toContain('单套方案请使用商务稳健风格');
    expect(prompt).not.toContain('只返回长度为 1 的 JSON 数组');
  });

  it('Case F：proposalCount>20 cap 到 20；=1/=2/=21 的规范化', async () => {
    const { agent, planningProvider } = buildAgent();
    mockReturnJson(planningProvider, buildProposalsArray(30));

    const renderSpy = vi
      .spyOn(agent as any, 'renderSlides')
      .mockResolvedValue([FAKE_FIRST_SLIDE]);

    const out = await (agent as any).generateDesignProposals('t', DUMMY_PLAN, { proposalCount: 21 }, undefined);
    expect(out).toHaveLength(20);

    renderSpy.mockClear();
    (planningProvider.chat as any).mockClear();
    mockReturnJson(planningProvider, buildProposalsArray(2));
    const out2 = await (agent as any).generateDesignProposals('t', DUMMY_PLAN, { proposalCount: 2 }, undefined);
    expect(out2).toHaveLength(2);
  });
});

describe('enforceHeadingColorOnLightBg Bug-4 颜色兜底', () => {
  // 注意：enforceHeadingColorOnLightBg 是 private，测试中用 (agent as any) 访问。
  // 构造 agent：复用 AIModelProvider 接口造一个空实现的 dummy。
  const getAgent = () => {
    const dummy: AIModelProvider = {
      name: 'dummy',
      async chat() { return { role: 'assistant' as const, content: '' }; },
      supportsStreaming: false,
    } as unknown as AIModelProvider;
    const agent = new HTMLPresentationAgent(dummy);
    return agent;
  };

  const SUMMARY_HTML = `<div style="width:100%;height:100%;overflow:hidden;position:relative;box-sizing:border-box;padding:48px 64px;display:flex;flex-direction:column;background-color:#fff;font-family:'JetBrains Mono', ui-monospace, 'Cascadia Code', Consolas, 'Noto Sans Mono CJK SC', monospace;">
  <div style="position:absolute;top:24px;right:24px;width:128px;height:128px;border-radius:50%;background:linear-gradient(135deg,#7c3aed15,#7c3aed08);pointer-events:none;"></div>
  <h2 style="font-size:50px;font-weight:700;margin:0 0 32px 0;line-height:1.25;overflow-wrap:break-word;word-break:break-word;">科学监测与全球协作是应对气候异常的关键</h2>
  <ul style="list-style:none;"><li style="color:#374151;">条目</li></ul>
</div>`;

  it('浅底 summary h2 无 color → 升为 #7c3aed（TR-6.1 / AC-9）', () => {
    const agent = getAgent() as any;
    const out = agent.enforceHeadingColorOnLightBg(SUMMARY_HTML, { primaryColor: '#7c3aed', primaryColorDarker: '#632ebe' });
    expect(out).toMatch(/<h2\b[^>]*\bstyle="[^"]*\bcolor:\s*#7c3aed\b/i);
  });

  it('浅底 h2 已有 color:#374151 → 升为 #7c3aed，其他 style 属性保留（TR-6.2 / AC-9）', () => {
    const agent = getAgent() as any;
    const html = `<div style="background-color:#fff;display:flex;flex-direction:column;"><h2 style="color:#374151;font-size:44px;">标题</h2></div>`;
    const out = agent.enforceHeadingColorOnLightBg(html, { primaryColor: '#7c3aed', primaryColorDarker: '#632ebe' });
    expect(out).toMatch(/color:\s*#7c3aed/i);
    expect(out).toMatch(/font-size:\s*44px/i);
  });

  it('深底主色背景 h2 无 color → 升为 #FFFFFF（TR-6.3 / AC-10）', () => {
    const agent = getAgent() as any;
    const html = `<div style="background:#7c3aed;width:100%;height:100%;display:flex;flex-direction:column;"><h2 style="font-size:44px;">深底标题</h2></div>`;
    const out = agent.enforceHeadingColorOnLightBg(html, { primaryColor: '#7c3aed', primaryColorDarker: '#632ebe' });
    expect(out).toMatch(/<h2\b[^>]*\bstyle="[^"]*\bcolor:\s*#ffffff\b/i);
  });

  it('浅底 h2 已有 color:#7c3aed → 保持不变不破坏（TR-6.4 / AC-11）', () => {
    const agent = getAgent() as any;
    const html = `<div style="background-color:#fff;"><h2 style="color:#7c3aed;font-size:48px;">已写对</h2></div>`;
    const out = agent.enforceHeadingColorOnLightBg(html, { primaryColor: '#7c3aed', primaryColorDarker: '#632ebe' });
    const h2Style = out.match(/<h2\b[^>]*\bstyle="([^"]*)"/i)?.[1] || '';
    expect(h2Style).toContain('color:#7c3aed');
    // 不被替换成其他颜色：简单起见断言 color 的值就是 #7c3aed（且没有出现第二个 color 声明）
    const colorOccurrences = (h2Style.match(/color\s*:/gi) || []).length;
    expect(colorOccurrences).toBe(1);
  });
});
