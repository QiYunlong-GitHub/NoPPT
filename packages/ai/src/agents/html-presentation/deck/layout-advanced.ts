import {
  DECK_BODY_RECT,
  DECK_FONT_SIZE,
  DECK_GAP,
  DECK_NEUTRAL,
  allocateVerticalRegions,
  type DeckChartKind,
  type DeckLayoutContext,
  type LayoutFn,
  type VerticalRegionRequest,
  gradientFill,
  imageNode,
  para,
  shapeNode,
  solid,
  splitH,
  splitTitleBody,
  splitValueLabel,
  splitV,
  textNode,
  tint,
  titleBlock,
  toDeckChartSpec,
} from './layout-primitives';
import {
  SLIDE_H_PX,
  SLIDE_W_PX,
  type DeckNode,
  type DeckParagraph,
  type DeckRect,
  type DeckShapeType,
} from '@noppt/core/deck';
import type { ArchitectureSpec, MetricItem, SlidePlan } from '../../../types';

/** 深度对比：两栏 gap 28，右栏优势项带进度条。 */
const layoutComparisonDeepDive: LayoutFn = (sp, ctx) => {
  const nodes: DeckNode[] = [titleBlock(sp, ctx)];
  const items = sp.keyPoints ?? [];
  const metrics = sp.metricValues ?? [];
  const advantage = new Set(sp.advantageIndices ?? []);
  const half = Math.ceil(items.length / 2);
  const [left, right] = splitH(DECK_BODY_RECT, [1, 1], 28);

  nodes.push(
    shapeNode(left, 'roundRect', {
      fill: solid(DECK_NEUTRAL.cardBg),
      line: { color: DECK_NEUTRAL.border, width: 1 },
      radius: 0.1,
    }),
  );
  nodes.push(
    shapeNode(right, 'roundRect', {
      fill: tint(ctx.primary, '08'),
      line: { color: ctx.primary, width: 1 },
      radius: 0.1,
    }),
  );

  const rowH = Math.round((left.h - 64 - DECK_GAP * Math.max(0, half - 1)) / Math.max(1, half));
  for (let i = 0; i < half; i++) {
    const y = left.y + 32 + i * (rowH + DECK_GAP);
    nodes.push(
      textNode(
        { x: left.x + 32, y, w: left.w - 64, h: rowH },
        [para(items[i] ?? '', { size: DECK_FONT_SIZE.body, color: ctx.text })],
        { valign: 'middle' },
      ),
    );
    const ry = right.y + 32 + i * (rowH + DECK_GAP);
    const isAdv = advantage.has(i);
    nodes.push(
      textNode(
        { x: right.x + 32, y: ry, w: right.w - 64, h: Math.round(rowH * 0.6) },
        [para(items[half + i] ?? '', { bold: isAdv, size: DECK_FONT_SIZE.body, color: ctx.text })],
        { valign: 'middle' },
      ),
    );
    const m = metrics[i];
    if (typeof m === 'number' && Number.isFinite(m)) {
      const pct = Math.max(0, Math.min(100, m));
      const barY = ry + Math.round(rowH * 0.62);
      nodes.push(
        shapeNode({ x: right.x + 32, y: barY, w: right.w - 64, h: 8 }, 'roundRect', {
          fill: solid(DECK_NEUTRAL.border),
          radius: 0.5,
        }),
      );
      nodes.push(
        shapeNode(
          { x: right.x + 32, y: barY, w: Math.round(((right.w - 64) * pct) / 100), h: 8 },
          'roundRect',
          { fill: solid(ctx.primary), radius: 0.5 },
        ),
      );
    }
  }
  return nodes;
};

/** Z 字交错：三段，图侧固定 38%，gap 24，仅首段真实图。 */
const layoutZigzag: LayoutFn = (sp, ctx) => {
  const nodes: DeckNode[] = [titleBlock(sp, ctx)];
  const items = sp.keyPoints ?? [];
  const n = Math.max(1, Math.min(3, items.length || 3));
  const rows = splitV(DECK_BODY_RECT, new Array(n).fill(1), DECK_GAP);
  rows.forEach((row, i) => {
    const [a, b] = splitH(row, [38, 62], DECK_GAP);
    const mediaRect = i % 2 === 0 ? a : b;
    const textRect = i % 2 === 0 ? b : a;
    if (i === 0 && sp.needsImage !== false) {
      nodes.push(imageNode(mediaRect, sp.imagePrompt || sp.title));
    } else {
      nodes.push(
        shapeNode(mediaRect, 'roundRect', {
          fill: gradientFill(ctx.primary, ctx.primaryDark),
          radius: 0.15,
        }),
      );
    }
    const { title, body } = splitTitleBody(items[i] ?? '');
    const ps: DeckParagraph[] = [para(title, { bold: true, size: 26, color: ctx.primary })];
    if (body) ps.push(para(body, { size: 22, color: ctx.text }));
    nodes.push(
      textNode(
        { x: textRect.x + 24, y: textRect.y + 20, w: textRect.w - 48, h: textRect.h - 40 },
        ps,
        { valign: 'middle' },
      ),
    );
  });
  return nodes;
};

/** 核心数值大卡：88px 数值，1→1 列，2→2 列，其余 3 列。 */
const layoutValueShowcase: LayoutFn = (sp, ctx) => {
  const nodes: DeckNode[] = [titleBlock(sp, ctx)];
  const metrics = sp.showcaseMetrics ?? [];
  const items: Array<{ label: string; value: string; trend?: 'up' | 'down' | 'flat' }> =
    metrics.length > 0 ? metrics : (sp.keyPoints ?? []).map((t) => ({ label: t, value: '' }));
  const n = Math.max(1, items.length);
  const cols = n === 1 ? 1 : n === 2 ? 2 : 3;
  const rows = Math.ceil(n / cols);
  const cellW = Math.round((DECK_BODY_RECT.w - DECK_GAP * (cols - 1)) / cols);
  const cellH = Math.round((DECK_BODY_RECT.h - DECK_GAP * (rows - 1)) / rows);
  items.forEach((m, i) => {
    const r = Math.floor(i / cols);
    const c = i % cols;
    const cell: DeckRect = {
      x: DECK_BODY_RECT.x + c * (cellW + DECK_GAP),
      y: DECK_BODY_RECT.y + r * (cellH + DECK_GAP),
      w: cellW,
      h: cellH,
    };
    nodes.push(shapeNode(cell, 'roundRect', { fill: tint(ctx.primary, '10'), radius: 0.16 }));
    const value = m.value || splitValueLabel(m.label).value;
    const label = m.value ? m.label : splitValueLabel(m.label).label;
    nodes.push(
      textNode(
        { x: cell.x + 24, y: cell.y + 24, w: cell.w - 48, h: Math.round(cellH * 0.5) },
        [
          para(value, {
            bold: true,
            size: DECK_FONT_SIZE.value,
            align: 'center',
            color: ctx.primary,
          }),
        ],
        { align: 'center', valign: 'middle' },
      ),
    );
    nodes.push(
      textNode(
        {
          x: cell.x + 24,
          y: cell.y + 24 + Math.round(cellH * 0.5),
          w: cell.w - 48,
          h: Math.round(cellH * 0.3),
        },
        [para(label, { bold: true, size: DECK_FONT_SIZE.h3, align: 'center' })],
        { align: 'center' },
      ),
    );
    if (m.trend && m.trend !== 'flat') {
      nodes.push(
        textNode(
          {
            x: cell.x + 24,
            y: cell.y + 24 + Math.round(cellH * 0.8),
            w: cell.w - 48,
            h: Math.round(cellH * 0.15),
          },
          [
            para(m.trend === 'up' ? '▲ 上升' : '▼ 下降', {
              size: DECK_FONT_SIZE.bodySm,
              align: 'center',
              color: m.trend === 'up' ? '10B981' : ctx.textMuted,
            }),
          ],
          { align: 'center' },
        ),
      );
    }
  });
  return nodes;
};

/** 多指标并列：按 value→label→description→trend 测量内容，最多 4 列。 */
const layoutStatsHighlight: LayoutFn = (sp, ctx) => {
  const nodes: DeckNode[] = [titleBlock(sp, ctx)];
  const metrics = sp.metricValues ?? [];
  const typedItems = Array.isArray(sp.metricItems) && sp.metricItems.length > 0 ? sp.metricItems : undefined;
  const items: MetricItem[] = typedItems ?? (sp.showcaseMetrics ?? []).map((item, index) => ({
    kind: 'metric' as const,
    contentId: `legacy-metric-${index + 1}`,
    order: index,
    label: item.label,
    value: item.value,
    trend: item.trend,
    legacyDerived: true,
  }));
  const fallbackItems: MetricItem[] = items.length > 0 ? items : (sp.keyPoints ?? []).map((label, index) => ({
    kind: 'omission' as const,
    contentId: `legacy-metric-${index + 1}`,
    order: index,
    originalText: label,
    reason: 'value_not_separable' as const,
    status: 'needs_review' as const,
    legacyDerived: true,
  }));
  const renderItems: MetricItem[] = fallbackItems.map((item) => {
    if (item.kind === 'metric' && item.label.trim() && item.value.trim()) return item;
    if (item.kind === 'omission') return item;
    return {
      kind: 'omission',
      contentId: item.contentId,
      order: item.order,
      originalText: item.originalText || [item.label, item.value].filter(Boolean).join(' ') || item.contentId,
      reason: item.value.trim() ? 'label_not_provided' : 'value_not_separable',
      status: 'needs_review',
      legacyDerived: item.legacyDerived,
    };
  });
  const n = Math.max(1, renderItems.length);
  const cols = Math.min(4, n);
  const rows = Math.ceil(n / cols);
  const cellW = Math.round((DECK_BODY_RECT.w - DECK_GAP * (cols - 1)) / cols);
  const maxRowH = Math.round((DECK_BODY_RECT.h - DECK_GAP * (rows - 1)) / rows);
  const innerW = Math.max(1, cellW - 40);

  const requestsFor = (item: MetricItem): VerticalRegionRequest[] => {
    if (item.kind === 'omission') {
      return [{ id: 'omission', text: item.originalText || item.contentId, fontSize: DECK_FONT_SIZE.body, minFontSize: DECK_FONT_SIZE.bodySm }];
    }
    const requests: VerticalRegionRequest[] = [
      { id: 'value', text: item.value, fontSize: DECK_FONT_SIZE.stat, minFontSize: DECK_FONT_SIZE.body },
      { id: 'label', text: item.label, fontSize: DECK_FONT_SIZE.h3, minFontSize: DECK_FONT_SIZE.bodySm },
    ];
    if (item.description) requests.push({ id: 'description', text: item.description, fontSize: DECK_FONT_SIZE.bodySm, minFontSize: DECK_FONT_SIZE.caption });
    if (item.trend && item.trend !== 'flat') requests.push({ id: 'trend', text: item.trend === 'up' ? '▲ 上升' : '▼ 下降', fontSize: DECK_FONT_SIZE.bodySm, minFontSize: DECK_FONT_SIZE.caption });
    return requests;
  };
  const rowHeights = Array.from({ length: rows }, (_, row) => {
    const rowItems = renderItems.slice(row * cols, (row + 1) * cols);
    const desired = rowItems.map((item) => {
      const allocation = allocateVerticalRegions(
        { x: 0, y: 0, w: innerW, h: maxRowH - 52 },
        requestsFor(item),
        { gap: 8, fontFamily: ctx.fontFamily, distributeExtra: false },
      );
      const measured = allocation.regions.reduce((sum, region) => sum + region.rect.h, 0) + Math.max(0, allocation.regions.length - 1) * 8 + 40;
      return Math.max(144, measured);
    });
    return Math.min(maxRowH, Math.max(144, ...desired));
  });
  const rowY = (row: number) => DECK_BODY_RECT.y + rowHeights.slice(0, row).reduce((sum, height) => sum + height + DECK_GAP, 0);

  renderItems.forEach((m, i) => {
    const r = Math.floor(i / cols);
    const c = i % cols;
    const cell: DeckRect = { x: DECK_BODY_RECT.x + c * (cellW + DECK_GAP), y: rowY(r), w: cellW, h: rowHeights[r] };
    nodes.push(shapeNode(cell, 'roundRect', {
      fill: solid(DECK_NEUTRAL.cardBg),
      line: { color: DECK_NEUTRAL.border, width: 1 },
      radius: 0.12,
    }));

    const contentId = m.contentId;
    const requests = requestsFor(m);
    const allocation = allocateVerticalRegions(
      { x: cell.x + 20, y: cell.y + 20, w: cell.w - 40, h: cell.h - 56 },
      requests,
      { gap: 8, fontFamily: ctx.fontFamily, distributeExtra: false },
    );
    allocation.regions.forEach((region) => {
      const isValue = region.id === 'value';
      const isLabel = region.id === 'label';
      nodes.push(textNode(region.rect, [para(region.text, {
        bold: isValue || isLabel,
        size: region.fontSize,
        align: 'center',
        color: isValue ? ctx.primary : ctx.text,
      })], {
        align: 'center',
        valign: 'middle',
        contentId,
        source: m.legacyDerived ? 'legacy' : 'plan',
        autoFit: region.status !== 'pass',
      }));
    });

    const mv = metrics[i];
    if (typeof mv === 'number' && Number.isFinite(mv)) {
      const pct = Math.max(0, Math.min(100, mv));
      const barY = cell.y + cell.h - 20;
      nodes.push(shapeNode({ x: cell.x + 20, y: barY, w: cell.w - 40, h: 8 }, 'roundRect', { fill: solid(DECK_NEUTRAL.border), radius: 0.5 }));
      nodes.push(shapeNode({ x: cell.x + 20, y: barY, w: Math.round(((cell.w - 40) * pct) / 100), h: 8 }, 'roundRect', { fill: solid(ctx.primary), radius: 0.5 }));
    }
  });
  return nodes;
};

/** 大图背景 + 玻璃卡。 */
const layoutImageBackground: LayoutFn = (sp, _ctx) => {
  const nodes: DeckNode[] = [];
  nodes.push(
    imageNode(
      { x: 0, y: 0, w: SLIDE_W_PX, h: SLIDE_H_PX },
      sp.imagePrompt || sp.backgroundPrompt || sp.title,
      0,
    ),
  );
  nodes.push(
    shapeNode({ x: 0, y: 0, w: SLIDE_W_PX, h: SLIDE_H_PX }, 'rect', { fill: solid('111827', 55) }),
  );
  nodes.push(
    textNode(
      { x: 64, y: 160, w: 1152, h: 88 },
      [para(sp.title || '', { bold: true, size: 44, align: 'center', color: DECK_NEUTRAL.white })],
      { align: 'center', role: 'title' },
    ),
  );
  const items = sp.keyPoints ?? [];
  const [c1, c2] = splitH({ x: 64, y: 288, w: 1152, h: 320 }, [1, 1], DECK_GAP);
  const half = Math.ceil(items.length / 2);
  [c1, c2].forEach((cell, idx) => {
    nodes.push(shapeNode(cell, 'roundRect', { fill: solid(DECK_NEUTRAL.white, 45), radius: 0.14 }));
    const ps = (idx === 0 ? items.slice(0, half) : items.slice(half)).map((t) =>
      para(t, { size: 22, color: DECK_NEUTRAL.ink, bullet: true }),
    );
    if (ps.length > 0)
      nodes.push(
        textNode({ x: cell.x + 32, y: cell.y + 28, w: cell.w - 64, h: cell.h - 56 }, ps, {
          valign: 'middle',
        }),
      );
  });
  return nodes;
};

/** 引述页。 */
const layoutQuote: LayoutFn = (sp, ctx) => {
  const nodes: DeckNode[] = [];
  const kp = sp.keyPoints ?? [];
  nodes.push(
    textNode(
      { x: 64, y: 176, w: 1152, h: 64 },
      [para('“', { bold: true, size: 96, align: 'center', color: ctx.primary })],
      { align: 'center', role: 'decoration' },
    ),
  );
  nodes.push(
    textNode(
      { x: 128, y: 248, w: 1024, h: 200 },
      [
        para(sp.title || kp[0] || '', {
          italic: true,
          size: DECK_FONT_SIZE.quote,
          align: 'center',
          color: ctx.text,
        }),
      ],
      { align: 'center', valign: 'middle', role: 'title' },
    ),
  );
  const by = kp[kp.length - 1];
  if (by && by !== sp.title) {
    nodes.push(
      textNode(
        { x: 64, y: 464, w: 1152, h: 40 },
        [para(`— ${by}`, { size: DECK_FONT_SIZE.body, align: 'center', color: ctx.textMuted })],
        { align: 'center', role: 'subtitle' },
      ),
    );
  }
  return nodes;
};

/** 三等分区块（横向）。 */
const layoutThreeSection: LayoutFn = (sp, ctx) => {
  const nodes: DeckNode[] = [titleBlock(sp, ctx)];
  const items = sp.keyPoints ?? [];
  const n = Math.max(1, Math.min(3, items.length || 3));
  splitH(DECK_BODY_RECT, new Array(n).fill(1), DECK_GAP).forEach((cell, i) => {
    nodes.push(shapeNode(cell, 'roundRect', { fill: tint(ctx.primary, '08'), radius: 0.1 }));
    const { title, body } = splitTitleBody(items[i] ?? '');
    const ps: DeckParagraph[] = [
      para(title, { bold: true, size: DECK_FONT_SIZE.h3, align: 'center', color: ctx.primary }),
    ];
    if (body) ps.push(para(body, { size: DECK_FONT_SIZE.body, align: 'center' }));
    nodes.push(
      textNode({ x: cell.x + 32, y: cell.y + 32, w: cell.w - 64, h: cell.h - 64 }, ps, {
        align: 'center',
        valign: 'middle',
      }),
    );
  });
  return nodes;
};

/** 编号步骤卡（横向）。 */
const layoutProcessSteps: LayoutFn = (sp, ctx) => {
  const nodes: DeckNode[] = [titleBlock(sp, ctx)];
  const items = sp.keyPoints ?? [];
  const n = Math.max(1, items.length || 3);
  const cols = Math.min(4, n);
  const rows = Math.ceil(n / cols);
  const cellW = Math.round((DECK_BODY_RECT.w - DECK_GAP * (cols - 1)) / cols);
  const cellH = Math.round((DECK_BODY_RECT.h - DECK_GAP * (rows - 1)) / rows);
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / cols);
    const c = i % cols;
    const cell: DeckRect = {
      x: DECK_BODY_RECT.x + c * (cellW + DECK_GAP),
      y: DECK_BODY_RECT.y + r * (cellH + DECK_GAP),
      w: cellW,
      h: cellH,
    };
    nodes.push(
      shapeNode(cell, 'roundRect', {
        fill: solid(DECK_NEUTRAL.cardBg),
        line: { color: DECK_NEUTRAL.border, width: 1 },
        radius: 0.12,
      }),
    );
    const numSize = 56;
    nodes.push(
      shapeNode({ x: cell.x + 32, y: cell.y + 32, w: numSize, h: numSize }, 'ellipse', {
        fill: solid(ctx.primary),
      }),
    );
    nodes.push(
      textNode(
        { x: cell.x + 32, y: cell.y + 32, w: numSize, h: numSize },
        [para(String(i + 1), { bold: true, size: 24, align: 'center', color: DECK_NEUTRAL.white })],
        { align: 'center', valign: 'middle', role: 'decoration' },
      ),
    );
    const { title, body } = splitTitleBody(items[i] ?? '');
    const ps: DeckParagraph[] = [
      para(title, { bold: true, size: DECK_FONT_SIZE.body, color: ctx.text }),
    ];
    if (body) ps.push(para(body, { size: DECK_FONT_SIZE.bodySm, color: ctx.textMuted }));
    nodes.push(
      textNode(
        {
          x: cell.x + 32,
          y: cell.y + 32 + numSize + 16,
          w: cell.w - 64,
          h: Math.max(0, cellH - 64 - numSize - 16),
        },
        ps,
      ),
    );
  }
  return nodes;
};

/** 图标网格（圆形图标位 + 标题 + 描述）。 */
const layoutIconGrid: LayoutFn = (sp, ctx) => {
  const nodes: DeckNode[] = [titleBlock(sp, ctx)];
  const items = sp.keyPoints ?? [];
  const n = Math.max(1, items.length || 4);
  const cols = Math.min(4, Math.max(2, Math.ceil(n / 2)));
  const rows = Math.ceil(n / cols);
  const cellW = Math.round((DECK_BODY_RECT.w - DECK_GAP * (cols - 1)) / cols);
  const cellH = Math.round((DECK_BODY_RECT.h - DECK_GAP * (rows - 1)) / rows);
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / cols);
    const c = i % cols;
    const cell: DeckRect = {
      x: DECK_BODY_RECT.x + c * (cellW + DECK_GAP),
      y: DECK_BODY_RECT.y + r * (cellH + DECK_GAP),
      w: cellW,
      h: cellH,
    };
    const iconSize = 64;
    nodes.push(
      shapeNode(
        { x: cell.x + (cell.w - iconSize) / 2, y: cell.y + 16, w: iconSize, h: iconSize },
        'ellipse',
        { fill: tint(ctx.primary, '14') },
      ),
    );
    const { title, body } = splitTitleBody(items[i] ?? '');
    nodes.push(
      textNode(
        { x: cell.x + 16, y: cell.y + 16 + iconSize + 16, w: cell.w - 32, h: 40 },
        [
          para(title, {
            bold: true,
            size: DECK_FONT_SIZE.body,
            align: 'center',
            color: ctx.primary,
          }),
        ],
        { align: 'center' },
      ),
    );
    if (body) {
      nodes.push(
        textNode(
          {
            x: cell.x + 16,
            y: cell.y + 16 + iconSize + 56,
            w: cell.w - 32,
            h: Math.max(0, cellH - 16 - iconSize - 56 - 16),
          },
          [para(body, { size: DECK_FONT_SIZE.caption, align: 'center', color: ctx.textMuted })],
          { align: 'center' },
        ),
      );
    }
  }
  return nodes;
};

/** 章节过渡页：大号序号 + 标题。 */
const layoutSectionDivider: LayoutFn = (sp, ctx) => {
  const nodes: DeckNode[] = [];
  const idx = (sp as { _index?: number })._index;
  const num = typeof idx === 'number' ? String(idx + 1).padStart(2, '0') : '';
  if (num) {
    nodes.push(
      textNode(
        { x: 64, y: 216, w: 1152, h: 96 },
        [
          para(num, {
            bold: true,
            size: DECK_FONT_SIZE.divider,
            align: 'center',
            color: tint(ctx.primary, '40').color,
          }),
        ],
        { align: 'center', role: 'decoration' },
      ),
    );
  }
  nodes.push(
    textNode(
      { x: 64, y: num ? 328 : 264, w: 1152, h: 120 },
      [
        para(sp.title || '', {
          bold: true,
          size: DECK_FONT_SIZE.h2,
          align: 'center',
          color: ctx.primary,
        }),
      ],
      { align: 'center', valign: 'middle', role: 'title' },
    ),
  );
  return nodes;
};

/** 证言页：头像 + 引述 + 署名。 */
const layoutTestimonial: LayoutFn = (sp, ctx) => {
  const nodes: DeckNode[] = [];
  const kp = sp.keyPoints ?? [];
  nodes.push(
    shapeNode({ x: 592, y: 112, w: 96, h: 96 }, 'ellipse', { fill: tint(ctx.primary, '20') }),
  );
  nodes.push(
    textNode(
      { x: 592, y: 112, w: 96, h: 96 },
      [
        para((sp.title || 'A').slice(0, 1), {
          bold: true,
          size: 40,
          align: 'center',
          color: ctx.primary,
        }),
      ],
      { align: 'center', valign: 'middle', role: 'decoration' },
    ),
  );
  nodes.push(
    textNode(
      { x: 160, y: 248, w: 960, h: 200 },
      [
        para(kp[0] || sp.title || '', {
          italic: true,
          size: DECK_FONT_SIZE.h3,
          align: 'center',
          color: ctx.text,
        }),
      ],
      { align: 'center', valign: 'middle', role: 'title' },
    ),
  );
  nodes.push(
    textNode(
      { x: 160, y: 464, w: 960, h: 64 },
      [
        para(kp[1] || '', {
          bold: true,
          size: DECK_FONT_SIZE.body,
          align: 'center',
          color: ctx.primary,
        }),
      ],
      { align: 'center', role: 'subtitle' },
    ),
  );
  return nodes;
};

/** 流程图：横向节点 + 箭头。 */
const layoutFlowchart: LayoutFn = (sp, ctx) => {
  const nodes: DeckNode[] = [titleBlock(sp, ctx)];
  const items = sp.keyPoints ?? [];
  const n = Math.max(1, items.length || 3);
  const arrowW = 48;
  const totalGap = arrowW * (n - 1);
  const nodeW = Math.round((DECK_BODY_RECT.w - totalGap) / n);
  const nodeH = 120;
  const y = DECK_BODY_RECT.y + Math.round((DECK_BODY_RECT.h - nodeH) / 2);
  for (let i = 0; i < n; i++) {
    const x = DECK_BODY_RECT.x + i * (nodeW + arrowW);
    nodes.push(
      shapeNode({ x, y, w: nodeW, h: nodeH }, 'roundRect', {
        fill: tint(ctx.primary, '10'),
        line: { color: ctx.primary, width: 1 },
        radius: 0.25,
      }),
    );
    nodes.push(
      textNode(
        { x: x + 16, y: y + 16, w: nodeW - 32, h: nodeH - 32 },
        [
          para(items[i] ?? '', {
            bold: true,
            size: DECK_FONT_SIZE.body,
            align: 'center',
            color: ctx.text,
          }),
        ],
        { align: 'center', valign: 'middle' },
      ),
    );
    if (i < n - 1) {
      nodes.push(
        shapeNode(
          { x: x + nodeW + 8, y: y + nodeH / 2 - 12, w: arrowW - 16, h: 24 },
          'rightArrow',
          { fill: solid(ctx.primary) },
        ),
      );
    }
  }
  return nodes;
};

/** 金字塔：3~5 层梯形递减。 */
const layoutPyramid: LayoutFn = (sp, ctx) => {
  const nodes: DeckNode[] = [titleBlock(sp, ctx)];
  const items = sp.keyPoints ?? [];
  const n = Math.max(3, Math.min(5, items.length || 3));
  const rowH = Math.round((DECK_BODY_RECT.h - 16 * (n - 1)) / n);
  for (let i = 0; i < n; i++) {
    const shrink = (i / n) * (DECK_BODY_RECT.w * 0.6);
    const w = Math.round(DECK_BODY_RECT.w - shrink);
    const x = DECK_BODY_RECT.x + Math.round((DECK_BODY_RECT.w - w) / 2);
    const y = DECK_BODY_RECT.y + i * (rowH + 16);
    const alpha = Math.max(0.15, 1 - i / n);
    nodes.push(
      shapeNode({ x, y, w, h: rowH }, 'trapezoid', {
        fill: solid(ctx.primary, Math.round((1 - alpha) * 60)),
      }),
    );
    nodes.push(
      textNode(
        { x: x + 24, y: y + 16, w: w - 48, h: rowH - 32 },
        [
          para(items[i] ?? '', {
            bold: true,
            size: DECK_FONT_SIZE.body,
            align: 'center',
            color: i === 0 ? DECK_NEUTRAL.white : ctx.text,
          }),
        ],
        { align: 'center', valign: 'middle' },
      ),
    );
  }
  return nodes;
};

/** 2×2 四象限矩阵。 */
const layoutMatrix: LayoutFn = (sp, ctx) => {
  const nodes: DeckNode[] = [titleBlock(sp, ctx)];
  const items = sp.keyPoints ?? [];
  const [top, bottom] = splitV(DECK_BODY_RECT, [1, 1], 8);
  const quadA = splitH(top, [1, 1], 8);
  const quadB = splitH(bottom, [1, 1], 8);
  const quad = [...quadA, ...quadB];
  quad.forEach((cell, i) => {
    nodes.push(
      shapeNode(cell, 'roundRect', {
        fill: tint(ctx.primary, i % 2 === 0 ? '08' : '14'),
        line: { color: ctx.primary, width: 1 },
        radius: 0.08,
      }),
    );
    nodes.push(
      textNode(
        { x: cell.x + 24, y: cell.y + 24, w: cell.w - 48, h: cell.h - 48 },
        [
          para(items[i] ?? '', {
            bold: true,
            size: DECK_FONT_SIZE.body,
            align: 'center',
            color: ctx.text,
          }),
        ],
        { align: 'center', valign: 'middle' },
      ),
    );
  });
  return nodes;
};

/** 分层结构（组织架构 / 系统架构）：逐层节点 + 层间流向箭头。 */
function layoutHierarchy(
  spec: ArchitectureSpec | undefined,
  sp: SlidePlan,
  ctx: DeckLayoutContext,
): DeckNode[] {
  const nodes: DeckNode[] = [titleBlock(sp, ctx)];
  const layers = spec?.layers ?? [];
  const nodesById = new Map<number, string>();
  (spec?.nodes ?? []).forEach((n) => nodesById.set(n.id, n.label));
  const items = sp.keyPoints ?? [];
  const list = layers.length > 0 ? layers : [{ nodeIds: items.map((_, i) => i) }];
  const rowGap = 32;
  const rowH = Math.round((DECK_BODY_RECT.h - rowGap * (list.length - 1)) / list.length);
  list.forEach((layer, li) => {
    const y = DECK_BODY_RECT.y + li * (rowH + rowGap);
    if (layer.title) {
      nodes.push(
        textNode({ x: DECK_BODY_RECT.x, y: y - 24, w: DECK_BODY_RECT.w, h: 24 }, [
          para(layer.title, { bold: true, size: DECK_FONT_SIZE.caption, color: ctx.textMuted }),
        ]),
      );
    }
    const ids = layer.nodeIds ?? [];
    const cols = Math.max(1, ids.length);
    const cellW = Math.round((DECK_BODY_RECT.w - DECK_GAP * (cols - 1)) / cols);
    const contentH = layer.title ? rowH - 24 : rowH;
    ids.forEach((id, ci) => {
      const x = DECK_BODY_RECT.x + ci * (cellW + DECK_GAP);
      const cell: DeckRect = { x, y, w: cellW, h: contentH };
      const label = nodesById.get(id) ?? items[id] ?? String(id);
      const variant = (spec?.nodes ?? []).find((n) => n.id === id)?.variant;
      const shape: DeckShapeType =
        variant === 'cylinder'
          ? 'cylinder'
          : variant === 'ellipse'
            ? 'ellipse'
            : variant === 'cloud'
              ? 'cloud'
              : 'roundRect';
      nodes.push(
        shapeNode(cell, shape, {
          fill: tint(ctx.primary, li % 2 === 0 ? '10' : '18'),
          line: { color: ctx.primary, width: 1 },
          radius: 0.15,
        }),
      );
      nodes.push(
        textNode(
          { x: cell.x + 16, y: cell.y + 16, w: cell.w - 32, h: cell.h - 32 },
          [
            para(label, {
              bold: true,
              size: DECK_FONT_SIZE.bodySm,
              align: 'center',
              color: ctx.text,
            }),
          ],
          { align: 'center', valign: 'middle' },
        ),
      );
      if (li < list.length - 1) {
        nodes.push(
          shapeNode(
            { x: cell.x + cell.w / 2 - 12, y: cell.y + contentH + 2, w: 24, h: rowGap - 4 },
            'downArrow',
            { fill: solid(ctx.primary), role: 'decoration' },
          ),
        );
      }
    });
  });
  return nodes;
}

const layoutOrgChart: LayoutFn = (sp, ctx) => layoutHierarchy(sp.architecture, sp, ctx);
const layoutArchitecture: LayoutFn = (sp, ctx) => layoutHierarchy(sp.architecture, sp, ctx);

/** 循环图：环形节点 + 中心标题。 */
const layoutCycle: LayoutFn = (sp, ctx) => {
  const nodes: DeckNode[] = [titleBlock(sp, ctx)];
  const items = sp.keyPoints ?? [];
  const n = Math.max(2, Math.min(6, items.length || 4));
  const cx = DECK_BODY_RECT.x + DECK_BODY_RECT.w / 2;
  const cy = DECK_BODY_RECT.y + DECK_BODY_RECT.h / 2;
  const radius = Math.min(DECK_BODY_RECT.w, DECK_BODY_RECT.h) / 2 - 72;
  const nodeW = Math.round((DECK_BODY_RECT.w - DECK_GAP * 3) / 4);
  const nodeH = 96;
  for (let i = 0; i < n; i++) {
    const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
    const x = Math.round(cx + radius * Math.cos(angle) - nodeW / 2);
    const y = Math.round(cy + radius * Math.sin(angle) - nodeH / 2);
    nodes.push(
      shapeNode({ x, y, w: nodeW, h: nodeH }, 'roundRect', {
        fill: tint(ctx.primary, '10'),
        line: { color: ctx.primary, width: 1 },
        radius: 0.3,
      }),
    );
    nodes.push(
      textNode(
        { x: x + 12, y: y + 12, w: nodeW - 24, h: nodeH - 24 },
        [
          para(items[i] ?? '', {
            bold: true,
            size: DECK_FONT_SIZE.bodySm,
            align: 'center',
            color: ctx.text,
          }),
        ],
        { align: 'center', valign: 'middle' },
      ),
    );
  }
  nodes.push(
    shapeNode({ x: Math.round(cx - 96), y: Math.round(cy - 48), w: 192, h: 96 }, 'ellipse', {
      fill: solid(ctx.primary),
    }),
  );
  nodes.push(
    textNode(
      { x: Math.round(cx - 96), y: Math.round(cy - 48), w: 192, h: 96 },
      [
        para(sp.title || '', {
          bold: true,
          size: DECK_FONT_SIZE.body,
          align: 'center',
          color: DECK_NEUTRAL.white,
        }),
      ],
      { align: 'center', valign: 'middle', role: 'title' },
    ),
  );
  return nodes;
};

/** 数据看板：指标卡 + 迷你图表。 */
const layoutDashboard: LayoutFn = (sp, ctx) => {
  const nodes: DeckNode[] = [titleBlock(sp, ctx)];
  const items = sp.showcaseMetrics ?? [];
  const n = Math.max(1, items.length || 3);
  const cols = Math.min(4, n);
  const cardH = 160;
  const cardW = Math.round((DECK_BODY_RECT.w - DECK_GAP * (cols - 1)) / cols);
  for (let i = 0; i < n; i++) {
    const x = DECK_BODY_RECT.x + (i % cols) * (cardW + DECK_GAP);
    const y = DECK_BODY_RECT.y;
    nodes.push(
      shapeNode({ x, y, w: cardW, h: cardH }, 'roundRect', {
        fill: solid(DECK_NEUTRAL.cardBg),
        line: { color: DECK_NEUTRAL.border, width: 1 },
        radius: 0.12,
      }),
    );
    const m = items[i];
    const value = m?.value || splitValueLabel(sp.keyPoints?.[i] ?? '').value;
    const label = m?.value ? m.label : splitValueLabel(sp.keyPoints?.[i] ?? '').label;
    nodes.push(
      textNode(
        { x: x + 20, y: y + 20, w: cardW - 40, h: 72 },
        [
          para(value, {
            bold: true,
            size: DECK_FONT_SIZE.stat,
            align: 'center',
            color: ctx.primary,
          }),
        ],
        { align: 'center', valign: 'middle' },
      ),
    );
    nodes.push(
      textNode(
        { x: x + 20, y: y + 96, w: cardW - 40, h: 44 },
        [para(label, { size: DECK_FONT_SIZE.bodySm, align: 'center', color: ctx.textMuted })],
        { align: 'center' },
      ),
    );
  }
  const chart = toDeckChartSpec(sp.chart, 'bar');
  if (chart) {
    const chartRect: DeckRect = {
      x: DECK_BODY_RECT.x,
      y: DECK_BODY_RECT.y + cardH + DECK_GAP,
      w: DECK_BODY_RECT.w,
      h: Math.max(0, DECK_BODY_RECT.h - cardH - DECK_GAP),
    };
    nodes.push({ kind: 'chart', rect: chartRect, chart });
  }
  return nodes;
};

/** 图表页（bar / line / pie / donut）。 */
function layoutChart(kind: DeckChartKind): LayoutFn {
  return (sp, ctx) => {
    const nodes: DeckNode[] = [titleBlock(sp, ctx)];
    const spec = toDeckChartSpec(sp.chart, kind, kind) ?? {
      kind,
      categories: (sp.keyPoints ?? []).map((_, i) => String(i + 1)),
      series: [{ name: sp.title, values: (sp.keyPoints ?? []).map(() => 0) }],
    };
    if (spec.series.every((s) => s.values.length === 0)) return nodes;
    nodes.push({ kind: 'chart', rect: DECK_BODY_RECT, chart: spec });
    return nodes;
  };
}

/** 兜底：最小版式套件（padding 48/64 + H2 + 3 条要点卡）。 */
export const layoutMinimal: LayoutFn = (sp, ctx) => {
  const nodes: DeckNode[] = [titleBlock(sp, ctx)];
  nodes.push(
    shapeNode({ x: DECK_BODY_RECT.x, y: DECK_BODY_RECT.y + 40, w: 80, h: 6 }, 'rect', {
      fill: solid(ctx.primary),
      role: 'decoration',
    }),
  );
  const items = (sp.keyPoints ?? []).slice(0, 3);
  const rowH = Math.round(
    (DECK_BODY_RECT.h - 56 - DECK_GAP * Math.max(0, items.length - 1)) / Math.max(1, items.length),
  );
  items.forEach((t, i) => {
    const y = DECK_BODY_RECT.y + 56 + i * (rowH + DECK_GAP);
    nodes.push(
      shapeNode({ x: DECK_BODY_RECT.x, y, w: DECK_BODY_RECT.w, h: rowH }, 'roundRect', {
        fill: tint(ctx.primary, '08'),
        radius: 0.2,
      }),
    );
    nodes.push(
      textNode(
        { x: DECK_BODY_RECT.x + 24, y, w: DECK_BODY_RECT.w - 48, h: rowH },
        [para(t, { size: DECK_FONT_SIZE.bodySm })],
        { valign: 'middle' },
      ),
    );
  });
  return nodes;
};

export const ADVANCED_LAYOUT_BUILDERS: Record<string, LayoutFn> = {
  'comparison-deep-dive': layoutComparisonDeepDive,
  'content-zigzag': layoutZigzag,
  'content-value-showcase': layoutValueShowcase,
  'content-stats-highlight': layoutStatsHighlight,
  'content-image-background': layoutImageBackground,
  'content-flowchart': layoutFlowchart,
  'content-org-chart': layoutOrgChart,
  'content-pyramid': layoutPyramid,
  'content-matrix': layoutMatrix,
  'content-quote': layoutQuote,
  'content-three-section': layoutThreeSection,
  'content-process-steps': layoutProcessSteps,
  'content-icon-grid': layoutIconGrid,
  'content-section-divider': layoutSectionDivider,
  'content-testimonial': layoutTestimonial,
  'content-chart-bar': layoutChart('bar'),
  'content-chart-line': layoutChart('line'),
  'content-chart-pie': layoutChart('pie'),
  'content-chart-donut': layoutChart('donut'),
  'content-cycle': layoutCycle,
  'content-dashboard': layoutDashboard,
  'content-architecture': layoutArchitecture,
};
