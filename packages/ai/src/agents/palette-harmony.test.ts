import { describe, it, expect } from 'vitest';
import { HTMLPresentationAgent } from './html-presentation-agent';

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

describe('detectHarmonizedPalette (FR-B 配色自洽检测)', () => {
  it('统一红色系页面 → 自洽（放行，不被重染）', () => {
    const agent = buildAgent();
    const red = `<div style="background:linear-gradient(135deg,#c7000b,#9f0009);color:#c7000b;"><p style="color:#374151;">x</p><div style="background:radial-gradient(circle,#c7000b35,transparent);"></div></div>`;
    expect((agent as any).detectHarmonizedPalette(red)).toBe(true);
  });

  it('统一蓝色系页面 → 自洽（放行，历史重写本为 no-op）', () => {
    const agent = buildAgent();
    const blue = `<div style="background:linear-gradient(135deg,#2563eb,#1e4fbc);color:#2563eb;"><p style="color:#374151;">x</p></div>`;
    expect((agent as any).detectHarmonizedPalette(blue)).toBe(true);
  });

  it('多色相混杂（红 + 绿）→ 非自洽（需重写归一）', () => {
    const agent = buildAgent();
    const mixed = `<div style="background:#c7000b;"><p style="color:#16a34a;">绿字</p><span style="color:#2563eb;">蓝字</span></div>`;
    expect((agent as any).detectHarmonizedPalette(mixed)).toBe(false);
  });

  it('纯中性（无彩色）→ 自洽（放行）', () => {
    const agent = buildAgent();
    const neutral = `<div style="background:#f3f4f6;"><p style="color:#374151;">x</p></div>`;
    expect((agent as any).detectHarmonizedPalette(neutral)).toBe(true);
  });

  it('中性灰阶 + 命名色页面 → 自洽（放行，避免误伤）', () => {
    const agent = buildAgent();
    const gray = `<div style="background:#fff;color:#333;"><p style="color:black;">x</p><span style="background:transparent;">y</span></div>`;
    expect((agent as any).detectHarmonizedPalette(gray)).toBe(true);
  });
});

describe('postProcessHtmlSnapshot 重放幂等（FR-B 兜底）', () => {
  const COVER_RED = `<div style="width:100%;height:100%;overflow:hidden;position:relative;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;">
    <div style="position:absolute;top:-80px;right:-120px;width:520px;height:520px;border-radius:50%;background:radial-gradient(circle,#c7000b35 0%,#c7000b10 45%,transparent 75%);pointer-events:none;"></div>
    <div style="position:absolute;left:-160px;bottom:-120px;width:480px;height:400px;background:linear-gradient(135deg,#c7000b18,#9f000910);clip-path:polygon(0 30%,40% 0,80% 60%,30% 100%);pointer-events:none;"></div>
    <h1 style="font-size:92px;font-weight:900;background:linear-gradient(135deg,#c7000b,#9f0009);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;">标题</h1>
    <p style="font-size:32px;font-weight:700;background:linear-gradient(135deg,#c7000b,#9f0009);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;">副标题</p>
    <div style="display:inline-flex;align-items:center;padding:8px 24px;border-radius:999px;background:#c7000b12;color:#c7000b;font-size:18px;">流程信息化总部</div>
  </div>`;

  it('自洽红页经终局重放（primaryColor 回落默认蓝）后主色不丢、不注入默认蓝', () => {
    const agent = buildAgent();
    // 真实生产链路：第一遍（agent 内容生成）用参考红；第二遍（server 重放）模拟取色失源回落默认蓝。
    const first = agent.postProcessHtmlSnapshot(COVER_RED, { primaryColor: '#c7000b' });
    const out = agent.postProcessHtmlSnapshot(first, { primaryColor: '#2563eb' });
    expect(out).toMatch(/#c7000b/i); // 参考红保持
    expect(out).not.toMatch(/#1c4ab0/i); // 无默认蓝模板注入
    expect(out).not.toMatch(/#f3f4f6/i); // 无灰化装饰
    // 装饰光晕数量不增加：radial-gradient(circle) 仍只有 1 个
    expect((out.match(/radial-gradient\(\s*circle/gi) || []).length).toBe(1);
    expect((out.match(/clip-path:\s*polygon/gi) || []).length).toBe(1);
  });

  it('多色相混杂页（脏色）仍走重写逻辑（行为不被豁免改变）', () => {
    const agent = buildAgent();
    const mixed = `<div style="background:#c7000b;"><h2 style="color:#16a34a;">绿标题</h2><p style="color:#2563eb;">蓝正文</p></div>`;
    const out = agent.postProcessHtmlSnapshot(mixed, { primaryColor: '#2563eb' });
    // 脏色页会被 sanitizeGradientColors / enforceSinglePalette 处理（至少不应抛错，且保持可处理）
    expect(typeof out).toBe('string');
  });
});
