// ================================================================
// Task 1: generateFallbackSlide 字体栈 + H2 渐变修复验证
// 覆盖 getFontStack 与 generateFallbackSlide(修复后) 的字体栈、主色渐变行为
// ================================================================
import { describe, it, expect } from 'vitest';
import type { AIModelProvider } from '../providers/base';
import { HTMLPresentationAgent } from './html-presentation-agent';
import type { SlidePlan } from '../types';
import { darkenColor } from './html-presentation-agent-test-harness';

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

function buildPlan(extra?: Partial<SlidePlan>): SlidePlan {
  return {
    pageType: 'content',
    title: '测试标题 Test Title',
    keyPoints: ['要点一', '要点二 Key Point 2'],
    needsImage: false,
    ...extra,
  };
}

function getOuterStyle(html: string): string {
  const m = html.match(/^<div(?:\s[^>]*)?>/i);
  if (!m) return '';
  const sm = m[0].match(/style="([^"]*)"/i);
  return sm ? sm[1] : '';
}

function getOuterFontFamily(html: string): string {
  const style = getOuterStyle(html);
  const m = style.match(/font-family\s*:\s*([^;]+)/i);
  return m ? m[1].trim() : '';
}

function getH2Style(html: string): string {
  const m = html.match(/<h2\s+style="([^"]*)"/i);
  return m ? m[1] : '';
}

describe('Task 1: getFontStack + generateFallbackSlide 字体栈与主色渐变', () => {
  const agent = makeAgent() as AnyAgent;

  // ---- 纯 getFontStack 覆盖 ----
  it('getFontStack(mono) 返回 JetBrains Mono / Cascadia Code / Noto Sans Mono CJK SC 栈', () => {
    const r = agent.getFontStack('mono');
    expect(r).toContain('JetBrains Mono');
    expect(r).toContain('Cascadia Code');
    expect(r).toContain('Noto Sans Mono CJK SC');
    expect(r).toContain('monospace');
  });

  it('getFontStack(sans) 返回 system-ui/-apple-system/PingFang SC 等 sans 栈', () => {
    const r = agent.getFontStack('sans');
    expect(r).toContain('system-ui');
    expect(r).toContain('PingFang SC');
    expect(r).toContain('Microsoft YaHei');
    expect(r).toContain('sans-serif');
  });

  it('getFontStack(serif) 返回 Georgia / SimSun / Songti SC 等 serif 栈', () => {
    const r = agent.getFontStack('serif');
    expect(r).toContain('Georgia');
    expect(r).toContain('Times New Roman');
    expect(r).toContain('SimSun');
    expect(r).toContain('Songti SC');
    expect(r).toContain('serif');
  });

  // ================= 必须覆盖的 4 条用例 =================

  it('1. fontFamily=mono + primaryColor=#7c3aed：外层 mono 栈；H2 紫色渐变且无 color:#111827', () => {
    const html: string = (agent as any).generateFallbackSlide(
      buildPlan(),
      '#7c3aed',
      1280,
      720,
      'mono',
    );

    // 外层 div 必须完整（仍有 8 大基础属性）；data-degraded="true" 标记极简兜底页
    expect(html).toMatch(/^<div(?:\s[^>]*)?style="[^"]+"/i);
    expect(html).toContain('data-degraded="true"');
    const outerStyle = getOuterStyle(html);
    expect(outerStyle).toContain('width:100%');
    expect(outerStyle).toContain('height:100%');
    expect(outerStyle).toContain('overflow:hidden');
    expect(outerStyle).toContain('position:relative');
    expect(outerStyle).toContain('box-sizing:border-box');
    expect(outerStyle).toContain('display:flex');
    expect(outerStyle).toContain('flex-direction:column');
    expect(outerStyle).toContain('background-color:#fff');

    const outerFF = getOuterFontFamily(html);
    // 断言含 mono 栈的任一特征
    const hasMonoMarker = /JetBrains Mono|Cascadia Code|Noto Sans Mono CJK SC/i.test(outerFF);
    expect(hasMonoMarker).toBe(true);

    // 断言外层 font-family 不是 sans 栈的 "system-ui,-apple-system,..." 主序列
    // 注意：允许值里尾随 monospace，但不允许出现 system-ui/-apple-system 作为主值
    expect(outerFF).not.toMatch(/^system-ui\s*,\s*-apple-system/i);

    // H2 渐变包含主色
    const h2 = getH2Style(html);
    expect(h2).toContain('linear-gradient(135deg,#7c3aed');
    expect(h2).toContain('-webkit-background-clip:text');
    expect(h2).toContain('-webkit-text-fill-color:transparent');
    expect(h2).toContain('background-clip:text');

    // H2 不含 color:#111827，也不应出现 color:<value> 的独立声明（注意要和
    // background-clip / -webkit-text-fill-color 等带连字符前缀的区分开）
    expect(h2).not.toContain('#111827');
    // 只匹配 ";color:" 或开头的 "color:"（不含连字符前缀，排除 -background-clip 等）
    expect(h2).not.toMatch(/(?:^|;)color\s*:/i);
  });

  it('2. fontFamily=sans + primaryColor=#ea580c：外层 sans 栈；H2 橙色渐变，非紫非蓝', () => {
    const html: string = (agent as any).generateFallbackSlide(
      buildPlan(),
      '#ea580c',
      1280,
      720,
      'sans',
    );

    const outerFF = getOuterFontFamily(html);
    expect(outerFF).toContain('system-ui');

    const h2 = getH2Style(html);
    // 渐变包含活力橙 #ea580c
    expect(h2).toContain('linear-gradient(135deg,#ea580c');
    // 不被写死成紫色/蓝色
    expect(h2).not.toContain('#7c3aed');
    expect(h2).not.toContain('#2563eb');
    expect(h2).not.toMatch(/(?:^|;)color\s*:/i);
  });

  it('3. fontFamily=serif + primaryColor=#059669：外层 serif 栈；H2 绿色渐变', () => {
    const html: string = (agent as any).generateFallbackSlide(
      buildPlan(),
      '#059669',
      1280,
      720,
      'serif',
    );

    const outerFF = getOuterFontFamily(html);
    expect(outerFF).toContain('Georgia');

    const h2 = getH2Style(html);
    // 绿色 darker = darkenColor(#059669,20%)，需出现在渐变
    const darker = darkenColor('#059669', 20).toLowerCase();
    expect(h2).toContain(`linear-gradient(135deg,#059669,${darker})`);
    expect(h2).not.toMatch(/(?:^|;)color\s*:/i);
  });

  it('4. primaryColor=#2563eb（蓝）回归：H2 含 #2563eb 与 #1e4fbc(或其他蓝 darker)', () => {
    const html: string = (agent as any).generateFallbackSlide(
      buildPlan(),
      '#2563eb',
      1280,
      720,
      'sans',
    );

    const h2 = getH2Style(html);
    // 蓝主色必现
    expect(h2).toContain('#2563eb');
    // darker 为 darkenColor(#2563eb,20%)
    const darker = darkenColor('#2563eb', 20).toLowerCase();
    expect(darker).toBe('#1e4fbc'); // 防 regress：若算法变动会在此报警
    expect(h2).toContain('#1e4fbc');
    expect(h2).toContain('linear-gradient(135deg,#2563eb,#1e4fbc)');
  });
});
