import { useI18nContext } from './I18nProvider';

/** 获取 i18n 上下文：{ locale, t, setLocale }。 */
export function useI18n() {
  return useI18nContext();
}
