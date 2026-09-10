/**
 * i18n 类型定义。
 *
 * 采用「中文原文即 key」的改造策略：zh-CN 直接返回 key（即中文原文），
 * 仅维护一份英文覆盖字典（locales/en.ts）。这样中文层天然 100% 完整，
 * 无需为 48 个文件做庞大的 key 审计工作。
 */
export type Locale = 'zh-CN' | 'en';

export type TranslationParams = Record<string, string | number>;

export interface I18nContextValue {
  /** 当前语言（来自设置页「界面语言」持久化字段） */
  locale: Locale;
  /** 引用稳定：仅在 locale 变化时变更，避免大组件级联重渲染 */
  t: (key: string, params?: TranslationParams) => string;
  /** 切换语言：内部执行 updateInterfaceSettings + saveSettings，保证刷新后保持 */
  setLocale: (locale: Locale) => void;
}
