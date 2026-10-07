/**
 * HTML → Deck 的 DOM 解析兜底。
 *
 * 用途：历史数据、手工改稿、MCP 导入的 HTML 都没有 `slide.deck` 字段，
 * 此时在浏览器里把已渲染的 HTML 度量回绝对定位的 Deck 节点，
 * 让这些老数据也能导出 PPTX（思路类似 PptxGenJS 的 `tableToSlides`）。
 *
 * 性能：离屏容器**一次性挂载后批量测量**，避免逐节点读写引发 layout thrashing。
 * 边界：jsdom / 未渲染环境下 `getBoundingClientRect` 全为 0，
 *      此时退化成「按文档顺序纵向堆叠」，保证结构不丢（坐标不精确但不崩）。
 */

import {
  clampToSlide,
  normalizeColor,
  type DeckNode,
  type DeckParagraph,
  type DeckSlide,
  type DeckTableCell,
} from '@noppt/core/deck';

export interface HtmlToDeckOptions {
  width?: number;
  height?: number;
  /** 递归深度上限，默认 3。 */
  maxDepth?: number;
}

const TEXT_TAGS = new Set([
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'P',
  'LI',
  'SPAN',
  'A',
  'STRONG',
  'EM',
  'B',
]);
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'SVG', 'PATH', 'G', 'BR']);

/** 从 inline style 取背景色（只处理明确的 rgb/hex，够用即可）。 */
function bgColorOf(el: HTMLElement): string | undefined {
  const bg = el.style?.backgroundColor || el.style?.background || '';
  if (!bg) return undefined;
  if (bg === 'transparent' || bg === 'rgba(0, 0, 0, 0)') return undefined;
  return normalizeColor(bg);
}

function fontSizeOf(el: HTMLElement): number | undefined {
  const raw = el.style?.fontSize || '';
  const m = raw.match(/([\d.]+)px/);
  if (!m) return undefined;
  const px = parseFloat(m[1]);
  return Number.isFinite(px) && px > 0 ? px : undefined;
}

function textOf(el: Element): string {
  return (el.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** 表格解析：行 → 单元格（支持 colspan/rowspan 透传）。 */
function parseTable(table: HTMLTableElement): DeckTableCell[][] {
  const rows: DeckTableCell[][] = [];
  const trs = Array.from(table.querySelectorAll('tr'));
  for (const tr of trs) {
    const cells = Array.from(tr.children).filter((c) => c.tagName === 'TD' || c.tagName === 'TH');
    if (cells.length === 0) continue;
    rows.push(
      cells.map((cell) => {
        const el = cell as HTMLElement;
        const out: DeckTableCell = { text: textOf(cell) };
        if (cell.tagName === 'TH') out.bold = true;
        const colspan = Number(el.getAttribute('colspan') || '1');
        const rowspan = Number(el.getAttribute('rowspan') || '1');
        if (colspan > 1) out.colspan = colspan;
        if (rowspan > 1) out.rowspan = rowspan;
        const bg = bgColorOf(el);
        if (bg) out.fill = { type: 'solid', color: bg };
        return out;
      }),
    );
  }
  return rows;
}

/**
 * 把一段幻灯片 HTML 解析成 DeckSlide。
 * 任何异常都返回空节点页，不阻塞导出主流程。
 */
export function htmlToDeck(html: string, options: HtmlToDeckOptions = {}): DeckSlide {
  const width = options.width ?? 1280;
  const height = options.height ?? 720;
  const maxDepth = options.maxDepth ?? 3;
  const empty: DeckSlide = { id: '', nodes: [], source: undefined } as DeckSlide;

  if (typeof document === 'undefined' || !html) return empty;

  let container: HTMLDivElement | null = null;
  try {
    container = document.createElement('div');
    container.style.position = 'absolute';
    container.style.left = '-99999px';
    container.style.top = '0';
    container.style.width = `${width}px`;
    container.style.height = `${height}px`;
    container.style.overflow = 'hidden';
    container.style.visibility = 'hidden';
    container.innerHTML = html;
    document.body.appendChild(container);

    const base = container.getBoundingClientRect();
    const measurable = base.width > 0 && base.height > 0;

    const nodes: DeckNode[] = [];
    // 未渲染环境（jsdom）下的纵向游标兜底
    let cursorY = 48;

    const assignRect = (el: HTMLElement): { x: number; y: number; w: number; h: number } => {
      if (measurable) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          return {
            x: r.left - base.left,
            y: r.top - base.top,
            w: r.width,
            h: r.height,
          };
        }
      }
      const h = 80;
      const rect = { x: 64, y: cursorY, w: width - 128, h };
      cursorY += h + 16;
      return rect;
    };

    const visit = (el: Element, depth: number): void => {
      if (!(el instanceof HTMLElement)) return;
      const tag = el.tagName.toUpperCase();
      if (SKIP_TAGS.has(tag)) return;

      if (tag === 'IMG') {
        const img = el as HTMLImageElement;
        nodes.push({
          kind: 'image',
          rect: clampToSlide(assignRect(el)),
          src: img.getAttribute('src') || '',
          alt: img.getAttribute('alt') || undefined,
          fit: 'cover',
        });
        return;
      }

      if (tag === 'TABLE') {
        const rows = parseTable(el as HTMLTableElement);
        if (rows.length > 0) {
          nodes.push({ kind: 'table', rect: clampToSlide(assignRect(el)), rows, header: true });
          return;
        }
      }

      const text = textOf(el);
      const hasTextChild = Array.from(el.children).some((c) =>
        TEXT_TAGS.has(c.tagName.toUpperCase()),
      );

      if (TEXT_TAGS.has(tag) || (text && !hasTextChild && el.children.length === 0)) {
        if (!text) return;
        const paragraph: DeckParagraph = {
          runs: [{ text, fontSize: fontSizeOf(el), color: normalizeColor(el.style?.color) }],
          bullet: tag === 'LI',
        };
        nodes.push({
          kind: 'text',
          rect: clampToSlide(assignRect(el)),
          paragraphs: [paragraph],
        });
        return;
      }

      // 容器：有背景色则作为色块保留，否则继续下钻
      const bg = bgColorOf(el);
      if (bg) {
        nodes.push({
          kind: 'shape',
          rect: clampToSlide(assignRect(el)),
          shape: 'rect',
          fill: { type: 'solid', color: bg },
        });
      }
      if (depth < maxDepth) {
        for (const child of Array.from(el.children)) visit(child, depth + 1);
      }
    };

    const rootChildren =
      container.children.length === 1
        ? Array.from(container.children[0].children)
        : Array.from(container.children);
    for (const child of rootChildren) visit(child, 0);

    return { id: '', nodes } as DeckSlide;
  } catch {
    return empty;
  } finally {
    if (container?.parentNode) container.parentNode.removeChild(container);
  }
}

/** 批量解析多页（复用同一个离屏生命周期，逐页调用）。 */
export function htmlSlidesToDeck(htmls: string[], options: HtmlToDeckOptions = {}): DeckSlide[] {
  return htmls.map((html, i) => ({ ...htmlToDeck(html, options), id: `slide-${i + 1}` }));
}
