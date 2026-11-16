/**
 * 阶段 2/3 装饰渲染器 —— 从 `deck-to-html.ts` 外置，守住 800 行门禁。
 *
 * 只负责「视觉装饰」：主题背景光晕 / 全篇统一页眉母题 / 参考撞色斑点 / 语义组件节点。
 * 内容节点（text/shape/image/table/chart）仍由 `deck-to-html.ts` 渲染。
 *
 * 说明：`hexToCss` / `escapeHtml` 是与 `deck-to-html.ts` 同源的私有副本，
 * 目的是避免本模块反向 import 主渲染器形成循环依赖（与项目既有
 * `getFontStackLocal` 双副本模式一致）。两者都是纯字符串函数、无状态。
 */

import type { DeckNode } from '@noppt/core/deck';
import type { ReferencePalette } from '../../../types';
import type { VisualTheme } from './visual-tokens';
import type { DerivedDecorColors } from './deck-primary-visual';

type DeckDecorationNode = Extract<DeckNode, { kind: 'decoration' }>;

function hexToCss(c?: string, fallback = '#000000'): string {
  if (!c) return fallback;
  const s = String(c).trim();
  if (s.startsWith('#')) return s;
  if (/^[0-9a-fA-F]{3,8}$/.test(s)) return '#' + s;
  return fallback;
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 主题背景层：两层画布内 radial 光斑 + 全篇统一页眉装饰线 + 主色母题短条。
 * 全部装饰限制在 W×H 内、位于页眉安全区，不与标题/正文相交；
 * 元素 pointer-events:none 且不含 data-deck-node-id，不参与内容选择与 PPTX parity。
 *
 * `derived` 由 deck 级统一主色派生（生产路径 opt-in）；未传时沿用 `VISUAL_THEMES`
 * 固定色板，保证「零装饰 legacy / 参考多色保真」分支与既有快照不回归。
 */
export function renderVisualBackdrop(
  theme: VisualTheme,
  W: number,
  H: number,
  _pageType?: string,
  derived?: DerivedDecorColors,
): string {
  const glowA =
    `<div style="position:absolute;left:${Math.round(W * 0.62)}px;top:0px;` +
    `width:${Math.round(W * 0.38)}px;height:${Math.round(H * 0.6)}px;border-radius:50%;` +
    `background:radial-gradient(circle at center,${derived?.glowA ?? theme.glowA} 0%,transparent 70%);` +
    `opacity:0.55;pointer-events:none;"></div>`;
  const glowB =
    `<div style="position:absolute;left:0px;top:${Math.round(H * 0.55)}px;` +
    `width:${Math.round(W * 0.32)}px;height:${Math.round(H * 0.45)}px;border-radius:50%;` +
    `background:radial-gradient(circle at center,${derived?.glowB ?? theme.glowB} 0%,transparent 72%);` +
    `opacity:0.45;pointer-events:none;"></div>`;
  // 全篇统一：封面用 0.45、其余 0.30 会让同一条页眉线跨页呈现浓淡差。
  const ruleOpacity = '0.30';
  const headerRule =
    `<svg viewBox="0 0 ${W} 8" width="${W}" height="8" ` +
    `style="position:absolute;left:0;top:24px;pointer-events:none;">` +
    `<path d="M0 4 L ${W} 4" fill="none" stroke="${derived?.accent ?? theme.svgAccent}" ` +
    `stroke-width="2" opacity="${ruleOpacity}"/></svg>`;
  const motif =
    `<div style="position:absolute;left:64px;top:32px;` +
    `width:56px;height:6px;border-radius:3px;` +
    `background:linear-gradient(90deg,${derived?.main ?? theme.palette.blue} 0%,` +
    `${derived?.soft ?? theme.palette.softBlue} 100%);` +
    `box-shadow:${theme.shadows.sm};pointer-events:none;"></div>`;
  return (
    `<div class="noppt-visual-backdrop" style="position:absolute;left:0;top:0;` +
    `width:${W}px;height:${H}px;overflow:hidden;pointer-events:none;">` +
    `${glowA}${glowB}${headerRule}${motif}</div>`
  );
}

/**
 * 参考撞色装饰层：把「参考克隆 · 色彩红线豁免」放行后的 accent 色送进 Deck HTML。
 * 仅在多色参考存在时输出；三个斑点全部钳制在画布内，默认路径零装饰。
 */
export function renderReferenceAccentLayer(
  palette: ReferencePalette | undefined,
  W: number,
  H: number,
): string {
  if (!palette?.isMultiColor || palette.accents.length === 0) return '';
  const spots = [
    { left: Math.round(W * 0.7), top: Math.round(H * 0.05), size: Math.round(W * 0.24) },
    { left: Math.round(W * 0.02), top: Math.round(H * 0.62), size: Math.round(W * 0.2) },
    { left: Math.round(W * 0.46), top: Math.round(H * 0.72), size: Math.round(W * 0.14) },
  ];
  const spotsHtml = palette.accents
    .slice(0, 3)
    .map((color, i) => {
      const spot = spots[i] ?? spots[spots.length - 1];
      return (
        `<div style="position:absolute;left:${spot.left}px;top:${spot.top}px;` +
        `width:${spot.size}px;height:${spot.size}px;border-radius:50%;` +
        `background:${hexToCss(color)};opacity:0.12;pointer-events:none;"></div>`
      );
    })
    .join('');
  return (
    `<div class="noppt-accent-layer" style="position:absolute;left:0;top:0;` +
    `width:${W}px;height:${H}px;overflow:hidden;pointer-events:none;">${spotsHtml}</div>`
  );
}

function decorationColors(
  theme: VisualTheme | undefined,
  tone?: string,
): { main: string; soft: string } {
  const p = theme ? (theme.palette as unknown as Record<string, string>) : undefined;
  const key = tone ?? 'blue';
  const cap = key.replace(/^./, (c) => c.toUpperCase());
  return { main: p?.[key] ?? '#2563eb', soft: p?.[`soft${cap}`] ?? '#eff6ff' };
}

/** 阶段 3：语义组件 → 内联样式 HTML（不依赖 `<style>`，全部属性在安全白名单内）。 */
export function renderDecoration(
  node: DeckDecorationNode,
  theme: VisualTheme | undefined,
  identityPath: string,
  derived?: DerivedDecorColors,
): string {
  const { rect, decoration, value, label, tone, progress } = node;
  const { main, soft } = derived ?? decorationColors(theme, tone);
  const shadow = theme?.shadows.md ?? '0 4px 16px rgba(15,23,42,0.06)';
  const radius = theme?.radii.md ?? 14;
  const labelSize = theme?.fontSize.label ?? 13;
  const kpiSize = theme?.fontSize.kpi ?? 30;
  let style =
    `position:absolute;left:${rect.x}px;top:${rect.y}px;width:${rect.w}px;height:${rect.h}px;` +
    `box-sizing:border-box;pointer-events:none;`;
  let inner = '';
  switch (decoration) {
    case 'badge':
      style +=
        `display:flex;align-items:center;justify-content:center;border-radius:${radius}px;` +
        `background:${main};color:#ffffff;font-size:${labelSize + 4}px;font-weight:800;` +
        `box-shadow:${shadow};`;
      inner = escapeHtml(value ?? '');
      break;
    case 'kpi':
      style +=
        `border-radius:${radius}px;background:${soft};border-left:4px solid ${main};` +
        `padding:14px 20px;box-shadow:${shadow};display:flex;flex-direction:column;justify-content:center;`;
      inner =
        `<div style="font-size:${kpiSize}px;font-weight:800;color:${main};line-height:1.1;">` +
        `${escapeHtml(value ?? '0')}</div>` +
        `<div style="font-size:${labelSize}px;color:#475569;margin-top:6px;">` +
        `${escapeHtml(label ?? '')}</div>`;
      break;
    case 'timeline': {
      const pct = Math.max(0, Math.min(100, progress ?? 100));
      style += `display:flex;align-items:center;gap:10px;`;
      inner =
        `<div style="width:12px;height:12px;border-radius:50%;background:${main};box-shadow:${shadow};"></div>` +
        `<div style="height:2px;flex:1;background:linear-gradient(90deg,${main} ${pct}%,${soft} ${pct}%);"></div>` +
        `<div style="font-size:${labelSize}px;color:#475569;">${escapeHtml(label ?? '')}</div>`;
      break;
    }
    case 'callout': {
      const compact = rect.h <= 40;
      // 页脚/提示条统一用不透明中性表面色：半透明 soft 叠在不同页型的卡片底色上会
      // 呈现不同深浅（实测 02/05 页脚偏白、03/05 页脚偏粉），且不再承载正文复述。
      const surface = '#f9fafb';
      if (compact) {
        const pct = Math.max(0, Math.min(100, progress ?? 0));
        style +=
          `display:flex;align-items:center;gap:12px;padding:0 14px;border-radius:${radius}px;` +
          `background:${surface};border-left:3px solid ${main};overflow:hidden;` +
          `font-size:16px;color:#0f172a;white-space:nowrap;`;
        const rail = pct > 0
          ? `<span style="flex:1;height:6px;border-radius:3px;background:#e5e7eb;overflow:hidden;">` +
            `<span style="display:block;width:${pct}%;height:100%;background:${main};"></span></span>`
          : '';
        inner =
          `<strong style="color:${main};flex-shrink:0;">${escapeHtml(label ?? '')}</strong>` +
          rail +
          (value ? `<span style="overflow:hidden;text-overflow:ellipsis;">${escapeHtml(value)}</span>` : '');
      } else {
        style +=
          `border-radius:${radius}px;background:${surface};border:1px solid ${main};` +
          `padding:12px 18px;box-shadow:${shadow};font-size:16px;color:#0f172a;overflow:hidden;`;
        inner =
          `<strong style="color:${main};">${escapeHtml(label ?? '')}</strong> ${escapeHtml(value ?? '')}`;
      }
      break;
    }
    case 'quote':
      style +=
        `border-left:4px solid ${main};padding:12px 20px;font-size:22px;font-weight:700;` +
        `color:#0f172a;background:linear-gradient(90deg,${soft},transparent);`;
      inner = escapeHtml(value ?? '');
      break;
    case 'heat-cell': {
      const alpha = (0.2 + Math.max(0, Math.min(100, progress ?? 50)) / 125).toFixed(2);
      style +=
        `border-radius:8px;background:${main};opacity:${alpha};display:flex;` +
        `align-items:center;justify-content:center;font-size:${labelSize}px;color:#ffffff;`;
      inner = escapeHtml(value ?? '');
      break;
    }
  }
  const deckNodeId = node.id ?? identityPath;
  const contentId = node.contentId ?? deckNodeId;
  return (
    `<div data-content-id="${escapeHtml(contentId)}" data-role="decoration" ` +
    `data-deck-node-id="${escapeHtml(deckNodeId)}" style="${style}">${inner}</div>`
  );
}
