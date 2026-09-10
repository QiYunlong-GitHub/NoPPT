import type { Locale, MessageParams } from './types';
import { en } from './messages/en';

/**
 * 后端翻译函数。
 * - zh-CN：直接返回 key 本身（key 即中文原文）。
 * - en：查覆盖字典，缺失时回退 key（中文），保证不出现空白。
 * 支持 `{name}` 占位符插值。
 */
export function translate(key: string, locale: Locale, params?: MessageParams): string {
  let str: string = locale === 'en' ? (en[key] ?? key) : key;
  if (params && str.includes('{')) {
    str = str.replace(/\{(\w+)\}/g, (_m, name: string) => {
      const v = params[name];
      return v === undefined ? '' : String(v);
    });
  }
  return str;
}
