import type {
  AgentDeps,
} from './deps';
import {
  ChatMessage,
  ColorTheme,
  ContentDensity,
  IconStyle,
  ImagePreference,
  ReferencePageHints,
  ReferenceVisualAttributes,
  SlidePlan,
} from '../../../types';
import {
  formatReferenceOverrideForPage,
  getReferenceColorPolicyForPage,
  getReferenceSnippetForPage,
} from '../../../utils/reference-attribute-resolver';
import {
  buildSlideHtmlPrompt,
  resolveReferenceTextColors,
} from '../prompts';
import {
  extractHtml,
} from '../html-sanitize';
import {
  switchStage,
} from './deps';
export async function generateSlideHtmlSafe(deps: AgentDeps, slidePlan: SlidePlan, rp: {
      primaryColor: string;
      primaryColorDarker: string;
      fontFamily: 'sans' | 'serif' | 'mono';
      iconStyle: IconStyle;
      style: string;
      density: ContentDensity;
      imagePreference: ImagePreference;
      backgroundEnabled: boolean;
      pageHints?: ReferencePageHints;
      slideCount?: number;
    }, slideWidth: number, slideHeight: number, audience: string, colorTheme: ColorTheme | undefined, referenceHtmlBrief: string, feedback: string | undefined, referenceVisualAttributes: ReferenceVisualAttributes | undefined, pageIndexInCategory = 0, maxRetries = 2): Promise<string> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await generateSlideHtml(deps, 
          slidePlan,
          rp.primaryColor,
          rp.primaryColorDarker,
          rp.density,
          rp.iconStyle,
          slideWidth,
          slideHeight,
          rp.style,
          audience,
          colorTheme,
          rp.fontFamily,
          rp.imagePreference,
          rp.backgroundEnabled,
          referenceHtmlBrief,
          feedback,
          referenceVisualAttributes,
          pageIndexInCategory,
        );
      } catch (e) {
        lastErr = e;
        if (attempt < maxRetries) {
          console.warn(
            `[RETRY] 页「${slidePlan.title}」HTML 生成失败（attempt ${attempt + 1}/${maxRetries + 1}），准备重试...`,
            e,
          );
        }
      }
    }
    throw lastErr;
  }

export async function generateSlideHtml(deps: AgentDeps, plan: SlidePlan, primaryColor: string, primaryColorDarker: string, density: ContentDensity, iconStyle: IconStyle, slideWidth: number = 1280, slideHeight: number = 720, style: string = 'business', audience: string = '', colorTheme?: ColorTheme, fontFamily: 'sans' | 'serif' | 'mono' = 'sans', imagePreference: ImagePreference = 'content-only', backgroundEnabled: boolean = false, referenceHtmlBrief: string = '', extraFeedback?: string, referenceVisualAttributes?: ReferenceVisualAttributes, pageIndexInCategory: number = 0): Promise<string> {
    const pageReferenceOverride = referenceVisualAttributes
      ? formatReferenceOverrideForPage(
          referenceVisualAttributes,
          plan.pageType,
          pageIndexInCategory,
        )
      : '';
    const categoryReferenceSummary = pageReferenceOverride
      ? '【参考文件提取属性 · 绝对最高优先级 · 覆盖用户显式参数】\n' + pageReferenceOverride
      : '';
    // FR-参考克隆：本页只注入自身分类的参考指令（消除多份 brief 互相打架），并附骨架片段与色彩豁免
    const referenceSnippet = referenceVisualAttributes
      ? getReferenceSnippetForPage(referenceVisualAttributes, plan.pageType, pageIndexInCategory)
      : '';
    const colorPolicy = referenceVisualAttributes
      ? getReferenceColorPolicyForPage(referenceVisualAttributes, plan.pageType)
      : '';
    const refTextColors = resolveReferenceTextColors(referenceVisualAttributes, plan.pageType);
    let prompt = buildSlideHtmlPrompt(
      plan,
      primaryColor,
      primaryColorDarker,
      density,
      iconStyle,
      slideWidth,
      slideHeight,
      style,
      audience,
      colorTheme,
      fontFamily,
      imagePreference,
      backgroundEnabled,
      pageReferenceOverride || referenceHtmlBrief,
      refTextColors.titleColor,
      refTextColors.bodyColor,
      categoryReferenceSummary,
      referenceSnippet,
      colorPolicy,
      !!referenceVisualAttributes,
      referenceVisualAttributes?.byCategory?.cover?.palette?.canvasBg ||
        referenceVisualAttributes?.global?.palette?.canvasBg ||
        undefined,
    );
    if (extraFeedback) {
      prompt = prompt + '\n\n' + extraFeedback;
    }
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content:
          '你是一个严格遵循HTML规范和设计系统的前端代码生成器。只输出HTML代码，不要任何其他内容。',
      },
      { role: 'user', content: prompt },
    ];
    switchStage(deps.contentProvider, 'content');
    const response = await deps.contentProvider.chat(messages, {
      temperature: 0.4,
      maxTokens: 8192,
    });
    let html = extractHtml(response.content);
    // 兜底：content 为空但思考字段疑似含 HTML（推理模型偶尔把正文误放 reasoning_content）时尝试抢救。
    if (
      !html.trim() &&
      response.reasoningContent &&
      /<(main|section|div|body|article)\b/i.test(response.reasoningContent)
    ) {
      html = extractHtml(response.reasoningContent);
    }
    // 空内容即失败：让 generateSlideHtmlSafe 的既有重试生效并向上暴露，杜绝静默产出空壳页。
    if (!html.trim()) {
      throw new Error(
        `幻灯片「${plan.title}」HTML 生成为空：content.length=${response.content?.length ?? 0}, ` +
          `finishReason=${response.finishReason ?? 'unknown'}, reasoningContent.length=${response.reasoningContent?.length ?? 0}`,
      );
    }
    return html;
  }

