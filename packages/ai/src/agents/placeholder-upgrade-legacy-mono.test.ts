// ================================================================
// Task 4: 占位值升级 + 遗留 mono 6 项 → 新 10 项 CJK mono 验证
// 覆盖：
//   AC-1: old-sans → mono / sans 升级
//   AC-2: old-mono 6 项（精确/缺项子集）→ mono 升级（三 CJK 关键字）
//   AC-3: old-mono → sans 跨家族升级（完整替换，不 append）
//   AC-4~9: 误伤保护（serif 保留 / 新栈幂等 / 自加 PingFang 不升级）
//   真实演示：合成 16 张 FF_OLD_MONO slide 走 ensureOuterContainer('mono')
//   分支覆盖：Map 分支样例 / parseFailed 分支样例
// ================================================================
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { AIModelProvider } from '../providers/base';
import { HTMLPresentationAgent } from './html-presentation-agent';

type AnyAgent = HTMLPresentationAgent & Record<string, any>;

// ================================================================
// 辅助函数（从 ensure-outer-container-font.test.ts 拷贝）
// ================================================================
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

function getFFMatchRegex(): RegExp {
  return /font-family\s*:\s*([^;]+)/i;
}

/**
 * 构建一个具备 8 大特征、外层 font-family = 指定栈的 html 样例。
 * 8 大特征：width:100% / height:100% / overflow:hidden / position:relative /
 *          box-sizing:border-box / padding / display:flex / flex-direction:column
 * 确保外层 div 走 ensureOuterContainer 的 ok8 分支。
 */
function buildHtmlWithOuterFF(
  fontStack: string,
  extraProps: string = '',
  inner: string = `<h2>示例标题</h2><ul><li>要点一</li><li>要点二</li></ul>`
): string {
  const baseStyle =
    'width:100%;height:100%;overflow:hidden;position:relative;box-sizing:border-box;' +
    'padding:48px 64px;display:flex;flex-direction:column;background-color:#fff;' +
    `font-family:${fontStack}`;
  const style = extraProps ? `${baseStyle};${extraProps}` : baseStyle;
  return `<div style="${style}">${inner}</div>`;
}

// ================================================================
// 常量声明
// ================================================================
// agent 层 DEFAULT_HARDCODED_SANS 精确值（老默认 sans 占位）
const FF_OLD_SANS = "system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,'Noto Sans SC','PingFang SC','Microsoft YaHei',sans-serif";

// agent 层 DEFAULT_HARDCODED_MONO_LEGACY 精确值（老遗留 6 项 mono）
const FF_OLD_MONO = "'JetBrains Mono', ui-monospace, 'Cascadia Code', Consolas, 'Noto Sans Mono CJK SC', monospace";

// 新 10 项 mono 栈（agent getFontStack('mono')）
const FF_NEW_MONO = "'JetBrains Mono', ui-monospace, 'Cascadia Code', Consolas, 'PingFang SC', 'Microsoft YaHei', '微软雅黑', 'Noto Sans SC', 'Noto Sans Mono CJK SC', monospace";

// agent getFontStack('sans') 新 sans 栈
const FF_NEW_SANS = "system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,'Noto Sans SC','PingFang SC','Microsoft YaHei',sans-serif";

// 真实定制 serif 栈
const FF_CUSTOM_SERIF = "Georgia, 'Times New Roman', 'Noto Serif SC', 'SimSun', serif";

// 用户自加 PingFang 额外项的定制 mono（6 项遗留 + PingFang SC 追加）
const FF_NEW_MONO_PLUS_PINGFANG_EXTRA = "'JetBrains Mono', ui-monospace, 'Cascadia Code', Consolas, 'Noto Sans Mono CJK SC', monospace, 'PingFang SC'";

// ================================================================
// Test Suite
// ================================================================
describe('Task 4: 占位值升级 + 遗留 mono CJK 化验证', () => {
  const agent = makeAgent() as AnyAgent;

  // ======== 基础 4 组合（ok8 分支）========

  // ① old-sans → mono
  it('① old-sans → mono：新 ff 含 JetBrains Mono（西文等宽头）+ 三 CJK 至少 1 + 末尾 monospace', () => {
    const html = buildHtmlWithOuterFF(FF_OLD_SANS);
    const out = (agent as any).ensureOuterContainer(html, 1280, 720, 'mono') as string;
    const ff = getOuterFontFamily(out);

    expect(ff).toMatch(/JetBrains\s*Mono/i);
    const hasCJK = /PingFang\s*SC|Microsoft\s*YaHei|Noto\s*Sans\s*SC/i.test(ff);
    expect(hasCJK).toBe(true);
    expect(ff).toMatch(/monospace\s*$/i);
  });

  // ② old-sans → sans
  it('② old-sans → sans：新 ff 以 system-ui 开头 + 末尾 sans-serif', () => {
    const html = buildHtmlWithOuterFF(FF_OLD_SANS);
    const out = (agent as any).ensureOuterContainer(html, 1280, 720, 'sans') as string;
    const ff = getOuterFontFamily(out);

    expect(ff).toMatch(/^system-ui/i);
    expect(ff).toMatch(/sans-serif\s*$/i);
    // 宽松断言：同时含 notosanssc
    expect(ff).toMatch(/Noto\s*Sans\s*SC/i);
  });

  // ③ old-mono → mono（AC-2 核心）
  it('③ old-mono 6 项精确 → mono（AC-2 核心）：新 ff 三 CJK 关键字各 1 + 末尾 monospace + JetBrains Mono 保留', () => {
    const html = buildHtmlWithOuterFF(FF_OLD_MONO);
    const out = (agent as any).ensureOuterContainer(html, 1280, 720, 'mono') as string;
    const ff = getOuterFontFamily(out);

    // 三 CJK 关键字各至少 1
    expect(ff).toMatch(/PingFang\s*SC/i);
    expect(ff).toMatch(/Microsoft\s*YaHei|微软雅黑/);
    expect(ff).toMatch(/Noto\s*Sans\s*SC/i);
    // 末尾 monospace
    expect(ff).toMatch(/monospace\s*$/i);
    // JetBrains Mono 保留
    expect(ff).toMatch(/JetBrains\s*Mono/i);
  });

  // ④ old-mono 子集缺项 → mono
  it('④ old-mono 子集缺项（缺 ui-monospace）→ mono：升级成功，含至少一个 CJK', () => {
    const FF_SUBSET = "'JetBrains Mono','Cascadia Code',Consolas,'Noto Sans Mono CJK SC',monospace";
    const html = buildHtmlWithOuterFF(FF_SUBSET);
    const out = (agent as any).ensureOuterContainer(html, 1280, 720, 'mono') as string;
    const ff = getOuterFontFamily(out);

    const hasCJK = /PingFang\s*SC|Microsoft\s*YaHei|Noto\s*Sans\s*SC/i.test(ff);
    expect(hasCJK).toBe(true);
  });

  // ⑤ old-mono → sans（AC-3 跨家族）
  it('⑤ old-mono → sans（AC-3 跨家族）：新 ff 含 system-ui + 末尾 sans-serif，NOT 含 JetBrains Mono 和 Cascadia Code', () => {
    const html = buildHtmlWithOuterFF(FF_OLD_MONO);
    const out = (agent as any).ensureOuterContainer(html, 1280, 720, 'sans') as string;
    const ff = getOuterFontFamily(out);

    expect(ff).toMatch(/system-ui/i);
    expect(ff).toMatch(/sans-serif\s*$/i);
    // 证明完整替换，不是 append
    expect(ff).not.toMatch(/JetBrains\s*Mono/i);
    expect(ff).not.toMatch(/Cascadia\s*Code/i);
  });

  // ======== 误伤保护（ok8）========

  // ⑥ custom serif → mono
  it('⑥ custom serif → mono（误伤保护）：仍含 Georgia；NOT 含 JetBrains Mono', () => {
    const html = buildHtmlWithOuterFF(FF_CUSTOM_SERIF);
    const out = (agent as any).ensureOuterContainer(html, 1280, 720, 'mono') as string;
    const ff = getOuterFontFamily(out);

    expect(ff).toMatch(/Georgia/i);
    expect(ff).not.toMatch(/JetBrains\s*Mono/i);
  });

  // ⑦ custom serif → sans
  it('⑦ custom serif → sans（误伤保护）：仍含 Georgia；不含 system-ui（不换栈）', () => {
    const html = buildHtmlWithOuterFF(FF_CUSTOM_SERIF);
    const out = (agent as any).ensureOuterContainer(html, 1280, 720, 'sans') as string;
    const ff = getOuterFontFamily(out);

    expect(ff).toMatch(/Georgia/i);
    expect(ff).not.toMatch(/system-ui/i);
  });

  // ⑧ 新 10 项 mono 幂等
  it('⑧ 新 10 项 mono 幂等：ff = FF_NEW_MONO 精确 → 逐字节相等', () => {
    const html = buildHtmlWithOuterFF(FF_NEW_MONO);
    const out = (agent as any).ensureOuterContainer(html, 1280, 720, 'mono') as string;
    const ff = getOuterFontFamily(out);

    expect(ff).toBe(FF_NEW_MONO);
  });

  // ⑨ 老 6 项 + PingFang 自加 → mono
  it('⑨ 老 6 项 + PingFang 自加 → mono：原值保持（仍含 PingFang SC + JetBrains Mono，不被升级覆盖）', () => {
    const html = buildHtmlWithOuterFF(FF_NEW_MONO_PLUS_PINGFANG_EXTRA);
    const out = (agent as any).ensureOuterContainer(html, 1280, 720, 'mono') as string;
    const ff = getOuterFontFamily(out);

    // PingFang SC 仍在（用户自加的外项保留）
    expect(ff).toMatch(/PingFang\s*SC/i);
    // JetBrains Mono 也保留
    expect(ff).toMatch(/JetBrains\s*Mono/i);
    // 不等于新 10 项（因为自加 PingFang 不在白名单子集内 → 不触发升级 → 原值保留）
    // 最宽松断言：至少包含 PingFang SC 和 JetBrains Mono 这两个关键锚点
    expect(ff).toBe(FF_NEW_MONO_PLUS_PINGFANG_EXTRA);
  });

  // ======== 真实演示升级（合成 16 张 FF_OLD_MONO）========
  // 读取真实文件夹：pres_mtgp2u3n_xmbr2ae 8 slides
  // 如果不存在 → 合成 8 个 FF_OLD_MONO html

  function buildOldMonoSlide(title: string): string {
    // 走 ok8 分支：8 大特征全有，font-family = FF_OLD_MONO
    return (
      `<div style="width:100%;height:100%;overflow:hidden;position:relative;box-sizing:border-box;padding:48px 64px;display:flex;flex-direction:column;background-color:#fff;font-family:${FF_OLD_MONO};">` +
      `<h2>${title}</h2><p>真实演示升级测试内容</p></div>`
    );
  }

  // 尝试读取 slides 目录，没有则用合成
  function loadOrSynthSlides(
    folderName: string,
    synthTitles: string[]
  ): string[] {
    const folderPath = path.resolve(
      `D:/TraeSOLO/NoPPT/scripts/output/${folderName}/slides`
    );
    let results: string[] = [];
    try {
      if (fs.existsSync(folderPath)) {
        const files = fs.readdirSync(folderPath)
          .filter(f => /^slide-.*\.html$/i.test(f))
          .sort()
          .slice(0, 8);
        for (const f of files) {
          const content = fs.readFileSync(path.join(folderPath, f), 'utf-8');
          // 从外层剥掉 font-family，让 ensureOuterContainer 走 old-mono 升级
          const stripped = content.replace(
            /^(<div[^>]*style=")([^"]*)(")/i,
            (_m, prefix: string, style: string, suffix: string) => {
              const cleaned = style.replace(/font-family\s*:[^;]+(;)?/gi, '');
              // 再把 FF_OLD_MONO 注入回去（确保是占位老值）
              const withOldMono = cleaned
                ? `${cleaned};font-family:${FF_OLD_MONO}`
                : `font-family:${FF_OLD_MONO}`;
              return `${prefix}${withOldMono}${suffix}`;
            }
          );
          results.push(stripped);
        }
      }
    } catch (_e) { results = []; }
    if (results.length < 8) {
      results = synthTitles.map(t => buildOldMonoSlide(t));
    }
    return results.slice(0, 8);
  }

  const pres1 = loadOrSynthSlides('pres_mtgp2u3n_xmbr2ae', [
    '【合成-1】封面：企业数字转型蓝图',
    '【合成-2】目录：四大核心议题',
    '【合成-3】现状分析：传统架构瓶颈',
    '【合成-4】方案一：微服务化重构路径',
    '【合成-5】方案二：云原生弹性架构',
    '【合成-6】核心指标：性能提升对比',
    '【合成-7】落地路线：Q1-Q4 里程碑',
    '【合成-8】总结：技术赋能业务增长',
  ]);

  const pres2 = loadOrSynthSlides('pres_mtgmr5up_x67l77j', [
    '【合成-1】项目启动：研发效能升级专项',
    '【合成-2】痛点扫描：CI/CD 流水线现状',
    '【合成-3】基线数据：构建时长与失败率',
    '【合成-4】优化方案：缓存策略与并行化',
    '【合成-5】质量保障：单元测试覆盖率提升',
    '【合成-6】效能收益：开发人员效率对比',
    '【合成-7】风险与应对：回滚与灰度发布',
    '【合成-8】结论：工程化投资回报率',
  ]);

  // ⑩ pres_mtgp2u3n_xmbr2ae：共 8 张
  describe('⑩ 演示 pres_mtgp2u3n_xmbr2ae：8 张 FF_OLD_MONO → ensureOuterContainer(mono)', () => {
    for (let i = 0; i < 8; i++) {
      it(`10-${i + 1} Slide #${i + 1}：外层 ff 含 CJK 关键字（PingFang / Microsoft YaHei / Noto Sans SC 至少其一）`, () => {
        const out = (agent as any).ensureOuterContainer(
          pres1[i], 1280, 720, 'mono'
        ) as string;
        const ff = getOuterFontFamily(out);
        expect(ff).toMatch(/PingFang|Microsoft YaHei|Noto Sans SC/);
      });
    }
  });

  // ⑪ pres_mtgmr5up_x67l77j：共 8 张
  describe('⑪ 演示 pres_mtgmr5up_x67l77j：8 张 FF_OLD_MONO → ensureOuterContainer(mono)', () => {
    for (let i = 0; i < 8; i++) {
      it(`11-${i + 1} Slide #${i + 1}：外层 ff 含 CJK 关键字（PingFang / Microsoft YaHei / Noto Sans SC 至少其一）`, () => {
        const out = (agent as any).ensureOuterContainer(
          pres2[i], 1280, 720, 'mono'
        ) as string;
        const ff = getOuterFontFamily(out);
        expect(ff).toMatch(/PingFang|Microsoft YaHei|Noto Sans SC/);
      });
    }
  });

  // ======== 三分支覆盖（Map 与 parseFailed 各一条）========

  // ⑫ Map 分支：外层 div style 8 大特征不全、缺 position:relative → ok8=false，解析成功走 Map
  it('⑫ Map 分支样例：style 缺 position:relative（走 Map）+ 占位 sans 子集（无引号）→ 升级为 mono，三 CJK 至少 1', () => {
    // 缺 position:relative → ok8=false；但其他合法属性可正常解析 → parseFailed=false → Map 重写
    // 使用 FF_OLD_SANS 子集但不带单引号（parseStyleDeclarations 解析时引号会污染值）
    // 各项：system-ui,-apple-system,Segoe UI,Roboto,Helvetica Neue,Arial,Noto Sans SC,PingFang SC,Microsoft YaHei,sans-serif
    //   每一项 normalizeName 后都在 DEFAULT_HARDCODED_SANS 的白名单里 → isDefaultSansPlaceholder=true → 允许升级
    const FF_OLD_SANS_NO_QUOTES = "system-ui,-apple-system,Segoe UI,Roboto,Helvetica Neue,Arial,Noto Sans SC,PingFang SC,Microsoft YaHei,sans-serif";
    const styleWith8MissingOne =
      `width:100%;height:100%;overflow:hidden;box-sizing:border-box;padding:48px 64px;display:flex;flex-direction:column;background-color:#fff;font-family:${FF_OLD_SANS_NO_QUOTES}`;
    const html = `<div style="${styleWith8MissingOne}"><h2>Map 分支</h2><p>缺 position</p></div>`;
    const out = (agent as any).ensureOuterContainer(html, 1280, 720, 'mono') as string;
    const ff = getOuterFontFamily(out);
    // 应升级为 mono 栈，出现 CJK 关键字
    const hasCJK = /PingFang|Microsoft YaHei|Noto Sans SC/i.test(ff);
    expect(hasCJK).toBe(true);
    // 同时 mono 栈还应含 JetBrains Mono（西文等宽头）
    expect(ff).toMatch(/JetBrains\s*Mono/i);
  });

  // ⑬ parseFailed 分支：坏引号 style 触发解析失败
  it('⑬ parseFailed 分支样例：style 中 display 缺失（触发解析失败回退）+ FF_OLD_MONO → 三 CJK 至少 1', () => {
    // 构造 parseFailed 触发条件：
    //   existingStyle 非空、parsed.length>0 但 display 缺失
    //   ok8 也不满足（缺 position + 缺 display）
    //   → 走 parseFailed 回退分支，用正则补 font-family（命中占位时升级）
    const brokenStyleNoDisplay =
      `width:100%;height:100%;overflow:hidden;box-sizing:border-box;padding:48px 64px;flex-direction:column;background-color:#fff;font-family:${FF_OLD_MONO}`;
    const html = `<div style="${brokenStyleNoDisplay}"><h2>parseFailed 分支</h2><p>无 display</p></div>`;
    const out = (agent as any).ensureOuterContainer(html, 1280, 720, 'mono') as string;
    const ff = getOuterFontFamily(out);
    const hasCJK = /PingFang|Microsoft YaHei|Noto Sans SC/i.test(ff);
    expect(hasCJK).toBe(true);
  });
});
