// ================================================================
// Task 5: slide-08 总结页居中三件套守卫单测
// 覆盖 TR-5.1 / TR-5.2 / TR-5.3，以及 三分支（A/B/C）强制触发场景
// ================================================================
import { describe, it, expect } from 'vitest';
import type { AIModelProvider } from '../providers/base';
import { HTMLPresentationAgent } from './html-presentation-agent';
import { parseStyleDeclarations } from '@noppt/core';

type AnyAgent = HTMLPresentationAgent & Record<string, any>;

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

function getOuterStyle(html: string): string {
  const m = html.match(/^<div([^>]*)>/i);
  if (!m) return '';
  const sm = m[1].match(/style="([^"]*)"/i);
  return sm ? sm[1] : '';
}

/** 判断三件套是否同时出现（justify-content:center + align-items:center + text-align:center） */
function hasTripleCentering(style: string): boolean {
  const hasJC = /justify-content\s*:\s*center/i.test(style);
  const hasAI = /align-items\s*:\s*center/i.test(style);
  const hasTA = /text-align\s*:\s*center/i.test(style);
  return hasJC && hasAI && hasTA;
}

function classifyBranch(existingStyle: string, parsed: ReturnType<typeof parseStyleDeclarations>, styles: Record<string, string>): { ok8: boolean; parseFailed: boolean; branch: 'A' | 'B' | 'C' | 'none' } {
  const has = (r: RegExp) => r.test(existingStyle);
  const ok8 =
    has(/(?:^|;)\s*width\s*:\s*100%\s*(?:;|$)/i) &&
    has(/(?:^|;)\s*height\s*:\s*100%\s*(?:;|$)/i) &&
    has(/(?:^|;)\s*overflow\s*:\s*hidden\s*(?:;|$)/i) &&
    has(/(?:^|;)\s*position\s*:\s*relative\s*(?:;|$)/i) &&
    has(/(?:^|;)\s*box-sizing\s*:\s*border-box\s*(?:;|$)/i) &&
    has(/(?:^|;)\s*padding\s*:/i) && !/(?:^|;)\s*padding\s*:\s*0(?:px)?\s*(?:;|$)/i.test(existingStyle) &&
    has(/(?:^|;)\s*display\s*:\s*flex\s*(?:;|$)/i) &&
    has(/(?:^|;)\s*flex-direction\s*:\s*(?:column|row)\s*(?:;|$)/i);

  // estimateDeclCount
  const estimateDeclCount = (() => {
    let n = 1; let inQ: 0 | 1 | 2 = 0; let dep = 0;
    for (let k = 0; k < existingStyle.length; k++) {
      const c = existingStyle[k];
      if (dep === 0) {
        if (c === "'" && inQ !== 2) inQ = inQ === 1 ? 0 : 1;
        else if (c === '"' && inQ !== 1) inQ = inQ === 2 ? 0 : 2;
      }
      if (inQ === 0) {
        if (c === '(') dep++; else if (c === ')') dep--;
        else if (c === ';' && dep === 0) n++;
      }
    }
    return n;
  })();
  const est = estimateDeclCount;
  const parseFailed = existingStyle
    && parsed.length > 0
    && (parsed.length < Math.ceil(est * 0.7)
      || !(styles['display'] || '').trim()
      || !(styles['width'] || '').trim()
      || !(styles['height'] || '').trim());

  let branch: 'A' | 'B' | 'C' | 'none' = 'none';
  if (existingStyle && ok8) branch = 'A';
  else if (parseFailed) branch = 'B';
  else branch = 'C';

  return { ok8, parseFailed, branch };
}

function analyzeBranch(html: string): { branch: 'A' | 'B' | 'C' | 'none'; ok8: boolean; parseFailed: boolean; layoutShouldCenter_initial: boolean; hasContentSign: boolean } {
  const result = html.trim();
  const outerDivMatch = result.match(/^<div([^>]*)>([\s\S]*)<\/div>$/i);
  const attrs = outerDivMatch ? outerDivMatch![1] || '' : '';
  const inner = outerDivMatch ? outerDivMatch![2] || '' : result;
  const styleMatch = attrs.match(/style="([^"]*)"/i);
  const existingStyle = (styleMatch ? styleMatch![1] : '').trim();

  const stripHtmlComments = (s: string): string => s.replace(/<!--[\s\S]*?-->/g, '');
  const CONTENT_SIGN_RE = /<h[23]\b|<(ul|ol)\b|<img[\s>]|<table\b/i;
  const isCoverLike = (s: string): boolean => {
    const clean = stripHtmlComments(s);
    if (CONTENT_SIGN_RE.test(clean)) return false;
    const low = clean.toLowerCase();
    const h1Count = (low.match(/<h1\b/g) || []).length;
    return h1Count >= 1;
  };
  const layoutShouldCenter_initial = isCoverLike(inner);
  const hasContentSign = CONTENT_SIGN_RE.test(stripHtmlComments(inner));

  const parsed = existingStyle ? parseStyleDeclarations(existingStyle) : [];
  const styles: Record<string, string> = {};
  for (const { key, value } of parsed) styles[key] = value;

  const { branch, ok8, parseFailed } = classifyBranch(existingStyle, parsed, styles);
  return { branch, ok8, parseFailed, layoutShouldCenter_initial, hasContentSign };
}

describe('Task 5: slide-08 总结页居中三件套守卫 (centering guard)', () => {
  const agent = makeAgent() as AnyAgent;

  // ============================================================
  // TR-5.1: generateFallbackSlide 标准 h2+ul 产物 → 三件套不同时出现
  // ============================================================
  it('TR-5.1: slide-08 fallback (h2+ul summary) → 外层 style 禁止三件套同时出现', () => {
    const slidePlan = {
      index: 8,
      pageType: 'summary' as const,
      title: '认识自然规律，提升全社会的气候韧性',
      keyPoints: [
        '建立全球气候监测预警网络',
        '加强农业基础设施抗灾能力',
        '完善应急响应和物资储备体系',
        '推动低碳转型和绿色金融',
        '开展气候韧性教育和公众科普',
      ],
    };
    const html = agent.generateFallbackSlide(slidePlan, '#7c3aed', 1280, 720, 'mono') as string;

    // 先断言输入本身不含三件套（generateFallbackSlide 不应自己写居中）
    expect(hasTripleCentering(getOuterStyle(html))).toBe(false);

    // 分支诊断
    const diag = analyzeBranch(html);
    console.log('[TR-5.1] 分支诊断:', diag);

    const out = agent.ensureOuterContainer(html, 1280, 720, 'mono') as string;
    const outStyle = getOuterStyle(out);
    console.log('[TR-5.1] 输出 style:', outStyle);
    console.log('[TR-5.1] 三件套同时出现?', hasTripleCentering(outStyle));

    // 关键断言：三件套不得同时出现
    expect(hasTripleCentering(outStyle)).toBe(false);
  });

  // ============================================================
  // TR-5.2: 封面极简 H1 → 三件套仍被注入（守卫不误伤）
  // ============================================================
  it('TR-5.2: 极简封面 H1 (无 h2/ul) → 三件套必须被正确注入', () => {
    const coverHtml = `<div style="width:100%;height:100%;overflow:hidden"><h1 style="text-align:center">封面</h1></div>`;

    const diag = analyzeBranch(coverHtml);
    console.log('[TR-5.2] 分支诊断:', diag);

    const out = agent.ensureOuterContainer(coverHtml, 1280, 720, 'mono') as string;
    const style = getOuterStyle(out);
    console.log('[TR-5.2] 输出 style:', style);
    console.log('[TR-5.2] 三件套同时出现?', hasTripleCentering(style));

    // 反例断言：极简封面必须三件套齐全
    expect(hasTripleCentering(style)).toBe(true);
  });

  // ============================================================
  // TR-5.3: 仅 <h2> 标题（无 bullets/ul）→ 结果记录见注释
  //   说明：按 layoutShouldCenter 期望，有 h2 即 CONTENT_SIGN_RE 命中，
  //   isCoverLike 返回 false → 三件套禁止。此处显式验证以防 CONTENT_SIGN_RE 的
  //   <h[23]\b 守卫失效（比如 h2 大小写问题）。
  // ============================================================
  it('TR-5.3: 仅有 h2 标题无 ul/li → 三件套应不出现（因 CONTENT_SIGN_RE 含 <h2，isCoverLike=false）。若出现则 CONTENT_SIGN_RE 守卫漏判需紧急修复。', () => {
    // 8 大特征全有，inner 仅含 <h2>（模拟无 bullet 的 summary 降级情况，用 mono 字体栈模拟完整 outer）
    const monoStack = "'JetBrains Mono', ui-monospace, 'Cascadia Code', monospace";
    const h2OnlyHtml = `<div style="width:100%;height:100%;overflow:hidden;position:relative;box-sizing:border-box;padding:48px 64px;display:flex;flex-direction:column;background-color:#fff;font-family:${monoStack};">` +
      `<h2 style="font-size:48px;font-weight:700;">仅标题无列表</h2></div>`;

    const diag = analyzeBranch(h2OnlyHtml);
    console.log('[TR-5.3] 分支诊断:', diag);
    // 断言：有 <h2> 即 hasContentSign=true，layoutShouldCenter 应为 false
    expect(diag.hasContentSign).toBe(true);
    expect(diag.layoutShouldCenter_initial).toBe(false);

    const out = agent.ensureOuterContainer(h2OnlyHtml, 1280, 720, 'mono') as string;
    const style = getOuterStyle(out);
    console.log('[TR-5.3] 输出 style:', style);
    console.log('[TR-5.3] 三件套同时出现?', hasTripleCentering(style));

    // 预期结果（记录）：h2-only 有内容标记 → 三件套不同时出现
    // 【结果说明】：有 h2 标记即非"封面"，不应整体居中。
    expect(hasTripleCentering(style)).toBe(false);
  });

  // ============================================================
  // 分支专项回归：强制触发 Branch C (Map 重写，ok8=false, parseFailed=false)
  // 构造方式：故意缺失 position:relative（ok8 8 大特征缺一），
  // 但保留 width/height/display（避免 parseFailed=true），使走 Map 分支。
  // 此场景是 tasks.md L85 注记中提到的"ok8=false 但 parseFailed=false"风险点。
  // ============================================================
  it('TR-5.1-C (Branch C 专项): h2+ul 强制进入 Map 分支 (ok8=false, parseFailed=false) → 三件套仍不应出现', () => {
    const monoStack = "'JetBrains Mono', ui-monospace, 'Cascadia Code', monospace";
    // 故意去掉 position:relative（ok8 的 8 大特征缺一）
    const styleNoPosition =
      `width:100%;height:100%;overflow:hidden;box-sizing:border-box;padding:48px 64px;display:flex;flex-direction:column;background-color:#fff;font-family:${monoStack}`;
    const h2UlContent = `\n  <h2 style="font-size:48px;font-weight:700;">认识自然规律，提升全社会的气候韧性</h2>\n  <div style="flex:1;"><ul style="margin:0;padding-left:24px;">` +
      `<li>建立全球气候监测预警网络</li><li>加强农业基础设施抗灾能力</li></ul></div>\n`;
    const html = `<div style="${styleNoPosition}">${h2UlContent}</div>`;

    const diag = analyzeBranch(html);
    console.log('[TR-5.1-C] 分支诊断:', diag);
    // 断言进入了预期的 Branch C
    expect(diag.branch).toBe('C');
    expect(diag.ok8).toBe(false);
    expect(diag.parseFailed).toBe(false);
    expect(diag.hasContentSign).toBe(true);
    expect(diag.layoutShouldCenter_initial).toBe(false);

    const out = agent.ensureOuterContainer(html, 1280, 720, 'mono') as string;
    const style = getOuterStyle(out);
    console.log('[TR-5.1-C] 输出 style:', style);
    console.log('[TR-5.1-C] 三件套同时出现?', hasTripleCentering(style));

    // Map 分支下，三件套仍不得同时出现（否则 Branch C 守卫失效）
    expect(hasTripleCentering(style)).toBe(false);
    // 额外断言：Map 分支应补上缺失的 position:relative（required 兜底）
    expect(style).toContain('position:relative');
  });

  // ============================================================
  // 分支专项回归：强制触发 Branch B (parseFailed=true)
  // 构造方式：故意缺失 display（parseFailed 条件：!styles.display），
  // 同时 ok8 的 position:relative 也缺失保证不走 ok8。
  // ============================================================
  it('TR-5.1-B (Branch B 专项): h2+ul 强制进入 parseFailed 分支 → 三件套仍不应出现', () => {
    const monoStack = "'JetBrains Mono', ui-monospace, 'Cascadia Code', monospace";
    // 故意缺 display 和 position（缺 display → parseFailed；缺 position → ok8=false）
    const styleNoDisplay =
      `width:100%;height:100%;overflow:hidden;box-sizing:border-box;padding:48px 64px;flex-direction:column;background-color:#fff;font-family:${monoStack}`;
    const h2UlContent = `\n  <h2 style="font-size:48px;">总结标题</h2>\n  <ul><li>条目一</li><li>条目二</li></ul>\n`;
    const html = `<div style="${styleNoDisplay}">${h2UlContent}</div>`;

    const diag = analyzeBranch(html);
    console.log('[TR-5.1-B] 分支诊断:', diag);
    // 断言进入 Branch B
    expect(diag.branch).toBe('B');
    expect(diag.parseFailed).toBe(true);
    expect(diag.hasContentSign).toBe(true);
    expect(diag.layoutShouldCenter_initial).toBe(false);

    const out = agent.ensureOuterContainer(html, 1280, 720, 'mono') as string;
    const style = getOuterStyle(out);
    console.log('[TR-5.1-B] 输出 style:', style);
    console.log('[TR-5.1-B] 三件套同时出现?', hasTripleCentering(style));

    // parseFailed 分支下，三件套不得同时出现
    expect(hasTripleCentering(style)).toBe(false);
    // parseFailed 分支应补上 display:flex
    expect(style).toContain('display:flex');
  });
});
