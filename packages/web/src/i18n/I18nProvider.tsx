import React, { createContext, useCallback, useContext, useEffect, useMemo } from 'react';
import { useSettingsStore } from '@/stores/settings';
import { translate } from './translate';
import { toHtmlLang } from './lang';
import { setActiveLocale } from './localeState';
import type { I18nContextValue, Locale } from './types';

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const language = useSettingsStore((s) => s.interfaceSettings.language);

  const t = useCallback(
    (key: string, params?: Record<string, string | number>) => translate(language, key, params),
    [language],
  );

  const setLocale = useCallback((locale: Locale) => {
    const store = useSettingsStore.getState();
    store.updateInterfaceSettings({ language: locale });
    void store.saveSettings();
  }, []);

  // 同步 <html lang>，利于 SEO / 无障碍，不影响 Vite 首屏静态壳
  useEffect(() => {
    document.documentElement.lang = toHtmlLang(language);
    setActiveLocale(language);
  }, [language]);

  const value = useMemo<I18nContextValue>(
    () => ({ locale: language, t, setLocale }),
    [language, t, setLocale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18nContext(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within <I18nProvider>');
  return ctx;
}
