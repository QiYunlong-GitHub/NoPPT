import type {
  SlidePlan,
  SlidePageType,
  ImagePreference,
  ContentDensity,
  IconStyle,
  ColorTheme,
  ReferenceVisualAttributes,
  ReferencePageHints,
} from '../../types';
import {
  COLOR_THEMES,
  PageStructureHints,
  deriveStructureFlags,
  darkenColor,
  defaultRatioForImageTop,
} from './shared';
import {
  hasReferenceImage,
  resolveHeroImageForPage,
  pageTypeToCategory,
  resolveAttrForPage,
} from '../../utils/reference-attribute-resolver';


const SUPPLEMENT_TITLE_POOL = [
  '深入分析与洞察',
  '关键实施路径',
  '典型案例参考',
  '常见问题与建议',
  '未来发展展望',
  '核心要点总结',
  '对比分析',
  '数据与指标',
  '落地策略',
  '风险与注意事项',
];

export function getPrimaryColor(style?: string, colorTheme?: ColorTheme, primaryColor?: string): string {
  if (primaryColor && /^#[0-9a-fA-F]{6}$/.test(primaryColor)) return primaryColor;
  if (colorTheme && COLOR_THEMES[colorTheme]) return COLOR_THEMES[colorTheme];
  if (style && COLOR_THEMES[style]) return COLOR_THEMES[style];
  return '#2563eb';
}

export function clampSlidesToCount(
  slides: SlidePlan[],
  target: number,
  hints: PageStructureHints = {
    contentOnly: false,
    disableCover: false,
    disableToc: false,
    disableConclusion: false,
  },
  imagePreference: ImagePreference = 'content-only',
): SlidePlan[] {
  if (!Array.isArray(slides)) slides = [];
  const n = slides.length;
  if (n === target && target > 0) return slides;
  if (target <= 0) target = 1;
  const flags = deriveStructureFlags(target, hints);
  // 内容页补位辅助：按 imagePreference 决定补位 slide 默认带图还是纯文字
  const buildSupplementSlide = (
    title: string,
    cursor: number,
    _asStructure = false,
  ): SlidePlan => {
    const keyPoints = ['核心要点展开分析', '相关数据支撑', '落地建议与参考'].slice(
      0,
      4 - (cursor % 3),
    );
    if (imagePreference === 'none' || imagePreference === 'minimal') {
      return { pageType: 'content-no-image', title, keyPoints, needsImage: false };
    }
    // all / content-only：补位用带图布局
    return {
      pageType: 'content-image-left',
      title,
      keyPoints,
      needsImage: true,
      imageRatio: '4:3',
    };
  };
  // 结构页降级转内容辅助
  const downgradeStructureToContent = (s: SlidePlan): SlidePlan => {
    if (imagePreference === 'none' || imagePreference === 'minimal') {
      return { ...s, pageType: 'content-no-image', needsImage: false };
    }
    return {
      ...s,
      pageType: 'content-image-left',
      needsImage: true,
      imageRatio: s.imageRatio || '4:3',
    };
  };
  // cover/toc/summary 结构页默认生成：imagePreference=all 时需要配图
  const buildDefaultStructure = (
    pageType: 'cover' | 'toc' | 'summary',
    title: string,
  ): SlidePlan => {
    if (imagePreference === 'all') {
      return {
        pageType,
        title,
        keyPoints: [],
        needsImage: true,
        imageRatio: '16:9',
        imagePrompt: `与演示主题协调的高品质专业背景插画，画面主体靠边留出文字区域，色彩沉稳克制`,
      };
    }
    return { pageType, title, keyPoints: [], needsImage: false };
  };

  // 先把 slides 中识别出结构页的位置信息：cover/toc/conclusion 各挑一个代表
  const identifyCover = (s: SlidePlan) =>
    s.pageType === 'cover' ||
    /封面|title|开始|cover/i.test(s.title || '') ||
    /封面|开篇|首页/.test(s.pageType || '');
  const identifyToc = (s: SlidePlan) =>
    s.pageType === 'toc' ||
    /目录|大纲|table\s*of\s*contents|contents/i.test(s.title || '') ||
    /toc|目录|outline/.test(s.pageType || '');
  const identifyConclusion = (s: SlidePlan) =>
    s.pageType === 'summary' ||
    /总结|致谢|结束|谢谢|展望|结语|最后|感谢观看|Q&A|问答/i.test(s.title || '');

  if (n > target) {
    // 裁剪：先根据 flags 把要的结构页标记出来，内容页从前往后保留
    const result: SlidePlan[] = [];
    // 先取 cover（如果 wantCover 且存在于 slides 的前 1/3）
    let coverIdx = -1;
    let tocIdx = -1;
    let conclusionIdx = -1;
    // cover 判定范围：前 ceil(n/3) 页里找第一个
    for (let i = 0; i < Math.min(Math.ceil(n / 3), n); i++) {
      if (identifyCover(slides[i])) {
        coverIdx = i;
        break;
      }
    }
    // toc：前半部分（不含 cover）找一个
    for (let i = 0; i < Math.floor(n * 0.5); i++) {
      if (i === coverIdx) continue;
      if (identifyToc(slides[i])) {
        tocIdx = i;
        break;
      }
    }
    // conclusion：后 1/3 里找
    for (let i = Math.max(0, n - Math.ceil(n / 3)); i < n; i++) {
      if (identifyConclusion(slides[i])) {
        conclusionIdx = i;
        break;
      }
    }
    // 如果 wantCover=true 但没识别到 cover，则把第一页当作 cover
    if (flags.wantCover && coverIdx === -1 && n > 0) coverIdx = 0;
    // wantConclusion=true 但没识别到，则把最后一页当作 conclusion
    if (flags.wantConclusion && conclusionIdx === -1 && n > 0) conclusionIdx = n - 1;
    // wantToc=true 没识别到就算了，后面 enforcePageStructure 会补齐

    // 按顺序保留（cover 最前 / toc 其次 / conclusion 最后），中间内容页按原顺序，不重复
    const used = new Set<number>();
    if (flags.wantCover && coverIdx !== -1) {
      result.push(slides[coverIdx]);
      used.add(coverIdx);
    }
    if (flags.wantToc && tocIdx !== -1 && !used.has(tocIdx)) {
      result.push(slides[tocIdx]);
      used.add(tocIdx);
    }
    // 中间内容页：从前往后填，跳过已用和结论
    for (
      let i = 0;
      i < n && result.length < target - (flags.wantConclusion && conclusionIdx !== -1 ? 1 : 0);
      i++
    ) {
      if (used.has(i)) continue;
      if (flags.wantConclusion && i === conclusionIdx) continue;
      if (!flags.wantToc && identifyToc(slides[i])) continue; // 明确不要目录则跳过
      if (!flags.wantConclusion && identifyConclusion(slides[i]) && i !== conclusionIdx) continue;
      if (!flags.wantCover && identifyCover(slides[i])) continue;
      result.push(slides[i]);
    }
    if (
      flags.wantConclusion &&
      conclusionIdx !== -1 &&
      !used.has(conclusionIdx) &&
      result.length < target
    ) {
      result.push(slides[conclusionIdx]);
    }
    // 再多退少补（因为可能结构页不够 or 过多）
    if (result.length > target) return result.slice(0, target);
    if (result.length < target) {
      // 内容页补空位
      let cursor = 0;
      while (result.length < target) {
        const title = SUPPLEMENT_TITLE_POOL[cursor % SUPPLEMENT_TITLE_POOL.length];
        cursor++;
        result.push(buildSupplementSlide(title, cursor));
      }
    }
    return result.slice(0, target);
  }

  // 补足：target > n
  // 先从 slides 中剥离 cover / toc / conclusion 三类结构页（用 identify*）
  const coverList: SlidePlan[] = [];
  const tocList: SlidePlan[] = [];
  const conclusionList: SlidePlan[] = [];
  const contentList: SlidePlan[] = [];
  for (const s of slides) {
    if (identifyConclusion(s)) conclusionList.push(s);
    else if (identifyToc(s)) tocList.push(s);
    else if (identifyCover(s)) coverList.push(s);
    else contentList.push(s);
  }
  // 根据 flags 选择保留的结构页（各最多 1 个）
  const finalCover = flags.wantCover
    ? (coverList[0] ?? buildDefaultStructure('cover', '演示封面'))
    : null;
  const finalToc = flags.wantToc ? (tocList[0] ?? buildDefaultStructure('toc', '目录')) : null;
  const finalConclusion = flags.wantConclusion
    ? (conclusionList[conclusionList.length - 1] ?? buildDefaultStructure('summary', '总结'))
    : null;

  const structureCount = (finalCover ? 1 : 0) + (finalToc ? 1 : 0) + (finalConclusion ? 1 : 0);
  const needContent = Math.max(0, target - structureCount);
  // 内容页补足：优先原有 contentList → 原有 coverList/tocList/conclusionList 被 flags 放弃的（转成内容）→ 再用 SUPPLEMENT 池补
  const finalContents: SlidePlan[] = [];
  for (const s of contentList) finalContents.push(s);
  if (!flags.wantCover)
    for (const s of coverList) finalContents.push(downgradeStructureToContent(s));
  if (!flags.wantToc) for (const s of tocList) finalContents.push(downgradeStructureToContent(s));
  if (!flags.wantConclusion)
    for (const s of conclusionList) finalContents.push(downgradeStructureToContent(s));
  let cursor = 0;
  while (finalContents.length < needContent) {
    const title = SUPPLEMENT_TITLE_POOL[cursor % SUPPLEMENT_TITLE_POOL.length];
    cursor++;
    finalContents.push(buildSupplementSlide(title, cursor));
  }
  // 拼接：cover → toc → contents → conclusion
  const result: SlidePlan[] = [];
  if (finalCover) result.push(finalCover);
  if (finalToc) result.push(finalToc);
  for (const c of finalContents.slice(0, needContent)) result.push(c);
  if (finalConclusion) result.push(finalConclusion);
  return result.slice(0, target);
}

/**
 * 强制对齐页结构：根据页数策略 + 用户显式禁用指令，确保封面/目录/总结正确存在或不存在。
 * 在 clampSlidesToCount 之后再跑一次，处理大模型可能生成错位（如把封面当内容、toc 放到末尾等）。
 */

export function enforcePageStructure(
  slides: SlidePlan[],
  target: number,
  hints: PageStructureHints = {
    contentOnly: false,
    disableCover: false,
    disableToc: false,
    disableConclusion: false,
  },
  imagePreference: ImagePreference = 'content-only',
): SlidePlan[] {
  // 辅助函数（与 clampSlidesToCount 中同名函数逻辑一致）
  const buildSupplementSlide = (title: string, cursor: number): SlidePlan => {
    const keyPoints = ['核心要点展开分析', '相关数据支撑', '落地建议与参考'].slice(
      0,
      4 - (cursor % 3),
    );
    if (imagePreference === 'none' || imagePreference === 'minimal') {
      return { pageType: 'content-no-image', title, keyPoints, needsImage: false };
    }
    return {
      pageType: 'content-image-left',
      title,
      keyPoints,
      needsImage: true,
      imageRatio: '4:3',
    };
  };
  const downgradeStructureToContent = (s: SlidePlan): SlidePlan => {
    if (imagePreference === 'none' || imagePreference === 'minimal') {
      return { ...s, pageType: 'content-no-image', needsImage: false };
    }
    return {
      ...s,
      pageType: 'content-image-left',
      needsImage: true,
      imageRatio: s.imageRatio || '4:3',
    };
  };
  const buildDefaultStructure = (
    pageType: 'cover' | 'toc' | 'summary',
    title: string,
  ): SlidePlan => {
    if (imagePreference === 'all') {
      return {
        pageType,
        title,
        keyPoints: [],
        needsImage: true,
        imageRatio: '16:9',
        imagePrompt: `与演示主题协调的高品质专业背景插画，画面主体靠边留出文字区域，色彩沉稳克制`,
      };
    }
    return { pageType, title, keyPoints: [], needsImage: false };
  };

  if (!Array.isArray(slides) || slides.length === 0) {
    slides = [buildSupplementSlide('内容', 0)];
  }
  const flags = deriveStructureFlags(target, hints);
  const identifyCover = (s: SlidePlan) =>
    s.pageType === 'cover' ||
    /封面|title|开始|cover/i.test(s.title || '') ||
    /封面|开篇|首页/.test(s.pageType || '');
  const identifyToc = (s: SlidePlan) =>
    s.pageType === 'toc' ||
    /目录|大纲|table\s*of\s*contents|contents/i.test(s.title || '') ||
    /toc|目录|outline/.test(s.pageType || '');
  const identifyConclusion = (s: SlidePlan) =>
    s.pageType === 'summary' ||
    /总结|致谢|结束|谢谢|展望|结语|最后|感谢观看|Q&A|问答/i.test(s.title || '');

  // 剥离
  let cover: SlidePlan | null = null;
  let toc: SlidePlan | null = null;
  let conclusion: SlidePlan | null = null;
  const contents: SlidePlan[] = [];
  for (const s of slides) {
    if (!cover && identifyCover(s)) {
      cover = s;
      continue;
    }
    if (!toc && identifyToc(s)) {
      toc = s;
      continue;
    }
    if (!conclusion && identifyConclusion(s)) {
      conclusion = s;
      continue;
    }
    contents.push(s);
  }

  // 如果 hints 明确禁用，就视为不存在结构页（转为内容页）
  if (cover && (flags.wantCover === false || hints.disableCover || hints.contentOnly)) {
    contents.unshift(downgradeStructureToContent(cover));
    cover = null;
  }
  if (toc && (flags.wantToc === false || hints.disableToc || hints.contentOnly)) {
    contents.push(downgradeStructureToContent(toc));
    toc = null;
  }
  if (
    conclusion &&
    (flags.wantConclusion === false || hints.disableConclusion || hints.contentOnly)
  ) {
    contents.push(downgradeStructureToContent(conclusion));
    conclusion = null;
  }

  // 如果需要结构页但还缺，就生成默认的
  if (flags.wantCover && !cover) {
    cover = buildDefaultStructure('cover', '封面');
  }
  if (flags.wantToc && !toc) {
    toc = buildDefaultStructure('toc', '目录');
  }
  if (flags.wantConclusion && !conclusion) {
    conclusion = buildDefaultStructure('summary', '总结');
  }

  const structureCount = (cover ? 1 : 0) + (toc ? 1 : 0) + (conclusion ? 1 : 0);
  const needContent = Math.max(0, target - structureCount);
  // 内容页不足 or 过多：裁剪/补足
  while (contents.length < needContent) {
    const cursor = contents.length;
    const title = SUPPLEMENT_TITLE_POOL[cursor % SUPPLEMENT_TITLE_POOL.length];
    contents.push(buildSupplementSlide(title, cursor));
  }
  const finalContents = contents.slice(0, needContent);
  const result: SlidePlan[] = [];
  if (cover) result.push(cover);
  if (toc) result.push(toc);
  for (const c of finalContents) result.push(c);
  if (conclusion) result.push(conclusion);
  return result.slice(0, target);
}

/**
 * FR-0：参考含图强制插图——规划阶段在 imagePreference 归一化之前插入。
 * 参考属性（参考图含照片/插画，或参考 HTML 含 <img>）优先级高于用户 imagePreference：
 *  - 封面/总结页：挂 referenceHeroImage（落盘后由 master.heroImage 做 CSS 开窗背景），并置 referenceLockedImage 锁；
 *  - 内容页：强制 needsImage=true（FR-15 已按分类取 referenceImageUrl 作 img2img seed），并置锁。
 * 无参考文件（rva 为空）时直接原样返回，向后兼容。
 */

export function applyReferenceImageOverride(
  slides: SlidePlan[],
  rva: ReferenceVisualAttributes | undefined,
): SlidePlan[] {
  if (!rva) return slides;
  return slides.map((s) => {
    if (!hasReferenceImage(rva, s.pageType)) return s;
    const hero = resolveHeroImageForPage(rva, s.pageType);
    const cat = pageTypeToCategory(s.pageType);
    if ((cat === 'cover' || cat === 'summary') && hero) {
      return { ...s, referenceHeroImage: hero, referenceLockedImage: true };
    }
    // 内容页：强制 AI 生图（img2img seed 复用上传的参考原图）
    // 例外：9 种高级精致版式保留大纲自主决策，避免为对比表/时间线等本就不需要图的版式凑图
    // （这些版式由 NEVER_UPGRADE_FOR_IMAGE 统一保护，规划/升级/占位符注入/孤儿救援均不强制带图）。
    const NEVER_UPGRADE_FOR_IMAGE: ReadonlySet<string> = new Set([
      'comparison-deep-dive',
      'content-value-showcase',
      'content-stats-highlight',
      'content-image-background',
      'content-zigzag',
      'content-cards',
      'content-compare',
      'content-timeline',
      'content-table',
    ]);
    if (!NEVER_UPGRADE_FOR_IMAGE.has(s.pageType ?? '')) {
      return {
        ...s,
        needsImage: true,
        referenceLockedImage: true,
        imagePrompt: s.imagePrompt || `${s.title || '内容'}（参考素材风格，沿用上传参考图）`,
      };
    }
    return s; // 9 种高级版式：不强制生图，沿用大纲自主决策
  });
}

/**
 * normalizePlanByImagePreference —— 规划阶段最后一道防线，按用户显式的 imagePreference 强制归一每张 slide 的 needsImage / pageType / imageRatio / 兜底 imagePrompt。
 * 目标：85% 以上场景下，HTML 生成之前 plan.slides 就已经正确，无需走兜底。
 */

export function normalizePlanByImagePreference(
  slides: SlidePlan[],
  imagePreference: ImagePreference,
  topic: string,
  imageOptionsEnabled: boolean = true,
): SlidePlan[] {
  // ================ ★ 关键防御（与 server 层 CONFIG-CONFLICT 双层）★ ================
  // 当 imageOptions.enabled=false 或 imageOptions=undefined（配置开关没开 / 绕过 server 调用），
  // 即使显式传了 imagePreference=all/content-only/minimal，也强制归一到 pref=none，防止
  // plan.slides 里 needsImage=true，但 generateImageImages 阶段 imageProvider 为空 →
  // 出现"NOPPT 占位图保留/无图/异常报错"等各种不一致。
  let effectivePref = imagePreference;
  if (!imageOptionsEnabled) {
    if (imagePreference !== 'none') {
      console.warn(
        `[AGENT] imageOptions.enabled=${imageOptionsEnabled}，但 imagePreference=${imagePreference}，` +
          `强制降级为 pref=none 避免生成 NOPPT 占位图。`,
      );
    }
    effectivePref = 'none';
  }
  // ================ ★ END: 防御性降级 ★ ================
  const isStructureType = (pt: SlidePageType | undefined) =>
    pt === 'cover' || pt === 'toc' || pt === 'summary';
  const buildImagePromptFallback = (title: string) =>
    `${topic} - ${title}，与整体配色协调的高品质专业插画，画面简洁主体靠边留出文字排版空间`;
  return slides.map((s) => {
    // FR-0：参考含图锁——参考属性优先级高于用户 imagePreference，任何 pref 下都不剥离参考图
    if (s.referenceLockedImage) {
      const needs = !!s.needsImage;
      return {
        ...s,
        needsImage: needs,
        imagePrompt:
          s.imagePrompt ?? (needs ? `${s.title || '内容'}（参考素材风格）` : undefined),
        imageRatio:
          s.imageRatio ??
          (needs
            ? s.pageType === 'content-image-top'
              ? defaultRatioForImageTop(s.keyPoints)
              : '4:3'
            : undefined),
      };
    }
    // ———— pref=none：强制删除所有图片相关信息 ————
    if (effectivePref === 'none') {
      const { imageRatio: _ir, imagePrompt: _ip, ...rest } = s;
      let { pageType, needsImage } = rest;
      needsImage = false;
      if (
        pageType &&
        (pageType === 'content-image-left' ||
          pageType === 'content-image-right' ||
          pageType === 'content-image-top')
      ) {
        pageType = 'content-no-image';
      }
      return { ...rest, pageType, needsImage };
    }
    // ———— pref=minimal：仅保留 "LLM明确写了 content-image-* 且 needsImage=true" 的，其余全部 false ————
    if (effectivePref === 'minimal') {
      const isImageType =
        s.pageType === 'content-image-left' ||
        s.pageType === 'content-image-right' ||
        s.pageType === 'content-image-top';
      if (isImageType && s.needsImage) {
        return {
          ...s,
          imageRatio:
            s.imageRatio ||
            (s.pageType === 'content-image-top' ? defaultRatioForImageTop(s.keyPoints) : '4:3'),
          imagePrompt: s.imagePrompt || buildImagePromptFallback(s.title || '内容'),
        };
      }
      const { imageRatio: _ir, imagePrompt: _ip, ...rest } = s;
      return { ...rest, needsImage: false };
    }
    // ———— pref=all / content-only：强制带图 ————
    let { pageType, needsImage, imageRatio, imagePrompt, keyPoints = [] } = s;
    const isStructure = isStructureType(pageType);
    // ——— FR-1 (fix-slide-comparison-image-disaster)：L1 高级版式保持规划快照原样，不走强制带图升级 ———
    const NEVER_UPGRADE_FOR_IMAGE: ReadonlySet<string> = new Set([
      'comparison-deep-dive',
      'content-value-showcase',
      'content-stats-highlight',
      'content-image-background',
      'content-zigzag',
      'content-cards',
      'content-compare',
      'content-timeline',
      'content-table',
    ]);
    const protectedLayout = NEVER_UPGRADE_FOR_IMAGE.has(pageType);
    if (!protectedLayout && (effectivePref === 'all' || !isStructure)) {
      needsImage = true;
      // pageType 升级：所有纯文字/密集型布局统一升级为带图 left
      if (!isStructure) {
        const shouldUpgradeToImageType =
          pageType === 'content-no-image' || pageType === 'content-table';
        if (shouldUpgradeToImageType && keyPoints.length >= 1) {
          pageType = 'content-image-left';
        }
      }
      // imageRatio：给一个合理的默认；上图下文按 keyPoints 数量自动选择更扁的比例防溢出
      if (!imageRatio) {
        if (pageType === 'content-image-top') imageRatio = defaultRatioForImageTop(keyPoints);
        else if (isStructure) imageRatio = '16:9';
        else imageRatio = '4:3';
      }
      // imagePrompt 兜底
      if (!imagePrompt) {
        imagePrompt = buildImagePromptFallback(s.title || '内容');
      }
    } else {
      // content-only 下 cover/toc/summary：保持 needsImage=false（与"仅内容页配图"一致）
      needsImage = false;
    }
    return { ...s, pageType, needsImage, imageRatio, imagePrompt, keyPoints };
  });
}


export function resolvePageReferenceStyleAttrs(
  slidePlan: SlidePlan,
  rva: ReferenceVisualAttributes | undefined,
  base: {
    primaryColor: string;
    fontFamily: 'sans' | 'serif' | 'mono';
    iconStyle: IconStyle;
    style: string;
    density: ContentDensity;
    imagePreference?: ImagePreference;
    backgroundEnabled?: boolean;
    pageHints?: ReferencePageHints;
    slideCount?: number;
  },
): {
  primaryColor: string;
  primaryColorDarker: string;
  fontFamily: 'sans' | 'serif' | 'mono';
  iconStyle: IconStyle;
  style: string;
  density: ContentDensity;
  imagePreference: ImagePreference;
  backgroundEnabled: boolean;
  pageHints?: ReferencePageHints;
  slideCount?: number;
} {
  const DEF = {
    primaryColor: '#2563eb',
    fontFamily: 'sans' as 'sans' | 'serif' | 'mono',
    iconStyle: 'auto' as IconStyle,
    style: 'business' as string,
    density: 'normal' as ContentDensity,
    imagePreference: 'content-only' as ImagePreference,
    backgroundEnabled: false as boolean,
  };
  if (!rva) {
    return {
      primaryColor: base.primaryColor,
      primaryColorDarker: darkenColor(base.primaryColor, 20),
      fontFamily: base.fontFamily,
      iconStyle: base.iconStyle,
      style: base.style,
      density: base.density,
      imagePreference: base.imagePreference ?? DEF.imagePreference,
      backgroundEnabled: base.backgroundEnabled ?? DEF.backgroundEnabled,
      pageHints: base.pageHints,
      slideCount: base.slideCount,
    };
  }
  const cat = pageTypeToCategory(slidePlan.pageType);
  const primaryColor =
    resolveAttrForPage('primaryColor', rva, cat, base.primaryColor, DEF.primaryColor) ??
    base.primaryColor;
  const density =
    resolveAttrForPage('contentDensity', rva, cat, base.density, DEF.density) ?? base.density;
  const iconStyle =
    resolveAttrForPage('iconStyle', rva, cat, base.iconStyle, DEF.iconStyle) ?? base.iconStyle;
  const fontFamily =
    resolveAttrForPage('fontFamily', rva, cat, base.fontFamily, DEF.fontFamily) ??
    base.fontFamily;
  const style = resolveAttrForPage('style', rva, cat, base.style, DEF.style) ?? base.style;
  const imagePreference =
    resolveAttrForPage(
      'imagePreference',
      rva,
      cat,
      base.imagePreference ?? DEF.imagePreference,
      DEF.imagePreference,
    ) ?? DEF.imagePreference;
  // 语义拆分（根治）：渲染链路中的 backgroundEnabled 仅代表用户「自动生成背景图」开关
  // （来自 base / UserSettings，即 01-request-config.json 的 backgroundEnabled）。
  // 它**不继承**参考图解析出的 style.backgroundEnabled——后者仅描述「参考图/HTML 是否自带背景」，
  // 属于版面风格属性，曾被 resolveAttrForPage 的「参考优先」误取，导致参考图「有背景」反手否决自身 hero 注入。
  // 故此处直接取用户值，跳过 resolveAttrForPage，确保两个语义彻底分离。
  const backgroundEnabled = base.backgroundEnabled ?? DEF.backgroundEnabled;
  const pageHints = resolveAttrForPage('pageHints', rva, cat, base.pageHints, undefined);
  const slideCount = resolveAttrForPage('slideCount', rva, cat, base.slideCount, undefined);
  return {
    primaryColor,
    primaryColorDarker: darkenColor(primaryColor, 20),
    fontFamily,
    iconStyle,
    style,
    density,
    imagePreference,
    backgroundEnabled,
    pageHints,
    slideCount,
  };
}

/**
 * L0 定量硬校验接入（Task5 / FR-4 底线）：将 l0ValidateSlide 的违规项并入 critique 结果。
 * - 致命项（如正文字号 < 12px）直接判不通过（passed=false），从而触发 critique 重试循环重新生成。
 * - 重要项（如对比度 < 4.5:1）作为 issue 记录，但不强制否决。
 * 该函数就地修改 critique 对象，调用时机应在每次 critiqueSlide 返回后。
 */

export function detectComparisonIntent(topic: string): { isComparison: boolean; triggerWords: string[] } {
  const text = topic.trim().toLowerCase();
  const triggers: Array<{ word: string; re: RegExp }> = [
    // 第 1 组：强对比词（100% 命中）
    { word: '深度对比', re: /深度\s*对比/ },
    { word: '全面对比', re: /全面\s*对比/ },
    { word: '参数对比', re: /参数\s*对比/ },
    { word: '性能对比', re: /性能\s*对比/ },
    { word: '功能对比', re: /功能\s*对比/ },
    { word: '规格对比', re: /规格\s*对比/ },
    { word: '差异对比', re: /差异\s*对比/ },
    { word: '横向对比', re: /横向\s*对比/ },
    { word: '纵向对比', re: /纵向\s*对比/ },
    { word: '竞品对比', re: /竞品\s*对比/ },
    { word: '方案对比', re: /方案\s*对比/ },
    { word: '对比分析', re: /对比\s*分析/ },
    { word: '新旧方案', re: /新旧\s*方案/ },
    { word: '升级前后', re: /升级\s*前后/ },
    { word: 'before&after', re: /before\s*[&\-]\s*after/ },
    { word: '优势劣势', re: /优势\s*劣势|优\s*劣\s*势|优缺点/ },
    { word: '评测', re: /评测/ },
    { word: '测评', re: /测评/ },
    { word: '横评', re: /横评/ },
    { word: 'A/B对比', re: /a\s*\/?\s*b\s*(测试|对比|实验)/ },
    // 第 2 组：通用核心字（需避免"对比"被"对比色""对比度"这类无关词命中 → 后面不含"色""度"）
    { word: '对比', re: /对比(?![色度])/ },
    { word: 'PK', re: /\bpk\b/ },
    { word: 'vs', re: /\bvs\.?\b|[vs]\s[vs]\s/ }, // "A vs B" / "A vs. B"
    { word: 'benchmark', re: /\bbenchmark(ing)?\b/ },
    // 第 3 组：典型二分式结构 "X 和 Y 比较/评测"
    {
      word: 'X和Y比较',
      re: /(.+?)(和|跟|与|同|vs\.?|pk)\s*(.+?)(做|做一个|做个|做一次|进行)?\s*(深度|全面|详细)?\s*(对比|比较|评测|测评|横评|pk)/,
    },
  ];
  const hits: string[] = [];
  for (const t of triggers) if (t.re.test(text)) hits.push(t.word);
  return { isComparison: hits.length >= 1, triggerWords: Array.from(new Set(hits)) };
}

export function autoCompleteComparisonPage<
  T extends {
    pageType: string;
    keyPoints?: unknown[] | string;
    styleTheme?: unknown;
    layoutParams?: unknown;
    metricValues?: unknown;
    advantageIndices?: unknown;
    needsImage?: unknown;
  },
>(page: T): T {
  const kps = Array.isArray(page.keyPoints) ? page.keyPoints : [];
  const N = Math.min(5, Math.max(3, kps.length || 4)); // 默认 4 项，最少 3，最多 5
  // metricValues 预设：有层次感（非全同），默认值 92/78/86/95/89，取前 N 个
  const defaultMetrics: number[] = [92, 78, 86, 95, 89].slice(0, N);
  const rawMetrics: unknown = (page as any).metricValues;
  const metrics: number[] = (
    Array.isArray(rawMetrics) && rawMetrics.length >= N
      ? rawMetrics.map((x) => (typeof x === 'number' ? x : parseInt(String(x), 10) || 0))
      : defaultMetrics
  ) as number[];
  // advantageIndices：挑 >= 85 的索引；若一个都没有就 [0]
  const rawAdv: unknown = (page as any).advantageIndices;
  let advIdx: number[];
  if (Array.isArray(rawAdv) && rawAdv.length > 0) {
    advIdx = rawAdv
      .map((x) => (typeof x === 'number' ? x : parseInt(String(x), 10) || -1))
      .filter((x: number) => Number.isFinite(x));
  } else {
    advIdx = metrics
      .map((v: number, i: number) => (v >= 85 ? i : -1))
      .filter((i: number) => i >= 0);
  }
  if (advIdx.length === 0) advIdx = [0];
  // layoutParams 补齐（合并现有不覆盖）
  const baseLP = {
    titlePosition: 'top' as const,
    contentDirection: 'row' as const,
    imageAnchor: 'none' as const,
    cardShape: 'rounded' as const,
    contentAlignment: 'left' as const,
    gridCols: 2 as const,
  };
  const lp =
    typeof page.layoutParams === 'object' && page.layoutParams !== null
      ? { ...baseLP, ...(page.layoutParams as any) }
      : baseLP;

  return {
    ...page,
    pageType: 'comparison-deep-dive',
    styleTheme:
      page.styleTheme && typeof page.styleTheme === 'string' && page.styleTheme !== 'none'
        ? page.styleTheme
        : 'mixed',
    layoutParams: lp,
    metricValues: metrics,
    advantageIndices: Array.from(new Set<number>(advIdx)).filter(
      (i: number) => i >= 0 && i < metrics.length,
    ),
    needsImage: false,
  } as any;
}

// ================================================================
// U-17 · 规划阶段主色单源公式（纯函数）
// 与 generatePlan() 内部 U-17 强制覆盖逻辑完全对齐：
//   ① 用户显式选了 colorTheme → primaryColor 必须 = COLOR_THEMES[colorTheme]
//   ② colorTheme=自动（未显式）→ 必须等于按 style 自动匹配的 hex（business→#2563eb 等）
//   ③ 否则：用传入 primaryColor（合法 6 位 hex），仍无效则 fallback #2563eb
// 用法：在进入 LLM 之前预计算最终主色，确保
//   buildPlanningPrompt / user message / U-17 强制覆盖 三处使用同一个值，
//   彻底消除 LLM 输入中的 primaryColor 指令冲突（用户报告 bug）。
// ================================================================
export function computeU17EffectivePrimaryColor(
  style: string,
  colorTheme: ColorTheme | undefined,
  primaryColor: string,
): string {
  const forced =
    colorTheme && COLOR_THEMES[colorTheme]
      ? COLOR_THEMES[colorTheme]
      : COLOR_THEMES[style] || primaryColor || '#2563eb';
  // 兜底：若走到 || primaryColor 分支但其值非法 → 返回默认蓝
  return /^#[0-9a-fA-F]{6}$/.test(forced) ? forced : '#2563eb';
}
