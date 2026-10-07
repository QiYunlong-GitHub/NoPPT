import {
  DECK_BODY_RECT,
  DECK_FONT_SIZE,
  DECK_GAP,
  DECK_NEUTRAL,
  fitTextRect,
  measureText,
  type LayoutFn,
  bulletList,
  gradientFill,
  imageNode,
  para,
  shapeNode,
  solid,
  splitH,
  splitTitleBody,
  textNode,
  tint,
  titleBlock,
} from './layout-primitives';
import type { DeckNode, DeckParagraph, DeckRect } from '@noppt/core/deck';
import type { SlidePlan } from '../../../types';

/** 封面：居中海报级构图 + ≥2 个装饰元素（对齐 cover.ts 的真实数值）。 */
const layoutCover: LayoutFn = (sp, ctx) => {
  const nodes: DeckNode[] = [];
  nodes.push(
    shapeNode({ x: 840, y: 0, w: 440, h: 440 }, 'ellipse', {
      fill: tint(ctx.primary, '30'),
      role: 'decoration',
    }),
  );
  nodes.push(
    shapeNode({ x: 0, y: 440, w: 480, h: 280 }, 'rect', {
      fill: tint(ctx.primary, '18'),
      role: 'decoration',
    }),
  );
  nodes.push(
    shapeNode({ x: 80, y: 144, w: 3, h: 432 }, 'rect', {
      fill: solid(ctx.primary),
      role: 'decoration',
    }),
  );

  const kp = sp.keyPoints ?? [];
  const titleRect = {
    x: 64,
    y: ctx.viewportProfile === 'narrow' ? 224 : 232,
    w: 1152,
    h: ctx.viewportProfile === 'narrow' ? 144 : 160,
  };
  const titleFit = fitTextRect(sp.title || '', titleRect, {
    fontSize: ctx.viewportProfile === 'narrow' ? 72 : DECK_FONT_SIZE.h1,
    minFontSize: 38,
    lineHeight: 1.08,
    fontFamily: ctx.fontFamily,
  });
  nodes.push(
    textNode(
      titleFit.rect,
      [para(sp.title || '', {
        bold: true,
        size: titleFit.fontSize,
        align: 'center',
        color: ctx.primary,
        lineSpacing: titleFit.lineHeight / Math.max(1, titleFit.fontSize),
      })],
      {
        align: 'center',
        valign: 'middle',
        role: 'title',
        contentId: `slide-${(sp as SlidePlan & { _index?: number })._index !== undefined ? (sp as SlidePlan & { _index?: number })._index! + 1 : 1}-title`,
        source: 'plan',
        autoFit: titleFit.status !== 'pass',
      },
    ),
  );
  nodes.push(
    shapeNode({ x: 550, y: 376, w: 180, h: 8 }, 'roundRect', {
      fill: gradientFill(ctx.primary, ctx.primaryDark),
      radius: 0.5,
      role: 'decoration',
    }),
  );
  if (kp[0]) {
    nodes.push(
      textNode(
        { x: 64, y: 408, w: 1152, h: 48 },
        [para(kp[0], { bold: true, size: 32, align: 'center', color: ctx.primary })],
        { align: 'center', role: 'subtitle', contentId: `slide-${((sp as SlidePlan & { _index?: number })._index ?? 0) + 1}-cover-1`, source: 'plan' },
      ),
    );
  }
  if (kp[1]) {
    nodes.push(
      textNode(
        { x: 64, y: 456, w: 1152, h: 40 },
        [para(kp[1], { size: 24, align: 'center', color: DECK_NEUTRAL.ink })],
        { align: 'center', role: 'subtitle', contentId: `slide-${((sp as SlidePlan & { _index?: number })._index ?? 0) + 1}-cover-2`, source: 'plan' },
      ),
    );
  }
  if (kp[2]) {
    nodes.push(
      textNode(
        { x: 64, y: 504, w: 1152, h: 40 },
        [para(kp[2], { size: 18, align: 'center', color: ctx.primary })],
        { align: 'center', role: 'kicker', contentId: `slide-${((sp as SlidePlan & { _index?: number })._index ?? 0) + 1}-cover-3`, source: 'plan' },
      ),
    );
  }
  return nodes;
};

/** 目录：H2 + 垂直居中的条目行（44px 图标位 + 20px 文字，行高 72，gap 24）。 */
const layoutToc: LayoutFn = (sp, ctx) => {
  const nodes: DeckNode[] = [titleBlock(sp, ctx)];
  const items = (sp.keyPoints ?? []).slice(0, 8);
  if (items.length === 0) return nodes;
  const rowH = 72;
  const total = items.length * rowH + (items.length - 1) * DECK_GAP;
  const y0 = DECK_BODY_RECT.y + Math.max(0, Math.round((DECK_BODY_RECT.h - total) / 2));
  items.forEach((t, i) => {
    const y = y0 + i * (rowH + DECK_GAP);
    nodes.push(
      shapeNode({ x: DECK_BODY_RECT.x, y, w: DECK_BODY_RECT.w, h: rowH }, 'roundRect', {
        fill: tint(ctx.primary, '08'),
        radius: 0.35,
      }),
    );
    nodes.push(
      textNode(
        { x: DECK_BODY_RECT.x + 32, y, w: DECK_BODY_RECT.w - 64, h: rowH },
        [para(t, { bold: true, size: DECK_FONT_SIZE.body, color: DECK_NEUTRAL.ink })],
        { valign: 'middle' },
      ),
    );
  });
  return nodes;
};

/** 图文左右混排。 */
function layoutImageSide(side: 'left' | 'right'): LayoutFn {
  return (sp, ctx) => {
    const nodes: DeckNode[] = [titleBlock(sp, ctx)];
    const items = sp.keyPoints ?? [];
    const needImg = sp.needsImage !== false;
    if (needImg) {
      const [a, b] = splitH(DECK_BODY_RECT, [45, 55], 40);
      const imgRect = side === 'left' ? a : b;
      const textRect = side === 'left' ? b : a;
      nodes.push(imageNode(imgRect, sp.imagePrompt || sp.title));
      nodes.push(bulletList(textRect, items, { size: DECK_FONT_SIZE.body }));
    } else {
      nodes.push(bulletList(DECK_BODY_RECT, items, { size: DECK_FONT_SIZE.body }));
    }
    return nodes;
  };
}

/** 图上文下：图高随要点数变化（N≤2→45%，N=3→40%，N≥4→33%）。 */
const layoutImageTop: LayoutFn = (sp, ctx) => {
  const nodes: DeckNode[] = [titleBlock(sp, ctx)];
  const items = sp.keyPoints ?? [];
  const n = items.length;
  const needImg = sp.needsImage !== false;
  let listRect = DECK_BODY_RECT;
  if (needImg) {
    const ratio = n <= 2 ? 0.45 : n === 3 ? 0.4 : 0.33;
    const imgH = Math.round(DECK_BODY_RECT.h * ratio);
    nodes.push(
      imageNode(
        { x: DECK_BODY_RECT.x, y: DECK_BODY_RECT.y, w: DECK_BODY_RECT.w, h: imgH },
        sp.imagePrompt || sp.title,
      ),
    );
    listRect = {
      x: DECK_BODY_RECT.x,
      y: DECK_BODY_RECT.y + imgH + 16,
      w: DECK_BODY_RECT.w,
      h: Math.max(0, DECK_BODY_RECT.h - imgH - 16),
    };
  }
  if (n >= 4) {
    const [c1, c2] = splitH(listRect, [1, 1], DECK_GAP);
    const half = Math.ceil(n / 2);
    nodes.push(bulletList(c1, items.slice(0, half), { size: DECK_FONT_SIZE.bodySm }));
    nodes.push(bulletList(c2, items.slice(half), { size: DECK_FONT_SIZE.bodySm }));
  } else {
    nodes.push(bulletList(listRect, items, { size: DECK_FONT_SIZE.body }));
  }
  return nodes;
};

/** 纯文字（N≥6 双列）。 */
const layoutNoImage: LayoutFn = (sp, ctx) => {
  const nodes: DeckNode[] = [titleBlock(sp, ctx)];
  const items = sp.keyPoints ?? [];
  if (items.length >= 6) {
    const [c1, c2] = splitH(DECK_BODY_RECT, [1, 1], DECK_GAP);
    const half = Math.ceil(items.length / 2);
    nodes.push(bulletList(c1, items.slice(0, half), { size: DECK_FONT_SIZE.bodySm }));
    nodes.push(bulletList(c2, items.slice(half), { size: DECK_FONT_SIZE.bodySm }));
  } else {
    nodes.push(bulletList(DECK_BODY_RECT, items, { size: DECK_FONT_SIZE.body }));
  }
  return nodes;
};

/** 卡片网格：按内容度量选择列数和行高，窄屏最多两列。 */
interface LayoutCardItem {
  contentId?: string;
  title?: string;
  body: string;
  compact?: boolean;
  legacyDerived?: boolean;
}

function cardText(value: unknown): string {
  return typeof value === 'string' ? value : String(value ?? '');
}

function cardDemand(item: LayoutCardItem, cellW: number): number {
  const innerW = Math.max(24, cellW - 64);
  const title = cardText(item.title);
  const body = cardText(item.body);
  const content = body.trim() || title.trim();
  if (!content) return 48;
  if (!title.trim() || !body.trim()) {
    return 48 + measureText(content, {
      fontSize: DECK_FONT_SIZE.body,
      maxWidth: innerW,
      lineHeight: 1.2,
    }).height;
  }
  const titleHeight = measureText(title, {
    fontSize: DECK_FONT_SIZE.h3,
    maxWidth: innerW,
    lineHeight: 1.12,
  }).height;
  const bodyHeight = measureText(body, {
    fontSize: DECK_FONT_SIZE.body,
    maxWidth: innerW,
    lineHeight: 1.2,
  }).height;
  return 48 + titleHeight + 8 + bodyHeight;
}

function defaultCardColumns(count: number): number {
  if (count <= 2) return Math.max(1, count);
  if (count === 3) return 3;
  if (count === 4) return 2;
  return count % 3 === 0 ? 3 : 2;
}

function rowDemands(items: LayoutCardItem[], cols: number, cellW: number): number[] {
  const rows = Math.ceil(items.length / cols);
  return Array.from({ length: rows }, (_, row) => Math.max(
    48,
    ...items.slice(row * cols, (row + 1) * cols).map((item) => cardDemand(item, cellW)),
  ));
}

function chooseCardColumns(
  items: LayoutCardItem[],
  sp: SlidePlan,
  ctx: Parameters<LayoutFn>[1],
  gap: number,
): number {
  const preferred = sp.layoutParams?.gridCols && sp.layoutParams.gridCols !== 'auto'
    ? Number(sp.layoutParams.gridCols)
    : defaultCardColumns(items.length);
  const maxColumns = ctx.viewportProfile === 'narrow' ? 2 : 4;
  const start = Math.max(1, Math.min(maxColumns, preferred));
  let firstSafe = 1;
  for (let cols = start; cols >= 1; cols -= 1) {
    const cellW = Math.floor((DECK_BODY_RECT.w - gap * (cols - 1)) / cols);
    const demands = rowDemands(items, cols, cellW);
    const total = demands.reduce((sum, height) => sum + height, 0) + gap * Math.max(0, demands.length - 1);
    if (total <= DECK_BODY_RECT.h) {
      firstSafe = cols;
      // Narrow layouts prefer one column once measured cards become dense. This
      // keeps long strategy bodies readable without inventing a new card type.
      const denseNarrowRow = ctx.viewportProfile === 'narrow' && cols > 1
        && Math.max(...demands) > DECK_BODY_RECT.h * 0.28;
      if (!denseNarrowRow) return cols;
    }
  }
  return firstSafe;
}

const layoutCards: LayoutFn = (sp, ctx) => {
  const nodes: DeckNode[] = [titleBlock(sp, ctx)];
  const typedItems = Array.isArray(sp.cardItems) && sp.cardItems.length > 0
    ? sp.cardItems.map((item) => ({ ...item }))
    : undefined;
  const items: LayoutCardItem[] = typedItems ?? (sp.keyPoints ?? []).map((body, index) => ({
    contentId: `legacy-card-${index + 1}`,
    body,
    compact: true,
    legacyDerived: true,
  }));
  if (items.length === 0) return nodes;

  const gap = ctx.viewportProfile === 'narrow' ? 16 : DECK_GAP;
  const cols = chooseCardColumns(items, sp, ctx, gap);
  const cellW = Math.floor((DECK_BODY_RECT.w - gap * (cols - 1)) / cols);
  const demands = rowDemands(items, cols, cellW);
  const rowRects: DeckRect[] = [];
  let y = DECK_BODY_RECT.y;
  demands.forEach((height) => {
    const rowHeight = Math.min(height, DECK_BODY_RECT.y + DECK_BODY_RECT.h - y);
    rowRects.push({ x: DECK_BODY_RECT.x, y, w: DECK_BODY_RECT.w, h: Math.max(24, rowHeight) });
    y += rowHeight + gap;
  });

  items.forEach((item, index) => {
    const row = Math.floor(index / cols);
    const column = index % cols;
    const rowRect = rowRects[row];
    const cell: DeckRect = {
      x: DECK_BODY_RECT.x + column * (cellW + gap),
      y: rowRect.y,
      w: cellW,
      h: rowRect.h,
    };
    const title = cardText(item.title);
    const body = cardText(item.body);
    const hasTitle = Boolean(title.trim());
    const hasBody = Boolean(body.trim());
    const singleText = !hasTitle || !hasBody;
    const content = hasBody ? body : title;
    const contentId = item.contentId || `legacy-card-${index + 1}`;
    const source = item.legacyDerived || !typedItems ? 'legacy' : 'plan';

    nodes.push(
      shapeNode(cell, 'roundRect', {
        fill: solid(DECK_NEUTRAL.cardBg),
        line: { color: DECK_NEUTRAL.border, width: 1 },
        radius: 0.12,
      }),
    );

    if (singleText) {
      if (!content.trim()) return;
      const contentFit = fitTextRect(content, {
        x: cell.x + 32,
        y: cell.y + 24,
        w: cell.w - 64,
        h: Math.max(24, cell.h - 48),
      }, {
        fontSize: DECK_FONT_SIZE.body,
        minFontSize: DECK_FONT_SIZE.bodySm,
        lineHeight: 1.2,
        fontFamily: ctx.fontFamily,
      });
      nodes.push(textNode(contentFit.rect, [para(content, {
        bold: hasTitle,
        size: contentFit.fontSize,
        color: hasTitle ? ctx.primary : ctx.text,
      })], {
        contentId,
        role: 'content',
        source,
        autoFit: contentFit.status !== 'pass',
      }));
      return;
    }

    const titleMeasurement = measureText(title, {
      fontSize: DECK_FONT_SIZE.h3,
      maxWidth: cell.w - 64,
      lineHeight: 1.12,
      fontFamily: ctx.fontFamily,
    });
    const titleHeight = Math.max(24, Math.min(
      Math.max(24, cell.h - 48),
      titleMeasurement.height,
    ));
    const titleFit = fitTextRect(title, {
      x: cell.x + 32,
      y: cell.y + 24,
      w: cell.w - 64,
      h: titleHeight,
    }, {
      fontSize: DECK_FONT_SIZE.h3,
      minFontSize: DECK_FONT_SIZE.bodySm,
      lineHeight: 1.12,
      fontFamily: ctx.fontFamily,
    });
    nodes.push(textNode(titleFit.rect, [para(title, { bold: true, size: titleFit.fontSize, color: ctx.primary })], {
      contentId,
      role: 'content',
      source,
      autoFit: titleFit.status !== 'pass',
    }));

    const bodyY = titleFit.rect.y + titleFit.rect.h + 8;
    const bodyFit = fitTextRect(body, {
      x: cell.x + 32,
      y: bodyY,
      w: cell.w - 64,
      h: Math.max(24, cell.y + cell.h - bodyY - 24),
    }, {
      fontSize: DECK_FONT_SIZE.body,
      minFontSize: DECK_FONT_SIZE.bodySm,
      lineHeight: 1.2,
      fontFamily: ctx.fontFamily,
    });
    nodes.push(textNode(bodyFit.rect, [para(body, { size: bodyFit.fontSize, color: ctx.text })], {
      contentId,
      role: 'content',
      source,
      autoFit: bodyFit.status !== 'pass',
    }));
  });
  return nodes;
};

/** 双栏对比：按 typed column/order 渲染等高语义行（gap 32）。 */
const layoutCompare: LayoutFn = (sp, ctx) => {
  const nodes: DeckNode[] = [titleBlock(sp, ctx)];
  const typedItems = Array.isArray(sp.comparisonItems) && sp.comparisonItems.length > 0 ? sp.comparisonItems : undefined;
  const items = typedItems ?? (sp.keyPoints ?? []).map((text, index) => {
    const half = Math.ceil((sp.keyPoints ?? []).length / 2);
    return {
      contentId: `legacy-compare-${index + 1}`,
      text,
      column: index < half ? 'left' as const : 'right' as const,
      order: index < half ? index : index - half,
      bullet: true,
      legacyDerived: true,
    };
  });
  const leftItems = items.filter((item) => item.column === 'left').sort((a, b) => a.order - b.order);
  const rightItems = items.filter((item) => item.column === 'right').sort((a, b) => a.order - b.order);
  const [left, right] = splitH(DECK_BODY_RECT, [1, 1], 32);
  nodes.push({
    ...shapeNode(left, 'roundRect', {
      fill: solid(DECK_NEUTRAL.cardBg),
      line: { color: DECK_NEUTRAL.border, width: 2 },
      radius: 0.1,
    }),
    contentColumn: 'left',
  });
  nodes.push({
    ...shapeNode(right, 'roundRect', {
      fill: tint(ctx.primary, '08'),
      line: { color: ctx.primary, width: 2 },
      radius: 0.1,
    }),
    contentColumn: 'right',
  });
  const leftRect = { x: left.x + 32, y: left.y + 32, w: left.w - 64, h: left.h - 64 };
  const rightRect = { x: right.x + 32, y: right.y + 32, w: right.w - 64, h: right.h - 64 };
  const rowCount = Math.max(leftItems.length, rightItems.length, 1);
  const rowGap = 16;
  const rowHeight = Math.max(24, Math.floor((leftRect.h - rowGap * (rowCount - 1)) / rowCount));

  const addColumnItems = (column: 'left' | 'right', columnItems: typeof items, rect: DeckRect) => {
    columnItems.forEach((item) => {
      const itemRect: DeckRect = {
        x: rect.x,
        y: rect.y + item.order * (rowHeight + rowGap),
        w: rect.w,
        h: rowHeight,
      };
      const fit = fitTextRect(item.text, itemRect, {
        fontSize: 22,
        minFontSize: 16,
        lineHeight: 1.2,
        fontFamily: ctx.fontFamily,
      });
      nodes.push(
        textNode(
          fit.rect,
          [para(item.text, {
            size: fit.fontSize,
            color: column === 'right' ? ctx.text : undefined,
            bullet: item.bullet,
            spaceAfter: 0,
          })],
          {
            contentId: item.contentId,
            contentColumn: column,
            contentOrder: item.order,
            bullet: item.bullet,
            source: item.legacyDerived ? 'legacy' : 'plan',
            autoFit: fit.status !== 'pass',
          },
        ),
      );
    });
  };
  addColumnItems('left', leftItems, leftRect);
  addColumnItems('right', rightItems, rightRect);
  return nodes;
};

/** 时间轴：左侧竖轴 + N 段。 */
const layoutTimeline: LayoutFn = (sp, ctx) => {
  const nodes: DeckNode[] = [titleBlock(sp, ctx)];
  const items = sp.keyPoints ?? [];
  const n = Math.max(1, items.length);
  nodes.push(
    shapeNode(
      {
        x: DECK_BODY_RECT.x + 27,
        y: DECK_BODY_RECT.y + 16,
        w: 4,
        h: Math.max(0, DECK_BODY_RECT.h - 32),
      },
      'rect',
      { fill: tint(ctx.primary, '40'), role: 'decoration' },
    ),
  );
  const rowH = Math.round((DECK_BODY_RECT.h - DECK_GAP * (n - 1)) / n);
  items.forEach((t, i) => {
    const y = DECK_BODY_RECT.y + i * (rowH + DECK_GAP);
    const { title, body } = splitTitleBody(t);
    const ps: DeckParagraph[] = [para(title, { bold: true, size: 22, color: ctx.primary })];
    if (body) ps.push(para(body, { size: DECK_FONT_SIZE.bodySm, color: ctx.textMuted }));
    nodes.push(textNode({ x: DECK_BODY_RECT.x + 56, y, w: DECK_BODY_RECT.w - 56, h: rowH }, ps));
  });
  return nodes;
};

/** 表格：从 keyPoints 解析（支持 `列1 | 列2`），否则退化为「项目 / 说明」两列。 */
const layoutTable: LayoutFn = (sp, ctx) => {
  const nodes: DeckNode[] = [titleBlock(sp, ctx)];
  const items = sp.keyPoints ?? [];
  const rows: Array<Array<{ text: string }>> = [[{ text: '项目' }, { text: '说明' }]];
  for (const it of items) {
    const parts = it.split(/[|｜]/).map((s) => s.trim());
    if (parts.length >= 2) rows.push([{ text: parts[0] }, { text: parts.slice(1).join(' / ') }]);
    else rows.push([{ text: String(rows.length) }, { text: it }]);
  }
  nodes.push({
    kind: 'table',
    rect: DECK_BODY_RECT,
    rows,
    header: true,
    border: { color: DECK_NEUTRAL.border, width: 1 },
    fontSize: DECK_FONT_SIZE.bodySm,
  });
  return nodes;
};

/** 结束页：80×6 主色短条 + 72px 标题 + 24px 副标。 */
const layoutSummary: LayoutFn = (sp, ctx) => {
  const nodes: DeckNode[] = [];
  nodes.push(
    shapeNode({ x: 600, y: 216, w: 80, h: 6 }, 'rect', {
      fill: solid(ctx.primary),
      role: 'decoration',
    }),
  );
  const titleFit = fitTextRect(sp.title || '谢谢', { x: 64, y: 242, w: 1152, h: 104 }, {
    fontSize: ctx.viewportProfile === 'narrow' ? 56 : 72,
    minFontSize: 36,
    lineHeight: 1.1,
    fontFamily: ctx.fontFamily,
  });
  nodes.push(
    textNode(
      titleFit.rect,
      [para(sp.title || '谢谢', {
        bold: true,
        size: titleFit.fontSize,
        align: 'center',
        color: ctx.primary,
      })],
      { align: 'center', valign: 'middle', role: 'title', autoFit: titleFit.status !== 'pass' },
    ),
  );
  const summaryItems = Array.isArray(sp.summaryItems) && sp.summaryItems.length > 0
    ? sp.summaryItems
    : (sp.keyPoints ?? []).map((text, index) => ({
      contentId: `legacy-summary-${index + 1}`,
      text,
      role: 'point' as const,
      legacyDerived: true,
    }));
  const visibleSummaryItems = summaryItems.filter((item) => Boolean(item.text?.trim()));
  if (visibleSummaryItems.length > 0) {
    const summaryRect = { x: 64, y: 370, w: 1152, h: 250 };
    const gap = visibleSummaryItems.length > 1 ? 12 : 0;
    const itemHeight = Math.max(32, (summaryRect.h - gap * Math.max(0, visibleSummaryItems.length - 1)) / visibleSummaryItems.length);
    const fontSize = ctx.viewportProfile === 'narrow' ? 20 : 24;
    visibleSummaryItems.forEach((item, index) => {
      const rect = {
        x: summaryRect.x,
        y: summaryRect.y + index * (itemHeight + gap),
        w: summaryRect.w,
        h: itemHeight,
      };
      const summaryFit = fitTextRect(item.text, rect, {
        fontSize,
        minFontSize: 16,
        lineHeight: 1.2,
        fontFamily: ctx.fontFamily,
      });
      nodes.push(
        textNode(
          summaryFit.rect,
          [para(item.text, {
            size: summaryFit.fontSize,
            align: 'center',
            color: ctx.textMuted,
            bullet: visibleSummaryItems.length > 1,
            spaceAfter: 8,
          })],
          {
            align: 'center',
            role: 'subtitle',
            contentId: item.contentId,
            source: item.legacyDerived ? 'legacy' : 'plan',
            autoFit: summaryFit.status !== 'pass',
          },
        ),
      );
    });
  } else {
    nodes.push(
      textNode(
        { x: 64, y: 370, w: 1152, h: 40 },
        [para('Q & A', { size: 24, align: 'center', color: ctx.textMuted })],
        { align: 'center' },
      ),
    );
  }
  return nodes;
};

export const CONTENT_LAYOUT_BUILDERS: Record<string, LayoutFn> = {
  cover: layoutCover,
  toc: layoutToc,
  'content-image-left': layoutImageSide('left'),
  'content-image-right': layoutImageSide('right'),
  'content-image-top': layoutImageTop,
  'content-no-image': layoutNoImage,
  'content-cards': layoutCards,
  'content-compare': layoutCompare,
  'content-timeline': layoutTimeline,
  'content-table': layoutTable,
  summary: layoutSummary,
};
