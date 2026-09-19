/**
 * shared.ts 二次拆分产出：重试预算（按渠道/每页计数）
 * 由 html-presentation/shared.ts 的顶层声明逐块搬移，对外导出保持不变。
 */

import type { RetryEntry } from './types';

export const MAX_RETRY_PER_SLIDE = 3;

export const CHANNEL_BUDGET: Record<string, number> = { critique: 1, placeholder: 1, triage: 1, audit: 1 };

export const retryBudget = new Map<string, Map<number, RetryEntry>>();

export const keyOf = (presentationId: string | undefined): string => presentationId || 'anon';

export function incRetryCount(
  key: string,
  idx: number,
  channel: string,
): { total: number; channelCount: number } {
  let pageMap = retryBudget.get(key);
  if (!pageMap) {
    pageMap = new Map<number, RetryEntry>();
    retryBudget.set(key, pageMap);
  }
  let entry = pageMap.get(idx);
  if (!entry) {
    entry = { total: 0, byChannel: {} };
    pageMap.set(idx, entry);
  }
  entry.total += 1;
  entry.byChannel[channel] = (entry.byChannel[channel] || 0) + 1;
  return { total: entry.total, channelCount: entry.byChannel[channel] };
}

export function getRetryState(key: string, idx: number): Readonly<RetryEntry> | null {
  return retryBudget.get(key)?.get(idx) ?? null;
}

export function resetRetryCount(key: string): void {
  retryBudget.delete(key);
}

// ===== 主色单源解析（single-source primary color · FR-9.4 5级优先级，单一真相源）=====
// 优先级（固定，全系统唯一处定义，任何主色解析都必须经本函数）：
//   1) options.primaryColor（用户自定义 hex，最高）
//   2) options.colorTheme（用户选择的配色主题）
//   3) design.colorTheme（设计方案记录的配色主题）
//   4) design.primaryColor（规划/设计 LLM 返回的主色 hex）
//   5) fallback 参数（默认 #2563eb，仅当以上全无时）
// 供 renderSlides / generateDesignProposals / regenerateSingleSlide / finalGuard / audit 全链路调用，
// 保证与 COLOR_THEMES 表完全一致：colorTheme=orange → #ea580c 绝不因 LLM 猜值改变。
