/**
 * 受控内联 SVG 渲染器（FR-18 §18.5 / Q12 / Q13）
 *
 * 设计约束：
 * - 纯函数：输入结构化 spec → 输出自包含 SVG 字符串，不依赖任何外部图表库（echarts/chart.js/CDN）。
 * - 全部输入做防御性校验；任何非法/缺字段或计算异常均**静默降级**（返回 ''），绝不抛错阻塞主流程（NFR-2）。
 * - 颜色全部由调用方传入的 primaryColor / primaryColorDarker 派生，保证与演示主题一致，离线/私有部署可用。
 * - architecture 复用同一套分层渲染辅助（renderHierarchicalSvg），与 content-org-chart 共享视觉（Q13 决策）。
 */

import type {
  ChartSpec,
  ChartSeries,
  ArchitectureSpec,
  ArchNode,
  ArchNodeVariant,
} from '../types';

export interface SvgRenderOptions {
  primaryColor: string;
  primaryColorDarker: string;
  width?: number;
  height?: number;
}

const DEFAULT_W = 920;
const DEFAULT_H = 460;

// ---------------------------------------------------------------------------
// 通用工具
// ---------------------------------------------------------------------------

function clampNum(n: unknown, fallback = 0): number {
  return typeof n === 'number' && isFinite(n) ? n : fallback;
}

function escapeXml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function truncate(s: string, max = 14): string {
  const t = String(s ?? '');
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

function fmtVal(v: number, unit?: string): string {
  const num = Math.round(v * 100) / 100;
  return unit ? `${num}${escapeXml(unit)}` : `${num}`;
}

function hexToRgb(hex: string): [number, number, number] {
  let h = String(hex || '').replace('#', '').trim();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  if (!isFinite(n) || h.length !== 6) return [37, 99, 235]; // 兜底蓝
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** 混合 hex 与白(amt>0)/黑(amt<0)，amt ∈ [-1,1] */
function shade(hex: string, amt: number): string {
  const [r, g, b] = hexToRgb(hex);
  const target = amt >= 0 ? 255 : 0;
  const t = Math.abs(amt);
  const mix = (c: number) => Math.round(c + (target - c) * t);
  const to2 = (c: number) => c.toString(16).padStart(2, '0');
  return `#${to2(mix(r))}${to2(mix(g))}${to2(mix(b))}`;
}

/** 由主色派生多序列调色板（深浅渐变，保证可区分） */
function safePalette(primary: string, count: number): string[] {
  if (count <= 1) return [primary];
  const arr: string[] = [];
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0 : (i / (count - 1)) * 2 - 1; // -1..1
    arr.push(shade(primary, t * 0.45));
  }
  return arr;
}

function svgWrap(w: number, h: number, inner: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" ` +
    `width="100%" preserveAspectRatio="xMidYMid meet" ` +
    `role="img" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'PingFang SC','Microsoft YaHei',sans-serif">` +
    inner +
    `</svg>`
  );
}

function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

// ---------------------------------------------------------------------------
// 坐标轴（bar / line 共用）
// ---------------------------------------------------------------------------

interface AxisLayout {
  w: number;
  h: number;
  padL: number;
  padR: number;
  padT: number;
  padB: number;
  plotW: number;
  plotH: number;
  maxVal: number;
  categories: string[];
}

function buildAxis(spec: ChartSpec, w: number, h: number): AxisLayout {
  const padL = 64;
  const padR = 20;
  const padT = 18;
  const padB = 46;
  const plotW = Math.max(10, w - padL - padR);
  const plotH = Math.max(10, h - padT - padB);

  // 类别取第一序列的标签
  const first = spec.series[0];
  const categories = (first?.points || []).map((p) => String(p?.label ?? ''));
  let maxVal = 0;
  for (const s of spec.series) {
    for (const p of s?.points || []) maxVal = Math.max(maxVal, clampNum(p?.value));
  }
  if (maxVal <= 0) maxVal = 1;
  // 向上取整到友好刻度
  const niceMax = niceCeil(maxVal);
  return { w, h, padL, padR, padT, padB, plotW, plotH, maxVal: niceMax, categories };
}

function niceCeil(v: number): number {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const norm = v / mag;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return step * mag;
}

function drawGridAxis(ly: AxisLayout, unit?: string): string {
  const { padL, padT, plotW, plotH, maxVal } = ly;
  const ticks = 4;
  let s = '';
  for (let i = 0; i <= ticks; i++) {
    const val = (maxVal / ticks) * i;
    const y = padT + plotH - (val / maxVal) * plotH;
    s += `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${(padL + plotW).toFixed(1)}" y2="${y.toFixed(1)}" stroke="#e5e7eb" stroke-width="1"/>`;
    s += `<text x="${(padL - 8).toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="12" fill="#6b7280">${fmtVal(val, unit)}</text>`;
  }
  // 轴线
  s += `<line x1="${padL}" y1="${padT}" x2="${padL}" y2="${(padT + plotH).toFixed(1)}" stroke="#9ca3af" stroke-width="1.5"/>`;
  s += `<line x1="${padL}" y1="${(padT + plotH).toFixed(1)}" x2="${(padL + plotW).toFixed(1)}" y2="${(padT + plotH).toFixed(1)}" stroke="#9ca3af" stroke-width="1.5"/>`;
  return s;
}

function drawXLabels(ly: AxisLayout): string {
  const { padL, padT, plotW, plotH, categories } = ly;
  const n = categories.length;
  if (n === 0) return '';
  const step = plotW / n;
  let s = '';
  for (let i = 0; i < n; i++) {
    const cx = padL + step * (i + 0.5);
    s += `<text x="${cx.toFixed(1)}" y="${(padT + plotH + 20).toFixed(1)}" text-anchor="middle" font-size="12" fill="#374151">${escapeXml(truncate(categories[i], 10))}</text>`;
  }
  return s;
}

// ---------------------------------------------------------------------------
// 柱状图 / 折线图
// ---------------------------------------------------------------------------

function renderBar(spec: ChartSpec, opts: SvgRenderOptions, ly: AxisLayout): string {
  const { padL, padT, plotW, plotH, maxVal, categories } = ly;
  const n = categories.length;
  if (n === 0) return '';
  const palette = safePalette(opts.primaryColor, spec.series.length);
  const grouped = !spec.stacked && spec.series.length > 1;
  const step = plotW / n;
  const groupW = step * 0.66;
  const seriesCount = spec.series.length;
  const barW = grouped ? groupW / seriesCount : groupW;
  let s = '';

  for (let i = 0; i < n; i++) {
    const groupX = padL + step * i + (step - groupW) / 2;
    if (spec.stacked) {
      let acc = 0;
      for (let si = 0; si < seriesCount; si++) {
        const p = spec.series[si]?.points?.[i];
        const val = p ? clampNum(p.value) : 0;
        const barH = (val / maxVal) * plotH;
        const x = groupX;
        const y = padT + plotH - (acc + val) / maxVal * plotH;
        s += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${groupW.toFixed(1)}" height="${Math.max(0, barH).toFixed(1)}" rx="3" fill="${palette[si]}"/>`;
        if (spec.showValues !== false && val > 0) {
          s += `<text x="${(x + groupW / 2).toFixed(1)}" y="${(y - 5).toFixed(1)}" text-anchor="middle" font-size="11" fill="#374151">${fmtVal(val, spec.unit)}</text>`;
        }
        acc += val;
      }
    } else {
      for (let si = 0; si < seriesCount; si++) {
        const p = spec.series[si]?.points?.[i];
        const val = p ? clampNum(p.value) : 0;
        const barH = (val / maxVal) * plotH;
        const x = grouped ? groupX + barW * si : groupX;
        const y = padT + plotH - (val / maxVal) * plotH;
        s += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(1, barW - 2).toFixed(1)}" height="${Math.max(0, barH).toFixed(1)}" rx="3" fill="${palette[si]}"/>`;
        if (spec.showValues !== false && val > 0) {
          s += `<text x="${(x + (barW - 2) / 2).toFixed(1)}" y="${(y - 5).toFixed(1)}" text-anchor="middle" font-size="11" fill="#374151">${fmtVal(val, spec.unit)}</text>`;
        }
      }
    }
  }
  return s;
}

function renderLine(spec: ChartSpec, opts: SvgRenderOptions, ly: AxisLayout): string {
  const { padL, padT, plotW, plotH, maxVal, categories } = ly;
  const n = categories.length;
  if (n === 0) return '';
  const palette = safePalette(opts.primaryColor, spec.series.length);
  const step = plotW / n;
  let s = '';
  spec.series.forEach((ser: ChartSeries, si: number) => {
    const color = ser?.color || palette[si];
    const pts: string[] = [];
    (ser?.points || []).forEach((p, i) => {
      const val = clampNum(p?.value);
      const x = padL + step * (i + 0.5);
      const y = padT + plotH - (val / maxVal) * plotH;
      pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    });
    s += `<polyline points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`;
    (ser?.points || []).forEach((p, i) => {
      const val = clampNum(p?.value);
      const x = padL + step * (i + 0.5);
      const y = padT + plotH - (val / maxVal) * plotH;
      s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4" fill="#fff" stroke="${color}" stroke-width="2.5"/>`;
      if (spec.showValues !== false && val > 0) {
        s += `<text x="${x.toFixed(1)}" y="${(y - 9).toFixed(1)}" text-anchor="middle" font-size="11" fill="#374151">${fmtVal(val, spec.unit)}</text>`;
      }
    });
  });
  return s;
}

// ---------------------------------------------------------------------------
// 饼图 / 环形图
// ---------------------------------------------------------------------------

function renderPieDonut(spec: ChartSpec, opts: SvgRenderOptions, w: number, h: number, donut: boolean): string {
  const series = spec.series?.[0];
  const points = series?.points || [];
  if (points.length === 0) return '';
  const cx = w / 2;
  const cy = h / 2;
  const rOut = Math.min(w, h) / 2 - 24;
  const rIn = donut ? rOut * 0.58 : 0;
  const total = points.reduce((acc, p) => acc + Math.max(0, clampNum(p?.value)), 0);
  if (total <= 0) return '';
  const palette = safePalette(opts.primaryColor, points.length);
  let angle = -90;
  let s = '';
  const labels: string[] = [];
  points.forEach((p, i) => {
    const val = Math.max(0, clampNum(p?.value));
    const sweep = (val / total) * 360;
    const a0 = angle;
    const a1 = angle + sweep;
    const large = sweep > 180 ? 1 : 0;
    const [ox0, oy0] = polar(cx, cy, rOut, a0);
    const [ox1, oy1] = polar(cx, cy, rOut, a1);
    const color = palette[i % palette.length];
    if (donut) {
      const [ix1, iy1] = polar(cx, cy, rIn, a1);
      const [ix0, iy0] = polar(cx, cy, rIn, a0);
      s += `<path d="M ${ox0.toFixed(1)} ${oy0.toFixed(1)} A ${rOut} ${rOut} 0 ${large} 1 ${ox1.toFixed(1)} ${oy1.toFixed(1)} L ${ix1.toFixed(1)} ${iy1.toFixed(1)} A ${rIn} ${rIn} 0 ${large} 0 ${ix0.toFixed(1)} ${iy0.toFixed(1)} Z" fill="${color}"/>`;
    } else {
      s += `<path d="M ${cx} ${cy} L ${ox0.toFixed(1)} ${oy0.toFixed(1)} A ${rOut} ${rOut} 0 ${large} 1 ${ox1.toFixed(1)} ${oy1.toFixed(1)} Z" fill="${color}"/>`;
    }
    // 标签（百分比）
    const mid = angle + sweep / 2;
    const [lx, ly] = polar(cx, cy, donut ? (rOut + rIn) / 2 : rOut * 0.62, mid);
    const pct = Math.round((val / total) * 100);
    s += `<text x="${lx.toFixed(1)}" y="${(ly + 4).toFixed(1)}" text-anchor="middle" font-size="12" fill="#fff" font-weight="600">${pct}%</text>`;
    labels.push(`${escapeXml(String(p?.label ?? ''))} ${fmtVal(val, spec.unit)}`);
    angle = a1;
  });
  // 图例
  labels.forEach((lab, i) => {
    const ly = 20 + i * 20;
    s += `<rect x="${(w - 150).toFixed(1)}" y="${(ly - 10).toFixed(1)}" width="12" height="12" rx="2" fill="${palette[i % palette.length]}"/>`;
    s += `<text x="${(w - 134).toFixed(1)}" y="${ly.toFixed(1)}" font-size="12" fill="#374151">${truncate(lab, 16)}</text>`;
  });
  return s;
}

// ---------------------------------------------------------------------------
// 循环图（环形节点 + 单向箭头，独立渲染器，Q13）
// ---------------------------------------------------------------------------

export function renderCycleSvg(keyPoints: string[], opts: SvgRenderOptions, width = DEFAULT_W, height = DEFAULT_H): string {
  try {
    const items = (keyPoints || []).map((k) => String(k ?? '')).filter((k) => k.length > 0);
    if (items.length < 2) return '';
    const cx = width / 2;
    const cy = height / 2;
    const r = Math.min(width, height) / 2 - 70;
    const n = items.length;
    const color = opts.primaryColor;
    const dark = opts.primaryColorDarker || shade(color, -0.3);
    let s = '';
    const nodePos: Array<[number, number]> = [];
    for (let i = 0; i < n; i++) {
      const deg = -90 + (360 / n) * i;
      const [x, y] = polar(cx, cy, r, deg);
      nodePos.push([x, y]);
    }
    // 环形引导圈
    s += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${shade(color, 0.55)}" stroke-width="2" stroke-dasharray="4 6"/>`;
    // 节点 + 文字
    items.forEach((txt, i) => {
      const [x, y] = nodePos[i];
      s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="34" fill="${shade(color, 0.65)}" stroke="${color}" stroke-width="2"/>`;
      s += `<text x="${x.toFixed(1)}" y="${(y + 5).toFixed(1)}" text-anchor="middle" font-size="13" fill="${dark}" font-weight="600">${truncate(txt, 6)}</text>`;
      // 序号
      s += `<text x="${(x - 26).toFixed(1)}" y="${(y - 22).toFixed(1)}" text-anchor="middle" font-size="12" fill="#fff" font-weight="700">${i + 1}</text>`;
    });
    // 单向箭头（顺时针，节点间）
    for (let i = 0; i < n; i++) {
      const a = -90 + (360 / n) * i + (360 / n) * 0.5;
      const [ax, ay] = polar(cx, cy, r, a);
      const tang = a + 90;
      const [tx, ty] = polar(ax, ay, 10, tang);
      const [bx, by] = polar(ax, ay, -10, tang);
      const [hx, hy] = polar(ax, ay, 14, a + 90 + 20);
      s += `<path d="M ${tx.toFixed(1)} ${ty.toFixed(1)} L ${bx.toFixed(1)} ${by.toFixed(1)} L ${hx.toFixed(1)} ${hy.toFixed(1)} Z" fill="${dark}"/>`;
    }
    s += `<text x="${cx}" y="${(cy + r + 40).toFixed(1)}" text-anchor="middle" font-size="13" fill="#6b7280">循环 / 迭代流程</text>`;
    return svgWrap(width, height, s);
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// 数据看板（多指标卡 + 可选迷你图）
// ---------------------------------------------------------------------------

export function renderDashboardSvg(
  metrics: Array<{ label: string; value: string; trend?: 'up' | 'down' | 'flat' }>,
  opts: SvgRenderOptions,
  miniChart?: ChartSpec,
  width = DEFAULT_W,
  height = DEFAULT_H,
): string {
  try {
    const items = (metrics || []).filter((m) => m && m.label != null);
    if (items.length === 0) return '';
    const color = opts.primaryColor;
    const dark = opts.primaryColorDarker || shade(color, -0.3);
    const cols = Math.min(items.length, 4);
    const gap = 16;
    const cardW = (width - gap * (cols + 1)) / cols;
    const cardH = Math.min(150, height - 40);
    const top = (height - cardH) / 2;
    let s = '';
    const trendColor: Record<string, string> = { up: '#16a34a', down: '#dc2626', flat: '#6b7280' };
    const trendGlyph: Record<string, string> = { up: '↑', down: '↓', flat: '→' };
    items.slice(0, cols).forEach((m, i) => {
      const x = gap + i * (cardW + gap);
      s += `<rect x="${x.toFixed(1)}" y="${top.toFixed(1)}" width="${cardW.toFixed(1)}" height="${cardH.toFixed(1)}" rx="12" fill="#fff" stroke="${shade(color, 0.6)}" stroke-width="1.5"/>`;
      s += `<rect x="${x.toFixed(1)}" y="${top.toFixed(1)}" width="${cardW.toFixed(1)}" height="6" rx="3" fill="${color}"/>`;
      s += `<text x="${(x + 16).toFixed(1)}" y="${(top + 34).toFixed(1)}" font-size="14" fill="#6b7280">${escapeXml(truncate(String(m.label), 10))}</text>`;
      s += `<text x="${(x + 16).toFixed(1)}" y="${(top + 78).toFixed(1)}" font-size="30" font-weight="700" fill="${dark}">${escapeXml(String(m.value ?? ''))}</text>`;
      const t = m.trend;
      if (t && trendGlyph[t]) {
        s += `<text x="${(x + cardW - 28).toFixed(1)}" y="${(top + 78).toFixed(1)}" font-size="26" font-weight="700" fill="${trendColor[t]}">${trendGlyph[t]}</text>`;
      }
    });
    // 可选迷你图（右下角）
    if (miniChart && items.length > 0) {
      const mw = 220;
      const mh = 110;
      const mx = width - mw - 16;
      const my = height - mh - 16;
      const mini = renderChartSvg(miniChart, { ...opts, width: mw, height: mh });
      if (mini) {
        s += `<rect x="${mx}" y="${my}" width="${mw}" height="${mh}" rx="10" fill="#f8fafc" stroke="#e5e7eb"/>`;
        s += `<g transform="translate(${mx + 8},${my + 8})">${stripSvgWrap(mini)}</g>`;
      }
    }
    return svgWrap(width, height, s);
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// 分层架构图（复用分层渲染，Q13：与 org-chart 共享视觉）
// ---------------------------------------------------------------------------

function renderHierarchicalSvg(spec: ArchitectureSpec, opts: SvgRenderOptions, width = DEFAULT_W): string {
  const layers = (spec?.layers || []).filter((l) => l && Array.isArray(l.nodeIds) && l.nodeIds.length > 0);
  if (layers.length === 0) return '';
  const nodeMap = new Map<number, ArchNode>();
  for (const nd of spec?.nodes || []) {
    if (nd && typeof nd.id === 'number') nodeMap.set(nd.id, nd);
  }
  const color = opts.primaryColor;
  const dark = opts.primaryColorDarker || shade(color, -0.3);

  const padX = 24;
  const padTop = 28;
  const layerH = 96;
  const layerGap = 40;
  const height = padTop + layers.length * layerH + (layers.length - 1) * layerGap + 24;

  let s = '';
  const nodeCenter = new Map<number, [number, number]>();

  layers.forEach((layer, li) => {
    const y = padTop + li * (layerH + layerGap);
    // 层背景带
    s += `<rect x="${padX}" y="${y}" width="${width - padX * 2}" height="${layerH}" rx="14" fill="${shade(color, li % 2 === 0 ? 0.78 : 0.84)}" stroke="${shade(color, 0.5)}" stroke-width="1" opacity="0.9"/>`;
    if (layer.title) {
      s += `<text x="${(padX + 12).toFixed(1)}" y="${(y - 8).toFixed(1)}" font-size="13" font-weight="600" fill="${dark}">${escapeXml(String(layer.title))}</text>`;
    }
    const ids = layer.nodeIds;
    const n = ids.length;
    const innerW = width - padX * 2;
    const cellW = innerW / n;
    ids.forEach((id, ni) => {
      const nd = nodeMap.get(id);
      if (!nd) return;
      const cx = padX + cellW * (ni + 0.5);
      const cy = y + layerH / 2;
      nodeCenter.set(id, [cx, cy]);
      s += renderArchNode(cx, cy, nd.variant || 'box', String(nd.label), color, dark);
    });
  });

  // 流向连线
  for (const [from, to] of spec?.flows || []) {
    const a = nodeCenter.get(from);
    const b = nodeCenter.get(to);
    if (!a || !b) continue;
    s += `<path d="M ${a[0].toFixed(1)} ${(a[1] + 24).toFixed(1)} C ${a[0].toFixed(1)} ${(a[1] + 60).toFixed(1)}, ${b[0].toFixed(1)} ${(b[1] - 60).toFixed(1)}, ${b[0].toFixed(1)} ${(b[1] - 24).toFixed(1)}" fill="none" stroke="${dark}" stroke-width="2" marker-end="url(#archArrow)"/>`;
  }
  s += `<defs><marker id="archArrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto"><path d="M0,0 L8,3 L0,6 Z" fill="${dark}"/></marker></defs>`;
  return svgWrap(width, height, s);
}

function renderArchNode(cx: number, cy: number, variant: ArchNodeVariant, label: string, color: string, dark: string): string {
  const w = 132;
  const h = 52;
  const x = cx - w / 2;
  const y = cy - h / 2;
  let shape = '';
  const fill = shade(color, 0.7);
  if (variant === 'ellipse') {
    shape = `<ellipse cx="${cx}" cy="${cy}" rx="${w / 2}" ry="${h / 2}" fill="${fill}" stroke="${color}" stroke-width="2"/>`;
  } else if (variant === 'cloud') {
    shape = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="${fill}" stroke="${color}" stroke-width="2"/>`;
  } else if (variant === 'cylinder') {
    const ry = 10;
    shape =
      `<path d="M ${x} ${y + ry} A ${w / 2} ${ry} 0 0 1 ${x + w} ${y + ry}" fill="${shade(color, 0.55)}"/>` +
      `<rect x="${x}" y="${y + ry}" width="${w}" height="${h - ry * 2}" fill="${fill}"/>` +
      `<path d="M ${x} ${y + h - ry} A ${w / 2} ${ry} 0 0 1 ${x + w} ${y + h - ry} Z" fill="${fill}" stroke="${color}" stroke-width="2"/>` +
      `<line x1="${x}" y1="${y + ry}" x2="${x}" y2="${y + h - ry}" stroke="${color}" stroke-width="2"/>` +
      `<line x1="${x + w}" y1="${y + ry}" x2="${x + w}" y2="${y + h - ry}" stroke="${color}" stroke-width="2"/>`;
  } else {
    // box（默认）
    shape = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="${fill}" stroke="${color}" stroke-width="2"/>`;
  }
  const text = `<text x="${cx}" y="${cy + 5}" text-anchor="middle" font-size="13" font-weight="600" fill="${dark}">${escapeXml(truncate(label, 12))}</text>`;
  return shape + text;
}

export function renderArchitectureSvg(spec: ArchitectureSpec, opts: SvgRenderOptions, width = DEFAULT_W): string {
  try {
    return renderHierarchicalSvg(spec, opts, width);
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// 图表主入口（按 kind 分发）
// ---------------------------------------------------------------------------

export function renderChartSvg(spec: ChartSpec, opts: SvgRenderOptions): string {
  try {
    if (!spec || !Array.isArray(spec.series) || spec.series.length === 0) return '';
    const w = opts.width ?? DEFAULT_W;
    const h = opts.height ?? DEFAULT_H;
    const ly = buildAxis(spec, w, h);
    let inner = drawGridAxis(ly, spec.unit) + drawXLabels(ly);
    switch (spec.kind) {
      case 'bar':
        inner += renderBar(spec, opts, ly);
        break;
      case 'line':
        inner += renderLine(spec, opts, ly);
        break;
      case 'pie':
        return svgWrap(w, h, inner + renderPieDonut(spec, opts, w, h, false));
      case 'donut':
        return svgWrap(w, h, inner + renderPieDonut(spec, opts, w, h, true));
      default:
        return '';
    }
    // 图例（多序列）
    if (spec.series.length > 1 && spec.showLegend !== false) {
      const palette = safePalette(opts.primaryColor, spec.series.length);
      let lx = ly.padL;
      spec.series.forEach((ser, i) => {
        const label = ser?.name || `系列${i + 1}`;
        inner += `<rect x="${lx}" y="${(ly.h - 14).toFixed(1)}" width="12" height="12" rx="2" fill="${palette[i]}"/>`;
        inner += `<text x="${(lx + 18).toFixed(1)}" y="${(ly.h - 4).toFixed(1)}" font-size="12" fill="#374151">${escapeXml(label)}</text>`;
        lx += 18 + label.length * 12 + 24;
      });
    }
    return svgWrap(w, h, inner);
  } catch {
    return '';
  }
}

// 去掉 svg 外层包裹，便于嵌套进另一个 svg 的 <g>
function stripSvgWrap(svg: string): string {
  const m = svg.match(/<svg[^>]*>([\s\S]*)<\/svg>/i);
  return m ? m[1] : svg;
}
