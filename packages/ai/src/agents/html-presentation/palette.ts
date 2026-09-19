import type { SlidePlan, SlideColorPolicy, ReferenceVisualAttributes } from '../../types';
import type { HTMLPresentation } from './shared';
import {
  normalizeHex,
  rgbStringToHex,
  hexToRgba,
  enforceBodyFontSize,
  enforce8ptGrid,
  fixRowImageMargins,
  ensureImageProperWrapper,
  postProcessLayout,
  ensureImageRatio,
  injectBackgroundPlaceholder,
  assertGrid8pt,
  wrapTextNodes,
  ensureSemanticWrapping,
} from './postprocess';
import {
  sanitizeSlideHtml,
  sanitizeStyleSyntax,
  flattenMeaninglessNesting,
  injectStructuredGraphics,
  extractJson,
  enforceSingleColumn,
} from './html-sanitize';
import { resolveReferenceTextColors } from './prompts';
import { resolveColorPolicyForPage, resolveReferenceComposition } from '../../utils/reference-attribute-resolver';
import { hexToHsl, hueDeltaDeg, darkenColor, POST_VERSION_SIG } from './shared';

export function postProcessHtmlSnapshot(
    html: string,
    opts: {
      primaryColor?: string;
      primaryColorDarker?: string;
      slideWidth?: number;
      slideHeight?: number;
      backgroundEnabled?: boolean;
      fontFamily?: 'sans' | 'serif' | 'mono';
      referenceVisualAttributes?: ReferenceVisualAttributes;
      pageType?: string;
    } = {},
  ): string {
    const primaryColor = (
      opts.primaryColor && /^#[0-9a-fA-F]{6}$/.test(opts.primaryColor)
        ? opts.primaryColor
        : '#2563eb'
    ).toLowerCase();
    const primaryColorDarker = opts.primaryColorDarker || darkenColor(primaryColor, 20);
    const slideWidth = opts.slideWidth || 1280;
    const slideHeight = opts.slideHeight || 720;
    const backgroundEnabled = opts.backgroundEnabled ?? false;
    const fontFamily = opts.fontFamily || 'sans';
    const slidePlan = { pageType: opts.pageType || '' } as unknown as SlidePlan;
    return postProcessSlideHtml(
      html,
      slidePlan,
      primaryColor,
      primaryColorDarker,
      slideWidth,
      slideHeight,
      backgroundEnabled,
      fontFamily,
      opts.referenceVisualAttributes,
    );
  }

export function postProcessSlideHtml(
    html: string,
    slidePlan: SlidePlan,
    primaryColor: string,
    primaryColorDarker: string,
    slideWidth: number,
    slideHeight: number,
    backgroundEnabled: boolean,
    fontFamily: 'sans' | 'serif' | 'mono' = 'sans',
    referenceVisualAttributes?: ReferenceVisualAttributes,
    colorPolicy?: SlideColorPolicy,
  ): string {
    console.log(`[POST] v4 sig=${POST_VERSION_SIG}`);
    let result = html;
    const steps: string[] = [];
    // 配色策略（后处理唯一颜色真源）：把参考撞色板 / 标题色 / 正文色 / 描边色作为显式白名单。
    // 未显式传入时由参考视觉属性按页推导；无参考则回落主色系（与历史行为一致）。
    const cp: SlideColorPolicy =
      colorPolicy ||
      resolveColorPolicyForPage(
        referenceVisualAttributes,
        slidePlan.pageType,
        primaryColor,
        primaryColorDarker,
      );
    try {
      result = sanitizeSlideHtml(result);
      steps.push('sanitizeSlideHtml');
      result = sanitizeStyleSyntax(result);
      steps.push('sanitizeStyleSyntax');
      // FR-B（回归修复）：配色自洽检测。若 HTML 已形成单一色相族 + 中性灰阶的自洽配色
      // （参考图驱动生成的红色系页面即属此类），则整体跳过 sanitizeGradientColors / enforceSinglePalette
      // 的颜色重写，仅在确属多色相混杂（"脏"页面）时才执行归一。这样即使终局重放取色失源
      // （finalMainColor 回落默认蓝），也只"不美化"而绝不"毁容"。
      // 向后兼容：无彩色 / 纯中性 / 单色族页面历史重写本为 no-op，跳过后逐字节一致。
      // —— 参考克隆·撞色豁免：本页存在 accent 撞色板（参考明确上传的撞色风格）时直接判为自洽，
      //    跳过单色系红线重写，使参考撞色 1:1 保真落地。
      const paletteHarmonious = cp.isMultiColor || detectHarmonizedPalette(result);
      if (paletteHarmonious) {
        steps.push(`palette-harmonious(skip${cp.isMultiColor ? '/reference-multicolor' : ''})`);
      } else {
        result = sanitizeGradientColors(result, primaryColor, primaryColorDarker, cp);
        steps.push('sanitizeGradientColors');
        result = enforceSinglePalette(result, primaryColor, primaryColorDarker, cp);
        steps.push('enforceSinglePalette');
      }
      result = enforceBodyFontSize(result);
      steps.push('enforceBodyFontSize');
      result = enforce8ptGrid(result);
      steps.push('enforce8ptGrid');
      result = fixRowImageMargins(result);
      steps.push('fixRowImageMargins');
      result = wrapTextNodes(result);
      steps.push('wrapTextNodes');
      result = flattenMeaninglessNesting(result);
      steps.push('flattenMeaninglessNesting');
      result = ensureSemanticWrapping(result);
      steps.push('ensureSemanticWrapping');
      // FR-4: 图片包裹完整性兜底。若前两步 flatten/semanticWrap 之后 img 仍裸奔在 flex:column 根下，强制重包。
      result = ensureImageProperWrapper(result);
      steps.push('ensureImageProperWrapper');
      const postTitleColor = resolveReferenceTextColors(
        referenceVisualAttributes,
        slidePlan.pageType,
      ).titleColor;
      const composition = resolveReferenceComposition(
        referenceVisualAttributes,
        slidePlan.pageType,
      );
      result = postProcessLayout(
        result,
        slidePlan.pageType,
        slideWidth,
        slideHeight,
        primaryColor,
        fontFamily,
        postTitleColor,
        cp,
        composition,
      );
      steps.push('postProcessLayout');
      result = ensureImageRatio(result, slidePlan);
      steps.push('ensureImageRatio');
      result = enforceSingleColumn(result, slidePlan.pageType || '');
      steps.push('enforceSingleColumn');
      if (backgroundEnabled && slidePlan.backgroundPrompt) {
        result = injectBackgroundPlaceholder(result);
      }
      steps.push('injectBackgroundPlaceholder');
      result = assertGrid8pt(result); // 最终防线：8pt 网格规整兜底自检
      steps.push('assertGrid8pt');
      // FR-18 §18.5：按 chart/architecture 注入受控内联 SVG（Q12/Q13；NFR-2 静默降级）
      result = injectStructuredGraphics(result, slidePlan, primaryColor, primaryColorDarker);
      steps.push('injectStructuredGraphics');
    } catch (e) {
      console.warn(
        `[POST] 链异常（已执行 ${steps.join('>') || '无'}），保留已处理产物:`,
        e instanceof Error ? e.message : e,
      );
    }
    return result;
  }

export function detectHarmonizedPalette(html: string): boolean {
    const tokens: string[] = [];
    const styleRe = /<[a-z][^>]*style="([^"]*)"/gi;
    let sm: RegExpExecArray | null;
    while ((sm = styleRe.exec(html)) !== null) {
      const m2 = sm[1].match(/#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)/g);
      if (m2) tokens.push(...m2);
    }
    const svgRe =
      /<(?:svg|path|circle|rect|line|polyline|polygon|ellipse|use)\b[^>]*?\s+(?:stroke|fill)\s*=\s*["']([^"']*?)["']/gi;
    let vm: RegExpExecArray | null;
    while ((vm = svgRe.exec(html)) !== null) tokens.push(vm[1]);

    const HUE_WINDOW = 40;
    const chromaHues: number[] = [];
    for (const raw of tokens) {
      const low = raw.trim().toLowerCase();
      if (low === 'transparent' || low === 'currentcolor' || low === 'none') continue;
      if (/^url\(#/.test(low)) continue;
      let hex: string | null = null;
      if (low.charAt(0) === '#') hex = normalizeHex(low);
      else if (/^rgba?\(/i.test(low)) hex = rgbStringToHex(low);
      if (!hex) continue; // 命名色等无法解析 → 跳过
      const hsl = hexToHsl(hex);
      if (!hsl) continue;
      // 中性（低饱和或极亮/暗）不算彩色色相分布。
      // 注意：正文常用灰阶（Tailwind gray-400~800 等）虽带轻微蓝/暖色相偏（饱和度约 0.10~0.30），
      // 但人眼视为中性。阈值若过低（0.12），参考红页的正文灰字会被误判为「第二色相」→ 整页判为
      // 多色相混杂（脏色）→ 配色重写把参考红全量重染成默认蓝（根因 B 的失败模式）。
      // 因此把中性饱和度阈值提到 0.30：仅饱和度 ≥0.30 的鲜亮色才计入色相分布，
      // 灰阶一律视为中性 → 参考红（单一鲜亮色相）+ 灰阶 → 自洽 → 跳过重写（不毁容）。
      // 真多色相页（如红 + 鲜绿 #16a34a s≈0.7）仍会因两色均 ≥0.30 而判定混杂 → 走原重写逻辑。
      if (hsl.s < 0.3 || hsl.l < 0.06 || hsl.l > 0.95) continue;
      chromaHues.push(hsl.h);
    }
    if (chromaHues.length === 0) return true; // 仅中性/无彩色 → 自洽
    const sorted = [...chromaHues].sort((a, b) => a - b);
    let largestGap = 360 - (sorted[sorted.length - 1] - sorted[0]); // 跨 0° 环隙
    for (let i = 1; i < sorted.length; i++) {
      largestGap = Math.max(largestGap, sorted[i] - sorted[i - 1]);
    }
    // 若最大空隙 >= 360 - 窗口，则所有色相可容纳在一个 ≤HUE_WINDOW 的色相窗口内 → 单一色系
    return largestGap >= 360 - HUE_WINDOW;
  }

export function sanitizeGradientColors(
    html: string,
    primaryColor: string,
    primaryColorDarker: string,
    colorPolicy?: SlideColorPolicy,
  ): string {
    const primaryHex = (primaryColor || '').toLowerCase();
    const darkerHex = (primaryColorDarker || '').toLowerCase();
    const allowed = new Set([
      primaryHex,
      darkerHex,
      '#111827',
      '#1f2937',
      '#374151',
      '#4b5563',
      '#6b7280',
      '#9ca3af',
      '#d1d5db',
      '#e5e7eb',
      '#f3f4f6',
      '#f9fafb',
      '#ffffff',
      '#fff',
      '#000000',
      '#000',
      'transparent',
    ]);
    // 参考撞色板 / 标题色 / 正文色 / 描边色作为显式白名单放行（参考克隆·色彩红线豁免）
    if (colorPolicy) {
      for (const c of [
        colorPolicy.titleColor,
        colorPolicy.bodyColor,
        colorPolicy.strokeColor,
        ...colorPolicy.accents,
      ]) {
        if (c) allowed.add(c.toLowerCase());
      }
    }
    const pHsl = hexToHsl(primaryHex);
    const dHsl = hexToHsl(darkerHex);
    // FR-8：色相宽松白名单（≤32°）允许同色系自然明暗变化，跨色相渐变直接归一成 primary→darker
    const hueTolerantAllowed = (hex: string): boolean => {
      const low = hex.toLowerCase();
      if (allowed.has(low)) return true;
      const hsl = hexToHsl(low);
      if (!hsl) return false;
      if (hsl.s < 0.12 || hsl.l < 0.06 || hsl.l > 0.95) return true;
      if (pHsl && hueDeltaDeg(hsl.h, pHsl.h) <= 32) return true;
      if (dHsl && hueDeltaDeg(hsl.h, dHsl.h) <= 32) return true;
      return false;
    };
    const remapStopColor = (hex: string): string => {
      const hsl = hexToHsl(hex.toLowerCase());
      if (!hsl) return darkerHex;
      const midL = dHsl && pHsl ? (dHsl.l + pHsl.l) / 2 : 0.45;
      return hsl.l <= midL ? darkerHex : primaryHex;
    };

    return (
      html
        .replace(/linear-gradient\(\s*([^)]+)\)/gi, (_fullMatch: string, inner: string) => {
          const angleMatch = inner.match(/^(\d+deg|to\s+\w+(?:\s+\w+)?)\s*,?/i);
          const prefix = angleMatch ? angleMatch[1] + ', ' : '';
          const stopsPart = angleMatch ? inner.substring(angleMatch[0].length) : inner;
          const stops = stopsPart.split(/\s*,\s*(?![^()]*\))/);
          const stopHexes = stops
            .map((s) => {
              const m = s.match(/#(?:[0-9a-f]{3,8})/i);
              return m ? normalizeHex(m[0]) : null;
            })
            .filter((x): x is string => !!x);
          const hasCrossHueStop = stopHexes.some((h) => !hueTolerantAllowed(h));
          const unique = stopHexes.filter(
            (h, i, arr) => i === arr.findIndex((x) => x?.toLowerCase() === h.toLowerCase()),
          );
          if (hasCrossHueStop || unique.length > 2) {
            return `linear-gradient(${prefix}${primaryHex}, ${darkerHex})`;
          }
          const sanitizedStops = stops.map((stop) => {
            const hexMatch = stop.match(/#(?:[0-9a-f]{3,8})/i);
            if (!hexMatch) return stop;
            const hex = normalizeHex(hexMatch[0]);
            if (!hex) return stop;
            if (hueTolerantAllowed(hex)) return stop;
            return stop.replace(
              new RegExp(hexMatch[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'),
              remapStopColor(hex),
            );
          });
          return `linear-gradient(${prefix}${sanitizedStops.join(', ')})`;
        })
        // SVG <stop stop-color>
        .replace(
          /(<stop\b[^>]*?stop-color\s*=\s*["'])(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\))(["'])/gi,
          (full, pre: string, col: string, end: string) => {
            const token = col.trim();
            const hex =
              token.charAt(0) === '#' ? normalizeHex(token) : rgbStringToHex(token);
            if (!hex) return full;
            if (hueTolerantAllowed(hex)) return full;
            return pre + remapStopColor(hex) + end;
          },
        )
    );
  }

export function enforceSinglePalette(
    html: string,
    primaryColor: string,
    primaryColorDarker: string,
    colorPolicy?: SlideColorPolicy,
  ): string {
    const primary = (primaryColor || '').toLowerCase();
    const darker = (primaryColorDarker || '').toLowerCase();
    const graySet = new Set([
      '#111827',
      '#1f2937',
      '#374151',
      '#4b5563',
      '#6b7280',
      '#9ca3af',
      '#d1d5db',
      '#e5e7eb',
      '#f3f4f6',
      '#f9fafb',
      '#ffffff',
      '#fff',
      '#000000',
      '#000',
    ]);
    const semanticSet = new Set(['#10b981', '#059669', '#ef4444', '#dc2626', '#f59e0b']);
    const colorTokenRe = /#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)/g;
    const relevantPropRe =
      /^(?:color|background|background-color|border(?:-(?:top|right|bottom|left))?|border-color|border-(?:top|right|bottom|left)-color|outline|outline-color|box-shadow)$/;
    let unknownPreserved = 0;

    const pHsl = hexToHsl(primary);
    const dHsl = hexToHsl(darker);

    // 参考撞色板 / 标题色 / 正文色 / 描边色作为显式白名单（参考克隆·色彩红线豁免）
    const refExtra = new Set<string>();
    if (colorPolicy) {
      for (const c of [
        colorPolicy.titleColor,
        colorPolicy.bodyColor,
        colorPolicy.strokeColor,
        ...colorPolicy.accents,
      ]) {
        if (c) refExtra.add(c.toLowerCase());
      }
    }

    const isBackgroundish = (prop: string): boolean =>
      prop === 'background' || prop === 'background-color';

    const colorToHex = (token: string): string | null => {
      const t = token.trim();
      if (t.charAt(0) === '#') return normalizeHex(t);
      return rgbStringToHex(t); // rgba 只看 (r,g,b) 三通道是否白名单
    };

    const isSameHueFamily = (baseHex: string): boolean => {
      const hsl = hexToHsl(baseHex.toLowerCase());
      if (!hsl) return false;
      if (hsl.s < 0.12 || hsl.l < 0.06 || hsl.l > 0.95) return true; // 灰度/纯黑白算同家族放行
      if (pHsl && hueDeltaDeg(hsl.h, pHsl.h) <= 32) return true;
      if (dHsl && hueDeltaDeg(hsl.h, dHsl.h) <= 32) return true;
      return false;
    };

    const isAllowed = (baseHex: string, prop: string): boolean => {
      const h = baseHex.toLowerCase();
      if (h === primary || h === darker || h === 'transparent') return true;
      if (graySet.has(h)) return true;
      if (refExtra.has(h)) return true; // 参考撞色 / 标题色 / 正文色 / 描边色放行
      // FR-8/FR-6：色相接近（≤32°）或灰度，判为同色系合法色调变化，放行
      if (isSameHueFamily(h)) return true;
      if (
        isBackgroundish(prop) ||
        prop === 'border' ||
        prop === 'border-color' ||
        prop.startsWith('border-')
      ) {
        if (semanticSet.has(h)) return true;
      }
      if (prop === 'outline' && semanticSet.has(h)) return true;
      return false;
    };

    const replaceSolidToken = (token: string, prop: string, styleBody: string): string => {
      const t = token.trim();
      if (t.toLowerCase() === 'transparent') return token;
      const baseHex = colorToHex(t);
      if (!baseHex) {
        unknownPreserved++;
        return token;
      }
      if (isAllowed(baseHex, prop)) return token;
      if (prop === 'color') {
        // 头部大标题（font-size>=40px）用参考标题色（若有），否则近黑；正文用深灰。
        const headline = /font-size\s*:\s*(?:4\d|[5-9]\d|\d{3})\s*px/i.test(styleBody);
        if (headline && colorPolicy?.titleColor) return colorPolicy.titleColor;
        return headline ? '#111827' : '#374151';
      }
      if (prop === 'box-shadow') {
        return primary ? `${primary}40` : token;
      }
      if (isBackgroundish(prop)) {
        const am = /rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*([\d.]+)\s*\)/i.exec(t);
        if (am && parseFloat(am[1]) <= 0.2) {
          return primary ? hexToRgba(primary, 0.08) : '#F3F4F6';
        }
        return '#F3F4F6';
      }
      // border*/outline → 主色
      return primary || '#111827';
    };

    const replaceGradientToken = (token: string): string => {
      const baseHex = colorToHex(token);
      if (baseHex) {
        const h = baseHex.toLowerCase();
        if (h === primary || h === darker || graySet.has(h) || refExtra.has(h)) return token;
      } else {
        unknownPreserved++;
        return token;
      }
      return darker;
    };

    const result = html.replace(
      /(<[a-z][^>]*style=")([^"]*)(")/gi,
      (full, pre: string, styleBody: string, quote: string) => {
        const nextStyle = styleBody
          .split(';')
          .map((decl) => {
            const mm = /^\s*([a-zA-Z-]+)\s*:\s*([\s\S]*)$/.exec(decl);
            if (!mm) return decl;
            const prop = mm[1].toLowerCase();
            if (!relevantPropRe.test(prop)) return decl;
            const value = mm[2];
            const newValue = /linear-gradient/i.test(value)
              ? value.replace(colorTokenRe, replaceGradientToken)
              : value.replace(colorTokenRe, (tok) => replaceSolidToken(tok, prop, styleBody));
            return newValue === value ? decl : decl.replace(value, newValue);
          })
          .join(';');
        if (nextStyle === styleBody) return full;
        return `${pre}${nextStyle}${quote}`;
      },
    );
    if (unknownPreserved > 0) {
      console.warn(
        `[PALETTE] 存在无法可靠判定的颜色，已保持原值（debug），count=${unknownPreserved}`,
      );
    }

    // ---- SVG 元素级 stroke/fill 属性纳入单色系 ----
    // 白名单：primary/darker/灰阶/白/黑/transparent/currentColor/none/url(#...)；
    // 非白名单的 hex/rgb()/rgba() → primary；rgba alpha<=0.15 的浅底 → primary@0.08。
    const isSvgAllowed = (token: string): boolean => {
      const t = token.trim().toLowerCase();
      if (t === 'transparent' || t === 'currentcolor' || t === 'none') return true;
      if (/^url\(#/.test(t)) return true; // url(#梯度id)
      if (t.charAt(0) === '#') {
        const hex = normalizeHex(t);
        if (!hex) return true; // 无法解析 → 保持原值
        const h = hex.toLowerCase();
        return h === primary || h === darker || graySet.has(h) || refExtra.has(h);
      }
      if (/^rgba?\(/i.test(t)) {
        const baseHex = rgbStringToHex(t);
        if (!baseHex) return true;
        const h = baseHex.toLowerCase();
        return h === primary || h === darker || graySet.has(h) || refExtra.has(h);
      }
      return true; // 非颜色 token（命名色等）→ 保持原值
    };
    const resolveSvgColor = (token: string): string | null => {
      const t = token.trim();
      if (t.charAt(0) === '#') return primary;
      if (/^rgba\(/i.test(t)) {
        const am = /rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*([\d.]+)\s*\)/i.exec(t);
        if (am && parseFloat(am[1]) <= 0.15)
          return primary ? hexToRgba(primary, 0.08) : '#F3F4F6';
        return primary;
      }
      if (/^rgb\(/i.test(t)) return primary;
      return null; // 其它 token 已由 isSvgAllowed 兜底保持原值
    };
    const svgPropRe =
      /(<(?:svg|path|circle|rect|line|polyline|polygon|ellipse|use)\b[^>]*?)\s+(stroke|fill)\s*=\s*(["'])([^"']*?)\3/gi;
    const resultWithSvg = result.replace(
      svgPropRe,
      (full, tagPrefix: string, attrName: string, q: string, tokenVal: string) => {
        if (isSvgAllowed(tokenVal)) return full;
        const replacement = resolveSvgColor(tokenVal);
        if (replacement === null) return full;
        return `${tagPrefix} ${attrName}=${q}${replacement}${q}`;
      },
    );

    return resultWithSvg;
  }

export function parsePresentation(content: string, primaryColor: string = '#2563eb'): HTMLPresentation {
    const jsonStr = extractJson(content);
    const primaryColorDarker = darkenColor(primaryColor, 20);
    try {
      const data = JSON.parse(jsonStr);
      const slides = Array.isArray(data.slides)
        ? data.slides.map((s: any) => {
            let html = sanitizeSlideHtml(s.html || '');
            html = sanitizeGradientColors(html, primaryColor, primaryColorDarker);
            html = wrapTextNodes(html);
            html = flattenMeaninglessNesting(html);
            html = ensureSemanticWrapping(html);
            return {
              title: s.title || '',
              html,
              notes: s.notes || undefined,
            };
          })
        : [];
      return {
        title: data.title || '演示文稿',
        description: data.description || '',
        primaryColor,
        transition: data.transition || 'none',
        slides,
      };
    } catch (e) {
      console.error('Failed to parse presentation JSON:', e);
      throw new Error('Failed to parse AI response');
    }
  }
