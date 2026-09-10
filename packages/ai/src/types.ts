export type ModelProvider = 'openai' | 'anthropic' | 'ollama' | 'custom' | 'freeai' | 'v0' | 'company-gateway';

export type ModelRole = 'system' | 'user' | 'assistant';

export interface TextContentPart {
  type: 'text';
  text: string;
}

export interface ImageUrlContentPart {
  type: 'image_url';
  image_url: {
    url: string;
    detail?: 'auto' | 'low' | 'high';
  };
}

export type ContentPart = TextContentPart | ImageUrlContentPart;

export interface ChatMessage {
  role: ModelRole;
  content: string | ContentPart[];
}

export interface ChatOptions {
  model: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stream?: boolean;
}

export interface ChatResponse {
  content: string;
  model: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  raw?: any;
}

export interface ModelConfig {
  provider: ModelProvider;
  apiKey?: string;
  baseUrl?: string;
  model: string;
  defaultOptions?: Partial<ChatOptions>;
}

export interface GeneratedOutline {
  title: string;
  description?: string;
  slides: Array<{
    title: string;
    content: string;
    type?: string;
    notes?: string;
    imagePrompt?: string;
  }>;
}

export type SlidePageType =
  | 'cover'
  | 'toc'
  | 'content-image-left'
  | 'content-image-right'
  | 'content-image-top'
  | 'content-no-image'
  | 'content-cards'
  | 'content-compare'
  | 'content-timeline'
  | 'content-table'
  | 'summary'
  // ===== L1 高级版式（布局组合创造力新增）=====
  | 'comparison-deep-dive'      // 双栏深度对比报告（左栏普通/右栏优势+进度条+徽章）
  | 'content-zigzag'             // Z 字形图文交错布局（图左文右 → 文左图右 → 图左文右）
  | 'content-value-showcase'     // 核心数值大卡展示（大号 Value 块 + 副标题 + 趋势徽章）
  | 'content-stats-highlight'    // 多数据指标并列（3~4 个指标卡片横向排列）
  | 'content-image-background'   // 大图做背景 + 半透明卡片文字叠在图上
  // ===== FR-18 §18.1 扩展（承接参考常见版式，新增 10 种）=====
  | 'content-flowchart'          // 流程节点 + 箭头连线（横向/纵向可选）
  | 'content-org-chart'          // 层级节点 + 连线（组织树）
  | 'content-pyramid'            // 三角分层递进（3~5 层）
  | 'content-matrix'             // 2×2 四象限矩阵（轴 + 区块/散点）
  | 'content-quote'              // 全屏大号引述 + 出处署名
  | 'content-three-section'      // 上/中/下（或左/中/右）均分三区块
  | 'content-process-steps'      // 编号步骤卡横向排列（区别于 flowchart 箭头连线）
  | 'content-icon-grid'          // 图标 + 标题 + 短描述网格（区别于 card-grid 内容卡）
  | 'content-section-divider'    // 大号章节标题 + 序号，过渡页
  | 'content-testimonial'        // 头像 + 引述 + 姓名/职位
  // ===== FR-18 §18.5 扩展（50 种版式手册驱动，含图表/架构类，新增 7 种）=====
  | 'content-chart-bar'          // 柱状图（PostProcess 注入受控 SVG）
  | 'content-chart-line'         // 折线图（PostProcess 注入受控 SVG）
  | 'content-chart-pie'          // 饼图（PostProcess 注入受控 SVG）
  | 'content-chart-donut'        // 环形图（PostProcess 注入受控 SVG）
  | 'content-cycle'              // 循环图（环形节点 + 单向箭头）
  | 'content-dashboard'          // 数据看板（多指标 + 迷你图组合）
  | 'content-architecture';      // 系统架构图（复用分层渲染，PostProcess 注入受控 SVG）
  // 注：content-image-bottom 采用 content-image-top + LayoutParams.imageAnchor='bottom' 参数化，不新增枚举（Q14 已决策）

export type ImageRatio = '1:1' | '4:3' | '3:4' | '16:9' | '9:16' | '3:2' | '2:3' | '21:9';

export type ContentDensity = 'compact' | 'normal' | 'spacious';

export type ImagePreference = 'all' | 'content-only' | 'minimal' | 'none';

export type ColorTheme = 'blue' | 'purple' | 'green' | 'orange' | 'teal' | 'gray';

export type IconStyle = 'auto' | 'line' | 'filled' | 'numbered' | 'bullet' | 'lettered' | 'emoji' | 'none';

// ===== L1：6 维布局参数（parameterized layout，不突破 6 基本块只调排列）=====
export interface LayoutParams {
  /** 标题位置：顶部（默认）/ 左侧（标题竖排或左栏）/ 右侧 / 内嵌（覆盖在图片上） */
  titlePosition?: 'top' | 'left' | 'right' | 'inline';
  /** 内容流动方向：column 纵向（默认）/ row 横向 / row-reverse 反向 */
  contentDirection?: 'column' | 'row' | 'row-reverse';
  /** 图片锚点：无图 / 左侧（左图右文）/ 右侧 / 顶部 / 底部 / 背景大图 */
  imageAnchor?: 'none' | 'left' | 'right' | 'top' | 'bottom' | 'background';
  /** 卡片形状：圆角矩形（默认）/ 胶囊 / 玻璃态（半透明+模糊）/ 渐变边 / 纯色块 */
  cardShape?: 'rounded' | 'pill' | 'glass' | 'gradient-border' | 'solid-block';
  /** 内容对齐：左对齐（默认）/ 居中 / 两端（justify）/ 右对齐 */
  contentAlignment?: 'left' | 'center' | 'justify' | 'right';
  /** 网格列数（cards / 指标类用）：自动 / 2 / 3 / 4 */
  gridCols?: 'auto' | 2 | 3 | 4;
}

// ===== L1.5：样式主题枚举（视觉增强，可控范围内释放创造力）=====
export type StyleTheme =
  | 'none'              // 无特殊样式（默认传统卡片）
  | 'glass'             // 玻璃拟态卡片（backdrop-filter: blur + 半透明白）
  | 'gradient'          // 渐变背景 + 渐变文字（大胆配色）
  | 'progress-bars'     // 含进度条 / 完成度条（适合对比页、指标页）
  | 'badges'            // 徽章化数值（胶囊 Badge + 大数字 Value 块）
  | 'colored-cards'     // 多彩语义卡片（每张卡不同柔和色系）
  | 'mixed';            // 混合模式（AI 根据内容自由组合以上样式）

export type ContentCategory =
  | 'data-point'
  | 'comparison'
  | 'process'
  | 'problem'
  | 'solution'
  | 'evidence'
  | 'vision'
  | 'story';

export type NarrativeRole =
  | 'opening'
  | 'background'
  | 'problem'
  | 'solution'
  | 'evidence'
  | 'comparison'
  | 'transition'
  | 'closing';

// ===== FR-18 §18.5 图表 / 架构规格（PostProcess 注入受控 SVG，不引外部图表库）=====
export interface ChartSeriesPoint {
  label: string;
  value: number;
}
export interface ChartSeries {
  name?: string;
  color?: string;
  points: ChartSeriesPoint[];
}
export interface ChartSpec {
  kind: 'bar' | 'line' | 'pie' | 'donut';
  series: ChartSeries[]; // bar/line 可多序列；pie/donut 单序列
  unit?: string; // 如 '%' / '万' / 'ms'
  showLegend?: boolean; // 默认 true（多序列）
  showValues?: boolean; // 默认 true
  stacked?: boolean; // bar 专用：堆叠
}

export type ArchNodeVariant = 'box' | 'cylinder' | 'ellipse' | 'cloud';
export interface ArchNode {
  id: number;
  label: string;
  variant?: ArchNodeVariant;
}
export interface ArchLayer {
  title?: string;
  nodeIds: number[];
}
export interface ArchitectureSpec {
  layers: ArchLayer[];
  flows?: Array<[number, number]>; // 节点间连线 [fromId, toId]
  nodes?: ArchNode[];
}

export interface SlidePlan {
  pageType: SlidePageType;
  title: string;
  keyPoints: string[];
  imagePrompt?: string;
  imageRatio?: ImageRatio;
  needsImage: boolean;
  backgroundPrompt?: string;
  contentCategory?: ContentCategory;
  narrativeRole?: NarrativeRole;
  layoutParams?: LayoutParams;
  styleTheme?: StyleTheme;
  metricValues?: number[];
  advantageIndices?: number[];
  showcaseMetrics?: Array<{ label: string; value: string; trend?: 'up' | 'down' | 'flat' }>;
  chart?: ChartSpec;
  architecture?: ArchitectureSpec;
  /** FR-0：参考含图强制插图——该页的参考原图（裁切用），由 applyReferenceImageOverride 写入。 */
  referenceHeroImage?: { src: string; bbox?: NormalizedBBox };
  /** FR-0：参考含图锁——优先级高于用户 imagePreference，normalizePlanByImagePreference 不得剥离。 */
  referenceLockedImage?: boolean;
}

export interface PresentationPlan {
  title: string;
  description?: string;
  narrativeArc?: string;
  primaryColor: string;
  slides: SlidePlan[];
  /** 跨步骤参考属性缓存版本（hash），由 plan 步骤返回，后续步骤原样回传以复用已解析属性 */
  refAttrsVersion?: string;
}

export interface DesignProposal {
  id: string;
  name: string;
  description: string;
  primaryColor: string;
  colorTheme?: ColorTheme;
  fontFamily: 'sans' | 'serif' | 'mono';
  styleTheme: StyleTheme;
  density: ContentDensity;
  iconStyle: IconStyle;
  coverHtml: string;
  slides?: RenderedSlide[];
}

export interface RenderedSlide {
  title: string;
  html: string;
  pageType: SlidePageType;
  imagePrompt?: string;
  imageRatio?: string;
  backgroundPrompt?: string;
  critique?: {
    score: number;
    passed: boolean;
    attempts: number;
    issues: string[];
  };
}

// 常见尺寸联合枚举（便于 IDE 智能提示）+ (string & {}) 允许任意 "WxH" 字符串（只要像素在模型
// 允许范围内，接口都能处理）。
type CommonImageSizes =
  | '256x256'
  | '512x512'
  | '1024x1024'
  | '1024x768'
  | '1280x960'
  | '1792x1024'
  | '1280x720'
  | '768x1024'
  | '1024x1792'
  | '2048x2048'
  | '2304x1728'
  | '1728x2304'
  | '2848x1600'
  | '1600x2848'
  | '2496x1664'
  | '1664x2496'
  | '3136x1344'
  | '2688x1536'
  | '1536x2688'
  | '2368x1728'
  | '1728x2368'
  | '1664x928'
  | '1472x1104'
  | '1328x1328'
  | '1104x1472'
  | '928x1664';

export type ImageSize = CommonImageSizes | (string & {});

export interface ImageGenerationOptions {
  model?: string;
  size?: ImageSize;
  quality?: 'standard' | 'hd';
  n?: number;
  style?: 'vivid' | 'natural';
  referenceImage?: string;
  /** FR-15：按分类（封面/内容/总结/全局）提供的参考图，供 provider 按 slide pageType 选取 img2img seed。
   *  优先级：referenceImageByCategory[pageType→category] > referenceImageByCategory.global > referenceImage。
   *  键含 'global' 作为跨分类兜底（不属于 PageCategory，但作为映射的回退键）。 */
  referenceImageByCategory?: Partial<Record<'cover' | 'content' | 'summary' | 'global', string>>;
  /** 当前 slide 的 pageType（或 'cover'|'content'|'summary'），配合 referenceImageByCategory 使用。 */
  referenceCategory?: string;
  allModels?: Array<{
    modelName: string;
    sizes: Array<{ width: number; height: number; label?: string }>;
    pixelRanges?: Array<{ minPixels: number; maxPixels: number; label?: string }>;
  }>;
  routing?: ImageModelRoutingConfig;
}

export type ImageRouteScene = 'cover' | 'content' | 'secondary';

export interface ImageModelRoutingConfig {
  enabled: boolean;
  coverModelIndex?: number;
  contentModelIndex?: number;
  secondaryModelIndex?: number;
}

export interface GeneratedImage {
  url: string;
  revisedPrompt?: string;
}

export interface GenerationProgress {
  phase: 'outline' | 'content' | 'images' | 'design' | 'critique' | 'complete';
  current: number;
  total: number;
  message?: string;
  critique?: {
    slideIndex: number;
    slideTitle: string;
    attempt: number;
    maxAttempts: number;
    score: number;
    passed: boolean;
    issues?: string[];
  };
}

export type GenerationCallback = (progress: GenerationProgress) => void;

export interface CritiqueConfig {
  enabled: boolean;
  threshold?: number;
  maxRetries?: number;
  llmCritique?: boolean;
  vlmPlaceholder?: boolean;
}

export interface PresentationGenerationOptions {
  style?: string;
  audience?: string;
  slideCount?: number;
  slideCountMin?: number;
  slideCountMax?: number;
  density?: ContentDensity;
  imagePreference?: ImagePreference;
  colorTheme?: ColorTheme;
  primaryColor?: string;
  fontFamily?: 'sans' | 'serif' | 'mono';
  slideWidth?: number;
  slideHeight?: number;
  /** 用户「自动生成背景图」开关（来自 01-request-config.json 的 backgroundEnabled）。仅控制系统是否自动生成背景大图；绝不继承参考图解析值。 */
  backgroundEnabled?: boolean;
  iconStyle?: IconStyle;
  imageOptions?: ImageGenerationOptions & { enabled: boolean };
  imageProvider?: any;
  planningProvider?: any;
  contentProvider?: any;
  editingProvider?: any;
  referenceImage?: string;
  referenceHtml?: string;
  /** 已由 server 侧提取并组装好的参考视觉属性（4 类 HTML + 4 类图片 VLM 合并结果），
   *  agent 内用于按页类型逐页覆盖用户全局设置（FR-4）。由 ai.service 预计算后传入。 */
  referenceVisualAttributes?: ReferenceVisualAttributes;
  /** 由 server 侧按分类组装好的参考 HTML 摘要（含主色/字体/标题色/正文色/母版/布局骨架等），
   *  优先级高于 agent 内部基于全局 referenceHtml 的兜底摘要；为空字符串时 agent 仍会回退到全局 HTML 摘要。 */
  referenceHtmlBrief?: string;
  onProgress?: GenerationCallback;
  critique?: CritiqueConfig;
  startIndex?: number;
  endIndex?: number;
  /** 设计方案数：1 用于全自动降本；默认 3 用于引导式 3 选 1。非数字或 <1 视为 3；>20 cap 为 20。 */
  proposalCount?: number;
  /**
   * RAG 文本素材（Hermes 侧检索/解析/联网搜索后整理好的内容稿）。
   * 由 planning 阶段以「权威素材」段注入大纲 prompt：内容必须基于素材，不得编造。
   * 注意：这是**内容素材**，与 `referenceHtml`（版式/视觉参考）语义不同。
   */
  referenceText?: string;
  /** 生成内容的输出语言；缺省按 'zh'（中文）。 */
  language?: 'zh' | 'en';
  postHtmlAuditHook?: (
    slides: RenderedSlide[],
    ctx: { plan: PresentationPlan; design: DesignProposal; traceSessionId?: string },
  ) => Promise<RenderedSlide[]>;
}

export type RouteStage = 'planning' | 'content' | 'editing' | 'audit' | 'auditVlm';

export interface ModelRef {
  provider: ModelProvider;
  modelIndex: number;
}

export interface ModelRoutingConfig {
  planning: ModelRef;
  content: ModelRef;
  editing: ModelRef;
  audit: ModelRef;
  auditVlm: ModelRef;
}

export interface StageModelConfigs {
  planning: ModelConfig;
  content: ModelConfig;
  editing: ModelConfig;
  audit: ModelConfig;
  auditVlm: ModelConfig;
}

// ===== 参考文件属性优先级（FR-0 / FR-3 / FR-4 / C-15）=====
// 14 类布局骨架枚举（参考版面的语义标签层，经 FR-18 映射到内置 Layout）
export type LayoutSkeletonType =
  | 'table-dominant'
  | 'comparison'
  | 'flowchart'
  | 'org-chart'
  | 'timeline'
  | 'pyramid'
  | 'matrix-four-quadrant'
  | 'card-grid'
  | 'big-image-caption'
  | 'pure-text-list'
  | 'three-section'
  | 'text-left-image-right'
  | 'image-left-text-right'
  | 'fullscreen-quote';

export type ReferenceStyle = 'academic' | 'creative' | 'business' | 'simple' | 'tech' | (string & {});

export interface ReferencePageHints {
  disableCover?: boolean;
  disableToc?: boolean;
  disableConclusion?: boolean;
}

export interface ReferenceStyleAttrs {
  primaryColor?: string;
  /** 参考素材中 H1/H2/H3 标题文字色（允许近黑/白/灰，与主色提取的排除语义相反）。 */
  titleColor?: string;
  /** 参考素材中 li/p 正文文字色（允许近黑/白/灰，与主色提取的排除语义相反）。 */
  bodyColor?: string;
  fontFamily?: 'sans' | 'serif' | 'mono';
  contentDensity?: ContentDensity;
  iconStyle?: IconStyle;
  style?: ReferenceStyle;
  imagePreference?: ImagePreference;
  /** 参考文件风格属性：仅描述「参考图/HTML 是否自带背景」（供版面对齐参考），不作为渲染控制值——绝不用于控制自动生成背景、绝不否决参考图 hero 注入。 */
  backgroundEnabled?: boolean;
  slideCount?: number;
  pageHints?: ReferencePageHints;
}

export interface MasterLogo {
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';
  htmlSnippet?: string;
  colorHex?: string;
  src?: string;
  ratio?: string;
  // FR-16.3 归一化四元组（[0,1]，左上角为原点），用于 P1 像素级开窗定位 / 裁剪
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  confidence?: number; // VLM 提取置信度，<0.5 时整块丢弃（走 P3 或放弃）
  // 参考原图像素宽高（落盘时由 PNG/JPEG 头部解析得到），用于 LOGO 开窗「不变形」定尺。
  // 缺失时按 16:9 退化，绝不抛错中断生成。
  refW?: number;
  refH?: number;
}

export interface MasterHeaderElement {
  type: string;
  colorHex?: string;
}

export interface MasterFooter {
  textContent?: string;
  hasPageNumber?: boolean;
}

export interface MasterSideDecoration {
  side: 'left' | 'right' | 'top' | 'bottom';
  colorHex?: string;
  htmlSnippet?: string;
}

export interface ReferenceMaster {
  logo?: MasterLogo;
  header?: { elements?: MasterHeaderElement[] };
  footer?: MasterFooter;
  sideDecorations?: MasterSideDecoration[];
  watermark?: { text?: string; htmlSnippet?: string };
  /** FR-0：参考含图时，把参考原图作为整页背景（CSS 开窗裁切），置于内容之下。 */
  heroImage?: { src: string; x?: number; y?: number; w?: number; h?: number; fit?: 'cover' | 'contain' | 'window' };
}

export interface ReferenceLayout {
  type: 'single' | 'page-type-map';
  single?: LayoutSkeletonType;
  pageTypeMap?: Record<string, LayoutSkeletonType>;
  zones?: Array<{ name: string; mainContent: string }>;
}

// ===== 参考结构克隆（FR-参考克隆 · 结构级而非属性级）=====
// 从参考 HTML 中抽取的真实画布调色板（含撞色 accent），用于「有参考时豁免单色系红线」的唯一信号。
export interface ReferencePalette {
  /** 主色（保持既有 primaryColor 语义，向后兼容） */
  primary: string;
  /** 撞色/强调色（孟菲斯的黄/青/蓝/藏青），按面积或出现频次降序，最多 5 个 */
  accents: string[];
  /** 粗描边色（孟菲斯的 #073B4C / #22223B），可选 */
  strokeColor?: string;
  /** 真实画布背景色（取自 .slide 而非预览台 body） */
  canvasBg?: string;
  /** 撞色判定：accents.length >= 2 且彼此 RGB 欧氏距离足够大 */
  isMultiColor: boolean;
}

/**
 * 按页配色策略（后处理链的唯一颜色真源）。
 * 由 `referenceVisualAttributes` + 用户设置按页解析得出；
 * 后处理据此把"参考撞色调色板 / 标题色 / 正文色 / 描边色"作为显式白名单放行，
 * 取代原先"全局单色系红线"对参考风格的无差别重写。
 */
export interface SlideColorPolicy {
  /** 本页主色（参考 > 用户设置 > 默认） */
  primary: string;
  /** 本页主色暗色变体 */
  primaryDarker: string;
  /** 参考标题色（如 `#22223b`），无则 undefined */
  titleColor?: string;
  /** 参考正文色（如 `#5c5c72`），无则 undefined */
  bodyColor?: string;
  /** 参考撞色板（如 `['#073b4c','#06d6a0','#118ab2','#ffc93c']`） */
  accents: string[];
  /** 参考粗描边色 */
  strokeColor?: string;
  /** 是否为撞色（accents.length > 0） */
  isMultiColor: boolean;
}

// 参考版式骨架的结构化描述 + 裁剪后的 DOM 骨架片段，供模型照抄结构。
export interface ReferenceStructure {
  /** 命中的画布选择器，用于日志与排查 */
  canvasSelector: string;
  /** 裁剪后的 DOM 骨架片段（确定性输出，可快照） */
  skeleton: string;
  /** 版式骨架中文描述（如「左文右图分栏，文字区约 44%，图片区约 46%」） */
  layoutVerbal: string;
  /** 装饰形态描述（如「几何色块 + 粗描边 + 圆点阵 + 波浪线」） */
  decorationVerbal: string;
  /** 是否存在图文槽位（含 SVG/占位图容器，不再只看 <img>） */
  hasImageSlot: boolean;
  /** 图区方位，用于修正镜像反转 */
  imageSide?: 'left' | 'right' | 'top' | 'bottom';
  /** 描边粗细（px） */
  borderWidthPx?: number;
  /** 卡片/图区圆角（px） */
  radiusPx?: number;
}

// ===== FR-0 归一化包围盒（0~1，左上角原点）=====
export interface NormalizedBBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

// ===== FR-2.x 参考图视觉特征（增强版式/视觉对齐，由 vlm-attribute-extraction 抽取）=====
export interface ReferenceVisualFeatures {
  /** 构图：居中 / 左对齐 / 分栏 / 全幅 */
  composition?: 'centered' | 'left-aligned' | 'split' | 'full-bleed';
  /** 栏数（cards / 指标类布局） */
  columns?: 1 | 2 | 3 | 4;
  /** 标题字号层级：海报级 / 大号 / 常规 */
  titleScale?: 'poster' | 'large' | 'normal';
  /** 装饰风格 */
  decoration?:
    | 'gradient-glow'
    | 'geometric-shapes'
    | 'thin-lines'
    | 'solid-blocks'
    | 'minimal';
  /** 背景调性：浅 / 深 / 彩色 */
  backgroundTone?: 'light' | 'dark' | 'colored';
  /** 卡片圆角：无 / 小 / 大 */
  cardRadius?: 'none' | 'small' | 'large';
  /** 图片调性：照片 / 插画 / 图标 / 无 */
  imagery?: 'photo' | 'illustration' | 'icon' | 'none';
  /** FR-0：参考图主体内容图区域的归一化 bbox（0~1），用于封面/总结页裁切复用原图 */
  contentImageBBox?: NormalizedBBox;
}

export interface CategoryReference {
  uploaded: boolean;
  style: ReferenceStyleAttrs;
  master?: ReferenceMaster;
  layout?: ReferenceLayout;
  briefText?: string;
  /** FR-15：该分类上传的参考图片地址（data URL 或存储 URL），用作文生图 img2img seed。
   *  single 全局参考图写入 global.referenceImageUrl；各分类专属图写入对应 byCategory[x].referenceImageUrl。 */
  referenceImageUrl?: string;
  /** FR-0 双通道判定（HTML 通道）：参考 HTML 原文（当参考本身是 HTML 而非图片时使用），用于检测其中 <img>/background-image。 */
  referenceHtml?: string;
  /** FR-2.x：参考图视觉特征（构图/栏数/装饰/背景/圆角/图片调性等），用于增强版式对齐。 */
  visual?: ReferenceVisualFeatures;
  /** FR-参考克隆：调色板（主色 + 撞色 accent + 描边色 + 画布背景），用于豁免单色系红线。 */
  palette?: ReferencePalette;
  /** FR-参考克隆：版式骨架结构化描述 + 裁剪后的 DOM 骨架片段，供模型照抄结构。 */
  structure?: ReferenceStructure;
}

export type PageCategory = 'cover' | 'content' | 'summary';

export function pageTypeToCategory(pageType: string): PageCategory {
  if (pageType === 'cover' || pageType === 'page-cover') return 'cover';
  if (pageType === 'summary' || pageType === 'conclusion' || pageType === 'ending' || pageType === 'end') return 'summary';
  return 'content';
}

export interface ReferenceVisualAttributes {
  global: CategoryReference;
  byCategory: {
    cover: CategoryReference;
    content: CategoryReference;
    summary: CategoryReference;
  };
  briefText?: string;
  source: 'merged-category-assembled' | 'html-only' | 'image-only' | 'fallback-global';
  /** 参考构图（由 resolveReferenceComposition 解析后的缓存值，可选） */
  referenceComposition?: 'left-aligned' | 'centered' | 'unknown';
}

/** 评审参考上下文（Task5 / FR-17.2）：告知 critique 引擎当前页是否承载参考文件意图，
 *  以便其在 L0 底线之上放宽对"参考风格偏离默认规范"的扣分。 */
export interface ReferenceContext {
  hasReference: boolean;
  source?: 'html' | 'image' | 'none';
  appliedFields?: string[];
}
