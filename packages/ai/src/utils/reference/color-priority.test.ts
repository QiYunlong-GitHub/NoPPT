import { describe, it, expect } from 'vitest';
import {
  resolveColorThemeFromFreeText,
  resolveDeckPrimaryColor,
  resolveStageDeckPrimary,
} from './color-priority';
import { resolveFinalPagePrimaryColor } from './color';
import { resolveVisualThemeIdForPrimary } from '../../agents/html-presentation/deck/visual-tokens';

const makeRva = (
  colors: Partial<Record<'cover' | 'content' | 'summary' | 'global', string>> = {},
): any => ({
  global: colors.global
    ? { uploaded: true, style: { primaryColor: colors.global } }
    : { uploaded: false },
  byCategory: {
    cover: colors.cover
      ? { uploaded: true, style: { primaryColor: colors.cover } }
      : { uploaded: false },
    content: colors.content
      ? { uploaded: true, style: { primaryColor: colors.content } }
      : { uploaded: false },
    summary: colors.summary
      ? { uploaded: true, style: { primaryColor: colors.summary } }
      : { uploaded: false },
  },
  source: 'merged-category-assembled',
});

describe('主题色优先级更正', () => {
  it('配置界面 colorTheme 最高，压过提示词颜色与模板色系', () => {
    const result = resolveDeckPrimaryColor({
      colorTheme: 'orange',
      topic: '主色用紫色',
      referenceVisualAttributes: makeRva({ cover: '#059669', content: '#c7000b' }),
    });
    expect(result.primary).toBe('#ea580c');
    expect(result.source).toBe('user-color-theme');
    expect(result.referenceOverridden).toBe(true);
  });

  it('用户显式 primaryColor hex 为最高优先级', () => {
    const result = resolveDeckPrimaryColor({
      primaryColor: '#123456',
      colorTheme: 'orange',
      topic: '主色用紫色',
      referenceVisualAttributes: makeRva({ cover: '#059669' }),
    });
    expect(result.primary).toBe('#123456');
    expect(result.source).toBe('user-hex');
  });

  it('提示词颜色模糊匹配「主色 / 色调 / 颜色 / 色系」，且压过模板', () => {
    expect(resolveColorThemeFromFreeText('请把主色用橙色')?.themeId).toBe('orange');
    expect(resolveColorThemeFromFreeText('色调偏青')?.themeId).toBe('teal');
    expect(resolveColorThemeFromFreeText('颜色为 #7c3aed')?.hex).toBe('#7c3aed');
    expect(resolveColorThemeFromFreeText('色系采用紫色')?.themeId).toBe('purple');
    expect(resolveColorThemeFromFreeText('蓝色市场分析')).toBeUndefined();
    const result = resolveDeckPrimaryColor({
      topic: '本季度经营复盘，色系采用紫色',
      referenceVisualAttributes: makeRva({ cover: '#4c9a6b' }),
    });
    expect(result.primary).toBe('#7c3aed');
    expect(result.source).toBe('topic-color-hint');
  });

  it('无用户配置且提示词无颜色时，全篇统一封面模板色系', () => {
    const rva = makeRva({
      cover: '#4c9a6b',
      content: '#c7000b',
      summary: '#0000ff',
    });
    const result = resolveDeckPrimaryColor({
      topic: '季度经营复盘',
      referenceVisualAttributes: rva,
    });
    expect(result.primary).toBe('#4c9a6b');
    expect(result.source).toBe('template-cover');
    expect(resolveFinalPagePrimaryColor(rva, 'cover', '#2563eb')).toBe('#4c9a6b');
    expect(resolveFinalPagePrimaryColor(rva, 'content', '#2563eb')).toBe('#4c9a6b');
    expect(resolveFinalPagePrimaryColor(rva, 'summary', '#2563eb')).toBe('#4c9a6b');
  });

  it('封面模板缺失时回落 global，再回落默认蓝', () => {
    const withGlobal = resolveDeckPrimaryColor({
      topic: '季度经营复盘',
      referenceVisualAttributes: makeRva({ global: '#654321' }),
    });
    expect(withGlobal.primary).toBe('#654321');
    expect(withGlobal.source).toBe('template-global');
    const noRef = resolveDeckPrimaryColor({ topic: '季度经营复盘' });
    expect(noRef.primary).toBe('#2563eb');
    expect(noRef.source).toBe('default-blue');
  });

  it('visualTheme 与 stage helper 都跟随最终主色', () => {
    expect(resolveVisualThemeIdForPrimary('#ea580c')).toBe('warm');
    expect(resolveVisualThemeIdForPrimary('#059669')).toBe('nature');
    expect(resolveVisualThemeIdForPrimary('#2563eb')).toBe('blue');
    const staged = resolveStageDeckPrimary({
      options: { colorTheme: 'green' },
      topic: '主色用橙色',
      rva: makeRva({ cover: '#4c9a6b' }),
      fallback: '#abcdef',
    });
    expect(staged.primary).toBe('#059669');
    expect(staged.source).toBe('user-color-theme');
  });
});
