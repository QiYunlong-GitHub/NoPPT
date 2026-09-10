import type { Locale } from './types';

/** UI 语言码 → AI agent 的 language 码（content/html/v0 agent 使用 'zh'|'en'）。 */
export function toContentLang(locale: Locale): 'zh' | 'en' {
  return locale === 'en' ? 'en' : 'zh';
}

/** UI 语言码 → 导出 HTML 的 `<html lang>` 值。 */
export function toHtmlLang(locale: Locale): string {
  return locale === 'en' ? 'en' : 'zh-CN';
}
