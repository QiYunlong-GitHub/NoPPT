import type { AIModelProvider } from '../providers/base';
import type { ChatMessage, ReferenceContext } from '../types';

export interface CritiqueScores {
  philosophy: number;
  hierarchy: number;
  craft: number;
  functionality: number;
  originality: number;
}

export interface CritiqueIssue {
  severity: 'fatal' | 'important' | 'minor';
  title: string;
  current: string;
  problem: string;
  fix: string;
}

export interface SlideCritique {
  passed: boolean;
  overallScore: number;
  scores: CritiqueScores;
  keep: string[];
  issues: CritiqueIssue[];
  quickWins: string[];
  rawReport: string;
}

export interface CritiqueOptions {
  threshold?: number;
  maxRetries?: number;
  slideWidth?: number;
  slideHeight?: number;
  /** 参考文件上下文（Task5 / FR-17.2）：携带参考意图时，评审应放宽对"偏离默认规范但符合参考风格"的扣分。 */
  referenceContext?: ReferenceContext;
}

const DEFAULT_THRESHOLD = 7.0;
const DEFAULT_MAX_RETRIES = 1;

/** Content LLM 五维度评分 → overallScore 推荐加权均值（总和=1.0） */
const CRITIQUE_WEIGHTS: Readonly<CritiqueScores & Record<keyof CritiqueScores, number>> = {
  philosophy: 0.25,
  hierarchy: 0.30,
  craft: 0.20,
  functionality: 0.20,
  originality: 0.05,
};

/** 解析失败（— 破折号 / 非法 JSON）的降级评分（不再静默 7 分） */
const FALLBACK_SCORE_FOR_PARSE_ERROR = 5;
/** 网络/配额等非解析错误，保持兼容默认通过分数 */
const FALLBACK_SCORE_FOR_TRANSIENT_ERROR = 7;

type ProviderErrorKind = 'quota' | 'network' | 'parse' | 'unknown';

function classifyProviderError(e: unknown): ProviderErrorKind {
  if (e instanceof SyntaxError) return 'parse';
  const msg = e instanceof Error ? e.message : String(e);
  if (/403|quota|insufficient|exhausted|rate limit|429/i.test(msg)) return 'quota';
  if (/ECONN|ETIMEDOUT|timeout|network|fetch failed|socket/i.test(msg)) return 'network';
  if (/JSON|Unexpected token|parse/i.test(msg)) return 'parse';
  return 'unknown';
}

function buildCritiqueSystemPrompt(): string {
  return `你是一位严苛的演示文稿设计评审专家，精通视觉设计、信息架构和排版工艺。你将根据以下五个维度对幻灯片HTML进行评分（每项1-10分）：

1. **哲学一致性（Philosophy Alignment）**：设计是否体现了选定风格的核心精神，色彩/字体/布局是否统一，有无自相矛盾的元素。
2. **视觉层级（Visual Hierarchy）**：H2页面标题（50-52px）与正文（18-20px）字号对比是否≥2.5倍，颜色/粗细/大小是否建立了3-4个清晰层级，留白是否引导视线。
⚠️ 审核对齐说明：正文不得小于16px（与生成规范「最小字号：16px」完全一致）；封面页H1允许使用多层text-shadow作为艺术字光晕效果，不应以"文字模糊"为由扣分。
3. **细节执行（Craft Quality）**：间距是否统一（8pt网格：8/16/24/32/40/48/64的倍数），颜色数量是否受控（不超过3-4种），字体家族是否统一（不超过2种），对齐是否精确。
4. **功能性（Functionality）**：每个元素是否服务于信息传达目标，有无冗余装饰，关键信息是否在显眼位置，信息密度是否适合PPT（每页1个核心观点）。
5. **创新性（Originality）**：是否避免了AI科技cliché（渐变圆球、数字雨、蓝色电路板、机器人脸、赛博霓虹），是否有独特但合理的设计决策。

PPT场景权重：视觉层级和功能性最重要，细节执行其次，创新性可适当放宽。

**常见致命问题（出现即扣分）**：
- 标题和正文字号差距不足2.5倍（H2标准50-52px，正文标准18-20px，比值≥2.5为合格）
- 正文字号超出20px（22/24/28px）而H2在50-52px导致比例不足2.5
- 正文大字（p/li 段落正文 ≥24px 的独立展示，**不包括 H1/H2/H3 标题**）使用主色文字。⚠️ H1/H2/H3 标题使用主色渐变文字、主色纯色文字效果不在此禁止范围，由对比度规则（反色/浅底规则）兜底审核，不得因「H2 渐变主色 + 白底」直接判 fatal。本条款仅针对**正文内容文字**的可读风险。
- 使用5种以上颜色无主次
- 间距随意无系统（非8/16/24/32/40/48/64的倍数）
- 留白不足，内容拥挤
- 3种以上字体
- 对齐不一致
- 装饰背景/渐变/阴影抢了内容风头
- 深蓝底+霓虹发光（赛博霓虹cliché）
- 一页塞太多文字，信息密度过高
- 渐变圆球/电路板/数字雨等AI科技cliché
- 封面页H1艺术字使用多层text-shadow作为视觉效果，**不得当作致命问题扣分**（封面海报级视觉设计允许光晕）；但内容页H2/H3禁止使用多层text-shadow（会导致投影模糊）

重申：本致命问题清单中涉及「正文字号 / 正文颜色对比度」的条款，若页面为 cover/toc/summary，请以 User Prompt 中【本页类型专用豁免】中的条款为准，二者不一致时豁免条款优先。

你必须只返回JSON，不要包含任何markdown代码块标记或解释文字。JSON格式如下：
{
  "overallScore": 7.5,
  "scores": { "philosophy": 7, "hierarchy": 8, "craft": 7, "functionality": 8, "originality": 7 },
  "keep": ["做得好的具体点1", "做得好的具体点2"],
  "issues": [
    { "severity": "fatal|important|minor", "title": "问题名称", "current": "现状描述", "problem": "为什么是问题", "fix": "具体修复建议，含数值" }
  ],
  "quickWins": ["最有影响力的修复1", "修复2", "修复3"]
}
【JSON 字段值域强制约束（不遵守 = 审核作废，由系统以降级策略替代）】
- overallScore：必须是 0 到 10 之间的数字（允许一位小数）。严禁使用负数（如 -1）、破折号（—/-）、null 或空值。
- 推荐 overallScore 计算方式（可微调 ±0.5）：overallScore ≈ 0.25*philosophy + 0.30*hierarchy + 0.20*craft + 0.20*functionality + 0.05*originality
- 若存在 fatal 问题，overallScore 应 ≤ 5.0，同时对应维度的 sub-scores 同步调低，不能 sub-scores 全部 6+ 而 overallScore 异常低。
- scores 五维度同理：每项 1-10 整数，禁止负数/破折号/null。

JSON 语法红线（违反任一条都会导致解析失败，审核作废）：
- 字符串内部禁止出现未转义的英文双引号（ASCII 0x22）；需要引用短语时用中文引号「」『』或单引号
- 字符串内部禁止换行（内容要写在同一行内）
- 不要输出注释、不要尾随逗号、不要用单引号包裹键名或字符串
政治正确、结构完整的 JSON 即可，宁可内容简洁也不能破坏语法。`;
}

export function buildPageTypeSpecificNote(pageType: string): string {
  if (pageType === 'cover' || pageType === 'toc' || pageType === 'summary') {
    const zhType = pageType === 'cover' ? '封面' : pageType === 'toc' ? '目录' : '总结';
    return `
【本页类型：${pageType}（${zhType}页）专用审核规则说明】
⚠️ 本页不是内容页，**不适用 H2:正文 ≥2.5x 比例致命规则**。
合法字号体系（本页专用，覆盖致命清单中的通用正文条款）：
- H1 封面主标题 88-92px（允许多层 text-shadow 光晕，不扣分）
- H2/副标题 28-36px
- 深灰说明行 26-28px
- badge / tag 胶囊 16-20px
视觉层级维度改为「H1 → 副标题 → 说明行 → badge」四层次是否清晰，不与内容页 3-4 层级硬指标对齐。
正文字号 18-20px 的「唯一表」仅适用于内容页，**不用于判定本页**。
`;
  }
  // content-* 页（image-left/right/top/no-image/cards/compare/charts）→ 重申 H2:正文 ≥2.5x
  if (pageType.startsWith('content-')) {
    return `
【本页类型：${pageType}（内容页）专用审核规则重申】
✅ 本页适用 H2(50-52px) : 正文(18-20px) ≥ 2.5x 比例致命规则，请严格比对。
- H2 在 50-52px，正文 li/p 必须在 18/19/20px 范围内；比值 ≥2.5 为合格，低于 2.0 判 fatal。
- 若出现正文 font-size ≥22px（例如 28px 作为列表文字），必然触发「正文字号超出 20px」致命问题。
`;
  }
  // 其他 pageType（charts/compare 等）默认复用内容页规则
  return `
【本页类型：${pageType}】按内容页默认标准执行（H2:正文 ≥2.5x）。
`;
}

function buildCritiqueUserPrompt(
  slideTitle: string,
  slideHtml: string,
  pageType: string,
  designContext: { style: string; primaryColor: string; fontFamily: string; iconStyle: string },
  referenceContext?: ReferenceContext,
): string {
  const truncatedHtml = slideHtml.length > 6000 ? slideHtml.slice(0, 6000) + '\n...[HTML truncated]' : slideHtml;
  const referenceNote = referenceContext?.hasReference
    ? `

【参考文件意图 · 评审放宽条款（FR-17.2）】
本页承载了用户上传的参考文件视觉意图${referenceContext.source && referenceContext.source !== 'none' ? `（来源：${referenceContext.source}）` : ''}${referenceContext.appliedFields?.length ? `，已应用属性：${referenceContext.appliedFields.join('、')}` : ''}。
- 若本页在**配色 / 字体 / 风格 / 密度 / 图标 / 布局**上明显延续了参考文件的视觉语言，即便与通用默认规范（如"正文仅限某字号""默认蓝色商务"）不完全一致，也**不应判为 fatal/important**，视为符合用户意图。
- 仅当违反 **L0 硬性底线**（正文字号 < 12px、文本与背景对比度 < 4.5:1、信息完全不可读、或明显背离用户显式设定）时才可否决。
- 注意：L0 底线由程序化校验独立把关，本评审只需聚焦设计质量与参考意图的一致性。`
    : '';
  return `请评审以下幻灯片。

【幻灯片信息】
- 标题：${slideTitle || '（无标题）'}
- 页面类型：${pageType}
- 设计风格：${designContext.style}
- 主色：${designContext.primaryColor}
- 字体：${designContext.fontFamily}
- 图标风格：${designContext.iconStyle}
${buildPageTypeSpecificNote(pageType)}
【幻灯片HTML】
${truncatedHtml}

${referenceNote}请严格按照系统提示中的JSON格式返回评审结果。overallScore低于7分视为不通过，需要重新生成。`;
}

function repairJsonString(s: string): string {
  let result = s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  // 智能中文标点一律视为普通字符保留原样，绝不转为 ASCII 引号
  // （原实现将 “” 替换为 " 会破坏 JSON 字符串定界，导致 "fix":"将“XX”改为" 提前闭合而 parse 失败）
  result = result
    .replace(/\u2026/g, '...') // … →
    .replace(/\u00A0/g, ' ') // NBSP → 空格
    .replace(/[\u2013\u2014]/g, '-'); // – — → -
  // 字符串内部的裸换行 / 制表符 / 其他控制字符必须转义（结构性换行保留）
  result = escapeControlCharsInJsonStrings(result);
  // 常见 LLM 输出瑕疵修复：尾随逗号、裸键名、单引号字符串/键名
  result = result.replace(/,\s*([}\]])/g, '$1');
  result = result.replace(/([{,]\s*)([A-Za-z_$][A-Za-z0-9_$]*)\s*:/g, '$1"$2":');
  result = result.replace(/([{,]\s*)'([A-Za-z_$][A-Za-z0-9_$]*)'\s*:/g, '$1"$2":');
  result = result.replace(/:\s*'([^'\\]*(?:\\.[^'\\]*)*)'/g, ': "$1"');
  return result;
}

/**
 * 状态机扫描 JSON：仅把双引号字符串内部的裸换行/制表符/控制字符转义，
 * 字符串外部的结构换行保持不变。正确处理 `\\` 与 `\"` 转义序列。
 */
function escapeControlCharsInJsonStrings(s: string): string {
  let out = '';
  let inStr = false;
  let esc = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (!inStr) {
      out += ch;
      if (ch === '"') inStr = true;
      continue;
    }
    if (esc) {
      out += ch;
      esc = false;
      continue;
    }
    if (ch === '\\') {
      out += ch;
      esc = true;
      continue;
    }
    if (ch === '"') {
      out += ch;
      inStr = false;
      continue;
    }
    if (ch === '\n') {
      out += '\\n';
      continue;
    }
    if (ch === '\t') {
      out += '\\t';
      continue;
    }
    const code = ch.charCodeAt(0);
    if (code < 0x20) {
      out += '\\u' + code.toString(16).padStart(4, '0');
      continue;
    }
    out += ch;
  }
  return out;
}

function tryParseJson(jsonStr: string): any {
  const attempts: Array<() => any> = [
    () => JSON.parse(jsonStr),
    () => JSON.parse(repairJsonString(jsonStr)),
    () => {
      // 兜底：万一走到这里仍带 ```json 围栏，剥离后再修复解析
      const fence = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      const stripped = fence && fence[1] ? fence[1].trim() : jsonStr;
      return JSON.parse(repairJsonString(stripped));
    },
  ];
  let lastErr: unknown;
  for (const attempt of attempts) {
    try {
      return attempt();
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

function extractJson(text: string): any {
  let jsonStr = text.trim();
  const codeBlock = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (codeBlock && codeBlock[1]) {
    jsonStr = codeBlock[1].trim();
  }
  const firstBrace = jsonStr.indexOf('{');
  const lastBrace = jsonStr.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    jsonStr = jsonStr.substring(firstBrace, lastBrace + 1);
  }
  return tryParseJson(jsonStr);
}

function normalizeScores(raw: any): CritiqueScores {
  const clamp = (v: any, fallback: number) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(1, Math.min(10, n));
  };
  return {
    philosophy: clamp(raw?.philosophy, 6),
    hierarchy: clamp(raw?.hierarchy, 6),
    craft: clamp(raw?.craft, 6),
    functionality: clamp(raw?.functionality, 6),
    originality: clamp(raw?.originality, 6),
  };
}

function normalizeIssues(raw: any): CritiqueIssue[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 8).map((i: any) => ({
    severity: ['fatal', 'important', 'minor'].includes(i?.severity) ? i.severity : 'minor',
    title: String(i?.title || '问题').slice(0, 100),
    current: String(i?.current || '').slice(0, 300),
    problem: String(i?.problem || '').slice(0, 300),
    fix: String(i?.fix || '').slice(0, 300),
  }));
}

/**
 * 修复 overallScore 异常值（-1 / 越界 / 非数字）。
 * 策略：优先使用 LLM 返回的数值；若异常则退化为「scores 五维加权均值」；
 *       若加权均值也无效，再退化为 parse 错误降级分 5 分。
 * 所有分支都必须输出 0-10 之间的有限数。
 */
export function fixOverallScore(rawOverallScore: unknown, scores: CritiqueScores): number {
  const weighted =
    CRITIQUE_WEIGHTS.philosophy * scores.philosophy +
    CRITIQUE_WEIGHTS.hierarchy * scores.hierarchy +
    CRITIQUE_WEIGHTS.craft * scores.craft +
    CRITIQUE_WEIGHTS.functionality * scores.functionality +
    CRITIQUE_WEIGHTS.originality * scores.originality;
  const safeWeighted = Number.isFinite(weighted) ? weighted : FALLBACK_SCORE_FOR_PARSE_ERROR;

  const n = Number(rawOverallScore);
  if (Number.isFinite(n) && n >= 0 && n <= 10) {
    return n; // 合法值，直接使用
  }
  console.warn(
    `[CRITIQUE] overallScore 异常(${String(rawOverallScore)})，使用 sub-scores 加权均值 ${safeWeighted.toFixed(2)} 替代。scores=`,
    JSON.stringify(scores),
  );
  return Math.max(0, Math.min(10, safeWeighted));
}

export async function critiqueSlide(
  provider: AIModelProvider,
  slideTitle: string,
  slideHtml: string,
  pageType: string,
  designContext: { style: string; primaryColor: string; fontFamily: string; iconStyle: string },
  options: CritiqueOptions = {},
): Promise<SlideCritique> {
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;

  const messages: ChatMessage[] = [
    { role: 'system', content: buildCritiqueSystemPrompt() },
    { role: 'user', content: buildCritiqueUserPrompt(slideTitle, slideHtml, pageType, designContext, options.referenceContext) },
  ];

  let raw: any;
  let rawness = '';
  try {
    const response = await provider.chat(messages, { temperature: 0.2, maxTokens: 8192 });
    rawness = response.content || '';
    raw = extractJson(response.content);
  } catch (e) {
    const snippet = rawness.replace(/\s+/g, ' ').slice(0, 300);
    const kind = classifyProviderError(e);
    console.warn(`[CRITIQUE] Failed (${kind}):`, e);
    if (kind === 'quota') {
      console.warn('[CRITIQUE] 提示：当前内容审核模型配额/限流异常，请检查模型额度或切换路由。');
    }
    console.warn('[CRITIQUE] Raw LLM response (first 300 chars):', snippet);

    // —— 分级降级策略（Task-3 FR-3）——
    if (kind === 'parse') {
      // JSON 解析失败（overallScore:— 破折号、非法JSON 等）：overallScore=5 警告边界，失败 + meta issue
      const metaIssue: CritiqueIssue = {
        severity: 'important',
        title: '审核JSON格式异常',
        current: snippet,
        problem: '模型返回非法JSON（破折号/格式错误），评分由降级策略替代，本次审核可信度不足。',
        fix: '建议切换为 JSON 输出更稳定的审核模型（如 deepseek-json 或 glm-4-flash 系列），或降低 temperature。',
      };
      const fallbackScore = FALLBACK_SCORE_FOR_PARSE_ERROR;
      return {
        passed: fallbackScore >= threshold,
        overallScore: fallbackScore,
        scores: { philosophy: 6, hierarchy: 5, craft: 6, functionality: 5, originality: 6 },
        keep: [],
        issues: [metaIssue],
        quickWins: ['切换审核模型为 JSON 稳定模型'],
        rawReport: '',
      };
    }

    // quota / network / unknown：仍用 7 分默认通过，避免 API 故障阻塞主流程
    return {
      passed: true,
      overallScore: FALLBACK_SCORE_FOR_TRANSIENT_ERROR,
      scores: { philosophy: 7, hierarchy: 7, craft: 7, functionality: 7, originality: 7 },
      keep: [],
      issues: kind === 'unknown'
        ? [{
            severity: 'minor',
            title: '审核调用未知异常（非阻塞）',
            current: snippet,
            problem: '调用内容审核模型时遇到非网络/非配额/非JSON解析类异常，默认放行避免阻塞。',
            fix: '查看日志详情，若频繁出现建议检查模型提供商或路由配置。',
          }]
        : [],
      quickWins: [],
      rawReport: '',
    };
  }

  const scores = normalizeScores(raw.scores);
  const overallScore = fixOverallScore(raw.overallScore, scores); // clamp 最小值为 0（与 VLM 行为一致）
  const keep = Array.isArray(raw.keep) ? raw.keep.slice(0, 5).map((k: any) => String(k).slice(0, 200)) : [];
  const issues = normalizeIssues(raw.issues);
  const quickWins = Array.isArray(raw.quickWins) ? raw.quickWins.slice(0, 3).map((k: any) => String(k).slice(0, 200)) : [];

  const hasFatal = issues.some((i) => i.severity === 'fatal');
  const passed = overallScore >= threshold && !hasFatal;

  return {
    passed,
    overallScore,
    scores,
    keep,
    issues,
    quickWins,
    rawReport: JSON.stringify(raw, null, 2),
  };
}

export function buildCritiqueFeedback(critique: SlideCritique): string {
  if (critique.issues.length === 0 && critique.quickWins.length === 0) {
    return '';
  }

  const fatalIssues = critique.issues.filter((i) => i.severity === 'fatal');
  const importantIssues = critique.issues.filter((i) => i.severity === 'important');
  const minorIssues = critique.issues.filter((i) => i.severity === 'minor');

  const feedbackLines: string[] = [];
  feedbackLines.push('===========================================================');
  feedbackLines.push('🔴 上次审核驳回问题（本次生成必须逐一修复，最高优先级）');
  feedbackLines.push('===========================================================');
  feedbackLines.push('以下是上一版 HTML 被审核驳回的具体原因。本次生成必须**逐条修复**下列问题，同时仍需遵守下方所有设计规范。');
  feedbackLines.push('【修复优先级】：FATAL 致命问题 >> IMPORTANT 重要问题 >> MINOR 小问题。若不同审核维度给出矛盾建议，以 FATAL 维度要求为准。');
  feedbackLines.push('');

  if (fatalIssues.length > 0) {
    feedbackLines.push('----- FATAL（出现即判不通过，必须100%修复）-----');
    fatalIssues.forEach((i) => {
      feedbackLines.push(`- [${i.title}] → 现状：${i.current ?? ''} → 修复指令：${i.fix ?? '请按上方规范修正'} → 涉及：未分类`);
    });
    feedbackLines.push('');
  }

  if (importantIssues.length > 0) {
    feedbackLines.push('----- IMPORTANT（扣分较重，优先修复）-----');
    importantIssues.forEach((i) => {
      feedbackLines.push(`- [${i.title}] → 现状：${i.current ?? ''} → 修复指令：${i.fix ?? '请按上方规范修正'} → 涉及：未分类`);
    });
    feedbackLines.push('');
  }

  const hasMinorContent = minorIssues.length > 0 || critique.quickWins.length > 0;
  if (hasMinorContent) {
    feedbackLines.push('----- MINOR（轻微扣分，最后顺手修复）-----');
    minorIssues.forEach((i) => {
      feedbackLines.push(`- [${i.title}] → 现状：${i.current ?? ''} → 修复指令：${i.fix ?? '请按上方规范修正'} → 涉及：未分类`);
    });
    critique.quickWins.forEach((w) => {
      feedbackLines.push(`- [快速优化建议] ${w}`);
    });
    feedbackLines.push('');
  }

  feedbackLines.push('===========================================================');

  return feedbackLines.join('\n');
}

export function buildRegenerationPrompt(
  originalPrompt: string,
  critique: SlideCritique,
): string {
  const feedback = buildCritiqueFeedback(critique);
  if (!feedback) return originalPrompt;
  return feedback + '\n\n' + originalPrompt;
}

export { DEFAULT_THRESHOLD, DEFAULT_MAX_RETRIES };
