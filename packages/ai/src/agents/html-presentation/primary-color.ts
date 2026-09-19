/**
 * shared.ts 二次拆分产出：主色优先级解析
 * 由 html-presentation/shared.ts 的顶层声明逐块搬移，对外导出保持不变。
 */

import type { ReferenceVisualAttributes } from '../../types';
import { resolveDeckReferencePrimaryColor } from '../../utils/reference-attribute-resolver';
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
 * 视觉设计方向（design-proposals）阶段的主色解析：参考 > 用户显式 > 主题 > 默认蓝。
 * 与 renderSlides / regenerateSingleSlide 的「参考优先」单源一致（html-presentation-agent.ts:2822/3241）。
 * 抽成纯函数便于单测；无参考时行为与改造前逐字节一致（refDeckPrimary 为 undefined → 原 5 级链）。
 */

export function resolveProposalPrimaryColor(opts: {
  referenceVisualAttributes?: ReferenceVisualAttributes | null;
  userColorTheme?: string;
  userPrimaryColor?: string;
}): string {
  const refDeckPrimary = resolveDeckReferencePrimaryColor(opts.referenceVisualAttributes);
  if (refDeckPrimary) return refDeckPrimary; // 参考最高优先级，覆盖用户配色主题
  if (opts.userPrimaryColor && /^#[0-9a-fA-F]{6}$/.test(opts.userPrimaryColor))
    return opts.userPrimaryColor;
  if (opts.userColorTheme && COLOR_THEMES[opts.userColorTheme])
    return COLOR_THEMES[opts.userColorTheme] as string;
  return '#2563eb';
}

