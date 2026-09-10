import type { Locale, TranslationParams } from './types';
import { en } from './locales/en';

/**
 * 核心翻译函数。
 * - zh-CN：直接返回 key 本身（key 即中文原文）。
 * - en：查覆盖字典，缺失时回退 key（中文），保证不出现空白。
 * 支持 `{name}` 占位符插值。
 */
export function translate(locale: Locale, key: string, params?: TranslationParams): string {
  let str: string;
  if (locale === 'en') {
    str = en[key] ?? key;
  } else {
    str = key;
  }
  if (params && str.includes('{')) {
    str = str.replace(/\{(\w+)\}/g, (_m, name: string) => {
      const v = params[name];
      return v === undefined ? '' : String(v);
    });
  }
  return str;
}
