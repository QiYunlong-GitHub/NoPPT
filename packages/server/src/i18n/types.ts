/**
 * 后端 i18n 类型定义。
 * 采用「中文原文即 key」的改造策略：zh-CN 直接返回 key（中文原文），
 * 仅维护一份英文覆盖字典（messages/en.ts）。中文字符串天然 100% 完整。
 */
export type Locale = 'zh-CN' | 'en';
export type MessageParams = Record<string, string | number>;
