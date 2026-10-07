/**
 * DeckSchema —— NoPPT 结构化幻灯片中间层。
 *
 * 设计来源：
 * - **python-pptx**：Presentation → SlideMaster → SlideLayout → Slide → Shape 的**分层对象模型**，
 *   以及 Shape 分型（autoshape / textbox / picture / table / GraphicFrame(chart) / group）与
 *   TextFrame → Paragraph → Run 的**三级富文本模型**。
 * - **PptxGenJS**：`defineSlideMaster({ background, margin, objects, slideNumber })` 的**母版机制**、
 *   `addText/addShape/addTable/addChart/addImage` 的**绝对定位元素 API**、
 *   placeholder（title/body/image/chart/table/media）与 fill/line/shadow 属性体系。
 *
 * 定位：Deck 是 **HTML 渲染与 PPTX 渲染共用的同一份数据真值**。
 * 本模块零依赖（core 包 `dependencies: {}`），只放类型 + 常量，不放渲染逻辑。
 */

import type { DeckRect } from './geometry';
import type { DeckShapeType } from './shapes';
import type { DeckChartKind } from './chart-kinds';

// ---------------------------------------------------------------------------
// 基础视觉属性（借鉴 PptxGenJS ShapeFillProps / ShapeLineProps / ShadowProps）
// ---------------------------------------------------------------------------

/** 颜色：统一用不带 `#` 的 6 位 HEX（OOXML 惯例），也接受带 `#` 的输入由上层归一化。 */
export type DeckColor = string;

export type DeckFillType = 'solid' | 'gradient';

export interface DeckGradientStop {
  color: DeckColor;
  /** 0-1 */
  offset: number;
}

export interface DeckFill {
  type?: DeckFillType;
  /** 纯色（solid）。 */
  color?: DeckColor;
  /** 透明度 0-100，0=不透明（PptxGenJS `transparency`）。 */
  transparency?: number;
  /** 渐变（gradient）。 */
  gradient?: {
    /** 角度，0-359；CSS 语义（0=自下而上）。 */
    angle?: number;
    stops: DeckGradientStop[];
  };
}

export type DeckDashType =
  'solid' | 'dash' | 'dashDot' | 'lgDash' | 'lgDashDot' | 'dot' | 'sysDash' | 'sysDot';

export interface DeckLine {
  color?: DeckColor;
  /** 线宽（pt）。 */
  width?: number;
  dash?: DeckDashType;
  /** 透明度 0-100。 */
  transparency?: number;
}

export interface DeckShadow {
  type?: 'outer' | 'inner';
  /** 角度 0-359。 */
  angle?: number;
  /** 模糊（pt）。 */
  blur?: number;
  color?: DeckColor;
  /** 偏移（pt）。 */
  offset?: number;
  /** 不透明度 0-1。 */
  opacity?: number;
}

// ---------------------------------------------------------------------------
// 富文本（借鉴 python-pptx TextFrame → Paragraph → Run）
// ---------------------------------------------------------------------------

export type DeckAlign = 'left' | 'center' | 'right' | 'justify';
export type DeckVAlign = 'top' | 'middle' | 'bottom';

/** 最小文本单元，对应 python-pptx 的 `Run`。 */
export interface DeckTextRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  /** 字号（pt）。 */
  fontSize?: number;
  fontFace?: string;
  color?: DeckColor;
  /** 字符间距（pt）。 */
  charSpacing?: number;
  hyperlink?: string;
}

/** 段落，对应 python-pptx 的 `Paragraph`。 */
export interface DeckParagraph {
  runs: DeckTextRun[];
  align?: DeckAlign;
  /** 项目符号（PptxGenJS `bullet`）。 */
  bullet?: boolean;
  /** 大纲层级 0-4。 */
  level?: number;
  /** 段后间距（pt）。 */
  spaceAfter?: number;
  /** 行距倍数。 */
  lineSpacing?: number;
}

// ---------------------------------------------------------------------------
// 节点（借鉴 python-pptx 的 Shape 分型）
// ---------------------------------------------------------------------------

export type DeckNodeKind = 'text' | 'shape' | 'image' | 'table' | 'chart' | 'group';

export interface DeckNodeBase {
  id?: string;
  /** Stable plan/content identity shared by Deck, HTML and audit manifests. */
  contentId?: string;
  /** Stable compare-column ownership for semantic parity checks. */
  contentColumn?: 'left' | 'right';
  /** Stable row order within a compare column. */
  contentOrder?: number;
  /** Whether this semantic content item owns a bullet marker. */
  bullet?: boolean;
  /** Provenance of the node's semantic content. */
  source?: 'plan' | 'manual' | 'legacy';
  /** Absolute定位矩形（px，1280×720 画布）。 */
  rect: DeckRect;
  /** 旋转角度（度，顺时针）。 */
  rotate?: number;
  /** 不透明度 0-1。 */
  opacity?: number;
  /** 语义角色，供母版占位符与后续编辑定位。 */
  role?: DeckNodeRole;
  /** 是否锁定（母版继承下来的对象不允许逐页改写）。 */
  locked?: boolean;
}

export type DeckNodeRole =
  'title' | 'subtitle' | 'body' | 'kicker' | 'pageNumber' | 'logo' | 'decoration' | 'content';

export interface DeckTextNode extends DeckNodeBase {
  kind: 'text';
  paragraphs: DeckParagraph[];
  align?: DeckAlign;
  valign?: DeckVAlign;
  /** 文本框内边距（px）。 */
  padding?: number;
  fill?: DeckFill;
  line?: DeckLine;
  shadow?: DeckShadow;
  /** 自动缩放字号以适应框（PptxGenJS `fit: 'shrink'` 的语义标记）。 */
  autoFit?: boolean;
}

export interface DeckShapeNode extends DeckNodeBase {
  kind: 'shape';
  shape: DeckShapeType;
  fill?: DeckFill;
  line?: DeckLine;
  shadow?: DeckShadow;
  /** 圆角比例 0-1（仅 roundRect 生效，PptxGenJS `rectRadius`）。 */
  rectRadius?: number;
  /** 形状内文本（PptxGenJS `addText({shape})`）。 */
  text?: DeckParagraph[];
  valign?: DeckVAlign;
}

export interface DeckImageNode extends DeckNodeBase {
  kind: 'image';
  /** data URL 或可访问的 http(s) 地址。 */
  src: string;
  /** 填充方式（PptxGenJS 无原生 cover，导出时按裁剪近似实现）。 */
  fit?: 'cover' | 'contain';
  alt?: string;
  /** 圆角（px）。 */
  radius?: number;
}

export interface DeckTableCell {
  text?: string;
  paragraphs?: DeckParagraph[];
  fill?: DeckFill;
  color?: DeckColor;
  bold?: boolean;
  fontSize?: number;
  fontFace?: string;
  align?: DeckAlign;
  valign?: DeckVAlign;
  colspan?: number;
  rowspan?: number;
  border?: DeckLine;
}

export interface DeckTableNode extends DeckNodeBase {
  kind: 'table';
  /** 行优先二维数组。 */
  rows: DeckTableCell[][];
  /** 列宽（px），缺省则等分。 */
  colW?: number[];
  /** 行高（px）。 */
  rowH?: number[];
  /** 表头加粗（首行）。 */
  header?: boolean;
  border?: DeckLine;
  fontSize?: number;
}

export interface DeckChartSeries {
  name?: string;
  /** y 值（scatter 场景下为 y；bubble 场景下为 y）。 */
  values: number[];
  /** scatter 专用：x 值。 */
  xs?: number[];
  /** bubble 专用：气泡大小。 */
  sizes?: number[];
  color?: DeckColor;
}

export interface DeckChartSpec {
  kind: DeckChartKind;
  /** 类目轴标签（python-pptx `categories`）。 */
  categories?: string[];
  /** pie/donut 场景下通常只有 1 条 series。 */
  series: DeckChartSeries[];
  title?: string;
  /** 数值单位后缀，如 '%' / '万'。 */
  unit?: string;
  showLegend?: boolean;
  showValue?: boolean;
  showPercent?: boolean;
  /** 数据色板（HEX 数组），缺省取主题衍生色。 */
  colors?: DeckColor[];
  /** 甜甜圈空心比例 1-100。 */
  holeSize?: number;
  xTitle?: string;
  yTitle?: string;
  /** 组合图：逐 series 指定子类型。 */
  seriesKinds?: DeckChartKind[];
  /** 组合图：第二条 series 走次坐标轴。 */
  secondaryAxis?: boolean;
}

export interface DeckChartNode extends DeckNodeBase {
  kind: 'chart';
  chart: DeckChartSpec;
  /** 图表区背景。 */
  fill?: DeckFill;
}

export interface DeckGroupNode extends DeckNodeBase {
  kind: 'group';
  children: DeckNode[];
}

export type DeckNode =
  DeckTextNode | DeckShapeNode | DeckImageNode | DeckTableNode | DeckChartNode | DeckGroupNode;

// ---------------------------------------------------------------------------
// 幻灯片 / 母版 / 主题 / 元信息 / Deck
// ---------------------------------------------------------------------------

export type DeckSource = 'plan' | 'html' | 'manual';
export type DeckParityStatus = 'pass' | 'fail' | 'needs_review' | 'unverified';

export interface DeckSlide {
  id: string;
  /** 对应 NoPPT 的 `SlidePageType`，便于回查与调试。 */
  pageType?: string;
  title?: string;
  nodes: DeckNode[];
  /** Provenance for the representation selected for export. */
  source?: DeckSource;
  /** True when coordinates came from DOM fallback rather than Deck geometry. */
  geometryFallback?: boolean;
  /** Parity gate state between the selected Deck and its HTML representation. */
  parity?: DeckParityStatus;
  /** Stable, human-readable parity failures for needs_review/fail results. */
  parityIssues?: string[];
  /** Required plan identities carried through Deck/HTML/export. */
  contentManifest?: Array<{
    contentId: string;
    text: string;
    role: string;
    order: number;
    column?: 'left' | 'right';
    bullet?: boolean;
    required: boolean;
    status?: 'present' | 'omitted' | 'needs_review' | 'unverified';
    sourceText?: string;
    omissionReason?: string;
  }>;
  background?: DeckFill;
  /** 演讲者备注（python-pptx `notes_slide`）。 */
  notes?: string;
  hidden?: boolean;
  /** 布局参数回写，供二次编辑。 */
  layoutParams?: Record<string, unknown>;
}

/** 母版占位符（沿用 PptxGenJS 的 placeholder 类型）。 */
export interface DeckPlaceholder {
  name: string;
  type: 'title' | 'body' | 'image' | 'chart' | 'table' | 'media';
  rect: DeckRect;
  /** 占位提示文本。 */
  text?: string;
}

export interface DeckSlideNumber {
  x: number;
  y: number;
  w?: number;
  h?: number;
  align?: DeckAlign;
  color?: DeckColor;
  fontSize?: number;
}

/**
 * 幻灯片母版 —— 借鉴 PptxGenJS `defineSlideMaster`。
 * PPTX 侧会成为 PowerPoint 中一等公民的 Layout（可在「视图 → 幻灯片母版」二次编辑）；
 * HTML 侧渲染为 deck 级页眉/页脚/页码/logo 片段，用于消除逐页风格漂移。
 */
export interface DeckMaster {
  title: string;
  background?: DeckFill;
  /** 页边距（px，TRBL）。 */
  margin?: [number, number, number, number];
  /** 母版固定对象（背景条、logo、页脚文字等）。 */
  objects: DeckNode[];
  slideNumber?: DeckSlideNumber;
  placeholders?: DeckPlaceholder[];
}

/** Deck 级主题（与现有 `COLOR_THEMES` / `StyleTheme` 对齐）。 */
export interface DeckTheme {
  /** 主色。 */
  primary?: DeckColor;
  /** 主色加深（渐变另一端）。 */
  primaryDark?: DeckColor;
  /** 背景色。 */
  background?: DeckColor;
  /** 正文色。 */
  text?: DeckColor;
  /** 次级文字色。 */
  textMuted?: DeckColor;
  /** 字体族。 */
  fontFamily?: string;
  /** 标题字体族。 */
  headingFontFamily?: string;
  /** 风格主题名（与 ai 侧 `StyleTheme` 同名）。 */
  style?: string;
}

/**
 * Deck 元信息 —— 借鉴 python-pptx `core_properties`。
 * 写入 PPTX 的 docProps/core.xml。
 */
export interface DeckMeta {
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string;
  category?: string;
  comments?: string;
  /** 文档状态，如 'draft' / 'final'。 */
  status?: string;
  /** 版本号字符串。 */
  revision?: string;
  company?: string;
}

export interface Deck {
  title: string;
  slides: DeckSlide[];
  master?: DeckMaster;
  theme?: DeckTheme;
  meta?: DeckMeta;
  /** 生成来源，便于排查（plan = AI 结构化计划；html = DOM 解析兜底）。 */
  source?: DeckSource;
  /** Aggregate parity state for all slide export inputs. */
  integrity?: {
    status: DeckParityStatus;
    issues?: string[];
  };
}

/** 节点默认边距（px），用于文本溢出时的安全内缩。 */
export const DECK_TEXT_PADDING = 8;

/**
 * 图片占位标记。
 *
 * AI 生成阶段（plan → deck）图片尚未产出（只有 `imagePrompt`），
 * 此时 `DeckImageNode.src` 写入该常量，并把提示词放进 `alt`。
 * 导出 PPTX 时识别该标记，渲染为「占位矩形 + 提示文字」而不是尝试加载无效 URL；
 * 后续 assemble-images 回填真实图片后可整体替换。
 */
export const DECK_IMAGE_PLACEHOLDER = 'noppt:image-placeholder';

/** 是否为占位图片。 */
export function isDeckImagePlaceholder(src: unknown): boolean {
  return typeof src === 'string' && (src === DECK_IMAGE_PLACEHOLDER || src.trim() === '');
}
