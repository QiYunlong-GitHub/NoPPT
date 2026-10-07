/**
 * deck-to-html.ts —— 确定性屏幕预览渲染器。
 *
 * 与 `deckToPptx` 共用 `layoutSlideNodes` 产出的同一份 `Deck` 节点树（单一真值），
 * 把「选版式 + 写内容」交给 LLM（SlidePlan → Deck），把「排版 / 样式 / 合法性」
 * 交给本文件这份写一次、测一次、全册复用的纯 TS 代码。
 *
 * 设计约束（来自 LLM-HTML-BEHAVIOR-SNAPSHOT.md）：
 * - 纯 TS、无 DOM 依赖，可在 Node 与浏览器同构运行。
 * - canonical root expresses the responsive viewport (`width:100%`, `aspect-ratio`) while
 *   descendants retain 1280×720 logical coordinates; required text uses visible overflow.
 * - 只输出 `html-allowlist.ts` 白名单内的标签 / 属性 / CSS；定位一律用 top/left/right/bottom 四边属性（不用 inset）。
 * - 颜色 / 字号 / 8pt 网格 / 图表在「节点 → HTML」阶段一次做对，从而跳过 `postProcessSlideHtml` 的颜色与图表 pass。
 * - 图片占位（`DECK_IMAGE_PLACEHOLDER`）渲染为**可见灰块**；真实图渲染为 `<img object-fit cover>`。
 * - 绝不生成「background 简写 + background-clip:text」黑块标题（审计 `detectBlackBlockTitle` 恒阴性）。
 *
 * 红线：本文件为新增模块，仅通过 `deck/index.ts` 的 `export *` 对外暴露；
 * 不修改 `packages/ai/src/index.ts` / `agents/index.ts` 既有具名导出，不删除任何既有文件。
 */

import type {
  Deck,
  DeckChartNode,
  DeckColor,
  DeckFill,
  DeckGroupNode,
  DeckImageNode,
  DeckLine,
  DeckNode,
  DeckParagraph,
  DeckShadow,
  DeckShapeNode,
  DeckSlide,
  DeckTableNode,
  DeckTextNode,
  DeckTextRun,
  DeckMaster,
} from '@noppt/core/deck';
import { DECK_IMAGE_PLACEHOLDER, isDeckImagePlaceholder, normalizeColor } from '@noppt/core/deck';
import type { ReferenceMaster, ReferenceVisualAttributes, StyleTheme } from '../../../types';
import {
  DEFAULT_DECK_LAYOUT_CONTEXT,
  DECK_FONT_SIZE,
  DECK_NEUTRAL,
  type DeckLayoutContext,
} from './layout-templates';
import { applyMasterToSlideHtml } from '../../../utils/apply-master-to-slide-html';

// ---------------------------------------------------------------------------
// 选项
// ---------------------------------------------------------------------------

export interface DeckToHtmlOptions {
  /** 画布宽（px），默认 1280。 */
  width?: number;
  /** 画布高（px），默认 720。 */
  height?: number;
  /** 主色（覆盖 deck.theme）。 */
  primaryColor?: string;
  /** 主色加深（覆盖 deck.theme）。 */
  primaryColorDarker?: string;
  /** 字体族 key：'sans' | 'serif' | 'mono' 或显式 CSS 字体栈。 */
  fontFamily?: 'sans' | 'serif' | 'mono' | string;
  /** 背景色（覆盖 deck.theme）。 */
  background?: string;
  /** 参考视觉属性（预留，供后续配色策略接入）。 */
  referenceAttributes?: ReferenceVisualAttributes;
  /** 参考母版（HTML 预览注入，与现状 LLM 路径一致）。 */
  referenceMaster?: ReferenceMaster;
  /** deck 级母版（PptxGenJS 风格），opt-in，默认关闭以与 LLM 预览 parity。 */
  master?: DeckMaster;
  /** 是否渲染 deck.master 的对象 / 页码（消除跨页风格漂移），默认 false。 */
  renderDeckMaster?: boolean;
  /** 标题节点使用的语义标签（cover→h1，其余→h2）。 */
  headingForTitle?: 'h1' | 'h2' | 'h3';
}

// ---------------------------------------------------------------------------
// 基础工具
// ---------------------------------------------------------------------------

const FONT_STACKS: Record<string, string> = {
  sans: '-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",Roboto,Helvetica,Arial,sans-serif',
  serif: 'Georgia,"Songti SC","SimSun","Times New Roman",serif',
  mono: '"SFMono-Regular",Consolas,"Liberation Mono",Menlo,monospace',
};

function fontFamilyCss(ff?: string): string {
  if (!ff) return FONT_STACKS.sans;
  if (FONT_STACKS[ff]) return FONT_STACKS[ff];
  return ff; // 已是显式字体栈
}

/** DeckColor（6 位无 # HEX）→ CSS 颜色；容错带 # 输入与空值。 */
function hexToCss(c?: DeckColor, fallback = '#000000'): string {
  if (!c) return fallback;
  const s = String(c).trim();
  if (s.startsWith('#')) return s;
  if (/^[0-9a-fA-F]{3,8}$/.test(s)) return '#' + s;
  return fallback;
}

function hexToRgb(c: string): { r: number; g: number; b: number } {
  const hex = hexToCss(c, '#000000').replace('#', '');
  const full =
    hex.length >= 6
      ? hex.slice(0, 6)
      : hex
          .split('')
          .map((x) => x + x)
          .join('');
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 仅放行 http(s) / mailto 超链接，其余当作纯文本。 */
function safeHref(h?: string): string | null {
  if (!h) return null;
  return /^(https?:|mailto:)/i.test(h) ? h : null;
}

function valignToJustify(v?: 'top' | 'middle' | 'bottom'): string {
  if (v === 'middle') return 'center';
  if (v === 'bottom') return 'flex-end';
  return 'flex-start';
}

// ---------------------------------------------------------------------------
// 填充 / 描边 / 阴影 → CSS
// ---------------------------------------------------------------------------

function fillToCss(fill?: DeckFill): string {
  if (!fill) return '';
  if (fill.type === 'gradient' && fill.gradient) {
    const stops = fill.gradient.stops
      .map((s) => `${hexToCss(s.color)} ${Math.round(s.offset * 100)}%`)
      .join(', ');
    return `background:linear-gradient(${fill.gradient.angle ?? 135}deg, ${stops});`;
  }
  const color = hexToCss(fill.color, '#FFFFFF');
  const t = fill.transparency ?? 0;
  if (t > 0) {
    const { r, g, b } = hexToRgb(color);
    const alpha = Math.max(0, Math.min(1, 1 - t / 100));
    return `background:rgba(${r},${g},${b},${alpha.toFixed(2)});`;
  }
  return `background:${color};`;
}

function lineToCss(line?: DeckLine): string {
  if (!line) return '';
  const w = line.width ?? 1;
  const c = hexToCss(line.color, DECK_NEUTRAL.border);
  return `border:${w}px solid ${c};`;
}

function shadowToCss(sh?: DeckShadow): string {
  if (!sh) return '';
  const blur = sh.blur ?? 8;
  const offset = sh.offset ?? 4;
  const angle = ((sh.angle ?? 90) * Math.PI) / 180;
  const dx = Math.round(Math.cos(angle) * offset);
  const dy = Math.round(-Math.sin(angle) * offset);
  const { r, g, b } = hexToRgb(sh.color ?? '#000000');
  const op = sh.opacity ?? 0.2;
  return `box-shadow:${dx}px ${dy}px ${blur}px rgba(${r},${g},${b},${op});`;
}

// ---------------------------------------------------------------------------
// 富文本渲染
// ---------------------------------------------------------------------------

function renderRuns(
  runs: DeckTextRun[],
  ctx: DeckLayoutContext,
  role?: string,
  bullet = false,
): string {
  let html = runs
    .map((r) => {
      const color = r.color
        ? hexToCss(r.color)
        : role === 'title' || role === 'subtitle'
          ? hexToCss(ctx.primary)
          : hexToCss(ctx.text);
      let style = `color:${color};`;
      if (r.bold) style += 'font-weight:700;';
      if (r.italic) style += 'font-style:italic;';
      if (r.underline) style += 'text-decoration:underline;';
      if (r.fontSize) style += `font-size:${r.fontSize}px;`;
      if (r.fontFace) style += `font-family:${fontFamilyCss(r.fontFace)};`;
      if (r.charSpacing) style += `letter-spacing:${r.charSpacing}px;`;
      const text = escapeHtml(r.text);
      const href = safeHref(r.hyperlink);
      const inner = href
        ? `<a href="${escapeHtml(href)}" style="color:inherit;text-decoration:${r.underline ? 'underline' : 'none'};">${text}</a>`
        : text;
      return `<span${style ? ` style="${style}"` : ''}>${inner}</span>`;
    })
    .join('');
  if (bullet && runs.length) html = '• ' + html;
  return html;
}

function renderParagraph(p: DeckParagraph, ctx: DeckLayoutContext, role?: string): string {
  const align = p.align ?? 'left';
  const level = p.level ?? 0;
  const spaceAfter = p.spaceAfter ?? 4;
  const lh = p.lineSpacing ?? 1.3;
  const paddingLeft = (p.bullet ? 18 : 0) + level * 16;
  const style =
    `margin:0 0 ${spaceAfter}px;padding-left:${paddingLeft}px;` +
    `text-align:${align};line-height:${lh};`;
  return `<div style="${style}">${renderRuns(p.runs, ctx, role, p.bullet)}</div>`;
}

/** 渲染段落集合。`headingTag` 非空时整段包进语义标题标签（供审计 extractSlideTitle）。 */
function renderRichContent(
  paragraphs: DeckParagraph[],
  ctx: DeckLayoutContext,
  role?: string,
  headingTag?: string,
): string {
  if (headingTag) {
    const runsHtml = paragraphs.map((p) => renderRuns(p.runs, ctx, role, p.bullet)).join('<br>');
    return `<${headingTag} style="margin:0;line-height:1.2;">${runsHtml}</${headingTag}>`;
  }
  return paragraphs.map((p) => renderParagraph(p, ctx, role)).join('');
}

// ---------------------------------------------------------------------------
// 节点 → HTML
// ---------------------------------------------------------------------------

function renderTextNode(
  node: DeckTextNode,
  ctx: DeckLayoutContext,
  headingTag?: string,
  fallbackNodeId = 'deck-node',
): string {
  const { rect, paragraphs, valign, padding, fill, line, shadow, role } = node;
  const justify = valignToJustify(valign);
  const inner = renderRichContent(paragraphs, ctx, role, headingTag);
  const style =
    `position:absolute;left:${rect.x}px;top:${rect.y}px;width:${rect.w}px;height:${rect.h}px;` +
    `display:flex;flex-direction:column;justify-content:${justify};` +
    // Deck text has already been measured. Required text must not be silently
    // clipped by the canonical renderer; decorative clipping remains owned by
    // shape/image renderers.
    `box-sizing:border-box;overflow:visible;` +
    (padding ? `padding:${padding}px;` : '') +
    fillToCss(fill) +
    lineToCss(line) +
    shadowToCss(shadow);
  const deckNodeId = node.id ?? fallbackNodeId;
  const contentId = node.contentId ?? deckNodeId;
  const dataAttributes = [
    ` data-content-id="${escapeHtml(contentId)}"`,
    node.contentColumn ? ` data-column="${node.contentColumn}"` : '',
    node.contentOrder !== undefined ? ` data-order="${node.contentOrder}"` : '',
    node.bullet !== undefined ? ` data-bullet="${node.bullet}"` : '',
    ` data-role="${escapeHtml(role ?? 'content')}"`,
    ` data-deck-node-id="${escapeHtml(deckNodeId)}"`,
  ].join('');
  return `<div${dataAttributes} style="${style}">${inner}</div>`;
}

function renderShape(node: DeckShapeNode, ctx: DeckLayoutContext): string {
  const { rect, shape, fill, line, shadow, rectRadius, text, valign, role } = node;
  const radiusVal =
    shape === 'ellipse'
      ? '50%'
      : rectRadius
        ? `${Math.round(rectRadius * Math.min(rect.w, rect.h))}px`
        : '0';
  const style =
    `position:absolute;left:${rect.x}px;top:${rect.y}px;width:${rect.w}px;height:${rect.h}px;` +
    `border-radius:${radiusVal};box-sizing:border-box;overflow:hidden;` +
    fillToCss(fill) +
    lineToCss(line) +
    shadowToCss(shadow);
  let inner = '';
  if (text && text.length) {
    inner =
      `<div style="display:flex;flex-direction:column;justify-content:${valignToJustify(valign)};` +
      `width:100%;height:100%;padding:16px;box-sizing:border-box;">` +
      `${renderRichContent(text, ctx, role)}</div>`;
  }
  return `<div style="${style}">${inner}</div>`;
}

function renderImage(node: DeckImageNode): string {
  const { rect, src, fit, alt, radius } = node;
  const r = radius ?? 16;
  const radiusCss = r > 0 ? `border-radius:${r}px;` : '';
  const outer =
    `position:absolute;left:${rect.x}px;top:${rect.y}px;width:${rect.w}px;height:${rect.h}px;` +
    `overflow:hidden;box-sizing:border-box;${radiusCss}`;
  if (isDeckImagePlaceholder(src) || src === DECK_IMAGE_PLACEHOLDER) {
    // 可见灰块占位：供 VLM placeholder 模式忽略，绝不输出无效 URL 的 <img>。
    const ph =
      `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;` +
      `background:${hexToCss(DECK_NEUTRAL.border)};color:${hexToCss(DECK_NEUTRAL.muted)};` +
      `font-size:16px;text-align:center;padding:12px;${radiusCss}">${escapeHtml(alt ?? '图片占位')}</div>`;
    return `<div style="${outer}">${ph}</div>`;
  }
  const img =
    `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt ?? '')}" ` +
    `style="width:100%;height:100%;object-fit:${fit ?? 'cover'};display:block;${radiusCss}" />`;
  return `<div style="${outer}">${img}</div>`;
}

function renderTable(node: DeckTableNode, ctx: DeckLayoutContext): string {
  const { rect, rows, colW, rowH, header, border, fontSize } = node;
  const borderColor = border ? hexToCss(border.color) : hexToCss(DECK_NEUTRAL.border);
  const outer =
    `position:absolute;left:${rect.x}px;top:${rect.y}px;width:${rect.w}px;height:${rect.h}px;` +
    `overflow:hidden;box-sizing:border-box;`;
  let html =
    `<div style="${outer}"><table style="width:100%;height:100%;border-collapse:collapse;` +
    `font-size:${fontSize ?? DECK_FONT_SIZE.body}px;">`;
  rows.forEach((row, ri) => {
    html += '<tr>';
    row.forEach((cell, ci) => {
      const cs = cell.colspan ?? 1;
      const rs = cell.rowspan ?? 1;
      const isHeader = !!header && ri === 0;
      const color = cell.color
        ? hexToCss(cell.color)
        : isHeader
          ? hexToCss(ctx.primary)
          : hexToCss(ctx.text);
      let st =
        `padding:8px;vertical-align:${cell.valign ?? 'middle'};text-align:${cell.align ?? 'left'};` +
        `color:${color};border:1px solid ${borderColor};`;
      if (isHeader || cell.bold) st += 'font-weight:700;';
      if (cell.fontSize) st += `font-size:${cell.fontSize}px;`;
      if (colW?.[ci]) st += `width:${colW[ci]}px;`;
      if (rowH?.[ri]) st += `height:${rowH[ri]}px;`;
      if (cell.fill) st += fillToCss(cell.fill);
      const text = cell.paragraphs
        ? cell.paragraphs.map((p) => p.runs.map((r) => escapeHtml(r.text)).join('')).join('<br>')
        : escapeHtml(cell.text ?? '');
      html += `<td colspan="${cs}" rowspan="${rs}" style="${st}">${text}</td>`;
    });
    html += '</tr>';
  });
  html += '</table></div>';
  return html;
}

interface ChartLabel {
  x: number;
  y: number;
  text: string;
  color: string;
  size: number;
  anchor: 'start' | 'middle' | 'end';
}

function renderChart(node: DeckChartNode, ctx: DeckLayoutContext): string {
  const { rect, chart } = node;
  const W = rect.w;
  const H = rect.h;
  try {
    const palette = (
      chart.colors && chart.colors.length
        ? chart.colors
        : [ctx.primary, ctx.primaryDark, '10B981', 'F59E0B', 'EF4444', '8B5CF6']
    ).map((c) => hexToCss(c));
    const titleH = chart.title ? DECK_FONT_SIZE.h3 : 0;
    const legendH = chart.showLegend ? 28 : 0;
    const pad = 12;
    const innerW = Math.max(10, W - pad * 2);
    const innerH = Math.max(10, H - titleH - legendH - pad);
    const baseY = titleH + innerH;
    const labels: ChartLabel[] = [];
    let svg = '';
    const kind = chart.kind;

    if (kind === 'line') {
      const series = chart.series;
      const all = series.flatMap((s) => s.values);
      const max = Math.max(1, ...all);
      const n = Math.max(1, ...series.map((s) => s.values.length));
      series.forEach((s, si) => {
        const col = palette[si % palette.length];
        const pts = s.values
          .map((v, i) => {
            const x = pad + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
            const y = baseY - (v / max) * innerH;
            return `${x.toFixed(1)},${y.toFixed(1)}`;
          })
          .join(' ');
        svg += `<polyline points="${pts}" fill="none" stroke="${col}" stroke-width="3" />`;
        s.values.forEach((v, i) => {
          const x = pad + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
          const y = baseY - (v / max) * innerH;
          svg += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="${col}" />`;
        });
      });
    } else if (kind === 'pie' || kind === 'donut') {
      const s0 = chart.series[0];
      const vals = (s0?.values ?? []).filter((v) => v > 0);
      const total = vals.reduce((a, b) => a + b, 0) || 1;
      const cx = pad + innerW / 2;
      const cy = titleH + innerH / 2;
      const R = Math.min(innerW, innerH) / 2 - 4;
      const hole = kind === 'donut' ? (chart.holeSize ?? 60) / 100 : 0;
      let ang = -Math.PI / 2;
      vals.forEach((v, i) => {
        const a2 = ang + (v / total) * Math.PI * 2;
        const col = palette[i % palette.length];
        const x1 = cx + R * Math.cos(ang);
        const y1 = cy + R * Math.sin(ang);
        const x2 = cx + R * Math.cos(a2);
        const y2 = cy + R * Math.sin(a2);
        const large = a2 - ang > Math.PI ? 1 : 0;
        if (hole > 0) {
          const r2 = R * hole;
          const x3 = cx + r2 * Math.cos(a2);
          const y3 = cy + r2 * Math.sin(a2);
          const x4 = cx + r2 * Math.cos(ang);
          const y4 = cy + r2 * Math.sin(ang);
          svg +=
            `<path d="M ${x1.toFixed(1)} ${y1.toFixed(1)} A ${R} ${R} 0 ${large} 1 ${x2.toFixed(1)} ${y2.toFixed(1)} ` +
            `L ${x3.toFixed(1)} ${y3.toFixed(1)} A ${r2} ${r2} 0 ${large} 0 ${x4.toFixed(1)} ${y4.toFixed(1)} Z" fill="${col}" />`;
        } else {
          svg +=
            `<path d="M ${cx} ${cy} L ${x1.toFixed(1)} ${y1.toFixed(1)} ` +
            `A ${R} ${R} 0 ${large} 1 ${x2.toFixed(1)} ${y2.toFixed(1)} Z" fill="${col}" />`;
        }
        ang = a2;
      });
    } else {
      // bar（含 barStacked / barStacked100 近似为分组柱）
      const series = chart.series;
      const cats = chart.categories ?? series[0]?.values.map((_, i) => `${i + 1}`);
      const all = series.flatMap((s) => s.values);
      const max = Math.max(1, ...all);
      const catW = innerW / Math.max(1, cats.length);
      const groupW = catW * 0.7;
      const barW = groupW / Math.max(1, series.length);
      cats.forEach((cat, ci) => {
        const gx = pad + ci * catW + (catW - groupW) / 2;
        series.forEach((s, si) => {
          const v = s.values[ci] ?? 0;
          const h = (v / max) * innerH;
          const x = gx + si * barW;
          const y = baseY - h;
          const col = palette[si % palette.length];
          svg += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(barW - 2).toFixed(1)}" height="${h.toFixed(1)}" fill="${col}" />`;
          if (chart.showValue && h > 0) {
            labels.push({
              x: x + (barW - 2) / 2,
              y: y - 4,
              text: String(v),
              color: hexToCss(ctx.text),
              size: 11,
              anchor: 'middle',
            });
          }
        });
        labels.push({
          x: pad + ci * catW + catW / 2,
          y: baseY + 14,
          text: cat,
          color: hexToCss(ctx.textMuted),
          size: 11,
          anchor: 'middle',
        });
      });
    }

    let html =
      `<div style="position:absolute;left:${rect.x}px;top:${rect.y}px;width:${W}px;height:${H}px;` +
      `box-sizing:border-box;overflow:hidden;${fillToCss(node.fill)}">`;
    if (chart.title) {
      html +=
        `<div style="font-size:${DECK_FONT_SIZE.h3}px;font-weight:700;color:${hexToCss(ctx.primary)};` +
        `padding:${pad}px ${pad}px 0;">${escapeHtml(chart.title)}</div>`;
    }
    html += `<svg viewBox="0 0 ${W} ${H}" width="100%" height="100%" style="display:block;">${svg}</svg>`;
    // 用 HTML 标签承载文字（避免 SVG <text> 被 sanitize 剥离）
    for (const lb of labels) {
      const tx =
        lb.anchor === 'middle'
          ? `left:${lb.x}px;top:${lb.y}px;transform:translate(-50%,0);`
          : lb.anchor === 'end'
            ? `right:${W - lb.x}px;top:${lb.y}px;`
            : `left:${lb.x}px;top:${lb.y}px;`;
      html +=
        `<div style="position:absolute;${tx}font-size:${lb.size}px;color:${lb.color};white-space:nowrap;">` +
        `${escapeHtml(lb.text)}</div>`;
    }
    if (chart.showLegend) {
      const legend = chart.series
        .map(
          (s, i) =>
            `<span style="display:inline-flex;align-items:center;margin-right:12px;font-size:12px;` +
            `color:${hexToCss(ctx.text)};"><span style="display:inline-block;width:10px;height:10px;` +
            `background:${palette[i % palette.length]};margin-right:4px;border-radius:2px;"></span>` +
            `${escapeHtml(s.name ?? `系列${i + 1}`)}</span>`,
        )
        .join('');
      html += `<div style="position:absolute;left:${pad}px;bottom:${pad}px;display:flex;flex-wrap:wrap;">${legend}</div>`;
    }
    html += '</div>';
    return html;
  } catch {
    // NFR-2 静默降级：渲染失败不抛错，输出占位文本块。
    return (
      `<div style="position:absolute;left:${rect.x}px;top:${rect.y}px;width:${W}px;height:${H}px;` +
      `display:flex;align-items:center;justify-content:center;background:${hexToCss(DECK_NEUTRAL.border)};` +
      `color:${hexToCss(DECK_NEUTRAL.muted)};font-size:14px;">图表</div>`
    );
  }
}

function renderGroup(
  node: DeckGroupNode,
  ctx: DeckLayoutContext,
  options?: DeckToHtmlOptions,
  identityPath = 'group',
): string {
  const { rect, children } = node;
  const style =
    `position:absolute;left:${rect.x}px;top:${rect.y}px;width:${rect.w}px;height:${rect.h}px;` +
    (node.opacity != null ? `opacity:${node.opacity};` : '') +
    (node.rotate ? `transform:rotate(${node.rotate}deg);` : '');
  const inner = children
    .map((ch, index) => renderNode(ch, ctx, options, `${identityPath}-${index}`))
    .join('');
  return `<div style="${style}">${inner}</div>`;
}

function renderNode(
  node: DeckNode,
  ctx: DeckLayoutContext,
  options?: DeckToHtmlOptions,
  identityPath = 'node',
): string {
  switch (node.kind) {
    case 'text':
      return renderTextNode(
        node,
        ctx,
        node.role === 'title' ? (options?.headingForTitle ?? 'h2') : undefined,
        identityPath,
      );
    case 'shape':
      return renderShape(node, ctx);
    case 'image':
      return renderImage(node);
    case 'table':
      return renderTable(node, ctx);
    case 'chart':
      return renderChart(node, ctx);
    case 'group':
      return renderGroup(node, ctx, options, identityPath);
  }
}

// ---------------------------------------------------------------------------
// 上下文解析
// ---------------------------------------------------------------------------

function resolveContext(deck: Deck, options?: DeckToHtmlOptions): DeckLayoutContext {
  const t = deck.theme;
  const base = DEFAULT_DECK_LAYOUT_CONTEXT;
  return {
    primary: normalizeColor(options?.primaryColor ?? t?.primary ?? base.primary),
    primaryDark: normalizeColor(options?.primaryColorDarker ?? t?.primaryDark ?? base.primaryDark),
    background: normalizeColor(options?.background ?? t?.background ?? base.background),
    text: normalizeColor(t?.text ?? base.text),
    textMuted: normalizeColor(t?.textMuted ?? base.textMuted),
    fontFamily: options?.fontFamily ?? t?.fontFamily ?? base.fontFamily,
    style: (t?.style as StyleTheme) ?? base.style,
  };
}

// ---------------------------------------------------------------------------
// 对外 API
// ---------------------------------------------------------------------------

function renderCompareNodes(slide: DeckSlide, ctx: DeckLayoutContext, options?: DeckToHtmlOptions): string {
  const columns = (['left', 'right'] as const).map((column) => {
    const nodes = slide.nodes.filter((node) => node.contentColumn === column);
    const body = nodes.map((node, index) => renderNode(node, ctx, options, `compare-${column}-${index}`)).join('');
    return `<div data-compare-column="${column}" style="position:absolute;left:0;top:0;right:0;bottom:0;">${body}</div>`;
  }).join('');
  return `<div data-compare-root="true" data-page-type="content-compare" style="position:absolute;left:0;top:0;right:0;bottom:0;">${columns}</div>`;
}

/** 单页 DeckSlide → 屏幕预览 HTML（已注入母版/hero，若提供 referenceMaster）。 */
export function deckSlideToHtml(
  slide: DeckSlide,
  ctx: DeckLayoutContext,
  options?: DeckToHtmlOptions,
): string {
  const W = options?.width ?? 1280;
  const H = options?.height ?? 720;
  const bg = slide.background
    ? fillToCss(slide.background)
    : `background:${hexToCss(ctx.background)};`;
  const ff = fontFamilyCss(ctx.fontFamily);

  let body = slide.pageType === 'content-compare'
    ? slide.nodes.filter((node) => !node.contentColumn).map((node, index) => renderNode(node, ctx, options, `node-${index}`)).join('') + renderCompareNodes(slide, ctx, options)
    : slide.nodes.map((n, index) => renderNode(n, ctx, options, `node-${index}`)).join('');

  // deck 级母版（opt-in，默认关闭以与 LLM 预览 parity）
  if (options?.renderDeckMaster && options.master) {
    body += options.master.objects.map((o, index) => renderNode(o, ctx, options, `master-${index}`)).join('');
    const sn = options.master.slideNumber;
    if (sn) {
      body +=
        `<div style="position:absolute;left:${sn.x}px;top:${sn.y}px;width:${sn.w ?? 80}px;height:${sn.h ?? 32}px;` +
        `font-size:${sn.fontSize ?? 14}px;color:${hexToCss(sn.color ?? DECK_NEUTRAL.muted)};` +
        `text-align:${sn.align ?? 'right'};">1</div>`;
    }
  }

  const rootAttributes = [
    ' data-canonical-root="true"',
    ` data-logical-width="${W}"`,
    ` data-logical-height="${H}"`,
    slide.pageType ? ` data-page-type="${escapeHtml(slide.pageType)}"` : '',
  ].join('');
  const rootStyle =
    `position:relative;width:${W}px;height:${H}px;` +
    `width:var(--noppt-root-width,100vw);height:min(${H}px,calc(100vw * ${H} / ${W}));max-width:${W}px;min-height:0;aspect-ratio:${W} / ${H};` +
    `margin-left:var(--noppt-root-margin,-8px);margin-right:var(--noppt-root-margin,-8px);margin-top:-8px;margin-bottom:-8px;` +
    `${bg}font-family:${ff};box-sizing:border-box;overflow:visible;`;
  const canvas =
    `<div data-logical-canvas="true" style="position:relative;width:${W}px;height:${H}px;` +
    `transform:scale(var(--noppt-scale,min(1,calc(100vw / ${W}px))));transform-origin:top left;` +
    `overflow:visible;">${body}</div>`;
  const html = `<div style="${rootStyle}"${rootAttributes}>${canvas}</div>`;

  return options?.referenceMaster ? applyMasterToSlideHtml(html, options.referenceMaster) : html;
}

/** 整份 Deck → 屏幕预览 HTML（每页一个根 div，依次拼接）。 */
export function deckToHtml(deck: Deck, options?: DeckToHtmlOptions): string {
  const ctx = resolveContext(deck, options);
  const opts: DeckToHtmlOptions = {
    ...options,
    renderDeckMaster: options?.renderDeckMaster ?? false,
    master: options?.master ?? deck.master,
  };
  return deck.slides.map((s) => deckSlideToHtml(s, ctx, opts)).join('\n');
}
