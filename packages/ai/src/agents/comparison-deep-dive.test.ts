import { describe, it, expect } from 'vitest';
import { LayoutEngine } from '@noppt/core/engine/layout-engine';
import type { Slide } from '@noppt/core/models/slide';

// ——— 共享工具：把 HTML 包装成 Slide 喂给 LayoutEngine.normalizeAISlide ———
const normalizeHtml = (html: string): string => {
  const slide: Slide = {
    id: 'test-slide',
    title: '测试',
    html,
  };
  return LayoutEngine.normalizeAISlide(slide).html;
};

/** 按已知锚点+深度匹配，从 HTML 中提取 comparison-deep-dive 两栏的内部内容 */
const extractCardInnerByAnchor = (
  html: string,
  anchor: { bgRe: RegExp; borderOrShadowRe: RegExp },
): string | null => {
  const openRe = /<div\b([^>]*)>/gi;
  let m: RegExpExecArray | null;
  while ((m = openRe.exec(html)) !== null) {
    const attrs = m[1] || '';
    if (!anchor.bgRe.test(attrs)) continue;
    if (!anchor.borderOrShadowRe.test(attrs)) continue;
    let depth = 1;
    const openLen = m[0].length;
    const scan = /<(\/?)div\b([^>]*)>/gi;
    scan.lastIndex = m.index + openLen;
    let p: RegExpExecArray | null;
    while ((p = scan.exec(html)) !== null) {
      if (p[1] === '/') {
        if (--depth === 0) {
          return html.substring(m.index + openLen, p.index);
        }
      } else if (!/\/\s*$/.test(p[2] || '')) {
        depth++;
      }
    }
  }
  return null;
};

const RIGHT_CARD_ANCHOR = {
  bgRe: /background\s*:\s*linear-gradient\s*\(\s*135deg\s*,\s*#0891b206\s*,\s*#0891b20A\s*\)/i,
  borderOrShadowRe: /box-shadow\s*:\s*0\s*8px\s*28px\s*#0891b218/i,
};
const LEFT_CARD_ANCHOR = {
  bgRe: /background\s*:\s*#F9FAFB/i,
  borderOrShadowRe: /border\s*:\s*2px\s*solid\s*#E5E7EB/i,
};

// comparison-deep-dive 骨架（方便插入/不插入右栏图片）
// 注意：data-layout 路由要求"HTML 以 <div/section/article>"开头，不能有前置空白，
// 因为 normalizeAISlide 的布局识别正则锚定在 ^ 开头。
const buildComparisonDeepDive = (rightBetweenH3AndUl: string, leftBetweenH3AndUl: string = ''): string =>
  `<div style="width:100%;height:100%;padding:48px 64px;display:flex;flex-direction:column;box-sizing:border-box;" data-layout="comparison-deep-dive">
  <h2 style="font-size:50px;font-weight:700;margin:0 0 32px 0;line-height:1.25;">厄尔尼诺年份与正常年份的全球气候及生态差异显著</h2>
  <div style="pointer-events:none;display:flex;gap:24px;align-items:center;justify-content:center;margin-bottom:24px;min-width:0;">
    <div style="display:inline-flex;align-items:center;gap:8px;padding:8px 16px;border-radius:999px;background:#F9FAFB;border:1px solid #E5E7EB;">
      <span style="display:inline-block;width:16px;height:16px;border-radius:4px;border:2px solid #E5E7EB;background:#fff;"></span>
      <span style="font-size:18px;color:#4B5563;font-weight:600;">基准方案</span>
    </div>
    <div style="display:inline-flex;align-items:center;gap:8px;padding:8px 16px;border-radius:999px;background:#0891b210;border:1px solid #0891b235;">
      <span style="display:inline-block;width:16px;height:16px;border-radius:4px;border:2px solid #0891b2;background:#0891b205;"></span>
      <span style="font-size:18px;color:#06748e;font-weight:700;">升级方案</span>
    </div>
  </div>
  <div style="flex:1;display:flex;gap:24px;min-height:0;min-width:0;align-items:stretch;">
    <div style="flex:1;padding:24px;border-radius:16px;border:2px solid #E5E7EB;background:#F9FAFB;display:flex;flex-direction:column;gap:16px;min-width:0;min-height:0;">
      <h3 style="font-size:28px;font-weight:700;color:#4B5563;margin:0;text-align:center;padding-bottom:16px;border-bottom:2px solid #E5E7EB;">基准方案 / 现有方案</h3>
      ${leftBetweenH3AndUl}
      <ul style="margin:0;padding:0;list-style:none;flex:1;min-width:0;display:flex;flex-direction:column;gap:16px;min-height:0;">
        <li style="display:flex;flex-direction:column;gap:8px;padding:16px 24px;border-radius:12px;background:#FFFFFF;border:1px solid #E5E7EB;">L1 赤道太平洋海温</li>
        <li style="display:flex;flex-direction:column;gap:8px;padding:16px 24px;border-radius:12px;background:#FFFFFF;border:1px solid #E5E7EB;">L2 沃克环流强度</li>
        <li style="display:flex;flex-direction:column;gap:8px;padding:16px 24px;border-radius:12px;background:#FFFFFF;border:1px solid #E5E7EB;">L3 南美西海岸降水</li>
        <li style="display:flex;flex-direction:column;gap:8px;padding:16px 24px;border-radius:12px;background:#FFFFFF;border:1px solid #E5E7EB;">L4 东南亚地区降水</li>
        <li style="display:flex;flex-direction:column;gap:8px;padding:16px 24px;border-radius:12px;background:#FFFFFF;border:1px solid #E5E7EB;">L5 全球农业产量波动</li>
      </ul>
    </div>
    <div style="flex:1;padding:24px;border-radius:16px;background:linear-gradient(135deg,#0891b206,#0891b20A);display:flex;flex-direction:column;gap:16px;min-width:0;min-height:0;box-shadow:0 8px 28px #0891b218;">
      <h3 style="font-size:28px;font-weight:800;margin:0;text-align:center;padding-bottom:16px;border-bottom:2px solid #0891b235;">升级方案 / 优势方案</h3>
      ${rightBetweenH3AndUl}
      <ul style="margin:0;padding:0;list-style:none;flex:1;min-width:0;display:flex;flex-direction:column;gap:16px;min-height:0;">
        <li style="display:flex;flex-direction:column;gap:8px;padding:16px 24px;border-radius:14px;background:#FFFFFF;border-left:5px solid #0891b2;box-shadow:0 4px 16px #0891b218;">R1 赤道太平洋海温 <span>+60%</span></li>
        <li style="display:flex;flex-direction:column;gap:8px;padding:16px 24px;border-radius:14px;background:#FFFFFF;border-left:5px solid #0891b2;box-shadow:0 4px 16px #0891b218;">R2 沃克环流强度 <span>+60%</span></li>
        <li style="display:flex;flex-direction:column;gap:8px;padding:16px 24px;border-radius:14px;background:#FFFFFF;border-left:5px solid #0891b2;box-shadow:0 4px 16px #0891b218;">R3 南美西海岸降水 <span>+60%</span></li>
        <li style="display:flex;flex-direction:column;gap:8px;padding:16px 24px;border-radius:14px;background:#FFFFFF;border-left:5px solid #0891b2;box-shadow:0 4px 16px #0891b218;">R4 东南亚地区降水 <span>+60%</span></li>
        <li style="display:flex;flex-direction:column;gap:8px;padding:16px 24px;border-radius:14px;background:#FFFFFF;border-left:5px solid #0891b2;box-shadow:0 4px 16px #0891b218;">R5 全球农业产量波动 <span>+60%</span></li>
      </ul>
    </div>
  </div>
</div>`;

const INVASIVE_IMG = `<div style="overflow:hidden;display:flex;align-items:stretch;min-height:0;margin-bottom:16px;border-radius:12px;"><img src="https://NOPPT_IMAGE_PLACEHOLDER" data-image-ratio="4:3" style="width:100%;height:100%;object-fit:cover;border-radius:16px;display:block;"></div>`;

describe('FR-4 sanitizeComparisonColumnInjectedImages — comparison-deep-dive 入侵图清理', () => {
  // CD-3：右栏 h3 与 ul 之间的 imageWrap + img 应当被清除
  it('CD-3 右栏 h3↔ul 之间的入侵图 wrap+img 被完整移除，ul 保留', () => {
    const src = buildComparisonDeepDive(INVASIVE_IMG);
    expect(src).toMatch(/<img\b/); // 先确认输入含 img
    const out = normalizeHtml(src);
    // 右栏卡片内部 img 计数为 0（data-layout=comparison 会走 repair）
    const rightInner = extractCardInnerByAnchor(out, RIGHT_CARD_ANCHOR);
    expect(rightInner).toBeTruthy();
    expect(rightInner!).not.toMatch(/<img\b/i);
    // ul 仍保留 5 条
    const liCount = (rightInner!.match(/<li\b/gi) || []).length;
    expect(liCount).toBe(5);
    // h3 不丢
    expect(rightInner!).toMatch(/升级方案\s*\/\s*优势方案/);
  });

  // CD-4：对干净 comparison（无入侵图）幂等，不做破坏性改动
  it('CD-4 干净 comparison-deep-dive（无入侵图）结构基本保持不变（不引入 img、li 数量一致）', () => {
    const src = buildComparisonDeepDive('');
    expect(src).not.toMatch(/<img\b/i);
    const out = normalizeHtml(src);
    const rightInner = extractCardInnerByAnchor(out, RIGHT_CARD_ANCHOR);
    expect(rightInner).toBeTruthy();
    expect(rightInner!).not.toMatch(/<img\b/i);
    const rightLiCount = (rightInner!.match(/<li\b/gi) || []).length;
    expect(rightLiCount).toBe(5);
    const leftInner = extractCardInnerByAnchor(out, LEFT_CARD_ANCHOR);
    expect(leftInner).toBeTruthy();
    const leftLiCount = (leftInner!.match(/<li\b/gi) || []).length;
    expect(leftLiCount).toBeGreaterThanOrEqual(5);
  });

  // CD-5：左栏 h3↔ul 之间的入侵图也能被清理
  it('CD-5 左栏 h3↔ul 之间的入侵图同样被清理', () => {
    const src = buildComparisonDeepDive('', INVASIVE_IMG);
    expect(src).toMatch(/<img\b/);
    const out = normalizeHtml(src);
    // 左栏基准方案卡片
    const leftInner = extractCardInnerByAnchor(out, LEFT_CARD_ANCHOR);
    expect(leftInner).toBeTruthy();
    expect(leftInner!).not.toMatch(/<img\b/i);
    const liCount = (leftInner!.match(/<li\b/gi) || []).length;
    expect(liCount).toBeGreaterThanOrEqual(5);
  });

  // 额外：包裹层内若嵌套多层 div 再藏 img，也能一起被剥掉
  it('额外：嵌套两层 div 包裹的 img（LLM 可能写出多层 flex 包裹）仍能完整删除', () => {
    const nestedImg = `<div style="margin-bottom:16px;"><div style="overflow:hidden;display:flex;align-items:stretch;min-height:0;border-radius:12px;"><img src="x.png" data-image-ratio="4:3" style="width:100%;height:100%;object-fit:cover;"></div></div>`;
    const src = buildComparisonDeepDive(nestedImg);
    const out = normalizeHtml(src);
    const rightInner = extractCardInnerByAnchor(out, RIGHT_CARD_ANCHOR);
    expect(rightInner).toBeTruthy();
    expect(rightInner!).not.toMatch(/<img\b/i);
    // 右栏 ul 不应丢
    expect((rightInner!.match(/<li\b/gi) || []).length).toBe(5);
  });
});
