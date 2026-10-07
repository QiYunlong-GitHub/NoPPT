/**
 * Deck 母版 → `pptx.defineSlideMaster()`。
 *
 * 借鉴 PptxGenJS 的母版机制：定义后母版会成为 PowerPoint 中**一等公民的 Layout**，
 * 用户可在「视图 → 幻灯片母版」里二次编辑品牌元素（背景 / logo / 页脚 / 页码）。
 * 这也是解决 NoPPT 逐页独立生成导致**跨页风格漂移**的关键：
 * deck 级元素只写一次，所有页共享。
 *
 * PptxGenJS 母版 objects 支持的类型有限（chart / image / line / rect / text / placeholder），
 * 因此 Deck 节点按能力降级映射，表格与分组节点不进母版。
 */

import { rectToInch, type DeckMaster, type DeckNode } from '@noppt/core/deck';
import { toPptxFill, toPptxLine } from './attrs';
import { paragraphsToPptxText, type TextRenderContext } from './text';

/** DeckPlaceholder.type → PptxGenJS PLACEHOLDER_TYPE。 */
const PLACEHOLDER_TYPE_MAP: Record<string, string> = {
  title: 'title',
  body: 'body',
  image: 'pic',
  chart: 'chart',
  table: 'tbl',
  media: 'media',
};

function nodeToMasterObject(
  node: DeckNode,
  ctx: TextRenderContext,
): Record<string, unknown> | null {
  switch (node.kind) {
    case 'text':
      return {
        text: {
          text: paragraphsToPptxText(node.paragraphs, ctx),
          options: { ...rectToInch(node.rect), ...(node.align ? { align: node.align } : {}) },
        },
      };
    case 'shape': {
      const options: Record<string, unknown> = { ...rectToInch(node.rect) };
      const fill = toPptxFill(node.fill);
      if (fill) options.fill = fill;
      const line = toPptxLine(node.line);
      if (line) options.line = line;
      // 母版只支持 rect / line 两种形状容器，其余按 rect 承载
      return node.shape === 'line' ? { line: options } : { rect: options };
    }
    case 'image':
      return { image: { data: node.src, ...rectToInch(node.rect) } };
    case 'chart':
    case 'table':
    case 'group':
      // PptxGenJS 母版不支持这三类，跳过（内容仍在各页本体上渲染）
      return null;
    default:
      return null;
  }
}

/**
 * 定义母版并返回其名称。
 * 当 `master` 为空或无可渲染对象时返回 `undefined`（各页退化为默认版式）。
 */
export function defineDeckMaster(
  pptx: { defineSlideMaster: Function },
  master: DeckMaster | undefined,
  ctx: TextRenderContext,
): string | undefined {
  if (!master?.title) return undefined;

  const objects: Array<Record<string, unknown>> = [];
  for (const node of master.objects ?? []) {
    const obj = nodeToMasterObject(node, ctx);
    if (obj) objects.push(obj);
  }
  for (const ph of master.placeholders ?? []) {
    objects.push({
      placeholder: {
        options: {
          name: ph.name,
          type: PLACEHOLDER_TYPE_MAP[ph.type] ?? 'body',
          ...rectToInch(ph.rect),
        },
        ...(ph.text ? { text: ph.text } : {}),
      },
    });
  }

  const props: Record<string, unknown> = { title: master.title, objects };
  const bg = toPptxFill(master.background);
  if (bg?.color) props.background = bg.color;
  if (master.margin?.length === 4) {
    props.margin = master.margin.map((m) => m / 96);
  }
  if (master.slideNumber) {
    props.slideNumber = {
      ...rectToInch({
        x: master.slideNumber.x,
        y: master.slideNumber.y,
        w: master.slideNumber.w ?? 80,
        h: master.slideNumber.h ?? 32,
      }),
      ...(master.slideNumber.align ? { align: master.slideNumber.align } : {}),
      ...(master.slideNumber.color ? { color: master.slideNumber.color } : {}),
      ...(master.slideNumber.fontSize ? { fontSize: master.slideNumber.fontSize } : {}),
    };
  }

  try {
    pptx.defineSlideMaster(props);
    return master.title;
  } catch {
    return undefined;
  }
}
