/**
 * Deck → PPTX 主渲染器。
 *
 * 输入是 `@noppt/core/deck` 的结构化 Deck（HTML 与 PPTX 共用的同一份数据真值），
 * 输出是浏览器端可直接下载的 `.pptx`（PptxGenJS `writeFile`）。
 *
 * 对齐关系：
 * - 画布：`LAYOUT_WIDE`（13.333×7.5 inch）←→ Deck 的 1280×720 px（96 px/inch，无损）
 * - 母版：`DeckMaster` → `defineSlideMaster`（PowerPoint 中可二次编辑）
 * - 元素：`DeckNode` 分型 → `addText` / `addShape` / `addTable` / `addChart` / `addImage`
 * - 备注：`Slide.notes` → `addNotes`
 * - 元信息：`DeckMeta` → PPTX `docProps/core.xml`（借鉴 python-pptx `core_properties`）
 *
 * 注意：PptxGenJS 采用**动态 import**（仅在真正导出时加载），原因有二：
 * 1. 体积约 400KB（含 JSZip），避免拖慢首屏（与 `ExportModal` 的动态 import 分层配合）；
 * 2. 单元测试环境（jsdom）下静态/动态加载 PptxGenJS 会挂起，因此 `buildPptx`
 *    支持通过 `options.pptxFactory` 注入构造函数，测试可传入 stub 而不触碰该库。
 */

import {
  PPTX_LAYOUT_WIDE,
  isDeckImagePlaceholder,
  normalizeDeck,
  rectToInch,
  type Deck,
  type DeckImageNode,
  type DeckNode,
  type DeckSlide,
  type DeckTextNode,
} from '@noppt/core/deck';
import { defineDeckMaster } from './master';
import { renderChartNode } from './chart';
import { renderTableNode } from './table';
import { renderShapeNode } from './shape';
import { applySlideNotes, resolveSlideNotes } from './notes';
import { paragraphsToPptxText, plainText, type TextRenderContext } from './text';
import { DEFAULT_PPTX_FONT_FACE, toPptxFill } from './attrs';

/** PptxGenJS 实例的最小接口（用于类型约束与测试注入）。 */
export interface PptxLike {
  layout: string;
  author?: string;
  title?: string;
  subject?: string;
  keywords?: string;
  category?: string;
  comments?: string;
  revision?: string;
  company?: string;
  defineSlideMaster(props: Record<string, unknown>): void;
  addSlide(opts?: { masterName?: string }): SlideLike;
  write(props?: { outputType?: string; compression?: boolean }): Promise<unknown>;
  writeFile(props?: { fileName?: string; compression?: boolean }): Promise<string>;
}

/** 单页实例的最小接口。 */
export interface SlideLike {
  addText: (text: unknown, options?: Record<string, unknown>) => void;
  addShape: (shape: string, options?: Record<string, unknown>) => void;
  addTable: (rows: unknown, options?: Record<string, unknown>) => void;
  addChart: (type: unknown, data: unknown, options?: Record<string, unknown>) => void;
  addImage: (options: Record<string, unknown>) => void;
  addNotes?: (notes: string) => void;
  background?: unknown;
  hidden?: boolean;
}

export interface DeckToPptxOptions {
  /** 导出文件名（不含 .pptx 会自动补）。 */
  fileName?: string;
  /** 中文字体，默认 `Microsoft YaHei`。 */
  fontFace?: string;
  /** 是否跳过尚未回填的占位图片，默认 true（改画占位矩形）。 */
  skipPlaceholderImages?: boolean;
  /** 是否开启压缩（更慢但体积小约 30%）。 */
  compression?: boolean;
  /** 逐页备注（slideId → notes），优先级高于 deck slide.notes。 */
  notesById?: Record<string, string>;
  /** 进度回调。 */
  onProgress?: (done: number, total: number) => void;
  /** Explicit opt-in for historical HTML fallback export; never a verified export. */
  allowUnverifiedLegacy?: boolean;
  /**
   * PptxGenJS 构造函数注入（测试用）。
   * 缺省走动态 `import('pptxgenjs')`；测试可传 stub 避免加载该库（jsdom 下会挂起）。
   */
  pptxFactory?: () => PptxLike | Promise<PptxLike>;
}

function ensurePptxName(name: string): string {
  const base = (name || '').trim() || 'presentation';
  return base.toLowerCase().endsWith('.pptx') ? base : `${base}.pptx`;
}

/** 渲染文本节点。 */
function renderTextNode(slide: SlideLike, node: DeckTextNode, ctx: TextRenderContext): void {
  if (!node.paragraphs?.length) return;
  slide.addText(paragraphsToPptxText(node.paragraphs, ctx), {
    ...rectToInch(node.rect),
    align: node.align === 'center' || node.align === 'right' ? node.align : 'left',
    valign: node.valign ?? 'top',
    ...(node.fill ? { fill: toPptxFill(node.fill) } : {}),
    margin: node.padding ?? 4,
    // 超出框自动缩小字号，规避 LLM 生成长文本溢出（PptxGenJS `fit: 'shrink'` 语义）
    fit: node.autoFit === false ? undefined : 'shrink',
  });
}

/** 渲染图片节点：占位图降级为「浅底矩形 + 提示文字」。 */
function renderImageNode(
  slide: SlideLike,
  node: DeckImageNode,
  ctx: TextRenderContext,
  skipPlaceholder: boolean,
): void {
  const pos = rectToInch(node.rect);
  if (isDeckImagePlaceholder(node.src)) {
    if (skipPlaceholder) return;
    slide.addShape('roundRect', { ...pos, fill: { color: 'F3F4F6' }, rectRadius: 0.08 });
    slide.addText(plainText(node.alt || '图片占位', ctx), {
      ...pos,
      align: 'center',
      valign: 'middle',
      fontSize: 12,
      color: '9CA3AF',
    });
    return;
  }
  try {
    slide.addImage({ data: node.src, ...pos });
  } catch {
    // 图片加载失败不应中断整份导出
  }
}

/** 递归渲染一页的所有节点（group 节点在 PPTX 侧平铺，无原生 group 支持）。 */
function renderNodes(
  slide: SlideLike,
  nodes: DeckNode[],
  ctx: TextRenderContext,
  skipPlaceholder: boolean,
): void {
  for (const node of nodes) {
    try {
      switch (node.kind) {
        case 'text':
          renderTextNode(slide, node, ctx);
          break;
        case 'shape':
          renderShapeNode(slide, node, ctx);
          break;
        case 'image':
          renderImageNode(slide, node, ctx, skipPlaceholder);
          break;
        case 'table':
          renderTableNode(slide, node, ctx);
          break;
        case 'chart':
          renderChartNode(slide, node);
          break;
        case 'group':
          renderNodes(slide, node.children ?? [], ctx, skipPlaceholder);
          break;
        default:
          break;
      }
    } catch {
      // 单节点失败不影响其余内容（与 SVG 渲染器「静默降级」策略一致）
    }
  }
}

/** 写入 deck 级元信息（→ PPTX docProps/core.xml）。 */
function applyMeta(pptx: PptxLike, deck: Deck): void {
  const meta = deck.meta;
  if (!meta) return;
  if (meta.title) pptx.title = meta.title;
  if (meta.author) pptx.author = meta.author;
  if (meta.subject) pptx.subject = meta.subject;
  if (meta.keywords) pptx.keywords = meta.keywords;
  if (meta.category) pptx.category = meta.category;
  if (meta.comments) pptx.comments = meta.comments;
  if (meta.revision) pptx.revision = meta.revision;
  if (meta.company) pptx.company = meta.company;
}

/**
 * 把 Deck 渲染成 PptxGenJS 实例（不触发下载，便于测试与二次加工）。
 * 非法 deck 会被 `normalizeDeck` 清洗；清洗后为 null 时抛错。
 */
export async function buildPptx(deck: Deck, options: DeckToPptxOptions = {}): Promise<PptxLike> {
  const blockedSlide = deck?.slides?.find(
    (slide) => slide.parity !== undefined && slide.parity !== 'pass' && !options.allowUnverifiedLegacy,
  );
  if (deck?.integrity && deck.integrity.status !== 'pass' && !options.allowUnverifiedLegacy) {
    throw new Error(`Deck integrity requires review before PPTX export: ${deck.integrity.status}`);
  }  if (blockedSlide) {
    throw new Error(
      `Deck/HTML parity requires review before PPTX export (${blockedSlide.id}): ${
        blockedSlide.parityIssues?.join('; ') ?? blockedSlide.parity
      }`,
    );
  }
  const safeDeck = normalizeDeck(deck);
  if (!safeDeck) throw new Error('Deck 数据结构非法，无法导出 PPTX');

  const factory =
    options.pptxFactory ??
    (async (): Promise<PptxLike> => {
      const mod = await import('pptxgenjs');
      // 默认导出即 PptxGenJS 类；动态 import 导致其类型在 d.ts 中需断言。
      const Ctor = (mod as unknown as { default: new () => PptxLike }).default;
      return new Ctor();
    });
  const pptx = await factory();

  pptx.layout = PPTX_LAYOUT_WIDE;

  const ctx: TextRenderContext = {
    fontFace: options.fontFace || safeDeck.theme?.fontFamily || DEFAULT_PPTX_FONT_FACE,
    defaultColor: safeDeck.theme?.text,
  };

  applyMeta(pptx, safeDeck);
  const masterName = defineDeckMaster(pptx, safeDeck.master, ctx);

  const total = safeDeck.slides.length;
  safeDeck.slides.forEach((slideData: DeckSlide, i: number) => {
    const slide = pptx.addSlide(masterName ? { masterName } : undefined) as SlideLike;
    const bg = toPptxFill(slideData.background);
    if (bg?.color) slide.background = bg.color;
    slide.hidden = slideData.hidden === true;

    renderNodes(slide, slideData.nodes ?? [], ctx, options.skipPlaceholderImages !== false);

    const notes = resolveSlideNotes(options.notesById?.[slideData.id], slideData.notes);
    applySlideNotes(slide, notes);

    options.onProgress?.(i + 1, total);
  });

  return pptx;
}

/** Explicit legacy export for HTML-only historical presentations. */
export function buildLegacyPptx(deck: Deck, options: DeckToPptxOptions = {}): Promise<PptxLike> {
  return buildPptx(deck, { ...options, allowUnverifiedLegacy: true });
}

/** 渲染并触发浏览器下载。 */
export async function exportDeckToPptx(
  deck: Deck,
  options: DeckToPptxOptions = {},
): Promise<string> {
  const pptx = await buildPptx(deck, options);
  return pptx.writeFile({
    fileName: ensurePptxName(options.fileName || deck?.title || 'presentation'),
    ...(options.compression ? { compression: true } : {}),
  });
}

/** 渲染为 Blob（供预览、上传或自定义下载流程）。 */
export async function deckToPptxBlob(deck: Deck, options: DeckToPptxOptions = {}): Promise<Blob> {
  const pptx = await buildPptx(deck, options);
  const out = await pptx.write({
    outputType: 'blob',
    ...(options.compression ? { compression: true } : {}),
  });
  return out as Blob;
}

export { DEFAULT_PPTX_FONT_FACE };
