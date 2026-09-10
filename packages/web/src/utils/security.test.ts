// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { sanitizeHtml } from './security';

describe('sanitizeHtml（web 端 · 母版/参考背景不剥离回归）', () => {
  it('保留 data-master* 幂等标记（历史上被剥离 → 母版层归零）', () => {
    const html = `<div data-master='{"logo":1}' data-master-logo data-master-header>hi</div>`;
    const out = sanitizeHtml(html);
    expect(out).toContain('data-master=');
    expect(out).toContain('data-master-logo');
    expect(out).toContain('data-master-header');
  });

  it('保留 inset（母版层定位依赖，剥离则 0 尺寸）', () => {
    const html = `<div style="position:absolute;inset:0;pointer-events:none;">x</div>`;
    const out = sanitizeHtml(html);
    // web 端会规范化 style（inset:0 → inset: 0），只需断言属性未被剥离
    expect(out).toContain('inset: 0');
    expect(out).toContain('pointer-events: none');
  });

  it('保留 background-* 与四边定位（hero/母版层背景）', () => {
    const html = `<div style="background-image:url('/data/x.png');background-size:100% 200%;background-position:0% 50%;top:0;left:0;right:0;bottom:0;">x</div>`;
    const out = sanitizeHtml(html);
    expect(out).toContain('background-image');
    expect(out).toContain('background-size');
    expect(out).toContain('background-position');
    expect(out).toContain('top: 0');
    expect(out).toContain('right: 0');
  });

  it('仍剥离脚本与危险 URL（XSS 防护有效）', () => {
    const html = `<div><script>alert(1)</script><a href="javascript:alert(2)">x</a><img src="javascript:alert(3)"></div>`;
    const out = sanitizeHtml(html);
    expect(out).not.toContain('<script');
    expect(out).not.toContain('javascript:');
  });
});
