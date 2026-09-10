// ================================================================
// Task 2: ensureOuterContainer fontFamily 参数化 + 幂等性验证
// 覆盖 ok8 分支 / Map 重写分支 / parseFailed 分支 的字体栈兜底行为
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

describe('Task 2: ensureOuterContainer fontFamily 参数化与幂等', () => {
  const agent = makeAgent() as AnyAgent;

  // ======== Test 1：ok8 分支，fontFamily=mono 时缺 font-family 补 mono 栈 ========
  it('Test 1 (ok8 分支): fontFamily=mono, 最外层缺 font-family → 补 JetBrains Mono / Cascadia Code 栈，不是 sans 栈', () => {
    // 8 大特征全有，故意省略 font-family 和 background（background 会被另补，但 font-family 是本测试目标）
    const inputHtml =
      `<div style="width:100%;height:100%;overflow:hidden;position:relative;box-sizing:border-box;padding:48px 64px;display:flex;flex-direction:column;background-color:#fff;">` +
      `<h2>hello</h2><p>body</p></div>`;

    const out = (agent as any).ensureOuterContainer(inputHtml, 1280, 720, 'mono') as string;

    const ff = getOuterFontFamily(out);
    expect(ff).toBeTruthy();
    // 断言 mono 栈特征
    const hasMonoMarker = /JetBrains Mono|Cascadia Code|Noto Sans Mono CJK SC/i.test(ff);
    expect(hasMonoMarker).toBe(true);
    // 断言不是 sans 主序列（system-ui,-apple-system 开头）
    expect(ff).not.toMatch(/^system-ui\s*,\s*-apple-system/i);
  });

  // ======== Test 2：幂等——已有合法 font-family 不被覆盖 ========
  it('Test 2 (幂等): 已有完整 8 特征且含 JetBrains Mono → 传 fontFamily=sans 也不覆盖原值', () => {
    const inputHtml =
      `<div style="width:100%;height:100%;overflow:hidden;position:relative;box-sizing:border-box;padding:48px 64px;display:flex;flex-direction:column;background-color:#fff;font-family:'JetBrains Mono', ui-monospace, monospace;">` +
      `<h2>hello</h2><ul><li>a</li></ul></div>`;

    // 故意传 fontFamily=sans，但输入里有 JetBrains Mono，必须保留
    const out = (agent as any).ensureOuterContainer(inputHtml, 1280, 720, 'sans') as string;

    const ff = getOuterFontFamily(out);
    expect(ff).toContain("'JetBrains Mono'");
    expect(ff).toContain('ui-monospace');
    // 不应该出现 sans 栈里标志性的 system-ui 或 PingFang SC 作为 fallback 的追加（因为 addIfMissing 检测到已存在 font-family，不应追加）
    // （注意：允许 font-family 原值仍在，不允许出现第二次声明 / 被替换成 system-ui 开头）
    expect(ff).not.toMatch(/^system-ui/i);
  });

  // ======== Test 1.1：ok8 + serif 分支，补 serif 栈（额外确保切换生效） ========
  it('Test 1.1 (ok8 分支): fontFamily=serif, 缺 font-family → 补 Georgia/SimSun 栈', () => {
    const inputHtml =
      `<div style="width:100%;height:100%;overflow:hidden;position:relative;box-sizing:border-box;padding:48px 64px;display:flex;flex-direction:column;background-color:#fff;">` +
      `<h2>serif page</h2></div>`;
    const out = (agent as any).ensureOuterContainer(inputHtml, 1280, 720, 'serif') as string;
    const ff = getOuterFontFamily(out);
    expect(ff).toContain('Georgia');
    expect(ff).toContain('serif');
    expect(ff).not.toMatch(/^system-ui/i);
  });

  // ======== Test 3：parseFailed 分支（构造「display 缺失 + 属性可解析」显式触发 parseFailed） ========
  it('Test 3 (parseFailed 分支): 缺 display 触发解析失败兜底,缺 font-family → 补 fontFamily=serif (Georgia) 栈', () => {
    // 触发 parseFailed 的最可靠条件：不写 display → styles.display 为空，满足
    //   parseFailed = existingStyle && parsed.length>0 && ( ... || !styles.display || ... )
    // 同时提供 width、height，确保 existingStyle 非空、parsed.length>0 成立。
    // 为了确保不走 ok8 短路：不写 position:relative（8 大特征缺 1 → ok8=false）。
    // 故意不写 display、也不写 font-family，让 parseFailed 分支里的 ensureHas 把两者都补上。
    const styleNoDisplay = `width:100%;height:100%;overflow:hidden;box-sizing:border-box;padding:48px 64px;flex-direction:column;background-color:#fff`;
    const inputHtml = `<div style="${styleNoDisplay}"><p>content</p></div>`;

    const out = (agent as any).ensureOuterContainer(inputHtml, 1280, 720, 'serif') as string;
    const style = getOuterStyle(out);
    // parseFailed 分支会 ensureHas('display','flex')
    expect(style).toContain('display:flex');
    // parseFailed 分支会补 font-family（因缺失）→ serif 栈（Georgia）
    const ff = getOuterFontFamily(out);
    expect(ff).toContain('Georgia');
    expect(ff).not.toMatch(/^system-ui/i);
  });

  // ======== Test 3.1：parseFailed + fontFamily=mono 也正确切换（再验证一次非 serif） ========
  it('Test 3.1 (parseFailed 分支, mono): 缺 display 兜底, fontFamily=mono → 补 JetBrains Mono 栈', () => {
    const styleNoDisplay = `width:100%;height:100%;overflow:hidden;box-sizing:border-box;padding:48px 64px;flex-direction:column;background-color:#fff`;
    const inputHtml = `<div style="${styleNoDisplay}"><p>content</p></div>`;

    const out = (agent as any).ensureOuterContainer(inputHtml, 1280, 720, 'mono') as string;
    const ff = getOuterFontFamily(out);
    expect(/JetBrains Mono|Cascadia Code/i.test(ff)).toBe(true);
    expect(ff).not.toMatch(/^system-ui/i);
  });

  // ======== Test 4：Map 重写分支（解析成功但 ok8 不满足，缺 font-family 走 required['font-family']） ========
  it('Test 4 (Map 重写分支): ok8 不满足但解析成功, 缺 font-family → 补 fontFamily=mono 栈', () => {
    // 触发：缺 position:relative → ok8=false；但提供的属性都是合法的，解析成功；且 display/width/height 都有
    // → parseFailed=false，进入 Map 重写分支。
    const inputHtml =
      `<div style="width:100%;height:100%;overflow:hidden;box-sizing:border-box;padding:48px 64px;display:flex;flex-direction:column;background-color:#fff;">` +
      `<p>no position relative</p></div>`;

    const out = (agent as any).ensureOuterContainer(inputHtml, 1280, 720, 'mono') as string;
    const style = getOuterStyle(out);
    // 应有 position:relative 被补上（Map 重写的 required）
    expect(style).toContain('position:relative');
    const ff = getOuterFontFamily(out);
    expect(/JetBrains Mono|Cascadia Code/i.test(ff)).toBe(true);
    expect(ff).not.toMatch(/^system-ui/i);
  });

  // ======== Test 5（专项）：老默认 sans 精确命中 → 允许被 fontFamily=mono 覆盖升级（T7.7 修复验证） ========
  it('Test 5 (ok8+T7.7): 外层 font-family 精确等于系统默认 sans 占位 + fontFamily=mono → 被正确替换为 JetBrains Mono 栈', () => {
    // 精确使用 getFontStack('sans') 返回的字符串（DEFAULT_HARDCODED_SANS）
    const EXACT_DEFAULT_SANS =
      "system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,'Noto Sans SC','PingFang SC','Microsoft YaHei',sans-serif";
    // ok8 8 大特征全有，font-family 恰好等于老默认 sans（典型"旧 HTML 遗留"场景）
    const inputHtml =
      `<div style="width:100%;height:100%;overflow:hidden;position:relative;box-sizing:border-box;padding:48px 64px;display:flex;flex-direction:column;background-color:#fff;font-family:${EXACT_DEFAULT_SANS};">` +
      `<h2>legacy sans page</h2><p>body</p></div>`;

    // 用户现在指定 fontFamily=mono，老默认 sans 应该被升级替换（而非被当作"真实定制"保留）
    const out = (agent as any).ensureOuterContainer(inputHtml, 1280, 720, 'mono') as string;

    const ff = getOuterFontFamily(out);
    // 必须升级到 mono，出现 JetBrains Mono 标志
    expect(ff).toContain("'JetBrains Mono'");
    // 关键证明：已不是老默认 sans（system-ui 开头），而是被替换成 mono 栈
    expect(ff).not.toMatch(/^system-ui/i);
    // 新 mono 栈同时为 CJK 回退补充了 PingFang SC/Microsoft YaHei/微软雅黑/Noto Sans SC（在 Noto Sans Mono CJK SC 之前）
    expect(ff).toContain("'PingFang SC'");
    expect(ff).toContain("'Microsoft YaHei'");
    expect(ff).toContain("'Noto Sans SC'");
    expect(ff).toContain("'Noto Sans Mono CJK SC'");
    // 末尾 generic 保留 monospace（不是 sans-serif）
    expect(ff).toMatch(/monospace$/);
    expect(ff).not.toMatch(/sans-serif$/);
  });

  // ======== Test 6（专项 NFR-2）：真实定制 mono 栈 → fontFamily=serif 也绝不能覆盖（幂等） ========
  it('Test 6 (NFR-2 幂等 ok8): 已有真实定制 JetBrains Mono 栈 + fontFamily=serif → 原值保持不动，不变成 Georgia', () => {
    // 真实定制：LLM 明确写了 JetBrains Mono 栈（和老默认 sans 逐字节不相等）
    const CUSTOM_MONO = "'JetBrains Mono', ui-monospace, monospace";
    // ok8 8 大特征全有
    const inputHtml =
      `<div style="width:100%;height:100%;overflow:hidden;position:relative;box-sizing:border-box;padding:48px 64px;display:flex;flex-direction:column;background-color:#fff;font-family:${CUSTOM_MONO};">` +
      `<h2>custom mono page</h2><ul><li>a</li></ul></div>`;

    // 即使传 fontFamily=serif，真实定制 JetBrains Mono 绝不能被覆盖为 Georgia
    const out = (agent as any).ensureOuterContainer(inputHtml, 1280, 720, 'serif') as string;

    const ff = getOuterFontFamily(out);
    expect(ff).toContain("'JetBrains Mono'");
    expect(ff).toContain('ui-monospace');
    // NFR-2：绝对不出现 Georgia / SimSun（serif 栈标志）
    expect(ff).not.toContain('Georgia');
    expect(ff).not.toContain('SimSun');
  });
});
