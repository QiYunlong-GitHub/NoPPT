// 参考 HTML 单分类提取（Task 2 / FR-1 / FR-9 / FR-11.2 / C-1~C-14）
// 独立 export 函数，JSDOM 全文解析（不抽样），供 ai.service 与 Vitest 直接调用。
import { JSDOM } from 'jsdom';
import {
  CategoryReference,
  IconStyle,
  LayoutSkeletonType,
  ReferenceLayout,
  ReferenceMaster,
  ReferencePageHints,
  ReferencePalette,
  ReferenceStructure,
  ReferenceStyle,
  ReferenceStyleAttrs,
  ReferenceVisualFeatures,
} from '../types';
import { buildSkeletonSnippet } from './reference-structure-snippet';
import {
  buildCascadeIndex,
  resolveComputedDecl,
  toHex,
  firstColorIn,
  CascadeIndex,
} from './reference-style-cascade';

// ---------- 颜色工具 ----------
function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function isGray(h: string): boolean {
  const [r, g, b] = rgb(h);
  return Math.max(r, g, b) - Math.min(r, g, b) < 24;
}
function isNearBlack(h: string): boolean {
  const [r, g, b] = rgb(h);
  // 放宽阈值：#0f172a 这类极深藏蓝(b=42)也应视为近黑，作为兜底候选，
  // 避免大面积深色背景被误选为主色（主色应优先取彩色品牌色）。
  return r < 50 && g < 50 && b < 50;
}
function isNearWhite(h: string): boolean {
  const [r, g, b] = rgb(h);
  return r > 215 && g > 215 && b > 215;
}
function isExcludedColor(h: string): boolean {
  return isGray(h) || isNearBlack(h) || isNearWhite(h);
}
function hueOf(h: string): number {
  const [r, g, b] = rgb(h).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return -1;
  let h2 = 0;
  if (max === r) h2 = ((g - b) / d) % 6;
  else if (max === g) h2 = (b - r) / d + 2;
  else h2 = (r - g) / d + 4;
  h2 *= 60;
  return h2 < 0 ? h2 + 360 : h2;
}

// ---------- 画布识别（FR-参考克隆：取真实画布而非预览台 body）----------
function chromaOf(h: string): number {
  const [r, g, b] = rgb(h);
  return Math.max(r, g, b) - Math.min(r, g, b);
}
function lumOf(h: string): number {
  const [r, g, b] = rgb(h);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}
function colorDistance(a: string, b: string): number {
  const [r1, g1, b1] = rgb(a);
  const [r2, g2, b2] = rgb(b);
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
}

/**
 * 识别参考 HTML 的「真实画布」：优先 .slide / [data-slide-index] / [data-page-type]，
 * 多 .slide 时取子元素最多的（面积/信息量最大），否则回退 body 首屏子元素，再回退 body。
 * 这是修正 backgroundTone / 装饰 / 构图 的根基——模板的 body 往往是预览台深色底。
 */
function pickCanvasElement(doc: Document): Element {
  const slideSel = doc.querySelectorAll('.slide');
  if (slideSel.length === 1) return slideSel[0];
  if (slideSel.length > 1) {
    let best = slideSel[0];
    let bestN = -1;
    slideSel.forEach((s) => {
      const n = s.querySelectorAll('*').length;
      if (n > bestN) {
        bestN = n;
        best = s;
      }
    });
    return best;
  }
  const byIndex = doc.querySelector('[data-slide-index]');
  if (byIndex) return byIndex;
  const byPage = doc.querySelector('[data-page-type]');
  if (byPage) return byPage;
  const main = doc.querySelector('main.slide, main');
  if (main) return main;
  const body = doc.body;
  if (body && body.children.length) return body.children[0] as Element;
  return body;
}

// 图文槽位方位（修正左右镜像）：优先 class 关键字，再回退级联的 left/right/top/bottom。
function getImageSide(canvas: Element, cascade?: CascadeIndex): 'left' | 'right' | 'top' | 'bottom' | undefined {
  const imgEl =
    canvas.querySelector('img') ||
    canvas.querySelector('[class*="img"],[class*="image"],[class*="photo"],[class*="pic"],[class*="figure"]');
  if (!imgEl) return undefined;
  const cls = (imgEl.getAttribute('class') || '').toLowerCase();
  if (/right/.test(cls)) return 'right';
  if (/left/.test(cls)) return 'left';
  if (/top/.test(cls)) return 'top';
  if (/bottom/.test(cls)) return 'bottom';
  if (cascade) {
    const r = resolveComputedDecl(imgEl, 'right', '', cascade);
    const l = resolveComputedDecl(imgEl, 'left', '', cascade);
    const t = resolveComputedDecl(imgEl, 'top', '', cascade);
    const b = resolveComputedDecl(imgEl, 'bottom', '', cascade);
    if (r && r !== 'auto') return 'right';
    if (l && l !== 'auto') return 'left';
    if (t && t !== 'auto') return 'top';
    if (b && b !== 'auto') return 'bottom';
  }
  return 'right';
}

function buildLayoutVerbal(
  visual: ReferenceVisualFeatures,
  imageSide?: string,
  hasImageSlot?: boolean,
): string {
  const comp = visual.composition;
  if (comp === 'split') return `分栏构图${hasImageSlot ? `（图文分栏，图区位于${imageSide || '右'}侧）` : '（左右/上下分栏）'}`;
  if (comp === 'full-bleed') return '全幅构图（内容铺满画布）';
  if (comp === 'centered') return '居中构图';
  return '左对齐构图';
}

function buildDecorationVerbal(visual: ReferenceVisualFeatures, palette?: ReferencePalette): string {
  const parts: string[] = [];
  const decoMap: Record<string, string> = {
    'geometric-shapes': '几何形状装饰（色块/波浪线/圆点阵/粗描边）',
    'gradient-glow': '渐变光晕装饰',
    'thin-lines': '细线条装饰',
    'solid-blocks': '实色块装饰',
    minimal: '极简装饰',
  };
  if (visual.decoration) parts.push(decoMap[visual.decoration] || visual.decoration);
  if (visual.backgroundTone) parts.push(`背景调性=${visual.backgroundTone}`);
  if (palette?.strokeColor) parts.push(`粗描边=${palette.strokeColor}`);
  if (palette?.accents?.length) parts.push(`撞色调色板=${palette.accents.join('/')}`);
  return parts.join('；');
}

// ---------- 调色板提取（主色 + 撞色 accent + 描边色 + 画布背景）----------
function extractColorPalette(
  doc: Document,
  cascade: CascadeIndex | undefined,
  canvas: Element,
): ReferencePalette {
  const weightByColor: Record<string, number> = {};
  const consider = (raw: string | undefined, weight: number) => {
    const hex = toHex(raw || '');
    if (!hex) return;
    if (isGray(hex)) return; // 调色板只要彩色，中性灰阶不入
    weightByColor[hex] = (weightByColor[hex] || 0) + weight;
  };
  doc.querySelectorAll('*').forEach((el) => {
    const s = (el as HTMLElement).getAttribute('style') || '';
    const mBg = s.match(/background(?:-color)?\s*:\s*([^;]+)/i);
    if (mBg) consider(firstColorIn(mBg[1] ?? ''), 3);
    const mBorder = s.match(/border[^;]*?(#[0-9a-fA-F]{6})\b/i);
    if (mBorder) consider(mBorder[1], 1);
    const mColor = s.match(/color\s*:\s*([^;]+)/i);
    if (mColor) consider(firstColorIn(mColor[1] ?? ''), 1);
    if (cascade) {
      const cb = resolveComputedDecl(el, 'background-color', '', cascade) || resolveComputedDecl(el, 'background', '', cascade);
      if (cb) consider(firstColorIn(cb), 3);
      const cc = resolveComputedDecl(el, 'color', '', cascade);
      if (cc) consider(cc, 1);
      const bcol = resolveComputedDecl(el, 'border-color', '', cascade) || resolveComputedDecl(el, 'border', '', cascade);
      if (bcol) {
        const h = firstColorIn(bcol);
        if (h) consider(h, 1);
      }
    }
  });
  if (cascade) {
    for (const [k, v] of Object.entries(cascade.vars)) {
      if (/primary|brand|accent|color|theme/i.test(k)) consider(v, 5);
    }
  }
  const primary = extractPrimaryColor(doc, cascade);
  const candidates = Object.entries(weightByColor)
    .filter(([h]) => h !== primary)
    .map(([h, w]) => ({ h, w }))
    .filter((e) => chromaOf(e.h) >= 30 && lumOf(e.h) > 0.08 && lumOf(e.h) < 0.95)
    .sort((a, b) => b.w - a.w);
  const accents: string[] = [];
  for (const e of candidates) {
    if (accents.every((a) => colorDistance(a, e.h) > 40)) accents.push(e.h);
    if (accents.length >= 5) break;
  }
  // 粗描边色（孟菲斯 border:4px solid）
  let strokeColor: string | undefined;
  let maxBW = 0;
  doc.querySelectorAll('*').forEach((el) => {
    const s = (el as HTMLElement).getAttribute('style') || '';
    const m = s.match(/border\s*:\s*(\d+)px\s+(?:solid|dashed|dotted)\s*(#[0-9a-fA-F]{6})/i);
    if (m && parseInt(m[1], 10) >= 3 && parseInt(m[1], 10) > maxBW) {
      maxBW = parseInt(m[1], 10);
      strokeColor = m[2].toLowerCase();
    }
    if (cascade) {
      const b = resolveComputedDecl(el, 'border', '', cascade);
      const mm = b && b.match(/(\d+)px\s+(?:solid|dashed|dotted)\s*(#[0-9a-fA-F]{6})/i);
      if (mm && parseInt(mm[1], 10) >= 3 && parseInt(mm[1], 10) > maxBW) {
        maxBW = parseInt(mm[1], 10);
        strokeColor = mm[2].toLowerCase();
      }
    }
  });
  // 画布背景
  let canvasBg: string | undefined;
  const cs = (canvas as HTMLElement).getAttribute('style') || '';
  const mBg = cs.match(/background(?:-color)?\s*:\s*([^;]+)/i);
  if (mBg) canvasBg = toHex(firstColorIn(mBg[1] ?? '') ?? '');
  if (!canvasBg && cascade) {
    const c = (resolveComputedDecl(canvas, 'background-color', '', cascade) || resolveComputedDecl(canvas, 'background', '', cascade) || '');
    if (c) canvasBg = toHex(firstColorIn(c) ?? '');
  }
  let maxPair = 0;
  for (let i = 0; i < accents.length; i++) {
    for (let j = i + 1; j < accents.length; j++) {
      maxPair = Math.max(maxPair, colorDistance(accents[i], accents[j]));
    }
  }
  return {
    primary: primary || '#888888',
    accents,
    strokeColor,
    canvasBg,
    isMultiColor: accents.length >= 2 && maxPair > 80,
  };
}

// ---------- C-1 主色（加权：背景/渐变 > 边框/文字；CSS 变量 --primary 等强候选；灰阶仅作兜底）----------
function extractPrimaryColor(doc: Document, cascade?: CascadeIndex): string | undefined {
  const colorSet: Record<string, number> = {};
  const fallbackSet: Record<string, number> = {};
  const consider = (raw: string | undefined, weight: number) => {
    if (!raw) return;
    const hex = toHex(raw);
    if (!hex) return;
    if (isExcludedColor(hex)) fallbackSet[hex] = (fallbackSet[hex] || 0) + weight;
    else colorSet[hex] = (colorSet[hex] || 0) + weight;
  };
  doc.querySelectorAll('*').forEach((el) => {
    const s = (el as HTMLElement).getAttribute('style') || '';
    const mBg = s.match(/background(?:-color)?\s*:\s*([^;]+)/i);
    if (mBg) consider(firstColorIn(mBg[1]), 3);
    const mBc = s.match(/border(?:-bottom|-top|-left|-right)?-color\s*:\s*([^;]+)/i);
    if (mBc) consider(mBc[1], 1);
    const mColor = s.match(/color\s*:\s*([^;]+)/i);
    if (mColor) consider(mColor[1], 1);
    if (cascade) {
      const cb = resolveComputedDecl(el, 'background-color', '', cascade) || resolveComputedDecl(el, 'background', '', cascade);
      if (cb) consider(firstColorIn(cb), 3);
      const cc = resolveComputedDecl(el, 'color', '', cascade);
      if (cc) consider(cc, 1);
    }
  });
  if (cascade) {
    for (const [k, v] of Object.entries(cascade.vars)) {
      if (/primary|brand|accent|color|theme/i.test(k)) consider(v, 5);
    }
  }
  const pick = (set: Record<string, number>): string | undefined => {
    const e = Object.entries(set).sort((a, b) => b[1] - a[1]);
    return e.length ? e[0][0] : undefined;
  };
  return pick(colorSet) || pick(fallbackSet);
}

// ---------- C-1b 文字色（标题/正文，允许近黑/白/灰，不复用 isExcludedColor）----------
function extractTextColorBySelector(doc: Document, selector: string, cascade?: CascadeIndex): string | undefined {
  const freq: Record<string, number> = {};
  doc.querySelectorAll(selector).forEach((el) => {
    const s = (el as HTMLElement).getAttribute('style') || '';
    let hex = toHex((s.match(/color\s*:\s*([^;]+)/i)?.[1] || '').trim());
    if (!hex && cascade) {
      const c = resolveComputedDecl(el, 'color', '', cascade);
      if (c) hex = toHex(c);
    }
    if (hex) freq[hex] = (freq[hex] || 0) + 1;
  });
  const entries = Object.entries(freq).sort((a, b) => b[1] - a[1]);
  return entries.length ? entries[0][0] : undefined;
}
/** 标题色：取 h1/h2/h3 上显式声明的 color（允许近黑/白/灰）。 */
function extractTitleColor(doc: Document, cascade?: CascadeIndex): string | undefined {
  return extractTextColorBySelector(doc, 'h1, h2, h3', cascade);
}
/** 正文色：取 li/p 上显式声明的 color（允许近黑/白/灰）。 */
function extractBodyColor(doc: Document, cascade?: CascadeIndex): string | undefined {
  return extractTextColorBySelector(doc, 'li, p', cascade);
}

// ---------- C-2 字体（内联 + 级联）----------
function extractFontFamily(doc: Document, cascade?: CascadeIndex): 'sans' | 'serif' | 'mono' | undefined {
  let serif = 0;
  let mono = 0;
  let sans = 0;
  const tally = (f: string) => {
    const ff = f.toLowerCase();
    if (ff.includes('monospace')) mono++;
    else if (ff.includes('sans-serif') || ff === 'sans') sans++;
    else if (ff.includes('serif')) serif++;
  };
  doc.querySelectorAll('*').forEach((el) => {
    const m = ((el as HTMLElement).getAttribute('style') || '').match(/font-family\s*:\s*([^;]+)/i);
    if (m) tally(m[1]);
    if (cascade) {
      const c = resolveComputedDecl(el, 'font-family', '', cascade);
      if (c) tally(c);
    }
  });
  if (mono > 0 && mono >= serif && mono >= sans) return 'mono';
  if (serif > 0 && serif >= sans) return 'serif';
  if (sans > 0) return 'sans';
  return undefined;
}

// ---------- C-3 密度 ----------
function extractDensity(doc: Document): 'compact' | 'normal' | 'spacious' {
  const lis = doc.querySelectorAll('li');
  const liCount = lis.length;
  let padSum = 0;
  let padN = 0;
  let fsSum = 0;
  let fsN = 0;
  doc.querySelectorAll('li, p, div').forEach((el) => {
    const s = (el as HTMLElement).style;
    const p = parseInt(s.padding || s.paddingTop || '', 10);
    if (!Number.isNaN(p)) {
      padSum += p;
      padN++;
    }
    const fs = parseInt(s.fontSize || '', 10);
    if (!Number.isNaN(fs)) {
      fsSum += fs;
      fsN++;
    }
  });
  const avgPad = padN ? padSum / padN : 0;
  const avgFs = fsN ? fsSum / fsN : 0;
  if (liCount >= 6 && avgPad >= 20 && avgFs >= 16) return 'compact';
  if (liCount <= 2 && avgPad >= 50 && avgFs >= 18) return 'spacious';
  return 'normal';
}

// ---------- C-4 图标（class 优先 + 圆形几何；补 line 兜底）----------
function isCircleEl(el: Element, cascade?: CascadeIndex): boolean {
  const cs = (el as HTMLElement).getAttribute('style') || '';
  if (/border-radius\s*:\s*(50%|[4-9]\dpx|1\d\dpx)/i.test(cs)) return true;
  if (cascade) {
    const cr = resolveComputedDecl(el, 'border-radius', '', cascade);
    if (cr && /(50%|[4-9]\dpx|1\d\dpx)/i.test(cr)) return true;
  }
  return false;
}
function extractIconStyle(doc: Document, cascade?: CascadeIndex): IconStyle {
  const html = doc.documentElement.outerHTML;
  if (/number-circle|number_circle|large-number|large_number/i.test(html)) return 'numbered';
  if (/letter-circle|letter_circle/i.test(html)) return 'lettered';
  if (/icon-style[^-a-z]*dot|class="[^"]*\bdot\b/i.test(html)) return 'bullet';
  // 候选：含 border-radius:50% 圆、或语义类 idx/number/circle（其圆角可能写在 <style> 内，需级联解析）
  const candidates = Array.from(
    doc.querySelectorAll(
      '[style*="border-radius"], [class*="idx"], [class*="number"], [class*="circle"], [class*="bullet"], [class*="dot"]',
    ),
  );
  for (const c of candidates) {
    if (!isCircleEl(c, cascade)) continue;
    const txt = (c.textContent || '').trim();
    if (/^\d+$/.test(txt)) return 'numbered';
    if (/^[A-Za-z]$/.test(txt)) return 'lettered';
    return 'bullet';
  }
  if (/<svg/i.test(html)) return 'line';
  return 'line'; // 兜底（TR-2.3 要求线性 svg 默认 line）
}

// ---------- C-5 风格 ----------
function extractStyle(doc: Document, style: ReferenceStyleAttrs): ReferenceStyle | undefined {
  const html = doc.documentElement.outerHTML.toLowerCase();
  const hasGradient = /gradient/.test(html);
  const pc = style.primaryColor;
  if (pc) {
    const hue = hueOf(pc);
    if (hue >= 260 && hue <= 320 && hasGradient) return 'creative';
    if (hue >= 200 && hue <= 255) return style.fontFamily === 'serif' ? 'academic' : 'business';
  }
  if (hasGradient) return 'creative';
  return undefined;
}

// ---------- C-6 配图分布 ----------
function extractImagePreference(
  doc: Document,
  slideCount: number,
  hasImageSlot: boolean,
): ReferenceStyleAttrs['imagePreference'] {
  const imgs = doc.querySelectorAll('img');
  // 参考用 SVG 占位/图片区（未用 <img>）时，仍视为「有图文槽位」→ 允许内容页配图，
  // 避免把参考的「右图」结构废掉（旧逻辑只数 <img> 会误判 none）。
  if (imgs.length === 0) return hasImageSlot ? 'content-only' : 'none';
  if (imgs.length === 1) return 'minimal';
  const ratio = imgs.length / Math.max(slideCount, 1);
  if (ratio >= 1.5) return 'all';
  if (ratio >= 1) return 'content-only';
  return 'minimal';
}

// ---------- C-7 背景 ----------
function extractBackgroundEnabled(doc: Document): boolean {
  const html = doc.documentElement.outerHTML.toLowerCase();
  return /background-image|background:\s*url|<div[^>]*background|backgroundprompt/.test(html) || /gradient/.test(html);
}

// ---------- C-8 pageHints ----------
function extractPageHints(pageTypeSetSize: number): ReferencePageHints | undefined {
  if (pageTypeSetSize >= 4) return { disableCover: true, disableToc: true, disableConclusion: true };
  return undefined;
}

// ---------- C-9 slideCount ----------
function extractSlideCount(doc: Document, slides: Element[]): number | undefined {
  if (slides.length >= 1) {
    let max = slides.length;
    slides.forEach((s) => {
      const idx = (s as HTMLElement).getAttribute('data-slide-index');
      if (idx != null) max = Math.max(max, parseInt(idx, 10) + 1);
    });
    return max;
  }
  const ptEls = doc.querySelectorAll('[data-page-type]');
  const set = new Set(Array.from(ptEls).map((p) => (p as HTMLElement).getAttribute('data-page-type') || ''));
  if (set.size >= 3) return set.size;
  return undefined;
}

// ---------- C-13 母版 ----------
function logoPosition(img: Element): NonNullable<ReferenceMaster['logo']>['position'] {
  const cls = `${img.className || ''} ${(img.parentElement?.className || '')}`.toLowerCase();
  if (cls.includes('right')) return 'top-right';
  if (cls.includes('bottom')) return 'bottom-left';
  return 'top-left';
}
function extractBorderColor(el: Element): string | undefined {
  const s = (el as HTMLElement).getAttribute('style') || '';
  const m1 = s.match(/border(?:-bottom|-top|-left|-right)?-color\s*:\s*(#[0-9a-fA-F]{6})/i);
  if (m1) return m1[1].toLowerCase();
  const m2 = s.match(
    /border(?:-bottom|-top|-left|-right)?\s*:\s*\d+px\s+(?:solid|dashed|dotted)\s*(#[0-9a-fA-F]{6})/i,
  );
  return m2 ? m2[1].toLowerCase() : undefined;
}
function findFooterText(doc: Document): string | undefined {
  const candidates = Array.from(doc.querySelectorAll('p, div')).filter((el) => {
    const t = (el.textContent || '').trim();
    return /©|页|page|footer/i.test(t) && t.length < 120;
  });
  return candidates.length ? candidates[candidates.length - 1].textContent!.trim() : undefined;
}
function extractMaster(doc: Document, slides: Element[], _cascade?: CascadeIndex): ReferenceMaster | undefined {
  if (slides.length === 0) return undefined;
  const master: ReferenceMaster = {};
  // logo 候选：优先 class 含 logo（含 background-image 形式的 logo），否则回退到首个 img
  const logoEl = (doc.querySelector('[class*="logo"]') as HTMLElement | null) || (doc.querySelector('img') as HTMLElement | null);
  if (logoEl) {
    const src = logoEl.getAttribute('src') || undefined;
    const bg = (logoEl.getAttribute('style') || '').match(/background-image\s*:\s*url\(([^)]+)\)/i);
    master.logo = {
      position: logoPosition(logoEl),
      htmlSnippet: logoEl.outerHTML,
      ...(src ? { src } : {}),
      ...(bg && !src ? { src: bg[1] } : {}),
    };
  }
  const hr = doc.querySelector('hr');
  if (hr) {
    master.header = { elements: [{ type: 'horizontal-line', colorHex: extractBorderColor(hr) }] };
  }
  const footerText = findFooterText(doc);
  if (footerText) {
    master.footer = {
      textContent: footerText,
      hasPageNumber: /第\s*\d+\s*页|page\s*\d|\d+\s*\/\s*\d+/i.test(footerText),
    };
  }
  // watermark（水印）
  const wm = doc.querySelector('[class*="watermark"]');
  if (wm) {
    master.watermark = { text: (wm.textContent || '').trim(), htmlSnippet: wm.outerHTML };
  }
  // sideDecorations（侧边装饰条）
  const sideEls = Array.from(
    doc.querySelectorAll('[class*="side-decor"],[class*="decoration-bar"],[class*="sidebar"]'),
  );
  if (sideEls.length) {
    master.sideDecorations = sideEls.map((el) => {
      const cls = (el.className || '').toLowerCase();
      const side: NonNullable<ReferenceMaster['sideDecorations']>[number]['side'] = cls.includes('right')
        ? 'right'
        : cls.includes('bottom')
          ? 'bottom'
          : cls.includes('top')
            ? 'top'
            : 'left';
      const s = el.getAttribute('style') || '';
      const color = extractBorderColor(el) || (() => {
        const m = s.match(/background(?:-color)?\s*:\s*([^;]+)/i);
        return m ? firstColorIn(m[1]) : undefined;
      })();
      return {
        side,
        ...(color ? { colorHex: toHex(color) } : {}),
        htmlSnippet: el.outerHTML,
      };
    });
  }
  return Object.keys(master).length ? master : undefined;
}

// ---------- C-14 布局骨架 ----------
function classifySlide(slide: Element): LayoutSkeletonType {
  const s = slide as HTMLElement;
  const html = s.outerHTML.toLowerCase();
  const text = (s.textContent || '').toLowerCase();
  if (/<table/.test(html)) return 'table-dominant';
  // 注意：仅当显式含流程语义（mermaid/flowchart/arrow 连线/节点/流程）才判 flowchart，
  // 不能仅凭 <svg> 命中——孟菲斯装饰波浪线 SVG、内容页占位 SVG 会误判。
  if (/mermaid|flowchart|org-chart|arrow-connector|节点|连线|\b流程\b|\b箭头\b/.test(html)) return 'flowchart';
  if (/org-chart|organization/.test(html)) return 'org-chart';
  if (/<img/.test(html) && /caption/.test(text)) return 'big-image-caption';
  const cards = s.querySelectorAll('.card, [class*="card"]').length;
  if (cards >= 3) return 'card-grid';
  if (/timeline/.test(html)) return 'timeline';
  if (/pyramid/.test(html)) return 'pyramid';
  if (/matrix/.test(html)) return 'matrix-four-quadrant';
  if (/quote/.test(html)) return 'fullscreen-quote';
  // 图文分栏：兼容 text-left/image-right 与 text-col/img-col 两种命名
  if (/(text-left|image-right|text-col|img-col)/.test(html)) return 'text-left-image-right';
  if (/(image-left|text-right)/.test(html)) return 'image-left-text-right';
  if (/three-section|three_section/.test(html)) return 'three-section';
  if (/comparison|compare/.test(html)) return 'comparison';
  return 'pure-text-list';
}
function mode<T>(arr: T[]): T {
  const count: Record<string, number> = {};
  let best: T = arr[0];
  let bestN = 0;
  for (const v of arr) {
    const k = String(v);
    count[k] = (count[k] || 0) + 1;
    if (count[k] > bestN) {
      bestN = count[k];
      best = v;
    }
  }
  return best;
}
function extractLayout(_doc: Document, slides: Element[]): ReferenceLayout | undefined {
  if (slides.length === 0) return undefined;
  if (slides.length === 1) {
    return { type: 'single', single: classifySlide(slides[0]) };
  }
  const map: Record<string, LayoutSkeletonType[]> = {};
  slides.forEach((s) => {
    const pt =
      (s as HTMLElement).getAttribute('data-page-type') ||
      (s.className.match(/page-type-([a-z-]+)/)?.[1] ?? undefined);
    if (pt) (map[pt] = map[pt] || []).push(classifySlide(s));
  });
  const pageTypeMap: Record<string, LayoutSkeletonType> = {};
  for (const [pt, arr] of Object.entries(map)) pageTypeMap[pt] = mode(arr);
  return { type: 'page-type-map', pageTypeMap };
}

// ---------- C-15 视觉七维特征（构图/栏数/标题层级/装饰/背景调性/卡片圆角/图片调性）----------
function extractVisualFeatures(
  doc: Document,
  cascade: CascadeIndex | undefined,
  _slides: Element[],
  canvas: Element,
): ReferenceVisualFeatures {
  try {
    const v: ReferenceVisualFeatures = {};
    // 构图
    const heroEl = canvas.querySelector('[class*="hero"],[class*="full-bleed"],.cover-bg');
    const splitEl = canvas.querySelector(
      '[class*="split"],[class*="text-col"],[class*="img-col"],[class*="text-left"],[class*="image-right"],[class*="image-left"],[class*="two-column"],[class*="two-col"]',
    );
    if (heroEl) v.composition = 'full-bleed';
    else if (splitEl) v.composition = 'split';
    else {
      let center = 0;
      let total = 0;
      doc.querySelectorAll('h1,h2,h3,div,p').forEach((el) => {
        const s = (el as HTMLElement).getAttribute('style') || '';
        const m = s.match(/text-align\s*:\s*([^;]+)/i);
        const val = (m && m[1]) || (cascade ? resolveComputedDecl(el, 'text-align', '', cascade) || '' : '');
        if (/center/.test(val)) center++;
        total++;
      });
      v.composition = total && center / total > 0.6 ? 'centered' : 'left-aligned';
    }
    // 栏数
    let maxCols = 1;
    doc.querySelectorAll('[class*="grid"],[class*="cards"],[class*="columns"],[class*="flex-row"]').forEach((c) => {
      const n = c.children.length;
      if (n > maxCols) maxCols = Math.min(n, 4);
    });
    if (maxCols > 1) v.columns = maxCols as 1 | 2 | 3 | 4;
    // 标题层级
    let maxFs = 0;
    doc.querySelectorAll('h1,h2').forEach((el) => {
      const s = (el as HTMLElement).getAttribute('style') || '';
      const m = s.match(/font-size\s*:\s*(\d+)px/i);
      let fs = 0;
      if (m && m[1]) fs = parseInt(m[1], 10);
      else if (cascade) {
        const c = resolveComputedDecl(el, 'font-size', '', cascade);
        const mm = c && c.match(/(\d+)px/);
        if (mm) fs = parseInt(mm[1], 10);
      }
      if (fs > maxFs) maxFs = fs;
    });
    v.titleScale = maxFs >= 48 ? 'poster' : maxFs >= 32 ? 'large' : 'normal';
    // 装饰：几何特征优先（clip-path / 粗描边 / 条纹 / 波浪线 / 多 SVG），再回落渐变光晕
    const html = doc.documentElement.outerHTML.toLowerCase();
    const svgCount = doc.querySelectorAll('svg').length;
    const hasGeo =
      /clip-path|polygon|repeating-linear-gradient|border:\s*\d+px\s+solid|border-radius:\s*50%|squiggle|sticker|dots-box|half-disc|triangle|stripe/.test(html) ||
      svgCount > 3;
    if (hasGeo) v.decoration = 'geometric-shapes';
    else if (/gradient|box-shadow|glow|blur/.test(html)) v.decoration = 'gradient-glow';
    else if (/border\s*:\s*1px|border-top\s*:\s*1px/.test(html)) v.decoration = 'thin-lines';
    else v.decoration = 'minimal';
    // 背景调性：取真实画布（而非预览台 body），避免把预览深色底误判为画布深色
    let bg = '';
    const canvasStyle = (canvas as HTMLElement).getAttribute('style') || '';
    const mBg = canvasStyle.match(/background(?:-color)?\s*:\s*([^;]+)/i);
    if (mBg) bg = firstColorIn(mBg[1]) || '';
    if (!bg && cascade) {
      const c = resolveComputedDecl(canvas, 'background-color', '', cascade) || resolveComputedDecl(canvas, 'background', '', cascade);
      if (c) bg = firstColorIn(c) || '';
    }
    if (bg) {
      const h = toHex(bg);
      if (h) {
        const [r, g, b] = rgb(h);
        const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
        const mx = Math.max(r, g, b);
        const mn = Math.min(r, g, b);
        if (lum < 0.3) v.backgroundTone = 'dark';
        else if (mx - mn > 45) v.backgroundTone = 'colored';
        else v.backgroundTone = 'light';
      }
    } else v.backgroundTone = 'light';
    // 卡片圆角：扫描全部元素（含 .img-col 等），不限于 .card
    let radius = -1;
    doc.querySelectorAll('*').forEach((el) => {
      const s = (el as HTMLElement).getAttribute('style') || '';
      let r = -1;
      const m = s.match(/border-radius\s*:\s*(\d+)px/i);
      if (m) r = parseInt(m[1], 10);
      else if (cascade) {
        const c = resolveComputedDecl(el, 'border-radius', '', cascade);
        const mm = c && c.match(/(\d+)px/);
        if (mm) r = parseInt(mm[1], 10);
      }
      if (r > radius) radius = r;
    });
    v.cardRadius = radius > 0 ? (radius <= 8 ? 'small' : 'large') : 'none';
    // 图片调性
    const imgs = doc.querySelectorAll('img').length;
    const svgs = doc.querySelectorAll('svg').length;
    if (imgs) v.imagery = svgs > imgs ? 'illustration' : 'photo';
    else if (svgs) v.imagery = 'illustration';
    else v.imagery = 'none';
    return v;
  } catch {
    return {};
  }
}

// ---------- briefText（FR-5 优先级声明 + 要点）----------
function buildBriefText(
  style: ReferenceStyleAttrs,
  master: ReferenceMaster | undefined,
  layout: ReferenceLayout | undefined,
  visual?: ReferenceVisualFeatures,
): string {
  const bullets: string[] = [];
  if (style.primaryColor) bullets.push(`主色参考：${style.primaryColor}`);
  if (style.titleColor) bullets.push(`标题文字色：${style.titleColor}`);
  if (style.bodyColor) bullets.push(`正文文字色：${style.bodyColor}`);
  if (style.fontFamily) bullets.push(`字体倾向：${style.fontFamily}`);
  if (style.contentDensity) bullets.push(`密度：${style.contentDensity}`);
  if (style.iconStyle && style.iconStyle !== 'auto') bullets.push(`图标风格：${style.iconStyle}`);
  if (style.style) bullets.push(`风格：${style.style}`);
  if (style.imagePreference) bullets.push(`配图偏好：${style.imagePreference}`);
  if (style.backgroundEnabled !== undefined) bullets.push(`背景：${style.backgroundEnabled ? '启用' : '未启用'}`);
  if (style.slideCount) bullets.push(`参考页数：${style.slideCount}`);
  if (master?.logo) bullets.push(`母版 LOGO：${master.logo.position}${master.logo.colorHex ? ' ' + master.logo.colorHex : ''}`);
  if (master?.footer) bullets.push(`母版页脚：${master.footer.textContent || ''}`);
  if (master?.watermark?.text) bullets.push(`母版水印：${master.watermark.text}`);
  if (master?.sideDecorations?.length)
    bullets.push(
      `母版侧边装饰：${master.sideDecorations.map((d) => `${d.side}${d.colorHex ? ' ' + d.colorHex : ''}`).join(', ')}`,
    );
  if (layout) {
    if (layout.type === 'single' && layout.single) bullets.push(`布局骨架：${layout.single}`);
    else if (layout.type === 'page-type-map') {
      bullets.push(`布局骨架(按页型)：${Object.entries(layout.pageTypeMap || {}).map(([k, v]) => `${k}=${v}`).join(', ')}`);
    }
  }
  if (visual) {
    const feats: string[] = [];
    if (visual.composition) feats.push(`构图=${visual.composition}`);
    if (visual.columns) feats.push(`栏数=${visual.columns}`);
    if (visual.titleScale) feats.push(`标题层级=${visual.titleScale}`);
    if (visual.decoration) feats.push(`装饰=${visual.decoration}`);
    if (visual.backgroundTone) feats.push(`背景调性=${visual.backgroundTone}`);
    if (visual.cardRadius) feats.push(`卡片圆角=${visual.cardRadius}`);
    if (visual.imagery) feats.push(`图片调性=${visual.imagery}`);
    if (feats.length) bullets.push(`视觉特征：${feats.join(' / ')}`);
  }
  const head =
    '【参考提取的属性·绝对最高优先级·覆盖用户显式设置】以上摘要中的色彩/字体/密度/图标/配图偏好/风格/背景/母版元素/页面布局，如与下方用户显式参数冲突，一律以参考提取为准；未提取的属性以下方用户显式设置为准。';
  return bullets.length ? `${head}\n${bullets.map((b) => '  - ' + b).join('\n')}\n` : '';
}

// ---------- 主入口 ----------
export function extractReferenceHtmlAttributes(
  referenceHtml: string,
  _categoryHint?: 'cover' | 'content' | 'summary' | 'global',
): CategoryReference {
  if (!referenceHtml || !referenceHtml.trim()) {
    return { uploaded: false, style: {} };
  }
  let doc: Document;
  try {
    doc = new JSDOM(referenceHtml).window.document;
  } catch {
    return { uploaded: false, style: {} };
  }

  const slides = Array.from(doc.querySelectorAll('.slide, [data-slide-index]'));
  const cascade = buildCascadeIndex(doc);
  const canvas = pickCanvasElement(doc);

  const style: ReferenceStyleAttrs = {};
  style.primaryColor = extractPrimaryColor(doc, cascade);
  style.titleColor = extractTitleColor(doc, cascade);
  style.bodyColor = extractBodyColor(doc, cascade);
  style.fontFamily = extractFontFamily(doc, cascade);
  style.contentDensity = extractDensity(doc);
  style.iconStyle = extractIconStyle(doc, cascade);
  style.style = extractStyle(doc, style);

  // 先算画布调色板（背景/撞色），再据 hasImageSlot 修正配图偏好
  const palette = extractColorPalette(doc, cascade, canvas);
  const hasImageSlot = !!(
    doc.querySelector('img') ||
    canvas.querySelector('[class*="img"],[class*="image"],[class*="photo"],[class*="pic"],[class*="figure"]')
  );
  const imageSide = getImageSide(canvas, cascade);
  style.imagePreference = extractImagePreference(doc, slides.length, hasImageSlot);
  style.backgroundEnabled = extractBackgroundEnabled(doc);
  const pageTypeSet = new Set(
    Array.from(doc.querySelectorAll('[data-page-type]')).map(
      (p) => (p as HTMLElement).getAttribute('data-page-type') || '',
    ),
  );
  style.pageHints = extractPageHints(pageTypeSet.size);
  style.slideCount = extractSlideCount(doc, slides);

  const master = extractMaster(doc, slides, cascade);
  const layout = extractLayout(doc, slides);
  const visual = extractVisualFeatures(doc, cascade, slides, canvas);
  const skeleton = buildSkeletonSnippet(canvas);

  const structure: ReferenceStructure = {
    canvasSelector: canvas.className ? `.${String(canvas.className).split(/\s+/)[0]}` : canvas.tagName.toLowerCase(),
    skeleton,
    layoutVerbal: buildLayoutVerbal(visual, imageSide, hasImageSlot),
    decorationVerbal: buildDecorationVerbal(visual, palette),
    hasImageSlot,
    imageSide,
    radiusPx: visual.cardRadius === 'large' ? 16 : visual.cardRadius === 'small' ? 8 : undefined,
  };

  const briefText = buildBriefText(style, master, layout, visual);

  return { uploaded: true, style, master, layout, visual, briefText, referenceHtml: skeleton, palette, structure };
}
