/**
 * 图片节点层决策（Deck 节点树版 image-plan-guard）。
 *
 * 现状 LLM-HTML 路径在 `render.ts` / `assemble.ts` 用基于 HTML 字符串手术做配图决策
 * （`utils/image-plan-guard.ts` 的 `resolveSlideImageDecision` + `stripImagePlaceholders`
 * + `injectImagePlaceholderForContentSlide`）。本文件是其**节点层等价物**：
 *
 * - 决策逻辑（结构页恒不配图 / pref=none 剥离 / plan.needsImage 命中）复用
 *   `utils/image-plan-guard.ts` 的纯函数 SSOT，保证两侧语义一致；
 * - 占位判定改用 `isDeckImagePlaceholder(src)`（来自 `@noppt/core/deck`），
 *   **不再**正则匹配 `<img>` / `IMAGE_PLACEHOLDER`（见 LLM-HTML-BEHAVIOR-SNAPSHOT.md §图片节点层决策）；
 * - `stripDeckImagePlaceholders` / `applyDeckImageGuard` 直接对 `DeckNode[]` / `SlidePlan`
 *   增删 `DeckImageNode`，把内容页升级为 `content-image-left` 带图版式，而不是改 HTML 字符串。
 *
 * 红线：本文件为新增模块，仅通过 `deck/index.ts` 的 `export *` 对外暴露；
 * 不修改 `utils/image-plan-guard.ts` / `render.ts` / `assemble.ts` 既有导出，不删除任何文件。
 */

import { DECK_IMAGE_PLACEHOLDER, isDeckImagePlaceholder } from '@noppt/core/deck';
import type { DeckNode, DeckSlide, DeckTextNode } from '@noppt/core/deck';
import type { ImagePreference, SlidePageType, SlidePlan } from '../../../types';
import { DECK_BODY_RECT } from './layout-templates';
import { isStructurePage, resolveSlideImageDecision } from '../../../utils/image-plan-guard';
import type { SlideImageDecision } from '../../../utils/image-plan-guard';

// ---------------------------------------------------------------------------
// 常量（与 utils/image-plan-guard.ts / assemble.ts 的 NEVER_UPGRADE 语义一致）
// ---------------------------------------------------------------------------

/** 现状渲染路径中「纯文字 → 带图」升级的禁止版式集合（LLM-HTML-BEHAVIOR-SNAPSHOT.md 列出）。 */
export const NEVER_UPGRADE_FOR_IMAGE: ReadonlySet<string> = new Set([
  'comparison-deep-dive',
  'content-value-showcase',
  'content-stats-highlight',
  'content-image-background',
  'content-zigzag',
  'content-cards',
  'content-compare',
  'content-timeline',
  'content-table',
  // ===== FR-18 扩展（全部 needsImage=false，禁止强制升带图）=====
  'content-flowchart',
  'content-org-chart',
  'content-pyramid',
  'content-matrix',
  'content-quote',
  'content-three-section',
  'content-process-steps',
  'content-icon-grid',
  'content-section-divider',
  'content-testimonial',
  'content-chart-bar',
  'content-chart-line',
  'content-chart-pie',
  'content-chart-donut',
  'content-cycle',
  'content-dashboard',
]);

/** 原生即带图的版式（layoutSlideNodes 会在 needsImage!==false 时生成 DeckImageNode）。 */
const IMAGE_LAYOUT_TYPES: ReadonlySet<string> = new Set([
  'content-image-left',
  'content-image-right',
  'content-image-top',
  'content-image-background',
]);

/** 升级目标版式（与 HTML 路径默认 content-image-left 一致）。 */
const UPGRADE_TARGET: SlidePageType = 'content-image-left';

// ---------------------------------------------------------------------------
// 决策（复用 utils SSOT）
// ---------------------------------------------------------------------------

/**
 * 计算一页 Deck 的配图决策（节点层版）。
 * `hasPlaceholder` 由「layout 是否会为该页生成占位图节点」近似：
 * needsImage 非 false 且版式本身带图 → 视为存在占位图。
 */
export function resolveDeckImageDecision(
  sp: SlidePlan,
  opts: { imagePreference?: ImagePreference; imageEnabled?: boolean },
): SlideImageDecision {
  const pageType = sp?.pageType;
  const planNeedsImage = sp?.needsImage;
  const hasPlaceholder = planNeedsImage !== false && IMAGE_LAYOUT_TYPES.has(pageType ?? '');
  return resolveSlideImageDecision({
    pageType,
    planNeedsImage,
    imagePreference: opts.imagePreference,
    imageEnabled: opts.imageEnabled,
    hasPlaceholder,
  });
}

// ---------------------------------------------------------------------------
// 节点/计划级判定辅助
// ---------------------------------------------------------------------------

/** 节点树中是否含有占位图（src === DECK_IMAGE_PLACEHOLDER）的 DeckImageNode。 */
export function hasDeckImagePlaceholder(nodes: DeckNode[]): boolean {
  return nodes.some(
    (n) => n.kind === 'image' && isDeckImagePlaceholder((n as { src?: unknown }).src),
  );
}

/**
 * 内容页是否有「有意义的主体文字」——上提到节点层用 keyPoints 长度近似
 * （现状 HTML 用 `slideHasMeaningfulBody`：去标题/标签后纯文本 ≥ 6 字符）。
 */
export function slideHasMeaningfulBodyNodes(sp: SlidePlan): boolean {
  const title = (sp?.title ?? '').trim();
  const body = (sp?.keyPoints ?? []).join(' ').trim();
  return (title + body).length >= 6;
}

/**
 * 对单页 `SlidePlan` 应用节点层配图决策，返回（可能克隆并调整的）新计划。
 *
 * 规则（与 LLM-HTML 路径一致，单一真源）：
 * - 结构页（cover/toc/summary）或 `imagePreference==='none'` 或图片关闭
 *   → 强制 `needsImage=false`，绝不升带图（避免参考本身无图槽却被配图）；
 * - 内容页在 `content-only` / `all` 偏好下，若当前非带图版式、不在 NEVER_UPGRADE
 *   黑名单、且主体文字有意义 → 升级为 `content-image-left`（带图版式），
 *   `needsImage=true`，交给 `layoutSlideNodes` 生成占位图节点。
 *
 * 注意：本函数只改 `pageType` / `needsImage` 两个字段并**返回新对象**，
 * 不影响传入对象的其他字段（notes / imagePrompt / layoutParams 等）。
 */
export function applyDeckImageGuard(
  sp: SlidePlan,
  opts: { imagePreference?: ImagePreference; imageEnabled?: boolean },
): SlidePlan {
  const decision = resolveDeckImageDecision(sp, opts);
  const pageType = sp?.pageType;

  // 剥离场景：结构页 / pref=none / 图片关闭 → 禁止配图
  if (decision.stripPlaceholder) {
    if (sp?.needsImage === false) return sp; // 已满足，无需克隆
    return { ...sp, needsImage: false };
  }

  // 升级场景：内容页、偏好允许、非带图版式、非黑名单、有主体文字
  const pref = opts.imagePreference;
  if (
    (pref === 'content-only' || pref === 'all') &&
    !isStructurePage(pageType) &&
    !IMAGE_LAYOUT_TYPES.has(pageType ?? '') &&
    !NEVER_UPGRADE_FOR_IMAGE.has(pageType ?? '') &&
    slideHasMeaningfulBodyNodes(sp)
  ) {
    return { ...sp, pageType: UPGRADE_TARGET, needsImage: true };
  }

  return sp;
}

// ---------------------------------------------------------------------------
// 节点树手术（防御性 / 终局兜底，等价于 HTML 的 stripImagePlaceholders）
// ---------------------------------------------------------------------------

/**
 * 从节点树中移除占位图 `DeckImageNode`（幂等）。
 * 与 HTML 版 `stripImagePlaceholders` 不同，这里不碰字符串，直接过滤节点。
 *
 * `collapseLayout`：结构页场景下，若移除占位图后仅剩一个非标题主体节点，
 * 将其矩形展开到 `DECK_BODY_RECT` 以占满整列（避免留下半屏空白）。
 */
export function stripDeckImagePlaceholders(
  nodes: DeckNode[],
  opts: { collapseLayout?: boolean } = {},
): DeckNode[] {
  if (!hasDeckImagePlaceholder(nodes)) return nodes;
  const out = nodes.filter(
    (n) => !(n.kind === 'image' && isDeckImagePlaceholder((n as { src?: unknown }).src)),
  );
  if (opts.collapseLayout) {
    const body = out.filter((n) => !(n.kind === 'text' && (n as DeckTextNode).role === 'title'));
    if (body.length === 1) {
      return out.map((n) => (n === body[0] ? { ...n, rect: { ...DECK_BODY_RECT } } : n));
    }
  }
  return out;
}

/**
 * 对整页 `DeckSlide` 做防御性占位图剥离（终局兜底用，确保在 `deckToHtml` 渲染前
 * 节点树不含任何会被渲染成破图的占位节点）。
 */
export function sanitizeDeckSlideImages(
  slide: DeckSlide,
  opts: { collapseLayout?: boolean } = {},
): DeckSlide {
  if (!hasDeckImagePlaceholder(slide.nodes)) return slide;
  return { ...slide, nodes: stripDeckImagePlaceholders(slide.nodes, opts) };
}

/**
 * 占位常量再导出，便于调用方统一引用（与 DECK_IMAGE_PLACEHOLDER 保持一致语义）。
 */
export const DECK_IMAGE_PLACEHOLDER_SRC = DECK_IMAGE_PLACEHOLDER;
