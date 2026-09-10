// ================================================================
// Task 3: fontFamily 透传链路验证（postProcessHtmlSnapshot → postProcessSlideHtml → postProcessLayout → ensureOuterContainer）
// 覆盖 3 层签名新增 fontFamily 参数后的透传正确性 + 颜色参数不串值防回归
// ================================================================
import { describe, it, expect } from 'vitest';
import type { AIModelProvider } from '../providers/base';
import { HTMLPresentationAgent } from './html-presentation-agent';

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

function getOuterFontFamily(html: string): string {
  const style = getOuterStyle(html);
  const m = style.match(/font-family\s*:\s*([^;]+)/i);
  return m ? m[1].trim() : '';
}

// 构造最小 slidePlan（只含 pageType）
function makeSlidePlan(pageType: string = 'content-no-image'): any {
  return {
    pageType,
    title: 'Test',
    keyPoints: [],
    needsImage: false,
  };
}

// 构造可触发 ok8 分支的输入 HTML（8 大特征全有，故意省略 font-family）
function makeOk8InputHtml(): string {
  return (
    `<div style="width:100%;height:100%;overflow:hidden;position:relative;box-sizing:border-box;padding:48px 64px;display:flex;flex-direction:column;background-color:#fff;">` +
    `<h2>hello</h2><p>body content</p></div>`
  );
}

describe('Task 3: fontFamily 透传链路验证', () => {
  const agent = makeAgent() as AnyAgent;

  // ======== Test 1：postProcessSlideHtml fontFamily=mono 透传 ========
  it('Test 1: postProcessSlideHtml fontFamily=mono → 外层补 JetBrains Mono/Cascadia Code 栈（不是 sans 栈）', () => {
    const html = makeOk8InputHtml();
    const slidePlan = makeSlidePlan();

    const out = (agent as any).postProcessSlideHtml(
      html,
      slidePlan,
      '#7c3aed', // primaryColor (purple)
      '#632ebe', // primaryColorDarker (purple darker)
      1280,
      720,
      false, // backgroundEnabled
      'mono', // fontFamily 第 8 个参数
    ) as string;

    const ff = getOuterFontFamily(out);
    expect(ff).toBeTruthy();
    // 断言 mono 栈标记存在
    const hasMonoMarker = /JetBrains Mono|Cascadia Code|Noto Sans Mono CJK SC|ui-monospace/i.test(
      ff,
    );
    expect(hasMonoMarker).toBe(true);
    // 断言不是默认 sans 栈（system-ui 开头）
    expect(ff).not.toMatch(/^system-ui\s*,\s*-apple-system/i);
  });

  // ======== Test 2：postProcessSlideHtml 不传 fontFamily → 回归默认 sans ========
  it('Test 2: postProcessSlideHtml 不传 fontFamily（默认 sans）→ 外层补 system-ui sans 栈', () => {
    const html = makeOk8InputHtml();
    const slidePlan = makeSlidePlan();

    // 不传最后一个参数 fontFamily，应默认为 'sans'
    const out = (agent as any).postProcessSlideHtml(
      html,
      slidePlan,
      '#7c3aed',
      '#632ebe',
      1280,
      720,
      false,
      // 故意省略 fontFamily → 依赖默认值 'sans'
    ) as string;

    const ff = getOuterFontFamily(out);
    expect(ff).toBeTruthy();
    // 断言 sans 栈：以 system-ui,-apple-system 开头，且含 PingFang SC 等中文 sans fallback
    expect(ff).toMatch(/^system-ui\s*,\s*-apple-system/i);
    const hasSansMarker = /PingFang SC|Microsoft YaHei|Hiragino Sans GB/i.test(ff);
    expect(hasSansMarker).toBe(true);
    // 断言不含 mono 标记
    expect(ff).not.toMatch(/JetBrains Mono|Cascadia Code/i);
  });

  // ======== Test 3：postProcessHtmlSnapshot opts.fontFamily=serif 透传 ========
  it('Test 3: postProcessHtmlSnapshot opts.fontFamily=serif + primaryColor → 外层补 Georgia/SimSun 栈', () => {
    const html = makeOk8InputHtml();

    const out = agent.postProcessHtmlSnapshot(html, {
      fontFamily: 'serif',
      primaryColor: '#059669', // 绿色
    }) as string;

    const ff = getOuterFontFamily(out);
    expect(ff).toBeTruthy();
    // 断言 serif 栈：Georgia + SimSun/宋体 + serif
    expect(ff).toContain('Georgia');
    const hasSerifMarker = /SimSun|Source Han Serif SC|Noto Serif SC|宋体/i.test(ff);
    expect(hasSerifMarker).toBe(true);
    expect(ff).toContain('serif');
    // 断言不是 sans 栈（不应以 system-ui 开头）
    expect(ff).not.toMatch(/^system-ui/i);
    // 断言不含 mono 标记
    expect(ff).not.toMatch(/JetBrains Mono|Cascadia Code/i);
  });

  // ======== Test 4：颜色未被串值的防回归 ========
  it('Test 4: 防参数错位串值——紫色 darker 不应产出蓝色 #2563eb，颜色链路正常', () => {
    const html = makeOk8InputHtml();
    const slidePlan = makeSlidePlan();

    // 传入紫色系 primaryColor + primaryColorDarker
    // 如果参数错位（fontFamily 被插到中间导致 primaryColor 与 fontFamily 串值），
    // 则会出现默认蓝 #2563eb 或颜色完全错乱的情况。
    const out = (agent as any).postProcessSlideHtml(
      html,
      slidePlan,
      '#7c3aed', // primaryColor: purple
      '#632ebe', // primaryColorDarker: purple darker（深紫 ≈ darkenColor(#7c3aed, 20%)）
      1280,
      720,
      false,
      'serif', // fontFamily 放在最后（第 8 位），正确位置
    ) as string;

    // 断言 1：默认蓝色 #2563eb 不应该出现在输出中（颜色处理链应用的是紫色系）
    // （sanitizeGradientColors / enforceSinglePalette 会把任何杂色强制替换为传入的紫色系）
    expect(out).not.toContain('#2563eb');
    expect(out).not.toContain('#2563EB');

    // 断言 2：输入的紫色 darker #632ebe 应该保留（或至少存在紫色系颜色）
    // 验证 enforceSinglePalette 仍然工作：应该出现 primaryColor #7c3aed 或其 darker
    const hasPurple = /#7c3aed|#632ebe/i.test(out);
    expect(hasPurple).toBe(true);

    // 断言 3：fontFamily 应该是 serif（验证第 8 参数没有被当颜色处理）
    const ff = getOuterFontFamily(out);
    expect(ff).toContain('Georgia');
    // fontFamily 是 'serif' 字符串，不会被解析成颜色——若出现 #serif 或错误解析，下面会 fail
    expect(out).not.toMatch(/#serif|#sans|#mono/i);
  });

  // ======== Test 5 (E2E): mono + 创意紫 summary slide —— 还原真实用户故障 ========
  //  覆盖：generateFallbackSlide (slide-08 summary) → postProcessHtmlSnapshot
  //  原问题 1：H2 硬编码 #111827 黑（渐变未替换成主色紫）
  //  原问题 2：fontFamily 被硬编码成 'sans'（应为 'mono'）
  //  原问题 3：slide-08 总结页被 center 三件套同时出现（非封面也被居中）
  it('E2E: mono + 创意紫 summary slide → font 为 mono 且 H2 为紫色渐变 且 无居中三件套', () => {
    const slidePlan = {
      index: 8,
      pageType: 'summary' as const,
      title: '认识自然规律，提升全社会的气候韧性',
      bullets: [
        '建立全球气候监测预警网络',
        '加强农业基础设施抗灾能力',
        '完善应急响应和物资储备体系',
        '推动低碳转型和绿色金融',
        '开展气候韧性教育和公众科普',
      ],
    };
    // Step A: 走 generateFallbackSlide（5 参显式传入 mono）
    const fallbackHtml = (agent as any).generateFallbackSlide(
      slidePlan,
      '#7c3aed',
      1280,
      720,
      'mono',
    ) as string;
    expect(fallbackHtml).toBeTruthy();

    // Step B: 走 public postProcessHtmlSnapshot 包装（含 postProcessSlideHtml、postProcessLayout、ensureOuterContainer 全链）
    const finalHtml = agent.postProcessHtmlSnapshot(fallbackHtml, {
      primaryColor: '#7c3aed',
      primaryColorDarker: '#632ebe',
      fontFamily: 'mono',
    }) as string;

    // 子断言 1：font-family 为 mono 栈（JetBrains Mono 标记 / ui-monospace / Cascadia Code / Noto Sans Mono CJK SC）
    const outerFF = getOuterFontFamily(finalHtml);
    const hasMonoMarker =
      /JetBrains\s?Mono|ui-monospace|Cascadia\s?Code|Noto Sans Mono CJK SC/i.test(outerFF);
    expect(hasMonoMarker).toBe(true);

    // 子断言 2：无黑色硬编码（#111827 或关键字 black(排除 blacklist 等匹配边缘)）
    const hasBlackHardcode = /color\s*:\s*#111827|color\s*:\s*black(?!\s*list)/i.test(finalHtml);
    expect(hasBlackHardcode).toBe(false);

    // 子断言 3：H2 含创意紫（primaryColor #7c3aed 或其 darker #632ebe）
    const hasPurple = /7c3aed|632ebe/i.test(finalHtml);
    expect(hasPurple).toBe(true);

    // 子断言 4：三件套不同时出现（slide-08 总结页非封面，不应被居中）
    const outerStyleMatch = finalHtml.match(/^<div[^>]*style="([^"]*)"/i);
    const outerStyle = outerStyleMatch ? outerStyleMatch[1] : '';
    const hasJc = /justify-content\s*:\s*center/i.test(outerStyle);
    const hasAi = /align-items\s*:\s*center/i.test(outerStyle);
    const hasTa = /text-align\s*:\s*center/i.test(outerStyle);
    const threePieceAll = hasJc && hasAi && hasTa;
    expect(threePieceAll).toBe(false);

    // 额外断言：标题标记作为 <h2> 出现且标题文字存在（保证 HTML 结构有效）
    expect(finalHtml).toContain('<h2');
    expect(finalHtml).toContain('认识自然规律');
  });
});
