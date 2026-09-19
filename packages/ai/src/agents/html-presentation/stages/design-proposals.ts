import type { AgentDeps } from './deps';
import { ColorTheme, DesignProposal, PresentationGenerationOptions, PresentationPlan, StyleTheme } from '../../../types';
import { renderSlides } from './render';
import { formatReferenceOverrideOverview, resolveDeckReferencePrimaryColor } from '../../../utils/reference-attribute-resolver';
import { closeTraceSession, openTraceSession } from '../../../utils/llm-tracer';
import { TraceableProvider, formatBeijingTime } from '../../../providers/base';
import { COLOR_THEMES, resolveProposalPrimaryColor } from '../shared';
import { switchStage } from './deps';
import { sanitizeSlideHtml } from '../html-sanitize';
export async function generateDesignProposals(deps: AgentDeps, topic: string, plan: PresentationPlan, options?: PresentationGenerationOptions, traceSessionId?: string): Promise<DesignProposal[]> {
    // === proposalCount 规范化（F-2 + C-1 约束）
    const rawCount: unknown = options?.proposalCount;
    const proposalCount = (() => {
      // 仅接受「正整数」才做规范化；NaN / 非整数（如 1.7）/ 负数 / 0 / 非 number 类型 → 默认 3
      if (typeof rawCount === 'number' && Number.isInteger(rawCount) && rawCount >= 1) {
        return Math.max(1, Math.min(20, rawCount));
      }
      return 3; // 默认或非法值
    })();
    console.log(`[DESIGN] proposalCount=${proposalCount} request=${JSON.stringify(rawCount)}`); // Spec C-3 字段可观察

    const style = options?.style || 'business';
    const audience = options?.audience || '';
    const userColorTheme = options?.colorTheme;
    const userPrimaryColor = options?.primaryColor;
    const userFontFamily = options?.fontFamily;
    const userIconStyle = options?.iconStyle;
    // FR-2.x：参考主色纳入提案单源链（参考 > 用户 > 默认蓝），与规划/renderSlides 一致（html-presentation-agent.ts:1894/2822）
    const refDeckPrimary = resolveDeckReferencePrimaryColor(options?.referenceVisualAttributes);

    let ownTraceSession = false;
    if (!traceSessionId) {
      traceSessionId = `trace_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      openTraceSession(traceSessionId);
      ownTraceSession = true;
    }
    (deps.planningProvider as TraceableProvider).activeTraceSessionId = traceSessionId;

    const resolveThemeColor = (): string =>
      resolveProposalPrimaryColor({
        referenceVisualAttributes: options?.referenceVisualAttributes,
        userColorTheme,
        userPrimaryColor,
      });

    // === 子项 D：style → styleTheme 映射函数
    const recommendStyleThemeByStyle = (s: string): StyleTheme[] => {
      switch (s) {
        case 'business':
        case 'formal':
          return ['glass', 'colored-cards', 'mixed'];
        case 'creative':
        case 'playful':
          return ['gradient', 'mixed', 'colored-cards'];
        case 'minimal':
        case 'minimalist':
          return ['none', 'mixed', 'badges'];
        case 'tech':
        case 'technology':
          return ['progress-bars', 'badges', 'mixed'];
        default:
          return ['mixed', 'gradient', 'glass'];
      }
    };

    const rawDensity = options?.density;
    const validDensity: 'compact' | 'normal' | 'spacious' | undefined =
      rawDensity === 'compact' || rawDensity === 'normal' || rawDensity === 'spacious'
        ? rawDensity
        : undefined;

    const validFontFamily: 'sans' | 'serif' | 'mono' | undefined =
      userFontFamily === 'sans' || userFontFamily === 'serif' || userFontFamily === 'mono'
        ? userFontFamily
        : undefined;

    const buildFallbackProposals = (): DesignProposal[] => {
      const baseColor = resolveThemeColor();
      const baseTheme = userColorTheme || 'blue';
      const styleThemes = recommendStyleThemeByStyle(style);
      const originalStyleThemes: StyleTheme[] = ['glass', 'gradient', 'none'];
      const originalDensities: ('compact' | 'normal' | 'spacious')[] = [
        'normal',
        'normal',
        'spacious',
      ];
      const originalFonts: ('sans' | 'serif' | 'mono')[] = ['sans', 'sans', 'sans'];
      const originalIcons: Array<
        'auto' | 'line' | 'filled' | 'numbered' | 'bullet' | 'lettered' | 'emoji' | 'none'
      > = ['line', 'filled', 'none'];
      return ([0, 1, 2] as const).map((idx) => ({
        id: `proposal-${idx + 1}`,
        name: idx === 0 ? '专业稳重' : idx === 1 ? '现代活力' : '极简克制',
        description:
          idx === 0
            ? '毛玻璃质感搭配主色，专业大气'
            : idx === 1
              ? '渐变与卡片层次，现代动感'
              : '大量留白与细线分隔，简约克制',
        primaryColor: baseColor,
        colorTheme: baseTheme,
        fontFamily: validFontFamily || originalFonts[idx],
        styleTheme: styleThemes[idx] || styleThemes[0] || originalStyleThemes[idx],
        density: validDensity || originalDensities[idx],
        iconStyle: userIconStyle || originalIcons[idx],
        coverHtml: '',
      })) as DesignProposal[];
    };

    const fallbackProposals = buildFallbackProposals().slice(0, proposalCount);

    try {
      const slideSummary = plan.slides
        .map((s, i) => `${i + 1}. [${s.pageType}] ${s.title}`)
        .join('\n');

      const countOnly1 = proposalCount === 1;

      const colorConstraint =
        userColorTheme || userPrimaryColor
          ? countOnly1
            ? `\n用户已指定配色主题：${userColorTheme || '自定义'}（主色：${resolveThemeColor()}）。\n重要约束：1 个方案的 colorTheme 必须为 "${userColorTheme || 'blue'}"，primaryColor 必须使用 "${resolveThemeColor()}"。\n该方案仅需在 styleTheme / name / description 维度体现创意（若用户未显式指定 styleTheme / density / iconStyle / fontFamily，可自由体现）。\n另外：用户已显式指定 fontFamily=${validFontFamily || '由你决定'}、iconStyle=${userIconStyle || '由你决定'}。若用户已显式指定，对应维度你无权改动。`
            : `\n用户已指定配色主题：${userColorTheme || '自定义'}（主色：${resolveThemeColor()}）。\n重要约束：3 个方案的 colorTheme 必须为 "${userColorTheme || 'blue'}"，primaryColor 必须使用 "${resolveThemeColor()}"。\n方案之间的差异应通过 styleTheme、density、iconStyle 等维度体现，而非切换色相。\n另外：用户已显式指定 fontFamily=${validFontFamily || '由你决定'}、iconStyle=${userIconStyle || '由你决定'}。若用户已显式指定，对应维度你无权改动，只能在 styleTheme / density / name / description 维度差异化。`
          : '';
      // === 子项 A：countOnly1 的 head 动态化（按 style / density / fontFamily / iconStyle）
      const styleDescription = ((): string => {
        switch (style) {
          case 'creative':
          case 'playful':
            return '活泼创意和谐';
          case 'business':
          case 'formal':
            return '专业稳健大气';
          case 'minimal':
          case 'minimalist':
            return '简约克制留白充足';
          case 'tech':
          case 'technology':
            return '科技感信息密度高';
          default:
            return '专业美观大气';
        }
      })();
      const countOnly1HeadLines: string[] = [
        `基于以下演示文稿主题和幻灯片规划，提出 1 个正式视觉设计方向。`,
        '',
        styleDescription + '。',
      ];
      if (validDensity) {
        countOnly1HeadLines.push(
          `密度：用户已显式指定 density=${validDensity}，必须使用该值，不得切换。`,
        );
      }
      if (validFontFamily) {
        countOnly1HeadLines.push(
          `字体族：用户已显式指定 fontFamily=${validFontFamily}，方案中必须使用该值。`,
        );
      }
      if (userIconStyle) {
        countOnly1HeadLines.push(
          `图标风格：用户已显式指定 iconStyle=${userIconStyle}，方案中必须使用该值，不得建议其他值。`,
        );
      }
      countOnly1HeadLines.push(
        `风格主题 styleTheme：建议从以下子集中自由选择：[${recommendStyleThemeByStyle(style).join(' / ')}]。无需与其他方案比较。`,
      );
      const head = countOnly1
        ? countOnly1HeadLines.join('\n')
        : `基于以下演示文稿主题和幻灯片规划，提出 3 个视觉上差异明显的设计方向。`;
      const idConstraint = countOnly1
        ? `- id: 固定写 "proposal-1"`
        : `- id: "proposal-1" / "proposal-2" / "proposal-3"`;
      const returnIntro = countOnly1
        ? `请返回 1 个设计方案，每个方案包含：`
        : `请返回 3 个设计方案，每个方案包含：`;
      const countOnly1HasUserConstraints = Boolean(
        validFontFamily || userIconStyle || validDensity,
      );
      const countOnly1TailLines: string[] = [];
      if (countOnly1HasUserConstraints) {
        countOnly1TailLines.push('请严格遵守上方列出的所有"用户已显式指定"的维度。');
      }
      countOnly1TailLines.push(
        '只返回长度为 1 的 JSON 数组，不要任何其他文字或 Markdown 代码块标记。',
      );
      const tail = countOnly1
        ? countOnly1TailLines.join('\n')
        : `要求 3 个方案视觉上明显区分（通过风格质感、密度、图标风格等维度变化）。\n只返回 JSON 数组，不要任何其他文字或 Markdown 代码块标记。`;

      const categoryReferenceSummary = options?.referenceVisualAttributes
        ? '【参考文件提取属性 · 绝对最高优先级 · 覆盖用户显式参数】\n' +
          formatReferenceOverrideOverview(options.referenceVisualAttributes)
        : '';
      // 参考主色硬约束（优先级高于用户 colorTheme=blue）：确保 LLM 不会在「用户蓝」与「参考红」间选错
      const referencePrimaryConstraint = refDeckPrimary
        ? `\n【参考文件主色 · 绝对最高优先级】已解析到参考文件主色 ${refDeckPrimary}，该色优先级高于用户配色主题（含 blue），所有方案的 primaryColor 必须使用 "${refDeckPrimary}"。`
        : '';

      const prompt = `${head}

主题：${topic}
受众：${audience || '通用'}
风格：${style}
${colorConstraint}
${referencePrimaryConstraint}
${categoryReferenceSummary}
幻灯片规划：
${slideSummary}

${returnIntro}
${idConstraint}
- name: 中文名称
- description: 中文一句话描述
- primaryColor: HEX 主色（如 #2563eb）
- colorTheme: 配色主题，取值之一：blue / purple / green / orange / teal / gray
- fontFamily: 字体族，取值之一：sans / serif / mono
- styleTheme: 风格主题，取值之一：none / glass / gradient / progress-bars / badges / colored-cards / mixed
- density: 内容密度，取值之一：compact / normal / spacious
- iconStyle: 图标风格，取值之一：auto / line / filled / numbered / bullet / lettered / emoji / none
  - 选择原则：B端/技术/正式场景优先 line（线性描边）；封面/重点/创意/渐变风格优先 filled（面性填充）；
    步骤流程用 numbered；分类维度用 lettered；特性优势用 bullet；内部轻松/C端可用 emoji；正式商务汇报禁止 emoji。

${tail}`;

      let proposals: DesignProposal[] = fallbackProposals;
      let lastProposalErr: unknown;
      const PROPOSAL_MAX_RETRIES = 2;
      // 补遗1：LLM 调用（网络抖动 / 单侧超时 / 偶发返回非合法数组）先有限重试（默认 2 次），
      // 全部失败再回落 fallbackProposals，避免「一次出错直接降级」摧毁整轮方案多样性。
      for (let proposalAttempt = 0; proposalAttempt <= PROPOSAL_MAX_RETRIES; proposalAttempt++) {
        try {
          switchStage(deps.planningProvider, 'design-proposals');
          const response = await deps.planningProvider.chat([{ role: 'user', content: prompt }], {
            temperature: 0.5,
            maxTokens: 8192,
          });
          const raw = response.content || '';
          const arrayMatch = raw.match(/\[[\s\S]*\]/);
          if (arrayMatch) {
            let parsed = JSON.parse(arrayMatch[0]);
            if (Array.isArray(parsed) && parsed.length > 0) {
              parsed = parsed.slice(0, proposalCount);
              // T20 · G0-U-17b：3 套方案主色/配色主题必须统一到用户选择（若显式给了）。
              // 单源顺序：userPrimaryColor(合法) > COLOR_THEMES[userColorTheme] > fallbackProposal.baseColor
              const enforcedTheme: ColorTheme | undefined =
                userColorTheme && COLOR_THEMES[userColorTheme] ? userColorTheme : undefined;
              const unifiedColor: string = resolveProposalPrimaryColor({
                referenceVisualAttributes: options?.referenceVisualAttributes,
                userColorTheme,
                userPrimaryColor,
              });
              const proposalsBefore = parsed.map((p: any) => ({
                id: p.id,
                primaryColor: p.primaryColor,
                colorTheme: p.colorTheme,
              }));
              proposals = parsed.map((p: any, idx: number) => {
                const fb = fallbackProposals[idx] || fallbackProposals[0];
                return {
                  id: p.id || `proposal-${idx + 1}`,
                  name: String(p.name || fb.name || `方案 ${idx + 1}`),
                  description: String(p.description || ''),
                  primaryColor: unifiedColor, // 三套统一（即便 LLM 写了不同的也强制覆盖）
                  colorTheme:
                    enforcedTheme ||
                    (COLOR_THEMES[p.colorTheme as ColorTheme]
                      ? p.colorTheme
                      : fb.colorTheme || 'blue'),
                  fontFamily:
                    userFontFamily ||
                    (p.fontFamily === 'serif' || p.fontFamily === 'mono' ? p.fontFamily : 'sans'),
                  styleTheme: p.styleTheme || 'mixed',
                  density:
                    p.density === 'compact' || p.density === 'spacious' ? p.density : 'normal',
                  iconStyle: userIconStyle || p.iconStyle || 'auto',
                  coverHtml: '',
                };
              });
              const proposalsAfter = proposals.map((p) => ({
                id: p.id,
                primaryColor: p.primaryColor,
                colorTheme: p.colorTheme,
              }));
              console.log(
                `[DESIGN] proposals 主色统一：LLM 返回=${JSON.stringify(proposalsBefore)}，强制统一后=${JSON.stringify(proposalsAfter)}（unifiedColor=${unifiedColor} enforcedTheme=${enforcedTheme || '(none)'} refDeckPrimary=${refDeckPrimary || '(none)'}${refDeckPrimary ? ' reference-first' : ''}）`,
              );
              break; // 解析成功，跳出重试循环
            }
          }
          // 到达此处说明 LLM 返回了但无合法提案数组：计入错误并触发重试（最后一次则回落兜底）
          lastProposalErr = new Error('LLM 未返回合法提案数组');
          if (proposalAttempt < PROPOSAL_MAX_RETRIES) {
            console.warn(
              `[RETRY] generateDesignProposals 解析为空（attempt ${proposalAttempt + 1}/${PROPOSAL_MAX_RETRIES + 1}），重试...`,
            );
            continue;
          }
        } catch (parseErr) {
          lastProposalErr = parseErr;
          if (proposalAttempt < PROPOSAL_MAX_RETRIES) {
            console.warn(
              `[RETRY] generateDesignProposals 失败（attempt ${proposalAttempt + 1}/${PROPOSAL_MAX_RETRIES + 1}），重试...`,
              parseErr,
            );
            continue;
          }
          console.warn(
            `[${formatBeijingTime()}] [AGENT] generateDesignProposals 重试耗尽，使用兜底:`,
            parseErr,
          );
        }
      }
      if (lastProposalErr) {
        proposals = fallbackProposals;
      }

      const referenceHtml = options?.referenceHtml || '';
      const backgroundEnabled = options?.backgroundEnabled || false;
      const imagePreference = options?.imagePreference || 'content-only';
      const slideWidth = options?.slideWidth || 1280;
      const slideHeight = options?.slideHeight || 720;

      if (plan.slides.length === 0) return proposals;

      const renderOptionsBase: PresentationGenerationOptions = {
        ...options,
        style,
        audience,
        imagePreference,
        backgroundEnabled,
        referenceHtml,
        slideWidth,
        slideHeight,
        startIndex: 0,
        endIndex: 1,
        imageProvider: undefined,
        imageOptions: undefined,
      };

      const renderedProposals = await Promise.all(
        proposals.map(async (proposal) => {
          const renderOptions: PresentationGenerationOptions = {
            ...renderOptionsBase,
            density: proposal.density,
            colorTheme: proposal.colorTheme,
            primaryColor: proposal.primaryColor,
            fontFamily: proposal.fontFamily,
            iconStyle: proposal.iconStyle,
          };
          try {
            const firstSlideArr = await renderSlides(deps, 
              topic,
              plan,
              proposal,
              renderOptions,
              traceSessionId,
            );
            const firstSlide = firstSlideArr[0];
            if (firstSlide) {
              proposal.coverHtml = sanitizeSlideHtml(firstSlide.html);
              proposal.slides = [firstSlide];
            } else {
              proposal.coverHtml = '';
              proposal.slides = [];
            }
          } catch (renderErr) {
            console.warn(
              `[${formatBeijingTime()}] [AGENT] generateDesignProposals first-slide render failed for ${proposal.id}:`,
              renderErr,
            );
            proposal.coverHtml = '';
            proposal.slides = [];
          }
          return proposal;
        }),
      );

      for (const p of renderedProposals) {
        console.log(
          `[DESIGN] proposal ${p.id}: primary=${p.primaryColor} theme=${p.colorTheme} font=${p.fontFamily} icon=${p.iconStyle} styleTheme=${p.styleTheme}`,
        );
      }

      return renderedProposals;
    } finally {
      if (ownTraceSession && traceSessionId) {
        closeTraceSession(traceSessionId);
      }
    }
  }
