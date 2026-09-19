import type { AIModelProvider } from '../providers/base';
import type { ChatMessage, PresentationPlan, SlidePlan, SlidePageType, ContentDensity, ImagePreference, ColorTheme, IconStyle, PresentationGenerationOptions, GenerationCallback, DesignProposal, RenderedSlide, ReferenceVisualAttributes, ReferencePageHints, SlideColorPolicy } from '../types';
import type { SlideCritique } from '../templates/slide-critique';
import { type ReferenceComposition } from '@noppt/core';
import { relativeLuminance as _relativeLuminance, isDecorativeLayer as _isDecorativeLayer, resolveBgTone as _resolveBgTone, needsContrastFix as _needsContrastFix, fontSizeOf as _fontSizeOf, fontWeightOf as _fontWeightOf, normalizeHex as _normalizeHex, hexToRgba as _hexToRgba, rgbStringToHex as _rgbStringToHex, hexToRgb as _hexToRgb, parseColorToRgba as _parseColorToRgba, compositeOver as _compositeOver, contrastRatio as _contrastRatio, resolveEffectiveBgRgb as _resolveEffectiveBgRgb, enforceDarkBgTextContrast as _enforceDarkBgTextContrast, enforceLightBgTextContrast as _enforceLightBgTextContrast, enforceHeadingColorOnLightBg as _enforceHeadingColorOnLightBg } from './html-presentation/postprocess';
import { findDirectChildElements as _findDirectChildElements, composeInheritedPStyle as _composeInheritedPStyle, ensureSemanticWrapping as _ensureSemanticWrapping, wrapTextNodes as _wrapTextNodes } from './html-presentation/postprocess';
import { isPlaceholderFontFamily as _isPlaceholderFontFamily, getFontStack as _getFontStack } from './html-presentation/postprocess';
import { removeImagePlaceholder as _removeImagePlaceholder, slideHasMeaningfulBody as _slideHasMeaningfulBody, injectImagePlaceholderForContentSlide as _injectImagePlaceholderForContentSlide, injectBackgroundPlaceholder as _injectBackgroundPlaceholder, removeBackgroundPlaceholder as _removeBackgroundPlaceholder } from './html-presentation/postprocess';
import { enforceBodyFontSize as _enforceBodyFontSize, enforce8ptGrid as _enforce8ptGrid, assertGrid8pt as _assertGrid8pt } from './html-presentation/postprocess';
import { fixRowImageMargins as _fixRowImageMargins } from './html-presentation/postprocess';
import { postProcessLayout as _postProcessLayout, ensureImageRatio as _ensureImageRatio, fixVerticalWritingLists as _fixVerticalWritingLists, ensureOuterContainer as _ensureOuterContainer, ensureImageProperWrapper as _ensureImageProperWrapper, enforceStretchAlignment as _enforceStretchAlignment, enforceTextContainerStyles as _enforceTextContainerStyles, enforceImageContainerStyles as _enforceImageContainerStyles, enforceCoverPosterArtStyles as _enforceCoverPosterArtStyles, enforceFinalTextContrast as _enforceFinalTextContrast, darkenPrimaryColor as _darkenPrimaryColor } from './html-presentation/postprocess';

import {
  HTMLSlide,
  HTMLPresentation,
  darkenColor,
  hexToHsl,
  hslToHex,
  hueDelta,
  assertHueClose,
  COLOR_THEMES,
  resolveEffectivePrimaryColor,
  SlideCountSpec,
  PageStructureHints,
} from './html-presentation/shared';

export * from './html-presentation/shared';
import {
  buildSlideCountGuidance as _buildSlideCountGuidance,
  summarizeReferenceHtmlBrief as _summarizeReferenceHtmlBrief,
  sanitizeTopicSettingsConflict as _sanitizeTopicSettingsConflict,
  buildUserSettingsPriorityOverridePrompt as _buildUserSettingsPriorityOverridePrompt,
  buildPlanningPrompt as _buildPlanningPrompt,
  resolveReferenceTextColors as _resolveReferenceTextColors,
  buildSlideHtmlPrompt as _buildSlideHtmlPrompt,
} from './html-presentation/prompts';
import {
  applyL0ToCritique as _applyL0ToCritique,
  sanitizeStyleSyntax as _sanitizeStyleSyntax,
  injectStructuredGraphics as _injectStructuredGraphics,
  enforceSingleColumn as _enforceSingleColumn,
  sanitizeRegenerationFeedback as _sanitizeRegenerationFeedback,
  sanitizeSlideHtml as _sanitizeSlideHtml,
  flattenMeaninglessNesting as _flattenMeaninglessNesting,
  injectBackgroundImageToDiv as _injectBackgroundImageToDiv,
  generateFallbackSlide as _generateFallbackSlide,
  extractJson as _extractJson,
  extractHtml as _extractHtml,
  buildReferenceSeedMap as _buildReferenceSeedMap,
  parsePlan as _parsePlan,
} from './html-presentation/html-sanitize';
import {
  postProcessHtmlSnapshot as _postProcessHtmlSnapshot,
  postProcessSlideHtml as _postProcessSlideHtml,
  detectHarmonizedPalette as _detectHarmonizedPalette,
  sanitizeGradientColors as _sanitizeGradientColors,
  parsePresentation as _parsePresentation,
} from './html-presentation/palette';
import {
  generatePlan as _generatePlan,
  generatePresentation as _generatePresentation,
  generateFromPlan as _generateFromPlan,
  renderSlides as _renderSlides,
  regenerateSingleSlide as _regenerateSingleSlide,
  assembleImages as _assembleImages,
  finalizePresentation as _finalizePresentation,
  generateDesignProposals as _generateDesignProposals,
  generatePresentationFromReference as _generatePresentationFromReference,
  modifySlide as _modifySlide,
  modifyElement as _modifyElement,
  modifyGlobal as _modifyGlobal,
  generateSlideHtmlSafe as _generateSlideHtmlSafe,
  generateSlideHtml as _generateSlideHtml,
  sanitizeImagePrompt as _sanitizeImagePrompt,
} from './html-presentation/stages';
import {
  getPrimaryColor as _getPrimaryColor,
  clampSlidesToCount as _clampSlidesToCount,
  enforcePageStructure as _enforcePageStructure,
  applyReferenceImageOverride as _applyReferenceImageOverride,
  normalizePlanByImagePreference as _normalizePlanByImagePreference,
  resolvePageReferenceStyleAttrs as _resolvePageReferenceStyleAttrs,
} from './html-presentation/plan-utils';
// U-17 主色单源公式已收敛到 plan-utils 单一实现，此处仅导入后原样再导出（消除双副本漂移）。
import { computeU17EffectivePrimaryColor } from './html-presentation/plan-utils';

export class HTMLPresentationAgent {
  public provider: AIModelProvider;
  public planningProvider: AIModelProvider;
  public contentProvider: AIModelProvider;
  public editingProvider: AIModelProvider;
  /** 本次生成的输出语言（'zh' | 'en'），由 generatePresentation 从调用方 options 读取。 */
  public language: 'zh' | 'en' = 'zh';

  constructor(
    provider: AIModelProvider,
    options?: {
      planningProvider?: AIModelProvider;
      contentProvider?: AIModelProvider;
      editingProvider?: AIModelProvider;
    },
  ) {
    this.provider = provider;
    this.planningProvider = options?.planningProvider || provider;
    this.contentProvider = options?.contentProvider || provider;
    this.editingProvider = options?.editingProvider || provider;
  }

    public getPrimaryColor(style?: string, colorTheme?: ColorTheme, primaryColor?: string): string { return _getPrimaryColor(style, colorTheme, primaryColor); }



  public buildSlideCountGuidance(
    spec:
      | SlideCountSpec
      | { exact: number; min?: undefined; max?: undefined }
      | { min: number; max: number; exact?: undefined },
  ): { guidance: string; displayText: string; planningTotal: number } {
    return _buildSlideCountGuidance(spec);
  }

  /**
   * S1 · summarizeReferenceHtmlBrief：抽取参考 HTML 的排版风格摘要（token 安全：≤200 字）
   * 若 referenceHtml <800 字符 → 直接使用（适当裁剪）；否则用正则抽：
   *   - 页面类型分布（有无 cover/summary/cards/timeline...）
   *   - 主色 hex + 深色变体（若存在）
   *   - 字体栈中出现的 serif / mono / sans 特征词
   *   - iconStyle 特征（出现 number-circle / letter-circle / large-number 的 class 名或 inline-style）
   *   - 有没有配图 <img data-image-ratio>
   * 输出一段简短中文说明，让 LLM 在规划和内容阶段都能感知"用户希望和参考版式一致"。
   */
  public summarizeReferenceHtmlBrief(referenceHtml: string): string {
    return _summarizeReferenceHtmlBrief(referenceHtml);
  }

  /**
   * S5 · sanitizeTopicSettingsConflict：检测 topic 中与高级选项参数矛盾的描述，
   * 仅检测+日志，不做删除/改写（防止破坏用户风格意图）。
   */
  public sanitizeTopicSettingsConflict(
    topic: string,
    params: {
      slideCount?: SlideCountSpec;
      colorTheme?: ColorTheme;
      style?: string;
      imagePreference?: ImagePreference;
    },
  ): void {
    return _sanitizeTopicSettingsConflict(topic, params);
  }

  /**
   * S5 · buildUserSettingsPriorityOverridePrompt：输出「用户显式参数 · 高优先级（低于参考提取属性）」大段红线
   * 放在 PRESENTATION_PLANNING_PROMPT 的 {{BACKGROUND_GUIDANCE}} 之后，作为高优先级覆盖，
   * 明确声明：高级选项参数 > topic 自然语言中任何对应词汇，但 < 参考文件提取属性（优先级：参考 > 用户显式 > 主题自然语言 > 默认）。
   */
  public buildUserSettingsPriorityOverridePrompt(params: {
    slideCount: SlideCountSpec;
    style: string;
    density: ContentDensity;
    imagePreference: ImagePreference;
    colorTheme?: ColorTheme;
    iconStyle: IconStyle;
    fontFamily: 'sans' | 'serif' | 'mono';
    backgroundEnabled: boolean;
    audience: string;
    referencePrimaryColor?: string;
  }): string {
    return _buildUserSettingsPriorityOverridePrompt(params);
  }

  /**
   * 通用备用标题池（补齐页数时用），顺序从"深度→实施→参考→注意→展望→FAQ"
   */
  public readonly SUPPLEMENT_TITLE_POOL = [
    '深入分析与洞察',
    '关键实施路径',
    '典型案例参考',
    '常见问题与建议',
    '未来发展展望',
    '核心要点总结',
    '对比分析',
    '数据与指标',
    '落地策略',
    '风险与注意事项',
  ];

    public clampSlidesToCount(slides: SlidePlan[], target: number, hints: PageStructureHints = {
      contentOnly: false,
      disableCover: false,
      disableToc: false,
      disableConclusion: false,
    }, imagePreference: ImagePreference = 'content-only'): SlidePlan[] { return _clampSlidesToCount(slides, target, hints, imagePreference); }

  /**
   * 强制对齐页结构：根据页数策略 + 用户显式禁用指令，确保封面/目录/总结正确存在或不存在。
   * 在 clampSlidesToCount 之后再跑一次，处理大模型可能生成错位（如把封面当内容、toc 放到末尾等）。
   */
    public enforcePageStructure(slides: SlidePlan[], target: number, hints: PageStructureHints = {
      contentOnly: false,
      disableCover: false,
      disableToc: false,
      disableConclusion: false,
    }, imagePreference: ImagePreference = 'content-only'): SlidePlan[] { return _enforcePageStructure(slides, target, hints, imagePreference); }

  /**
   * FR-0：参考含图强制插图——规划阶段在 imagePreference 归一化之前插入。
   * 参考属性（参考图含照片/插画，或参考 HTML 含 <img>）优先级高于用户 imagePreference：
   *  - 封面/总结页：挂 referenceHeroImage（落盘后由 master.heroImage 做 CSS 开窗背景），并置 referenceLockedImage 锁；
   *  - 内容页：强制 needsImage=true（FR-15 已按分类取 referenceImageUrl 作 img2img seed），并置锁。
   * 无参考文件（rva 为空）时直接原样返回，向后兼容。
   */
    public applyReferenceImageOverride(slides: SlidePlan[], rva: ReferenceVisualAttributes | undefined): SlidePlan[] { return _applyReferenceImageOverride(slides, rva); }

  /**
   * normalizePlanByImagePreference —— 规划阶段最后一道防线，按用户显式的 imagePreference 强制归一每张 slide 的 needsImage / pageType / imageRatio / 兜底 imagePrompt。
   * 目标：85% 以上场景下，HTML 生成之前 plan.slides 就已经正确，无需走兜底。
   */
    public normalizePlanByImagePreference(slides: SlidePlan[], imagePreference: ImagePreference, topic: string, imageOptionsEnabled: boolean = true): SlidePlan[] { return _normalizePlanByImagePreference(slides, imagePreference, topic, imageOptionsEnabled); }

  public buildPlanningPrompt(
    topic: string,
    style: string,
    audience: string,
    slideSpec: SlideCountSpec,
    density: ContentDensity,
    imagePreference: ImagePreference,
    backgroundEnabled: boolean = false,
    pageHints: PageStructureHints = {
      contentOnly: false,
      disableCover: false,
      disableToc: false,
      disableConclusion: false,
    },
    iconStyle: IconStyle = 'auto',
    fontFamily: 'sans' | 'serif' | 'mono' = 'sans',
    colorTheme?: ColorTheme,
    referenceHtmlBrief: string = '',
    userSettingsOverride: string = '',
    effectivePrimaryColor?: string,
    categoryReferenceSummary: string = '',
    referenceStructureSnippet: string = '',
    referenceColorPolicy: string = '',
    hasReference: boolean = false,
    referenceLayoutDiversity: string = '',
    /** RAG 文本素材（Hermes 侧整理），以「权威素材」段注入大纲 prompt */
    referenceText: string = '',
    language: 'zh' | 'en' = this.language,
  ): string {
    return _buildPlanningPrompt(
      topic, style, audience, slideSpec, density, imagePreference, backgroundEnabled,
      pageHints, iconStyle, fontFamily, colorTheme, referenceHtmlBrief, userSettingsOverride,
      effectivePrimaryColor, categoryReferenceSummary, referenceStructureSnippet,
      referenceColorPolicy, hasReference, referenceLayoutDiversity, referenceText, language,
    );
  }

  /**
   * 由参考视觉属性解析本页的参考标题色/正文色（跟随参考 > 用户 > 默认三级链）。
   * 注意：未提取到时返回 undefined（而非回退值），以便调用方区分「有参考」与「无参考」，
   * 从而保留原「无参考时浅底标题升级主色」的行为。
   */
  public resolveReferenceTextColors(
    refAttrs?: ReferenceVisualAttributes,
    pageType?: string,
  ): { titleColor?: string; bodyColor?: string } {
    return _resolveReferenceTextColors(refAttrs, pageType);
  }

  public buildSlideHtmlPrompt(
    plan: SlidePlan,
    primaryColor: string,
    primaryColorDarker: string,
    density: ContentDensity,
    iconStyle: IconStyle,
    slideWidth: number = 1280,
    slideHeight: number = 720,
    style: string = 'business',
    audience: string = '',
    colorTheme?: ColorTheme,
    fontFamily: 'sans' | 'serif' | 'mono' = 'sans',
    imagePreference: ImagePreference = 'content-only',
    backgroundEnabled: boolean = false,
    referenceHtmlBrief: string = '',
    titleColor: string = '#111827',
    bodyColor: string = '#374151',
    categoryReferenceSummary: string = '',
    referenceStructureSnippet: string = '',
    referenceColorPolicy: string = '',
    hasReference: boolean = false,
    canvasBg?: string,
    language: 'zh' | 'en' = this.language,
  ): string {
    return _buildSlideHtmlPrompt(
      plan, primaryColor, primaryColorDarker, density, iconStyle, slideWidth, slideHeight,
      style, audience, colorTheme, fontFamily, imagePreference, backgroundEnabled,
      referenceHtmlBrief, titleColor, bodyColor, categoryReferenceSummary,
      referenceStructureSnippet, referenceColorPolicy, hasReference, canvasBg, language,
    );
  }

    public async generatePlan(topic: string, style: string, audience: string, slideSpec: SlideCountSpec, density: ContentDensity, imagePreference: ImagePreference, primaryColor: string, onProgress?: GenerationCallback, backgroundEnabled: boolean = false, pageHints: PageStructureHints = {
      contentOnly: false,
      disableCover: false,
      disableToc: false,
      disableConclusion: false,
    }, iconStyle: IconStyle = 'auto', fontFamily: 'sans' | 'serif' | 'mono' = 'sans', colorTheme?: ColorTheme, referenceHtmlBrief: string = '', imageOptionsEnabled: boolean = true, referenceVisualAttributes?: ReferenceVisualAttributes, referenceText: string = ''): Promise<PresentationPlan> { return _generatePlan({ provider: this.provider, planningProvider: this.planningProvider, contentProvider: this.contentProvider, editingProvider: this.editingProvider, language: this.language }, topic, style, audience, slideSpec, density, imagePreference, primaryColor, onProgress, backgroundEnabled, pageHints, iconStyle, fontFamily, colorTheme, referenceHtmlBrief, imageOptionsEnabled, referenceVisualAttributes, referenceText); }

    public async generateSlideHtml(plan: SlidePlan, primaryColor: string, primaryColorDarker: string, density: ContentDensity, iconStyle: IconStyle, slideWidth: number = 1280, slideHeight: number = 720, style: string = 'business', audience: string = '', colorTheme?: ColorTheme, fontFamily: 'sans' | 'serif' | 'mono' = 'sans', imagePreference: ImagePreference = 'content-only', backgroundEnabled: boolean = false, referenceHtmlBrief: string = '', extraFeedback?: string, referenceVisualAttributes?: ReferenceVisualAttributes, pageIndexInCategory: number = 0): Promise<string> { return _generateSlideHtml({ provider: this.provider, planningProvider: this.planningProvider, contentProvider: this.contentProvider, editingProvider: this.editingProvider, language: this.language }, plan, primaryColor, primaryColorDarker, density, iconStyle, slideWidth, slideHeight, style, audience, colorTheme, fontFamily, imagePreference, backgroundEnabled, referenceHtmlBrief, extraFeedback, referenceVisualAttributes, pageIndexInCategory); }

  /**
   * T3S·b：逐页四级链应用参考视觉属性（FR-4 · Task5 全量 9 风格覆盖）。
   * 对单页，依「参考分类 > 参考全局 > 用户全局设置 > 系统默认」四级优先级，
   * 解析出 9 个风格属性的逐页生效值：
   *   primaryColor / fontFamily / iconStyle / style / density（原 5 项）
   *   + imagePreference / backgroundEnabled / pageHints / slideCount（本次补全）
   * 供 generateSlideHtml、后处理与图片升级逻辑逐页硬应用。
   * 当未传 referenceVisualAttributes 时原样返回 base，行为完全不变。
   */
    public resolvePageReferenceStyleAttrs(slidePlan: SlidePlan, rva: ReferenceVisualAttributes | undefined, base: {
      primaryColor: string;
      fontFamily: 'sans' | 'serif' | 'mono';
      iconStyle: IconStyle;
      style: string;
      density: ContentDensity;
      imagePreference?: ImagePreference;
      backgroundEnabled?: boolean;
      pageHints?: ReferencePageHints;
      slideCount?: number;
    }): {
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
  } { return _resolvePageReferenceStyleAttrs(slidePlan, rva, base); }

  /**
   * L0 定量硬校验接入（Task5 / FR-4 底线）：将 l0ValidateSlide 的违规项并入 critique 结果。
   * - 致命项（如正文字号 < 12px）直接判不通过（passed=false），从而触发 critique 重试循环重新生成。
   * - 重要项（如对比度 < 4.5:1）作为 issue 记录，但不强制否决。
   * 该函数就地修改 critique 对象，调用时机应在每次 critiqueSlide 返回后。
   */
  public applyL0ToCritique(critique: SlideCritique, html: string, pageType: string): void {
    return _applyL0ToCritique(critique, html, pageType);
  }

  /**
   * 损坏 inline CSS 消毒（幂等）：只处理 `style="..."` / `style='...'` 内部。
   * 只补分隔符（`;` 粘接），不改任何数值/视图值，因此对已规范输入重复应用结果不变。
   * 处理三类已知 bug 拼接（LLM 丢掉属性间 `;`）：
   *   ① 值(px/em/rem/%)紧贴下一个属性名：    `padding:24px 24pxborder-radius` → `padding:24px 24px;border-radius`
   *   ② px 后直接 属性名+:  （②① 兜底后）   `gap:16pxoverflow-wrap` → `gap:16px;overflow-wrap`
   *   ③ rgba(...)//var(...) `)` 后直接下一属性 `rgba(...)color:#fff` → `rgba(...);color:#fff`
   * 视图值不变：`0 0 20px 0` 中带空格的 `20px 0` 不受影响（① 要求数字后紧邻无空格属性名）。
   */
  public sanitizeStyleSyntax(html: string): string {
    return _sanitizeStyleSyntax(html);
  }

  /**
   * 终局消毒入口：对任意已生成 html 重放完整后处理链（幂等），供 server 写盘前兜底。
   * 仅需主色/暗色（可省略，自动推导）与 slide 画布尺寸；slidePlan 以占位 `{ pageType: '' }` 传入，
   * 链内依赖 pageType 的环节（postProcessLayout 忽略参数、ensureImageRatio 在 pageType='' 时跳过）均安全。
   */
    public postProcessHtmlSnapshot(html: string, opts: {
      primaryColor?: string;
      primaryColorDarker?: string;
      slideWidth?: number;
      slideHeight?: number;
      backgroundEnabled?: boolean;
      fontFamily?: 'sans' | 'serif' | 'mono';
      referenceVisualAttributes?: ReferenceVisualAttributes;
      pageType?: string;
    } = {}): string { return _postProcessHtmlSnapshot(html, opts); }

    public postProcessSlideHtml(html: string, slidePlan: SlidePlan, primaryColor: string, primaryColorDarker: string, slideWidth: number, slideHeight: number, backgroundEnabled: boolean, fontFamily: 'sans' | 'serif' | 'mono' = 'sans', referenceVisualAttributes?: ReferenceVisualAttributes, colorPolicy?: SlideColorPolicy): string { return _postProcessSlideHtml(html, slidePlan, primaryColor, primaryColorDarker, slideWidth, slideHeight, backgroundEnabled, fontFamily, referenceVisualAttributes, colorPolicy); }

  /**
   * FR-18 §18.5 · 受控 SVG 注入（Q12 内联 / Q13 复用分层渲染）
   *
   * 定位 LLM 生成的图形占位符 `<div class="structured-graphic" data-graphic-slot="...">`
   * 并用对应渲染器产出的受控内联 SVG 替换其 innerHTML：
   *   - chart / bar / line / pie / donut  → renderChartSvg(slidePlan.chart)
   *   - cycle                            → renderCycleSvg(slidePlan.keyPoints)
   *   - dashboard                        → renderDashboardSvg(showcaseMetrics, chart?)
   *   - architecture                     → renderArchitectureSvg(slidePlan.architecture)
   *
   * 约束（NFR-2 降级安全）：
   *   - 任一渲染异常 / 无占位符 / 无对应结构化数据 → 静默跳过，原 HTML 原样返回，绝不抛错阻塞主流程；
   *   - 仅替换占位符内部，不改动其他 DOM；占位符缺失时不强制改写页面。
   */
  public injectStructuredGraphics(
    html: string,
    slidePlan: SlidePlan,
    primaryColor: string,
    primaryColorDarker: string,
  ): string {
    return _injectStructuredGraphics(html, slidePlan, primaryColor, primaryColorDarker);
  }

  /**
   * 单列兜底：对图片侧栏页（content-image-left/right）强制所有 <ul>/<ol> 列表单列 flex-column，
   * 消除模型偶发仍生成的双列 grid 布局。仅对这两种 pageType 生效，其余 pageType 原样返回。幂等（二次调用结果不变）。
   */
  public enforceSingleColumn(html: string, pageType: string): string {
    return _enforceSingleColumn(html, pageType);
  }

  /**
   * 重生成外部反馈规范化：把用户/评审反馈里的“要双列”“要改某个具体 #hex 色”等与模板固定红线冲突的指令，
   * 软化为“保持本页单列 / 使用当前主题主色”的指导句。采用“追加规范化句 + 软化冲突子串”，不激进删句（保语义）。
   */
  public sanitizeRegenerationFeedback(
    feedback: string,
    pageType: string,
    primaryColor: string,
    allowedColors: string[] = [],
  ): string {
    return _sanitizeRegenerationFeedback(feedback, pageType, primaryColor, allowedColors);
  }

  /**
   * 判断 HTML 开标签 attrs 字符串是否命中「标题类豁免」：
   *  1) role="heading"（ARIA 标题，等价 H1-6）
   *  2) class 中包含 hero-title / page-title / slide-title / cover-title 关键词
   */
  public enforceBodyFontSize(html: string, options?: { round?: 1 | 2 }): string { return _enforceBodyFontSize(html, options); }
  public enforce8ptGrid(html: string): string { return _enforce8ptGrid(html); }
  public assertGrid8pt(html: string): string { return _assertGrid8pt(html); }
  public fixRowImageMargins(html: string): string { return _fixRowImageMargins(html); }
    public async generatePresentation(topic: string, options?: PresentationGenerationOptions): Promise<HTMLPresentation> { return _generatePresentation({ provider: this.provider, planningProvider: this.planningProvider, contentProvider: this.contentProvider, editingProvider: this.editingProvider, language: this.language }, topic, options); }

    public async generateFromPlan(topic: string, plan: PresentationPlan, options?: PresentationGenerationOptions, traceSessionId?: string): Promise<HTMLPresentation> { return _generateFromPlan({ provider: this.provider, planningProvider: this.planningProvider, contentProvider: this.contentProvider, editingProvider: this.editingProvider, language: this.language }, topic, plan, options, traceSessionId); }

    public async renderSlides(_topic: string, plan: PresentationPlan, design: DesignProposal, options?: PresentationGenerationOptions, traceSessionId?: string): Promise<RenderedSlide[]> { return _renderSlides({ provider: this.provider, planningProvider: this.planningProvider, contentProvider: this.contentProvider, editingProvider: this.editingProvider, language: this.language }, _topic, plan, design, options, traceSessionId); }

    public async regenerateSingleSlide(_topic: string, plan: PresentationPlan, design: DesignProposal, slideIndex: number, options?: PresentationGenerationOptions, traceSessionId?: string, externalFeedback?: string, channel: string = 'placeholder', originalHtml?: string): Promise<RenderedSlide> { return _regenerateSingleSlide({ provider: this.provider, planningProvider: this.planningProvider, contentProvider: this.contentProvider, editingProvider: this.editingProvider, language: this.language }, _topic, plan, design, slideIndex, options, traceSessionId, externalFeedback, channel, originalHtml); }

    public async assembleImages(topic: string, renderedSlides: RenderedSlide[], plan: PresentationPlan, _design: DesignProposal, options?: PresentationGenerationOptions, traceSessionId?: string): Promise<RenderedSlide[]> { return _assembleImages({ provider: this.provider, planningProvider: this.planningProvider, contentProvider: this.contentProvider, editingProvider: this.editingProvider, language: this.language }, topic, renderedSlides, plan, _design, options, traceSessionId); }

    public async finalizePresentation(topic: string, renderedSlides: RenderedSlide[], plan: PresentationPlan, _design: DesignProposal, options?: PresentationGenerationOptions, traceSessionId?: string): Promise<HTMLPresentation> { return _finalizePresentation({ provider: this.provider, planningProvider: this.planningProvider, contentProvider: this.contentProvider, editingProvider: this.editingProvider, language: this.language }, topic, renderedSlides, plan, _design, options, traceSessionId); }

    public async generateDesignProposals(topic: string, plan: PresentationPlan, options?: PresentationGenerationOptions, traceSessionId?: string): Promise<DesignProposal[]> { return _generateDesignProposals({ provider: this.provider, planningProvider: this.planningProvider, contentProvider: this.contentProvider, editingProvider: this.editingProvider, language: this.language }, topic, plan, options, traceSessionId); }

  public removeImagePlaceholder(slide: HTMLSlide): void { return _removeImagePlaceholder(slide); }
  public slideHasMeaningfulBody(html: string): boolean { return _slideHasMeaningfulBody(html); }
  public injectImagePlaceholderForContentSlide(html: string, pageType: SlidePageType, _primaryColor?: string): string { return _injectImagePlaceholderForContentSlide(html, pageType, _primaryColor); }
  public injectBackgroundPlaceholder(html: string): string { return _injectBackgroundPlaceholder(html); }
  public removeBackgroundPlaceholder(slide: HTMLSlide): void { return _removeBackgroundPlaceholder(slide); }

  /**
   * 配色"自洽性"检测（FR-B）：判断 HTML 是否已形成单一色相族 + 中性灰阶的自洽配色。
   * 自洽 → 返回 true，调用方应跳过 sanitizeGradientColors / enforceSinglePalette 的颜色重写，
   * 避免把参考图驱动生成的红色系页面（或其它任何单一色系页面）被重染成传入的 primaryColor。
   *
   * 判定：
   *   1. 收集 style 内与 svg fill/stroke 中出现的所有颜色 token；
   *   2. 过滤中性色（灰/白/黑/transparent/currentColor/none/url(#...)/命名色）；
   *   3. 剩余"彩色"色相，若其环形最大空隙 >= 360 - HUE_WINDOW（即全部色相落在某个 ≤HUE_WINDOW 的窗口内），
   *      视为单一色系 → 自洽。
   * 无彩色 token（纯中性/无彩色页面）一律视为自洽（历史重写本为 no-op）。
   */
    public detectHarmonizedPalette(html: string): boolean { return _detectHarmonizedPalette(html); }

    public sanitizeGradientColors(html: string, primaryColor: string, primaryColorDarker: string, colorPolicy?: SlideColorPolicy): string { return _sanitizeGradientColors(html, primaryColor, primaryColorDarker, colorPolicy); }

  public normalizeHex(hex: string): string | null { return _normalizeHex(hex); }
  public hexToRgba(hex: string, alpha: number): string { return _hexToRgba(hex, alpha); }
  public rgbStringToHex(str: string): string | null { return _rgbStringToHex(str); }
  public hexToRgb(hex: string): { r: number; g: number; b: number } | null { return _hexToRgb(hex); }

  /**
   * 单一配色约束：把 style 内 color/background/background-color/border 系属性与
   * outline、box-shadow 处出现的
   * 非白名单颜色（hex 与 rgb()/rgba()）按所在属性规整到品牌主色或中性灰阶，保证 H1/H2/H3 渐变只能
   * primary→darker、正文文字只用中性深灰。
   * 语义色（进度条/胜出徽章/警告背景）仅允许出现在 background 或 border 属性值中；出现在 color/box-shadow 时会被替换。
   */
  

  /**
   * 背景图兜底注入：当 slide HTML 里没有预先写好 BG_PLACEHOLDER 时（内容 LLM 没按模板写背景样式），
   * 退一步直接把图片 url 作为 background-image 插入到 slide 最外层 <div style="..."> 的 style 属性里。
   * 是 Defect Fix 2/4 的配套 helper。
   * 返回 { attempted: 是否尝试过注入, injected: 成功注入的 slide 数量 }
   */
  public injectBackgroundImageToDiv(
    slides: HTMLSlide[],
    bgImageUrl: string,
  ): { attempted: boolean; injected: number } {
    return _injectBackgroundImageToDiv(slides, bgImageUrl);
  }

  /** 旧代码硬编码的 FULL_FONT_FAMILY sans 常量：与 ensureOuterContainer 曾经写死的、finalGuard 老 HTML 中的系统默认 sans 栈逐字节相等。
   *  仅当 font-family 与此串逐字节匹配（或其历史短版子集）时，才视为"老默认占位值"而允许被 fontFamily 选项覆盖。
   *  任何真实定制（mono、带引号的 serif、LLM 自写栈、带本地字体名等）都不会命中此串，因此保持 addIfMissing 的绝对幂等性。
   */
  public readonly DEFAULT_HARDCODED_SANS =
    "system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,'Noto Sans SC','PingFang SC','Microsoft YaHei',sans-serif";

  /** 老生成链路遗留 6 项 mono 占位全集白名单（旧 PAGE_TEMPLATES 示例字面量、及其衍生的老 presentation.json）：
   *  仅用于 isDefaultLegacyMonoPlaceholder 的子集宽松判定，**不得**作为新栈返回值；新栈统一走 getFontStack('mono')。
   */
  public readonly DEFAULT_HARDCODED_MONO_LEGACY =
    "'JetBrains Mono', ui-monospace, 'Cascadia Code', Consolas, 'Noto Sans Mono CJK SC', monospace";

  /** 单个字体名归一化：去全部空格、统一引号→去引号、去分号等垃圾字符、转小写。
   *  用于「子集白名单」判定。对 parseStyleDeclarations 解析遗留的末尾分号等脏字符做纵深防御。
   */



  /** 通用「默认占位 font-family」判定（老默认 sans 占位 OR 老遗留 mono 占位，任一命中即可允许升级）。
   *  由 ensureOuterContainer 三分支统一调用，替代原先分散调用 isDefaultSansPlaceholder 的逻辑。
   */
  public isPlaceholderFontFamily(current: string): boolean { return _isPlaceholderFontFamily(current, this.DEFAULT_HARDCODED_SANS, this.DEFAULT_HARDCODED_MONO_LEGACY); }

  /**
   * 生成调用封装：在真正降级为极简 fallback 之前，对 LLM 调用失败（fetch failed / 超时等）
   * 进行有限次重试（默认 2 次）。这样网络抖动 / 单侧超时不再直接摧毁整页版式。
   */
    public async generateSlideHtmlSafe(slidePlan: SlidePlan, rp: {
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
    }, slideWidth: number, slideHeight: number, audience: string, colorTheme: ColorTheme | undefined, referenceHtmlBrief: string, feedback: string | undefined, referenceVisualAttributes: ReferenceVisualAttributes | undefined, pageIndexInCategory = 0, maxRetries = 2): Promise<string> { return _generateSlideHtmlSafe({ provider: this.provider, planningProvider: this.planningProvider, contentProvider: this.contentProvider, editingProvider: this.editingProvider, language: this.language }, slidePlan, rp, slideWidth, slideHeight, audience, colorTheme, referenceHtmlBrief, feedback, referenceVisualAttributes, pageIndexInCategory, maxRetries); }

  // 漂移回归守卫: fontstack-dual-source-sync.test.ts 保证本方法返回值与 templates#getFontStackLocal 逐字节全等
  public getFontStack(fontFamily: 'sans' | 'serif' | 'mono' = 'sans'): string { return _getFontStack(fontFamily); }

  public generateFallbackSlide(
    plan: SlidePlan,
    primaryColor: string,
    slideWidth: number = 1280,
    slideHeight: number = 720,
    fontFamily: 'sans' | 'serif' | 'mono' = 'sans',
    iconStyle?: string,
  ): string {
    return _generateFallbackSlide(plan, primaryColor, slideWidth, slideHeight, fontFamily, iconStyle);
  }

    public async generatePresentationFromReference(topic: string, _referenceHtml: string, options?: PresentationGenerationOptions): Promise<HTMLPresentation> { return _generatePresentationFromReference({ provider: this.provider, planningProvider: this.planningProvider, contentProvider: this.contentProvider, editingProvider: this.editingProvider, language: this.language }, topic, _referenceHtml, options); }

    public async modifySlide(currentHtml: string, userRequest: string, primaryColor: string = '#2563eb'): Promise<string> { return _modifySlide({ provider: this.provider, planningProvider: this.planningProvider, contentProvider: this.contentProvider, editingProvider: this.editingProvider, language: this.language }, currentHtml, userRequest, primaryColor); }

    public async modifyElement(elementHtml: string, userRequest: string): Promise<string> { return _modifyElement({ provider: this.provider, planningProvider: this.planningProvider, contentProvider: this.contentProvider, editingProvider: this.editingProvider, language: this.language }, elementHtml, userRequest); }

    public async modifyGlobal(presentation: HTMLPresentation, currentSlideIndex: number, userRequest: string): Promise<HTMLPresentation> { return _modifyGlobal({ provider: this.provider, planningProvider: this.planningProvider, contentProvider: this.contentProvider, editingProvider: this.editingProvider, language: this.language }, presentation, currentSlideIndex, userRequest); }

  public parsePlan(content: string): PresentationPlan {
    return _parsePlan(content);
  }

    public parsePresentation(content: string, primaryColor: string = '#2563eb'): HTMLPresentation { return _parsePresentation(content, primaryColor); }

  public postProcessLayout(html: string, _pageType?: SlidePageType, slideWidth: number = 1280, slideHeight: number = 720, primaryColor: string = '#2563eb', fontFamily?: 'sans' | 'serif' | 'mono', titleColor?: string, colorPolicy?: SlideColorPolicy, composition?: ReferenceComposition): string { return _postProcessLayout(html, _pageType, slideWidth, slideHeight, primaryColor, fontFamily, titleColor, colorPolicy, composition); }
  public ensureOuterContainer(html: string, slideWidth: number = 1280, slideHeight: number = 720, fontFamily: 'sans' | 'serif' | 'mono' = 'sans'): string { return _ensureOuterContainer(html, slideWidth, slideHeight, fontFamily); }
  public enforceTextContainerStyles(html: string): string { return _enforceTextContainerStyles(html); }
  public ensureImageProperWrapper(html: string): string { return _ensureImageProperWrapper(html); }
  public enforceStretchAlignment(html: string): string { return _enforceStretchAlignment(html); }
  // 注：以下 4 个方法同时是 Phase 2 测试网（html-presentation-agent / bug3-injector-locator / postprocess-pipeline）的直接调用入口，需保持 public 避免被 unused 检查误删
  public enforceImageContainerStyles(html: string): string { return _enforceImageContainerStyles(html); }
  public enforceCoverPosterArtStyles(html: string, primaryColor: string, _sw: number, _sh: number, titleColor?: string, composition?: ReferenceComposition): string { return _enforceCoverPosterArtStyles(html, primaryColor, _sw, _sh, titleColor, composition); }
  public enforceFinalTextContrast(html: string, primaryColor: string, colorPolicy?: SlideColorPolicy): string { return _enforceFinalTextContrast(html, primaryColor, colorPolicy); }
  public darkenPrimaryColor(primaryColor: string, ratio: number): string { return _darkenPrimaryColor(primaryColor, ratio); }
  public buildReferenceSeedMap(
    options: any,
  ): Partial<Record<'cover' | 'content' | 'summary' | 'global', string>> | undefined {
    return _buildReferenceSeedMap(options);
  }

  // =========================================================================
    public sanitizeImagePrompt(rawPrompt: string, primaryColor?: string): string { return _sanitizeImagePrompt({ provider: this.provider, planningProvider: this.planningProvider, contentProvider: this.contentProvider, editingProvider: this.editingProvider, language: this.language }, rawPrompt, primaryColor); }

  // =========================================================================
  // 缺陷 1 兜底：删除「颜色代码水印 div」
  // 匹配 div 纯文本（去掉所有嵌套标签后）是颜色代码（#2563b、#FFFFFF、RGB(...)、主色#...、颜色代码、HEX、COLOR 等）
  // =========================================================================
  public enforceDarkBgTextContrast(html: string, primaryColor: string, colorPolicy?: SlideColorPolicy): string { return _enforceDarkBgTextContrast(html, primaryColor, colorPolicy); }

  // =========================================================================
  // 缺陷 3 兜底：装饰性竖排 writing-mode → 强制改回横排 + 水平列表结构
  // =========================================================================
  public fixVerticalWritingLists(html: string): string { return _fixVerticalWritingLists(html); }
  public enforceLightBgTextContrast(html: string, primaryColor: string, _colorPolicy?: SlideColorPolicy): string { return _enforceLightBgTextContrast(html, primaryColor, _colorPolicy); }

  public enforceHeadingColorOnLightBg(html: string, opts: { primaryColor: string; primaryColorDarker: string; titleColor?: string; pageBgLight?: boolean; pageBgDark?: boolean; }): string { return _enforceHeadingColorOnLightBg(html, opts); }

  /**
   * 建议1：封面海报级艺术字兜底
   * 判定：outer 容器里有 h1（主标题 + 若干 p 副标题）
   * 措施：
   *   1. 如果没居中 → 改 justify-content:center + align-items:center + text-align:center
   *   2. H1 字号 < 80 → 升到 88，font-weight < 900 → 900
   *   3. H1 没 text-shadow / 没 -webkit-text-stroke → 加上 3 层发光 + 描边 1.5px
   *   4. H1 下方缺少装饰粗渐变条 → 插入
   *   5. 没有 2 个装饰 blob/光晕 → 插入右上角+左下角
   *   6. 副标题无分层（都是24px 灰）→ 按顺序分层 36/28/28 + 最后一行作者 badge 胶囊
   */

  /**
   * 语义化统计「纯装饰 blob」数量，替代脆弱的字面正则。
   *
   * 判定标准：一个 <div> 同时满足
   *   ① position:absolute（或 fixed）
   *   ② style 内含 渐变(radial/linear-gradient) 或 clip-path（即它是装饰形状而非内容块）
   *   ③ 其 innerHTML 无可见文本（仅空白/注释/嵌套装饰，无裸文字）
   * 才计入装饰。
   *
   * 之所以不用 `/pointer-events:none|clip-path:polygon/gi` 这类字面匹配：
   * 终局 server 端 sanitizeHtmlServerSide 用 JSDOM 序列化会把 style 规范化为 `key: value`（带空格、
   * 去尾分号），导致紧凑字面 100% 失配 → 误判"无装饰" → enforceCoverPosterArtStyles 重复注入模板装饰。
   * 语义判定只看"绝对定位 + 有渐变/clip + 无文本"的结构特征，对空白差异完全鲁棒。
   */
  public parseColorToRgba(token: string): [number, number, number, number] | null { return _parseColorToRgba(token); }
  public compositeOver(fg: [number, number, number, number], base: [number, number, number]): [number, number, number] { return _compositeOver(fg, base); }
  public contrastRatio(fg: [number, number, number], bg: [number, number, number]): number { return _contrastRatio(fg, bg); }
  // 注：本方法同时是 Phase 2 测试网（postprocess-pipeline）的直接调用入口，需保持为 public 避免被 unused 检查误删
  public resolveEffectiveBgRgb(styleStr: string): [number, number, number] | null { return _resolveEffectiveBgRgb(styleStr); }

  public relativeLuminance(rgb: [number, number, number]): number { return _relativeLuminance(rgb); }
  public isDecorativeLayer(styleStr: string): boolean { return _isDecorativeLayer(styleStr); }
  public resolveBgTone(styleStr: string, _primaryColor: string, opts?: { isDecorative?: boolean }): 'light' | 'dark' | 'unknown' { return _resolveBgTone(styleStr, _primaryColor, opts); }
  public needsContrastFix(fgToken: string, bgRgb: [number, number, number], fontSizePx: number, fontWeight: number): boolean { return _needsContrastFix(fgToken, bgRgb, fontSizePx, fontWeight); }
  public fontSizeOf(props: Map<string, string>): number { return _fontSizeOf(props); }
  public fontWeightOf(props: Map<string, string>): number { return _fontWeightOf(props); }

  public ensureImageRatio(html: string, plan: SlidePlan): string { return _ensureImageRatio(html, plan); }
  public sanitizeSlideHtml(html: string): string {
    return _sanitizeSlideHtml(html);
  }

  public flattenMeaninglessNesting(html: string): string {
    return _flattenMeaninglessNesting(html);
  }

  /**
   * ensureSemanticWrapping —— 裸文本兜底 · 终极防线（基于栈的深度优先扫描）
   *
   * 处理对象：wrapTextNodes / flattenMeaninglessNesting 之后仍残留的裸文本。
   * 典型触发路径：
   *   - 容器内的文本行直接出现在 h2 之后、且没有任何 <div> 包裹（正则 replaceTextInDiv 无法触及）
   *   - <ul> 同级兄弟裸文本
   *   - 深度嵌套后被 flatten 露出来的裸文本
   *
   * 算法思路：
   *   1. 建立"文本容器"集合 textTags（进入后，内部字符一律视为安全，不再扫描是否裸文本）
   *   2. 建立"布局容器"集合 containerTags（进入后，内部的直接文本字符视为"裸文本"需要处理）
   *   3. 逐字符扫描 + 栈。每遇到开/关标签压/弹栈；遇到字符时，若当前顶层是 container → 进入裸文本缓冲，
   *      否则直接拼入输出。当遇到下一个子标签或当前 container 关标签时，flush 裸文本缓冲 → 按换行拆分成多行 <p>。
   */
  /**
   * 裸文本兜底时构造 <p> 的 style：优先从父容器 openTagFull/style 继承字号/颜色/字距/行高/字重，
   * 仅当父容器无任何可继承排版属性时才回落 DEFAULT_P_STYLE（font-size:24px;color:#374151;...），
   * 避免写死默认值覆盖 LLM 设定的设计（如 kicker 的 16px / 参考色 / letter-spacing）。
   */

  public composeInheritedPStyle(parentStyle?: string): string { return _composeInheritedPStyle(parentStyle); }
  public ensureSemanticWrapping(html: string): string { return _ensureSemanticWrapping(html); }

  public findDirectChildElements(html: string): Array<{ tagName: string; styleAttr: string | null; innerPreview: string | null }> { return _findDirectChildElements(html); }

  /**
   * B2：栈式扫描，获取某 HTML 片段的「第一层直接子元素」（不含孙节点、不含文本、不含注释）。
   * 用于 enforceLeftRight5545AndCardBar 的角色判定，避免 rawTail.substring(0,N) 粗扫描
   * 把孙节点的 <ul>/<img> 误判成当前 div 的直接子节点，从而错判列归属角色。
   */

  public wrapTextNodes(html: string): string { return _wrapTextNodes(html); }

  public extractJson(content: string): string {
    return _extractJson(content);
  }

  public extractHtml(content: string): string {
    return _extractHtml(content);
  }
}


/**
 * 自然语言 → comparison-deep-dive 意图识别（关键词正则，中文+英文 25+ 同义词）
 * 命中规则（任一即 true）：
 *   1. 包含完整"对比核心词"：深度对比 / 全面对比 / 参数对比 / 性能对比 / 功能对比 / 规格对比 / 差异对比 / 横向对比 / 纵向对比
 *      / 竞品对比 / 方案对比 / 对比分析 / 新旧方案 / 升级前后 / Before & After / 优势劣势 / 评测 / 测评 / 横评 / A/B 对比 / AB 测试
 *   2. 包含"对比 / PK / vs / benchmark"这类核心字（更宽松，如"AI对比工作伙伴"、"两款产品PK"）
 *   3. 典型二分式结构：「XX 和/跟/与/同 XX [做][一个][深度/全面/详细] 对比/比较/评测/PK」
 * 返回：{ isComparison, triggerWords } → 供下游决定是否强制使用 comparison-deep-dive 版式
 */

// ================================================================
// 测试用：构造 generatePlan 发给 LLM 的 system+user messages。
// 真实 generatePlan() 流程内构造逻辑的镜像实现，保证二者一致。
// ================================================================
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
  const agent = new HTMLPresentationAgent({
    name: 'stub',
    config: {} as any,
    chat: async () => ({
      content: '',
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    }),
  } as any);
  const effectiveColor = computeU17EffectivePrimaryColor(
    params.style,
    params.colorTheme,
    params.primaryColor,
  );
  const userOverride =
    (agent as any).buildUserSettingsPriorityOverridePrompt?.({
      slideCount: params.slideSpec,
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
  const systemPrompt = (agent as any).buildPlanningPrompt(
    params.topic,
    params.style,
    params.audience,
    params.slideSpec,
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

// ================================================================
// TEST HARNESS EXPORT（仅用于 vitest 单元测试，业务代码不应 import 本块）
// 对应单测文件：primary-color.test.ts / gradient.test.ts
// ================================================================
// 注：本文件顶层使用 `function` 和 `const`，不会与业务类 export 冲突。
// 单独导出常量/纯函数，避免依赖 HTMLPresentationAgent 类实例。
// buildPlanningMessagesForTest 使用 export function 单独导出；computeU17EffectivePrimaryColor
// 已收敛到 plan-utils 单一实现，此处仅做再导出，避免双副本漂移。
export {
  COLOR_THEMES,
  darkenColor,
  hexToHsl,
  hslToHex,
  hueDelta,
  assertHueClose,
  resolveEffectivePrimaryColor,
  computeU17EffectivePrimaryColor,
};
export { detectComparisonIntent, autoCompleteComparisonPage } from './html-presentation/plan-utils';
