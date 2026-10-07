export const EVALUATOR_VERSION = 1;

/** Browser-native smoke evaluator. Keep this source free of TypeScript helpers and Node closures. */
export const EVALUATOR_SMOKE_SCRIPT = `(() => ({ evaluator: "noppt", version: 1, ok: true }))()`;

/** Browser-native layout evaluator used by SlideRenderer. */
export const LAYOUT_METRICS_EVALUATOR = `(({ width, height, profile }) => {
  const rectOf = (element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom };
  };
  const root = document.body.firstElementChild;
  const rootRect = root ? rectOf(root) : { x: 0, y: 0, width: 0, height: 0, right: 0, bottom: 0 };
  const canvasWidth = Number((root && root.getAttribute("data-logical-width")) || 1280);
  const canvasHeight = Number((root && root.getAttribute("data-logical-height")) || 720);
  const candidates = Array.from(document.querySelectorAll("[data-content-id], [data-role=title], h1, h2, h3, [data-required=true]"));
  const seen = new Set();
  const elements = [];
  for (const element of candidates) {
    if (seen.has(element)) continue;
    const semanticAncestor = element.parentElement && element.parentElement.closest("[data-content-id], [data-role=title]");
    if (semanticAncestor && semanticAncestor !== element) continue;
    seen.add(element);
    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") continue;
    const rect = rectOf(element);
    const role = element.getAttribute("data-role") || (element.matches("h1,h2,h3") ? "title" : "");
    const contentId = element.getAttribute("data-content-id") || undefined;
    const required = element.getAttribute("data-required") !== "false" && role !== "decoration" && Boolean(contentId || role === "title" || element.getAttribute("data-required") === "true");
    const text = (element.textContent || "").replace(/\\s+/g, " ").trim();
    let clipped = rect.x < -1 || rect.y < -1 || rect.right > width + 1 || rect.bottom > height + 1;
    let parent = element;
    while (parent) {
      const parentStyle = window.getComputedStyle(parent);
      const hidesOverflow = /hidden|clip/.test(parentStyle.overflow + " " + parentStyle.overflowX + " " + parentStyle.overflowY);
      if (hidesOverflow && (parent.scrollWidth > parent.clientWidth + 1 || parent.scrollHeight > parent.clientHeight + 1)) clipped = true;
      parent = parent.parentElement;
    }
    elements.push({
      selector: contentId ? '[data-content-id="' + contentId + '"]' : element.tagName.toLowerCase(),
      tagName: element.tagName.toLowerCase(), role, contentId, text, required,
      emptyRequired: required && text.length === 0, clipped, rect,
      scrollWidth: element.scrollWidth, clientWidth: element.clientWidth,
      scrollHeight: element.scrollHeight, clientHeight: element.clientHeight,
      computed: { display: style.display, visibility: style.visibility, overflow: style.overflow,
        overflowX: style.overflowX, overflowY: style.overflowY, fontFamily: style.fontFamily,
        fontWeight: style.fontWeight, fontSize: style.fontSize, lineHeight: style.lineHeight }
    });
  }
  const titles = elements.filter((element) => element.required && element.role === "title");
  const content = elements.filter((element) => element.required && element.role !== "title");
  const overlaps = (a, b) => Math.min(a.right, b.right) - Math.max(a.x, b.x) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y) > 1;
  return {
    scriptVersion: 1,
    viewport: { width, height, profile },
    logicalCanvas: { width: canvasWidth, height: canvasHeight },
    root: rootRect,
    document: { scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight,
      clientWidth: document.documentElement.clientWidth, clientHeight: document.documentElement.clientHeight },
    elements,
    requiredClipped: elements.filter((element) => element.required && element.clipped).length,
    emptyRequiredNodes: elements.filter((element) => element.emptyRequired).length,
    horizontalOverflow: document.documentElement.scrollWidth > width + 1 || document.body.scrollWidth > width + 1,
    verticalOverflow: document.documentElement.scrollHeight > height + 1 || document.body.scrollHeight > height + 1,
    titleOverlap: titles.some((title) => content.some((element) => overlaps(title.rect, element.rect)))
  };
})`;

export interface BrowserEvaluatorResult {
  scriptVersion: number;
  viewport: { width: number; height: number; profile: string };
  logicalCanvas: { width: number; height: number };
  root: { x: number; y: number; width: number; height: number; right: number; bottom: number };
  document: { scrollWidth: number; scrollHeight: number; clientWidth: number; clientHeight: number };
  elements: unknown[];
  requiredClipped: number;
  emptyRequiredNodes: number;
  horizontalOverflow: boolean;
  verticalOverflow: boolean;
  titleOverlap: boolean;
}

export function validateBrowserEvaluatorResult(value: unknown): asserts value is BrowserEvaluatorResult {
  if (!value || typeof value !== 'object') throw new Error('browser evaluator returned a non-object result');
  const result = value as Partial<BrowserEvaluatorResult>;
  if (result.scriptVersion !== EVALUATOR_VERSION || !Array.isArray(result.elements)) {
    throw new Error('browser evaluator returned an unsupported result shape');
  }
  for (const key of ['requiredClipped', 'emptyRequiredNodes'] as const) {
    if (!Number.isFinite(result[key])) throw new Error(`browser evaluator result is missing ${key}`);
  }
  for (const key of ['horizontalOverflow', 'verticalOverflow', 'titleOverlap'] as const) {
    if (typeof result[key] !== 'boolean') throw new Error(`browser evaluator result is missing ${key}`);
  }
}
