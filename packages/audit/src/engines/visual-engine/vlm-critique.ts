import * as fs from 'fs';
import type { AIModelProvider } from '@noppt/ai';
import type { ChatMessage } from '@noppt/ai';
import type { ReferenceContext } from '@noppt/ai';
import type { AuditIssue } from '../../types';

export type VlmRootCause = 'html' | 'image' | 'both';
export type VlmCritiqueMode = 'placeholder' | 'final';

export interface VlmReviewResult {
  issues: AuditIssue[];
  score: number;
}

interface VlmIssueJson {
  title: string;
  severity: 'fatal' | 'important' | 'minor';
  problem: string;
  fix: string;
  rootCause?: VlmRootCause;
}

interface VlmResponseJson {
  overallScore: number;
  summary?: string;
  issues: VlmIssueJson[];
}

const ROOT_CAUSE_DESC = `判断每个问题的根因（rootCause 字段）：
- "html"：纯排版/布局问题，与图片无关（如元素重叠、对齐错乱、留白失衡、字号过小、层级不清、配色刺眼、文本溢出裁切）。
- "image"：仅图片内容本身的问题（如图片模糊、畸形扭曲、与主题无关、风格不符、裁切不当、主体缺失）。
- "both"：图文搭配问题（如图片与文字比例失衡、图文主题冲突、图片破坏整体构图、图文位置相互干扰）。`;

const FINAL_SYSTEM_PROMPT = `你是一位资深的演示文稿视觉设计评审专家，精通排版、色彩、视觉层次、留白与信息传达。你将看到一张幻灯片的实际渲染截图（图片已插入），请基于"所见即所得"的视角对其视觉设计质量进行严格评审。

重点关注以下维度：
1. 视觉层次：标题、正文、强调元素的主次关系是否清晰；视线流动是否自然。
2. 对齐与排版：元素是否对齐统一；边距、间距是否一致；是否存在错位、重叠、超出边界或文本被裁切。
3. 留白与密度：留白是否充足舒适；信息是否过于拥挤或过于空旷。
4. 色彩运用：配色是否专业和谐；对比是否足够；是否存在刺眼或脏色。
5. 图文关系：图片与文字的搭配、比例、位置是否得当；图片本身质量（清晰度、相关性、风格）是否合格。
6. 专业完成度：整体是否精致、可信，有无明显的粗糙感或 AI 生成痕迹。

${ROOT_CAUSE_DESC}

请严格只返回如下 JSON（不要任何额外说明、不要 markdown 代码块）：
{
  "overallScore": 0 到 10 之间的数字（允许一位小数，10 为完美）,
  "summary": "一句话总评",
  "issues": [
    {
      "title": "问题简短标题",
      "severity": "fatal | important | minor",
      "problem": "具体问题描述，引用你在截图中看到的现象",
      "fix": "可执行的修改建议",
      "rootCause": "html | image | both"
    }
  ]
}
没有问题时 issues 返回空数组。宁可少报也不要编造截图中不存在的问题。`;

const PLACEHOLDER_SYSTEM_PROMPT = `你是一位资深的演示文稿视觉设计评审专家，精通排版、色彩、视觉层次、留白与信息传达。你将看到一张幻灯片的渲染截图，其中图片位置以灰色占位块表示（真实图片尚未生成）。

请只评审与图片无关的排版/布局质量，不要评价占位块本身的外观，也不要报告任何"图片缺失/图片未加载/图片质量"类问题。

重点关注以下维度：
1. 视觉层次：标题、正文、强调元素的主次关系是否清晰；视线流动是否自然。
2. 对齐与排版：元素是否对齐统一；边距、间距是否一致；是否存在错位、重叠、超出边界或文本被裁切。
3. 留白与密度：留白是否充足舒适；信息是否过于拥挤或过于空旷（含图片占位块与文字的比例是否合理）。
4. 色彩运用：配色是否专业和谐；对比是否足够；是否存在刺眼或脏色。
5. 专业完成度：整体排版是否精致、可信。

${ROOT_CAUSE_DESC}
注意：由于图片尚未生成，此阶段的 rootCause 只能为 "html"（占位块造成的图文比例问题可归为 "html"）。

请严格只返回如下 JSON（不要任何额外说明、不要 markdown 代码块）：
{
  "overallScore": 0 到 10 之间的数字（允许一位小数，10 为完美）,
  "summary": "一句话总评",
  "issues": [
    {
      "title": "问题简短标题",
      "severity": "fatal | important | minor",
      "problem": "具体问题描述，引用你在截图中看到的现象",
      "fix": "可执行的修改建议",
      "rootCause": "html"
    }
  ]
}
没有问题时 issues 返回空数组。宁可少报也不要编造截图中不存在的问题。`;

const REFERENCE_RELAX_CLAUSE =
  `\n\n【参考豁免条款】本页已遵循用户提供的参考（HTML/图片）的视觉意图。` +
  `除非存在 L0 级无障碍底线问题（正文对比度 < 4.5:1、正文字号 < 12px、装饰遮挡正文、文字被裁切不可读），` +
  `否则不应以通用字号/间距/配色规范（如正文 16-20px、8pt 网格、颜色 ≤3-4、字体 ≤2）为由判 fatal。` +
  `此类偏差应记为 important/minor 建议，不触发重生成。`;

function buildSystemPrompt(mode: VlmCritiqueMode, relaxForReference = false): string {
  const base = mode === 'placeholder' ? PLACEHOLDER_SYSTEM_PROMPT : FINAL_SYSTEM_PROMPT;
  return relaxForReference ? base + REFERENCE_RELAX_CLAUSE : base;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^\w\u4e00-\u9fff-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function mapSeverity(severity: VlmIssueJson['severity']): AuditIssue['severity'] {
  if (severity === 'fatal') return 'error';
  if (severity === 'important') return 'warn';
  return 'info';
}

function normalizeRootCause(
  rootCause: VlmIssueJson['rootCause'],
  mode: VlmCritiqueMode,
): VlmRootCause {
  if (mode === 'placeholder') return 'html';
  if (rootCause === 'html' || rootCause === 'image' || rootCause === 'both') return rootCause;
  return 'both';
}

function repairJsonString(s: string): string {
  let result = s;
  result = result
    .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"')
    .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'")
    .replace(/\u2026/g, '...')
    .replace(/\u00A0/g, ' ')
    .replace(/[\u2013\u2014]/g, '-');
  result = result.replace(/,\s*([}\]])/g, '$1');
  result = result.replace(/([{,]\s*)([A-Za-z_$][A-Za-z0-9_$]*)\s*:/g, '$1"$2":');
  result = result.replace(/:\s*'([^'\\]*(?:\\.[^'\\]*)*)'/g, ': "$1"');
  return result;
}

function safeParseResponse(content: string): VlmResponseJson | null {
  if (!content) return null;
  const cleaned = content
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  const jsonStr = cleaned.slice(start, end + 1);

  const doParse = (s: string): VlmResponseJson | null => {
    try {
      const parsed = JSON.parse(s);
      if (typeof parsed !== 'object' || parsed === null) return null;
      const issues = Array.isArray(parsed.issues) ? parsed.issues : [];
      return {
        overallScore: typeof parsed.overallScore === 'number' ? parsed.overallScore : 0,
        summary: typeof parsed.summary === 'string' ? parsed.summary : undefined,
        issues,
      };
    } catch {
      return null;
    }
  };

  const direct = doParse(jsonStr);
  if (direct) return direct;
  return doParse(repairJsonString(jsonStr));
}

const IMAGE_NOT_RECEIVED_PATTERNS = [
  /未提供截图|无法.*截图|截图缺失|没有截图|看不到.*图|未收到.*图|no image|no screenshot|image.*not.*provided|cannot.*see/i,
];

function looksLikeImageNotReceived(text: string): boolean {
  if (!text) return false;
  return IMAGE_NOT_RECEIVED_PATTERNS.some((p) => p.test(text));
}

// L0 无障碍底线（参考不可覆盖）：对比度 / 字号 / 可读性 / 遮挡 / 裁切。命中则即使有参考也保留 fatal。
const L0_ACCESSIBILITY_PATTERNS = [
  /对比度|contrast/i,
  /字号|字体大小|字体太小|正文字号|过小|太小|字号过小/i,
  /可读性|readable|无法阅读|看不清|难以辨认/i,
  /遮挡|覆盖正文|吞没|被.*挡住|被装饰/i,
  /裁切|溢出|超出边界|截断|不可读|超出屏幕/i,
];

function isL0AccessibilityIssue(text: string): boolean {
  if (!text) return false;
  return L0_ACCESSIBILITY_PATTERNS.some((p) => p.test(text));
}

export async function runVlmCritique(
  provider: AIModelProvider,
  screenshotPath: string,
  slideIndex: number,
  slideTitle?: string,
  mode: VlmCritiqueMode = 'final',
  referenceContext?: ReferenceContext,
): Promise<VlmReviewResult> {
  if (!provider || !fs.existsSync(screenshotPath)) {
    return { issues: [], score: 0 };
  }

  const imageBuffer = fs.readFileSync(screenshotPath);
  if (imageBuffer.length < 1024) {
    console.warn(
      `[VLM] 第 ${slideIndex + 1} 页截图文件异常（仅 ${imageBuffer.length} 字节），跳过视觉评审`,
    );
    return { issues: [], score: 0 };
  }

  const hasReference = !!(referenceContext && referenceContext.hasReference);

  const base64 = imageBuffer.toString('base64');
  const dataUrl = `data:image/png;base64,${base64}`;

  const modeHint =
    mode === 'placeholder' ? '（图片为灰色占位块，仅评审排版）' : '（图片已插入，评审最终效果）';
  const userText =
    `这是第 ${slideIndex + 1} 页幻灯片${slideTitle ? `（标题：${slideTitle}）` : ''}的渲染截图${modeHint}。` +
    `请按照系统提示中的维度对其视觉设计进行评审并返回 JSON。`;

  const messages: ChatMessage[] = [
    { role: 'system', content: buildSystemPrompt(mode, hasReference) },
    {
      role: 'user',
      content: [
        { type: 'text', text: userText },
        { type: 'image_url', image_url: { url: dataUrl } },
      ],
    },
  ];

  let response;
  try {
    // VLM 请求超时保护：模型/网关无响应时不再无限等待，降级为"跳过该页继续"（避免整个生成卡死）
    const timeoutMs = 180_000;
    type VlmChatSettled = {
      ok: boolean;
      v?: Awaited<ReturnType<typeof provider.chat>>;
      e?: unknown;
    };
    const chatSettled = await Promise.race<VlmChatSettled>([
      provider.chat(messages, { temperature: 0.2, maxTokens: 8192 }).then(
        (v): VlmChatSettled => ({ ok: true, v }),
        (e): VlmChatSettled => ({ ok: false, e }),
      ),
      new Promise<VlmChatSettled>((resolve) =>
        setTimeout(
          () =>
            resolve({
              ok: false,
              e: new Error(
                `VLM 请求超时（>${timeoutMs / 1000}s），模型：${provider.config.model}，已降级跳过该页`,
              ),
            }),
          timeoutMs,
        ),
      ),
    ]);
    if (!chatSettled.ok || !chatSettled.v) {
      throw chatSettled.e instanceof Error ? chatSettled.e : new Error(String(chatSettled.e));
    }
    response = chatSettled.v;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[VLM] 视觉评审调用失败或超时（已降级跳过）: ${msg}`);
    return { issues: [], score: 0 };
  }

  if (looksLikeImageNotReceived(response.content)) {
    console.warn(
      `[VLM] 第 ${slideIndex + 1} 页：模型返回"未收到截图"。这通常意味着 auditVlm 路由配置的模型「${provider.config.model}」不支持图片输入，` +
        `或 API 网关/中间件剥离了多模态图片数据。请在「设置 → AI 模型设置 → 模型路由」中将 auditVlm 改为支持视觉的多模态模型（如 GPT-4o、Qwen-VL、Claude 3.5 Sonnet 等）。`,
    );
    return { issues: [], score: 0 };
  }

  if (response.usage && response.usage.promptTokens < 500 && base64.length > 10000) {
    console.warn(
      `[VLM] 第 ${slideIndex + 1} 页：promptTokens=${response.usage.promptTokens} 异常偏低（截图 base64 长度=${base64.length}），` +
        `图片数据大概率未被模型接收。请确认 auditVlm 路由配置的是视觉多模态模型，而非纯文本模型。`,
    );
  }

  const parsed = safeParseResponse(response.content);
  if (!parsed) {
    return { issues: [], score: 0 };
  }

  const issues: AuditIssue[] = parsed.issues.map((issue) => {
    const rootCause = normalizeRootCause(issue.rootCause, mode);
    let severity = mapSeverity(issue.severity);
    const isFatal = severity === 'error';
    const l0 = isL0AccessibilityIssue(`${issue.title}: ${issue.problem}`);
    // 原则 P-2 / FR-17.2：有参考时，"未遵循通用规范但符合参考意图"的 fatal 降级为 important（→ warn），不触发重生成；
    // 仅 L0 无障碍底线（对比度/字号/遮挡/裁切）仍保留 fatal。
    const relaxed = hasReference && isFatal && !l0;
    if (relaxed) severity = 'warn';
    return {
      ruleId: `vlm-${issue.severity}-${slugify(issue.title) || 'visual'}`,
      severity,
      engine: 'visual',
      slideIndex,
      message: `${issue.title}: ${issue.problem}`,
      fixSuggestion: issue.fix,
      fixable: false,
      metadata: {
        source: 'vlm',
        model: response.model,
        summary: parsed.summary,
        imageRelated: rootCause !== 'html',
        rootCause,
        vlmMode: mode,
        slideTitle,
        relaxedByReference: relaxed || undefined,
      },
    };
  });

  const score = Math.max(0, Math.min(10, parsed.overallScore));
  return { issues, score: score * 10 };
}
