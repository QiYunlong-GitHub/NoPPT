/**
 * Public compatibility facade for the 1280×720 absolute-position layout templates.
 *
 * The implementations are owner-scoped so the registry and node-tree normalization
 * remain stable while primitives and layout families can evolve independently.
 */

import { clampToSlide, type DeckNode } from '@noppt/core/deck';
import type { SlidePlan } from '../../../types';
import { ADVANCED_LAYOUT_BUILDERS, layoutMinimal } from './layout-advanced';
import { CONTENT_LAYOUT_BUILDERS } from './layout-content';
import { type DeckLayoutContext, type LayoutFn } from './layout-primitives';

export * from './layout-primitives';

// ---------------------------------------------------------------------------
// Public builder registry
// ---------------------------------------------------------------------------

export const DECK_LAYOUT_BUILDERS: Record<string, LayoutFn> = {
  ...CONTENT_LAYOUT_BUILDERS,
  ...ADVANCED_LAYOUT_BUILDERS,
};

/**
 * 生成一页的绝对定位节点树。
 * 未知页型降级到 `layoutMinimal`；所有矩形最终会被钳制进画布。
 */
export function layoutSlideNodes(sp: SlidePlan, ctx: DeckLayoutContext): DeckNode[] {
  const builder = DECK_LAYOUT_BUILDERS[sp?.pageType] ?? layoutMinimal;
  let nodes: DeckNode[];
  try {
    nodes = builder(sp, ctx);
  } catch {
    nodes = layoutMinimal(sp, ctx);
  }
  return nodes.map((n) => ({ ...n, rect: clampToSlide(n.rect) }));
}
