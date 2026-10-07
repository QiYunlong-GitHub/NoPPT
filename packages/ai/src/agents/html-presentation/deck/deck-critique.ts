/**
 * deck-critique.ts —— 评审 **Deck / Plan 节点树**（确定性渲染路径的评审入口）。
 *
 * 与 `slide-critique.ts`（评审 LLM 生成的 HTML 字符串）共用同一套评审核心
 * `critiqueByContent`：LLM 调用、JSON 解析、评分归一与分级降级逻辑完全一致，
 * 只是「喂给 LLM 的内容」从 HTML 字符串换成了**节点树的结构化描述**
 * （`describeDeckSlide` 把 `DeckSlide.nodes` 序列化为含 kind / rect / fontSize / color /
 * 文本 的文本，等价于渲染后的视觉信息）。
 *
 * 这样「选版式 + 写内容」交给 LLM（SlidePlan → Deck），「评审设计质量」也基于同一份
 * 节点真值，避免 HTML 字符串手术与节点树之间出现评审口径不一致。
 *
 * 红线：本文件为新增模块，仅通过 `deck/index.ts` 的 `export *` 对外暴露；
 * 不修改 `slide-critique.ts` 既有导出 / `render.ts` 既有逻辑，不删除任何文件。
 */

import {
  DECK_IMAGE_PLACEHOLDER,
  isDeckImagePlaceholder,
  type Deck,
  type DeckColor,
  type DeckFill,
  type DeckNode,
  type DeckParagraph,
  type DeckSlide,
} from '@noppt/core/deck';
import type { AIModelProvider } from '../../../providers/base';
import type { ChatMessage, ReferenceContext, SlidePlan } from '../../../types';
import {
  buildCritiqueFeedback,
  buildPageTypeSpecificNote,
  critiqueByContent,
  type CritiqueOptions,
  type SlideCritique,
} from '../../../templates/slide-critique';

/** 评审所需的设计上下文（与 HTML 路径的 designContext 同构）。 */
export interface DeckCritiqueDesignContext {
  style: string;
  primaryColor: string;
  fontFamily: string;
  iconStyle: string;
}

// ---------------------------------------------------------------------------
// 节点树 → 结构化文本描述
// ---------------------------------------------------------------------------

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '…' : s;
}

function describeColor(c?: DeckColor): string {
  if (c == null) return '';
  return String(c);
}

function describeFill(fill?: DeckFill): string {
  if (!fill) return '';
  const f = fill as { type?: string; color?: DeckColor; gradient?: unknown };
  if (f.type === 'gradient' || f.gradient) return 'fill=渐变';
  if (f.color != null) return `fill=${describeColor(f.color)}`;
  return '';
}

function describeRuns(paragraphs: DeckParagraph[]): {
  text: string;
  fontSize?: number;
  color?: string;
  bold: boolean;
} {
  let text = '';
  let fontSize: number | undefined;
  let color: string | undefined;
  let bold = false;
  for (const p of paragraphs) {
    for (const r of p.runs) {
      text += r.text;
      if (fontSize === undefined && r.fontSize != null) fontSize = r.fontSize;
      if (color === undefined && r.color != null) color = describeColor(r.color);
      if (r.bold) bold = true;
    }
  }
  return { text, fontSize, color, bold };
}

function describeNode(n: DeckNode, indent: string): string[] {
  const rect = `rect(${Math.round(n.rect.x)},${Math.round(n.rect.y)},${Math.round(n.rect.w)},${Math.round(n.rect.h)})`;
  const lines: string[] = [];
  if (n.kind === 'text') {
    const { text, fontSize, color, bold } = describeRuns(n.paragraphs);
    const fmt = [
      n.role ? `role=${n.role}` : '',
      fontSize != null ? `fontSize=${fontSize}` : '',
      color ? `color=${color}` : '',
      bold ? 'bold' : '',
    ]
      .filter(Boolean)
      .join(' ');
    lines.push(`${indent}- text [${rect}] ${fmt} → "${truncate(text, 80)}"`);
  } else if (n.kind === 'shape') {
    lines.push(`${indent}- shape(${n.shape}) [${rect}] ${describeFill(n.fill)}`);
  } else if (n.kind === 'image') {
    const placeholder = isDeckImagePlaceholder(n.src);
    const srcDesc = placeholder
      ? `src=占位图(${DECK_IMAGE_PLACEHOLDER})`
      : `src=${truncate(n.src, 40)}`;
    lines.push(
      `${indent}- image [${rect}] ${srcDesc} fit=${n.fit ?? 'cover'}${n.alt ? ` alt="${truncate(n.alt, 40)}"` : ''}`,
    );
  } else if (n.kind === 'table') {
    const rows = n.rows.length;
    const cols = n.rows[0]?.length ?? 0;
    lines.push(`${indent}- table [${rect}] ${rows}×${cols}`);
  } else if (n.kind === 'chart') {
    const kind = (n.chart as { kind?: string }).kind ?? 'unknown';
    lines.push(`${indent}- chart(${kind}) [${rect}]`);
  } else if (n.kind === 'group') {
    lines.push(`${indent}- group [${rect}]`);
    for (const c of n.children) lines.push(...describeNode(c, indent + '  '));
  }
  return lines;
}

/**
 * 把一页 `DeckSlide` 序列化为评审用的结构化文本。
 * 等价于渲染后的视觉信息：层级、字号、配色、布局坐标、图片占位情况一目了然。
 */
export function describeDeckSlide(slide: DeckSlide, plan?: SlidePlan): string {
  const pageType = slide.pageType ?? plan?.pageType ?? '(未知)';
  const title = slide.title ?? plan?.title ?? '(无标题)';
  const header = [
    '【幻灯片信息】',
    `- slide id: ${slide.id ?? '(无)'}`,
    `- pageType: ${pageType}`,
    `- 标题: ${title}`,
    plan?.keyPoints ? `- 要点数: ${plan.keyPoints.length}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  const body = slide.nodes.flatMap((n) => describeNode(n, '')).join('\n');
  return `${header}\n【节点树描述】\n${body}`;
}

// ---------------------------------------------------------------------------
// Deck 版系统提示（与 HTML 版五维度口径一致，输入改为节点树描述）
// ---------------------------------------------------------------------------

function buildDeckCritiqueSystemPrompt(): string {
  return `你是一位严苛的演示文稿设计评审专家，精通视觉设计、信息架构和排版工艺。你将根据以下五个维度对幻灯片（以**结构化节点树描述**呈现，等价于渲染后的 HTML 视觉）进行评分（每项1-10分）：

1. **哲学一致性（Philosophy Alignment）**：设计是否体现了选定风格的核心精神，色彩/字体/布局是否统一，有无自相矛盾的元素。
2. **视觉层级（Visual Hierarchy）**：标题（约52px）与正文（约18-20px）字号对比是否≥2.5倍，颜色/粗细/大小是否建立了3-4个清晰层级，留白是否引导视线。
⚠️ 审核对齐说明：正文不得小于16px；封面页主标题允许作为艺术字处理，不应以"文字模糊"为由扣分。
3. **细节执行（Craft Quality）**：间距是否统一（8pt网格：8/16/24/32/40/48/64的倍数），颜色数量是否受控（不超过3-4种），字体家族是否统一（不超过2种），对齐是否精确。
4. **功能性（Functionality）**：每个元素是否服务于信息传达目标，有无冗余装饰，关键信息是否在显眼位置，信息密度是否适合PPT（每页1个核心观点）。
5. **创新性（Originality）**：是否避免了AI科技cliché（渐变圆球、数字雨、蓝色电路板、机器人脸、赛博霓虹），是否有独特但合理的设计决策。

节点树描述格式说明：
- 每个节点含 kind（text / shape / image / table / chart / group）、rect(x,y,w,h)（1280×720 画布上的绝对像素坐标）与语义属性；
- text 节点给出 fontSize(pt)、color(#RRGGBB)、bold、role(title/body/...) 与文本内容；
- image 节点若 src=占位图(${DECK_IMAGE_PLACEHOLDER}) 表示「待生成配图」的灰块占位，不应以"图片缺失/未加载"扣分；真实图则给出 src；
- 据此判断层级、字号比例、配色、留白与对齐。

PPT场景权重：视觉层级和功能性最重要，细节执行其次，创新性可适当放宽。

**常见致命问题（出现即扣分）**：
- 标题和正文字号差距不足2.5倍（标题约52px，正文约18-20px，比值≥2.5为合格）
- 正文大字（≥24px 的独立展示正文，**不包括标题**）使用主色文字（标题使用主色不在此限）
- 使用5种以上颜色无主次
- 间距随意无系统（非8/16/24/32/40/48/64的倍数）
- 留白不足，内容拥挤
- 3种以上字体
- 对齐不一致
- 装饰背景/渐变/阴影抢了内容风头
- 深蓝底+霓虹发光（赛博霓虹cliché）
- 一页塞太多文字，信息密度过高
- 渐变圆球/电路板/数字雨等AI科技cliché

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
- overallScore：必须是 0 到 10 之间的数字（允许一位小数）。严禁使用负数、破折号、null 或空值。
- 推荐计算：overallScore ≈ 0.25*philosophy + 0.30*hierarchy + 0.20*craft + 0.20*functionality + 0.05*originality
- 若存在 fatal 问题，overallScore 应 ≤ 5.0，且对应维度 sub-scores 同步调低。
- scores 五维度：每项 1-10 整数，禁止负数/破折号/null。

JSON 语法红线：
- 字符串内部禁止出现未转义的英文双引号；需要引用短语时用中文引号「」『』或单引号
- 字符串内部禁止换行（内容写在同一行内）
- 不要输出注释、不要尾随逗号、不要用单引号包裹键名或字符串
政治正确、结构完整的 JSON 即可，宁可内容简洁也不能破坏语法。`;
}

function buildDeckCritiqueUserPrompt(
  slide: DeckSlide,
  plan: SlidePlan | undefined,
  designContext: DeckCritiqueDesignContext,
  referenceContext?: ReferenceContext,
): string {
  const pageType = slide.pageType || plan?.pageType || 'content-no-image';
  const description = describeDeckSlide(slide, plan);
  const truncated =
    description.length > 6000
      ? description.slice(0, 6000) + '\n...[description truncated]'
      : description;
  const referenceNote = referenceContext?.hasReference
    ? `

【参考文件意图 · 评审放宽条款（FR-17.2）】
本页承载了用户上传的参考文件视觉意图${referenceContext.source && referenceContext.source !== 'none' ? `（来源：${referenceContext.source}）` : ''}${referenceContext.appliedFields?.length ? `，已应用属性：${referenceContext.appliedFields.join('、')}` : ''}。
- 若本页在**配色 / 字体 / 风格 / 密度 / 图标 / 布局**上明显延续了参考文件的视觉语言，即便与通用默认规范不完全一致，也**不应判为 fatal/important**，视为符合用户意图。
- 仅当违反 **L0 硬性底线**（正文字号 < 12px、文本与背景对比度 < 4.5:1、信息完全不可读、或明显背离用户显式设定）时才可否决。
- 注意：L0 底线由程序化校验独立把关，本评审只需聚焦设计质量与参考意图的一致性。`
    : '';
  return `请评审以下幻灯片（以结构化节点树描述呈现，等价于渲染后的 HTML 视觉）。

【幻灯片信息】
- 标题：${slide.title || plan?.title || '（无标题）'}
- 页面类型：${pageType}
- 设计风格：${designContext.style}
- 主色：${designContext.primaryColor}
- 字体：${designContext.fontFamily}
- 图标风格：${designContext.iconStyle}
${buildPageTypeSpecificNote(pageType)}
【幻灯片节点树描述】
${truncated}

${referenceNote}请严格按照系统提示中的JSON格式返回评审结果。overallScore低于7分视为不通过，需要重新生成。`;
}

// ---------------------------------------------------------------------------
// 对外 API
// ---------------------------------------------------------------------------

/**
 * 评审单页 `DeckSlide`（结合可选 `SlidePlan` 提供标题/要点等语义上下文）。
 * 返回与 `critiqueSlide` 完全同构的 `SlideCritique`，可直接喂给 `buildCritiqueFeedback`。
 */
export async function critiqueDeckSlide(
  provider: AIModelProvider,
  slide: DeckSlide,
  plan: SlidePlan | undefined,
  designContext: DeckCritiqueDesignContext,
  options: CritiqueOptions = {},
): Promise<SlideCritique> {
  const messages: ChatMessage[] = [
    { role: 'system', content: buildDeckCritiqueSystemPrompt() },
    {
      role: 'user',
      content: buildDeckCritiqueUserPrompt(slide, plan, designContext, options.referenceContext),
    },
  ];
  return critiqueByContent(provider, messages, options);
}

/** 评审整份 `Deck`，逐页返回 `SlideCritique[]`（顺序与 slides 对齐）。 */
export async function critiqueDeck(
  provider: AIModelProvider,
  deck: Deck,
  plans: SlidePlan[] | undefined,
  designContext: DeckCritiqueDesignContext,
  options: CritiqueOptions = {},
): Promise<SlideCritique[]> {
  return Promise.all(
    deck.slides.map((s, i) => critiqueDeckSlide(provider, s, plans?.[i], designContext, options)),
  );
}

/** 由 `Deck.theme` 推导评审设计上下文（供 render-flag 阶段直接复用）。 */
export function deckCritiqueContextFromDeck(deck: Deck): DeckCritiqueDesignContext {
  const t = deck.theme;
  return {
    style: (t?.style as string) ?? 'business',
    primaryColor: t?.primary ?? '#2563eb',
    fontFamily: t?.fontFamily ?? 'Inter, "PingFang SC", "Microsoft YaHei", sans-serif',
    iconStyle: 'auto',
  };
}

// 复用 HTML 路径的 feedback 构造（评审结果结构同构，无需重复实现）。
export { buildCritiqueFeedback };
