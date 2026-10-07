/**
 * Deck 形状节点 → `slide.addShape()`。
 *
 * 借鉴 PptxGenJS 的 `ShapeType`（近 200 种 preset geometry）：
 * `DeckShapeType` 的取值本身就是 OOXML `a:prstGeom` 的 preset 名，可原样透传。
 */

import {
  DECK_SHAPE_TO_PPTX,
  rectToInch,
  type DeckRect,
  type DeckShapeNode,
} from '@noppt/core/deck';
import { toPptxFill, toPptxLine, toPptxShadow } from './attrs';
import { paragraphsToPptxText, type TextRenderContext } from './text';

/** PPTX 侧形状名（恒等映射到 OOXML preset）。 */
export function pptxShapeName(shape: DeckShapeNode['shape']): string {
  return DECK_SHAPE_TO_PPTX[shape] ?? DECK_SHAPE_TO_PPTX.rect;
}

/** 渲染形状节点；带文本时用 `addText({shape})`，否则用 `addShape()`。 */
export function renderShapeNode(
  slide: { addShape: Function; addText: Function },
  node: DeckShapeNode,
  ctx: TextRenderContext,
): void {
  const pos = rectToInch(node.rect as DeckRect);
  const common: Record<string, unknown> = { ...pos };
  if (typeof node.rotate === 'number' && node.rotate !== 0) common.rotate = node.rotate;
  const fill = toPptxFill(node.fill);
  if (fill) common.fill = fill;
  const line = toPptxLine(node.line);
  if (line) common.line = line;
  const shadow = toPptxShadow(node.shadow);
  if (shadow) common.shadow = shadow;
  if (typeof node.rectRadius === 'number') common.rectRadius = node.rectRadius;

  const paragraphs = node.text ?? [];
  if (paragraphs.length > 0) {
    // 形状内文本：PptxGenJS 用 addText + shape 选项
    slide.addText(paragraphsToPptxText(paragraphs, ctx), {
      ...common,
      shape: pptxShapeName(node.shape),
      valign: node.valign ?? 'middle',
      align: 'center',
    });
    return;
  }
  slide.addShape(pptxShapeName(node.shape), common);
}
