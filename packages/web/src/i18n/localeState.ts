import type { Locale } from './types';

/**
 * 当前语言的非响应式快照，供 React 之外的代码（store / utils）读取。
 * 与 settingsStore 解耦，避免 i18n ↔ settings 循环依赖。
 * 由 I18nProvider 在语言变化时更新。
 */
let _locale: Locale = 'zh-CN';

export function getActiveLocale(): Locale {
  return _locale;
}

export function setActiveLocale(locale: Locale): void {
  _locale = locale;
}
