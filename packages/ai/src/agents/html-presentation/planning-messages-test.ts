import type {
  ChatMessage,
  ColorTheme,
  ContentDensity,
  IconStyle,
  ImagePreference,
} from '../../types';
import type { SlideCountSpec } from './shared';
import { buildPlanningPrompt, buildUserSettingsPriorityOverridePrompt } from './prompts';
import { computeU17EffectivePrimaryColor } from './plan-utils';

/**
 * Test-only mirror of the planning message assembly.
 * It intentionally calls the same pure prompt owners as the agent facade,
 * without constructing a provider-backed compatibility shell.
 */
export function buildPlanningMessagesForTest(params: {
  topic: string;
  style: string;
  audience: string;
  slideSpec: { exact?: number; min?: number; max?: number };
  density: ContentDensity;
  imagePreference: ImagePreference;
  primaryColor: string;
  backgroundEnabled: boolean;
  pageHints: {
    contentOnly: boolean;
    disableCover: boolean;
    disableToc: boolean;
    disableConclusion: boolean;
  };
  iconStyle: IconStyle;
  fontFamily: 'sans' | 'serif' | 'mono';
  colorTheme?: ColorTheme;
  referenceHtmlBrief?: string;
  userSettingsOverride?: string;
}): ChatMessage[] {
  const effectiveColor = computeU17EffectivePrimaryColor(
    params.style,
    params.colorTheme,
    params.primaryColor,
  );
  const userOverride =
    buildUserSettingsPriorityOverridePrompt({
      slideCount: params.slideSpec as SlideCountSpec,
      style: params.style,
      density: params.density,
      imagePreference: params.imagePreference,
      colorTheme: params.colorTheme,
      iconStyle: params.iconStyle,
      fontFamily: params.fontFamily,
      backgroundEnabled: params.backgroundEnabled,
      audience: params.audience,
    }) ||
    params.userSettingsOverride ||
    '';
  const systemPrompt = buildPlanningPrompt(
    params.topic,
    params.style,
    params.audience,
    params.slideSpec as SlideCountSpec,
    params.density,
    params.imagePreference,
    params.backgroundEnabled,
    params.pageHints,
    params.iconStyle,
    params.fontFamily,
    params.colorTheme,
    params.referenceHtmlBrief || '',
    userOverride,
    effectiveColor,
  );
  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `请规划这个演示文稿，主色调使用：${effectiveColor}` },
  ];
}
