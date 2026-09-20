import { describe, it, expect } from 'vitest';
// T1-TR1 · 等 8pt 网格归一化的纯函数（抽取后将从 html-presentation-agent.ts 导出）
import { normalizeSpacing8pt, assertSpacing8pt, roundTo8 } from '../utils/grid-8pt';

// ============================================================
// roundTo8：不再「单向放大」的就近取整（pres_mu7skl55_0cmg3m7 slide-03 修复）
// 旧实现 Math.max(8, Math.round(v/8)*8) 会把 4→8、12→16、20→24、28→32，
// 逐层累加后把卡片撑爆并溢出画布；新规则小值保原值、半步长向下取。
// ============================================================
describe('roundTo8 · 就近取整且不单向放大', () => {
  it('非正数与小于一个步长的值原样返回（4px 不再被抬到 8px）', () => {
    expect(roundTo8(0)).toBe(0);
    expect(roundTo8(-8)).toBe(-8);
    expect(roundTo8(2)).toBe(2);
    expect(roundTo8(4)).toBe(4);
    expect(roundTo8(6)).toBe(6);
  });

  it('半步长（余数=4）统一向下取：12→8 / 20→16 / 28→24', () => {
    expect(roundTo8(12)).toBe(8);
    expect(roundTo8(20)).toBe(16);
    expect(roundTo8(28)).toBe(24);
  });

  it('余数<4 向下、余数>4 向上，单次增量恒 < 4px', () => {
    expect(roundTo8(19)).toBe(16);
    expect(roundTo8(14)).toBe(16);
    expect(roundTo8(30)).toBe(32);
    expect(roundTo8(31)).toBe(32);
    // 增量断言：任何值归整后的增幅都不超过 3px
    for (let v = 8; v <= 128; v++) {
      expect(roundTo8(v) - v).toBeLessThanOrEqual(3);
    }
  });

  it('已是 8 倍数的值保持幂等', () => {
    expect(roundTo8(8)).toBe(8);
    expect(roundTo8(16)).toBe(16);
    expect(roundTo8(48)).toBe(48);
    expect(roundTo8(64)).toBe(64);
  });
});

describe('Task1 T1-TR1 · normalizeSpacing8pt 保留 style 分隔符', () => {
  it('T1-TR1a: padding:48px 64px;display:flex 不产生粘连', () => {
    const out = normalizeSpacing8pt(
      '<div style="width:100%;padding:48px 64px;display:flex;">x</div>',
    );
    expect(out).not.toMatch(/pxdisplay|pxd[^i;]/i);
    expect(out).toContain('padding:48px 64px;display:flex');
  });

  it('T1-TR1b: gap:12px;align-items:center → gap 保留分号 / 值归一化', () => {
    const out = normalizeSpacing8pt('<div style="gap:12px;align-items:center;">x</div>');
    // 12 → 8（半步长向下取整到 8 倍数；旧实现上取整成 16 会撑大容器）
    expect(out).toContain('gap:8px;align-items:center');
  });

  it('T1-TR1c: 值已合规时仍保留分隔符（48px/64px 本已是 8 倍数）', () => {
    const out = normalizeSpacing8pt(
      '<div style="padding:48px 64px;display:flex;flex-direction:column;">x</div>',
    );
    expect(out).toContain('padding:48px 64px;display:flex');
    expect(countPxStickySync(out)).toBe(0);
  });

  it('T1-TR1d: margin-top:19px → 16px + 保留后续分号', () => {
    const out = normalizeSpacing8pt('<div style="margin-top:19px;border:1px solid red;">x</div>');
    expect(out).toContain('margin-top:16px;border:1px solid red');
  });

  it('T1-TR1e: 多属性夹杂 gap 与 padding 的 style，归一后不产生 pxSticky', () => {
    const html = `<div style="padding:48px 64px;display:flex;flex-direction:column;gap:20px;justify-content:space-between;margin-bottom:13px;">x</div>`;
    const out = normalizeSpacing8pt(html);
    expect(countPxStickySync(out)).toBe(0);
  });
});

describe('Task1 · 可选 shouldSkip 跳过谓词（决策 4 间距豁免）', () => {
  const HTML = '<p style="margin:0 0 20px 0;font-size:24px;">x</p>';

  it('f: shouldSkip 命中时该 style 逐字节原样保留', () => {
    const out = normalizeSpacing8pt(HTML, () => true);
    expect(out).toBe(HTML);
  });

  it('g: 不传 shouldSkip 时 margin 20px 被规整为 16px（半步长向下取整到 8 倍数）', () => {
    const out = normalizeSpacing8pt(HTML);
    expect(out).toContain('margin:0 0 16px 0');
  });

  it('h: assertSpacing8pt 命中 shouldSkip 时原样返回且不计 violations', () => {
    const { html: out, violations } = assertSpacing8pt(HTML, () => true);
    expect(out).toBe(HTML);
    expect(violations).toHaveLength(0);
  });

  it('i: assertSpacing8pt 不传 shouldSkip 仍记录 violations', () => {
    const { violations } = assertSpacing8pt(HTML);
    expect(violations.length).toBeGreaterThan(0);
  });
});

// 与 countPxSticky 等价的轻量内联实现（便于独立测试）
function countPxStickySync(html: string): number {
  const re = /\d+px/g;
  let count = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const endIdx = m.index + m[0].length;
    if (endIdx >= html.length) continue;
    const ch = html[endIdx];
    if (/\s/.test(ch)) continue;
    if (';"\')]>},.:/%#`'.includes(ch)) continue;
    if (/[A-Za-z-]/.test(ch)) count++;
  }
  return count;
}
