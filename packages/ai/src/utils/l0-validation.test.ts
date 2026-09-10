import { describe, it, expect } from 'vitest';
import { l0ValidateSlide, contrastRatio } from './l0-validation';

describe('l0ValidateSlide (FR-4 底线 · Task5)', () => {
  it('检测正文字号 < 12px 为致命项', () => {
    const html = `<div style="font-size:10px;">过小正文</div>`;
    const issues = l0ValidateSlide(html, 'content-no-image');
    expect(issues.some((i) => i.severity === 'fatal' && i.rule === 'font-size>=12px')).toBe(true);
  });

  it('字号 = 12px 不报错', () => {
    const html = `<div style="font-size:12px;">正文</div>`;
    const issues = l0ValidateSlide(html, 'content-no-image');
    expect(issues.some((i) => i.rule === 'font-size>=12px')).toBe(false);
  });

  it('pt/em/rem 折算后 < 12px 也被捕获', () => {
    const issues = l0ValidateSlide(`<p style="font-size:0.5rem;">x</p>`, 'content-no-image');
    expect(issues.some((i) => i.rule === 'font-size>=12px')).toBe(true);
  });

  it('相对单位(vh/vw/%)无法静态折算时跳过，不误杀', () => {
    const issues = l0ValidateSlide(`<p style="font-size:1vw;">x</p>`, 'content-no-image');
    expect(issues.some((i) => i.rule === 'font-size>=12px')).toBe(false);
  });

  it('极低对比度（白底白字）报 important', () => {
    const html = `<div style="color:#ffffff;background:#ffffff;">不可读</div>`;
    const issues = l0ValidateSlide(html, 'content-no-image');
    expect(issues.some((i) => i.rule === 'contrast>=4.5:1')).toBe(true);
  });

  it('高对比度（黑底白字）通过', () => {
    const html = `<div style="color:#ffffff;background:#000000;">清晰</div>`;
    const issues = l0ValidateSlide(html, 'content-no-image');
    expect(issues.some((i) => i.rule === 'contrast>=4.5:1')).toBe(false);
  });

  it('渐变背景无法静态判定时跳过', () => {
    const html = `<div style="color:#ffffff;background:linear-gradient(180deg,#000,#fff);">x</div>`;
    const issues = l0ValidateSlide(html, 'content-no-image');
    expect(issues.some((i) => i.rule === 'contrast>=4.5:1')).toBe(false);
  });

  it('无样式文本无违规', () => {
    expect(l0ValidateSlide(`<div><p>纯文本</p></div>`, 'content-no-image')).toHaveLength(0);
  });
});

describe('contrastRatio (WCAG)', () => {
  it('黑/白 = 21', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
  });
  it('同色 = 1', () => {
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 0);
  });
  it('无法解析返回 -1', () => {
    expect(contrastRatio('notacolor', '#fff')).toBe(-1);
  });
});
