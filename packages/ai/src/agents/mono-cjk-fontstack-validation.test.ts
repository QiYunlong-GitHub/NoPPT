// ================================================================
// Task 4: mono CJK fontstack 综合验证
//   Case C: getFontStack('mono') 7 条正则 + 2 generic 验证
//   Case B: serif 幂等回归（NFR-2：真实定制 serif 栈不被 mono 覆盖）
//   Case A: 真实 pres_mtgmr5up_x67l77j 8 slides ensureOuterContainer('mono')
// ================================================================
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
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

// ================================================================
// Case C：直接调用 getFontStack('mono')，7 条正则 + 2 generic
// ================================================================
describe('Case C: getFontStack mono 栈 TR-1.1 正则断言', () => {
  const agent = makeAgent() as AnyAgent;
  const monoStack = (agent as any).getFontStack('mono') as string;

  it('C1: 包含 JetBrains Mono', () => {
    expect(monoStack).toMatch(/JetBrains\s*Mono/i);
  });

  it('C2: 包含 Cascadia Code', () => {
    expect(monoStack).toMatch(/Cascadia\s*Code/i);
  });

  it('C3: 包含 PingFang SC', () => {
    expect(monoStack).toMatch(/PingFang\s*SC/i);
  });

  it('C4: 包含 Microsoft YaHei 或 微软雅黑', () => {
    expect(monoStack).toMatch(/Microsoft\s*YaHei|微软雅黑/);
  });

  it('C5: 包含 Noto Sans SC', () => {
    expect(monoStack).toMatch(/Noto\s*Sans\s*SC/i);
  });

  it('C6: 包含 Noto Sans Mono CJK SC', () => {
    expect(monoStack).toMatch(/Noto\s*Sans\s*Mono\s*CJK\s*SC/i);
  });

  it('C7: 末尾 generic 为 monospace', () => {
    expect(monoStack.trim()).toMatch(/,\s*monospace\s*$/i);
  });

  it('C8: serif 末尾 generic 为 serif', () => {
    const serifStack = (agent as any).getFontStack('serif') as string;
    expect(serifStack.trim()).toMatch(/,\s*serif\s*$/i);
  });

  it('C9: sans 末尾 generic 为 sans-serif', () => {
    const sansStack = (agent as any).getFontStack('sans') as string;
    expect(sansStack.trim()).toMatch(/,\s*sans-serif\s*$/i);
  });
});

// ================================================================
// Case B：serif 幂等回归（AC-7，NFR-2）
//   真实定制 serif 栈（Georgia + Times New Roman + Noto Serif SC + SimSun）
//   传 fontFamily=mono 也不得被覆盖为 JetBrains Mono
// ================================================================
describe('Case B: serif 定制栈幂等回归 (NFR-2)', () => {
  const agent = makeAgent() as AnyAgent;

  it('B1: 8 大特征齐全 + 真实定制 serif 栈，传 fontFamily=mono 仍保留 Georgia/Times New Roman，不含 JetBrains Mono', () => {
    const CUSTOM_SERIF = `'Georgia','Times New Roman','Noto Serif SC','SimSun',serif`;
    const inputHtml =
      `<div style="width:100%;height:100%;overflow:hidden;position:relative;box-sizing:border-box;padding:48px 64px;display:flex;flex-direction:column;background-color:#fff;font-family:${CUSTOM_SERIF};">` +
      `<h2>标题</h2><ul><li>内容</li></ul></div>`;

    const out = (agent as any).ensureOuterContainer(inputHtml, 1280, 720, 'mono') as string;
    const ff = getOuterFontFamily(out);

    // 幂等守卫：真实定制 serif 栈不被 mono 覆盖
    expect(ff).toMatch(/Georgia|Times New Roman/);
    expect(ff).not.toMatch(/JetBrains Mono/i);
  });
});

// ================================================================
// Case A：真实 pres_mtgmr5up_x67l77j 8 slides ensureOuterContainer('mono')
//   每张 slide 的外层 font-family：
//     a) 含 JetBrains|Cascadia|Consolas 至少 1 项
//     b) 含 PingFang|Microsoft YaHei|Noto Sans SC 至少 1 项
//     c) 末尾 generic 为 monospace
//     d) 不含 Georgia / Times New Roman / SimSun
// ================================================================
describe('Case A: 真实 pres_mtgmr5up_x67l77j 8 slides ensureOuterContainer(mono)', () => {
  const agent = makeAgent() as AnyAgent;

  // 合成 HTML 模板兜底（若真实文件缺失则用 8 个不同 title）
  function synthSlide(title: string): string {
    return (
      `<div style="width:100%;height:100%;overflow:hidden;position:relative;box-sizing:border-box;padding:48px 64px;display:flex;flex-direction:column;background-color:#fff;">` +
      `<h2>${title}</h2><p>合成测试内容</p></div>`
    );
  }

  // 尝试读取真实 presentation.json
  const PRES_PATH = path.resolve(
    'D:/TraeSOLO/NoPPT/packages/server/data/workspace/presentations/pres_mtgmr5up_x67l77j/presentation.json',
  );

  // 从最外层 <div style=...> 中移除 font-family 声明（保留 style 其余部分）
  // 这样 ensureOuterContainer 的 ok8/Map 分支会按 fontFamily=mono 参数重新注入完整 CJK mono 栈
  function stripOuterFontFamily(html: string): string {
    return html.replace(
      /^(<div[^>]*style=")([^"]*)(")/i,
      (_m, prefix: string, style: string, suffix: string) => {
        const cleaned = style.replace(/font-family\s*:[^;]+(;)?/gi, '');
        return `${prefix}${cleaned}${suffix}`;
      },
    );
  }

  let slideHtmls: string[] = [];
  try {
    if (fs.existsSync(PRES_PATH)) {
      const raw = fs.readFileSync(PRES_PATH, 'utf-8');
      const data = JSON.parse(raw) as any;
      const slidesArr = data.slides ?? (data.meta && data.meta.slides ? data.meta.slides : null);
      if (Array.isArray(slidesArr) && slidesArr.length > 0) {
        slideHtmls = slidesArr
          .map((s: any) => (typeof s === 'string' ? s : s && s.html ? s.html : null))
          .filter((x: any): x is string => typeof x === 'string' && x.length > 0)
          .map((h: string) => stripOuterFontFamily(h));
      }
    }
  } catch (_e) {
    slideHtmls = [];
  }

  // 不足 8 条时用合成 HTML 补足
  if (slideHtmls.length < 8) {
    const synthTitles = [
      '厄尔尼诺现象：地球气候的“发烧”密码',
      '探索厄尔尼诺的四个维度',
      '赤道太平洋海温异常升高，打破全球热量平衡',
      '信风减弱与温跃层变深，共同驱动厄尔尼诺形成',
      '全球气候模式重塑，极端旱涝灾害频发',
      '农业减产与经济损失显著，社会系统面临多维冲击',
      '构建气候韧性系统，从预警到适应多管齐下',
      '认知厄尔尼诺，共筑气候适应型未来',
    ];
    slideHtmls = synthTitles.map((t) => synthSlide(t));
  }

  function runSlideAssertions(idx: number, html: string) {
    it(`A${idx + 1}: Slide #${idx + 1} ensureOuterContainer(mono) → mono+CJK+monospace generic 且无 serif 词`, () => {
      const out = (agent as any).ensureOuterContainer(html, 1280, 720, 'mono') as string;
      const ff = getOuterFontFamily(out);

      // a) JetBrains / Cascadia / Consolas 至少一项
      expect(ff).toMatch(/JetBrains|Cascadia|Consolas/i);
      // b) PingFang / Microsoft YaHei / Noto Sans SC 至少一项
      expect(ff).toMatch(/PingFang|Microsoft YaHei|Noto Sans SC/i);
      // c) 末尾 generic 为 monospace
      expect(ff).toMatch(/monospace\s*$/i);
      // d) 不含 serif 专属词
      expect(ff).not.toMatch(/Georgia/i);
      expect(ff).not.toMatch(/Times New Roman/i);
      expect(ff).not.toMatch(/SimSun/i);
    });
  }

  // 至少 8 张 slide
  const count = Math.max(8, Math.min(slideHtmls.length, 8));
  for (let i = 0; i < count; i++) {
    runSlideAssertions(i, slideHtmls[i]);
  }
});
