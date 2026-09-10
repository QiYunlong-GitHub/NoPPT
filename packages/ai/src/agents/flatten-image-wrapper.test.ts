// ================================================================
// flatten-image-wrapper.test.ts  —  RC-1 / RC-2 / FR-4 / FR-5 修复专项单测
// 覆盖 UW-1 ~ UW-10 场景
// ================================================================
import { describe, it, expect } from 'vitest';
import type { AIModelProvider } from '../providers/base';
import { HTMLPresentationAgent } from './html-presentation-agent';
import { enforceImageStyles } from '../../../core/src/engine/visual-fixes';
import { LayoutEngine } from '../../../core/src/engine/layout-engine';

// 构造一个无 LLM 依赖的纯 transform agent 实例：flattenMeaninglessNesting、
// ensureImageProperWrapper、enforceTextContainerStyles 均不访问 provider，
// 只需要 HTMLPresentationAgent 上的 this.findClosingTagIndex。
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

// 绕过 private：TypeScript private 只在编译期生效，JS 下标可访问
function callFlatten(agent: HTMLPresentationAgent, html: string): string {
  return (agent as unknown as Record<string, (h: string) => string>).flattenMeaninglessNesting.call(
    agent,
    html,
  );
}
function callEnsureWrapper(agent: HTMLPresentationAgent, html: string): string {
  return (agent as unknown as Record<string, (h: string) => string>).ensureImageProperWrapper.call(
    agent,
    html,
  );
}
function callEnforceTextContainerStyles(agent: HTMLPresentationAgent, html: string): string {
  return (
    agent as unknown as Record<string, (h: string) => string>
  ).enforceTextContainerStyles.call(agent, html);
}

// =====================================================================
//  FR-1a/b：flattenMeaninglessNesting 不再剥离 img 包裹容器
// =====================================================================
describe('FR-1 flattenMeaninglessNesting 图片包裹保护（RC-1 修复）', () => {
  const agent = makeAgent();

  // UW-1：margin-top:32px + img 包裹 → 保留，margin-top 不变
  it('UW-1 margin-top:32px 包裹不被剥离（hasMargin 命中）', () => {
    const input =
      '<div style="margin-top:32px;overflow:hidden;display:flex;align-items:stretch;">' +
      '<img src="ph" data-image-ratio="4:3" style="width:100%;height:100%;">' +
      '</div>';
    const out = callFlatten(agent, input);
    expect(out).toContain('margin-top:32px');
    expect(out).toMatch(/<div\b[^>]*margin-top:32px[^>]*>[\s\S]*<img[\s\S]*?<\/div>/i); // 仍有外层 div 包裹 img
    const openDivs = (out.match(/<div\b/gi) || []).length;
    expect(openDivs).toBeGreaterThanOrEqual(1); // 外层至少一个 div
  });

  // UW-2：overflow:hidden + display:flex + img 包裹 → 保留
  it('UW-2 overflow:hidden display:flex 包裹不被剥离（hasOverflow+hasFlex 命中）', () => {
    const input =
      '<div style="overflow:hidden;display:flex;align-items:stretch;">' +
      '<img src="ph" style="width:100%;height:100%;">' +
      '</div>';
    const out = callFlatten(agent, input);
    expect(out).toContain('overflow:hidden');
    expect(out).toMatch(/<div[^>]*display:flex[^>]*>/i);
    // 若 img 前能看到 > 闭合的外层即存在
    expect(out.indexOf('<div')).toBeLessThan(out.indexOf('<img'));
    const closingAfter = out.lastIndexOf('</div>');
    const imgEnd = out.indexOf('/>', out.indexOf('<img'));
    expect(imgEnd).toBeLessThan(closingAfter);
  });

  // UW-3：style 空 <div><img></div>（无可视/布局约束，空 style）—— 仍保留外层，因为 img 子代保护
  it('UW-3 无样式空 div 包裹 img 时（FR-1b img 子代保护），容器保留不剥', () => {
    const input = '<div><img src="ph"></div>';
    const out = callFlatten(agent, input);
    expect(out.trim()).toBe(input); // 完全不变
  });

  // UW-4：嵌套两层 div 包裹 img —— 内层保留，外层按约束判定
  it('UW-4 双层嵌套 div > div > img，内层 img 包裹层始终保留', () => {
    const input =
      '<div>' + // 外层：style 空 但 只有 1 个子 div（原本会被剥！）
      '<div style="margin-top:32px;">' + // 内层：有 margin-top，应留
      '<img src="ph">' +
      '</div>' +
      '</div>';
    const out = callFlatten(agent, input);
    // 内层 margin-top 必须在
    expect(out).toContain('margin-top:32px');
    // img 必须出现在内层 div 内
    expect(out).toMatch(/<div\b[^>]*margin-top:32px[^>]*>\s*<img/);
  });

  // 验证反向：非 img 的单子元素（比如纯 span 文本）仍然按老规则 flatten 可剥离（保证不回归过度保守）
  it('REGRESSION: 单子 div 包裹非 img 标签（如 span）无可视/布局约束时仍 flatten', () => {
    const input = '<div><span style="color:red;">hello</span></div>';
    const out = callFlatten(agent, input);
    expect(out.trim()).toBe('<span style="color:red;">hello</span>');
  });
});

// =====================================================================
//  FR-2：enforceImageStyles 默认 height 改为 auto + aspect-ratio（RC-2 修复）
// =====================================================================
describe('FR-2 enforceImageStyles height/aspect-ratio 默认值修复（RC-2 修复）', () => {
  // UW-5：无 ratio 裸 img，得到 height:auto 而非 height:100%
  it('UW-5 无 data-image-ratio 的 img，默认 height:auto（禁止 height:100%）', () => {
    const input = '<img src="abc.png" style="width:100%;object-fit:cover;">';
    const out = enforceImageStyles(input, { addDataImageRatio: false });
    expect(out).toContain('height:auto');
    // 显式 height:100%（非 max-height）必须不存在
    expect(out).not.toMatch(/(^|[;"])\s*height:\s*100%\s*(?=[;"]|$)/i);
    // max-height:100%（defaults）仍然存在，这是预期行为
    expect(out).toMatch(/max-height:\s*100%/i);
  });

  // UW-6：ratio=4:3 裸 img，得到 aspect-ratio: 4 / 3 + height:auto + object-fit:cover
  it('UW-6 data-image-ratio=4:3 时注入 aspect-ratio:4/3 + height:auto', () => {
    const input =
      '<img src="abc.png" data-image-ratio="4:3" style="width:100%;max-width:100%;max-height:100%;display:block;">';
    const out = enforceImageStyles(input, { borderRadius: '12px' });
    expect(out).toContain('aspect-ratio:4 / 3');
    expect(out).toContain('height:auto');
    // 显式 height:100%（非 max-height）必须不存在
    expect(out).not.toMatch(/(^|[;"])\s*height:\s*100%\s*(?=[;"]|$)/i);
    expect(out).toMatch(/max-height:\s*100%/i);
    expect(out).toContain('object-fit:cover'); // 补默认
  });

  // UW-7（A4 修复）：LLM 默认写 height:100% + 带 data-image-ratio=4:3，必须归一化 aspect-ratio + height:auto
  it('UW-7 height=100% + data-image-ratio=4:3 → 归一化 aspect-ratio:4/3 + height:auto', () => {
    const input =
      '<img src="https://placeholder" data-image-ratio="4:3" style="width:100%;height:100%;object-fit:cover;border-radius:16px;display:block;">';
    const out = enforceImageStyles(input);
    expect(out).toContain('aspect-ratio:4 / 3');
    expect(out).toContain('height:auto');
    // 不允许显式 height:100%（非 max-height）
    expect(out).not.toMatch(/(^|[;"])\s*height:\s*100%\s*(?=[;"]|$)/i);
    // object-fit:cover 是原始自带，保留；object-fit 默认补也满足
    expect(out).toMatch(/object-fit:\s*cover/i);
  });

  // UW-8（A4 回归保护）：用户显式 height=300px + data-image-ratio=4:3，仍保留 300px，不强制归一化
  it('UW-8 用户显式 height=300px 即便带 data-image-ratio 也保持不变（不归一化）', () => {
    const input =
      '<img src="a.png" data-image-ratio="4:3" style="width:100%;height:300px;object-fit:contain;">';
    const out = enforceImageStyles(input);
    expect(out).toContain('height:300px');
    expect(out).not.toContain('height:auto');
    // 非 bad-default 的显式 height 不被 aspect-ratio 覆盖（防止误伤图表/海报固定高度）
  });

  // 保留用户显式 height（显式不被覆盖）
  it('REGRESSION: 用户显式 height=300px 保持不变', () => {
    const input = '<img src="a.png" style="height:300px;">';
    const out = enforceImageStyles(input);
    expect(out).toContain('height:300px');
    expect(out).not.toContain('height:auto');
    expect(out).not.toContain('aspect-ratio');
  });
});

// =====================================================================
//  FR-3：enforceTextContainerStyles —— display:grid / data-layout 豁免
// =====================================================================
describe('FR-3 enforceTextContainerStyles grid/data-layout 豁免 + overflow:clip', () => {
  const agent = makeAgent();

  it('display:grid + flex:1 的容器不应被追加 overflow', () => {
    const input =
      '<div style="flex:1;display:grid;grid-template-columns:repeat(4,1fr);gap:24px;min-height:0;align-content:stretch;min-width:0;">content</div>';
    const out = callEnforceTextContainerStyles(agent, input);
    expect(out).not.toMatch(/overflow:\s*(hidden|clip)/i);
    // 但 min-height:0 / min-width:0 本来就有，不被新增亦可（幂等）
  });

  it('带 data-layout=content-stats-highlight（白名单版式）豁免 overflow', () => {
    const input =
      '<div data-layout="content-stats-highlight" style="width:100%;height:100%;padding:48px 64px;display:flex;flex-direction:column;">' +
      '<div style="flex:1;">x</div>' +
      '</div>';
    const out = callEnforceTextContainerStyles(agent, input);
    // 内部 flex:1 div 被外层 data-layout 覆盖豁免吗？正则匹配的是内层 div。
    // 注意：本豁免作用在整个 div 标签属性层，内外层分别判断。这里内层 div 标签本身没有 data-layout=...
    // 所以 data-layout 豁免实际上作用在"外层带 data-layout=xxx + 自身 style 也有 flex:1"的极少见场景。
    // 对更常见的"外层根容器是 data-layout，内层 grid div 有 flex:1+display:grid"走的是上面 display:grid 的豁免。
    // 这里只要断言：当根容器同时有 data-layout + style="flex:1"时，被豁免即可。
    const rootContainer =
      '<div data-layout="content-stats-highlight" style="flex:1;display:flex;">x</div>';
    const out2 = callEnforceTextContainerStyles(agent, rootContainer);
    expect(out2).not.toMatch(/overflow:\s*(hidden|clip)/i);
  });

  it('纯文本容器（flex:1 无 grid）追加 overflow:clip 而非 hidden', () => {
    const input = '<div style="flex:1;min-height:0;min-width:0;"><p>hello</p></div>';
    const out = callEnforceTextContainerStyles(agent, input);
    expect(out).toContain('overflow:clip');
    expect(out).not.toContain('overflow:hidden');
  });
});

// =====================================================================
//  FR-4：ensureImageProperWrapper 图片包裹完整性兜底
// =====================================================================
describe('FR-4 ensureImageProperWrapper 末尾 img 包裹兜底', () => {
  const agent = makeAgent();

  it('末尾裸 img（块级关闭标签 → img → </div>）被重包一层', () => {
    const input =
      '<div style="width:100%;height:100%;padding:48px 64px;display:flex;flex-direction:column;">' +
      '<h2>hi</h2>' +
      '<div style="flex:1;">grid here</div>' +
      '<img src="x" data-image-ratio="4:3" style="width:100%;">' +
      '</div>';
    const out = callEnsureWrapper(agent, input);
    // 被重包：<div style="margin-top:24px;overflow:hidden;display:flex;..."><img>
    expect(out).toMatch(
      /<div\b[^>]*margin-top:24px[^>]*overflow:hidden[^>]*display:flex[^>]*>\s*<img/i,
    );
    // 且 flex:0 0 auto 不扩张
    expect(out).toContain('flex:0 0 auto');
  });

  it('已被包裹的 img（原包裹是 margin-top:32px div）—— 不重复包裹（幂等）', () => {
    const input =
      '<div style="width:100%;height:100%;padding:48px 64px;display:flex;flex-direction:column;">' +
      '<h2>hi</h2>' +
      '<div style="flex:1;">grid here</div>' +
      '<div style="margin-top:32px;overflow:hidden;display:flex;align-items:stretch;">' +
      '<img src="x" data-image-ratio="4:3">' +
      '</div>' +
      '</div>';
    const before = input;
    const after = callEnsureWrapper(agent, input);
    // 包裹前后 div>img 对数不增加
    const beforeCount = (before.match(/<img/gi) || []).length;
    const afterCount = (after.match(/<img/gi) || []).length;
    expect(afterCount).toBe(beforeCount); // 不重复产生 img 标签（不是插入，只是包裹个数可增）
    // 检查：margin-top:24px 没出现第二次（即新包裹没有被加）—— 正则仅匹配 "</div>\s*<img>" 的情况，现有包裹不会触发
    const wrapsCount = (after.match(/margin-top:24px;overflow:hidden;display:flex/gi) || []).length;
    expect(wrapsCount).toBe(0); // 不应产生新的 24px 包裹（原有 32px 包裹还在）
  });
});

// =====================================================================
//  FR-5：stats-grid-bottom-image（卡片 grid N>=3 + 底部图 压高/间距/不转双列）
// =====================================================================
describe('FR-5 preventContentImageTopOverflow stats-grid-bottom-image', () => {
  // UW-9：slide-04 同款结构 —— 4列卡片 grid + 底部图片（imgWrap 无 flex basis）。
  // 期望：grid-template-columns:repeat(4,1fr) 不被改成 2；imgWrap 有 flex:0 0 32% + margin-top:24px。
  it('UW-9 卡片 grid 4列 + 底部图 → 保留4列，imgWrap 32% + mt=24px', () => {
    const input =
      '<div style="width:100%;height:100%;overflow:hidden;position:relative;padding:48px 64px;display:flex;flex-direction:column;background-color:#fff;" data-layout="content-stats-highlight">' +
      '<h2 style="font-size:50px;font-weight:700;margin:0 0 32px 0;line-height:1.25;">农业减产与供应链中断导致全球直接经济损失超千亿美元</h2>' +
      '<div style="flex:1;display:grid;grid-template-columns:repeat(4,1fr);gap:24px;min-height:0;align-content:stretch;min-width:0;">' +
      '<div style="padding:24px 20px;border-radius:16px;background:#ea580c12;display:flex;flex-direction:column;gap:12px;height:100%;">' +
      '<span>-23%</span><h3>卡片1</h3>' +
      '</div>' +
      '<div style="padding:24px 20px;border-radius:16px;background:#ea580c10;display:flex;flex-direction:column;gap:12px;height:100%;">' +
      '<span>+18%</span><h3>卡片2</h3>' +
      '</div>' +
      '<div style="padding:24px 20px;border-radius:16px;background:#ea580c10;display:flex;flex-direction:column;gap:12px;height:100%;">' +
      '<span>-3.2%</span><h3>卡片3</h3>' +
      '</div>' +
      '<div style="padding:24px 20px;border-radius:16px;background:#ea580c12;display:flex;flex-direction:column;gap:12px;height:100%;">' +
      '<span>+12天</span><h3>卡片4</h3>' +
      '</div>' +
      '</div>' +
      '<div style="margin-top:32px;overflow:hidden;display:flex;align-items:stretch;">' +
      '<img src="https://NOPPT_IMAGE_PLACEHOLDER" data-image-ratio="4:3" style="width:100%;height:100%;object-fit:cover;border-radius:16px;">' +
      '</div>' +
      '</div>';
    const out = LayoutEngine.normalizeAISlide({
      id: 'u9',
      createdAt: 0,
      updatedAt: 0,
      html: input,
    }).html;
    // Step 1 保护：卡片 grid 仍为 repeat(4,1fr)，不能被改为 repeat(2,1fr)
    expect(out).toContain('grid-template-columns:repeat(4,1fr)');
    expect(out).not.toContain('grid-template-columns:repeat(2,1fr)');
    // Step 2 生效：imgWrap flex-basis 归一化到 32%
    expect(out).toMatch(/flex(?:-basis)?:[^;]*0 0 32%|flex-basis:32%/);
    // Step 2 margin-top 统一 24px
    expect(out).toMatch(/<div\b[^>]*style="[^"]*margin-top:24px[^"]*"[^>]*>\s*<img/i);
    // H2 不被降级紧凑化（Step 3 不触发）
    const h2Match = out.match(/<h2\b([^>]*)>/i);
    expect(h2Match).toBeTruthy();
    const h2Style = h2Match![1];
    // 原始 font-size:50px 被降级为 42/44 就说明 Step 3 误触发；这里不允许被缩小
    expect(h2Style).toContain('font-size:50px');
  });

  // UW-10：老「UL li=4 + 底部图」结构，不应走 stats-grid，确保 Step 1 转双列不被回归
  it('UW-10 UL/OL li=4 + 底部图 → 仍走老路径，UL 被转双列 grid，imgWrap 35%', () => {
    const input =
      '<div style="width:100%;height:100%;padding:48px 64px;display:flex;flex-direction:column;">' +
      '<h2>主题</h2>' +
      '<div style="flex:1;min-height:0;display:flex;flex-direction:column;">' +
      '<ul style="display:flex;flex-direction:column;gap:12px;min-height:0;">' +
      '<li>条目1</li><li>条目2</li><li>条目3</li><li>条目4</li>' +
      '</ul>' +
      '</div>' +
      '<div style="margin-top:20px;flex:0 0 48%;display:flex;align-items:stretch;overflow:hidden;">' +
      '<img src="ph" style="width:100%;height:100%;object-fit:cover;">' +
      '</div>' +
      '</div>';
    const out = LayoutEngine.normalizeAISlide({
      id: 'u10',
      createdAt: 0,
      updatedAt: 0,
      html: input,
    }).html;
    // Step 1：UL 转成 repeat(2,1fr)
    expect(out).toContain('grid-template-columns:repeat(2,1fr)');
    // Step 2：imgWrap 被压缩到 35%（li=4 阶梯）
    expect(out).toMatch(/flex(?:-basis)?:[^;]*0 0 35%|flex-basis:35%/);
    // margin-top = 16px（不是 24）
    expect(out).toMatch(/<div\b[^>]*style="[^"]*margin-top:16px[^"]*"[^>]*>\s*<img/i);
  });
});
