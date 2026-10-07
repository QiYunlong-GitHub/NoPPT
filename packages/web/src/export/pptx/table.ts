/**
 * Deck 表格节点 → `slide.addTable()`。
 *
 * 借鉴 PptxGenJS 的表格能力：`colW` / `rowH` / 单元格级 fill / color / bold /
 * align / valign / colspan / rowspan / border。
 */

import { pxToIn, rectToInch, type DeckRect, type DeckTableNode } from '@noppt/core/deck';
import { toPptxFill, toPptxLine } from './attrs';
import { paragraphsToPptxText, type PptxTextItem, type TextRenderContext } from './text';

interface PptxTableCell {
  text?: string | PptxTextItem[];
  options?: Record<string, unknown>;
}

/** 渲染表格节点。 */
export function renderTableNode(
  slide: { addTable: Function },
  node: DeckTableNode,
  ctx: TextRenderContext,
): void {
  const pos = rectToInch(node.rect as DeckRect);
  const rows: PptxTableCell[][] = (node.rows ?? []).map((row, ri) =>
    row.map((cell) => {
      const options: Record<string, unknown> = {};
      const fill = toPptxFill(cell.fill);
      if (fill) options.fill = fill;
      if (cell.color) options.color = cell.color;
      if (cell.bold) options.bold = true;
      if (typeof cell.fontSize === 'number') options.fontSize = cell.fontSize;
      if (cell.fontFace) options.fontFace = cell.fontFace;
      if (cell.align === 'center' || cell.align === 'right') options.align = cell.align;
      if (cell.valign) options.valign = cell.valign;
      if (typeof cell.colspan === 'number' && cell.colspan > 1) options.colspan = cell.colspan;
      if (typeof cell.rowspan === 'number' && cell.rowspan > 1) options.rowspan = cell.rowspan;
      // 表头行（首行）默认加粗
      if (node.header && ri === 0) options.bold = true;

      if (cell.paragraphs?.length) {
        return { text: paragraphsToPptxText(cell.paragraphs, ctx), options };
      }
      return { text: cell.text ?? '', options };
    }),
  );

  if (rows.length === 0) return;

  const opts: Record<string, unknown> = {
    ...pos,
    fontSize: node.fontSize ?? 14,
    fontFace: ctx.fontFace,
    border: toPptxLine(node.border) ?? { type: 'solid', color: 'E5E7EB', pt: 1 },
  };
  // 列宽：px → inch
  if (node.colW?.length) opts.colW = node.colW.map((w) => pxToIn(w));
  if (node.rowH?.length) opts.rowH = node.rowH.map((h) => pxToIn(h));

  slide.addTable(rows, opts);
}
