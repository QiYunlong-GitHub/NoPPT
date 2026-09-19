import type {
  ColorTheme,
  ContentDensity,
  ImagePreference,
  IconStyle,
  SlidePlan,
  ReferenceVisualAttributes,
} from '../../types';
import type { SlideCountSpec, PageStructureHints } from './shared';
import {
  PRESENTATION_PLANNING_PROMPT,
  SLIDE_HTML_GENERATION_PROMPT,
  BACKGROUND_PLANNING_GUIDANCE,
  getPageTemplatesByPageType,
} from '../../templates/generate-html-presentation';
import { extractReferenceHtmlAttributes } from '../../utils/reference-html-extractor';
import { pageTypeToCategory, resolveAttrForPage } from '../../utils/reference-attribute-resolver';
import { isStructurePage } from '../../utils/image-plan-guard';
import { formatBeijingTime } from '../../providers/base';
import {
  COLOR_THEMES,
  getFontFamilyDescription,
  IMAGE_PLACEHOLDER,
  PAGE_TYPE_DEFAULT_IMAGE_RATIO,
} from './shared';

/**
 * 构建幻灯片数量（slideCount）的指导语与展示文案。
 * 原函数：HTMLPresentationAgent.buildSlideCountGuidance（纯函数，无 this 依赖）
 */
export function buildSlideCountGuidance(
  spec:
    | SlideCountSpec
    | { exact: number; min?: undefined; max?: undefined }
    | { min: number; max: number; exact?: undefined },
): { guidance: string; displayText: string; planningTotal: number } {
  if ('exact' in spec && spec.exact != null) {
    const n = spec.exact;
    return {
      guidance: `1. **幻灯片数量（最高优先级）**：严格遵守用户指定的页数，**必须 ${n} 页**，不要多也不要少。\n页数要求：${n} 页。`,
      displayText: `${n} 页`,
      planningTotal: n,
    };
  }
  const min = (spec as any).min as number;
  const max = (spec as any).max as number;
  return {
    guidance: `1. **幻灯片数量（最高优先级）**：页数必须在 **${min} ~ ${max} 页之间**（含 ${min} 和 ${max}，${min} ≤ 实际页数 ≤ ${max}）。你自行根据主题的复杂度、要点多少，在范围内**选择最合适的页数**。不要超出边界。\n页数要求：${min} ~ ${max} 页，AI 按复杂度自决定。`,
    displayText: `${min} ~ ${max} 页`,
    planningTotal: max,
  };
}

/**
 * 构建用户显式结构指令的提示词追加内容（为空则返回空串）
 * 原函数：HTMLPresentationAgent.buildStructureOverridePrompt（纯函数，无 this 依赖）
 */
export function buildStructureOverridePrompt(hints: PageStructureHints): string {
  const parts: string[] = [];
  if (hints.contentOnly) {
    parts.push(
      '**用户显式要求：全部幻灯片只生成内容页，封面、目录、总结（结束页）一律不要！无论上面规则怎么写，都必须全部是内容页！**',
    );
  } else {
    if (hints.disableCover) parts.push('- **不要封面页**：第一页不要封面，直接从内容/目录页开始');
    if (hints.disableToc) parts.push('- **不要目录页**：无论多少页都不要目录');
    if (hints.disableConclusion)
      parts.push('- **不要总结/结束页**：最后一页不要总结、致谢、结语、结束之类页面');
  }
  if (parts.length === 0) return '';
  return `\n\n【用户结构指令 · 绝对最高优先级，覆盖所有规则】\n${parts.join('\n')}\n【以上结构指令必须严格遵守，不可忽略】\n`;
}

/**
 * S1 · summarizeReferenceHtmlBrief：抽取参考 HTML 的排版风格摘要（token 安全：≤200 字）
 * 原函数：HTMLPresentationAgent.summarizeReferenceHtmlBrief（纯函数，无 this 依赖）
 */
export function summarizeReferenceHtmlBrief(referenceHtml: string): string {
  if (!referenceHtml) return '';
  // Task 2：改为调用独立 extractor（JSDOM 全文解析），返回 FR-5 优先级声明 + 要点
  const ref = extractReferenceHtmlAttributes(referenceHtml);
  return ref.briefText || '';
}

/**
 * S5 · sanitizeTopicSettingsConflict：检测 topic 中与高级选项参数矛盾的描述，
 * 仅检测+日志，不做删除/改写（防止破坏用户风格意图）。
 * 原函数：HTMLPresentationAgent.sanitizeTopicSettingsConflict（纯函数，无 this 依赖）
 */
export function sanitizeTopicSettingsConflict(
  topic: string,
  params: {
    slideCount?: SlideCountSpec;
    colorTheme?: ColorTheme;
    style?: string;
    imagePreference?: ImagePreference;
  },
): void {
  if (!topic) return;
  const warnings: string[] = [];
  // 1) 页数冲突：
  const countMatch = topic.match(/(\d+)\s*页/);
  if (countMatch && params.slideCount) {
    const topicCount = parseInt(countMatch[1], 10);
    const exactN = 'exact' in params.slideCount ? params.slideCount.exact : null;
    if (exactN != null && exactN !== topicCount) {
      warnings.push(
        `主题中写了"${topicCount} 页"，但用户高级选项选了 ${exactN} 页（高级选项优先级更高）`,
      );
    }
  }
  // 2) 颜色冲突：
  const colorKeywords: Record<string, ColorTheme> = {
    蓝: 'blue',
    紫: 'purple',
    绿: 'green',
    橙: 'orange',
    青: 'teal',
    灰: 'gray',
  };
  for (const [k, v] of Object.entries(colorKeywords)) {
    if (
      new RegExp(k + '(色|主题|风格系)').test(topic) &&
      params.colorTheme &&
      params.colorTheme !== v
    ) {
      warnings.push(
        `主题中提到"${k}色"，但用户高级选项配色主题为 ${params.colorTheme}（高级选项优先级更高）`,
      );
      break;
    }
  }
  // 3) 风格冲突：
  if (params.style && params.style !== 'business') {
    const styleHints: Record<string, string> = {
      商务: 'business',
      创意: 'creative',
      简约: 'simple',
    };
    for (const [k, v] of Object.entries(styleHints)) {
      if (topic.includes(k) && params.style !== v) {
        warnings.push(
          `主题中写了"${k}风格"，但用户高级选项风格是 ${params.style}（高级选项优先级更高）`,
        );
        break;
      }
    }
  }
  if (warnings.length > 0) {
    console.warn(
      `[${formatBeijingTime()}] [AGENT] sanitizeTopicSettingsConflict (仅检测，不修改):\n  - ${warnings.join('\n  - ')}`,
    );
  }
}

/**
 * S5 · buildUserSettingsPriorityOverridePrompt：输出「用户显式参数 · 高优先级（低于参考提取属性）」大段红线
 * 原函数：HTMLPresentationAgent.buildUserSettingsPriorityOverridePrompt（纯函数，无 this 依赖）
 */
export function buildUserSettingsPriorityOverridePrompt(params: {
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
  const densityText: Record<ContentDensity, string> = {
    compact: '紧凑（每页信息量大，字号较小）',
    normal: '适中（平衡信息量和可读性）',
    spacious: '宽松（留白充足，字号较大，重点突出）',
  };
  const imagePrefText: Record<ImagePreference, string> = {
    all: '每页都配图（封面/目录/总结除外）',
    'content-only': '仅内容页配图，封面/目录/总结不放图（推荐）',
    minimal: '尽量少配图，主要使用文字和卡片',
    none: '不生成任何图片，纯文字/卡片布局',
  };
  const colorThemeText: Record<ColorTheme, string> = {
    blue: '蓝色商务（专业稳重）',
    purple: '紫色创意（个性活泼）',
    green: '绿色环保（清新自然）',
    orange: '橙色活力（醒目热情）',
    teal: '青色科技（科技感强）',
    gray: '极简灰度（低调克制）',
  };
  const iconStyleText: Record<IconStyle, string> = {
    auto: '智能匹配（默认使用线性SVG描边图标，简约专业，适合B端/技术/正式场景；根据语义从内置图标库选择匹配图标）',
    line: '线性SVG描边图标（Lucide风格，简约理性、专业冷静，主色描边+浅色圆角底，适合B端产品、技术PPT、研发平台、多图标并列场景）',
    filled:
      '面性SVG填充图标（实心色块，视觉权重高、醒目有力，白色图标+渐变实心底，适合封面、核心结论、大屏展示、重点模块）',
    numbered: '数字序号（渐变圆角方形/圆形 + 白色数字 1/2/3/4，适合步骤/流程/阶段类要点）',
    bullet:
      '对勾/圆点（简洁符号类：主色渐变圆形+白色对勾SVG，或主色10px小圆点，适合特性/优势/功能列表）',
    lettered: '字母分类（渐变圆形 + 白色字母 A/B/C/D…，适合分类/维度/类型类要点）',
    emoji:
      'Emoji风格（仅适合内部轻松沟通/C端/年轻群体内容；B端技术方案、正式汇报、商务宣讲禁止使用emoji，应改用line线性图标）',
    none: '无图标，纯文字列表',
  };
  const slideCountText =
    'exact' in params.slideCount
      ? `严格 ${params.slideCount.exact} 页（不要多也不要少）`
      : `${params.slideCount.min} ~ ${params.slideCount.max} 页之间（自行按复杂度决定）`;
  let colorThemeLine: string;
  // FR-2.x：若「参考文件提取属性」提供了主色，则该参考主色为绝对最高优先级，
  // 本配色主题的 hex 硬约束须让位（消除「参考最高优先级」与「#2563eb 绝对不可改」的提示词自相矛盾）。
  const refPrimaryNote = params.referencePrimaryColor
    ? `（⚠️ 但「参考文件提取属性」已提供主色 ${params.referencePrimaryColor}，该参考主色为绝对最高优先级（参考 > 用户显式 > 主题自然语言 > 默认），本配色主题的 hex 约束须让位于参考色，禁止再以本主题 hex 为唯一合法值）`
    : '';
  if (params.colorTheme && COLOR_THEMES[params.colorTheme]) {
    const expectedPrimary = COLOR_THEMES[params.colorTheme];
    if (params.referencePrimaryColor) {
      colorThemeLine = `${colorThemeText[params.colorTheme]}（默认/兜底色系为 ${expectedPrimary}）${refPrimaryNote}`;
    } else {
      colorThemeLine = `${colorThemeText[params.colorTheme]}（⚠️ primaryColor 固定为 ${expectedPrimary}，绝对不可改；示例 JSON 输出必须填入此 hex；任何渐变/描边/阴影都只能在该色系内做明暗变化，禁止引入其他色系）`;
    }
  } else {
    // colorTheme 为「自动」：按 style 计算自动匹配到的具体 hex（business→蓝 / creative→紫 / simple→灰 / academic→青），
    // 仍然以强约束形式写死，不给 LLM 自行猜色的空间，避免 auto 场景下出现深紫/深青/蓝色混乱。
    const autoPrimary = COLOR_THEMES[params.style] || '#2563eb';
    const styleDesc: Record<string, string> = {
      business: '商务蓝（匹配商务风，专业稳重）',
      creative: '创意紫（匹配创意风，个性活泼）',
      simple: '极简灰（匹配简约风，低调克制）',
      academic: '学术青（匹配学术风，理性沉稳）',
    };
    const desc = styleDesc[params.style] || '系统默认蓝（专业稳重）';
    if (params.referencePrimaryColor) {
      colorThemeLine = `${desc}（默认/兜底色系为 ${autoPrimary}）${refPrimaryNote}`;
    } else {
      colorThemeLine = `${desc}（⚠️ 本次自动匹配 primaryColor=${autoPrimary}，你必须在 JSON 输出中原样填入该 hex，绝对不可自作主张换别的色；任何渐变/描边/阴影都只能在该色系内做明暗变化，禁止引入其他色系）`;
    }
  }
  const lines: string[] = [
    '【用户显式参数 · 高优先级（仅低于参考文件提取属性） · 覆盖主题自然语言】',
    '本红线优先级 > 主题自然语言描述中的对应数量/颜色/风格词汇（即用户显式参数高于主题自然语言）；但若「参考文件提取属性」已指定同一维度，则以参考为准（优先级：参考 > 用户显式 > 主题自然语言 > 默认）。',
    '如果下列参数与上方「用户显式指令 / 主题描述 / 图文搭配覆盖规则 / 示例 imagePrompt」中的自然语言词汇冲突（例如主题里写了"10页蓝色商务风"，但下面参数写了页数=8 / 配色=紫色），以用户显式参数为准；但若与「参考文件提取属性」冲突，仍以参考为准。',
    '',
    `  · 幻灯片数量（最高优先级）：${slideCountText}`,
    `  · 风格：${params.style}`,
    `  · 内容密度：${densityText[params.density]}`,
    `  · 配图偏好：${imagePrefText[params.imagePreference]}`,
    `  · 配色主题：${colorThemeLine}`,
    `  · 列表图标风格：${iconStyleText[params.iconStyle]}`,
    `  · 字体：${getFontFamilyDescription(params.fontFamily)}`,
    `  · 自动背景图：${params.backgroundEnabled ? '开启（封面/目录/内容/总结各生成一张统一风格的背景大图）' : '关闭（纯色/浅色背景，不生成额外背景图片）'}`,
    `  · 目标受众：${params.audience || '通用商务受众'}`,
    '',
    '【以上 9 项显式参数必须严格遵守，不可被主题中的自然语言描述覆盖；但若与「参考文件提取属性」冲突，以参考为准（参考 > 用户显式 > 主题自然语言 > 默认）】',
  ];
  return '\n\n' + lines.join('\n') + '\n';
}

/**
 * 构造「权威素材」提示段（M8）。
 * 无素材时返回空串——保证既有无素材生成链路的 prompt 与改造前**逐字一致**（NFR-5 回归红线）。
 * 原函数：HTMLPresentationAgent.buildReferenceTextBrief（纯函数，无 this 依赖）
 */
export function buildReferenceTextBrief(referenceText: string): string {
  const text = (referenceText || '').trim();
  if (!text) return '';
  return [
    '【权威素材 · 必须严格遵守】',
    '以下素材由调用方（RAG：知识库检索 / 文件解析 / 联网搜索）整理后提供，是本次演示事实内容的唯一权威来源。',
    '硬约束：',
    '1. 大纲与每页要点必须源自下列素材；禁止引入素材之外的具体事实、数字、时间、人名、机构名。',
    '2. 素材未覆盖的部分可用通用表述补充，但**不得编造**任何具体数据或结论。',
    '3. 素材与主题不完全匹配时，只选取与主题相关的片段，并据此组织页序。',
    '4. 素材中的关键数字/结论应原样保留，便于溯源。',
    '',
    '<<<REFERENCE_TEXT_BEGIN>>>',
    text,
    '<<<REFERENCE_TEXT_END>>>',
  ].join('\n');
}

/**
 * 由参考视觉属性解析本页的参考标题色/正文色（跟随参考 > 用户 > 默认三级链）。
 * 原函数：HTMLPresentationAgent.resolveReferenceTextColors（纯函数，无 this 依赖）
 */
export function resolveReferenceTextColors(
  refAttrs?: ReferenceVisualAttributes,
  pageType?: string,
): { titleColor?: string; bodyColor?: string } {
  if (!refAttrs) return { titleColor: undefined, bodyColor: undefined };
  const cat = pageTypeToCategory(pageType ?? '');
  const titleColor = resolveAttrForPage('titleColor', refAttrs, cat, undefined) as
    | string
    | undefined;
  const bodyColor = resolveAttrForPage('bodyColor', refAttrs, cat, undefined) as
    | string
    | undefined;
  return { titleColor, bodyColor };
}

/**
 * 配图指令（S-6 · 硬约束版）。
 * 原函数：HTMLPresentationAgent.buildImageRequirementHint（纯函数，无 this 依赖）
 */
export function buildImageRequirementHint(plan: SlidePlan, imagePreference: ImagePreference): string {
  const prefText: Record<ImagePreference, string> = {
    all: '每页都配图（封面/目录/总结除外）',
    'content-only': '仅内容页配图，封面/目录/总结不放图',
    minimal: '尽量少配图，主要使用文字和卡片',
    none: '不生成任何图片，纯文字/卡片布局',
  };
  const head = `【配图偏好（S-6）】：${prefText[imagePreference]}。`;
  if (isStructurePage(plan.pageType)) {
    return (
      `${head}【本页硬约束 · pageType=${plan.pageType}】本页是封面/目录/总结页：` +
      `**绝对禁止出现任何 <img> 标签（包括 src="${IMAGE_PLACEHOLDER}" 占位符）** —— ` +
      `一律用纯色/渐变背景 + 几何装饰 + 文字排版实现；下方「图片规范红线」对本页不适用。`
    );
  }
  if (plan.needsImage) {
    return (
      `${head}【本页硬约束 · pageType=${plan.pageType}】本页 needsImage=true：` +
      `必须出现且只出现 1 处 <img> 占位符，src 精确为 "${IMAGE_PLACEHOLDER}"，并带 data-image-ratio。`
    );
  }
  return (
    `${head}【本页硬约束 · pageType=${plan.pageType}】本页 needsImage=false：` +
    `**禁止插入任何 <img>（含占位符）**，用纯文字/卡片/图标布局。`
  );
}

/**
 * 由 primaryColor（主色 hex）推导出「同色系浅一档 PRIMARY_COLOR_LIGHTER」，
 * 用于 3 段式进度条渐变首段（0%~45% 过渡起点）。
 * 原函数：HTMLPresentationAgent 模块级 derivePrimaryColorLighter（纯函数）
 */
export function derivePrimaryColorLighter(primaryHex: string): string {
  const c = primaryHex.trim().toLowerCase().replace(/^#/, '');
  const hex =
    c.length === 3
      ? c
          .split('')
          .map((x) => x + x)
          .join('')
      : c;
  // 已知色表：primary(500/600) → lighter(-300/-400)，与之前 #3b82f6→#60a5fa (blue-500→blue-400) 一致的档级差
  const known: Record<string, string> = {
    // 蓝系（历史默认）
    '3b82f6': '60a5fa',
    '2563eb': '60a5fa',
    '1d4ed8': '3b82f6',
    // 绿系
    '10b981': '6ee7b7',
    '059669': '34d399',
    '047857': '10b981',
    // 橙系
    f97316: 'fdba74',
    ea580c: 'fb923c',
    c2410c: 'f97316',
    // 紫系（violet）
    '8b5cf6': 'c4b5fd',
    '7c3aed': 'a78bfa',
    '6d28d9': '8b5cf6',
    // 青系（cyan）
    '06b6d4': '67e8f9',
    '0891b2': '22d3ee',
    '0e7490': '06b6d4',
    // 靛系（indigo）
    '6366f1': 'a5b4fc',
    '4f46e5': '818cf8',
    '4338ca': '6366f1',
    // 玫红系（pink）
    ec4899: 'f9a8d4',
    db2777: 'f472b6',
    be185d: 'ec4899',
    // 红系
    ef4444: 'fca5a5',
    dc2626: 'f87171',
    b91c1c: 'ef4444',
    // 黄系
    eab308: 'fde047',
    ca8a04: 'facc15',
    a16207: 'eab308',
    // 灰系
    '6b7280': 'd1d5db',
    '4b5563': '9ca3af',
    '374151': '6b7280',
  };
  if (hex in known) return '#' + known[hex];
  if (!/^[0-9a-f]{6}$/.test(hex)) return '#60a5fa'; // 完全非法 hex → 兜底浅蓝
  // 兜底：RGB 线性与白色 40% 混合（向 255 靠 40%）
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const mix = (v: number) => Math.round(v + (255 - v) * 0.4);
  const to2 = (v: number) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0');
  return '#' + to2(mix(r)) + to2(mix(g)) + to2(mix(b));
}

/**
 * 构建规划阶段（planning）的 system prompt。
 * 原函数：HTMLPresentationAgent.buildPlanningPrompt（this 依赖仅 language，已参数化为 language）
 */
export function buildPlanningPrompt(
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
  language: 'zh' | 'en' = 'zh',
): string {
  const densityText: Record<ContentDensity, string> = {
    compact: '紧凑（每页信息量大，字号较小）',
    normal: '适中（平衡信息量和可读性）',
    spacious: '宽松（留白充足，字号较大，重点突出）',
  };
  const imagePrefText: Record<ImagePreference, string> = {
    all: '每页都配图（封面/目录/总结除外）',
    'content-only': '仅内容页配图，封面/目录/总结不放图（推荐）',
    minimal: '尽量少配图，主要使用文字和卡片',
    none: '不生成任何图片，纯文字/卡片布局',
  };
  const colorThemeText: Record<ColorTheme, string> = {
    blue: '蓝色商务（专业稳重）',
    purple: '紫色创意（个性活泼）',
    green: '绿色环保（清新自然）',
    orange: '橙色活力（醒目热情）',
    teal: '青色科技（科技感强）',
    gray: '极简灰度（低调克制）',
  };
  const iconStyleText: Record<IconStyle, string> = {
    auto: '智能匹配（默认使用线性SVG描边图标，简约专业，适合B端/技术/正式场景；根据语义从内置图标库选择匹配图标）',
    line: '线性SVG描边图标（Lucide风格，简约理性、专业冷静，主色描边+浅色圆角底，适合B端产品、技术PPT、研发平台、多图标并列场景）',
    filled:
      '面性SVG填充图标（实心色块，视觉权重高、醒目有力，白色图标+渐变实心底，适合封面、核心结论、大屏展示、重点模块）',
    numbered: '数字序号（渐变圆角方形/圆形 + 白色数字 1/2/3/4，适合步骤/流程/阶段类要点）',
    bullet:
      '对勾/圆点（简洁符号类：主色渐变圆形+白色对勾SVG，或主色10px小圆点，适合特性/优势/功能列表）',
    lettered: '字母分类（渐变圆形 + 白色字母 A/B/C/D…，适合分类/维度/类型类要点）',
    emoji:
      'Emoji风格（仅适合内部轻松沟通/C端/年轻群体内容；B端技术方案、正式汇报、商务宣讲禁止使用emoji，应改用line线性图标）',
    none: '无图标，纯文字列表',
  };
  const { guidance } = buildSlideCountGuidance(slideSpec);
  const structureOverride = buildStructureOverridePrompt(pageHints);
  // U-17-L：若调用方已传入 effectivePrimaryColor（即 U-17 公式计算结果），
  // 则直接使用它；否则退化至旧公式（保持向后兼容）。这保证 system prompt 里的
  // 示例 primaryColor / 配色主题强约束文案 与 user message 中主色完全一致。
  const expectedPrimaryHex = (() => {
    if (effectivePrimaryColor && /^#[0-9a-fA-F]{6}$/.test(effectivePrimaryColor)) {
      return effectivePrimaryColor;
    }
    return colorTheme && COLOR_THEMES[colorTheme] ? COLOR_THEMES[colorTheme] : '#2563eb';
  })();
  const colorThemeHint = colorTheme
    ? `【配色主题】\n配色主题（S-4 · 显式传递）：${colorThemeText[colorTheme]}。⚠️ primaryColor 必须精确填入 ${expectedPrimaryHex}（这是你输出 JSON 时的唯一合法值，绝对不可自己猜别的 hex）。imagePrompt 中生成的色调、整套 slides 的视觉气质，都要与该色系完全一致，禁止引入蓝/紫/绿等其他色系主强调色。`
    : '【配色主题】：未显式设置（默认按蓝色商务或根据主题自适应，但 primaryColor 字段必须填合法 6 位 hex）';
  const iconStyleHint = `【列表图标风格（S-7）】：${iconStyleText[iconStyle]}。规划阶段不需要写具体图标的 CSS，但要在选择 pageType 时考虑 iconStyle 的适配（例如 iconStyle=large-number 时，尽量选择带编号列表的 content-list / content-cards / content-compare 等 layout）。`;
  const fontFamilyHint = `【字体风格（S-11）】：${getFontFamilyDescription(fontFamily)}。规划阶段不用写具体 font-family CSS，但要考虑整体排版的气质与字体匹配（例如 serif 更适合大量文字的正式内容页，mono 更适合技术代码型内容页）。`;
  const referenceHtmlBriefText =
    referenceHtmlBrief ||
    (hasReference
      ? '（已上传参考文件，但本次未能提取到可落盘的 HTML 属性摘要；参考主色/字体/版式等仍以「参考文件视觉覆盖指令」为准）'
      : '（用户未上传参考文件 HTML）');
  return (
    PRESENTATION_PLANNING_PROMPT.replace(/\{\{STYLE\}\}/g, style)
      .replace(/\{\{DENSITY\}\}/g, densityText[density])
      .replace(/\{\{IMAGE_PREFERENCE\}\}/g, imagePrefText[imagePreference])
      .replace(/\{\{AUDIENCE\}\}/g, audience || '通用商务受众')
      .replace(/\{\{TOPIC\}\}/g, topic)
      .replace(/\{\{SLIDE_COUNT_GUIDANCE\}\}/g, guidance)
      .replace(
        /\{\{BACKGROUND_GUIDANCE\}\}/g,
        (backgroundEnabled ? BACKGROUND_PLANNING_GUIDANCE : '') + structureOverride,
      )
      .replace(/\{\{COLOR_THEME_HINT\}\}/g, colorThemeHint)
      .replace(/\{\{EXPECTED_PRIMARY_COLOR\}\}/g, expectedPrimaryHex)
      .replace(/\{\{ICON_STYLE_HINT\}\}/g, iconStyleHint)
      .replace(/\{\{FONT_STYLE_HINT\}\}/g, fontFamilyHint)
      .replace(/\{\{USER_SETTINGS_OVERRIDE\}\}/g, userSettingsOverride)
      .replace(/\{\{REFERENCE_HTML_BRIEF\}\}/g, referenceHtmlBriefText)
      .replace(/\{\{CATEGORY_REFERENCE_SUMMARY\}\}/g, categoryReferenceSummary)
      .replace(/\{\{REFERENCE_STRUCTURE_SNIPPET\}\}/g, referenceStructureSnippet)
      .replace(/\{\{REFERENCE_COLOR_POLICY\}\}/g, referenceColorPolicy)
      .replace(/\{\{REFERENCE_LAYOUT_DIVERSITY\}\}/g, referenceLayoutDiversity)
      // RAG 素材放最后注入：用函数式 replace 避免素材里的 `$&` 被当作替换模式，
      // 且素材中若含 {{XXX}} 字面量也不会被前面的替换规则二次改写。
      .replace(/\{\{REFERENCE_TEXT_BRIEF\}\}/g, () => buildReferenceTextBrief(referenceText)) +
    `\n\n【输出语言】${
      language === 'en'
        ? '请使用英文撰写本演示的全部文案（含标题、正文、要点、按钮等可见文本）。'
        : '请使用中文撰写本演示的全部文案（含标题、正文、要点、按钮等可见文本）。'
    }`
  );
}

/**
 * 构建单页 HTML 生成的 prompt。
 * 原函数：HTMLPresentationAgent.buildSlideHtmlPrompt（this 依赖仅 language，已参数化为 language）
 */
export function buildSlideHtmlPrompt(
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
  language: 'zh' | 'en' = 'zh',
): string {
  const imageRequirement =
    plan.needsImage && plan.imagePrompt
      ? `需要配图，图片描述：${plan.imagePrompt}，图片比例：${plan.imageRatio || '4:3'}`
      : '不需要图片，纯文字/卡片布局';
  const keyPointsRaw =
    plan.keyPoints.map((p, i) => `${i + 1}. ${p}`).join('\n') || '- （展开相关内容）';
  // 对 content-no-image / 明确不需要配图的页面额外加一道"禁止裸文本"强提醒
  // 覆盖链路：防止 LLM 被 "content-no-image" 误导为"可以写纯文本行，不用列表"
  const needsBareTextAlert =
    plan.pageType === 'content-no-image' ||
    (!plan.needsImage && plan.pageType && plan.pageType.startsWith('content-'));
  const BARE_TEXT_ALERT = `

⚠️ 【特别提醒 · 本页为纯文字内容页】
尽管本页不包含配图（content-no-image 或无需配图），上面的每一条要点仍然必须：
  1) 用 <ul><li> ... </li></ul> 列表方式输出（推荐，配合 iconStyle 图标使用）
  2) 或逐行用 <p style="font-size:24px;color:#374151;font-weight:600;line-height:2.0;overflow-wrap:break-word;word-break:break-word;">要点文字</p> 包裹
  ✖️ 绝对禁止：把要点文字裸写在 <h2> 之后、最外层 <div> 内部，不套任何 <li> 或 <p> 标签！
  ✖️ 禁止：直接写多行 "\\n" 分隔的纯文本行。这样属于"裸文本"违规格式，会被后端强制返工。
`;
  const keyPointsText = needsBareTextAlert ? `${keyPointsRaw}${BARE_TEXT_ALERT}` : keyPointsRaw;
  const padX = Math.max(32, Math.round((64 * slideWidth) / 1280 / 8) * 8);
  const padY = Math.max(24, Math.round((48 * slideHeight) / 720 / 8) * 8);
  const contentWidth = slideWidth - padX * 2;
  const contentHeight = slideHeight - padY * 2;
  const templates = getPageTemplatesByPageType(
    plan.pageType,
    slideWidth,
    slideHeight,
    iconStyle,
    fontFamily,
  );

  // 参数描述插入（P1 / S2 半通修复）
  const colorThemeText: Record<ColorTheme, string> = {
    blue: '蓝色商务（专业稳重）',
    purple: '紫色创意（个性活泼）',
    green: '绿色环保（清新自然）',
    orange: '橙色活力（醒目热情）',
    teal: '青色科技（科技感强）',
    gray: '极简灰度（低调克制）',
  };
  const styleDescriptionText =
    style === 'creative'
      ? '创意风格（排版大胆活泼，色彩鲜明）'
      : style === 'simple'
        ? '极简风格（大量留白、简洁线条）'
        : '商务风格（平衡、专业稳重，默认）';
  const styleDescription = `【风格（S-1）】：${styleDescriptionText}。所有 CSS 样式、间距、装饰元素都要符合这个整体气质。`;
  const audienceHint = audience
    ? `【目标受众（S-10）】：${audience}。用词、专业度深浅、案例风格等都要贴合这个受众。`
    : '【目标受众（S-10）】：通用商务受众';
  const colorThemeHint = colorTheme
    ? `【配色主题（S-4）】：${colorThemeText[colorTheme]}。不要硬编码与配色主题冲突的颜色（例如紫色主题里写蓝色 #1D4ED8），primaryColor / primaryColorDarker 已提供正确色值，你可以做色调变化但不要出其他色系。`
    : '【配色主题（S-4）】：未显式设置（以提供的 primaryColor / primaryColorDarker 为准）';
  const iconStyleHintText: Record<IconStyle, string> = {
    auto: '智能匹配（默认使用线性SVG描边图标，简约专业，适合B端/技术/正式场景；根据语义从内置图标库选择匹配图标，整页保持统一风格，禁止混用emoji和SVG）',
    line: '线性SVG描边图标（Lucide风格，简约理性、专业冷静，主色描边+浅色圆角底，适合B端产品、技术PPT、研发平台、多图标并列场景）',
    filled:
      '面性SVG填充图标（实心色块，视觉权重高、醒目有力，白色图标+渐变实心底，适合封面、核心结论、大屏展示、重点模块）',
    numbered: '数字序号（渐变圆角方形/圆形 + 白色数字 1/2/3/4，适合步骤/流程/阶段类要点）',
    bullet:
      '对勾/圆点（简洁符号类：主色渐变圆形+白色对勾SVG，或主色10px小圆点；优势/特性项用对勾，普通列表项可用圆点）',
    lettered: '字母分类（渐变圆形 + 白色字母 A/B/C/D…，适合分类/维度/类型类要点）',
    emoji:
      'Emoji风格（仅适合内部轻松沟通/C端/年轻群体内容；B端技术方案、正式汇报、商务宣讲禁止使用emoji，应改用line线性图标）',
    none: '无图标，纯文字列表',
  };
  const iconStyleHint = `【列表图标风格（S-7）】：${iconStyleHintText[iconStyle]}。PAGE_TEMPLATES 中已包含该风格的完整 CSS，你直接选用匹配的 layout 即可，不要自己凭空重新设计。`;
  const fontFamilyHint = `【字体风格（S-11）】：${getFontFamilyDescription(fontFamily)}。PAGE_TEMPLATES 中最外层 <div style="...font-family:XXX"> 已预置正确的 font-family 栈，你**不要在自己的代码里再修改全局 font-family**（会冲突）；局部标题若想放大加粗可以保留 font-weight / font-size。`;
  const imagePreferenceHint = buildImageRequirementHint(plan, imagePreference);
  const backgroundEnabledHint = `【自动背景图（S-3）】：${backgroundEnabled ? '开启（PAGE_TEMPLATES 中 cover / content / summary 等 layout 已预置背景 CSS，你直接套用即可）' : '关闭（不要写额外的背景大图 <img>，用纯色 / 浅色渐变背景即可）'}`;

  // ===== L1/L1.5 字段注入：把 Planning 阶段产出的 layoutParams/styleTheme/metricValues 等传给内容生成阶段 =====
  const layoutParamsRaw =
    plan.layoutParams && Object.keys(plan.layoutParams).length > 0 ? plan.layoutParams : null;
  const styleThemeRaw = plan.styleTheme || null;
  const metricValuesRaw =
    Array.isArray(plan.metricValues) && plan.metricValues.length > 0 ? plan.metricValues : null;
  const advantageIndicesRaw =
    Array.isArray(plan.advantageIndices) && plan.advantageIndices.length > 0
      ? plan.advantageIndices
      : null;
  const showcaseMetricsRaw =
    Array.isArray(plan.showcaseMetrics) && plan.showcaseMetrics.length > 0
      ? plan.showcaseMetrics
      : null;

  const hasL1Fields =
    layoutParamsRaw ||
    styleThemeRaw ||
    metricValuesRaw ||
    advantageIndicesRaw ||
    showcaseMetricsRaw;
  const L1_L15_HINT = !hasL1Fields
    ? ''
    : `

---
## 【L1 布局参数 + L1.5 样式主题 · Planning 阶段显式产出 · 最高优先级】
本 slide 在规划阶段已指定以下参数，生成 HTML 时**必须严格遵守**（优先级高于 PAGE_TEMPLATES 默认模板选择，高于任何示例的默认布局）：

${
  layoutParamsRaw
    ? `- layoutParams（6 维布局调整）：\`\`\`json\n${JSON.stringify(layoutParamsRaw, null, 2)}\n\`\`\`
  含义：titlePosition=标题位置(top/left/right/inline)、contentDirection=内容流向(column/row/row-reverse)、imageAnchor=图片锚点(none/left/right/top/bottom/background)、cardShape=卡片形状(rounded/pill/glass/gradient-border/solid-block)、contentAlignment=内容对齐(left/center/justify/right)、gridCols=网格列数(auto|2|3|4)。
  执行方式：如果某维度与 PAGE_TEMPLATES 默认模板不一致，**以 layoutParams 为准**调整 CSS（例：cardShape=glass → 所有卡片背景换成 backdrop-filter 玻璃样式；contentDirection=row → 要点从纵向改为横向排列；imageAnchor=background → 图片作为全屏背景而不是左/右图）。`
    : ''
}

${
  styleThemeRaw
    ? `- styleTheme（L1.5 视觉样式主题）：\`${styleThemeRaw}\`
  可选值映射：
    - none / 未指定：默认传统卡片
    - glass：所有主要卡片加 backdrop-filter:blur + 半透明白底 + 1px 白边（玻璃拟态）
    - gradient：大标题加渐变文字（background-clip:text），标题背景容器加主色渐变
    - progress-bars：每个要点 / 指标下方加 0~100% 圆角进度条（metricValues 提供百分比）
    - badges：每个要点配一个胶囊 Badge（主色背景白字），核心数值放大显示
    - colored-cards：多张卡片用蓝/绿/橙/紫/青/灰语义调色板
    - mixed：AI 自由组合以上样式（glass+progress-bars+badges 可同页混用）
  执行方式：严格按 styleTheme 值选择对应 L1.5 样式组合写 CSS，不要省略进度条/badge/glass 装饰。`
    : ''
}

${
  metricValuesRaw
    ? `- metricValues（进度条百分比数组，长度=要点数/对比项数）：\`[${metricValuesRaw.join(', ')}]\`
  使用方法：第 N 个要点的进度条 width = metricValues[N-1] + '%'，不要随意编造数值。`
    : ''
}

${
  advantageIndicesRaw
    ? `- advantageIndices（对比页右栏优势项的索引）：\`[${advantageIndicesRaw.join(', ')}]\`
  使用方法：comparison-deep-dive 等对比布局中，这些索引对应的对比项要额外显示"徽章+"、绿色对勾、进度条填充更深一档等强化样式。`
    : ''
}

${
  showcaseMetricsRaw
    ? `- showcaseMetrics（value-showcase 核心数值）：\`\`\`json\n${JSON.stringify(showcaseMetricsRaw, null, 2)}\n\`\`\`
  使用方法：每个 {label, value, trend?} 对应一张数值大卡：value 用 72~96px 巨字号 + 渐变文字（background-clip:text），label 放在下方做副标题，trend=up/down/flat 时右上角显示绿/红/灰趋势徽章（↗/↘/→）。grid 列数根据 showcaseMetrics.length 决定。`
    : ''
}

⚠️ 可编辑性红线：无论用了哪种 L1.5 样式，**装饰性子元素（进度条填充块、Badge 内文字、大 Value 数字 span、渐变装饰 halo/blob、emoji 色块）一律加 pointer-events:none;**；**有意义的容器（玻璃卡、进度条整体、大卡外壳、彩色卡片外层 div）必须显式包含非透明 background / 非零 border / ≥8px border-radius / box-shadow 四者之一**，便于 isVisualContainer 判定可选中。
---
`;

  // ===== comparison-deep-dive 5 列结构化对比维度数据卡（对齐提示，只有本页类型才追加） =====
  let COMPARISON_DATA_CARD_HINT = '';
  if (plan.pageType === 'comparison-deep-dive') {
    const leftMerged: unknown[] = (plan as any).leftKeyPoints ?? [];
    const rightMerged: unknown[] = (plan as any).rightKeyPoints ?? [];
    const metrics: number[] = Array.isArray(metricValuesRaw)
      ? metricValuesRaw
      : ((plan as any).metricValues ?? []);
    const advIdx: number[] = Array.isArray(advantageIndicesRaw)
      ? advantageIndicesRaw
      : ((plan as any).advantageIndices ?? []);
    const advSet = new Set(advIdx);
    // 缺 leftKeyPoints / rightKeyPoints 时，用 keyPoints 作为统一维度名（左右同套，避免名称错位）
    const fallbackDim = plan.keyPoints ?? [];
    const leftDims: string[] =
      leftMerged.length > 0 ? leftMerged.map(String) : fallbackDim.map(String);
    const rightDims: string[] =
      rightMerged.length > 0 ? rightMerged.map(String) : fallbackDim.map(String);
    const N = Math.max(leftDims.length, rightDims.length, metrics.length, 3);
    const padded: Array<{
      idx: number;
      left: string;
      right: string;
      metric: number;
      win: boolean;
    }> = [];
    for (let i = 0; i < N; i++) {
      padded.push({
        idx: i,
        left: leftDims[i] ?? `【缺失-补齐】维度${i + 1}基准`,
        right: rightDims[i] ?? `【缺失-补齐】维度${i + 1}升级`,
        metric: metrics[i] ?? 60,
        win: advSet.has(i),
      });
    }
    COMPARISON_DATA_CARD_HINT = `
---
## 🔴【comparison-deep-dive · 对比维度 5 列结构化数据卡（刚性对齐 · 按行生成，缺的行也要补齐占位）】
⚠️ 此表即本页生成的**唯一事实数据源**。行数 = N = ${N}。**左栏 UL 必须写 N 个 LI，右栏 UL 必须写 N 个 LI，差一行都算违规**。
每一行 i 对应的生成规则：
  - 左栏 LI[i] 标题 = 第 i 行的「左栏维度名」
  - 右栏 LI[i] 标题 = 第 i 行的「右栏维度名」
  - 右栏 LI[i] 进度条 width = metric %，必须严格用该数值（写死 85% 算违规）
  - 右栏 LI[i] 若胜出=YES → 绿色三件套（绿色对勾图标 + 绿色"胜出"徽章 + 深一档绿色渐变）；胜出=NO → 蓝色三件套（主色对勾 + 主色徽章 + 主色渐变）

| 索引 i | 左栏维度名（基准方案） | 右栏维度名（升级方案） | 右栏 进度条 metric% | 右栏 胜出（advantageIndices）|
|--------|----------------------|----------------------|--------------------|---------------------------|
${padded.map((p) => `| ${p.idx} | ${p.left} | ${p.right} | ${p.metric} | ${p.win ? '✅ YES（绿色三件套 + 深一档渐变）' : 'NO（主色三件套 + 主色渐变）'} |`).join('\n')}

### 胜出索引再强调（advantageIndices = [${advIdx.join(', ')}]）：
${advIdx.length === 0 ? '⚠️ 空数组=无胜出维度 → 请重新规划（comparison-deep-dive 至少 1 项优势，否则换 pageType）' : advIdx.map((i) => `第 ${i} 行 → 右栏胜出（✅）`).join('\n')}
### 刚性红线速记：
  ① 左右 LI 数 = ${N}，一条不差　② 禁止 LI 内嵌套 <p>　③ 进度条 width 用本表 metric 值　④ 胜出项绿色三件套缺一不可　⑤ 禁止写固定 width/height/left/top/max-width:none
---
`;
  }

  // === 主题色浅一档推导（PRIMARY_COLOR_LIGHTER：蓝→浅蓝/绿→浅绿/橙→浅橙/紫→浅紫/青→浅青）===
  const primaryColorLighter = derivePrimaryColorLighter(primaryColor);

  const referenceHtmlBriefText =
    referenceHtmlBrief ||
    (hasReference
      ? '（已上传参考文件，但本次未能提取到可落盘的 HTML 属性摘要；参考主色/字体/版式等仍以「参考文件视觉覆盖指令」为准）'
      : '（用户未上传参考文件 HTML）');

  return (
    SLIDE_HTML_GENERATION_PROMPT.replace(/\{\{PRIMARY_COLOR\}\}/g, primaryColor)
      .replace(/\{\{PRIMARY_COLOR_DARKER\}\}/g, primaryColorDarker)
      .replace(/\{\{PRIMARY_COLOR_LIGHTER\}\}/g, primaryColorLighter)
      .replace(/\{\{EXPECTED_PRIMARY_COLOR\}\}/g, primaryColor)
      .replace(/\{\{TITLE_TEXT_COLOR\}\}/g, titleColor)
      .replace(/\{\{BODY_TEXT_COLOR\}\}/g, bodyColor)
      .replace(/\{\{CANVAS_BG_COLOR\}\}/g, canvasBg || '#ffffff')
      .replace(/\{\{SLIDE_WIDTH\}\}/g, String(slideWidth))
      .replace(/\{\{SLIDE_HEIGHT\}\}/g, String(slideHeight))
      .replace(/\{\{PADDING_X\}\}/g, String(padX))
      .replace(/\{\{PADDING_Y\}\}/g, String(padY))
      .replace(/\{\{CONTENT_WIDTH\}\}/g, String(contentWidth))
      .replace(/\{\{CONTENT_HEIGHT\}\}/g, String(contentHeight))
      .replace(
        /\{\{PAGE_TEMPLATES\}\}/g,
        templates +
          L1_L15_HINT +
          (plan.pageType === 'comparison-deep-dive' ? COMPARISON_DATA_CARD_HINT : ''),
      )
      .replace(/\{\{PAGE_TYPE\}\}/g, plan.pageType)
      .replace(/\{\{PAGE_TITLE\}\}/g, plan.title)
      .replace(/\{\{KEY_POINTS\}\}/g, keyPointsText || '- （展开相关内容）')
      .replace(/\{\{IMAGE_REQUIREMENT\}\}/g, imageRequirement)
      .replace(
        /\{\{IMAGE_RATIO\}\}/g,
        plan.imageRatio || PAGE_TYPE_DEFAULT_IMAGE_RATIO[plan.pageType] || '4:3',
      )
      .replace(/\{\{DENSITY\}\}/g, density)
      .replace(/\{\{ICON_STYLE\}\}/g, iconStyle)
      .replace(/\{\{STYLE_DESCRIPTION\}\}/g, styleDescription)
      .replace(/\{\{AUDIENCE_HINT\}\}/g, audienceHint)
      .replace(/\{\{COLOR_THEME_HINT\}\}/g, colorThemeHint)
      .replace(/\{\{ICON_STYLE_HINT\}\}/g, iconStyleHint)
      .replace(/\{\{FONT_STYLE_HINT\}\}/g, fontFamilyHint)
      .replace(/\{\{IMAGE_PREFERENCE_HINT\}\}/g, imagePreferenceHint)
      .replace(/\{\{BACKGROUND_ENABLED_HINT\}\}/g, backgroundEnabledHint)
      .replace(/\{\{REFERENCE_HTML_BRIEF\}\}/g, referenceHtmlBriefText)
      .replace(/\{\{CATEGORY_REFERENCE_SUMMARY\}\}/g, categoryReferenceSummary)
      .replace(/\{\{REFERENCE_STRUCTURE_SNIPPET\}\}/g, referenceStructureSnippet)
      .replace(/\{\{REFERENCE_COLOR_POLICY\}\}/g, referenceColorPolicy) +
    `\n\n【输出语言】${
      language === 'en'
        ? '请使用英文撰写本页的全部可见文案（标题、要点、按钮等）。'
        : '请使用中文撰写本页的全部可见文案（标题、要点、按钮等）。'
    }`
  );
}
