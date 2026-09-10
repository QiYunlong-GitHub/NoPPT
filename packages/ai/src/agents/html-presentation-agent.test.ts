import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { readFileSync } from 'fs';
import { HTMLPresentationAgent } from './html-presentation-agent';

// ESM 安全获取当前文件目录（vitest 以 ESM 方式加载 .test.ts）
const __dirname = dirname(fileURLToPath(import.meta.url));
// 仓库根 tests/fixtures 下的真实深红渐变封面样例（后处理前大模型原始输出裁剪）
const COVER_FIXTURE = resolve(
  __dirname,
  '../../../../tests/fixtures/cover-dark-gradient-sample.html',
);

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

/** 一张「标准封面」：外层全屏 flex 容器内含 h1 + 两条副标题，无 h2/列表/图片/表格。 */
const COVER_HTML = `<div style="position:relative;width:100%;height:100%;overflow:hidden;display:flex;flex-direction:column;justify-content:flex-start;align-items:flex-start;">
  <h1 style="font-size:88px;font-weight:700;color:#0f172a;">碳中和战略</h1>
  <p style="font-size:24px;color:#64748b;">副标题一</p>
  <p style="font-size:24px;color:#64748b;">副标题二</p>
</div>`;

describe('enforceCoverPosterArtStyles 幂等（装饰不重复注入）', () => {
  it('首次调用注入封面艺术字装饰并打 data-noppt-coverart 标记', () => {
    const agent = buildAgent();
    const out = (agent as any).enforceCoverPosterArtStyles(COVER_HTML, '#e61818', 1280, 720);
    expect(out).not.toBe(COVER_HTML); // 确有注入
    const marks = (out.match(/data-noppt-coverart/gi) || []).length;
    expect(marks).toBe(1); // 单一幂等标记，未被重复打标
  });

  it('二次调用整体跳过：HTML 不变、装饰节点不新增（防 agent + server 重放重复注入）', () => {
    const agent = buildAgent();
    const first = (agent as any).enforceCoverPosterArtStyles(COVER_HTML, '#e61818', 1280, 720);
    const second = (agent as any).enforceCoverPosterArtStyles(first, '#e61818', 1280, 720);
    // 幂等：第二次调用原样返回
    expect(second).toBe(first);
    // 装饰/Badge 节点数量在两次调用间不增加
    const countDeco = (s: string) =>
      (s.match(/data-noppt-coverart|gradient|border-radius:9999px|9999px/gi) || []).length;
    expect(countDeco(second)).toBe(countDeco(first));
    // 仍仅一个幂等标记
    expect((second.match(/data-noppt-coverart/gi) || []).length).toBe(1);
  });

  it('非封面（含 h2 内容页）直接跳过，不注入不标记', () => {
    const agent = buildAgent();
    const content = `<div style="position:relative;width:100%;height:100%;overflow:hidden;display:flex;">
      <h2 style="font-size:40px;">章节标题</h2>
      <p>正文</p>
    </div>`;
    const out = (agent as any).enforceCoverPosterArtStyles(content, '#e61818', 1280, 720);
    expect(out).toBe(content);
    expect(out).not.toMatch(/data-noppt-coverart/i);
  });
});

describe('enforceCoverPosterArtStyles 语义化装饰计数（JSDOM 规范化 style 不误判）', () => {
  // 终局 server 端 sanitizeHtmlServerSide 用 JSDOM 把 style 序列化为 "key: value"（带空格），
  // 旧正则（要求紧凑无空格）会 100% 失配 → 误判「无装饰」→ 重复注入。这里验证语义化计数对空白鲁棒。
  const COVER_JSX_STYLE = `<div style="position: relative; width: 100%; height: 100%; overflow: hidden; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center;">
    <div style="position: absolute; top: -80px; right: -120px; width: 520px; height: 520px; border-radius: 50%; background: radial-gradient(circle, #c7000b35 0%, #c7000b10 45%, transparent 75%); pointer-events: none;"></div>
    <div style="position: absolute; left: -160px; bottom: -120px; width: 480px; height: 400px; background: linear-gradient(135deg, #c7000b18, #9f000910); clip-path: polygon(0 30%, 40% 0, 80% 60%, 30% 100%); pointer-events: none;"></div>
    <div style="position: absolute; left: 80px; top: 20%; bottom: 20%; width: 3px; background: linear-gradient(180deg, transparent, #c7000b, transparent); border-radius: 2px; pointer-events: none;"></div>
    <h1 style="font-size: 92px; font-weight: 900;">标题</h1>
    <p style="font-size: 32px;">副标题</p>
  </div>`;

  it('JSDOM 规范化（带空格）style 下，已有 3 个装饰被正确计数 → 不重复注入', () => {
    const agent = buildAgent();
    const out = (agent as any).enforceCoverPosterArtStyles(COVER_JSX_STYLE, '#c7000b', 1280, 720);
    // 装饰签名数量应与输入一致（3 个），不应因空白差异而误加第二套
    expect((out.match(/radial-gradient\(\s*circle/gi) || []).length).toBe(1);
    expect((out.match(/clip-path:\s*polygon/gi) || []).length).toBe(1);
    expect((out.match(/linear-gradient\(\s*180deg\s*,\s*transparent/gi) || []).length).toBe(1);
  });
});

describe('封面副标题字号层级豁免（决策 4：不被 clamp 压平为正文尺寸）', () => {
  const COVER_HTML = `<div style="position:relative;width:100%;height:100%;overflow:hidden;display:flex;flex-direction:column;justify-content:flex-start;align-items:flex-start;">
    <h1 style="font-size:88px;font-weight:700;color:#0f172a;">碳中和战略</h1>
    <p style="font-size:24px;color:#64748b;">副标题一</p>
    <p style="font-size:24px;color:#64748b;">副标题二</p>
  </div>`;

  it('终局重放后封面副标题仍保留大字号层级（≥24px），不被压成 20px', () => {
    const agent = buildAgent();
    // 模拟 finalGuard 重放（primaryColor 回落默认蓝亦不影响封面层级豁免）
    const out = agent.postProcessHtmlSnapshot(COVER_HTML, { primaryColor: '#2563eb' });
    // 保守化后 Step6 不再无条件压成 36px，而是保留大模型原始 24px；决策 4 保证 round2 clamp 不把首行压回 20px
    expect(out).toMatch(/font-size:\s*24px/i); // 首行副标题保留大模型原始字号
    // 关键回归信号：副标题一（原 24px）绝不能被 clamp 成 20px
    expect(out).not.toMatch(/<p[^>]*font-size:\s*20px[^>]*>\s*副标题一\s*<\/p>/i);
  });

  it('内容页（含 h2）正文 p 仍受 clamp 兜底约束（不影响可读性）', () => {
    const agent = buildAgent();
    const content = `<div style="position:relative;width:100%;height:100%;overflow:hidden;display:flex;">
      <h2 style="font-size:40px;">章节</h2>
      <p style="font-size:48px;color:#374151;">超大正文（应被 clamp 到 20px）</p>
    </div>`;
    const out = agent.postProcessHtmlSnapshot(content, { primaryColor: '#2563eb' });
    // 内容页正文 p 的 48px 应被 clamp 到 [16,20] 区间，证明豁免未误伤内容页
    expect(out).toMatch(/font-size:\s*20px/i);
    expect(out).not.toMatch(/font-size:\s*48px/i);
  });

  it('封面副标题 margin:0 0 20px 0 经终局重放后不被 8pt 规整（决策 4 间距保留）', () => {
    const agent = buildAgent();
    const cover = `<div style="position:relative;width:100%;height:100%;overflow:hidden;display:flex;flex-direction:column;justify-content:flex-start;align-items:flex-start;">
      <h1 style="font-size:88px;font-weight:700;color:#0f172a;">碳中和战略</h1>
      <p style="font-size:24px;color:#64748b;margin:0 0 20px 0;">副标题一</p>
    </div>`;
    const out = agent.postProcessHtmlSnapshot(cover, { primaryColor: '#2563eb' });
    // 决策 4 间距豁免：封面副标题 margin 保持 20px，不被规整为 16px
    expect(out).toMatch(/<p[^>]*margin:\s*0 0 20px 0[^>]*>/i);
    expect(out).not.toMatch(/margin:\s*0 0 16px 0/i);
  });

  it('内容页（含 h2）正文间距仍被 8pt 规整（防豁免泛化误伤布局）', () => {
    const agent = buildAgent();
    const content = `<div style="position:relative;width:100%;height:100%;overflow:hidden;display:flex;">
      <h2 style="font-size:40px;">章节</h2>
      <p style="font-size:18px;color:#374151;margin:0 0 20px 0;">正文段</p>
    </div>`;
    const out = agent.postProcessHtmlSnapshot(content, { primaryColor: '#2563eb' });
    // 内容页非封面，间距豁免不生效 → 20px 被规整到 24px（上取整到 8 倍数）
    expect(out).toMatch(/margin:\s*0 0 24px 0/i);
  });
});

describe('[TXT] enforceHeadingColorOnLightBg 尊重参考标题色', () => {
  it('无参考标题色：浅底中性 h2 升级为主色（原行为保持）', () => {
    const agent = buildAgent();
    const slide = `<div style="background:#ffffff;"><h2 style="font-size:50px;">章节标题</h2></div>`;
    const out = (agent as any).enforceHeadingColorOnLightBg(slide, {
      primaryColor: '#2563eb',
      primaryColorDarker: '#1e40af',
    });
    expect(out).toContain('color:#2563eb');
  });
  it('有参考标题色：浅底 h2 使用参考标题色而非主色', () => {
    const agent = buildAgent();
    const slide = `<div style="background:#ffffff;"><h2 style="font-size:50px;">章节标题</h2></div>`;
    const out = (agent as any).enforceHeadingColorOnLightBg(slide, {
      primaryColor: '#2563eb',
      primaryColorDarker: '#1e40af',
      titleColor: '#111827',
    });
    expect(out).toContain('color:#111827');
    expect(out).not.toContain('color:#2563eb');
  });
  it('深底（主色背景）区块：无论参考标题色，强制白字', () => {
    const agent = buildAgent();
    const dark = `<div style="background:#1e40af;"><h2 style="font-size:50px;color:#111827;">章节标题</h2></div>`;
    const out = (agent as any).enforceHeadingColorOnLightBg(dark, {
      primaryColor: '#2563eb',
      primaryColorDarker: '#1e40af',
      titleColor: '#111827',
    });
    expect(out).toContain('color:#ffffff');
  });
  it('参考标题色已显式写在浅底 h2：不覆盖（保持参考色）', () => {
    const agent = buildAgent();
    const slide = `<div style="background:#ffffff;"><h2 style="font-size:50px;color:#1a1a1a;">章节标题</h2></div>`;
    const out = (agent as any).enforceHeadingColorOnLightBg(slide, {
      primaryColor: '#2563eb',
      primaryColorDarker: '#1e40af',
      titleColor: '#1a1a1a',
    });
    expect(out).toContain('color:#1a1a1a');
    expect(out).not.toContain('color:#2563eb');
  });
});

describe('postProcessHtmlSnapshot 透传参考标题色到后处理（FR：终局重放接入参考色）', () => {
  it('传入 referenceVisualAttributes：浅底 heading 中性色升级为参考标题色（而非主色）', () => {
    const agent = buildAgent();
    // 仅 content 分类上传了参考标题色 #a855f7；后处理时 slidePlan.pageType='' → 归为 content 分类。
    const ref = {
      source: 'html-only' as const,
      global: { uploaded: false as const, style: {} as Record<string, string> },
      byCategory: {
        cover: { uploaded: false as const, style: {} as Record<string, string> },
        content: {
          uploaded: true as const,
          style: { titleColor: '#a855f7' } as Record<string, string>,
        },
        summary: { uploaded: false as const, style: {} as Record<string, string> },
      },
    };
    const slide = `<div style="background:#ffffff;width:1280px;height:720px;"><h2 style="font-size:50px;color:#111827;">章节标题</h2></div>`;
    const out = agent.postProcessHtmlSnapshot(slide, {
      primaryColor: '#2563eb',
      referenceVisualAttributes: ref as any,
    });
    // 关键接线断言：参考标题色被透传并最终落到浅底 heading 上，且未被主色 #2563eb 取代。
    expect(out).toContain('color:#a855f7');
    expect(out).not.toContain('color:#111827');
    expect(out).not.toContain('color:#2563eb');
  });

  it('未传 referenceVisualAttributes：浅底 heading 中性色回落为主色（向后兼容，不抛错）', () => {
    const agent = buildAgent();
    const slide = `<div style="background:#ffffff;width:1280px;height:720px;"><h2 style="font-size:50px;color:#111827;">章节标题</h2></div>`;
    const out = agent.postProcessHtmlSnapshot(slide, { primaryColor: '#2563eb' });
    expect(out).toContain('color:#2563eb');
    expect(out).not.toContain('color:#111827');
  });
});

describe('[TXT] enforceLightBgTextContrast 不误伤深色参考文字色', () => {
  it('浅底卡片含白字：改写为深主色（原行为保持）', () => {
    const agent = buildAgent();
    const slide = `<div style="background:#ffffff;"><p style="font-size:16px;color:#FFFFFF;">正文</p></div>`;
    const out = (agent as any).enforceLightBgTextContrast(slide, '#2563eb');
    const darker = (agent as any).darkenPrimaryColor('#2563eb', 0.72);
    expect(out).toContain(`color:${darker}`);
    expect(out).not.toMatch(/color:\s*#?ffffff/i);
    expect(out).not.toMatch(/color:\s*white/i);
  });
  it('浅底卡片含深色参考文字色（#1a1a1a）：不被改写', () => {
    const agent = buildAgent();
    const slide = `<div style="background:#ffffff;"><p style="font-size:16px;color:#1a1a1a;">正文</p></div>`;
    const out = (agent as any).enforceLightBgTextContrast(slide, '#2563eb');
    expect(out).toContain('color:#1a1a1a');
    expect(out).not.toMatch(/color:\s*#?ffffff/i);
  });
});

describe('封面艺术字按背景深浅分叉 (F1)', () => {
  const DARK_COVER = `<div style="position:relative;width:100%;height:100%;overflow:hidden;display:flex;flex-direction:column;justify-content:center;align-items:center;background-image:linear-gradient(135deg,#e60012,#b8000e);">
    <h1 style="font-size:88px;font-weight:700;color:#ffffff;">三一重机简介</h1>
    <p style="font-size:24px;color:#ffffff;">副标题一</p>
    <p style="font-size:24px;color:#ffffff;">副标题二</p>
  </div>`;

  it('深红渐变封面：H1/副标题保持白色，不套渐变裁剪红字（修复红底红字）', () => {
    const agent = buildAgent();
    const out = (agent as any).postProcessLayout(
      DARK_COVER,
      'cover',
      1280,
      720,
      '#e61818',
      'sans',
      '#ffffff',
    );
    const h1 = out.match(/<h1[^>]*>/i)?.[0] ?? '';
    expect(h1).toContain('color:#FFFFFF');
    expect(h1).not.toContain('-webkit-text-fill-color:transparent');
    expect(h1).not.toContain('background-clip:text');
    // 副标题不应再是深灰 #1F2937（红底上不可读）
    expect(out).not.toContain('#1F2937');
  });

  it('浅底封面（无参考标题色）：仍套用主色渐变艺术字（不退化既有效果）', () => {
    const agent = buildAgent();
    const out = (agent as any).postProcessLayout(COVER_HTML, 'cover', 1280, 720, '#e61818', 'sans');
    expect(out).toContain('-webkit-text-fill-color:transparent');
    expect(out).toContain('-webkit-background-clip:text');
  });
  it('浅底封面（有参考标题色 #22223b）：收敛为纯色标题，不套渐变裁剪（防黑块 / 与【标题色收敛】规则一致）', () => {
    const agent = buildAgent();
    const out = (agent as any).postProcessLayout(
      COVER_HTML,
      'cover',
      1280,
      720,
      '#e61818',
      'sans',
      '#22223b',
    );
    expect(out).not.toContain('-webkit-text-fill-color:transparent');
    expect(out).not.toContain('-webkit-background-clip:text');
    expect(out).toContain('color:#22223b');
  });
});

describe('终局文字对比度兜底 (F2)', () => {
  it('深底容器内的渐变文字被改为白色并清理裁剪属性', () => {
    const agent = buildAgent();
    const dark = `<div style="background-color:#1F2937;"><h2 style="background:linear-gradient(90deg,#fff,#ccc);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">标题</h2></div>`;
    const out = (agent as any).enforceFinalTextContrast(dark, '#e61818');
    expect(out).toContain('color:#FFFFFF');
    expect(out).not.toContain('-webkit-text-fill-color:transparent');
    expect(out).not.toContain('background-clip:text');
  });
});

describe('母版层 flatten 豁免 (F6)', () => {
  it('class="noppt-master-layer" 子树不被折叠', () => {
    const agent = buildAgent();
    const html = `<div class="noppt-master-layer" style="position:absolute;inset:0;"><div data-master-header style="display:flex;"><span style="width:28px;height:3px;background:#999;"></span></div></div>`;
    const out = (agent as any).flattenMeaninglessNesting(html);
    expect(out).toContain('data-master-header');
    expect(out).toContain('display:flex');
  });
});

describe('真实深红封面样例回归基准 (F1)', () => {
  it('真实深红渐变封面经后处理链：H1/副标题保持白色、无渐变裁剪红字、无深灰字', () => {
    const agent = buildAgent();
    const fixture = readFileSync(COVER_FIXTURE, 'utf-8');
    // 断言 0：fixture 必须是单根 div 且无前置注释，否则 ensureOuterContainer 会包白底外壳使深底判定失效
    expect(fixture.trimStart().startsWith('<div')).toBe(true);
    expect(fixture).not.toMatch(/^\s*<!--/);

    const out = (agent as any).postProcessLayout(
      fixture,
      'cover',
      1280,
      720,
      '#e61818',
      'sans',
      '#ffffff',
    );
    const h1 = out.match(/<h1[^>]*>/i)?.[0] ?? '';
    // ① H1 仍为白色
    expect(h1).toContain('color:#FFFFFF');
    // ② 深底不套渐变裁剪红字
    expect(out).not.toContain('-webkit-text-fill-color:transparent');
    expect(out).not.toContain('background-clip:text');
    // ③ 副标题不被改成深灰字 #1F2937
    expect(out).not.toContain('#1F2937');
    // ④ 胶囊 badge 文字为白色
    expect(out).toContain('color:#FFFFFF');
  });
});

// ============================================================================
// 浅底白字缺陷回归（pres_mtojam8g_6grpye2 / 1-3 页）：统一 alpha 感知 tone 权威后，
// 浅底页面不再把文字误判为深底而刷成白字。fixture 来自真实产物 05-content{1,3,4,2}-response.html。
// 主色必须用真实值 #d81e06（母版 colorHex），否则 includes(主色) 类判定失真。
// ============================================================================
const LIGHT_COVER = resolve(__dirname, '../../../../tests/fixtures/light-bg-cover-sample.html');
const LIGHT_CONTENT = resolve(__dirname, '../../../../tests/fixtures/light-bg-content-sample.html');
const LIGHT_CONTENT2 = resolve(
  __dirname,
  '../../../../tests/fixtures/light-bg-content-sample2.html',
);
const LIGHT_CONTENT_OK = resolve(
  __dirname,
  '../../../../tests/fixtures/light-bg-content-ok-sample.html',
);

describe('统一 tone 权威：resolveBgTone / needsContrastFix 单元', () => {
  const agent = buildAgent();
  it('极浅 8 位主色 hex 合成后判浅底（background-color:#d81e0620 叠白底≈浅粉）', () => {
    expect((agent as any).resolveBgTone('background-color:#d81e0620', '#d81e06')).toBe('light');
  });
  it('装饰层（position:absolute+pointer-events:none）整体豁免 → 未知，不误判深', () => {
    expect(
      (agent as any).resolveBgTone(
        'position:absolute;right:-120px;background:radial-gradient(circle,#e6001235 0%,#e6001210 45%,transparent 75%);pointer-events:none',
        '#e60012',
        { isDecorative: true },
      ),
    ).toBe('unknown');
  });
  it('纯白底判浅', () => {
    expect((agent as any).resolveBgTone('background-color:#fff', '#d81e06')).toBe('light');
  });
  it('深灰 #1F2937 判深', () => {
    expect((agent as any).resolveBgTone('background-color:#1F2937', '#d81e06')).toBe('dark');
  });
  it('不透明主色深红渐变判深', () => {
    expect(
      (agent as any).resolveBgTone('background:linear-gradient(135deg,#e60012,#b8000e)', '#e60012'),
    ).toBe('dark');
  });
  it('needsContrastFix：深灰 #1F2937 在白底达标（不改写）', () => {
    expect((agent as any).needsContrastFix('#1F2937', [255, 255, 255], 24, 600)).toBe(false);
  });
  it('needsContrastFix：近白 #F3F4F6 在白底不达标（应改写）', () => {
    expect((agent as any).needsContrastFix('#F3F4F6', [255, 255, 255], 24, 600)).toBe(true);
  });
});

describe('浅底白字回归：真实产物 1-3 页经后处理链不得出现浅底白字', () => {
  const agent = buildAgent();
  const run = (file: string, pageType: string) =>
    (agent as any).postProcessLayout(
      readFileSync(file, 'utf-8'),
      pageType,
      1280,
      720,
      '#d81e06',
      'sans',
      '#ffffff',
    );

  it('slide-01 浅底封面：无 #F3F4F6 近白字、渐变艺术字保留、页面仍浅底', () => {
    const out = run(LIGHT_COVER, 'cover');
    expect(out).toMatch(/background(?:-color)?:\s*#fff/i); // 浅底判定未失真
    expect(out).not.toContain('color:#F3F4F6'); // 缺陷特征：副标题被刷成近白
    expect(out).toContain('-webkit-text-fill-color:transparent'); // 渐变艺术字保留
    expect(out).toContain('background-clip:text');
  });

  it('slide-02 浅底卡片页（8 位主色卡 #d81e0608）：黑色正文不被刷白', () => {
    const out = run(LIGHT_CONTENT, 'content');
    expect(out).toContain('color:#000000'); // 大数字/标题保持深字（缺陷下会被刷成 #FFFFFF）
    expect(out).toContain('color:#d81e06'); // 主色标题/徽章保持
  });

  it('slide-03 浅底对比页（8 位主色渐变右栏 #d81e0606）：深灰正文不被刷白', () => {
    const out = run(LIGHT_CONTENT2, 'content');
    expect(out).toContain('color:#111827'); // 右栏 li 正文保持深字（缺陷下会被刷成 #FFFFFF）
    expect(out).toContain('color:#374151'); // 左栏正文保持深字
  });

  it('slide-04 正常浅底页（守卫）：主色/黑字基本不变', () => {
    const out = run(LIGHT_CONTENT_OK, 'content');
    expect(out).toContain('color:#d81e06');
    expect(out).toContain('color:#000000');
  });

  it('保守性：24px/#1F2937 副标题不被改写为 28px/#F3F4F6', () => {
    const out = run(LIGHT_COVER, 'cover');
    expect(out).not.toContain('font-size:28px'); // 不再无条件压成 28px
    expect(out).not.toContain('color:#F3F4F6'); // 不再刷成近白
  });
});
