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
  cardSurface,
  panelSurface,
  splitH,
  splitTitleBody,
  textNode,
  tint,
  titleBlock,
} from './layout-primitives';
import type { DeckNode, DeckParagraph, DeckRect } from '@noppt/core/deck';
import type { SlidePlan } from '../../../types';
import { densityGap, fillRowRects } from './content-density';

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
  // 页眉安全区短装饰条：不再用贯通竖线切入标题首字。
  nodes.push(
    shapeNode({ x: 64, y: 180, w: 56, h: 6 }, 'rect', {
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
    fontSize: ctx.viewportProfile === 'narrow' ? 36 : DECK_FONT_SIZE.h1,
    minFontSize: 32,
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
  // 封面按新预算承载至多 5 条信息密度断言（结论 + 证据），而不是 3 行短名词短语。
  // 字号维持 44/24/20/18 四档，避免与「同页 ≤4 种字号」冲突。
  const slideNo = ((sp as SlidePlan & { _index?: number })._index ?? 0) + 1;
  const lineTops = [408, 456, 504, 548, 590];
  const lineHeights = [48, 40, 40, 36, 36];
  const lineSizes = [24, 20, 18, 18, 18];
  kp.slice(0, 5).forEach((text, i) => {
    nodes.push(
      textNode(
        { x: 64, y: lineTops[i], w: 1152, h: lineHeights[i] },
        [para(text, {
          bold: i === 0,
          size: lineSizes[i],
          align: 'center',
          color: i === 0 || i === 4 ? ctx.primary : DECK_NEUTRAL.ink,
        })],
        {
          align: 'center',
          role: i < 2 ? 'subtitle' : 'kicker',
          contentId: `slide-${slideNo}-cover-${i + 1}`,
          source: 'plan',
        },
      ),
    );
  });
  return nodes;
};

/** 目录：条目行铺满正文区，每行带主色序号块，避免居中短行留下大片空白。 */
const layoutToc: LayoutFn = (sp, ctx) => {
  const nodes: DeckNode[] = [titleBlock(sp, ctx)];
  const items = (sp.keyPoints ?? []).slice(0, 8);
  if (items.length === 0) return nodes;
  const rows = fillRowRects(DECK_BODY_RECT, items.length, densityGap(ctx));
  items.forEach((t, i) => {
    const row = rows[i];
    nodes.push(
      shapeNode(row, 'roundRect', {
        fill: cardSurface(),
        line: { color: DECK_NEUTRAL.border, width: 1 },
        radius: 0.16,
      }),
    );
    const marker = Math.min(44, Math.max(24, row.h - 24));
    nodes.push(shapeNode(
      { x: row.x + 24, y: row.y + Math.round((row.h - marker) / 2), w: marker, h: marker },
      'roundRect', { fill: solid(ctx.primary), radius: 0.5 },
    ));
    nodes.push(shapeNode(
      { x: row.x + 24 + marker + 24, y: row.y + row.h - 16, w: Math.max(48, Math.round((row.w - 160) * 0.36)), h: 6 },
      'roundRect', { fill: tint(ctx.primary, '40'), radius: 0.5 },
    ));
    const fit = fitTextRect(t, { x: row.x + marker + 72, y: row.y + 8, w: row.w - marker - 112, h: Math.max(24, row.h - 16) }, {
      fontSize: DECK_FONT_SIZE.body,
      minFontSize: DECK_FONT_SIZE.bodySm,
      lineHeight: 1.2,
      fontFamily: ctx.fontFamily,
    });
    nodes.push(
      textNode(fit.rect, [para(t, { bold: true, size: fit.fontSize, color: DECK_NEUTRAL.ink })], {
        valign: 'middle', autoFit: fit.status !== 'pass',
      }),
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

/**
 * 纯文字页：每条要点展开为独立卡片行（卡片 + 序号块 + 文字），铺满正文区。
 * 旧实现把 N 条要点塞进一个 bulletList textNode，页面只剩 2 个 Deck 节点，
 * 即使文字不变也会留下大片空白 —— 这是 content-no-image 页「太空」的直接原因。
 */
const layoutNoImage: LayoutFn = (sp, ctx) => {
  const nodes: DeckNode[] = [titleBlock(sp, ctx)];
  const items = (sp.keyPoints ?? []).slice(0, 8);
  if (items.length === 0) return nodes;
  const gap = 12;
  const rowH = Math.max(48, Math.floor((DECK_BODY_RECT.h - gap * (items.length - 1)) / items.length));
  items.forEach((item, index) => {
    const y = DECK_BODY_RECT.y + index * (rowH + gap);
    const row: DeckRect = { x: DECK_BODY_RECT.x, y, w: DECK_BODY_RECT.w, h: rowH };
    nodes.push(shapeNode(row, 'roundRect', {
      fill: cardSurface(),
      line: { color: DECK_NEUTRAL.border, width: 1 },
      radius: 0.12,
    }));
    nodes.push(shapeNode(
      { x: row.x + 24, y: y + Math.round((rowH - 32) / 2), w: 32, h: 32 },
      'roundRect', { fill: solid(ctx.primary), radius: 0.5 },
    ));
    const fit = fitTextRect(item, { x: row.x + 76, y: y + 12, w: row.w - 116, h: Math.max(24, rowH - 24) }, {
      fontSize: DECK_FONT_SIZE.body,
      minFontSize: DECK_FONT_SIZE.bodySm,
      lineHeight: 1.2,
      fontFamily: ctx.fontFamily,
    });
    nodes.push(textNode(fit.rect, [para(item, { size: fit.fontSize, color: ctx.text })], {
      valign: 'middle',
      contentId: `no-image-${index + 1}`,
      source: 'plan',
    }));
  });
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
  // 卡片行铺满整个正文安全区：内容少时靠放大卡片消化空间，而不是把卡片缩小后
  // 垂直居中留下大片空白。卡片底色与边框因此成为可见内容，覆盖率不再随字数骤降。
  const rowH = Math.max(48, Math.floor((DECK_BODY_RECT.h - gap * (demands.length - 1)) / demands.length));
  demands.forEach((_height, index) => {
    rowRects.push({
      x: DECK_BODY_RECT.x,
      y: DECK_BODY_RECT.y + index * (rowH + gap),
      w: DECK_BODY_RECT.w,
      h: rowH,
    });
  });

  items.forEach((item, index) => {
    const row = Math.floor(index / cols);
    const column = index % cols;
    const rowRect = rowRects[row];
    // 奇数张卡片在双栏下最后一张通栏作为视觉主角，避免「2×2 + 半个空位」的均分陈列。
    const isHero = cols === 2 && items.length % 2 === 1 && index === items.length - 1;
    const cell: DeckRect = isHero
      ? { x: DECK_BODY_RECT.x, y: rowRect.y, w: DECK_BODY_RECT.w, h: rowRect.h }
      : {
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
        fill: isHero ? panelSurface() : cardSurface(),
        line: { color: isHero ? ctx.primary : DECK_NEUTRAL.border, width: 1 },
        radius: 0.12,
      }),
    );
    // 左侧主色轨 + 底部数据条：复用 shape kind，不增加文字量却提供两类
    // 非文字视觉元素，并把卡片从「一行字」变成有结构的视觉块。
    nodes.push(shapeNode(
      { x: cell.x, y: cell.y + 16, w: 6, h: Math.max(16, cell.h - 32) },
      'roundRect', { fill: solid(ctx.primary), radius: 0.5 },
    ));
    nodes.push(shapeNode(
      { x: cell.x + 32, y: cell.y + cell.h - 20, w: Math.max(48, Math.round((cell.w - 64) * 0.42)), h: 6 },
      'roundRect', { fill: tint(ctx.primary, '40'), radius: 0.5 },
    ));

    if (singleText) {
      if (!content.trim()) return;
      const contentFit = fitTextRect(content, {
        x: cell.x + 32,
        y: cell.y + 24,
        w: cell.w - 64,
        h: Math.max(24, cell.h - 48),
      }, {
        fontSize: isHero ? DECK_FONT_SIZE.h3 : DECK_FONT_SIZE.body,
        minFontSize: DECK_FONT_SIZE.bodySm,
        lineHeight: 1.2,
        fontFamily: ctx.fontFamily,
      });
      nodes.push(textNode(contentFit.rect, [para(content, {
        bold: hasTitle || isHero,
        size: contentFit.fontSize,
        color: hasTitle || isHero ? ctx.primary : ctx.text,
      })], {
        // 单行文字在放大的卡片里垂直居中，避免「顶部一行字 + 大片空卡」。
        valign: 'middle',
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
  const rowCount = Math.max(leftItems.length, rightItems.length, 1);
  const gap = densityGap(ctx);
  const [left, right] = splitH(DECK_BODY_RECT, [1, 1], 32);
  // 左右列完全同规格，避免「左浅底无框 / 右橙粗框」的不对称观感。
  const columnStyle = () => ({
    fill: cardSurface(),
    line: { color: DECK_NEUTRAL.border, width: 2 },
    radius: 0.1,
  });
  nodes.push({ ...shapeNode(left, 'roundRect', columnStyle()), contentColumn: 'left' });
  nodes.push({ ...shapeNode(right, 'roundRect', columnStyle()), contentColumn: 'right' });
  // 列头带 + 底部数据轨：复用 shape kind 增加非文字视觉手段，不新增文本节点。
  const headerH = 48;
  [left, right].forEach((rect) => {
    nodes.push(shapeNode(
      { x: rect.x + 24, y: rect.y + 24, w: rect.w - 48, h: headerH },
      'roundRect', { fill: panelSurface(), radius: 0.3 },
    ));
    nodes.push(shapeNode(
      { x: rect.x + 24, y: rect.y + rect.h - 20, w: Math.round((rect.w - 48) * 0.42), h: 6 },
      'roundRect', { fill: tint(ctx.primary, '40'), radius: 0.5 },
    ));
  });
  // 行铺满列高：内容少时放大行卡而不是 hug content 后留整块空白。
  const rowTop = left.y + 24 + headerH + gap;
  const rowArea: DeckRect = {
    x: left.x + 32,
    y: rowTop,
    w: left.w - 64,
    h: Math.max(48, left.y + left.h - 32 - rowTop),
  };
  const rows = fillRowRects(rowArea, rowCount, gap);
  // 行卡不设 contentColumn，避免打乱 renderCompareNodes 的逐列内容 id 序列。
  [left, right].forEach((rect) => {
    rows.forEach((row) => {
      nodes.push(shapeNode(
        { x: rect.x + 24, y: row.y, w: rect.w - 48, h: row.h },
        'roundRect', {
          fill: cardSurface(),
          line: { color: DECK_NEUTRAL.border, width: 1 },
          radius: 0.16,
        },
      ));
    });
  });
  const leftRect: DeckRect = { x: left.x + 48, y: rowArea.y, w: left.w - 96, h: rowArea.h };
  const rightRect: DeckRect = { x: right.x + 48, y: rowArea.y, w: right.w - 96, h: rowArea.h };

  const addColumnItems = (column: 'left' | 'right', columnItems: typeof items, rect: DeckRect) => {
    columnItems.forEach((item) => {
      const row = rows[Math.min(Math.max(0, item.order), rows.length - 1)];
      const itemRect: DeckRect = { x: rect.x, y: row.y, w: rect.w, h: row.h };
      const fit = fitTextRect(item.text, itemRect, {
        fontSize: DECK_FONT_SIZE.body,
        minFontSize: DECK_FONT_SIZE.caption,
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
    fontSize: ctx.viewportProfile === 'narrow' ? 32 : DECK_FONT_SIZE.h2,
    minFontSize: 28,
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
    // 结论行铺满下半区：卡片底色 + 序号块 + 文字共同构成可见内容，
    // 避免「居中 4 行短句」造成 0.06 级别的覆盖率。
    const summaryRect = { x: 64, y: 340, w: 1152, h: 300 };
    const gap = 12;
    const itemHeight = Math.max(40, Math.floor((summaryRect.h - gap * (visibleSummaryItems.length - 1)) / visibleSummaryItems.length));
    const fontSize = ctx.viewportProfile === 'narrow' ? 18 : DECK_FONT_SIZE.body;
    visibleSummaryItems.forEach((item, index) => {
      const rect = {
        x: summaryRect.x,
        y: summaryRect.y + index * (itemHeight + gap),
        w: summaryRect.w,
        h: itemHeight,
      };
      nodes.push(shapeNode(rect, 'roundRect', {
        fill: cardSurface(),
        line: { color: DECK_NEUTRAL.border, width: 1 },
        radius: 0.16,
      }));
      nodes.push(shapeNode(
        { x: rect.x + 20, y: rect.y + Math.round((itemHeight - 28) / 2), w: 28, h: 28 },
        'roundRect', { fill: solid(ctx.primary), radius: 0.5 },
      ));
      const summaryFit = fitTextRect(item.text, {
        x: rect.x + 68,
        y: rect.y + 8,
        w: rect.w - 108,
        h: Math.max(24, itemHeight - 16),
      }, {
        fontSize,
        minFontSize: 16,
        lineHeight: 1.2,
        fontFamily: ctx.fontFamily,
      });
      nodes.push(
        textNode(
          summaryFit.rect,
          [para(item.text, { size: summaryFit.fontSize, color: ctx.text, spaceAfter: 4 })],
          {
            valign: 'middle',
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
