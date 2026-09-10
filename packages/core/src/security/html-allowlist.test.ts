import { describe, it, expect } from 'vitest';
import { ALLOWED_TAGS, ALLOWED_ATTRIBUTES, ALLOWED_CSS_PROPERTIES } from './html-allowlist';

describe('html-allowlist（server/web 单一真源 · 防漂移回归）', () => {
  it('ALLOWED_ATTRIBUTES 必须放行全部母版/封面幂等标记', () => {
    for (const attr of [
      'data-master',
      'data-master-hero-wrap',
      'data-master-hero',
      'data-master-hero-scrim',
      'data-master-logo',
      'data-master-header',
      'data-master-footer',
      'data-master-side',
      'data-master-watermark',
      'data-noppt-coverart',
    ]) {
      expect(ALLOWED_ATTRIBUTES).toContain(attr);
    }
  });

  it('ALLOWED_CSS_PROPERTIES 必须放行 inset（前端剥离导致母版层归零的根因）', () => {
    expect(ALLOWED_CSS_PROPERTIES.has('inset')).toBe(true);
  });

  it('ALLOWED_CSS_PROPERTIES 必须放行 background-* 与四边定位（hero/母版层依赖）', () => {
    for (const p of [
      'background',
      'background-image',
      'background-size',
      'background-position',
      'background-repeat',
      'background-color',
      'top',
      'left',
      'right',
      'bottom',
      'position',
      'z-index',
    ]) {
      expect(ALLOWED_CSS_PROPERTIES.has(p)).toBe(true);
    }
  });

  it('ALLOWED_TAGS 包含常用结构/媒体标签', () => {
    for (const t of ['div', 'section', 'header', 'footer', 'img', 'table', 'svg']) {
      expect(ALLOWED_TAGS).toContain(t);
    }
  });
});
