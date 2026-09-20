// ============================================================================
// comparison-deep-dive 结构自愈回归（pres_mu7skl55_0cmg3m7 slide-03）
//
// 现象：大模型返回的对比页左右两栏卡片不对齐；经后处理之后不仅仍不对齐，
//       还出现严重遮挡。
// 根因链：
//   ① 上游 wrapTextNodes 把 `<span><svg><rect/></svg></span>` 拆成
//      `<p><svg …></svg></p><rect …>…</rect>`（SVG 图形丢失，<rect>/<path>
//      退化为 HTML 未知元素并吞掉后随文字节点）→ 大面积错位/遮挡；
//   ② 左右栏 ul 是 flex-column + 内容驱动 li 高度，两栏 padding/图标/进度条
//      度量不一致 → 第 i 行累积错位、两栏底边不齐。
// 修复：LayoutEngine.repairLeakedSvgShapes（结构锚定）+ alignComparisonDeepDiveRows。
// ============================================================================
import { describe, it, expect } from 'vitest';
import { LayoutEngine } from '../layout-engine';

const mkSlide = (html: string) =>
  ({
    id: 's1',
    title: 'T',
    html,
    notes: '',
    hidden: false,
    index: 0,
    createdAt: 0,
    updatedAt: 0,
  }) as any;

const normalize = (html: string): string => LayoutEngine.normalizeAISlide(mkSlide(html)).html;

/** 左栏一条「已被上游破坏」的 li：svg 被包进 <p>，<rect> 泄漏到 svg 之外并吞掉文字 */
const brokenLeftLi = (label: string) =>
  `<li style="display:flex;flex-direction:column;gap:8px;padding:16px 24px;border-radius:12px;background:#FFFFFF;border:1px solid #E5E7EB;">
          <div style="display:flex;align-items:center;gap:16px;"><p style="font-size:20px;color:#374151;font-weight:600;line-height:2.0;"><svg width="10" height="10" viewBox="0 0 10 10"></svg></p><rect x="2" y="4.5" width="6" height="1.5" rx="0.75" fill="#9CA3AF"><p style="font-size:20px;color:#374151;font-weight:600;line-height:2.0;"></p><p style="font-size:20px;color:#374151;font-weight:600;line-height:2.0;"></p><p style="font-size:20px;color:#374151;font-weight:600;line-height:2.0;"><span style="font-size:19px;font-weight:600;color:#374151;line-height:1.4;flex:1;min-width:0;">${label}</span></p></rect></div>
        </li>`;

/** 右栏一条「已被上游破坏」的 li：<path> 泄漏到 svg 之外并吞掉文字与徽章 */
const brokenRightLi = (label: string) =>
  `<li style="display:flex;flex-direction:column;gap:8px;padding:16px 24px;border-radius:14px;background:#FFFFFF;border-left:5px solid #27ae60;">
          <div style="display:flex;align-items:center;gap:16px;"><p style="font-size:20px;color:#374151;font-weight:600;line-height:2.0;"><svg width="15" height="15" viewBox="0 0 16 16" fill="none"></svg></p><path d="M13 4L6.5 10.5L3 7" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><p style="font-size:20px;color:#374151;font-weight:600;line-height:2.0;"></p><p style="font-size:20px;color:#374151;font-weight:600;line-height:2.0;"></p><p style="font-size:20px;color:#374151;font-weight:600;line-height:2.0;"><span style="font-size:20px;font-weight:700;color:#111827;line-height:1.4;flex:1;min-width:0;">${label}</span></p><span style="display:inline-flex;align-items:center;padding:4px 12px;border-radius:999px;background:#27ae6020;color:#1f8b4d;font-size:16px;font-weight:800;">+60%</span></path></div>
        </li>`;

const buildDamagedComparison = (): string =>
  `<div style="width:100%;height:100%;overflow:hidden;position:relative;box-sizing:border-box;padding:48px 64px;display:flex;flex-direction:column;background-color:#f7f8fa;" data-layout="comparison-deep-dive"><h2 style="font-size:50px;font-weight:700;margin:0 0 32px 0;line-height:1.25;">厄尔尼诺与拉尼娜：气候双胞胎的对比</h2>` +
  `<div style="flex:1;display:flex;gap:32px;min-height:0;min-width:0;align-items:stretch;">` +
  `<div style="flex:1;padding:32px 24px;border-radius:16px;border:2px solid #E5E7EB;background:#F9FAFB;display:flex;flex-direction:column;gap:16px;min-width:0;min-height:0;"><h3 style="font-size:28px;font-weight:700;color:#4B5563;margin:0;text-align:center;">基准气候态</h3>` +
  `<ul style="margin:0;padding:0;list-style:none;flex:1;min-width:0;display:flex;flex-direction:column;gap:16px;min-height:0;">` +
  brokenLeftLi('海表温度异常') +
  brokenLeftLi('大气环流变化') +
  brokenLeftLi('全球降水模式') +
  brokenLeftLi('区域气候影响') +
  `</ul></div>` +
  `<div style="flex:1;padding:32px 24px;border-radius:16px;background:linear-gradient(135deg,#27ae6006,#27ae600A);display:flex;flex-direction:column;gap:16px;min-width:0;min-height:0;"><h3 style="font-size:28px;font-weight:800;margin:0;text-align:center;">气候事件影响</h3>` +
  `<ul style="margin:0;padding:0;list-style:none;flex:1;min-width:0;display:flex;flex-direction:column;gap:16px;min-height:0;">` +
  brokenRightLi('海表温度异常') +
  brokenRightLi('大气环流变化') +
  brokenRightLi('全球降水模式') +
  brokenRightLi('区域气候影响') +
  `</ul></div></div></div>`;

/** 去掉所有合法 <svg> 区块后，检查是否还有泄漏的图形元素 */
const leakedShapes = (html: string): RegExpMatchArray | null =>
  html.replace(/<svg\b[\s\S]*?<\/svg>/gi, '').match(/<(rect|path|circle|line|polyline|polygon)\b/i);

describe('comparison-deep-dive 结构自愈（slide-03 回归）', () => {
  it('泄漏到 <svg> 之外的 <rect>/<path> 被剥离，图形不再退化为 HTML 未知元素', () => {
    const out = normalize(buildDamagedComparison());
    expect(leakedShapes(out)).toBeNull();
    // 成对形态（退化标志）必须彻底消失
    expect(out).not.toMatch(/<rect\b[^>]*>[\s\S]*?<\/rect>/i);
    expect(out).not.toMatch(/<path\b[^>]*>[\s\S]*?<\/path>/i);
  });

  it('被吞进图形元素内部的文字与徽章被完整还原', () => {
    const out = normalize(buildDamagedComparison());
    for (const label of ['海表温度异常', '大气环流变化', '全球降水模式', '区域气候影响']) {
      // 左右两栏各出现一次
      expect(out.split(label).length - 1).toBe(2);
    }
    expect(out).toContain('+60%');
  });

  it('左右两栏 ul 被改成等分行高的 grid，实现逐行对齐', () => {
    const out = normalize(buildDamagedComparison());
    const gridUls = out.match(/<ul\b[^>]*display:grid[^>]*>/gi) || [];
    expect(gridUls).toHaveLength(2);
    for (const ul of gridUls) {
      expect(ul).toContain('grid-template-rows:repeat(4,1fr)');
    }
  });

  it('修复幂等：二次 normalizeAISlide 输出不变', () => {
    const once = normalize(buildDamagedComparison());
    const twice = LayoutEngine.normalizeAISlide(mkSlide(once)).html;
    expect(twice).toBe(once);
  });

  it('未损坏的 comparison 页同样被行对齐，且结构不受损', () => {
    const clean = buildDamagedComparison()
      .replace(/<rect\b[^>]*>[\s\S]*?<\/rect>/gi, '')
      .replace(/<path\b[^>]*>[\s\S]*?<\/path>/gi, '');
    const out = normalize(clean);
    expect(leakedShapes(out)).toBeNull();
    expect(out.match(/<li\b/gi) || []).toHaveLength(8);
    expect((out.match(/<ul\b[^>]*display:grid[^>]*>/gi) || []).length).toBe(2);
  });
});
