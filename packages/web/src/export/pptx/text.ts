/**
 * Deck 富文本 → PptxGenJS `addText` 结构。
 *
 * 借鉴 python-pptx 的 TextFrame → Paragraph → Run 三层模型：
 * - DeckParagraph → PptxGenJS 的一个 `{ text: [...], options }` 项（breakLine 控制换行）
 * - DeckTextRun → PptxGenJS 的 `{ text, options }`（bold / italic / 字号 / 颜色 / 超链接）
 */

import type { DeckParagraph, DeckTextRun } from '@noppt/core/deck';
import { pptxColor, DEFAULT_PPTX_FONT_FACE } from './attrs';

export interface PptxTextRun {
  text: string;
  options?: Record<string, unknown>;
}

export interface PptxTextItem {
  text: string | PptxTextRun[];
  options?: Record<string, unknown>;
}

export interface TextRenderContext {
  /** 主题字体族，缺省用 `DEFAULT_PPTX_FONT_FACE`。 */
  fontFace?: string;
  /** 默认文字色。 */
  defaultColor?: string;
}

function runToPptx(r: DeckTextRun, ctx: TextRenderContext): PptxTextRun {
  const options: Record<string, unknown> = {
    fontFace: r.fontFace || ctx.fontFace || DEFAULT_PPTX_FONT_FACE,
  };
  if (typeof r.fontSize === 'number' && r.fontSize > 0) options.fontSize = Math.round(r.fontSize);
  if (r.bold) options.bold = true;
  if (r.italic) options.italic = true;
  if (r.underline) options.underline = true;
  options.color = pptxColor(r.color, ctx.defaultColor || '000000');
  if (typeof r.charSpacing === 'number') options.charSpacing = r.charSpacing;
  if (r.hyperlink) options.hyperlink = r.hyperlink;
  return { text: r.text, options };
}

/**
 * Deck 段落数组 → PptxGenJS 期望的「扁平 runs 数组」（`[{ text, options }]`）。
 *
 * 关键：PptxGenJS 的 `addText`、`addTable` 单元格与母版 `text.text` 都希望第一个实参
 * 本身就是 runs 数组，**不能**包成 `{ text: runs[], options }`（否则被 `String()` 成
 * `[object Object]`）。段落分隔通过在每段最后一个 run 上置 `breakLine: true` 实现；
 * 段落级选项（align / bullet / 缩进 / 段距 / 行距）合并进该段每个 run 的 options。
 */
export function paragraphsToPptxText(
  paragraphs: DeckParagraph[],
  ctx: TextRenderContext = {},
): PptxTextRun[] {
  const out: PptxTextRun[] = [];
  paragraphs.forEach((p, pi) => {
    const isLastParagraph = pi === paragraphs.length - 1;
    const paraOpts: Record<string, unknown> = {};
    // PptxGenJS 的 align 只接受 left / center / right
    if (p.align === 'center' || p.align === 'right') paraOpts.align = p.align;
    else if (p.align === 'justify') paraOpts.align = 'left';
    if (typeof p.level === 'number' && p.level > 0) paraOpts.indentLevel = Math.min(4, p.level);
    if (typeof p.spaceAfter === 'number') paraOpts.paraSpaceAfter = p.spaceAfter;
    if (typeof p.lineSpacing === 'number') paraOpts.lineSpacingMultiple = p.lineSpacing;
    p.runs.forEach((r, ri) => {
      const opts: Record<string, unknown> = { ...runToPptx(r, ctx).options, ...paraOpts };
      if (p.bullet && ri === 0) opts.bullet = true;
      if (!isLastParagraph && ri === p.runs.length - 1) opts.breakLine = true;
      out.push({ text: r.text, options: opts });
    });
  });
  return out;
}

/** 纯文本快捷构造（备注、占位提示等），返回单 run 的 runs 数组。 */
export function plainText(text: string, ctx: TextRenderContext = {}): PptxTextRun[] {
  return [{ text, options: { fontFace: ctx.fontFace || DEFAULT_PPTX_FONT_FACE } }];
}
