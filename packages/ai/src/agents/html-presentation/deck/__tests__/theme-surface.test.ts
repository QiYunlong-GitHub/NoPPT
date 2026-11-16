/**
 * 阶段 5：展示层主题变量契约（编辑器 / 预览页 / MCP 舞台共用）。
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_THEME_VARS,
  NOPPT_THEME_VARS,
  themeVarsToCss,
} from '@noppt/core/deck';

describe('主题 CSS 变量契约', () => {
  it('所有变量键都是合法的 CSS 自定义属性', () => {
    for (const key of Object.values(NOPPT_THEME_VARS)) {
      expect(key).toMatch(/^--[a-z0-9-]+$/);
    }
    for (const key of Object.keys(DEFAULT_THEME_VARS)) {
      expect(key).toMatch(/^--[a-z0-9-]+$/);
    }
  });

  it('默认主题提供舞台底色、表面色、主色、文字色与边框色', () => {
    expect(DEFAULT_THEME_VARS[NOPPT_THEME_VARS.stageBg]).toBe('#f5f7fb');
    expect(DEFAULT_THEME_VARS[NOPPT_THEME_VARS.surface]).toBe('#ffffff');
    expect(DEFAULT_THEME_VARS[NOPPT_THEME_VARS.primary]).toBe('#2563eb');
    expect(DEFAULT_THEME_VARS[NOPPT_THEME_VARS.text]).toBe('#0f172a');
    expect(DEFAULT_THEME_VARS[NOPPT_THEME_VARS.border]).toBe('#e3e8ef');
  });

  it('themeVarsToCss 生成可拼进 :root 或 style 的声明串', () => {
    const css = themeVarsToCss();
    expect(css).toContain('--noppt-stage-bg:#f5f7fb');
    expect(css.split(';').length).toBe(Object.keys(DEFAULT_THEME_VARS).length);
    expect(themeVarsToCss({ '--custom': '1px' })).toBe('--custom:1px');
  });
});
