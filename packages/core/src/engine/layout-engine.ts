import {
  generateId,
  generatePresentationId,
} from '../utils/id';
import type {
  Slide,
  Presentation,
} from '../models/slide';
import {
  enforceImageStyles,
  enforceMinFontSize,
  enforceFlexChildrenMinWidth,
  enforceTextWrapping,
  enforceFlatStructure,
  enforceGridLayout,
  applyCompositionGuard,
} from './visual-fixes';

import {
  DEFAULT_HTML,
} from './layout/constants';
import {
  removeEmptyDefaultContainer,
  wrapWithContainer,
  removeDangerousContent,
  cleanupEmptyDivs,
  cleanupEmptyInlineTags,
} from './layout/dom';
import {
  normalizeOuterContainer,
} from './layout/container';
import {
  defaultPadYx,
} from './layout/constants';
import {
  inferPrimaryColor,
  repairTrivialSvgIcons,
  normalizeIconGroups,
  repairEmptySvgs,
  unwrapIconWrappingParagraph,
} from './layout/icon';
import {
  removeForcedCardHeight,
  enforceBareTextToParagraphs,
} from './layout/text';
import {
  preventContentImageTopOverflow,
} from './layout/probe';
export { isCoverLikeHtml } from './layout/cover';
export { cleanupEmptyInlineTags } from './layout/dom';

export class LayoutEngine {
  static createSlide(index: number, title?: string): Slide {
    const now = Date.now();
    return {
      id: generateId(),
      title: title || `幻灯片 ${index + 1}`,
      html: DEFAULT_HTML,
      notes: '',
      hidden: false,
      index,
      createdAt: now,
      updatedAt: now,
    };
  }

  static createPresentation(title?: string, width?: number, height?: number): Presentation {
    const now = Date.now();
    const firstSlide = LayoutEngine.createSlide(0, '封面');
    return {
      id: generatePresentationId(),
      title: title || '未命名演示',
      description: '',
      author: '',
      slides: [firstSlide],
      selectedSlideId: firstSlide.id,
      zoom: 1,
      width: width || 1280,
      height: height || 720,
      transition: 'none',
      createdAt: now,
      updatedAt: now,
      version: 1,
      tags: [],
    };
  }

  static duplicateSlide(slide: Slide, newIndex: number): Slide {
    const now = Date.now();
    return {
      ...slide,
      id: generateId(),
      title: `${slide.title} (副本)`,
      index: newIndex,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * L1 高级版式白名单（data-layout 属性值）。
   * 命中后 normalizeAISlide 会走「轻量分支」，跳过 flatten 剥离，
   * 只做 sanitize 安全 + 溢出防御 + 裸文本兜底等"不破坏结构"的步骤。
   */
  private static readonly ADVANCED_LAYOUTS: ReadonlySet<string> = new Set([
    'comparison-deep-dive',
    'content-zigzag',
    'content-value-showcase',
    'content-stats-highlight',
    'content-image-background',
  ]);

  /**
   * 轻量版 normalizeOuterContainer：跳过破坏性 flatten，只做两件事：
   *   1) 保证最外层是合规根容器（若最外层就是合规 div/section/article 且带 ok8 属性，直接 return，一字不改）
   *   2) 背景样式保留 + 必要字段缺失才补（不重写已有 padding/display/flex-direction）
   *
   * 设计原则：AI 写了什么结构，我们就保留什么结构，只补安全兜底属性，永不 flatten。
   */
  private static normalizeOuterContainerForAdvancedLayout(html: string): string {
    let result = html.trim();
    if (!result) return DEFAULT_HTML;

    result = removeEmptyDefaultContainer(result);

    const FULL_FONT =
      "system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,'Noto Sans SC','PingFang SC','Microsoft YaHei',sans-serif";

    // —— 完全复用 normalizeOuterContainer 中已有的 ok8 判定逻辑 ——
    const firstOuter = /^<(div|section|article)\b([^>]*)>/.exec(result);
    if (firstOuter) {
      const tagName = firstOuter[1];
      const attrs = firstOuter[2] || '';
      const cls = (attrs.match(/class="([^"]*)"/i) || [, ''])[1];
      if (!/noppt-/.test(cls)) {
        const styleMatch = attrs.match(/style="([^"]*)"/i);
        const existingStyle = (styleMatch ? styleMatch[1] : '').trim();
        if (existingStyle) {
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
            let safeStyle = existingStyle;
            const addIfMissing = (prop: string, fallback: string) => {
              if (
                !new RegExp(
                  `(?:^|;)\\s*${prop.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:`,
                  'i',
                ).test(`;${safeStyle}`)
              ) {
                safeStyle = safeStyle.endsWith(';')
                  ? `${safeStyle}${prop}:${fallback}`
                  : `${safeStyle};${prop}:${fallback}`;
              }
            };
            if (/(?:^|;)\s*padding\s*:\s*0(?:px)?\s*(?:;|$)/i.test(safeStyle)) {
              safeStyle = safeStyle.replace(
                /(padding\s*:\s*)0(?:px)?\s*(;|$)/i,
                (_m, p, s) => `${p}${defaultPadYx()}${s || ';'}`,
              );
            }
            if (!/(?:^|;)\s*background(?:-color)?\s*:/i.test(`;${safeStyle}`))
              safeStyle += ';background-color:#fff';
            addIfMissing('font-family', FULL_FONT);
            addIfMissing('justify-content', 'center');
            addIfMissing('align-items', 'center');
            addIfMissing('text-align', 'center');
            const newAttrs = styleMatch
              ? attrs.replace(/style="[^"]*"/i, `style="${safeStyle}"`)
              : `${attrs} style="${safeStyle}"`;
            const rest = result.substring(firstOuter[0].length);
            const closeTag = `</${tagName.toLowerCase()}>`;
            let dep = 1;
            let close = -1;
            const scanRe = new RegExp(`<(/?)(${tagName})\\b([^>]*)>`, 'gi');
            let mm: RegExpExecArray | null;
            while ((mm = scanRe.exec(rest)) !== null) {
              if (mm[1] === '/') {
                dep--;
                if (dep === 0) {
                  close = mm.index;
                  break;
                }
              } else if (!/\/\s*$/.test(mm[3] || '')) {
                dep++;
              }
            }
            if (close >= 0) {
              const inner = rest.substring(0, close);
              const after = rest.substring(close + closeTag.length);
              return `<${tagName.toLowerCase()}${newAttrs}>${inner}</${tagName.toLowerCase()}>${after}`;
            }
          }
        }
      }
    }

    // 最外层不是 ok8：直接用 wrapWithContainer 把整个内容包一层合规壳（不做任何 flatten 剥离）
    // 这里 hasAbsolute=false 意思是"按正常 flex+padding 默认值包壳"，但内部的 absolute 元素会因为 position:relative 而正确锚定。
    // （如果 AI 返回的内容里有 absolute 元素，它们自己的 left/top 是相对于最近的 position:relative 祖先，最外层壳加了 relative 就能当锚。）
    return wrapWithContainer(result, true, null);
  }

  /**
   * 改善点 6：高级版式去脏属性。
   * 只删「100% 是脏、不会误伤合法装饰元素」的属性：
   *   - max-width:none / max-height:none（破坏编辑器画布约束）
   *   - overflow:visible（会让内容溢出画布外，破坏 1280×720 边界）
   *
   * 故意不删 position:absolute / left:XXpx / width:XXpx 等，因为装饰性 halo/blob/分隔线 会合法使用这些；
   * 脏的大容器级固定 width/height 通常在 AI prompt 里已被「禁止写」，这里只兜底最恶劣的几个。
   */
  private static cleanDirtyAdvancedLayoutStyles(html: string, _layoutType: string): string {
    // 扫描每个标签的 style=""，把脏属性整条删除（注意保持其他 style 不变）
    return html.replace(
      /<([a-z][a-z0-9-]*)\b([^>]*)>/gi,
      (_tagMatch, tag: string, attrs: string) => {
        const styleMatch = attrs.match(/style="([^"]*)"/i);
        if (!styleMatch) return `<${tag}${attrs}>`;
        let style = styleMatch[1];
        const dropProps = [
          /(?:^|;)\s*max-width\s*:\s*none\s*(?=;|$)/gi,
          /(?:^|;)\s*max-height\s*:\s*none\s*(?=;|$)/gi,
          /(?:^|;)\s*overflow\s*:\s*visible\s*(?=;|$)/gi,
        ];
        for (const re of dropProps) style = style.replace(re, '');
        style = style.replace(/^;+|;+$/g, '').replace(/;;+/g, ';');
        const newAttrs = attrs.replace(/style="[^"]*"/i, `style="${style}"`);
        return `<${tag}${newAttrs}>`;
      },
    );
  }

  /**
   * 结构锚定修复：清理「泄漏到 `<svg>` 之外的 SVG 图形子元素」。
   *
   * 成因（pres_mu7skl55_0cmg3m7 slide-03「严重遮挡」的直接原因）：
   * 上游 wrapTextNodes 不认识 SVG 命名空间，把自闭合的 `<rect />` / `<path />`
   * 切成独立片段；再经 DOM 序列化后变成 HTML 未知元素 `<rect …>…</rect>` /
   * `<path …>…</path>`，并把随后的文字节点吞进自己内部，造成大面积错位与遮挡。
   *
   * 旧实现按**像素值**锚定（`width:22px` / `gap:12px`），8pt 网格归一后这些值被改写
   * （gap 12→8/16），修复完全失配；故改为按**结构**锚定：凡不在 `<svg>` 内的图形标签
   * 一律视为泄漏，剥离外壳、还原其内部的可见文字节点。
   *
   * 幂等：无泄漏时逐字节返回原串。
   */
  private static repairLeakedSvgShapes(html: string): string {
    const SHAPES = 'rect|path|circle|line|polyline|polygon|ellipse';
    const MASK = '@@NOPPT_SVG@@';
    // ① 先掩码合法的 <svg>…</svg> 区块（内部的图形标签是合法的，绝不能动）
    const blocks: string[] = [];
    const masked = html.replace(/<svg\b[\s\S]*?<\/svg>/gi, (block) => {
      blocks.push(block);
      return `${MASK}${blocks.length - 1}${MASK}`;
    });
    if (!new RegExp(`<(${SHAPES})\\b`, 'i').test(masked)) return html;

    let out = masked;
    // ② 成对形态 <rect …>…</rect>：剥掉外壳，还原内部可见文字
    out = out.replace(
      new RegExp(`<(${SHAPES})\\b[^>]*>([\\s\\S]*?)<\\/\\1\\s*>`, 'gi'),
      (_m: string, _tag: string, inner: string) => LayoutEngine.extractTextFromLeakedShape(inner),
    );
    // ③ 无配对的自闭合残留（<rect …/> / <rect …>）直接删除
    out = out.replace(new RegExp(`<(${SHAPES})\\b[^>]*>`, 'gi'), '');

    // ④ 还原被掩码的合法 svg
    if (blocks.length > 0) {
      out = out.replace(
        new RegExp(`${MASK}(\\d+)${MASK}`, 'g'),
        (_m: string, i: string) => blocks[Number(i)] ?? '',
      );
    }
    // ⑤ 「只包着一个 <svg> 的 <p>」解包：这层 <p> 是上游误包的产物，会凭空增加块级高度
    out = out.replace(/<p\b[^>]*>\s*(<svg\b[\s\S]*?<\/svg>)\s*<\/p>/gi, '$1');
    return out;
  }

  /** 从泄漏的图形元素内部还原可见文字：删空 <p>、解包非空 <p>，保留 LLM 原始 span/文本。 */
  private static extractTextFromLeakedShape(inner: string): string {
    return inner
      .replace(/<p\b[^>]*>\s*<\/p>/gi, '')
      .replace(/<p\b[^>]*>([\s\S]*?)<\/p>/gi, (_m: string, body: string) => body);
  }

  /**
   * comparison-deep-dive 行对齐：把左右两栏的 `<ul>` 改为等分行高的 grid。
   *
   * 原结构是 `display:flex;flex-direction:column` + 内容驱动的 li 高度，左右栏
   * 只要 padding / 图标尺寸 / 进度条高度有任何差异，第 i 行就会累积错位，两栏底边也不齐。
   * 改成 `grid-template-rows:repeat(N,1fr)` 后：
   *   - 同一个 ul 内所有行等高；
   *   - 左右两个 ul 处在 align-items:stretch 的双栏容器里、高度相同且行数相同
   *     （由 balanceComparisonDeepDiveLIs 保证）→ 左右第 i 行严格等高、顶部对齐；
   *   - 1fr 等价于 minmax(auto,1fr)，行高不会被压到内容以下，因此不会产生行内重叠。
   */
  private static alignComparisonDeepDiveRows(html: string): string {
    const uls = LayoutEngine.findUlBlocks(html);
    if (uls.length < 2) return html;
    const N = Math.max(uls[0].liCount, uls[1].liCount, 1);
    const ROWS = `repeat(${N},1fr)`;
    let out = html;
    // 从后往前替换，保证前面的 index 仍然有效
    for (let i = 1; i >= 0; i--) {
      const ul = uls[i];
      const styleMatch = ul.openTag.match(/style="([^"]*)"/i);
      let newOpen: string;
      if (styleMatch) {
        let body = styleMatch[1]
          .replace(/(?:^|;)\s*display\s*:\s*[^;]*/gi, '')
          .replace(/(?:^|;)\s*flex-direction\s*:\s*[^;]*/gi, '')
          .replace(/(?:^|;)\s*grid-template-rows\s*:\s*[^;]*/gi, '')
          .replace(/^;+|;+$/g, '')
          .replace(/;;+/g, ';');
        body = `${body};display:grid;grid-template-rows:${ROWS}`.replace(/^;+/, '');
        newOpen = ul.openTag.replace(/style="[^"]*"/i, `style="${body}"`);
      } else {
        newOpen = ul.openTag.replace(
          /\s*\/?>$/,
          ` style="display:grid;grid-template-rows:${ROWS}">`,
        );
      }
      if (newOpen === ul.openTag) continue;
      out = out.substring(0, ul.openIdx) + newOpen + out.substring(ul.openIdx + ul.openTag.length);
    }
    return out;
  }

  /** 收集 HTML 中所有顶层 `<ul>` 块（含嵌套 ul 的外层优先），返回位置与内部 li 数量。 */
  private static findUlBlocks(
    html: string,
  ): Array<{
    openIdx: number;
    openTag: string;
    closeIdx: number;
    body: string;
    liCount: number;
  }> {
    const result: Array<{
      openIdx: number;
      openTag: string;
      closeIdx: number;
      body: string;
      liCount: number;
    }> = [];
    const ulRe = /<ul\b([^>]*)>/gi;
    let m: RegExpExecArray | null;
    while ((m = ulRe.exec(html)) !== null) {
      const openIdx = m.index;
      const openTag = m[0];
      let dep = 1;
      const innerScan = /<(\/?)ul\b([^>]*)>/gi;
      innerScan.lastIndex = openIdx + openTag.length;
      let closeIdx = -1;
      let inner: RegExpExecArray | null;
      while ((inner = innerScan.exec(html)) !== null) {
        if (inner[1] === '/') {
          dep--;
          if (dep === 0) {
            closeIdx = inner.index;
            break;
          }
        } else if (!/\/\s*$/.test(inner[2] || '')) dep++;
      }
      if (closeIdx < 0) continue;
      const body = html.substring(openIdx + openTag.length, closeIdx);
      result.push({
        openIdx,
        openTag,
        closeIdx,
        body,
        liCount: (body.match(/<li\b/gi) || []).length,
      });
    }
    return result;
  }

  private static repairComparisonDeepDiveHtml(html: string): string {
    let result = html;

    // ——— 结构锚定：清理泄漏到 <svg> 之外的图形元素（替代旧的像素值锚定修复）———
    result = LayoutEngine.repairLeakedSvgShapes(result);

    // ——— FR-4 (fix-slide-comparison-image-disaster)：防御性清理两栏内"h3 ↔ ul 之间被入侵的 <img>" ———
    // 比较版式（comparison-deep-dive）的左右栏卡片内部禁止任何插图；若 LLM 在闭环中自发
    // 把图塞到 h3 与 ul 之间，直接把图及其包裹 div 整体移除，保持 5 条进度条不被裁切。
    result = LayoutEngine.sanitizeComparisonColumnInjectedImages(
      result,
      'right',
      /<div\b([^>]*)>/gi,
      (attrs1: string) =>
        /background\s*:\s*linear-gradient\s*\(\s*135deg\s*,\s*#0891b206\s*,\s*#0891b20A\s*\)/i.test(
          attrs1,
        ) && /box-shadow\s*:\s*0\s*8px\s*28px\s*#0891b218/i.test(attrs1),
    );
    result = LayoutEngine.sanitizeComparisonColumnInjectedImages(
      result,
      'left',
      /<div\b([^>]*)>/gi,
      (attrs2: string) =>
        /background\s*:\s*#F9FAFB/i.test(attrs2) &&
        /border\s*:\s*2px\s*solid\s*#E5E7EB/i.test(attrs2),
    );

    result = result.replace(/<p\b[^>]*>\s*<\/p>/gi, '');

    // 泄漏的 <rect> 被剥离后，左栏「灰底横杠」图标会变成空 <svg>；此处按 width 还原标准图形
    result = result.replace(
      /(<svg\b[^>]*width="10"[^>]*>)\s*(<\/svg>)/gi,
      '$1<rect x="2" y="4.5" width="6" height="1.5" rx="0.75" fill="#9CA3AF"/>$2',
    );

    result = result.replace(
      /(<svg\b[^>]*width="14"[^>]*>)\s*(<\/svg>)/gi,
      '$1<path d="M13 4L6.5 10.5L3 7" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>$2',
    );

    result = result.replace(
      /(<svg\b[^>]*width="15"[^>]*>)\s*(<\/svg>)/gi,
      '$1<path d="M13 4L6.5 10.5L3 7" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>$2',
    );

    // 合并 3+ 空行为 1 行（保持 diff 可读，不影响结构）
    result = result.replace(/\n[ \t]*(?:\r?\n[ \t]*){2,}/g, '\n\n');

    return result;
  }

  /**
   * FR-4 (fix-slide-comparison-image-disaster) 辅助：
   * 扫描 HTML，找到 attrsPredicate 匹配的那根 comparison 栏卡片，
   * 在该卡片内部的 <\/h3> … <ul 区间里把所有包含 <img> 的最内层包裹 div + <img> 移除，
   * 保留 h3 与 <ul> 本体及正常的纯文本/行内样式节点。
   * 不对 <ul> 内部做任何改动。若没有命中卡片或无 img → 返回原值（幂等）。
   */
  private static sanitizeComparisonColumnInjectedImages(
    html: string,
    _side: 'left' | 'right',
    divOpenRe: RegExp,
    attrsPredicate: (attrs: string) => boolean,
  ): string {
    if (!html) return html;
    const flagsRe = /<div\b([^>]*)>/gi;
    void divOpenRe; // 统一用 flagsRe 并在回调内部用 attrsPredicate 判定，避免 g 状态问题
    flagsRe.lastIndex = 0;
    let m: RegExpExecArray | null;
    const matches: Array<{ openIdx: number; openTagLen: number; attrs: string; closeIdx: number }> =
      [];
    // 第一轮：定位所有 <div 开标签 + attrs
    while ((m = flagsRe.exec(html)) !== null) {
      const attrs = m[1] || '';
      if (!attrsPredicate(attrs)) continue;
      const openIdx = m.index;
      const openTagLen = m[0].length;
      // 匹配对应的 </div>（用 stack，因为卡片内部还有 li/div 等嵌套）
      let depth = 1;
      const innerScan = /<(\/?)div\b([^>]*)>/gi;
      innerScan.lastIndex = openIdx + openTagLen;
      let closeIdx = -1;
      let inner: RegExpExecArray | null;
      while ((inner = innerScan.exec(html)) !== null) {
        if (inner[1] === '/') {
          depth--;
          if (depth === 0) {
            closeIdx = inner.index;
            break;
          }
        } else if (!/\/\s*$/.test(inner[2] || '')) {
          depth++;
        }
      }
      if (closeIdx < 0) continue;
      matches.push({ openIdx, openTagLen, attrs, closeIdx });
    }
    if (matches.length === 0) return html;
    // 从后往前替换，保持 index 不变
    let out = html;
    for (let i = matches.length - 1; i >= 0; i--) {
      const { openIdx, openTagLen, closeIdx } = matches[i];
      const cardInner = out.substring(openIdx + openTagLen, closeIdx);
      // 在卡片内部找 </h3> ... <ul 片段
      const gapRe = /(<\/h3\s*>)([\s\S]*?)(?=<ul\b)/i;
      if (!gapRe.test(cardInner)) continue;
      const newCardInner = cardInner.replace(gapRe, (_whole, h3Close: string, between: string) => {
        if (!/<img\b/i.test(between)) return `${h3Close}${between}`;
        // 把 between 中所有"包裹 <img 的最外层 div"以及裸 <img> 都剥掉。
        // 策略：对每个 <img 位置，找到包含它的"最外层 <div>"，收集非重叠的移除区间，
        // 最后统一倒序切片；残留的无 div 包裹裸 <img> 再兜底移除。
        let cleaned = between;
        type Range = { start: number; end: number };
        // (1) 收集 <img 位置列表
        const imgPositions: number[] = [];
        const imgRe = /<img\b/gi;
        let imgMatch: RegExpExecArray | null;
        while ((imgMatch = imgRe.exec(cleaned)) !== null) {
          imgPositions.push(imgMatch.index);
        }
        // (2) 对每个 <img 位置，找包含它的最外层 <div>，收集互斥区间
        const removeRanges: Range[] = [];
        for (const pos of imgPositions) {
          if (removeRanges.some((r) => pos >= r.start && pos < r.end)) continue;
          // 找包住 pos 的最外层 <div 开标签：要求其在 pos 之前、且其匹配的 </div> 在 pos 之后
          const divOpenRe = /<div\b([^>]*)>/gi;
          let outermostStart = -1;
          let outermostEnd = -1;
          let dOpen: RegExpExecArray | null;
          while ((dOpen = divOpenRe.exec(cleaned)) !== null) {
            if (dOpen.index >= pos) break;
            const attrs = dOpen[1] || '';
            if (/\/\s*$/.test(attrs)) continue;
            // 配对 </div>
            let depth = 1;
            const pairRe = /<(\/?)div\b([^>]*)>/gi;
            pairRe.lastIndex = dOpen.index + dOpen[0].length;
            let p: RegExpExecArray | null;
            let matchedClose: { index: number; len: number } | null = null;
            while ((p = pairRe.exec(cleaned)) !== null) {
              if (p[1] === '/') {
                if (--depth === 0) {
                  matchedClose = { index: p.index, len: p[0].length };
                  break;
                }
              } else if (!/\/\s*$/.test(p[2] || '')) {
                depth++;
              }
            }
            if (!matchedClose) continue;
            const end = matchedClose.index + matchedClose.len;
            if (pos >= dOpen.index && pos < end) {
              // 更外层（start 更小、end 更大或相等）
              if (outermostStart < 0 || dOpen.index < outermostStart) {
                outermostStart = dOpen.index;
                outermostEnd = end;
              }
            }
          }
          if (outermostStart >= 0 && outermostEnd > outermostStart) {
            removeRanges.push({ start: outermostStart, end: outermostEnd });
          }
        }
        // (3) 倒序移除
        if (removeRanges.length > 0) {
          removeRanges.sort((a, b) => b.start - a.start);
          for (const r of removeRanges) {
            cleaned = cleaned.substring(0, r.start) + cleaned.substring(r.end);
          }
        }
        // (4) 残余的裸 <img/> / <img ...></img> 兜底剥掉
        cleaned = cleaned.replace(/<img\b[\s\S]*?(?:\/\s*>|<\/img>)/gi, '');
        // (3) 合并多余空白行（保留 1 行）
        cleaned = cleaned.replace(/\n[ \t]*(?:\r?\n[ \t]*){2,}/g, '\n\n');
        // (4) 去掉只剩空白的孤立 `margin-bottom:16px` style 残留
        cleaned = cleaned.replace(
          /<div\b[^>]*style\s*=\s*"[^"]*margin-bottom\s*:\s*\d+px[^"]*"[^>]*>\s*<\/div>/gi,
          '',
        );
        return `${h3Close}${cleaned}`;
      });
      if (newCardInner === cardInner) continue;
      out = out.substring(0, openIdx + openTagLen) + newCardInner + out.substring(closeIdx);
    }
    return out;
  }

  private static extractLiTexts(ulBody: string): string[] {
    const texts: string[] = [];
    const liRe = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
    let m: RegExpExecArray | null;
    while ((m = liRe.exec(ulBody)) !== null) {
      const inner = m[1];
      const spans = inner.match(/<span\b[^>]*>([\s\S]*?)<\/span>/gi);
      let label = '';
      if (spans) {
        for (const s of spans) {
          const t = s.replace(/<[^>]+>/g, '').trim();
          if (t && !t.includes('胜出') && !t.startsWith('+') && !/^\d+%$/.test(t)) {
            label = t;
            break;
          }
        }
      }
      if (!label) {
        label = inner.replace(/<[^>]+>/g, '').trim();
      }
      if (label) texts.push(label);
    }
    return texts;
  }

  private static balanceComparisonDeepDiveLIs(html: string): string {
    // 复用 findUlBlocks（与 alignComparisonDeepDiveRows 同一套定位逻辑，避免两处漂移）
    const all = LayoutEngine.findUlBlocks(html);
    if (all.length < 2) return html;
    const uls = all.slice(0, 2).map((u) => ({
      open: u.openTag,
      close: `</ul>`,
      openIdx: u.openIdx,
      closeIdx: u.closeIdx,
      liCount: u.liCount,
      body: u.body,
    }));
    const [ulL, ulR] = uls;
    const N = Math.max(ulL.liCount, ulR.liCount, 3);

    const leftLabels = LayoutEngine.extractLiTexts(ulL.body);

    const leftPlaceholder = (
      _idx: number,
      label: string,
    ) => `<li style="display:flex;flex-direction:column;gap:8px;padding:16px 20px;border-radius:12px;background:#FFFFFF;border:1px dashed #D1D5DB;min-width:0;overflow-wrap:break-word;word-break:break-word;opacity:0.65;">
  <div style="display:flex;align-items:center;gap:12px;">
    <span style="display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:22px;height:22px;border-radius:50%;background:#F3F4F6;">
      <svg width="10" height="10" viewBox="0 0 10 10"><rect x="2" y="4.5" width="6" height="1.5" rx="0.75" fill="#9CA3AF"/></svg>
    </span>
    <span style="font-size:20px;font-weight:600;color:#9CA3AF;line-height:1.4;flex:1;min-width:0;overflow-wrap:break-word;word-break:break-word">${label}</span>
  </div>
  <div style="width:100%;height:8px;border-radius:999px;background:#F3F4F6;overflow:hidden;">
    <div style="pointer-events:none;width:0%;height:100%;border-radius:999px;background:#D1D5DB;"></div>
  </div>
</li>`;

    const rightPlaceholder = (
      _idx: number,
      label: string,
    ) => `<li style="display:flex;flex-direction:column;gap:8px;padding:16px 20px;border-radius:12px;background:#FFFFFF;border:1px dashed #D1D5DB;min-width:0;overflow-wrap:break-word;word-break:break-word;opacity:0.65;">
  <div style="display:flex;align-items:center;gap:12px;">
    <span style="display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:22px;height:22px;border-radius:50%;background:#F3F4F6;">
      <svg width="10" height="10" viewBox="0 0 10 10"><rect x="2" y="4.5" width="6" height="1.5" rx="0.75" fill="#9CA3AF"/></svg>
    </span>
    <span style="font-size:20px;font-weight:600;color:#9CA3AF;line-height:1.4;flex:1;min-width:0;overflow-wrap:break-word;word-break:break-word">${label}</span>
  </div>
  <div style="width:100%;height:8px;border-radius:999px;background:#F3F4F6;overflow:hidden;">
    <div style="pointer-events:none;width:0%;height:100%;border-radius:999px;background:#D1D5DB;"></div>
  </div>
</li>`;

    const buildPatch = (ul: typeof ulL, isLeft: boolean): string => {
      if (ul.liCount >= N) return '';
      const extras: string[] = [];
      for (let i = ul.liCount; i < N; i++) {
        const label = isLeft
          ? leftLabels[i] || `对比维度 ${i + 1}`
          : leftLabels[i] || `对比维度 ${i + 1}`;
        extras.push(isLeft ? leftPlaceholder(i, label) : rightPlaceholder(i, label));
      }
      return extras.join('\n');
    };

    const leftPatch = buildPatch(ulL, true);
    const rightPatch = buildPatch(ulR, false);
    if (!leftPatch && !rightPatch) return html;

    const patchAt = (idx: number, patch: string): string => {
      if (!patch) return html;
      return html.substring(0, idx) + patch + html.substring(idx);
    };
    html = patchAt(ulR.closeIdx, rightPatch);
    html = patchAt(ulL.closeIdx, leftPatch);
    return html;
  }

  static normalizeAISlide(slide: Slide): Slide {
    // ——— 防御闭环项 5：前置空白裁剪。真实世界中 HTML 可能来自模板字符串首行、
    // 审计闭环 regenerate 产物拼接、editor 端草稿保存等不同路径，如果开头残留空白，
    // data-layout 路由正则的 ^ 锚就无法识别，高级版式会掉进通用 flatten 链，
    // FR-4 repairComparisonDeepDiveHtml / balanceComparisonDeepDiveLIs 等修复永远不触发。
    let html = (typeof slide.html === 'string' ? slide.html : '').replace(/^\s+/, '');
    html = removeDangerousContent(html);

    // ========== 🚀 L1 data-layout 路由：高级版式走轻量分支，跳过 flatten ==========
    // 判定：开头 <tag...> 里有没有 data-layout 且值在 ADVANCED_LAYOUTS 白名单中
    const layoutMatch =
      /^<\s*(?:div|section|article)\b[^>]*\bdata-layout\s*=\s*["']?([a-z0-9-]+)["']?[^>]*>/i.exec(
        html,
      );
    const isAdvancedLayout =
      layoutMatch && LayoutEngine.ADVANCED_LAYOUTS.has(layoutMatch[1].toLowerCase());

    if (isAdvancedLayout) {
      html = LayoutEngine.normalizeOuterContainerForAdvancedLayout(html);
      html = LayoutEngine.cleanDirtyAdvancedLayoutStyles(
        html,
        layoutMatch?.[1]?.toLowerCase() ?? '',
      );
      if (layoutMatch?.[1]?.toLowerCase() === 'comparison-deep-dive') {
        html = LayoutEngine.repairComparisonDeepDiveHtml(html);
        html = LayoutEngine.balanceComparisonDeepDiveLIs(html);
        // 行对齐必须在 li 数量补齐之后执行：行数 N 由补齐后的 li 数决定
        html = LayoutEngine.alignComparisonDeepDiveRows(html);
      }
    } else {
      // 普通版式：走原来的 normalizeOuterContainer（含 flatten），保持向后兼容
      html = normalizeOuterContainer(html);
    }

    // 构图护栏（web 编辑态重归一化）：保守移除根容器居中三件套——仅当页面含内容标记且非纯标题页时。
    // 纯封面（仅 H1）保持居中，避免误伤；真正的左对齐裁断由管线 postProcessLayout 的 applyCompositionGuard 完成。
    html = applyCompositionGuard(html);

    // 以下步骤对两种版式都生效（它们不破坏结构，只做安全/溢出/裸文本兜底）：
    html = enforceFlatStructure(html);
    html = unwrapIconWrappingParagraph(html);
    html = enforceImageStyles(html, { borderRadius: '12px', addDataImageRatio: false });
    html = enforceFlexChildrenMinWidth(html);
    html = enforceTextWrapping(html);
    html = removeForcedCardHeight(html);
    html = enforceGridLayout(html);
    html = enforceMinFontSize(html, 14);
    html = cleanupEmptyDivs(html);
    html = cleanupEmptyInlineTags(html);
    html = repairEmptySvgs(html);
    // FR-2 / Task 3 + 4: 推断主色后统一补标图标色，避免写死 DEFAULT_BLUE 跨色相污染（如橙底蓝字）。
    const primary = inferPrimaryColor(html);
    html = repairTrivialSvgIcons(html, primary);
    html = normalizeIconGroups(html, primary);
    html = enforceBareTextToParagraphs(html);
    // preventContentImageTopOverflow 只会命中 H2 + flex:0 0 XX% 图片包裹 + 单列长列表的组合，
    // 对高级版式（双栏对比/Z 字/数值大卡/背景图）的 probe 永远返回 null，不会误伤创意布局。
    html = preventContentImageTopOverflow(html);

    return {
      ...slide,
      html,
      updatedAt: Date.now(),
    };
  }
}

export { generatePresentationId, generateId };

