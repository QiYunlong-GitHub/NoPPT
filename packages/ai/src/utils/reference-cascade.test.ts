import { JSDOM } from 'jsdom';
import { buildCascadeIndex, resolveComputedDecl, toHex, firstColorIn } from './reference-style-cascade';

function docOf(inner: string): Document {
  return new JSDOM(`<body>${inner}</body>`).window.document;
}

describe('reference-style-cascade', () => {
  it('toHex 归一化 #rgb / rgb()', () => {
    expect(toHex('#abc')).toBe('#aabbcc');
    expect(toHex('rgb(255, 0, 0)')).toBe('#ff0000');
    expect(toHex('notacolor')).toBeUndefined();
  });

  it('firstColorIn 从 linear-gradient 抽取首个颜色', () => {
    expect(firstColorIn('linear-gradient(135deg,#ff4d6d,#ffffff)')).toBe('#ff4d6d');
    expect(firstColorIn('rgb(10,20,30)')).toBe('rgb(10, 20, 30)');
  });

  it('解析 <style> 并按特异性排序（id > class > tag）', () => {
    const doc = docOf(
      `<style>.a{color:#111;}#b{color:#222;}div{color:#333;}</style><div id="b" class="a">x</div>`,
    );
    const idx = buildCascadeIndex(doc);
    const el = doc.querySelector('#b') as Element;
    expect(resolveComputedDecl(el, 'color', '', idx)).toBe('#222');
  });

  it('CSS 变量 var() 替换', () => {
    const doc = docOf(`<style>:root{--p:#ff4d6d;}.a{color:var(--p);}</style><div class="a">x</div>`);
    const idx = buildCascadeIndex(doc);
    expect(resolveComputedDecl(doc.querySelector('.a') as Element, 'color', '', idx)).toBe('#ff4d6d');
  });

  it('inline 覆盖级联值', () => {
    const doc = docOf(`<style>.a{color:#111;}</style><div class="a" style="color:#999">x</div>`);
    const idx = buildCascadeIndex(doc);
    expect(resolveComputedDecl(doc.querySelector('.a') as Element, 'color', '#999', idx)).toBe('#999');
  });

  it('后代组合子 .a .b 命中', () => {
    const doc = docOf(`<style>.a .b{color:#654321;}</style><div class="a"><span class="b">t</span></div>`);
    const idx = buildCascadeIndex(doc);
    expect(resolveComputedDecl(doc.querySelector('.b') as Element, 'color', '', idx)).toBe('#654321');
  });

  it('@media 整块被跳过', () => {
    const doc = docOf(`<style>@media(max-width:600px){.a{color:#000;}}</style><div class="a">x</div>`);
    const idx = buildCascadeIndex(doc);
    expect(idx.styleRulesCount).toBe(0);
    expect(resolveComputedDecl(doc.querySelector('.a') as Element, 'color', '', idx)).toBeUndefined();
  });
});
