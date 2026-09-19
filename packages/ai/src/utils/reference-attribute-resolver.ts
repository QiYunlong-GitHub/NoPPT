import {
  resolveReferenceComposition,
  describeVisualFeatures,
} from './reference/composition';
export {
  HEX_RE,
  resolvePrimaryColor,
  resolveTitleColor,
  resolveBodyColor,
  COLOR_CLOSE_THRESHOLD,
  hexToRgb,
  colorDistance,
  mostConsistentColor,
  resolveReferencePrimaryColor,
  resolveDeckReferencePrimaryColor,
  resolveFinalPagePrimaryColor,
  resolveColorPolicyForPage,
  getReferenceColorPolicyForPage,
  resolveAttrForPage,
  getReferencePaletteForPage,
} from './reference/color';
export {
  resolveReferenceComposition,
  describeVisualFeatures,
} from './reference/composition';
// 参考文件属性优先级解析（Task 1 / FR-0 / FR-3 / FR-4 / C-15）
// 纯函数模块，无私有方法，便于 Vitest 直接 import 测试（不依赖 agent 实例）。
import {
  CategoryReference,
  LayoutSkeletonType,
  NormalizedBBox,
  PageCategory,
  pageTypeToCategory,
  ReferenceContext,
  ReferenceMaster,
  ReferencePageHints,
  ReferenceStyleAttrs,
  ReferenceVisualAttributes,
  SlidePageType,
} from '../types';

// ---------- 9 个三级优先级 resolve 函数（ref 优先 → user → default）----------
export function resolveFontFamily(
  ref?: 'sans' | 'serif' | 'mono',
  user?: 'sans' | 'serif' | 'mono',
  def: 'sans' | 'serif' | 'mono' = 'sans',
): 'sans' | 'serif' | 'mono' {
  return ref ?? user ?? def;
}

export function resolveIconStyle(
  ref?: ReferenceStyleAttrs['iconStyle'],
  user?: ReferenceStyleAttrs['iconStyle'],
  def: NonNullable<ReferenceStyleAttrs['iconStyle']> = 'auto',
): NonNullable<ReferenceStyleAttrs['iconStyle']> {
  return ref ?? user ?? def;
}

export function resolveDensity(
  ref?: ReferenceStyleAttrs['contentDensity'],
  user?: ReferenceStyleAttrs['contentDensity'],
  def: NonNullable<ReferenceStyleAttrs['contentDensity']> = 'normal',
): NonNullable<ReferenceStyleAttrs['contentDensity']> {
  return ref ?? user ?? def;
}

/**
 * 配图偏好三级解析：ref > user > default。
 * 默认值取 'content-only'（与前端默认一致：仅内容页配图，封面/目录/总结不放图）。
 * 注意：参考解析器在「参考页无图槽」时会返回 undefined（未提取），不得因此把偏好降级为 none。
 */
export function resolveImagePreference(
  ref?: ReferenceStyleAttrs['imagePreference'],
  user?: ReferenceStyleAttrs['imagePreference'],
  def: NonNullable<ReferenceStyleAttrs['imagePreference']> = 'content-only',
): NonNullable<ReferenceStyleAttrs['imagePreference']> {
  return ref ?? user ?? def;
}

export function resolveStyle(
  ref?: ReferenceStyleAttrs['style'],
  user?: ReferenceStyleAttrs['style'],
  def: NonNullable<ReferenceStyleAttrs['style']> = 'business',
): NonNullable<ReferenceStyleAttrs['style']> {
  return ref ?? user ?? def;
}

export function resolveBackgroundEnabled(ref?: boolean, user?: boolean, def = false): boolean {
  return ref ?? user ?? def;
}

export function resolveSlideCount(ref?: number, user?: number, def?: number): number | undefined {
  return ref ?? user ?? def;
}

export function resolvePageHints(
  ref?: ReferencePageHints,
  user?: ReferencePageHints,
  def?: ReferencePageHints,
): ReferencePageHints | undefined {
  return ref ?? user ?? def;
}

// ---------- 单分类内 HTML + 图片合并（HTML 优先）----------
function mergeMaster(html?: ReferenceMaster, img?: ReferenceMaster): ReferenceMaster | undefined {
  if (!html && !img) return undefined;
  if (!html) return img;
  if (!img) return html;
  return {
    logo: html.logo ?? img.logo,
    header: html.header ?? img.header,
    footer: html.footer ?? img.footer,
    sideDecorations: html.sideDecorations ?? img.sideDecorations,
    watermark: html.watermark ?? img.watermark,
  };
}

export function mergeReferenceAttrs(
  htmlAttrs?: CategoryReference,
  imgAttrs?: CategoryReference,
): CategoryReference {
  const uploaded = htmlAttrs?.uploaded || imgAttrs?.uploaded || false;
  const style: ReferenceStyleAttrs = { ...imgAttrs?.style, ...htmlAttrs?.style };
  const master = mergeMaster(htmlAttrs?.master, imgAttrs?.master);
  const layout = htmlAttrs?.layout ?? imgAttrs?.layout;
  const briefText = htmlAttrs?.briefText ?? imgAttrs?.briefText;
  // visual 七维视觉特征：HTML 优先（图片参考为主时的 imgAttrs 自然胜出）
  const visual = htmlAttrs?.visual ?? imgAttrs?.visual;
  // FR-参考克隆：骨架/结构/调色板随 HTML 通道优先透传（图片参考为主时 imgAttrs 胜出）
  const referenceHtml = htmlAttrs?.referenceHtml ?? imgAttrs?.referenceHtml;
  const structure = htmlAttrs?.structure ?? imgAttrs?.structure;
  const palette = htmlAttrs?.palette ?? imgAttrs?.palette;
  return { uploaded, style, master, layout, briefText, visual, referenceHtml, structure, palette };
}

// ---------- 跨三分类 pageHints 合并（三取 OR，明确 false 优先）----------
function mergePageHintsOR(
  list: (ReferencePageHints | undefined)[],
): ReferencePageHints | undefined {
  const flags: (keyof ReferencePageHints)[] = ['disableCover', 'disableToc', 'disableConclusion'];
  const result: ReferencePageHints = {};
  let any = false;
  for (const flag of flags) {
    const falses = list.filter((p) => p && p[flag] === false);
    const trues = list.filter((p) => p && p[flag] === true);
    if (falses.length > 0) {
      (result as Record<string, boolean>)[flag] = false;
      any = true;
    } else if (trues.length > 0) {
      (result as Record<string, boolean>)[flag] = true;
      any = true;
    }
  }
  return any ? result : undefined;
}

// ---------- 顶层组装（FR-3）----------
export function assembleReferenceVisualAttributes(inputs: {
  coverRef?: CategoryReference;
  contentRef?: CategoryReference;
  summaryRef?: CategoryReference;
  globalRef?: CategoryReference;
}): ReferenceVisualAttributes {
  const byCategory = {
    cover: inputs.coverRef ?? { uploaded: false, style: {} },
    content: inputs.contentRef ?? { uploaded: false, style: {} },
    summary: inputs.summaryRef ?? { uploaded: false, style: {} },
  };
  const global = inputs.globalRef ?? { uploaded: false, style: {} };

  // pageHints 三类 OR 合并（明确 false 优先于 true），结果写回三类
  const mergedPageHints = mergePageHintsOR([
    byCategory.cover.style.pageHints,
    byCategory.content.style.pageHints,
    byCategory.summary.style.pageHints,
  ]);
  if (mergedPageHints) {
    for (const cat of [byCategory.cover, byCategory.content, byCategory.summary]) {
      cat.style = { ...cat.style, pageHints: mergedPageHints };
    }
  }

  const anyCategoryUploaded =
    byCategory.cover.uploaded || byCategory.content.uploaded || byCategory.summary.uploaded;
  const source: ReferenceVisualAttributes['source'] = anyCategoryUploaded
    ? 'merged-category-assembled'
    : 'fallback-global';

  const briefParts = [
    byCategory.cover.briefText,
    byCategory.content.briefText,
    byCategory.summary.briefText,
    global.briefText,
  ].filter(Boolean);

  return {
    global,
    byCategory,
    briefText: briefParts.length ? briefParts.join('\n') : undefined,
    source,
  };
}

// ---------- FR-4 四级查找链 ----------
export function resolveMasterForPage(
  attrs: ReferenceVisualAttributes,
  pageCategory: PageCategory,
): ReferenceMaster | undefined {
  const cat = attrs.byCategory[pageCategory];
  if (cat?.uploaded && cat.master) return cat.master;
  if (attrs.global.uploaded && attrs.global.master) return attrs.global.master;
  return undefined;
}

// ---------- FR-0 参考含图判定与 bbox 归一化 ----------

/**
 * 归一化校验内容图 bbox（0~1，左上角原点）。
 * 非有限值 / 越界 / 宽高 <=0 / x+w 或 y+h 越界 一律丢弃，返回 undefined（降级为不裁切整图）。
 */
export function normalizeBBox(v: unknown): NormalizedBBox | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  const x = typeof o.x === 'number' && isFinite(o.x) ? o.x : undefined;
  const y = typeof o.y === 'number' && isFinite(o.y) ? o.y : undefined;
  const w = typeof o.w === 'number' && isFinite(o.w) ? o.w : undefined;
  const h = typeof o.h === 'number' && isFinite(o.h) ? o.h : undefined;
  if (x === undefined || y === undefined || w === undefined || h === undefined) return undefined;
  if (x < 0 || y < 0 || w <= 0 || h <= 0 || x > 1 || y > 1 || w > 1 || h > 1) return undefined;
  if (x + w > 1.0001 || y + h > 1.0001) return undefined;
  return { x, y, w, h };
}

/**
 * FR-0 双通道判定：参考图是否含图（需强制插图）。
 *  - 通道 A（VLM 语义）：该分类 visual.imagery ∈ {photo, illustration}；
 *  - 通道 B（HTML 结构）：参考 HTML 中存在 <img> 或 background-image。
 * 任一命中即 true。无参考 / 未上传 / 缺字段 → false（回落原逻辑，向后兼容）。
 */
export function hasReferenceImage(
  attrs: ReferenceVisualAttributes | null | undefined,
  pageType: string | undefined,
): boolean {
  if (!attrs?.byCategory) return false;
  const cat = pageTypeToCategory(pageType ?? 'content');
  const cr = attrs.byCategory[cat];
  const imagery = cr?.visual?.imagery;
  if (imagery === 'photo' || imagery === 'illustration') return true;
  const refHtml = cr?.referenceHtml ?? attrs.global?.referenceHtml;
  if (refHtml && /<img\b|background-image\s*:/i.test(refHtml)) return true;
  return false;
}

/**
 * 解析某页的参考原图（封面/总结裁切复用所需）：返回 { src, bbox } 或 undefined。
 * src 取自该分类（或全局）的 referenceImageUrl；bbox 取自 visual.contentImageBBox（已归一化校验）。
 */
export function resolveHeroImageForPage(
  attrs: ReferenceVisualAttributes | null | undefined,
  pageType: string | undefined,
): { src: string; bbox?: NormalizedBBox } | undefined {
  if (!hasReferenceImage(attrs, pageType)) return undefined;
  const cat = pageTypeToCategory(pageType ?? 'content');
  const src = attrs?.byCategory?.[cat]?.referenceImageUrl ?? attrs?.global?.referenceImageUrl;
  if (!src) return undefined;
  // 纵深防御：提取阶段已归一化，这里再次校验，丢弃越界/非法 bbox（如 y+h>1 的脏数据），
  // 降级为「整图 cover」，避免母版 hero 开窗错位（Q3 降级语义固化）。
  const bbox = normalizeBBox(attrs?.byCategory?.[cat]?.visual?.contentImageBBox);
  return bbox ? { src, bbox } : { src };
}

/**
 * 由 ReferenceVisualAttributes 推导评审参考上下文（FR-17.2 / Task5）。
 * - hasReference：任一分类或 global 上传过即视为"有参考意图"。
 * - source：html / image / none（按实际上传来源粗略判定）。
 * - appliedFields：确实携带了可应用属性的字段名（供 critique 放宽条款精确引用）。
 */
export function buildReferenceContext(rva?: ReferenceVisualAttributes): ReferenceContext {
  if (!rva) return { hasReference: false, source: 'none' };
  const cats = [rva.global, rva.byCategory.cover, rva.byCategory.content, rva.byCategory.summary];
  const anyUploaded = cats.some((c) => c?.uploaded);
  if (!anyUploaded) return { hasReference: false, source: 'none' };
  const htmlUploaded = [rva.byCategory.cover, rva.byCategory.content, rva.byCategory.summary].some(
    (c) => c?.uploaded && c.style && Object.keys(c.style).length > 0,
  );
  const source: ReferenceContext['source'] = htmlUploaded ? 'html' : 'image';
  const appliedFields = new Set<string>();
  for (const c of cats) {
    if (!c?.uploaded || !c.style) continue;
    for (const k of Object.keys(c.style)) appliedFields.add(k);
  }
  return {
    hasReference: true,
    source,
    appliedFields: appliedFields.size ? Array.from(appliedFields) : undefined,
  };
}

/**
 * FR-18 §18.2：参考版式（C-14 的 LayoutSkeletonType 语义标签）1:1 映射到扩展后的内置 SlidePageType。
 * 原则：无信息丢失、不退化——每个参考版式都有精确对应的内置 Layout 模板。
 * 未知枚举（含未来扩展的 chart/cycle/architecture 等）回退到语义最近的内置 Layout（NFR-2 降级，不抛错）。
 */
export function mapReferenceLayoutToBuiltin(
  refLayout: LayoutSkeletonType | undefined | null,
): SlidePageType | undefined {
  if (!refLayout) return undefined;
  const MAP: Record<LayoutSkeletonType, SlidePageType> = {
    'table-dominant': 'content-table',
    comparison: 'content-compare', // 深度对比由 LLM 触发 comparison-deep-dive，二者不冲突
    flowchart: 'content-flowchart',
    'org-chart': 'content-org-chart',
    timeline: 'content-timeline',
    pyramid: 'content-pyramid',
    'matrix-four-quadrant': 'content-matrix',
    'card-grid': 'content-cards',
    'big-image-caption': 'content-image-top', // 取近：大图 + 说明
    'pure-text-list': 'content-no-image', // 取近：纯文字列表
    'three-section': 'content-three-section',
    'text-left-image-right': 'content-image-right',
    'image-left-text-right': 'content-image-left',
    'fullscreen-quote': 'content-quote',
  };
  // 未来若扩展 LayoutSkeletonType（加 chart-bar/cycle/architecture 等）应在上表补齐，保持无信息丢失。
  return MAP[refLayout] ?? 'content-no-image';
}

/**
 * 单图/单骨架强制作用域：single.layout 仅作用于「该分类第 0 页」。
 * 放宽：封面/总结页不再被作用域整体丢弃（修复"布局骨架对 cover/summary 被作用域丢弃"），
 * 但保留结构保护——封面/总结页自身不会被覆盖为内容型页型（内置映射无封面/总结等价项，
 * 避免把 hero 封面误改为 content-* 而破坏结构），仅当映射结果与原页型同类时才覆盖。
 */
export function resolveLayoutForPage(
  attrs: ReferenceVisualAttributes,
  pageCategory: PageCategory,
  pageIndexOfCategory = 0,
  pageType?: string,
): SlidePageType | undefined {
  const trySingle = (single?: LayoutSkeletonType): SlidePageType | undefined => {
    if (!single) return undefined;
    const mapped = mapReferenceLayoutToBuiltin(single);
    if (!mapped) return undefined;
    // 结构保护：封面/总结页不覆盖为内容型页型（无对应封面/总结映射，避免破坏结构）
    if ((pageType === 'cover' || pageType === 'summary') && mapped !== pageType) {
      return undefined;
    }
    return mapped;
  };
  const cat = attrs.byCategory[pageCategory];
  if (cat?.uploaded && cat.layout) {
    if (cat.layout.type === 'single') {
      const scoped = pageType ? pageType !== 'toc' : true; // 仅 toc 仍被排除
      return pageIndexOfCategory === 0 && scoped ? trySingle(cat.layout.single) : undefined;
    }
    if (cat.layout.type === 'page-type-map' && pageType) {
      return trySingle(cat.layout.pageTypeMap?.[pageType]);
    }
    return trySingle(cat.layout.single);
  }
  if (attrs.global.uploaded && attrs.global.layout) {
    if (attrs.global.layout.type === 'page-type-map' && pageType) {
      return trySingle(attrs.global.layout.pageTypeMap?.[pageType]);
    }
    return trySingle(attrs.global.layout.single);
  }
  return undefined;
}

/** 计算某页在其所属分类内的序号（第 0 页才克隆参考结构），供 agent 三处调用点统一复用。 */
export function computePageIndexInCategory(
  slides: ReadonlyArray<{ pageType?: string }>,
  pageIndex: number,
): number {
  const baseCat = pageTypeToCategory(slides[pageIndex]?.pageType ?? 'content');
  return slides
    .slice(0, pageIndex)
    .filter((s) => pageTypeToCategory(s.pageType ?? 'content') === baseCat).length;
}

/**
 * 判定本页可继承的「结构层」参考来源（DOM 骨架 / layout 骨架 / 结构口语化指引 / 构图红线）。
 * - explicit：该分类显式上传了 HTML 参考（byCategory[cat].uploaded && referenceHtml）
 * - global-content-fallback：仅一份 global 单份参考，定向兜底给 content 分类（不进 cover/summary）
 * - none：无结构参考可用，本页结构完全交给规划 pageType 与内置模板
 *
 * 风格层（主色/字体/标题色/调色板/画布底色/母版）不走此门控，仍由 global 兜底全 deck 广播。
 */
export type StructureSourceKind = 'explicit' | 'global-content-fallback' | 'none';
export function resolveStructureSource(
  attrs: ReferenceVisualAttributes | null | undefined,
  pageType: string,
): { kind: StructureSourceKind; ref?: CategoryReference } {
  if (!attrs) return { kind: 'none' };
  const cat = pageTypeToCategory(pageType);
  const cr = attrs.byCategory?.[cat];
  if (cr?.uploaded && cr.referenceHtml) {
    return { kind: 'explicit', ref: cr };
  }
  // 单份 global 仅定向兜底给 content 分类（单份参考通常就是内容页），绝不为 cover/summary 提供结构，
  // 以切断「内容参考的结构（左对齐构图/卡片骨架）灌进封面」的污染链路（pres_mtrcm1nx 根因）。
  if (cat === 'content' && attrs.global?.uploaded && attrs.global.referenceHtml) {
    return { kind: 'global-content-fallback', ref: attrs.global };
  }
  return { kind: 'none' };
}

/** 取某页对应分类（或 content 定向兜底的 global）的参考 DOM 骨架片段。
 *  非分类第 0 页、或结构来源为 none 时返回 ''（防多页雷同 + 跨分类污染）。 */
export function getReferenceSnippetForPage(
  attrs: ReferenceVisualAttributes,
  pageType: string,
  pageIndexOfCategory = 0,
): string {
  const src = resolveStructureSource(attrs, pageType);
  if (src.kind === 'none' || !src.ref?.referenceHtml) return '';
  // 仅该分类第 0 页克隆参考 DOM 骨架，其余内容页保留规划阶段分配的独立版式
  return pageIndexOfCategory === 0 ? src.ref.referenceHtml : '';
}

/** 取某页对应分类（或全局兜底）的调色板（含撞色判定）。 */
export function getReferenceSnippetOverview(attrs: ReferenceVisualAttributes): string {
  return [attrs.byCategory.cover, attrs.byCategory.content, attrs.byCategory.summary, attrs.global]
    .filter((c) => c?.uploaded && c.referenceHtml)
    .map((c) => c!.referenceHtml!)
    .join('\n\n');
}

/** 规划阶段的色彩红线豁免（任一分类撞色即生效）。 */
export function getReferenceColorPolicyOverview(attrs: ReferenceVisualAttributes): string {
  const anyMulti = [
    attrs.byCategory.cover,
    attrs.byCategory.content,
    attrs.byCategory.summary,
    attrs.global,
  ].some((c) => c?.uploaded && c.palette?.isMultiColor && c.palette.accents.length > 0);
  if (!anyMulti) return '';
  const accents = new Set<string>();
  [
    attrs.byCategory.cover,
    attrs.byCategory.content,
    attrs.byCategory.summary,
    attrs.global,
  ].forEach((c) => {
    if (c?.uploaded && c.palette?.accents)
      c.palette.accents.forEach((a) => accents.add(a.toUpperCase()));
  });
  return `【参考克隆 · 色彩红线豁免】参考文件使用多色调色板，生成各页时允许使用以下 accent 色：${Array.from(accents).join('、')}。这些色视为参考风格的一部分，不计入「单色系红线」违规；其余装饰仍优先使用主色系。`;
}

/**
 * 规划阶段「版式多样性」提示：当有参考结构可用时，要求首内容页套用参考结构、其余同类内容页改用不同内置版式，
 * 且封面/总结页不要克隆内容页结构。仅在有结构参考时返回非空文案。
 */
export function getReferenceLayoutDiversityHint(
  attrs: ReferenceVisualAttributes | null | undefined,
): string {
  if (!attrs) return '';
  const hasStruct = (cat: PageCategory): boolean => {
    const cr = attrs.byCategory?.[cat];
    return (
      !!(cr?.uploaded && cr.referenceHtml) ||
      (cat === 'content' && !!attrs.global?.uploaded && !!attrs.global.referenceHtml)
    );
  };
  if (!hasStruct('cover') && !hasStruct('content') && !hasStruct('summary')) return '';
  return (
    '【参考克隆 · 版式多样性】已上传参考文件（通常仅一份），规划各页 pageType 时务必保证版式多样：' +
    '① 同一分类的内容页只允许「第一页」采用与参考一致的结构（cards / timeline / compare 等），其余同类内容页必须改用**不同**的内置版式，严禁多页雷同；' +
    '② 参考文件代表一种页面结构，封面/总结页不要克隆内容页的结构，应保留各自的内置版式（hero / three-section 等）。'
  );
}

// ---------- FR-4 逐页覆盖指令格式化（供 agent 注入 prompt）----------

/**
 * 生成「某一页」的参考属性覆盖指令（自然语言块），供注入该页的 HTML 生成 prompt。
 * 仅当该页对应分类或 global 中确有用户提供属性时才产出，否则返回 ''。
 * 覆盖优先级遵循 FR-5：参考文件 > 用户全局设置 > 系统默认。
 */
export function formatReferenceOverrideForPage(
  attrs: ReferenceVisualAttributes,
  pageType: string,
  pageIndexOfCategory = 0,
): string {
  const cat = pageTypeToCategory(pageType);
  const cr = attrs.byCategory[cat];
  const gr = attrs.global;
  // 结构层门控：仅「分类显式上传」或「content 的 global 定向兜底」才提供结构（DOM 骨架 / layout / 结构指引 / 构图红线）；
  // 风格层（主色/字体/标题色/调色板/画布底色/母版）仍走 cr→gr 兜底广播，不受此门控影响。
  const structSrc = resolveStructureSource(attrs, pageType);
  const pick = (k: keyof ReferenceStyleAttrs): unknown => {
    if (cr?.uploaded && cr.style[k] !== undefined) return cr.style[k];
    if (gr.uploaded && gr.style[k] !== undefined) return gr.style[k];
    return undefined;
  };

  const lines: string[] = [];
  const primary = pick('primaryColor');
  const font = pick('fontFamily');
  const density = pick('contentDensity');
  const icon = pick('iconStyle');
  const theme = pick('style');
  const titleColor = pick('titleColor');
  const bodyColor = pick('bodyColor');

  if (primary !== undefined)
    lines.push(`- 主色(primaryColor)：${String(primary)}（必须精确使用，覆盖用户全局配色）`);
  if (font !== undefined) lines.push(`- 字体(fontFamily)：${String(font)}`);
  if (density !== undefined) lines.push(`- 内容密度(contentDensity)：${String(density)}`);
  if (icon !== undefined) lines.push(`- 图标风格(iconStyle)：${String(icon)}`);
  if (theme !== undefined) lines.push(`- 风格主题(style)：${String(theme)}`);
  if (titleColor !== undefined)
    lines.push(
      `- 标题文字色(titleColor)：${String(titleColor)}（H1/H2/H3 必须使用此色，覆盖默认深灰与浅底主色渐变规则）`,
    );
  if (bodyColor !== undefined)
    lines.push(
      `- 正文文字色(bodyColor)：${String(bodyColor)}（li/p 正文必须使用此色，覆盖默认深灰色）`,
    );

  // FR-2.x：参考图视觉特征指引（构图/栏数/装饰/背景/圆角/图片调性等），仅结构来源非空时输出（防跨分类污染）
  const visual = structSrc.kind !== 'none' ? structSrc.ref?.visual : undefined;
  const visualDesc = describeVisualFeatures(visual);
  if (visualDesc) lines.push(`- 视觉风格特征（参考图版式/装饰指引，请尽量贴近）：${visualDesc}`);

  const master = resolveMasterForPage(attrs, cat);
  if (master) {
    const m: string[] = [];
    if (master.logo) m.push('logo 元素');
    if (master.header?.elements?.length) m.push('页眉元素');
    if (master.footer?.textContent) m.push(`页脚文字「${master.footer.textContent}」`);
    if (master.watermark?.text) m.push(`水印「${master.watermark.text}」`);
    if (master.sideDecorations?.length) m.push('侧边装饰');
    if (m.length) lines.push(`- 母版元素（如适用请保留）：${m.join('、')}`);
  }

  // 显示「参考原始骨架名」给 LLM 作为风格指引（如 hero-centered），
  // 与 resolveLayoutForPage 的「1:1 映射为内置 pageType」分工：后者用于实际 pageType 赋值，前者用于 prompt 语义指引。
  const layoutSkeleton: string | undefined = (() => {
    if (structSrc.kind === 'none' || !structSrc.ref?.layout) return undefined;
    const lay = structSrc.ref.layout;
    if (lay.type === 'single') {
      // 仅分类第 0 页克隆参考骨架（防多页雷同）；放宽：封面/总结页也展示作为 prompt 指引（仅 toc 仍排除）
      const scoped = pageType ? pageType !== 'toc' : true;
      return pageIndexOfCategory === 0 && scoped ? lay.single : undefined;
    }
    if (lay.type === 'page-type-map' && pageType) {
      return lay.pageTypeMap?.[pageType];
    }
    return lay.single;
  })();
  if (layoutSkeleton) lines.push(`- 布局骨架(layout)：${layoutSkeleton}`);

  // FR-参考克隆：调色板（撞色 accent 多色，允许用于装饰/色块/描边）
  const palette =
    cr?.uploaded && cr.palette ? cr.palette : gr.uploaded && gr.palette ? gr.palette : undefined;
  if (palette && palette.accents.length) {
    const accentTxt = palette.accents.map((c) => c.toUpperCase()).join('、');
    const strokeTxt = palette.strokeColor ? `，粗描边色 ${palette.strokeColor.toUpperCase()}` : '';
    lines.push(
      `- 参考调色板（accent 多色，可用于装饰色块/几何形状/描边）：${accentTxt}${strokeTxt}`,
    );
  }
  // FR：画布底色（参考文件提取）→ 提示模型替换默认纯白 #fff
  const canvasSrc =
    cr?.uploaded && cr.palette?.canvasBg
      ? cr
      : gr.uploaded && gr.palette?.canvasBg
        ? gr
        : undefined;
  const canvasBg = canvasSrc?.palette?.canvasBg;
  if (canvasBg) {
    lines.push(`- 画布底色(canvasBg)：${canvasBg}（页面背景请使用该底色，替换模板默认纯白 #fff）`);
  }
  // FR：参考构图红线（左对齐 / 居中）
  const comp = resolveReferenceComposition(attrs, pageType);
  if (comp === 'left-aligned') {
    lines.push(
      '- 构图红线：参考为「左对齐构图」，本页内容列左对齐、垂直居中即可，禁止给外层容器加 justify-content/align-items/text-align:center 居中三件套',
    );
  } else if (comp === 'centered') {
    lines.push('- 构图红线：参考为「居中构图」，本页可保持居中');
  }
  // FR-参考克隆：结构口语化指引（版式/装饰/图文方位/圆角）—— 仅结构来源非空且为分类第 0 页时输出（防多页雷同 + 跨分类污染）
  const st = structSrc.kind !== 'none' ? structSrc.ref?.structure : undefined;
  if (st && pageIndexOfCategory === 0) {
    const segs: string[] = [];
    if (st.layoutVerbal) segs.push(st.layoutVerbal);
    if (st.decorationVerbal) segs.push(st.decorationVerbal);
    if (st.hasImageSlot && st.imageSide) segs.push(`图区方位=${st.imageSide}（请勿左右镜像反转）`);
    if (st.radiusPx != null) segs.push(`卡片/图区圆角=${st.radiusPx}px`);
    if (segs.length) lines.push(`- 参考版式结构指引：${segs.join('；')}`);
  }

  if (lines.length === 0) return '';
  return (
    `【参考文件视觉覆盖指令 · 本页(pageType=${pageType})】\n` +
    lines.join('\n') +
    `\n（优先级：参考文件 > 用户全局设置 > 系统默认；上述属性必须在本页精确呈现，不得被用户全局设置覆盖。）`
  );
}

/**
 * 生成「规划阶段」的参考属性覆盖总览（分类级），供注入规划 prompt，
 * 让 planner 在规划出对应页型时采用参考属性。
 */
export function formatReferenceOverrideOverview(attrs: ReferenceVisualAttributes): string {
  const cats: Array<[PageCategory, string]> = [
    ['cover', '封面'],
    ['content', '内容'],
    ['summary', '总结'],
  ];
  const lines: string[] = [];
  for (const [cat, label] of cats) {
    const cr = attrs.byCategory[cat];
    if (!cr?.uploaded) continue;
    const s = cr.style;
    const parts: string[] = [];
    if (s.primaryColor) parts.push(`主色 ${s.primaryColor}`);
    if (s.titleColor) parts.push(`标题色 ${s.titleColor}`);
    if (s.bodyColor) parts.push(`正文色 ${s.bodyColor}`);
    if (s.fontFamily) parts.push(`字体 ${s.fontFamily}`);
    if (s.contentDensity) parts.push(`密度 ${s.contentDensity}`);
    if (s.iconStyle) parts.push(`图标 ${s.iconStyle}`);
    if (s.style) parts.push(`风格 ${s.style}`);
    const vDesc = describeVisualFeatures(cr.visual);
    if (vDesc) parts.push(`视觉 ${vDesc}`);
    if (cr.master) parts.push('含母版元素');
    if (cr.layout) parts.push(`布局 ${cr.layout.single ?? '自定义'}`);
    if (parts.length) lines.push(`- ${label}类参考：${parts.join('、')}`);
  }
  if (attrs.global.uploaded) {
    const g = attrs.global.style;
    const parts: string[] = [];
    if (g.primaryColor) parts.push(`主色 ${g.primaryColor}`);
    if (g.titleColor) parts.push(`标题色 ${g.titleColor}`);
    if (g.bodyColor) parts.push(`正文色 ${g.bodyColor}`);
    if (g.fontFamily) parts.push(`字体 ${g.fontFamily}`);
    if (g.contentDensity) parts.push(`密度 ${g.contentDensity}`);
    if (g.iconStyle) parts.push(`图标 ${g.iconStyle}`);
    const gVDesc = describeVisualFeatures(attrs.global.visual);
    if (gVDesc) parts.push(`视觉 ${gVDesc}`);
    if (parts.length) lines.push(`- 全局参考：${parts.join('、')}`);
  }
  if (lines.length === 0) return '';
  return (
    `【参考文件视觉覆盖总览（规划阶段，参考 > 用户 > 默认）】\n` +
    lines.join('\n') +
    `\n（若规划出对应页型，必须采用上述参考属性，不可被用户全局设置覆盖。）`
  );
}

// pageTypeToCategory 定义在 types.ts，此处 re-export 方便统一从 resolver 入口导入
export { pageTypeToCategory } from '../types';

/**
 * FR-15：根据当前页 pageType 选取 img2img seed 参考图。
 * 查找链（严格遵循"参考文件 > 用户全局设置 > 系统默认"，与 FR-5 一致）：
 *   1. 该 pageType 对应分类（cover/content/summary）上传的参考图
 *   2. global 上传的参考图
 *   3. 旧字段 legacyReferenceImage（逐字节兼容：仅传全局 referenceImage 时行为与改造前完全一致）
 * 全无则返回 undefined（不使用 seed）。
 */
export function resolveReferenceSeedImage(
  rva: ReferenceVisualAttributes | undefined,
  pageType: string | undefined,
  legacyReferenceImage?: string,
): string | undefined {
  const cat = pageTypeToCategory(pageType ?? 'content');
  const fromCat = rva?.byCategory?.[cat]?.referenceImageUrl;
  const fromGlobal = rva?.global?.referenceImageUrl;
  return fromCat || fromGlobal || legacyReferenceImage || undefined;
}

