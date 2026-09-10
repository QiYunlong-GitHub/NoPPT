// ================================================================
// Bug-3 三件套注入源白盒定位测试
// ================================================================
import { describe, it, expect } from 'vitest';
import type { AIModelProvider } from '../providers/base';
import { HTMLPresentationAgent } from './html-presentation-agent';
import { parseStyleDeclarations } from '@noppt/core';

const SUMMARY_HTML_05 = `<div style="width:100%;height:100%;overflow:hidden;position:relative;box-sizing:border-box;padding:48px 64px;display:flex;flex-direction:column;background-color:#fff;font-family:'JetBrains Mono', ui-monospace, 'Cascadia Code', Consolas, 'Noto Sans Mono CJK SC', monospace;">
  <div style="position:absolute;top:24px;right:24px;width:128px;height:128px;border-radius:50%;background:linear-gradient(135deg,#7c3aed15,#7c3aed08);pointer-events:none;"></div>
  <div style="position:absolute;bottom:32px;left:32px;width:96px;height:96px;border-radius:50%;background:linear-gradient(135deg,#7c3aed10,#7c3aed05);pointer-events:none;"></div>
  
  <h2 style="font-size:50px;font-weight:700;margin:0 0 32px 0;line-height:1.25;overflow-wrap:break-word;word-break:break-word;">科学监测与全球协作是应对气候异常的关键</h2>
  
  <ul style="display:flex;flex-direction:column;gap:24px;list-style:none;padding:0;margin:0;">
    <li style="display:flex;align-items:center;gap:16px;padding:16px 24px;border-radius:16px;background:#7c3aed08;">
      <span style="display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:40px;height:40px;border-radius:8px;background:#7c3aed12;font-size:20px;line-height:1;">🛰️</span>
      <span style="font-size:19px;color:#374151;font-weight:500;line-height:1.7;flex:1;">强化气象卫星与海洋浮标的实时监测网络</span>
    </li>
    <li style="display:flex;align-items:center;gap:16px;padding:16px 24px;border-radius:16px;background:#7c3aed08;">
      <span style="display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:40px;height:40px;border-radius:8px;background:#7c3aed12;font-size:20px;line-height:1;">🤝</span>
      <span style="font-size:19px;color:#374151;font-weight:500;line-height:1.7;flex:1;">建立跨国气候预警与农业减灾应急机制</span>
    </li>
    <li style="display:flex;align-items:center;gap:16px;padding:16px 24px;border-radius:16px;background:#7c3aed08;">
      <span style="display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:40px;height:40px;border-radius:8px;background:#7c3aed12;font-size:20px;line-height:1;">🌱</span>
      <span style="font-size:19px;color:#374151;font-weight:500;line-height:1.7;flex:1;">推动能源转型与碳减排缓解长期气候变暖</span>
    </li>
  </ul>
</div>`;

const COVER_HTML = `<div style="width:100%;height:100%;overflow:hidden;position:relative;box-sizing:border-box;padding:48px 64px;display:flex;flex-direction:column;background-color:#fff;font-family:sans;"><h1 style="font-size:80px;">大标题</h1><p style="font-size:28px;">副标题</p></div>`;

const TRIPLE_REG = /justify-content\s*:\s*center|align-items\s*:\s*center|text-align\s*:\s*center/i;

function getOuterStyle(html: string): string {
  const m = html.match(/^<div([^>]*)>/i);
  if (!m) return '';
  const sm = m[1].match(/style="([^"]*)"/i);
  return sm ? sm[1] : '';
}

function makeAgent(): HTMLPresentationAgent {
  const dummy: AIModelProvider = {
    name: 'dummy',
    async chat() { return { role: 'assistant', content: '' }; },
    supportsStreaming: false,
  } as unknown as AIModelProvider;
  return new HTMLPresentationAgent(dummy);
}

type AnyAgent = HTMLPresentationAgent & Record<string, any>;

describe('Bug-3 注入源定位 + 修复验证', () => {
  const agent = makeAgent() as AnyAgent;

  it('0-0 原始 SUMMARY 外层 div 不应含三件套', () => {
    const style = getOuterStyle(SUMMARY_HTML_05);
    console.log('[0-0] 原始 SUMMARY 外层 style:', style);
    expect(TRIPLE_REG.test(style)).toBe(false);
  });

  it('0-1 SUMMARY ok8 条件应命中', () => {
    const style = getOuterStyle(SUMMARY_HTML_05);
    const has = (r: RegExp) => r.test(style);
    const ok8 =
      has(/(?:^|;)\s*width\s*:\s*100%\s*(?:;|$)/i) &&
      has(/(?:^|;)\s*height\s*:\s*100%\s*(?:;|$)/i) &&
      has(/(?:^|;)\s*overflow\s*:\s*hidden\s*(?:;|$)/i) &&
      has(/(?:^|;)\s*position\s*:\s*relative\s*(?:;|$)/i) &&
      has(/(?:^|;)\s*box-sizing\s*:\s*border-box\s*(?:;|$)/i) &&
      has(/(?:^|;)\s*padding\s*:/i) && !/(?:^|;)\s*padding\s*:\s*0(?:px)?\s*(?:;|$)/i.test(style) &&
      has(/(?:^|;)\s*display\s*:\s*flex\s*(?:;|$)/i) &&
      has(/(?:^|;)\s*flex-direction\s*:\s*(?:column|row)\s*(?:;|$)/i);
    console.log('[0-1] ok8 =', ok8);
    expect(ok8).toBe(true);
  });

  it('0-2 parseStyleDeclarations 解析率（是否 parseFailed）', () => {
    const style = getOuterStyle(SUMMARY_HTML_05);
    const parsed = parseStyleDeclarations(style);
    console.log('[0-2] parsed.length =', parsed.length, ' keys =', parsed.map(p => p.key));
    let estimateDeclCount = 1; let inQ: 0 | 1 | 2 = 0; let dep = 0;
    for (let k = 0; k < style.length; k++) {
      const c = style[k];
      if (dep === 0) {
        if (c === "'" && inQ !== 2) inQ = inQ === 1 ? 0 : 1;
        else if (c === '"' && inQ !== 1) inQ = inQ === 2 ? 0 : 2;
      }
      if (inQ === 0) {
        if (c === '(') dep++; else if (c === ')') dep--;
        else if (c === ';' && dep === 0) estimateDeclCount++;
      }
    }
    const threshold = Math.ceil(estimateDeclCount * 0.7);
    const failed = parsed.length > 0 && (parsed.length < threshold);
    console.log(`[0-2] estimate=${estimateDeclCount}, threshold=ceil*0.7=${threshold}, parsed=${parsed.length}, parseFailed=${failed}`);
    const ff = parsed.find(p => p.key === 'font-family');
    console.log('[0-2] font-family value =', ff ? JSON.stringify(ff.value) : '(missing)');
  });

  it('0-3 inner 内容标记检查 + isCoverLike 推算', () => {
    const outer = SUMMARY_HTML_05.match(/^<div([^>]*)>([\s\S]*)<\/div>$/i);
    const inner = outer ? outer[2] : '';
    const hasH2 = /<h2\b/i.test(inner);
    const hasH3 = /<h3\b/i.test(inner);
    const hasUl = /<(ul|ol)\b/i.test(inner);
    const hasH1 = /<h1\b/i.test(inner);
    console.log(`[0-3] h2=${hasH2}, h3=${hasH3}, ul/ol=${hasUl}, h1=${hasH1}`);
    const coverLike = !hasH2 && !hasH3 && !hasUl && !/<img[\s>]/i.test(inner) && !/<table\b/i.test(inner) && hasH1;
    console.log(`[0-3] isCoverLike 推算 = ${coverLike}`);
    expect(coverLike).toBe(false);
  });

  it('1. ensureOuterContainer(SUMMARY) 外层不应注入三件套', () => {
    const out = agent.ensureOuterContainer.call(agent, SUMMARY_HTML_05, 1280, 720);
    const style = getOuterStyle(out);
    const jc = /justify-content\s*:\s*center/i.test(style);
    const ai = /align-items\s*:\s*center/i.test(style);
    const ta = /text-align\s*:\s*center/i.test(style);
    console.log('[1] ensureOuterContainer: JC=%s, AI=%s, TA=%s', jc, ai, ta);
    console.log('[1] outer style =', style);
    expect(jc).toBe(false);
    expect(ai).toBe(false);
    expect(ta).toBe(false);
  });

  it('2. postProcessLayout(SUMMARY, summary, 1280, 720, #7c3aed) 外层不应含三件套', () => {
    const out = agent.postProcessLayout.call(agent, SUMMARY_HTML_05, 'summary', 1280, 720, '#7c3aed');
    const style = getOuterStyle(out);
    const jc = /justify-content\s*:\s*center/i.test(style);
    const ai = /align-items\s*:\s*center/i.test(style);
    const ta = /text-align\s*:\s*center/i.test(style);
    console.log('[2] postProcessLayout: JC=%s, AI=%s, TA=%s', jc, ai, ta);
    console.log('[2] outer style =', style);
    expect(jc).toBe(false);
    expect(ai).toBe(false);
    expect(ta).toBe(false);
    expect(style).toContain('padding:48px 64px');
    expect(style).toContain('JetBrains Mono');
    expect(/flex-direction\s*:\s*column/i.test(style)).toBe(true);
    const h2m = out.match(/<h2([^>]*style=")([^"]*)"/i);
    if (h2m) {
      console.log('[2] h2 style =', h2m[2]);
      expect(/text-align\s*:\s*center/i.test(h2m[2])).toBe(false);
    }
  });

  it('3. enforceCoverPosterArtStyles(SUMMARY) 不应注入三件套', () => {
    const out = agent.enforceCoverPosterArtStyles.call(agent, SUMMARY_HTML_05, '#7c3aed', 1280, 720);
    const style = getOuterStyle(out);
    const jc = /justify-content\s*:\s*center/i.test(style);
    const ai = /align-items\s*:\s*center/i.test(style);
    const ta = /text-align\s*:\s*center/i.test(style);
    console.log('[3] enforceCoverPosterArtStyles: JC=%s, AI=%s, TA=%s', jc, ai, ta);
    expect(jc).toBe(false);
    expect(ai).toBe(false);
    expect(ta).toBe(false);
  });

  it('4. enforceImageContainerStyles(SUMMARY) 外层不应注入三件套', () => {
    const out = agent.enforceImageContainerStyles.call(agent, SUMMARY_HTML_05);
    const style = getOuterStyle(out);
    const jc = /justify-content\s*:\s*center/i.test(style);
    const ai = /align-items\s*:\s*center/i.test(style);
    console.log('[4] enforceImageContainerStyles: JC=%s, AI=%s', jc, ai);
    expect(jc).toBe(false);
    expect(ai).toBe(false);
  });

  it('5-1. COVER 原始 outer 检查', () => {
    const style = getOuterStyle(COVER_HTML);
    console.log('[5-1] cover 原始 style =', style);
  });

  it('5-2. COVER 经 postProcessLayout 必须保留三件套（封面居中预期）', () => {
    const out = agent.postProcessLayout.call(agent, COVER_HTML, 'cover', 1280, 720, '#7c3aed');
    const style = getOuterStyle(out);
    const jc = /justify-content\s*:\s*center/i.test(style);
    const ai = /align-items\s*:\s*center/i.test(style);
    const ta = /text-align\s*:\s*center/i.test(style);
    console.log('[5-2] cover 最终: JC=%s, AI=%s, TA=%s', jc, ai, ta);
    console.log('[5-2] cover 最终 outer style =', style);
    expect(jc).toBe(true);
    expect(ai).toBe(true);
    expect(ta).toBe(true);
  });
});
