// ================================================================
// property-panel/format 纯函数（rgbToHex / matchFontFamily / FONT_LIST）
//
// 行为锁定测试：这些纯函数由 PropertyPanel.tsx 逐字节搬移而来，
// 是 Phase 6 抽取 descriptor-inputs 等子组件前的回归底线。
// 不依赖渲染，纯白盒。
// ================================================================
import { describe, it, expect } from 'vitest';
import { rgbToHex, matchFontFamily, FONT_LIST } from './format';

describe('property-panel/format 纯函数', () => {
  it('rgbToHex 解析常见 rgb() 字符串', () => {
    expect(rgbToHex('rgb(37, 99, 235)')).toBe('#2563eb');
    expect(rgbToHex('rgb(255, 255, 255)')).toBe('#ffffff');
    expect(rgbToHex('rgb(0, 0, 0)')).toBe('#000000');
  });

  it('rgbToHex 已为十六进制时原样返回', () => {
    expect(rgbToHex('#2563eb')).toBe('#2563eb');
    expect(rgbToHex('#ABCDEF')).toBe('#ABCDEF');
  });

  it('rgbToHex 非法输入回退 #000000', () => {
    expect(rgbToHex('not-a-color')).toBe('#000000');
    expect(rgbToHex('rgba(1,2)')).toBe('#000000');
    expect(rgbToHex('')).toBe('#000000');
  });

  it('matchFontFamily 命中 FONT_LIST（忽略大小写与引号）', () => {
    expect(matchFontFamily('Microsoft YaHei')).toBe('Microsoft YaHei, 微软雅黑, sans-serif');
    expect(matchFontFamily('"Times New Roman", serif')).toBe('"Times New Roman", serif');
    expect(matchFontFamily('SimHei')).toBe('SimHei, 黑体, sans-serif');
  });

  it('matchFontFamily 无命中时返回原值', () => {
    expect(matchFontFamily('Comic Sans')).toBe('Comic Sans');
    expect(matchFontFamily('')).toBe('');
  });

  it('FONT_LIST 至少含 12 项且含系统默认', () => {
    expect(FONT_LIST.length).toBeGreaterThanOrEqual(12);
    expect(FONT_LIST.some((f) => f.value.includes('system-ui'))).toBe(true);
  });
});
