/**
 * PostProcess 簇A-布局：postProcessLayout 与外层容器 / 图片包裹 / 对齐 / 列表 / 清空等兜底（从 html-presentation-agent.ts 外置）。
 */

import type { SlideColorPolicy, SlidePageType } from '../../../types';
import { applyCompositionGuard, cleanupEmptyInlineTags, enforceFlatStructure, enforceFlexChildrenMinWidth, enforceGridLayout, enforceImageStyles, enforceMinFontSize, enforceTextWrapping, fixGradientTextDeclarationOrder, isCoverLikeHtml, parseStyleDeclarations, type ReferenceComposition } from '@noppt/core';
import { darkenPrimaryColor, normalizeHex } from './color';
import { fixVerticalWritingLists, removeColorCodeWatermark } from './dom';
import { enforceDarkBgTextContrast, enforceFinalTextContrast, enforceHeadingColorOnLightBg, enforceLightBgTextContrast } from './contrast';
import { enforceCardTextProportion, enforceCoverPosterArtStyles, enforceLeftRight5545AndCardBar } from './cover';
import { enforceBodyFontSize } from './font-size';
import { getFontStack, isPlaceholderFontFamily } from './font-stack';

// 图片容器/包裹/比例三块已外置到 ./image-container，此处导入 + 再导出保持对外签名不变
import { enforceImageContainerStyles } from './image-container';
export { enforceImageContainerStyles, ensureImageProperWrapper, ensureImageRatio } from './image-container';

export function postProcessLayout(
  html: string,
  _pageType?: SlidePageType,
  slideWidth: number = 1280,
  slideHeight: number = 720,
  primaryColor: string = '#2563eb',
  fontFamily?: 'sans' | 'serif' | 'mono',
  titleColor?: string,
  colorPolicy?: SlideColorPolicy,
  composition?: ReferenceComposition,
): string {
  // —— Fix C (vitest FAIL 修复)：当调用方未显式传 fontFamily，则按 _pageType 推导默认字体家族。
  //    代码密集型版式：summary（归纳摘要页典型等宽字摘要表）/ content-table（数据表格页横向对齐数值）默认走 mono，
  //    与 LLM 为这些 layout 写出的 JetBrains Mono 老占位保持同方向，避免默认 sans 把老遗留 mono 占位跨家族升级。
  if (!fontFamily) {
    fontFamily = _pageType === 'summary' || _pageType === 'content-table' ? 'mono' : 'sans';
  }
  let result = html;
  // 参考撞色板 / 标题色 / 正文色 / 描边色作为显式白名单：对比度兜底时豁免这些参考色，
  // 避免「参考克隆·撞色保真」被终局对比度重写（#118ab2 等参考色被改写成 #111827）。
  const refColorSet = new Set<string>();
  if (colorPolicy) {
    for (const c of [
      colorPolicy.titleColor,
      colorPolicy.bodyColor,
      colorPolicy.strokeColor,
      ...colorPolicy.accents,
    ]) {
      if (c) refColorSet.add(normalizeHex(c) || c.toLowerCase());
    }
  }
  // 主色 / 深色变体也纳入豁免：避免终局对比度把参考 accent 高亮（如 #ff4d6d）误改写成 #111827
  for (const c of [primaryColor, darkenPrimaryColor(primaryColor, 0.75)]) {
    if (c) refColorSet.add(normalizeHex(c) || c.toLowerCase());
  }
  result = result.replace(/<script[\s\S]*?<\/script>/gi, '');
  result = result.replace(/<style[\s\S]*?<\/style>/gi, '');
  result = result.replace(/on\w+="[^"]*"/gi, '');
  result = result.replace(/on\w+='[^']*'/gi, '');
  result = ensureOuterContainer(result, slideWidth, slideHeight, fontFamily);
  result = enforceFlatStructure(result);
  result = enforceImageContainerStyles(result);
  result = enforceImageStyles(result, { borderRadius: '12px', addDataImageRatio: true });
  result = enforceFlexChildrenMinWidth(result);
  result = enforceTextWrapping(result);
  // 渐变文字顺序修复：black-block 防御（background 简写覆盖 clip → 黑块 + 透明字）
  result = fixGradientTextDeclarationOrder(result, {
    titleColor,
    primaryColor,
    allowedAccents: colorPolicy?.accents,
    backgroundTone: 'light',
  });
  result = enforceTextContainerStyles(result);
  result = enforceStretchAlignment(result);
  result = enforceGridLayout(result);
  result = enforceMinFontSize(result, 14);
  // === 列表图标与文字对齐强制修复（兜底，不依赖大模型遵循提示词） ===
  result = removeIconMarginTop(result);
  result = enforceLiAlignmentCenter(result);
  result = enforceListAndTextSpanStyles(result);
  // === 本轮新增 3 个视觉缺陷兜底 ===
  result = removeColorCodeWatermark(result); // 缺陷1：背景水印 "#2563b" 类 div 直接删除
  result = enforceDarkBgTextContrast(result, primaryColor, colorPolicy); // 缺陷2：深色/主色背景 → 文字强制白色（豁免参考色）
  result = fixVerticalWritingLists(result); // 缺陷3：装饰性竖排 writing-mode → 强制改回横排 + 水平列表结构
  // === 本轮新增 4 个 4 建议兜底 ===
  result = enforceLightBgTextContrast(result, primaryColor, colorPolicy); // 建议4 C步：浅底/极浅主色禁白字（严重）
  result = enforceHeadingColorOnLightBg(result, {
    primaryColor,
    primaryColorDarker: darkenPrimaryColor(primaryColor, 0.75),
    titleColor,
  }); // Bug-4 FR-8：浅底 heading 中性色→主色（或参考标题色）；深底 heading →白（双防线代码级兜底）
  result = enforceCoverPosterArtStyles(
    result,
    primaryColor,
    slideWidth,
    slideHeight,
    titleColor,
    composition,
  ); // 建议1：封面海报级艺术字兜底
  result = enforceLeftRight5545AndCardBar(result, primaryColor); // 建议2：左文右图 55:45 + 卡片条化
  result = enforceCardTextProportion(result); // 建议3：卡片文字/图标比例修正
  result = enforceFinalTextContrast(result, primaryColor, colorPolicy); // 终局对比度兜底：深底容器强制白字，覆盖全部页型（豁免参考色）
  // 构图护栏：参考为左对齐（或内容页被误居中）时移除根容器居中三件套
  result = applyCompositionGuard(result, composition);
  result = cleanupEmptyContainers(result);
  // 终局清理：上面各步重建/移动节点后可能残留空 <p></p>（幂等；只删无视觉样式的空标签）
  result = cleanupEmptyInlineTags(result);
  // B1：这里不再重复调用 wrapTextNodes / flattenMeaninglessNesting / ensureSemanticWrapping
  // 因为外层 sanitizeSlideHtml 的 L1412-L1415 已经在 postProcessLayout 前后分别跑了一遍
  // 重复调用会导致 style 属性字符串被多次重建、flex 等默认值反复打架
  // —— Task-6 FR-4 第二轮字号 Clamp 兜底：防止上面 建议1/2/3 兜底函数又把卡片/正文字号写回 28px ——
  //    2025-07 R1 修复：以 round=2 调用，若 modifiedRef.count>0 会打印 round2 专属 warn，便于复核豁免遗漏。
  result = enforceBodyFontSize(result, { round: 2 });

  // =====================================================================
  // —— FR-5 最终兜底（子项 C）：非封面（含 <h2>/<h3>/<ul>/<ol>/<img>/<table> 内容标记）
  //    的外层根 flex:column 容器，如 LLM 原 HTML 就没有三件套，绝不允许任何后处理步骤添上三件套。
  //    最后一步正则再清一次，确保 Bug-3 100% 不复发。（即使上面 A/B/C/D 任何遗漏也能兜住）
  // =====================================================================
  const outerMatch = result.match(/^<div([^>]*)>([\s\S]*)<\/div>$/i);
  if (outerMatch) {
    const [, attrsB, innerB] = outerMatch;
    const hasContentSignB = /<h[23]\b|<(ul|ol)\b|<img[\s>]|<table\b/i.test(innerB);
    if (
      hasContentSignB &&
      /display\s*:\s*flex\s*(?:;|$)/i.test(attrsB) &&
      /flex-direction\s*:\s*column/i.test(attrsB)
    ) {
      const newAttrsB = attrsB.replace(/style="([^"]*)"/i, (_ma: string, s: string) => {
        let ns = s;
        // 只清除三件套的 =center 取值（flex-start/其他合法取值不碰）
        ns = ns.replace(/(?:^|;)\s*justify-content\s*:\s*center\s*(?:;|$)/gi, (_mm: string) =>
          _mm.endsWith(';') ? ';' : '',
        );
        ns = ns.replace(/(?:^|;)\s*align-items\s*:\s*center\s*(?:;|$)/gi, (_mm: string) =>
          _mm.endsWith(';') ? ';' : '',
        );
        ns = ns.replace(/(?:^|;)\s*text-align\s*:\s*center\s*(?:;|$)/gi, (_mm: string) =>
          _mm.endsWith(';') ? ';' : '',
        );
        ns = ns.replace(/^;+|;+$/g, '').replace(/;;+/g, ';');
        return `style="${ns}"`;
      });
      result = `<div${newAttrsB}>${innerB}</div>`;
    }
  }

  return result;
}


export function ensureOuterContainer(
  html: string,
  slideWidth: number = 1280,
  slideHeight: number = 720,
  fontFamily: 'sans' | 'serif' | 'mono' = 'sans',
): string {
  let result = html.trim();
  // === 修复 C：padding 不能为 0，内容贴边会严重溢出 ===
  const padX = Math.max(32, Math.round((64 * slideWidth) / 1280 / 8) * 8);
  const padY = Math.max(24, Math.round((48 * slideHeight) / 720 / 8) * 8);
  const defaultPadding = `${padY}px ${padX}px`;
  const fullFontFamily = getFontStack(fontFamily);
  const outerDivMatch = result.match(/^<div([^>]*)>([\s\S]*)<\/div>$/i);
  if (!outerDivMatch) {
    return `<div style="width:100%;height:100%;overflow:hidden;position:relative;box-sizing:border-box;padding:${defaultPadding};display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;background-color:#fff;font-family:${fullFontFamily};">${result}</div>`;
  }
  const attrs = outerDivMatch[1] || '';
  const inner = outerDivMatch[2] || '';
  const styleMatch = attrs.match(/style="([^"]*)"/i);
  const existingStyle = (styleMatch ? styleMatch[1] : '').trim();

  // ============================================================
  // 🛡️ 根本修复（强信任第一道防线）：如果 AI 写的外层 style 本身就是"合规的完整容器"，
  // 直接 return 原始 HTML，根本不进 parser / required 重写 / Map 合并流程，
  // 任何解析错误、合并错误、fallback 错误都不可能发生。
  // ============================================================
  // —— T6-FR6：非海报/封面页（存在 <h2> / <h3> 或多个 <section/div 结构）禁止"完美居中三件套"——
  // 把外层 column 容器强设 justify-content:center / align-items:center / text-align:center
  // 会导致 H2 居中 + 列表整体顶部留白极大，和作者"标题顶、内容随 H2 下方流"意图冲突。
  // 只有"极简封面"（H1-only，无 H2/H3/UL/IMG）才用居中。
  // —— Bug-3 加固 A：isCoverLike 先剥 HTML 注释再判；大小写不敏感（正则已 /i，内部再 toLowerCase 兜底）
  const stripHtmlComments = (s: string): string => s.replace(/<!--[\s\S]*?-->/g, '');
  const CONTENT_SIGN_RE = /<h[23]\b|<(ul|ol)\b|<img[\s>]|<table\b/i;
  // 复用 core 的居中护栏单一真源（已含多列/分栏结构识别，避免左对齐双列封面被误居中）
  const isCoverLike = (s: string): boolean => isCoverLikeHtml(s);
  let layoutShouldCenter = isCoverLike(inner);
  if (existingStyle) {
    // 用纯字符串检查 8 个必需容器特征（AI 每次都写的一模一样）：
    //   ① width:100%  ② height:100%  ③ overflow:hidden  ④ position:relative
    //   ⑤ box-sizing:border-box  ⑥ padding（非空且非 0）  ⑦ display:flex  ⑧ flex-direction
    //   （background / font-family / justify / align / text-align 缺失了后面再用正则补，不破坏原有）
    const has = (r: RegExp) => r.test(existingStyle);
    const ok8 =
      has(/(?:^|;)\s*width\s*:\s*100%\s*(?:;|$)/i) &&
      has(/(?:^|;)\s*height\s*:\s*100%\s*(?:;|$)/i) &&
      has(/(?:^|;)\s*overflow\s*:\s*hidden\s*(?:;|$)/i) &&
      has(/(?:^|;)\s*position\s*:\s*relative\s*(?:;|$)/i) &&
      has(/(?:^|;)\s*box-sizing\s*:\s*border-box\s*(?:;|$)/i) &&
      has(/(?:^|;)\s*padding\s*:/i) &&
      !/(?:^|;)\s*padding\s*:\s*0(?:px)?\s*(?:;|$)/i.test(existingStyle) &&
      has(/(?:^|;)\s*display\s*:\s*flex\s*(?:;|$)/i) &&
      has(/(?:^|;)\s*flex-direction\s*:\s*(?:column|row)\s*(?:;|$)/i);
    if (ok8) {
      // AI 已经写好了完整的 8 大基础容器属性 → 不进解析重写流程，
      // 只用字符串正则"缺什么补什么"，已有的值一字不改。
      let safeStyle = existingStyle;
      const addIfMissing = (prop: string, fallback: string) => {
        if (
          !new RegExp(`(?:^|;)\\s*${prop.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:`, 'i').test(
            `;${safeStyle}`,
          )
        ) {
          safeStyle = safeStyle.endsWith(';')
            ? `${safeStyle}${prop}:${fallback}`
            : `${safeStyle};${prop}:${fallback}`;
        }
      };
      // padding 为 0 的兜底（虽然 ok8 已经排除了 padding:0，但 8 特征都对时再防一次）
      if (/(?:^|;)\s*padding\s*:\s*0(?:px)?\s*(?:;|$)/i.test(safeStyle)) {
        safeStyle = safeStyle.replace(
          /(padding\s*:\s*)0(?:px)?\s*(;|$)/i,
          (_m, p, s) => `${p}${defaultPadding}${s || ';'}`,
        );
      }
      if (!/(?:^|;)\s*background(?:-color)?\s*:/i.test(`;${safeStyle}`))
        safeStyle += `;background-color:#fff`;
      // font-family 特殊处理：不存在 → 补；存在但命中通用占位（老默认 sans OR 老遗留 mono 占位，精确/历史短版子集）→ 允许覆盖为动态栈；其他真实定制 → 绝对不碰（NFR-2 幂等）
      // （Fix A 已在 isDefaultLegacyMonoPlaceholder 收紧 ≥5 项门槛：3 项短版真实定制不会被误判为占位，天然满足幂等）
      {
        const ffMatch = safeStyle.match(/(?:^|;)\s*font-family\s*:\s*([^;]+)/i);
        const currentFF = ffMatch ? ffMatch[1].trim() : '';
        if (!currentFF) {
          safeStyle = safeStyle.endsWith(';')
            ? `${safeStyle}font-family:${fullFontFamily}`
            : `${safeStyle};font-family:${fullFontFamily}`;
        } else if (isPlaceholderFontFamily(currentFF)) {
          // 命中通用占位 → 替换为动态栈：允许跨家族升级（old-sans→mono、old-mono→sans 等，AC-1/AC-3）
          safeStyle = safeStyle.replace(
            /(^|;)\s*font-family\s*:\s*[^;]+/i,
            (_m, prefix) => `${prefix}font-family:${fullFontFamily}`,
          );
        }
      }
      // —— Bug-3 加固 A(续)：ok8 分支三件套注入前再次 isCoverLike + hasAnyContentSign 双重确认
      const ok8HasContentSign = CONTENT_SIGN_RE.test(stripHtmlComments(inner));
      if (layoutShouldCenter && ok8HasContentSign) {
        console.warn(
          '[FIX-BUG3:A] ok8 布局判定与内容标记冲突（存在 h2/h3/ul/ol/img/table），强制降级 layoutShouldCenter=false',
        );
        layoutShouldCenter = false;
      }
      if (layoutShouldCenter) {
        addIfMissing('justify-content', 'center');
        addIfMissing('align-items', 'center');
        addIfMissing('text-align', 'center');
      }
      const newAttrs = styleMatch
        ? attrs.replace(/style="[^"]*"/i, `style="${safeStyle}"`)
        : `${attrs} style="${safeStyle}"`;
      return `<div${newAttrs}>${inner}</div>`;
    }
  }

  const styles: Record<string, string> = {};
  const parsed = existingStyle ? parseStyleDeclarations(existingStyle) : [];
  for (const { key, value } of parsed) {
    styles[key] = value;
  }

  // === 修复 B：解析有效性校验 ===
  // 原 style 中大概有多少个 declaration（按非引号内的 ; 数量 +1 估算），若 parsed 数量 < 估算的 70% 或 关键键（display/flex-direction）丢失 → 判定解析失败，
  // 回退为「保留原 existingStyle 字符串 + 用正则 replace 注入缺失的必要字段」，绝不破坏 AI 写的 padding/font-family 等已有字段
  const estimateDeclCount = (() => {
    let n = 1;
    let inQ: 0 | 1 | 2 = 0;
    let dep = 0;
    for (let k = 0; k < existingStyle.length; k++) {
      const c = existingStyle[k];
      if (dep === 0) {
        if (c === "'" && inQ !== 2) inQ = inQ === 1 ? 0 : 1;
        else if (c === '"' && inQ !== 1) inQ = inQ === 2 ? 0 : 2;
      }
      if (inQ === 0) {
        if (c === '(') dep++;
        else if (c === ')') dep--;
        else if (c === ';' && dep === 0) n++;
      }
    }
    return n;
  })();
  const parseFailed =
    existingStyle &&
    parsed.length > 0 &&
    (parsed.length < Math.ceil(estimateDeclCount * 0.7) ||
      !(styles['display'] || '').trim() ||
      !(styles['width'] || '').trim() ||
      !(styles['height'] || '').trim());

  if (parseFailed) {
    // 回退：保留原 existingStyle 字符串，用 String.replace 缺省补必要字段（不破坏任何已有的值）
    let safeStyle = existingStyle;
    const ensureHas = (prop: string, fallback: string) => {
      if (
        !new RegExp(`(?:^|;)\\s*${prop.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:`, 'i').test(
          `;${safeStyle}`,
        )
      ) {
        safeStyle = safeStyle.endsWith(';')
          ? `${safeStyle}${prop}:${fallback}`
          : `${safeStyle};${prop}:${fallback}`;
      }
    };
    ensureHas('width', '100%');
    ensureHas('height', '100%');
    ensureHas('overflow', 'hidden');
    ensureHas('position', 'relative');
    ensureHas('box-sizing', 'border-box');
    if (!/padding\s*:/i.test(`;${safeStyle}`))
      safeStyle = `${safeStyle};padding:${defaultPadding}`;
    // padding 值为 0 的兜底（即使解析成功了也防一手）
    if (/padding\s*:\s*0(?:px)?\s*(?:;|$)/i.test(safeStyle)) {
      safeStyle = safeStyle.replace(
        /(padding\s*:\s*)0(?:px)?\s*(;|$)/i,
        (_m, p, s) => `${p}${defaultPadding}${s || ';'}`,
      );
    }
    ensureHas('display', 'flex');
    if (!/flex-direction\s*:/i.test(`;${safeStyle}`))
      safeStyle = `${safeStyle};flex-direction:column`;
    // font-family 特殊处理：不存在 → 补；存在但命中通用占位 → 替换为动态栈；其他真实定制 → 绝对不碰（NFR-2 幂等）
    // （Fix A 已收紧 mono 占位 ≥5 项门槛）
    {
      const ffMatch = safeStyle.match(/(?:^|;)\s*font-family\s*:\s*([^;]+)/i);
      const currentFF = ffMatch ? ffMatch[1].trim() : '';
      if (!currentFF) {
        safeStyle = `${safeStyle};font-family:${fullFontFamily}`;
      } else if (isPlaceholderFontFamily(currentFF)) {
        // 命中通用占位 → 允许跨家族升级（AC-3 old-mono→sans）、同家族新版栈升级
        safeStyle = safeStyle.replace(
          /(^|;)\s*font-family\s*:\s*[^;]+/i,
          (_m, prefix) => `${prefix}font-family:${fullFontFamily}`,
        );
      }
    }
    // flex 容器时：仅极简封面才追加完美居中三件套；内容页默认按"从上往下流"不居中
    // —— Bug-3 加固 B：parseFailed 分支三件套注入前再显式双重确认（防 fallback 行为误判）
    let pfShouldCenter = layoutShouldCenter;
    if (pfShouldCenter) {
      const pfCleanInner = stripHtmlComments(inner);
      if (CONTENT_SIGN_RE.test(pfCleanInner)) {
        console.warn(
          '[FIX-BUG3:B] parseFailed 分支检测到 h2/h3/ul/ol/img/table 内容标记，layoutShouldCenter 强制降级为 false',
        );
        pfShouldCenter = false;
      }
    }
    if (pfShouldCenter && /display\s*:\s*flex/i.test(`;${safeStyle}`)) {
      if (!/justify-content\s*:|align-items\s*:|text-align\s*:/i.test(safeStyle)) {
        // 三件套缺失才追加（已有任何一项表明 LLM 可能想手动对齐，不再强写三件套以防覆盖 flex-start 等合理取值）
        if (!/justify-content\s*:/i.test(`;${safeStyle}`))
          safeStyle = `${safeStyle};justify-content:center`;
        if (!/align-items\s*:/i.test(`;${safeStyle}`))
          safeStyle = `${safeStyle};align-items:center`;
        if (!/text-align\s*:/i.test(`;${safeStyle}`))
          safeStyle = `${safeStyle};text-align:center`;
      }
    }
    if (!/background(?:-color)?\s*:/i.test(`;${safeStyle}`))
      safeStyle = `${safeStyle};background-color:#fff`;
    const newAttrs = styleMatch
      ? attrs.replace(/style="[^"]*"/i, `style="${safeStyle}"`)
      : `${attrs} style="${safeStyle}"`;
    return `<div${newAttrs}>${inner}</div>`;
  }

  // === 解析成功：用 Map 重写（更精确） ===
  const required: Record<string, string> = {
    width: '100%',
    height: '100%',
    overflow: 'hidden',
    position: 'relative',
    'box-sizing': 'border-box',
    padding: styles['padding'] || defaultPadding,
    display: styles['display'] || 'flex',
    'flex-direction': styles['flex-direction'] || 'column',
    // font-family 特殊处理：不存在或命中通用占位（老默认 sans OR 老遗留 mono 占位）→ 用动态栈；其他真实定制 → 绝对不碰（NFR-2 幂等）
    // （Fix A 已在 isDefaultLegacyMonoPlaceholder 收紧 ≥5 项门槛，防止 3 项短版真实定制被误判）
    'font-family': ((cur) => (!cur || isPlaceholderFontFamily(cur) ? fullFontFamily : cur))(
      styles['font-family'],
    ),
  };
  // 修复 C：padding 不能为 0（空字符串 或 0 值统一兜底 defaultPadding）
  if (!required.padding || /^0(?:px)?$/.test(required.padding.trim())) {
    required.padding = defaultPadding;
  }
  if ((required.display || styles['display'] || '').trim() === 'flex') {
    // T6-FR6：仅极简封面才三件套居中；内容页按自然流不做水平/垂直居中
    // —— Bug-3 加固 C：Map 重写分支显式 hasAnyContentSign 守卫 + 双重保险降级
    let mapShouldCenter = layoutShouldCenter;
    const hasAnyContentSign = CONTENT_SIGN_RE.test(stripHtmlComments(inner));
    if (mapShouldCenter && hasAnyContentSign) {
      console.warn(
        '[FIX-BUG3:C] Map 重写分支 layoutShouldCenter 与内容标记冲突（h2/h3/ul/ol/img/table 存在），强制降级为不居中以便排查',
      );
      mapShouldCenter = false;
    }
    if (mapShouldCenter) {
      // —— Task 5 最小修复（纵深防御）：三件套注入块内部再嵌套 CONTENT_SIGN_RE 守卫——
      // 即使未来外层 mapShouldCenter 降级逻辑被移除/误改，这里也能独立兜底：
      // 只要 inner 含 h2/h3/ul/ol/img/table 任一内容标记，三件套一律不写。
      if (!CONTENT_SIGN_RE.test(stripHtmlComments(inner))) {
        if (!styles['justify-content']) required['justify-content'] = 'center';
        if (!styles['align-items']) required['align-items'] = 'center';
        if (!styles['text-align']) required['text-align'] = 'center';
      }
    }
  }
  if (!styles['background-color'] && !styles['background'] && !styles['background-image']) {
    required['background-color'] = '#fff';
  }
  for (const [k, v] of Object.entries(required)) {
    if (!styles[k]) styles[k] = v;
  }
  // ★ 占位升级强制覆盖（修复 Map 分支 font-family 升级失效 Bug）：
  //   required['font-family'] 已包含 isPlaceholderFontFamily 判定——若命中占位则是新 fullFontFamily，
  //   若原值真实定制则与 styles['font-family'] 相等。只有两者不等时才强制写回（跨家族升级等场景）。
  //   上面 `if (!styles[k])` 的"缺失才补"无法覆盖这种"原值存在但被判定为占位需要替换"的情况。
  if (required['font-family'] && required['font-family'] !== styles['font-family']) {
    styles['font-family'] = required['font-family'];
  }
  // 再次兜底：padding 仍然是 0 就强制盖掉
  if (!styles.padding || /^0(?:px)?$/.test(styles.padding.trim()))
    styles.padding = defaultPadding;
  const newStyle = Object.entries(styles)
    .map(([k, v]) => `${k}:${v}`)
    .join(';');
  let newAttrs: string;
  if (styleMatch) {
    newAttrs = attrs.replace(/style="[^"]*"/i, `style="${newStyle}"`);
  } else {
    newAttrs = `${attrs} style="${newStyle}"`;
  }
  return `<div${newAttrs}>${inner}</div>`;
}


export function enforceTextContainerStyles(html: string): string {
  // FR-3 加固：原豁免只检查「当前开标签是否带 data-layout」，但 L1 高级版式
  // （comparison-deep-dive 等）的 data-layout 只挂在**根节点**上，左右栏卡片自身没有，
  // 于是仍被补上 overflow:clip → 内容一旦超出就被静默裁掉（pres_mu7skl55_0cmg3m7
  // slide-03「严重遮挡」的直接表现）。改为整页维度判定：命中高级版式则不再补裁剪。
  const isAdvancedLayoutPage = /data-layout\s*=\s*["']?[a-z0-9-]+/i.test(html);
  return html.replace(/<div([^>]*style="[^"]*flex:\s*1[^"]*"[^>]*)>/gi, (match) => {
    // FR-3: 豁免 display:grid 的 flex:1 容器（4/2 卡片网格、对比卡片等，子元素是卡片而非可滚动正文）
    //       带 data-layout=xxxx（白名单版式，如 content-stats-highlight）也同样豁免
    //       这两类容器加 overflow:hidden/clip 只会默默裁掉卡片底部重要信息（胶囊标签、进度条）
    if (/display\s*:\s*grid/i.test(match)) return match;
    if (/data-layout\s*=\s*["']?[a-z0-9-]+/i.test(match)) return match;
    if (/style="[^"]*"/i.test(match)) {
      return match.replace(/style="([^"]*)"/i, (_s, style: string) => {
        let newStyle = style;
        if (!newStyle.includes('min-height')) {
          newStyle += ';min-height:0';
        }
        if (!newStyle.includes('overflow') && !isAdvancedLayoutPage) {
          // FR-3: overflow:hidden → overflow:clip（更温和，不创建滚动容器、不干扰 overflow-x/y 独立设置）
          newStyle += ';overflow:clip';
        }
        if (!newStyle.includes('min-width')) {
          newStyle += ';min-width:0';
        }
        return `style="${newStyle}"`;
      });
    }
    return match;
  });
}

/**
 * FR-4: 图片包裹完整性兜底（flattenMeaninglessNesting 之后的最后一道防线）
 *
 * 触发条件：<img> 是 flex:column 根容器的直接子节点（紧邻 `</div>`/`</section>`/`</article>` 关闭标签之前）
 *   且前一个兄弟不是包裹 div（不是刚被包好的情况，通过"匹配到的 img 前不是 `…></div>\s*<img…>"` 来判断不重套）
 * 处理：给 img 包一层标准容器——
 *   margin-top:24px  保证与上方卡片/列表拉开垂直距离
 *   overflow:hidden  防止 object-fit:cover 时图片溢出圆角
 *   display:flex; align-items:stretch  使图片高度由容器弹性计算而非 height:100%
 *   min-height:0  flex 子容器溢出不蔓延到父级
 *   flex:0 0 auto  容器高度按内容（aspect-ratio 决定的图片高度）自然撑开而非扩张
 */

export function enforceStretchAlignment(html: string): string {
  return html.replace(/<div([^>]*style="[^"]*display:\s*flex[^"]*"[^>]*)>/gi, (match) => {
    if (/style="[^"]*"/i.test(match)) {
      const styleMatch = match.match(/style="([^"]*)"/i);
      if (!styleMatch) return match;
      const style = styleMatch[1];
      if (style.includes('position:absolute') || style.includes('flex-direction:column'))
        return match;
      if (style.includes('align-items')) return match;
      return match.replace(/style="([^"]*)"/i, `style="${style};align-items:stretch"`);
    }
    return match;
  });
}

// =========================================================================
// 图像生成 Prompt 清洗：
//   1. 避免颜色代码、比例（16:9）、风格标签、比例/风格/主色调 等元信息
//      被图像模型 LITERALLY 渲染为画面中的文字（如左上角 #0891b2、右上角 16:9、中间 空与静）
//   2. [新增] 去除/改写「画面主体偏X 留出Y侧 文字排版空间」这类会导致"半边图像、半边纯色空白"的语义
//   3. [新增] 压缩末尾英文强约束（原 280+ chars → 80 chars），避免冲淡主 prompt 权重，并补充色系锚定、全画布无大面积纯色负约束
// =========================================================================
/**
 * FR-15：从 options.referenceVisualAttributes 抽取「分类 → 参考图地址」映射，
 * 供 qwen-image provider 按 slide pageType 选取 img2img seed。
 * 若 options 未携带 referenceVisualAttributes，返回 undefined（provider 回退到旧字段 referenceImage）。
 */

export function cleanupEmptyContainers(html: string): string {
  let result = html;
  // ============================================================
  // 🛡️ 根本修复（无罪推定）：AI 写了 style 属性的空 div 一律不删。
  // （装饰块/分隔线/绝对定位视觉元素 100% 都带 style，误删概率为 0）
  // 只删除完全无 style 属性或 style 空字符串的空 div（flatten 过程产生的垃圾空容器）
  // ============================================================
  for (let i = 0; i < 3; i++) {
    const before = result;
    result = result.replace(
      /<div(\s+[^>]*)?>\s*<\/div>/gi,
      (match: string, attrs: string | undefined) => {
        const a = (attrs || '').trim();
        // 如果没有 style 属性 → 可以删
        const styleIdx = a.search(/style\s*=/i);
        if (styleIdx === -1) return '';
        // 有 style 属性，提取值；如果值本身是空字符串 → 可以删（垃圾空容器）
        // 允许 style="   " 这种只有空格的空 style
        const styleValMatch =
          a.slice(styleIdx).match(/^style\s*=\s*"([^"]*)"/i) ||
          a.slice(styleIdx).match(/^style\s*=\s*'([^']*)'/i);
        if (!styleValMatch || styleValMatch[1].trim() === '') return '';
        // 否则：有真实 style 内容 → 100% 保留（AI 既然写了 style 就必然有它的用意）
        return match;
      },
    );
    if (result === before) break;
  }
  return result;
}

/**
 * 兜底修复1：移除所有列表图标容器上的 margin-top "补丁"
 * 识别特征：inline-flex + flex-shrink:0 + 固定 width/height + border-radius 的组合 span
 * 这些就是列表项的圆形/方形图标容器
 */

export function removeIconMarginTop(html: string): string {
  // 匹配包含核心图标特征的 <span>：inline-flex + flex-shrink:0 + 尺寸/圆角
  return html.replace(/<span([^>]*style="[^"]*"[^>]*)>/gi, (match, attrs) => {
    const styleMatch = attrs.match(/style="([^"]*)"/i);
    if (!styleMatch) return match;
    const style = styleMatch[1];
    // 判断是否为图标容器：必须同时具备 inline-flex + flex-shrink + 宽高/圆角
    const hasInlineFlex =
      /display\s*:\s*inline-flex/i.test(style) || /display\s*:\s*inline-flex/i.test(style);
    const hasFlexShrink = /flex-shrink\s*:\s*0/i.test(style);
    const hasSize = /width\s*:\s*\d+px/i.test(style) && /height\s*:\s*\d+px/i.test(style);
    const hasRadius =
      /border-radius\s*:\s*\d+px/i.test(style) || /border-radius\s*:\s*50%/i.test(style);
    if (!(hasInlineFlex && hasFlexShrink && hasSize && hasRadius)) {
      return match;
    }
    // 是图标容器，移除所有 margin-top 声明
    const styles: Record<string, string> = {};
    for (const { key, value } of parseStyleDeclarations(style)) {
      styles[key] = value;
    }
    delete styles['margin-top'];
    const newStyle = Object.entries(styles)
      .map(([k, v]) => `${k}:${v}`)
      .join(';');
    return match.replace(/style="[^"]*"/i, `style="${newStyle}"`);
  });
}

/**
 * 兜底修复2：所有列表项 <li> 的 flex 对齐方式强制改为 align-items:center
 * 不再依赖 align-items:flex-start + margin-top 的"打补丁"方式
 */

export function enforceLiAlignmentCenter(html: string): string {
  return html.replace(/<li([^>]*style="[^"]*"[^>]*)>/gi, (match, attrs) => {
    const styleMatch = attrs.match(/style="([^"]*)"/i);
    if (!styleMatch) return match;
    const style = styleMatch[1];
    // 仅处理用了 flex 布局的 li（即我们的带图标列表）
    if (!/display\s*:\s*flex/i.test(style)) {
      return match;
    }
    const styles: Record<string, string> = {};
    for (const { key, value } of parseStyleDeclarations(style)) {
      styles[key] = value;
    }
    // 纵向 li（comparison-deep-dive 的「图标行 + 进度条」结构）不是「图标+文字」横向列表：
    // 强行写 align-items:center 会把子项从「拉伸满宽」改成「收缩居中」，
    // 左右两栏图标/文字的起始 x 因内容宽度不同而错位（slide-03 不对齐的放大因素）。
    if (/flex-direction\s*:\s*column/i.test(style)) {
      return match;
    }
    // T6-FR6：作者显式指定 align-items（≠空/≠stretch 默认）时尊重原值，
    // 仅在缺失或 inherit/initial/normal 无意义默认时才补 center，避免把 flex-start 顶对齐的大图标垂直关系打坏。
    const rawAlign = (styles['align-items'] || '').trim().toLowerCase();
    const explicitAlignMeaningful = [
      'flex-start',
      'flex-end',
      'start',
      'end',
      'center',
      'baseline',
      'self-start',
      'self-end',
    ].includes(rawAlign);
    if (!explicitAlignMeaningful) styles['align-items'] = 'center';
    if (!styles['gap']) {
      styles['gap'] = '14px';
    }
    if (!styles['list-style']) {
      styles['list-style'] = 'none';
    }
    const newStyle = Object.entries(styles)
      .map(([k, v]) => `${k}:${v}`)
      .join(';');
    return match.replace(/style="[^"]*"/i, `style="${newStyle}"`);
  });
}

/**
 * 兜底修复3：
 *  a) <ul> 移除过大的 line-height(>1.6)，改用 flex-direction:column + gap 控制间距
 *  b) <li> 内的文字 span（紧跟图标 span 之后）强制 line-height:1.4 + flex:1
 * 这样不管大模型怎么写，最终 li 内的图标和文字都能水平中心对齐
 */

export function enforceListAndTextSpanStyles(html: string): string {
  let result = html;

  // (a) 处理 ul：移除过大 line-height，添加 flex column gap
  result = result.replace(/<ul([^>]*style="[^"]*"[^>]*)>/gi, (match, attrs) => {
    const styleMatch = attrs.match(/style="([^"]*)"/i);
    if (!styleMatch) {
      // 没有 style，补一个标准的
      return `<ul${attrs} style="margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:16px;min-width:0;">`;
    }
    const style = styleMatch[1];
    const styles: Record<string, string> = {};
    for (const { key, value } of parseStyleDeclarations(style)) {
      styles[key] = value;
    }
    // 清理过大的 line-height
    if (styles['line-height']) {
      const lh = parseFloat(styles['line-height']);
      if (!isNaN(lh) && lh > 1.6) {
        delete styles['line-height'];
      }
    }
    // 统一 list style 和 flex 布局间距
    if (!styles['list-style']) styles['list-style'] = 'none';
    if (!styles['margin']) styles['margin'] = '0';
    if (!styles['padding']) styles['padding'] = '0';
    if (!styles['display']) {
      styles['display'] = 'flex';
      styles['flex-direction'] = 'column';
      styles['gap'] = '16px';
    }
    if (!styles['min-width']) styles['min-width'] = '0';
    const newStyle = Object.entries(styles)
      .map(([k, v]) => `${k}:${v}`)
      .join(';');
    return match.replace(/style="[^"]*"/i, `style="${newStyle}"`);
  });

  // (b) 处理 li 内：紧跟图标 span 之后的文字 span
  // 图标 span 的识别特征（不依赖 CSS 属性顺序）：
  //   - 存在 display:inline-flex
  //   - 存在 flex-shrink:0
  //   - 有 width/height 尺寸（配合 removeIconMarginTop 的特征）
  const iconSpanPattern = (flags: string = '') =>
    new RegExp(
      '<span([^>]*style="(?=[^"]*display\\s*:\\s*inline-flex)(?=[^"]*flex-shrink\\s*:\\s*0)[^"]*"[^>]*)>[\\s\\S]*?</span>',
      flags,
    );

  // 先用完整模式（li > iconSpan + textSpan）匹配
  // 捕获分组：
  //   $1 = liAttrs
  //   $2 = 整个 iconSpan（含前后空白）
  //   $3 = iconSpanAttrs（iconSpan 内部的捕获组，我们不需要）
  //   $4 = textSpanAttrs（真正的文字 span 属性，必须取这个）
  const combinedPattern = new RegExp(
    '<li([^>]*)>(\\s*' + iconSpanPattern().source + ')\\s*<span([^>]*)>',
    'gi',
  );
  result = result.replace(
    combinedPattern,
    (_match, liAttrs, iconSpan, _iconSpanAttrsUnused, textSpanAttrs) => {
      // 给文字 span 补 style：line-height:1.4 和 flex:1
      let newTextSpanAttrs = textSpanAttrs;
      const styleMatch = newTextSpanAttrs.match(/style="([^"]*)"/i);
      const styles: Record<string, string> = {};
      if (styleMatch) {
        for (const { key, value } of parseStyleDeclarations(styleMatch[1])) {
          styles[key] = value;
        }
      }
      if (!styles['line-height']) styles['line-height'] = '1.4';
      if (!styles['flex']) styles['flex'] = '1';
      const newStyle = Object.entries(styles)
        .map(([k, v]) => `${k}:${v}`)
        .join(';');
      if (styleMatch) {
        newTextSpanAttrs = newTextSpanAttrs.replace(/style="[^"]*"/i, `style="${newStyle}"`);
      } else {
        newTextSpanAttrs = `${newTextSpanAttrs} style="${newStyle}"`;
      }
      return `<li${liAttrs}>${iconSpan}<span${newTextSpanAttrs}>`;
    },
  );

  return result;
}


