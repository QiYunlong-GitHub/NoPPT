import { describe, it, expect } from 'vitest';
// T1-TR1 · 等 8pt 网格归一化的纯函数（抽取后将从 html-presentation-agent.ts 导出）
import {
  normalizeSpacing8pt,
  assertSpacing8pt,
} from '../utils/grid-8pt';

describe('Task1 T1-TR1 · normalizeSpacing8pt 保留 style 分隔符', () => {
  it('T1-TR1a: padding:48px 64px;display:flex 不产生粘连', () => {
    const out = normalizeSpacing8pt('<div style="width:100%;padding:48px 64px;display:flex;">x</div>');
    expect(out).not.toMatch(/pxdisplay|pxd[^i;]/i);
    expect(out).toContain('padding:48px 64px;display:flex');
  });

  it('T1-TR1b: gap:12px;align-items:center → gap 保留分号 / 值归一化', () => {
    const out = normalizeSpacing8pt('<div style="gap:12px;align-items:center;">x</div>');
    // 12 → 16（上取整到 8 倍数）
    expect(out).toContain('gap:16px;align-items:center');
  });

  it('T1-TR1c: 值已合规时仍保留分隔符（48px/64px 本已是 8 倍数）', () => {
    const out = normalizeSpacing8pt('<div style="padding:48px 64px;display:flex;flex-direction:column;">x</div>');
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

  it('g: 不传 shouldSkip 时 margin 20px 仍被规整为 24px（上取整到 8 倍数，向后兼容，行为不变）', () => {
    const out = normalizeSpacing8pt(HTML);
    expect(out).toContain('margin:0 0 24px 0');
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
