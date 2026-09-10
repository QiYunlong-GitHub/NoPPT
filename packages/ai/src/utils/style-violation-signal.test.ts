import { describe, it, expect } from 'vitest';
import { detectBlackBlockTitle } from './style-violation-signal';

describe('detectBlackBlockTitle · 黑块标题 fatal 信号', () => {
  it('命中：background 简写写在 clip 之后（pres_mtrcm1nx 现场）', () => {
    const html =
      '<h1 style="font-size:92px;color:#22223b;-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;background:linear-gradient(135deg,#22223b,#5c5c72);">标题</h1>';
    expect(detectBlackBlockTitle(html)).toBe(true);
  });

  it('不命中：有效渐变文字（background 在 clip 之前）', () => {
    const html =
      '<h1 style="background:linear-gradient(135deg,#ff4d6d,#c9184a);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;">标题</h1>';
    expect(detectBlackBlockTitle(html)).toBe(false);
  });

  it('不命中：普通纯色标题', () => {
    const html = '<h1 style="font-size:80px;color:#22223b;">标题</h1>';
    expect(detectBlackBlockTitle(html)).toBe(false);
  });
});
