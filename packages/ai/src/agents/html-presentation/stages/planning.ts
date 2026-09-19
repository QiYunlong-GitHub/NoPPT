import type { AgentDeps } from './deps';
import { COLOR_THEMES, HTMLPresentation, PageStructureHints, SlideCountSpec, extractPageStructureHints, extractSlideCountSpec, keyOf, resetRetryCount } from '../shared';
import { ChatMessage, ColorTheme, ContentDensity, DesignProposal, GenerationCallback, IconStyle, ImagePreference, PresentationGenerationOptions, PresentationPlan, ReferenceVisualAttributes } from '../../../types';
import { buildPlanningPrompt, buildSlideCountGuidance, buildUserSettingsPriorityOverridePrompt, sanitizeTopicSettingsConflict, summarizeReferenceHtmlBrief } from '../prompts';
import { formatReferenceOverrideOverview, getReferenceColorPolicyOverview, getReferenceLayoutDiversityHint, getReferenceSnippetOverview, resolveDeckReferencePrimaryColor } from '../../../utils/reference-attribute-resolver';
import { parsePlan } from '../html-sanitize';
import { applyReferenceImageOverride, autoCompleteComparisonPage, clampSlidesToCount, computeU17EffectivePrimaryColor, detectComparisonIntent, enforcePageStructure, getPrimaryColor, normalizePlanByImagePreference } from '../plan-utils';
import { switchStage } from './deps';
import { TraceableProvider, formatBeijingTime } from '../../../providers/base';
import { closeTraceSession, openTraceSession } from '../../../utils/llm-tracer';
import { renderSlides } from './render';
import { assembleImages } from './assemble';
import { finalizePresentation } from './finalize';
export async function generatePlan(deps: AgentDeps, topic: string, style: string, audience: string, slideSpec: SlideCountSpec, density: ContentDensity, imagePreference: ImagePreference, primaryColor: string, onProgress?: GenerationCallback, backgroundEnabled: boolean = false, pageHints: PageStructureHints = {
      contentOnly: false,
      disableCover: false,
      disableToc: false,
      disableConclusion: false,
    }, iconStyle: IconStyle = 'auto', fontFamily: 'sans' | 'serif' | 'mono' = 'sans', colorTheme?: ColorTheme, referenceHtmlBrief: string = '', imageOptionsEnabled: boolean = true, referenceVisualAttributes?: ReferenceVisualAttributes, referenceText: string = ''): Promise<PresentationPlan> {
    // 纵深防御兜底：若调用方未表达任何结构偏好（全 false），而 topic 中含明确的
    // "不要封面/目录/总结"指令，则从 topic 解析补齐，避免默认页数策略静默覆盖用户意图。
    // 显式传入的 hints 优先级最高，不会被覆盖。
    let effectiveHints = pageHints;
    const callerNoPref =
      !pageHints.contentOnly &&
      !pageHints.disableCover &&
      !pageHints.disableToc &&
      !pageHints.disableConclusion;
    if (callerNoPref) {
      const topicHints = extractPageStructureHints(topic);
      if (
        topicHints.contentOnly ||
        topicHints.disableCover ||
        topicHints.disableToc ||
        topicHints.disableConclusion
      ) {
        effectiveHints = topicHints;
      }
    }
    const { planningTotal, displayText } = buildSlideCountGuidance(slideSpec);
    onProgress?.({
      phase: 'outline',
      current: 0,
      total: planningTotal,
      message: `正在规划演示结构（${displayText}）...`,
    });
    const refDeckPrimary = resolveDeckReferencePrimaryColor(referenceVisualAttributes);
    const userSettingsOverride = buildUserSettingsPriorityOverridePrompt({
      slideCount: slideSpec,
      style,
      density,
      imagePreference,
      colorTheme,
      iconStyle,
      fontFamily,
      backgroundEnabled,
      audience,
      referencePrimaryColor: refDeckPrimary,
    });
    // U-17-L · LLM 调用前一致化：
    //   先按 U-17 公式算出最终主色，再把同一个值同时用于：
    //   ① buildPlanningPrompt 里 system prompt 示例 JSON 和 配色强约束文案
    //   ② user prompt 里主色说明
    //   ③ parsePlan 后强制覆盖（U-17 原逻辑）
    // 彻底消除「system 写 #ea580c / user 写 #2563eb」的 LLM 输入矛盾。
    // FR-2.x：参考主色（deck 级代表）为绝对最高优先级，覆盖 colorTheme 默认的蓝/紫等；
    // 否则回落 computeU17EffectivePrimaryColor（与今天行为一致）。
    const effectiveColor =
      refDeckPrimary ?? computeU17EffectivePrimaryColor(style, colorTheme, primaryColor);
    const categoryReferenceSummary = referenceVisualAttributes
      ? '【参考文件提取属性 · 绝对最高优先级 · 覆盖用户显式参数与所有示例】\n' +
        formatReferenceOverrideOverview(referenceVisualAttributes)
      : '';
    const planningSnippet = referenceVisualAttributes
      ? getReferenceSnippetOverview(referenceVisualAttributes)
      : '';
    const planningColorPolicy = referenceVisualAttributes
      ? getReferenceColorPolicyOverview(referenceVisualAttributes)
      : '';
    const planningLayoutDiversity = referenceVisualAttributes
      ? getReferenceLayoutDiversityHint(referenceVisualAttributes)
      : '';
    let prompt = buildPlanningPrompt(
      topic,
      style,
      audience,
      slideSpec,
      density,
      imagePreference,
      backgroundEnabled,
      effectiveHints,
      iconStyle,
      fontFamily,
      colorTheme,
      referenceHtmlBrief,
      userSettingsOverride,
      effectiveColor,
      categoryReferenceSummary,
      planningSnippet,
      planningColorPolicy,
      !!referenceVisualAttributes,
      planningLayoutDiversity,
      referenceText,
    );

    const messages: ChatMessage[] = [
      { role: 'system', content: prompt },
      { role: 'user', content: `请规划这个演示文稿，主色调使用：${effectiveColor}` },
    ];
    switchStage(deps.planningProvider, 'planning');
    const response = await deps.planningProvider.chat(messages, {
      temperature: 0.5,
      maxTokens: 8192,
    });
    const plan = parsePlan(response.content);
    if (!plan.primaryColor || !/^#[0-9a-fA-F]{6}$/.test(plan.primaryColor)) {
      plan.primaryColor = effectiveColor;
    }
    // U-17 · parsePlan 后强制覆盖：
    //   使用预先计算的 effectiveColor（与上面 messages 用同一值），
    //   保持计算单源、避免重复公式产生漂移。
    if (plan.primaryColor.toLowerCase() !== effectiveColor.toLowerCase()) {
      const reason =
        colorTheme && COLOR_THEMES[colorTheme]
          ? `colorTheme=${colorTheme}`
          : `auto(style=${style})`;
      console.warn(
        `[PLAN] parsePlan 返回 primaryColor=${plan.primaryColor}，与 ${reason} 期望 ${effectiveColor} 不一致，已强制覆盖。`,
      );
    }
    plan.primaryColor = effectiveColor;

    // 范围/精确页数裁剪 + 结构强制对齐（代码握有最终控制权）
    if ('exact' in slideSpec && slideSpec.exact != null) {
      plan.slides = clampSlidesToCount(
        plan.slides,
        slideSpec.exact,
        effectiveHints,
        imagePreference,
      );
      plan.slides = enforcePageStructure(
        plan.slides,
        slideSpec.exact,
        effectiveHints,
        imagePreference,
      );
    } else if (
      'min' in slideSpec &&
      'max' in slideSpec &&
      slideSpec.min != null &&
      slideSpec.max != null
    ) {
      if (plan.slides.length < slideSpec.min) {
        plan.slides = clampSlidesToCount(
          plan.slides,
          slideSpec.min,
          effectiveHints,
          imagePreference,
        );
        plan.slides = enforcePageStructure(
          plan.slides,
          slideSpec.min,
          effectiveHints,
          imagePreference,
        );
      } else if (plan.slides.length > slideSpec.max) {
        plan.slides = clampSlidesToCount(
          plan.slides,
          slideSpec.max,
          effectiveHints,
          imagePreference,
        );
        plan.slides = enforcePageStructure(
          plan.slides,
          slideSpec.max,
          effectiveHints,
          imagePreference,
        );
      } else {
        // 在范围内，依然强制对齐结构（数量不变，但封面/toc/总结的有无和位置要正确）
        plan.slides = enforcePageStructure(
          plan.slides,
          plan.slides.length,
          effectiveHints,
          imagePreference,
        );
      }
    }

    // A-2.5 FR-0：参考含图强制插图（在 imagePreference 归一化之前插入，参考属性优先级高于用户设置）
    plan.slides = applyReferenceImageOverride(plan.slides, referenceVisualAttributes);

    // A-3 归一化：最后一道防线，无论上游决策如何，都按 imagePreference 强制对齐
    //            并且传入 imageOptionsEnabled 做防御降级（开关没开时 → 强制 pref=none）
    plan.slides = normalizePlanByImagePreference(
      plan.slides,
      imagePreference,
      topic,
      imageOptionsEnabled,
    );

    // A-4 【对比意图硬兜底 · comparison-deep-dive 自动补齐】
    // 只要用户写了"深度对比""性能对比""全面对比""PK""vs""A和B对比"等 25+ 关键词，就：
    //   1. 把封面/目录/总结之外的内容页（优先：正文第 1/2 张）自动 pageType 改成 comparison-deep-dive
    //   2. 自动补齐：styleTheme='mixed' + metricValues 预设数组 + advantageIndices 高值索引 + layoutParams 双栏 + needsImage=false
    // 完全不需要用户懂这些内部术语，写自然语言即可。
    const comparisonIntent = detectComparisonIntent(topic + ' ' + (style || ''));
    if (comparisonIntent.isComparison && Array.isArray(plan.slides) && plan.slides.length > 0) {
      // 决定哪些页"优先"升级成 comparison-deep-dive：
      //   - 第一个内容页（即：跳过 cover/toc 后的第 1 个内容页，索引 i>=1）
      //   - 或 LLM 已经选了对比/卡片/列表/表格这类基础页类型（content-compare/content-cards/content-list/content-table）
      //   - 如果正文只有 1 张内容页（总页数 3 = cover + 1 内容 + summary），那就把那张内容页强制升级
      const nonNavSlides = plan.slides.filter(
        (p) => !['cover', 'toc', 'conclusion', 'summary'].includes(p.pageType),
      );
      const firstContentIdx = plan.slides.findIndex(
        (p) => !['cover', 'toc', 'conclusion', 'summary'].includes(p.pageType),
      );
      const forceCount = Math.max(1, Math.min(nonNavSlides.length, 2)); // 至少升级 1 张，最多升级 2 张（避免 summary 也变对比页）
      let upgraded = 0;
      plan.slides = plan.slides.map((page, i) => {
        const isNav = ['cover', 'toc', 'conclusion', 'summary'].includes(page.pageType);
        if (isNav) return page;
        if (upgraded >= forceCount) return page;
        // 升级条件：(a) 第一内容页优先 (b) 本身已是对比/卡片/列表类基础页 (c) 该页标题/要点里隐约也有对比词
        const pageTypeEligible = [
          'content-compare',
          'content-cards',
          'content-list',
          'content-stats-highlight',
          'content-table',
        ].includes(page.pageType);
        const titleHit =
          typeof page.title === 'string' && detectComparisonIntent(page.title).isComparison;
        const isFirstContentPages =
          firstContentIdx >= 0 && i >= firstContentIdx && i < firstContentIdx + forceCount;
        if (pageTypeEligible || titleHit || isFirstContentPages) {
          upgraded++;
          return autoCompleteComparisonPage(page);
        }
        return page;
      });
    }

    return plan;
  }

export async function generatePresentation(deps: AgentDeps, topic: string, options?: PresentationGenerationOptions): Promise<HTMLPresentation> {
    const startBeijingTime = formatBeijingTime();
    let timestamp = formatBeijingTime();
    console.log(
      `\n[${timestamp}] [AGENT] ========== Starting presentation generation (v2 two-phase) ==========`,
    );
    console.log(`[${timestamp}] [AGENT] Start time (Beijing): ${startBeijingTime}`);
    console.log(`[${timestamp}] [AGENT] Topic: ${topic}`);
    console.log(
      `[${timestamp}] [AGENT] Planning model: ${deps.planningProvider.name}/${deps.planningProvider.config.model}`,
    );
    console.log(
      `[${timestamp}] [AGENT] Content model: ${deps.contentProvider.name}/${deps.contentProvider.config.model}`,
    );
    console.log(
      `[${timestamp}] [AGENT] Editing model: ${deps.editingProvider.name}/${deps.editingProvider.config.model}`,
    );

    const style = options?.style || 'business';
    const audience = options?.audience || '';
    const density = options?.density || 'normal';
    const imagePreference = options?.imagePreference || 'content-only';
    // 归一化iconStyle：将旧值checkmark/minimal映射到bullet（向后兼容本地存储旧值）
    const rawIconStyle = (options?.iconStyle || 'auto') as string;
    const iconStyle: IconStyle =
      rawIconStyle === 'checkmark' || rawIconStyle === 'minimal'
        ? 'bullet'
        : (rawIconStyle as IconStyle);
    const fontFamily = options?.fontFamily || 'sans';
    const referenceHtml = options?.referenceHtml || '';
    const colorTheme = options?.colorTheme;
    deps.language = options?.language === 'en' ? 'en' : 'zh';

    // 三级优先级解析：slideCountSpec (exact | range)
    // 1. 前端显式范围
    // 2. 前端显式单值
    // 3. 从主题智能提取（新 extractSlideCountSpec）
    // 4. 兜底：{ exact: 8 }
    let slideSpec: SlideCountSpec;
    if (typeof options?.slideCountMin === 'number' && typeof options?.slideCountMax === 'number') {
      const min = Math.max(1, Math.min(options.slideCountMin, options.slideCountMax));
      const max = Math.max(1, Math.max(options.slideCountMin, options.slideCountMax));
      slideSpec = { min, max };
    } else if (typeof options?.slideCount === 'number') {
      slideSpec = { exact: Math.max(1, options.slideCount) };
    } else {
      const topicSpec = extractSlideCountSpec(topic);
      slideSpec = topicSpec || { exact: 8 };
    }

    // 从主题中提取用户显式的结构禁用指令（高优先级覆盖页数策略）
    const pageStructureHints = extractPageStructureHints(topic);

    // S5：检测 topic 中与高级选项冲突的描述（仅日志，不删除不修改）
    sanitizeTopicSettingsConflict(topic, {
      slideCount: slideSpec,
      colorTheme,
      style,
      imagePreference,
    });

    const primaryColor = getPrimaryColor(style, colorTheme, options?.primaryColor);
    const imageEnabled = options?.imageOptions?.enabled && imagePreference !== 'none';
    const backgroundEnabled = options?.backgroundEnabled || false;

    // S1：生成 referenceHtml 摘要（≤500 字符），两侧 prompt 都注入
    const referenceHtmlBrief =
      options?.referenceHtmlBrief || summarizeReferenceHtmlBrief(referenceHtml);
    const referenceVisualAttributes = options?.referenceVisualAttributes;

    const slideDesc =
      'exact' in slideSpec ? `${slideSpec.exact} 页` : `${slideSpec.min}-${slideSpec.max} 页`;
    console.log(
      `[${timestamp}] [AGENT] Params: style=${style}, density=${density}, imagePref=${imagePreference}, slides=${slideDesc} (slideSpec=${JSON.stringify(slideSpec)}), primaryColor=${primaryColor}, fontFamily=${fontFamily}, iconStyle=${iconStyle}, audience=${audience || '(empty)'}, colorTheme=${colorTheme || '(none)'}, refHtmlLen=${referenceHtml.length}, bg=${backgroundEnabled}`,
    );
    console.log(
      `[${timestamp}] [AGENT] Image generation: ${imageEnabled ? 'enabled' : 'disabled'}, Background: ${backgroundEnabled ? 'enabled' : 'disabled'}, pageHints=${JSON.stringify(pageStructureHints)}`,
    );
    if (imageEnabled && options?.imageOptions) {
      console.log(
        `[${timestamp}] [AGENT] Image model: ${options.imageOptions.model}, defaultSize: ${options.imageOptions.size}`,
      );
    }

    const onProgress = options?.onProgress;

    // 打开 trace session 以捕获 planning 阶段的 trace
    // 如果调用方（如服务端）已经在 provider 上设置了 activeTraceSessionId，则复用它，
    // 避免覆盖后导致调用方用旧 sessionId 取不到 traces。
    let traceSessionId = (deps.planningProvider as TraceableProvider).activeTraceSessionId;
    let ownTraceSession = false;
    if (!traceSessionId) {
      traceSessionId = `trace_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      openTraceSession(traceSessionId);
      (deps.planningProvider as TraceableProvider).activeTraceSessionId = traceSessionId;
      ownTraceSession = true;
    }
    // 每页重生成熔断计数在本次生成开始时清零，保证按次生成独立
    resetRetryCount(keyOf(traceSessionId));

    const plan = await generatePlan(deps, 
      topic,
      style,
      audience,
      slideSpec,
      density,
      imagePreference,
      primaryColor,
      onProgress,
      backgroundEnabled,
      pageStructureHints,
      iconStyle,
      fontFamily,
      colorTheme,
      referenceHtmlBrief,
      // generatePlan 内的 normalizePlanByImagePreference 需要判断开关是否开启
      // （注意：imageOptions.enabled 是布尔 + imagePreference !== 'none' 的逻辑组合在调用方已处理，
      //       这里只传 imageOptions.enabled 本身即可）
      options?.imageOptions?.enabled ?? false,
      referenceVisualAttributes,
      options?.referenceText || '',
    );
    timestamp = formatBeijingTime();
    console.log(
      `[${timestamp}] [AGENT] Plan generated: ${plan.slides.length} slides, title: "${plan.title}", primaryColor: ${plan.primaryColor}`,
    );

    try {
      return await generateFromPlan(deps, topic, plan, options, traceSessionId);
    } finally {
      if (ownTraceSession && traceSessionId) {
        closeTraceSession(traceSessionId);
      }
    }
  }

export async function generateFromPlan(deps: AgentDeps, topic: string, plan: PresentationPlan, options?: PresentationGenerationOptions, traceSessionId?: string): Promise<HTMLPresentation> {
    const style = options?.style || 'business';
    const density = options?.density || 'normal';
    // 归一化iconStyle：将旧值checkmark/minimal映射到bullet（向后兼容本地存储旧值）
    const rawIconStyle = (options?.iconStyle || 'auto') as string;
    const iconStyle: IconStyle =
      rawIconStyle === 'checkmark' || rawIconStyle === 'minimal'
        ? 'bullet'
        : (rawIconStyle as IconStyle);
    const fontFamily = options?.fontFamily || 'sans';
    const colorTheme = options?.colorTheme;

    const primaryColor = getPrimaryColor(style, colorTheme, options?.primaryColor);
    // 主色单源：planning LLM 可能返回"猜蓝"等任意合法 hex，这里强制以 theme/用户显式色为准，
    // 杜绝 plan.primaryColor 与 effective 主色不一致（曾导致 regenerate 通道整页变蓝）
    plan.primaryColor = primaryColor;

    const design: DesignProposal = {
      id: 'default',
      name: 'Default',
      description: '',
      primaryColor,
      colorTheme: colorTheme || undefined,
      fontFamily: fontFamily as 'sans' | 'serif' | 'mono',
      styleTheme: 'mixed',
      density: density as ContentDensity,
      iconStyle: iconStyle as IconStyle,
      coverHtml: '',
    };

    let ownTraceSession = false;
    if (!traceSessionId) {
      traceSessionId = `trace_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      openTraceSession(traceSessionId);
      ownTraceSession = true;
    }

    try {
      const rendered = await renderSlides(deps, topic, plan, design, options, traceSessionId);
      const assembled = await assembleImages(deps, 
        topic,
        rendered,
        plan,
        design,
        options,
        traceSessionId,
      );
      const presentation = await finalizePresentation(deps, 
        topic,
        assembled,
        plan,
        design,
        options,
        traceSessionId,
      );
      presentation.plan = plan;
      presentation.design = design;
      return presentation;
    } finally {
      if (ownTraceSession && traceSessionId) {
        closeTraceSession(traceSessionId);
      }
    }
  }

export async function generatePresentationFromReference(deps: AgentDeps, topic: string, _referenceHtml: string, options?: PresentationGenerationOptions): Promise<HTMLPresentation> {
    return generatePresentation(deps, topic, options);
  }
