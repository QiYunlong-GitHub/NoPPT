/**
 * 主题色优先级更正（用户决策）：用户配置 > 配置界面提示词颜色 > 模板色系。
 *
 * - 用户未配置主题色、提示词也未写颜色时，全篇统一「封面模板色系」；
 *   不再按 cover / content / summary 逐页取不同分类主色。
 * - 本模块只做纯函数裁决；`resolveEffectivePrimaryColor` 的 5 级红线链保持不变。
 * - 参考模板仍可贡献 accents / strokeColor / canvasBg，但不再覆盖主色。
 */
import type { ColorTheme, ReferenceVisualAttributes } from '../../types';
import { COLOR_THEMES } from '../../agents/html-presentation/color';
import type { VisualThemeId } from '../../agents/html-presentation/deck/visual-tokens';
import { resolveVisualThemeIdForPrimary } from '../../agents/html-presentation/deck/visual-tokens';
import { HEX_RE, resolveTemplateDeckPrimaryColor } from './color';

export { resolveTemplateDeckPrimaryColor } from './color';

export type ColorSource =
  | 'user-hex'
  | 'user-color-theme'
  | 'topic-color-hint'
  | 'template-cover'
  | 'template-global'
  | 'default-blue';

export interface PromptColorHint {
  themeId?: ColorTheme;
  hex?: string;
  matchedKeyword?: string;
}

export interface DeckPrimaryColorResolution {
  primary: string;
  source: ColorSource;
  themeId: VisualThemeId;
  colorTheme?: string;
  promptHint?: PromptColorHint;
  templatePrimary?: string;
  templateSourceCategory?: 'cover' | 'global';
  referenceOverridden: boolean;
}

export interface DeckPrimaryColorInput {
  colorTheme?: string | null;
  primaryColor?: string | null;
  topic?: string | null;
  referenceText?: string | null;
  referenceVisualAttributes?: ReferenceVisualAttributes | null;
  fallback?: string;
}

export interface StageDeckPrimaryInput {
  options?: { colorTheme?: string; primaryColor?: string; referenceText?: string } | null;
  topic?: string | null;
  rva?: ReferenceVisualAttributes | null;
  fallback?: string;
}

const INTENT_RE = /(主色|色调|颜色|色系|配色|主题色|底色|采用|使用|改为|设为|偏|用|以|整体)/;
const COLOR_WORDS: ReadonlyArray<{ theme: ColorTheme; words: readonly string[] }> = [
  { theme: 'teal', words: ['蓝绿', '青', 'teal', 'cyan'] },
  { theme: 'green', words: ['自然绿', '绿', 'green'] },
  { theme: 'blue', words: ['商务蓝', '蓝', 'blue', 'navy'] },
  { theme: 'purple', words: ['创意紫', '紫', 'purple', 'violet'] },
  { theme: 'orange', words: ['琥珀', '橘', '橙', 'orange'] },
  { theme: 'gray', words: ['银灰', '灰', 'gray', 'grey'] },
];

function hasIntentNear(text: string, start: number, length: number): boolean {
  const from = Math.max(0, start - 14);
  const to = Math.min(text.length, start + length + 14);
  return INTENT_RE.test(text.slice(from, to));
}

/**
 * 从配置界面自由文本中模糊解析主题色：要求颜色词附近出现
 * 「主色 / 色调 / 颜色 / 色系 / 采用 / 使用 / 改为 / 偏 / 用」等意图词，
 * 避免把「蓝色市场分析」这类内容词误当作配色指令。
 */
export function resolveColorThemeFromFreeText(text?: string | null): PromptColorHint | undefined {
  if (!text) return undefined;
  const hexRe = /#[0-9a-fA-F]{6}\b/g;
  let match: RegExpExecArray | null;
  while ((match = hexRe.exec(text)) !== null) {
    if (hasIntentNear(text, match.index, match[0].length)) {
      return { hex: match[0].toLowerCase(), matchedKeyword: match[0] };
    }
  }
  for (const entry of COLOR_WORDS) {
    for (const word of entry.words) {
      let idx = text.indexOf(word);
      while (idx !== -1) {
        if (hasIntentNear(text, idx, word.length)) {
          return { themeId: entry.theme, matchedKeyword: word };
        }
        idx = text.indexOf(word, idx + word.length);
      }
    }
  }
  return undefined;
}

/** 单一真源：用户配置 > 提示词颜色 > 模板色系（封面优先） > 默认蓝。 */
export function resolveDeckPrimaryColor(
  input: DeckPrimaryColorInput = {},
): DeckPrimaryColorResolution {
  const template = resolveTemplateDeckPrimaryColor(input.referenceVisualAttributes);
  const fallback = (
    input.fallback && HEX_RE.test(input.fallback) ? input.fallback : '#2563eb'
  ).toLowerCase();
  let primary: string | undefined;
  let source: ColorSource = 'default-blue';
  let colorTheme: string | undefined;
  let promptHint: PromptColorHint | undefined;

  if (input.primaryColor && HEX_RE.test(input.primaryColor)) {
    primary = input.primaryColor.toLowerCase();
    source = 'user-hex';
  }
  if (!primary && input.colorTheme && COLOR_THEMES[input.colorTheme]) {
    primary = (COLOR_THEMES[input.colorTheme] as string).toLowerCase();
    source = 'user-color-theme';
    colorTheme = input.colorTheme;
  }
  if (!primary) {
    promptHint =
      resolveColorThemeFromFreeText(input.topic) ??
      resolveColorThemeFromFreeText(input.referenceText);
    if (promptHint?.hex) {
      primary = promptHint.hex;
      source = 'topic-color-hint';
    } else if (promptHint?.themeId && COLOR_THEMES[promptHint.themeId]) {
      primary = (COLOR_THEMES[promptHint.themeId] as string).toLowerCase();
      source = 'topic-color-hint';
      colorTheme = promptHint.themeId;
    }
  }
  if (!primary && template.primary) {
    primary = template.primary;
    source = template.source === 'template-cover' ? 'template-cover' : 'template-global';
  }
  if (!primary) {
    primary = fallback;
    source = 'default-blue';
  }

  return {
    primary,
    source,
    themeId: resolveVisualThemeIdForPrimary(primary),
    colorTheme,
    promptHint,
    templatePrimary: template.primary,
    templateSourceCategory:
      template.source === 'template-cover'
        ? 'cover'
        : template.source === 'template-global'
          ? 'global'
          : undefined,
    referenceOverridden: !!template.primary && template.primary !== primary,
  };
}

/**
 * 生成期各 stage 的统一入口。`fallback` 由调用方用 `resolveEffectivePrimaryColor` 计算后传入，
 * 避免本模块反向依赖 `primary-color.ts` 形成循环。
 */
export function resolveStageDeckPrimary(
  input: StageDeckPrimaryInput = {},
): DeckPrimaryColorResolution {
  return resolveDeckPrimaryColor({
    colorTheme: input.options?.colorTheme,
    primaryColor: input.options?.primaryColor,
    topic: input.topic,
    referenceText: input.options?.referenceText,
    referenceVisualAttributes: input.rva,
    fallback: input.fallback ?? '#2563eb',
  });
}
