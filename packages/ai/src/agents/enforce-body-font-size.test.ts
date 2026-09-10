// ================================================================
// enforce-body-font-size.test.ts — R1 修复专项单测
// 覆盖：H1-H6 字号不被误夹、metric 大字豁免、正文 clamp 仍生效、幂等性
// 对应 checklist.md §2 全部断言
// ================================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AIModelProvider } from '../providers/base';
import { HTMLPresentationAgent } from './html-presentation-agent';

function makeAgent(): HTMLPresentationAgent {
  const dummy: AIModelProvider = {
    name: 'dummy',
    async chat() {
      return { role: 'assistant', content: '' };
    },
    supportsStreaming: false,
  } as unknown as AIModelProvider;
  return new HTMLPresentationAgent(dummy);
}

// TS private 绕过：用下标调用 enforceBodyFontSize
function clamp(agent: HTMLPresentationAgent, html: string, round: 1 | 2 = 1): string {
  const fn = (agent as unknown as Record<string, (h: string, o?: { round?: 1 | 2 }) => string>)
    .enforceBodyFontSize;
  return fn.call(agent, html, { round });
}

function extractTagStyle(html: string, tag: string, nth = 1): string {
  const re = new RegExp(`<${tag}\\b([^>]*)>`, 'gi');
  let m: RegExpExecArray | null;
  let idx = 0;
  while ((m = re.exec(html)) !== null) {
    idx++;
    if (idx === nth) {
      const attrs = m[1];
      const sm = /\bstyle\s*=\s*(['"])([\s\S]*?)\1/i.exec(attrs);
      return sm ? sm[2] : '';
    }
  }
  return '';
}

describe('R1 Fix · enforceBodyFontSize：HeadiH1-H6 合法大字豁免', () => {
  const agent = makeAgent();

  it('T2-1. H2 50px 在 div 内部 **不被夹**；同 div 内 p 24px **被夹到 20px**', () => {
    const input =
      '<div style="width:100%;height:100%;padding:48px 64px;display:flex;flex-direction:column;">' +
      '<h2 style="font-size:50px;font-weight:700;line-height:1.25;">页面大标题</h2>' +
      '<p style="font-size:24px;color:#374151;">段落正文</p>' +
      '</div>';
    const out = clamp(agent, input);
    expect(extractTagStyle(out, 'h2')).toContain('font-size:50px');
    expect(extractTagStyle(out, 'p')).toContain('font-size:20px');
  });

  it('T2-2. H3 30px 卡片标题 **不被夹**（H3 ∈ EXEMPT）', () => {
    const input =
      '<div><h3 style="font-size:30px;font-weight:700;">卡片标题</h3><p style="font-size:22px;">内容</p></div>';
    const out = clamp(agent, input);
    expect(extractTagStyle(out, 'h3')).toContain('font-size:30px');
    expect(extractTagStyle(out, 'p')).toContain('font-size:20px');
  });

  it('T2-1b. H1 88px 封面标题不被夹（H1 ∈ EXEMPT）', () => {
    const input = '<div><h1 style="font-size:88px;">封面标题</h1></div>';
    const out = clamp(agent, input);
    expect(extractTagStyle(out, 'h1')).toContain('font-size:88px');
  });
});

describe('R1 Fix · enforceBodyFontSize：Metric 大字豁免（content-stats-highlight）', () => {
  const agent = makeAgent();

  it('T2-3. Metric 56px span（fw=900 + lh=1）典型徽章 **不被夹**', () => {
    const input =
      '<div style="padding:24px 20px;display:flex;flex-direction:column;gap:12px;">' +
      '<span style="font-size:56px;font-weight:900;line-height:1;color:#111827;">+0.5℃</span>' +
      '<h3 style="font-size:28px;">海表温度距平</h3>' +
      '<p style="font-size:24px;">正文说明</p>' +
      '</div>';
    const out = clamp(agent, input);
    // span 仍 56px
    const spanStyle = extractTagStyle(out, 'span');
    expect(spanStyle).toContain('font-size:56px');
    // h3 28px 豁免
    expect(extractTagStyle(out, 'h3')).toContain('font-size:28px');
    // p 24px → 20px（clamp 仍生效）
    expect(extractTagStyle(out, 'p')).toContain('font-size:20px');
  });

  it('T2-4. Metric 48px span（中性色 + fw=900，无 pointer-events:none）规则(c) 豁免', () => {
    const input =
      '<div><span style="font-size:48px;font-weight:900;color:#374151;">+1.2℃</span></div>';
    const out = clamp(agent, input);
    expect(extractTagStyle(out, 'span')).toContain('font-size:48px');
  });

  it('T2-3b. Metric 40px span（pointer-events:none 规则(b)）豁免', () => {
    const input =
      '<div><span style="font-size:40px;pointer-events:none;color:#2563eb;">50%</span></div>';
    const out = clamp(agent, input);
    expect(extractTagStyle(out, 'span')).toContain('font-size:40px');
  });

  it('T2-5a. 普通正文 span 24px → **仍被夹到 20px**（保证 clamp 原意不被削弱）', () => {
    const input = '<div><span style="font-size:24px;color:#374151;">普通正文</span></div>';
    const out = clamp(agent, input);
    expect(extractTagStyle(out, 'span')).toContain('font-size:20px');
  });

  it('T2-5b. 普通正文 span 32px，无 metric 特征 → 夹到 20px（避免豁免写太宽，R0 回退保证）', () => {
    const input =
      '<div><span style="font-size:32px;font-weight:600;color:#374151;">不是大字徽章，不满足 36px 下限或 fw>=800</span></div>';
    const out = clamp(agent, input);
    expect(extractTagStyle(out, 'span')).toContain('font-size:20px');
  });

  it('T2-5c. div 自身 font-size:28px（开标签）→ 夹到 20px（BODY_CLAMP_TAGS）', () => {
    const input = '<div style="font-size:28px;">继承大字号的正文容器</div>';
    const out = clamp(agent, input);
    expect(extractTagStyle(out, 'div')).toContain('font-size:20px');
  });

  it('T2-6. BODY_FONT_SIZE_MIN 下限：li 12px → 16px', () => {
    const input = '<div><ul><li style="font-size:12px;">条目</li></ul></div>';
    const out = clamp(agent, input);
    expect(extractTagStyle(out, 'li')).toContain('font-size:16px');
  });
});

describe('R1 Fix · enforceBodyFontSize：语义 heading 豁免（role=heading / page-title class）', () => {
  const agent = makeAgent();

  it('role="heading" 的 div 不被夹（语义豁免）', () => {
    const input =
      '<div><div role="heading" aria-level="2" style="font-size:50px;">语义 H2</div></div>';
    const out = clamp(agent, input);
    expect(extractTagStyle(out, 'div', 2)).toContain('font-size:50px');
  });

  it('class 含 page-title 的 div 不被夹（class 语义豁免）', () => {
    const input = '<div><div class="page-title xyz" style="font-size:52px;">页面标题</div></div>';
    const out = clamp(agent, input);
    expect(extractTagStyle(out, 'div', 2)).toContain('font-size:52px');
  });
});

describe('R1 Fix · enforceBodyFontSize：SVG 子元素 style 不被 clamp（SVG_RAW_TAGS 跳过）', () => {
  const agent = makeAgent();

  it('<circle style="font-size:30px;"> 保持 30px 不动（SVG 子元素跳过）', () => {
    const input =
      '<div><svg><circle cx="0" cy="0" r="10" style="font-size:30px;overflow-wrap:break-word;"></circle></svg></div>';
    const out = clamp(agent, input);
    expect(out).toContain('font-size:30px');
    expect(out).not.toContain('font-size:20px');
  });

  it('<line style="font-size:40px;"> 保持 40px 不动（SVG 子元素 line 跳过）', () => {
    const input =
      '<div><svg><line x1="0" y1="0" x2="10" y2="10" style="font-size:40px;"></line></svg></div>';
    const out = clamp(agent, input);
    expect(out).toContain('font-size:40px');
    expect(out).not.toContain('font-size:20px');
  });
});

describe('R1 Fix · enforceBodyFontSize：幂等性（round2 不应再修改，T2-8）', () => {
  const agent = makeAgent();

  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => void 0);
  });

  it('T2-8. 同一 HTML 连续两次 enforceBodyFontSize：第二次不应修改任何声明（严格 idempotent）', () => {
    const input =
      '<div style="font-size:28px;">' +
      '<h2 style="font-size:50px;">H2</h2>' +
      '<p style="font-size:22px;">p</p>' +
      '<span style="font-size:56px;font-weight:900;line-height:1;color:#111827;">+0.5℃</span>' +
      '<li style="font-size:12px;">条目</li>' +
      '</div>';
    const r1 = clamp(agent, input, 1);
    // r1 已经把 div 28→20、p 22→20、li 12→16。r2 不应再有修改
    const r2 = clamp(agent, r1, 2);
    // 结构完全相同
    expect(r2).toBe(r1);
    // H2/metric 保持合法值
    expect(extractTagStyle(r2, 'h2')).toContain('font-size:50px');
    expect(extractTagStyle(r2, 'span')).toContain('font-size:56px');
    expect(extractTagStyle(r2, 'div')).toContain('font-size:20px');
    expect(extractTagStyle(r2, 'p')).toContain('font-size:20px');
    expect(extractTagStyle(r2, 'li')).toContain('font-size:16px');
  });
});
