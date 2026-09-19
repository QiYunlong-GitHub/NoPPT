// 导出面快照测试：锁定 A/B/C 三档拆分后各模块与对外 barrel 的具名导出仍可达。
// - 锁定 src/index 再导出的 5 个红线符号（自包含，与 shared-redline.test.ts 互补）。
// - 锁定原路径 html-presentation-agent 对外留存的同名工具/测试符号与类本体。
// - 锁定 A/B/C 抽取模块各自的导出函数集合（防搬移过程中丢导出/漂移）。
import { describe, it, expect } from 'vitest';
import * as index from '../../index';
import * as agentNs from '../html-presentation-agent';
import * as prompts from '../html-presentation/prompts';
import * as planUtils from '../html-presentation/plan-utils';
import * as htmlSanitize from '../html-presentation/html-sanitize';
import * as palette from '../html-presentation/palette';
import * as stages from '../html-presentation/stages';

const expectFns = (ns: Record<string, unknown>, names: readonly string[]): void => {
  for (const n of names) {
    expect(ns[n], `${n} 应存在且为函数`).toBeTypeOf('function');
  }
};

describe('导出面快照 · A/B/C 拆分后符号可达', () => {
  it('src/index 再导出 5 个红线符号', () => {
    expectFns(index as unknown as Record<string, unknown>, [
      'resolveEffectivePrimaryColor',
      'resolveProposalPrimaryColor',
      'darkenColor',
      'assertHueClose',
    ]);
    expect((index as unknown as Record<string, unknown>).COLOR_THEMES).toBeTypeOf('object');
  });

  it('原路径 html-presentation-agent 保留类与对外工具/测试符号', () => {
    expect(typeof agentNs.HTMLPresentationAgent).toBe('function');
    expectFns(agentNs as unknown as Record<string, unknown>, [
      'darkenColor',
      'hexToHsl',
      'hslToHex',
      'hueDelta',
      'assertHueClose',
      'resolveEffectivePrimaryColor',
      'resolveProposalPrimaryColor',
      'computeU17EffectivePrimaryColor',
      'buildPlanningMessagesForTest',
      'detectComparisonIntent',
      'autoCompleteComparisonPage',
    ]);
    expect((agentNs as unknown as Record<string, unknown>).COLOR_THEMES).toBeTypeOf('object');
  });

  it('A 档 prompts.ts 导出提示词构造函数', () => {
    expectFns(prompts as unknown as Record<string, unknown>, [
      'buildSlideCountGuidance',
      'buildStructureOverridePrompt',
      'summarizeReferenceHtmlBrief',
      'sanitizeTopicSettingsConflict',
      'buildUserSettingsPriorityOverridePrompt',
      'buildReferenceTextBrief',
      'resolveReferenceTextColors',
      'buildImageRequirementHint',
      'derivePrimaryColorLighter',
      'buildPlanningPrompt',
      'buildSlideHtmlPrompt',
    ]);
  });

  it('A 档 plan-utils.ts 导出计划清洗/解析与文末纯函数', () => {
    expectFns(planUtils as unknown as Record<string, unknown>, [
      'getPrimaryColor',
      'clampSlidesToCount',
      'enforcePageStructure',
      'applyReferenceImageOverride',
      'normalizePlanByImagePreference',
      'resolvePageReferenceStyleAttrs',
      'detectComparisonIntent',
      'autoCompleteComparisonPage',
      'computeU17EffectivePrimaryColor',
    ]);
  });

  it('A 档 html-sanitize.ts 导出 HTML 净化/结构处理函数', () => {
    expectFns(htmlSanitize as unknown as Record<string, unknown>, [
      'applyL0ToCritique',
      'sanitizeStyleSyntax',
      'injectStructuredGraphics',
      'enforceSingleColumn',
      'sanitizeRegenerationFeedback',
      'injectBackgroundImageToDiv',
      'generateFallbackSlide',
      'buildReferenceSeedMap',
      'parsePlan',
      'sanitizeSlideHtml',
      'flattenMeaninglessNesting',
      'extractJson',
      'extractHtml',
    ]);
  });

  it('B 档 palette.ts 导出调色簇与后处理函数', () => {
    expectFns(palette as unknown as Record<string, unknown>, [
      'detectHarmonizedPalette',
      'sanitizeGradientColors',
      'enforceSinglePalette',
      'postProcessSlideHtml',
      'postProcessHtmlSnapshot',
      'parsePresentation',
    ]);
  });

  it('C 档 stages 聚合导出全部编排函数', () => {
    expectFns(stages as unknown as Record<string, unknown>, [
      'generatePlan',
      'generatePresentation',
      'generateFromPlan',
      'generatePresentationFromReference',
      'renderSlides',
      'regenerateSingleSlide',
      'generateSlideHtmlSafe',
      'generateSlideHtml',
      'assembleImages',
      'finalizePresentation',
      'sanitizeImagePrompt',
      'generateDesignProposals',
      'modifySlide',
      'modifyElement',
      'modifyGlobal',
    ]);
  });
});
