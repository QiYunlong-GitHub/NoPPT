// ============================================================================
// comparison-deep-dive 端到端回归（pres_mu7skl55_0cmg3m7 slide-03）
//
// 走完整链路：LLM 原始 HTML → postProcessHtmlSnapshot（ai 后处理链）
//           → LayoutEngine.normalizeAISlide（core 结构自愈）
//
// 覆盖三个历史缺陷：
//   ① wrapTextNodes 把 <svg><rect/></svg> 拆坏 → <rect> 退化成 HTML 未知元素吞文字；
//   ② 8pt 网格单向放大（28→32 / 12→16 / 18→16）把卡片撑爆；
//   ③ enforceTextContainerStyles 给左右栏补 overflow:clip → 内容被静默裁掉（遮挡）；
//   ④ 左右栏 li 高度内容驱动 → 逐行错位。
//
// 夹具取自 scripts/output/pres_mu7skl55_0cmg3m7/05-content5-response.html（精简为 2 行/栏）。
// ============================================================================
import { describe, it, expect } from 'vitest';
import { LayoutEngine } from '@noppt/core/engine/layout-engine';
import { postProcessHtmlSnapshot } from '../html-presentation/palette';

const RAW_COMPARISON_HTML = `<div style="width:100%;height:100%;overflow:hidden;position:relative;box-sizing:border-box;padding:48px 64px;display:flex;flex-direction:column;background-color:#f7f8fa;font-family:system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif;" data-layout="comparison-deep-dive">
  <h2 style="font-size:50px;font-weight:700;margin:0 0 32px 0;line-height:1.25;">厄尔尼诺与拉尼娜：气候双胞胎的对比</h2>
  <div style="pointer-events:none;display:flex;gap:24px;align-items:center;justify-content:center;margin-bottom:24px;min-width:0;">
    <div style="display:inline-flex;align-items:center;gap:10px;padding:8px 18px;border-radius:999px;background:#F9FAFB;border:1px solid #E5E7EB;">
      <span style="display:inline-block;width:16px;height:16px;border-radius:4px;border:2px solid #E5E7EB;background:#fff;"></span>
      <span style="font-size:18px;color:#4B5563;font-weight:600;">基准气候态</span>
    </div>
  </div>
  <div style="flex:1;display:flex;gap:28px;min-height:0;min-width:0;align-items:stretch;">
    <div style="flex:1;padding:28px 24px;border-radius:16px;border:2px solid #E5E7EB;background:#F9FAFB;display:flex;flex-direction:column;gap:16px;min-width:0;min-height:0;">
      <h3 style="font-size:28px;font-weight:700;color:#4B5563;margin:0;text-align:center;padding-bottom:14px;border-bottom:2px solid #E5E7EB;">基准气候态</h3>
      <ul style="margin:0;padding:0;list-style:none;flex:1;min-width:0;display:flex;flex-direction:column;gap:16px;min-height:0;">
        <li style="display:flex;flex-direction:column;gap:8px;padding:16px 24px;border-radius:12px;background:#FFFFFF;border:1px solid #E5E7EB;min-width:0;">
          <div style="display:flex;align-items:center;gap:12px;">
            <span style="display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:22px;height:22px;border-radius:50%;background:#E5E7EB;">
              <svg width="10" height="10" viewBox="0 0 10 10"><rect x="2" y="4.5" width="6" height="1.5" rx="0.75" fill="#9CA3AF"/></svg>
            </span>
            <span style="font-size:19px;font-weight:600;color:#374151;line-height:1.4;flex:1;min-width:0;">海表温度异常</span>
          </div>
          <div style="width:100%;height:8px;border-radius:999px;background:#E5E7EB;overflow:hidden;">
            <div style="pointer-events:none;width:60%;height:100%;border-radius:999px;background:linear-gradient(135deg,#9CA3AF,#6B7280);"></div>
          </div>
        </li>
        <li style="display:flex;flex-direction:column;gap:8px;padding:16px 24px;border-radius:12px;background:#FFFFFF;border:1px solid #E5E7EB;min-width:0;">
          <div style="display:flex;align-items:center;gap:12px;">
            <span style="display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:22px;height:22px;border-radius:50%;background:#E5E7EB;">
              <svg width="10" height="10" viewBox="0 0 10 10"><rect x="2" y="4.5" width="6" height="1.5" rx="0.75" fill="#9CA3AF"/></svg>
            </span>
            <span style="font-size:19px;font-weight:600;color:#374151;line-height:1.4;flex:1;min-width:0;">大气环流变化</span>
          </div>
          <div style="width:100%;height:8px;border-radius:999px;background:#E5E7EB;overflow:hidden;">
            <div style="pointer-events:none;width:60%;height:100%;border-radius:999px;background:linear-gradient(135deg,#9CA3AF,#6B7280);"></div>
          </div>
        </li>
      </ul>
    </div>
    <div style="flex:1;padding:28px 24px;border-radius:16px;background:linear-gradient(135deg,#27ae6006,#27ae600A);display:flex;flex-direction:column;gap:16px;min-width:0;min-height:0;box-shadow:0 8px 28px #27ae6018;">
      <h3 style="font-size:28px;font-weight:800;margin:0;text-align:center;padding-bottom:14px;border-bottom:2px solid #27ae6035;">气候事件影响</h3>
      <ul style="margin:0;padding:0;list-style:none;flex:1;min-width:0;display:flex;flex-direction:column;gap:16px;min-height:0;">
        <li style="display:flex;flex-direction:column;gap:10px;padding:18px 22px;border-radius:14px;background:#FFFFFF;border-left:5px solid #27ae60;box-shadow:0 4px 16px #27ae6018;min-width:0;">
          <div style="display:flex;align-items:center;gap:12px;">
            <span style="display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,#27ae60,#1f8b4d);">
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M13 4L6.5 10.5L3 7" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </span>
            <span style="font-size:20px;font-weight:700;color:#111827;line-height:1.4;flex:1;min-width:0;">海表温度异常</span>
            <span style="pointer-events:none;display:inline-flex;align-items:center;padding:4px 12px;border-radius:999px;background:#27ae6020;color:#1f8b4d;font-size:16px;font-weight:800;white-space:nowrap;">+60%</span>
          </div>
          <div style="width:100%;height:12px;border-radius:999px;background:#27ae6020;overflow:hidden;">
            <div style="pointer-events:none;width:60%;height:100%;border-radius:999px;background:linear-gradient(135deg,#7dcea0 0%,#27ae60 45%,#1f8b4d 100%);"></div>
          </div>
        </li>
        <li style="display:flex;flex-direction:column;gap:10px;padding:18px 22px;border-radius:14px;background:#FFFFFF;border-left:5px solid #27ae60;box-shadow:0 4px 16px #27ae6018;min-width:0;">
          <div style="display:flex;align-items:center;gap:12px;">
            <span style="display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,#27ae60,#1f8b4d);">
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M13 4L6.5 10.5L3 7" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </span>
            <span style="font-size:20px;font-weight:700;color:#111827;line-height:1.4;flex:1;min-width:0;">大气环流变化</span>
            <span style="pointer-events:none;display:inline-flex;align-items:center;padding:4px 12px;border-radius:999px;background:#27ae6020;color:#1f8b4d;font-size:16px;font-weight:800;white-space:nowrap;">+60%</span>
          </div>
          <div style="width:100%;height:12px;border-radius:999px;background:#27ae6020;overflow:hidden;">
            <div style="pointer-events:none;width:60%;height:100%;border-radius:999px;background:linear-gradient(135deg,#7dcea0 0%,#27ae60 45%,#1f8b4d 100%);"></div>
          </div>
        </li>
      </ul>
    </div>
  </div>
</div>`;

/** 去掉合法 <svg> 后是否还有泄漏的图形元素 */
const leakedShapes = (html: string): RegExpMatchArray | null =>
  html.replace(/<svg\b[\s\S]*?<\/svg>/gi, '').match(/<(rect|path|circle|line|polyline|polygon)\b/i);

describe('comparison-deep-dive 端到端（LLM HTML → 后处理 → LayoutEngine）', () => {
  const run = (): string => {
    const afterPost = postProcessHtmlSnapshot(RAW_COMPARISON_HTML, {
      primaryColor: '#27ae60',
      pageType: 'comparison-deep-dive',
    });
    return LayoutEngine.normalizeAISlide({
      id: 's',
      title: 't',
      html: afterPost,
    } as any).html;
  };

  it('全流程结束后 SVG 图形完整、无 <rect>/<path> 泄漏为 HTML 未知元素', () => {
    const out = run();
    expect(leakedShapes(out)).toBeNull();
    expect(out).not.toMatch(/<rect\b[^>]*>[\s\S]*?<\/rect>/i);
    // 图标 svg 仍带图形子节点（说明没有被拆空）
    expect(out).toMatch(/<svg[^>]*viewBox="0 0 10 10"[^>]*>\s*<rect[^>]*/i);
    expect(out).toMatch(/<svg[^>]*viewBox="0 0 16 16"[^>]*>\s*<path[^>]*/i);
  });

  it('文案与徽章未被吞掉', () => {
    const out = run();
    for (const label of ['海表温度异常', '大气环流变化']) {
      expect(out.split(label).length - 1).toBe(2);
    }
    expect(out).toContain('+60%');
  });

  it('左右两栏 ul 被行对齐为等分 grid（2 行）', () => {
    const out = run();
    const gridUls = out.match(/<ul\b[^>]*display:grid[^>]*>/gi) || [];
    expect(gridUls).toHaveLength(2);
    // balanceComparisonDeepDiveLIs 会把每栏补齐到至少 3 行，故以处理后的实际行数断言
    const rowsPerColumn = ((out.match(/<li\b/gi) || []).length) / 2;
    expect(rowsPerColumn).toBeGreaterThanOrEqual(3);
    for (const ul of gridUls) {
      // 允许后处理在冒号后补空格（style 重新序列化），故用宽松匹配
      expect(ul).toMatch(
        new RegExp(`grid-template-rows:\\s*repeat\\(\\s*${rowsPerColumn}\\s*,\\s*1fr\\s*\\)`, 'i'),
      );
    }
  });

  it('左右栏卡片不再被补 overflow:clip（避免静默裁切造成遮挡）', () => {
    const out = run();
    // 栏卡片（flex:1 的左右两列）不得带 overflow:clip
    const columns = out.match(/<div\b[^>]*flex:\s*1[^>]*>/gi) || [];
    const clipped = columns.filter((d) => /overflow:\s*clip/i.test(d));
    expect(clipped).toHaveLength(0);
  });

  it('8pt 归一后左右栏 li 的纵向 padding 仍保持一致（行高对称）', () => {
    const out = run();
    const liPads = (out.match(/<li\b[^>]*>/gi) || [])
      .map((li) => /padding:\s*([^;"]+)/i.exec(li)?.[1]?.trim())
      .filter(Boolean) as string[];
    expect(liPads.length).toBeGreaterThanOrEqual(4);
    // 纵向 padding（第一个值）在左右栏必须一致
    const vertical = liPads.map((p) => p.split(/\s+/)[0]);
    expect(new Set(vertical).size).toBe(1);
  });
});
