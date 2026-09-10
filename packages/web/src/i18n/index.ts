import type { Locale, TranslationParams, I18nContextValue } from './types';
import { translate } from './translate';
import { getActiveLocale } from './localeState';

export { I18nProvider, useI18nContext } from './I18nProvider';
export { useI18n } from './useI18n';
export { translate } from './translate';
export { toContentLang, toHtmlLang } from './lang';
export { getActiveLocale, setActiveLocale } from './localeState';
export type { Locale, TranslationParams, I18nContextValue };

export const supportedLocales: Locale[] = ['zh-CN', 'en'];

/**
 * 非 React 场景（store / utils）的翻译入口。
 * 直接读取当前语言快照，无需 Hook。
 */
export function t(key: string, params?: TranslationParams): string {
  return translate(getActiveLocale(), key, params);
}
