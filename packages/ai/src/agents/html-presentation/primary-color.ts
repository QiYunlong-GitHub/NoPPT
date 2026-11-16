/**
 * shared.ts 二次拆分产出：主色优先级解析
 * 由 html-presentation/shared.ts 的顶层声明逐块搬移，对外导出保持不变。
 */

import type { ReferenceVisualAttributes } from '../../types';
import { resolveStageDeckPrimary } from '../../utils/reference/color-priority';
import { COLOR_THEMES } from './color';

export function resolveEffectivePrimaryColor(
  options?: { primaryColor?: string; colorTheme?: string } | null,
  design?: { primaryColor?: string; colorTheme?: string } | null,
  fallback: string = '#2563eb',
): string {
  // 1) 用户自定义 hex（最高）
  const userHex = options?.primaryColor;
  if (userHex && /^#[0-9a-fA-F]{6}$/.test(userHex)) return userHex.toLowerCase();
  // 2) 用户 colorTheme
  const theme = options?.colorTheme;
  if (theme && COLOR_THEMES[theme]) return (COLOR_THEMES[theme] as string).toLowerCase();
  // 3) design.colorTheme（老链路或 proposal 内部级 colorTheme）
  const dTheme = design?.colorTheme;
  if (dTheme && COLOR_THEMES[dTheme]) return (COLOR_THEMES[dTheme] as string).toLowerCase();
  // 4) design.primaryColor（LLM 规划值；作为兜底但优先级仍高于最终 fallback）
  const designHex = design?.primaryColor;
  if (designHex && /^#[0-9a-fA-F]{6}$/.test(designHex)) return designHex.toLowerCase();
  // 5) 最终 fallback（仅当 1-4 全无）
  return fallback.toLowerCase();
}

/**
 * 视觉设计方向（design-proposals）阶段的主色解析：用户配置 > 提示词颜色 > 模板色系。
 * 保留具名导出与调用签名，内部委托到 `color-priority.ts` 的单一真源。
 */
export function resolveProposalPrimaryColor(opts: {
  referenceVisualAttributes?: ReferenceVisualAttributes | null;
  userColorTheme?: string;
  userPrimaryColor?: string;
  topic?: string;
  referenceText?: string;
}): string {
  return resolveStageDeckPrimary({
    options: {
      colorTheme: opts.userColorTheme,
      primaryColor: opts.userPrimaryColor,
      referenceText: opts.referenceText,
    },
    topic: opts.topic,
    rva: opts.referenceVisualAttributes,
    fallback: '#2563eb',
  }).primary;
}
