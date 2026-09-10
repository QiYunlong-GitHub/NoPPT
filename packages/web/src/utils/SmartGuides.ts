export interface GuideLine {
  type: 'vertical' | 'horizontal';
  position: number;
  start: number;
  end: number;
}

export interface SnapResult {
  dx: number;
  dy: number;
  guides: GuideLine[];
}

export interface ElementRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const DEFAULT_THRESHOLD = 5;

interface EdgePoint {
  value: number;
  rect: ElementRect;
}

function getBBox(rects: ElementRect[]): ElementRect {
  let minLeft = Infinity;
  let minTop = Infinity;
  let maxRight = -Infinity;
  let maxBottom = -Infinity;
  for (const r of rects) {
    minLeft = Math.min(minLeft, r.left);
    minTop = Math.min(minTop, r.top);
    maxRight = Math.max(maxRight, r.left + r.width);
    maxBottom = Math.max(maxBottom, r.top + r.height);
  }
  return {
    left: minLeft,
    top: minTop,
    width: maxRight - minLeft,
    height: maxBottom - minTop,
  };
}

function getVerticalEdges(rect: ElementRect): EdgePoint[] {
  return [
    { value: rect.left, rect },
    { value: rect.left + rect.width / 2, rect },
    { value: rect.left + rect.width, rect },
  ];
}

function getHorizontalEdges(rect: ElementRect): EdgePoint[] {
  return [
    { value: rect.top, rect },
    { value: rect.top + rect.height / 2, rect },
    { value: rect.top + rect.height, rect },
  ];
}

export function calculateGuides(
  draggedRects: ElementRect[],
  otherRects: ElementRect[],
  slideWidth: number,
  slideHeight: number,
  threshold: number = DEFAULT_THRESHOLD,
): SnapResult {
  if (draggedRects.length === 0) {
    return { dx: 0, dy: 0, guides: [] };
  }

  const draggedBBox = getBBox(draggedRects);

  const slideRect: ElementRect = { left: 0, top: 0, width: slideWidth, height: slideHeight };

  const targetVertical: EdgePoint[] = [];
  const targetHorizontal: EdgePoint[] = [];

  for (const r of otherRects) {
    targetVertical.push(...getVerticalEdges(r));
    targetHorizontal.push(...getHorizontalEdges(r));
  }
  targetVertical.push(...getVerticalEdges(slideRect));
  targetHorizontal.push(...getHorizontalEdges(slideRect));

  const draggedVertical = getVerticalEdges(draggedBBox);
  const draggedHorizontal = getHorizontalEdges(draggedBBox);

  let bestDx: { offset: number; guide: GuideLine } | null = null;
  let bestDy: { offset: number; guide: GuideLine } | null = null;

  for (const dEdge of draggedVertical) {
    for (const tEdge of targetVertical) {
      const diff = tEdge.value - dEdge.value;
      if (Math.abs(diff) <= threshold) {
        if (bestDx === null || Math.abs(diff) < Math.abs(bestDx.offset)) {
          const start = Math.min(draggedBBox.top, tEdge.rect.top);
          const end = Math.max(
            draggedBBox.top + draggedBBox.height,
            tEdge.rect.top + tEdge.rect.height,
          );
          bestDx = {
            offset: diff,
            guide: {
              type: 'vertical',
              position: tEdge.value,
              start,
              end,
            },
          };
        }
      }
    }
  }

  for (const dEdge of draggedHorizontal) {
    for (const tEdge of targetHorizontal) {
      const diff = tEdge.value - dEdge.value;
      if (Math.abs(diff) <= threshold) {
        if (bestDy === null || Math.abs(diff) < Math.abs(bestDy.offset)) {
          const start = Math.min(draggedBBox.left, tEdge.rect.left);
          const end = Math.max(
            draggedBBox.left + draggedBBox.width,
            tEdge.rect.left + tEdge.rect.width,
          );
          bestDy = {
            offset: diff,
            guide: {
              type: 'horizontal',
              position: tEdge.value,
              start,
              end,
            },
          };
        }
      }
    }
  }

  const guides: GuideLine[] = [];
  if (bestDx) guides.push(bestDx.guide);
  if (bestDy) guides.push(bestDy.guide);

  return {
    dx: bestDx?.offset ?? 0,
    dy: bestDy?.offset ?? 0,
    guides,
  };
}
