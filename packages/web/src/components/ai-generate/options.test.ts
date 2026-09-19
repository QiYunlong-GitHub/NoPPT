// ================================================================
// AIGenerateModal 内联 options（COLOR_THEME_IDS / ICON_STYLE_IDS /
// audienceOptions / fontFamilyOptions / colorThemeOptions /
// iconStyleOptions / modeOptions / getPageTypeLabel）
//
// 行为锁定测试：这些纯数据 / 纯函数即将外置到 ai-generate/options.ts。
// 本文件先锁定「当前取值与映射」，拆分后仅改 import 路径即可继续守护。
// 不依赖渲染，纯白盒，零副作用。
// ================================================================
import { describe, it, expect } from 'vitest';
import {
  COLOR_THEME_IDS,
  ICON_STYLE_IDS,
  audienceOptions,
  fontFamilyOptions,
  colorThemeOptions,
  iconStyleOptions,
  modeOptions,
  getPageTypeLabel,
} from './options';

describe('AIGenerateModal 内联 options（待外置，行为锁定）', () => {
  it('COLOR_THEME_IDS 顺序与取值', () => {
    expect(COLOR_THEME_IDS).toEqual(['blue', 'purple', 'green', 'orange', 'teal', 'gray']);
  });

  it('ICON_STYLE_IDS 顺序与取值', () => {
    expect(ICON_STYLE_IDS).toEqual([
      'auto',
      'line',
      'filled',
      'numbered',
      'bullet',
      'lettered',
      'emoji',
      'none',
    ]);
  });

  it('audienceOptions 条目（id 顺序）', () => {
    expect(audienceOptions.map((o) => o.id)).toEqual([
      '通用商务受众',
      '技术研发团队 / 工程师',
      '公司管理层 / 决策者',
      '投资人 / 股东',
      '学生 / 教育场景',
      '销售市场团队 / 客户',
    ]);
  });

  it('fontFamilyOptions 条目（id 顺序）', () => {
    expect(fontFamilyOptions.map((o) => o.id)).toEqual(['sans', 'serif', 'mono']);
  });

  it('colorThemeOptions 顺序与色值（锁定当前顺序）', () => {
    // 注意：当前顺序与 COLOR_THEME_IDS 并不一致（teal 在 green 之前），
    // 此处仅锁定现状，拆分到 options.ts 时保持原顺序即可。
    expect(colorThemeOptions.map((o) => o.id)).toEqual([
      'blue',
      'purple',
      'teal',
      'green',
      'orange',
      'gray',
    ]);
    expect(colorThemeOptions.find((o) => o.id === 'blue')?.color).toBe('#2563eb');
    expect(colorThemeOptions.find((o) => o.id === 'gray')?.color).toBe('#4b5563');
  });

  it('iconStyleOptions 与 ICON_STYLE_IDS 对齐', () => {
    expect(iconStyleOptions.map((o) => o.id)).toEqual([...ICON_STYLE_IDS]);
  });

  it('modeOptions 三种协作模式（guided 带推荐 badge）', () => {
    expect(modeOptions.map((o) => o.id)).toEqual(['auto', 'guided', 'collaborative']);
    expect(modeOptions.find((o) => o.id === 'guided')?.badge).toBe('推荐');
  });

  it('getPageTypeLabel 映射（中文 key 直出）', () => {
    expect(getPageTypeLabel('cover')).toBe('封面');
    expect(getPageTypeLabel('toc')).toBe('目录');
    expect(getPageTypeLabel('content-1')).toBe('内容');
    expect(getPageTypeLabel('content-foo')).toBe('内容');
    expect(getPageTypeLabel('summary')).toBe('总结');
    expect(getPageTypeLabel('conclusion')).toBe('总结');
    expect(getPageTypeLabel('unknown-x')).toBe('页面');
  });
});
