// 参考文件属性优先级解析（Task 1 / FR-0 / FR-3 / FR-4 / C-15）
// 纯函数模块，无私有方法，便于 Vitest 直接 import 测试（不依赖 agent 实例）。
import {
  PageCategory,
  pageTypeToCategory,
  ReferenceVisualAttributes,
  ReferenceStyleAttrs,
  ReferencePalette,
  SlideColorPolicy,
} from '../../types';

// ---------- 9 个三级优先级 resolve 函数（ref 优先 → user → default）----------

export const HEX_RE = /^#[0-9a-fA-F]{6}$/;


export function resolvePrimaryColor(ref?: string, user?: string, def = '#2563eb'): string {
  const norm = (v?: string): string | undefined =>
    v && HEX_RE.test(v) ? v.toLowerCase() : undefined;
  return norm(ref) ?? norm(user) ?? def;
}


/** 参考标题文字色（H1/H2/H3）三级解析：ref > user > default。允许近黑/白/灰。 */
export function resolveTitleColor(ref?: string, user?: string, def = '#111827'): string {
  const norm = (v?: string): string | undefined =>
    v && HEX_RE.test(v) ? v.toLowerCase() : undefined;
  return norm(ref) ?? norm(user) ?? def;
}


/** 参考正文文字色（li/p）三级解析：ref > user > default。允许近黑/白/灰。 */
export function resolveBodyColor(ref?: string, user?: string, def = '#374151'): string {
  const norm = (v?: string): string | undefined =>
    v && HEX_RE.test(v) ? v.toLowerCase() : undefined;
  return norm(ref) ?? norm(user) ?? def;
}


/**
 * deck 级参考主色护栏：判断两个 hex 主色是否「一致/相近」（RGB 欧氏距离阈值内）。
 * 用于避免把单一分类的偶然主色（如 summary 抽到的粉色）误判为 deck 级主色。
 */
export const COLOR_CLOSE_THRESHOLD = 48; // 近似主色判定阈值（RGB 欧氏距离，理论最大 ~441）


export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}


export function colorDistance(a: string, b: string): number {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
}


/**
 * 在候选主色中找出「被至少两个分类认可（彼此近似）」的众数颜色，作为 deck 级主色。
 * - 仅当 ≥2 个分类给出一致/相近主色时才返回（取彼此近似的众数，content > cover > summary 优先级）。
 * - 无任何多数共识（各分类主色互不一致）时返回 undefined。
 */
export function mostConsistentColor(colors: string[]): string | undefined {
  let best: string | undefined;
  let bestCount = 0;
  for (const c of colors) {
    let count = 0;
    for (const other of colors) {
      if (colorDistance(c, other) <= COLOR_CLOSE_THRESHOLD) count++;
    }
    if (count > bestCount) {
      bestCount = count;
      best = c;
    }
  }
  return bestCount >= 2 ? best : undefined;
}


/**
 * FR-4 四级查找链取「某页」的参考主色：分类 → 全局。
 * 无参考 / 该分类未上传 / 主色非法时返回 undefined（调用方回退原逻辑，向后兼容）。
 * 与内容阶段 formatReferenceOverrideForPage 的逐页覆盖语义一致，供终局防线 / VLM triage / 规划阶段
 * 在调用侧前置裁决参考主色，避免参考红被默认蓝 #2563eb 覆盖。
 */
export function resolveReferencePrimaryColor(
  attrs: ReferenceVisualAttributes | null | undefined,
  pageType: string,
): string | undefined {
  if (!attrs) return undefined;
  const cat = pageTypeToCategory(pageType);
  const cr = attrs.byCategory?.[cat];
  const candidate =
    cr?.uploaded && cr.style?.primaryColor
      ? cr.style.primaryColor
      : attrs.global?.uploaded && attrs.global.style?.primaryColor
        ? attrs.global.style.primaryColor
        : undefined;
  return candidate && HEX_RE.test(candidate) ? candidate.toLowerCase() : undefined;
}


/**
 * deck 级参考主色代表（供全 deck 兜底 / 主管线单源链使用）。
 *
 * 护栏（修复单分类偶然主色染全 deck）：仅当满足以下任一条件才提升为 deck 级主色，
 * 否则返回 undefined（此时逐页仍由 resolveReferencePrimaryColor 按各自分类取色，
 * 不会把某一分类的偶然值扩散到整 deck）：
 *  1) ≥2 个分类给出一致/相近主色（取彼此近似的众数颜色）；或
 *  2) 唯一主色来源是 content（内容页占多数最具代表性）。
 * 非 content 的单一分类主色（如仅 summary 抽到粉色）不提升为 deck 级，避免覆盖
 * 用户显式主题；若用户另有显式 global 主色则退化使用它。
 * 无任何分类主色时退化到 global（与改造前一致）。无参考 / 全非法时返回 undefined。
 */
export function resolveDeckReferencePrimaryColor(
  attrs: ReferenceVisualAttributes | null | undefined,
): string | undefined {
  if (!attrs) return undefined;
  const orderedCats: PageCategory[] = ['content', 'cover', 'summary'];
  const catEntries = orderedCats
    .map((cat) => {
      const c = attrs.byCategory?.[cat];
      const color =
        c?.uploaded && c.style?.primaryColor && HEX_RE.test(c.style.primaryColor)
          ? c.style.primaryColor.toLowerCase()
          : undefined;
      return { cat, color };
    })
    .filter((e): e is { cat: PageCategory; color: string } => !!e.color);

  const globalColor =
    attrs.global?.uploaded &&
    attrs.global.style?.primaryColor &&
    HEX_RE.test(attrs.global.style.primaryColor)
      ? attrs.global.style.primaryColor.toLowerCase()
      : undefined;

  if (catEntries.length === 0) {
    return globalColor; // 无分类主色 → 退化到 global（与改造前一致）
  }
  if (catEntries.length === 1) {
    // 单一分类主色：仅 content 具代表性可提升为 deck 级；非 content（如仅 summary）
    // 不提升，避免单一偶然值染全 deck；用户另有显式 global 主色则退用它。
    const entry = catEntries[0];
    return entry.cat === 'content' ? entry.color : (globalColor ?? undefined);
  }
  // ≥2 个分类有主色：需一致/相近才提升，取众数颜色；否则不提升。
  return mostConsistentColor(catEntries.map((e) => e.color)) ?? undefined;
}


/**
 * 终局逐页主色三级链：页面分类参考主色 → deck 级参考主色 → fallback。
 * - 用于写盘前 finalGuard 逐页取色（ai.service postProcessPresentation）：某分类参考图缺失
 *   （或 VLM 未抽出主色）且 global 也无主色时，不再回落设计默认蓝 #2563eb，而是取 deck 级
 *   参考红（content → cover → summary → global 首个合法值），避免部分页面被染成默认蓝。
 * - 不改动 resolveEffectivePrimaryColor 的 5 级优先级本身（primary-color.test.ts 已锁定），
 *   只在调用侧插入 deck 级这一层。
 * - 向后兼容：attrs 为 undefined 时前两级均返回 undefined，结果等于 fallback（与改造前逐字节一致）。
 */
export function resolveFinalPagePrimaryColor(
  attrs: ReferenceVisualAttributes | null | undefined,
  pageType: string,
  fallback: string,
): string {
  const pageRef = resolveReferencePrimaryColor(attrs, pageType);
  if (pageRef) return pageRef;
  const deckRef = resolveDeckReferencePrimaryColor(attrs);
  if (deckRef) return deckRef;
  return fallback;
}


/**
 * 按页解析「配色策略」，作为后处理链（`detectHarmonizedPalette` / `sanitizeGradientColors`
 * / `enforceSinglePalette` / `enforceHeadingColorOnLightBg`）的唯一颜色真源。
 * 把参考文件提取的撞色调色板、标题色、正文色、描边色作为显式白名单，使参考风格 1:1 保真，
 * 同时不破坏"真脏色页"的全局单色系红线治理。
 */
export function resolveColorPolicyForPage(
  attrs: ReferenceVisualAttributes | undefined,
  pageType: string | undefined,
  primaryColor: string,
  primaryColorDarker: string,
): SlideColorPolicy {
  const fallback: SlideColorPolicy = {
    primary: (primaryColor || '#2563eb').toLowerCase(),
    primaryDarker: (primaryColorDarker || primaryColor || '#1d4ed8').toLowerCase(),
    accents: [],
    isMultiColor: false,
  };
  if (!attrs) return fallback;
  const cat = pageTypeToCategory(pageType ?? '');
  const titleColor = resolveAttrForPage('titleColor', attrs, cat, undefined) as string | undefined;
  const bodyColor = resolveAttrForPage('bodyColor', attrs, cat, undefined) as string | undefined;
  const palette = getReferencePaletteForPage(attrs, pageType ?? '');
  const accents = (palette?.accents || []).map((c) => c.toLowerCase());
  const strokeColor = palette?.strokeColor ? palette.strokeColor.toLowerCase() : undefined;
  return {
    primary: fallback.primary,
    primaryDarker: fallback.primaryDarker,
    titleColor: titleColor ? titleColor.toLowerCase() : undefined,
    bodyColor: bodyColor ? bodyColor.toLowerCase() : undefined,
    accents,
    strokeColor,
    isMultiColor: accents.length > 0,
  };
}


/**
 * 有参考撞色时，产出「豁免单色系红线」的策略文案；无撞色（单色/无参考）返回 ''（红线保持原样）。
 * 这是「有参考时豁免单色系红线」的唯一开关信号。
 */
export function getReferenceColorPolicyForPage(
  attrs: ReferenceVisualAttributes,
  pageType: string,
): string {
  const palette = getReferencePaletteForPage(attrs, pageType);
  if (!palette || !palette.isMultiColor || palette.accents.length === 0) return '';
  const accents = palette.accents.map((c) => c.toUpperCase()).join('、');
  const stroke = palette.strokeColor ? `，粗描边可使用 ${palette.strokeColor.toUpperCase()}` : '';
  return (
    `【参考克隆 · 色彩红线豁免】检测到参考文件使用多色调色板（撞色），本页允许在参考主色 ${palette.primary.toUpperCase()} 之外，使用以下 accent 色：${accents}${stroke}。` +
    `这些 accent 色视为参考风格的一部分，不计入「单色系红线」的违规；其余装饰仍优先使用主色系。除参考调色板外，禁止引入其他未列明的色值。`
  );
}

export function resolveAttrForPage<K extends keyof ReferenceStyleAttrs>(
  attr: K,
  attrs: ReferenceVisualAttributes,
  pageCategory: PageCategory,
  userValue?: ReferenceStyleAttrs[K],
  defaultValue?: ReferenceStyleAttrs[K],
): ReferenceStyleAttrs[K] {
  const cat = attrs.byCategory[pageCategory];
  if (cat?.uploaded && cat.style[attr] !== undefined) {
    return cat.style[attr];
  }
  if (attrs.global.uploaded && attrs.global.style[attr] !== undefined) {
    return attrs.global.style[attr];
  }
  if (userValue !== undefined) return userValue;
  return defaultValue as ReferenceStyleAttrs[K];
}


export function getReferencePaletteForPage(
  attrs: ReferenceVisualAttributes,
  pageType: string,
): ReferencePalette | undefined {
  const cat = pageTypeToCategory(pageType);
  const cr = attrs.byCategory[cat];
  return (
    (cr?.uploaded && cr.palette) || (attrs.global.uploaded && attrs.global.palette) || undefined
  );
}

/** 规划阶段的骨架片段（拼接各分类，供全局规划 prompt 注入）。 */
