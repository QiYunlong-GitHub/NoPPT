// 参考图片属性 VLM 提取（Task 3 / FR-9 / FR-10 / C-10~C-12）
// 接收图片 dataURL，复用 server 注入的 vlmProvider（最小接口，避免 @noppt/ai 反向 import @noppt/audit）。
// 5 级降级（L1 解析 → L2 JSON 修复 → L3 关键字段兜底 → L4 通用描述 → L5 minimal）由本模块 + 注入侧 vlmProvider 共同保障。
import {
  CategoryReference,
  IconStyle,
  LayoutSkeletonType,
  MasterHeaderElement,
  MasterLogo,
  MasterSideDecoration,
  ReferenceMaster,
  ReferenceStyle,
  ReferenceStyleAttrs,
  ReferenceVisualFeatures,
} from '../types';
import { normalizeBBox } from './reference-attribute-resolver';

// 最小 vlmProvider 接口（server 侧用 audit 的 VlmTextProvider 适配注入）
export interface VlmTextProvider {
  generateText(params: { prompt: string; imageDataUrl?: string }): Promise<string>;
}

const ATTR_PROMPT = `你是 PPT 版面属性提取器。分析用户提供的参考图片，提取可复用的版面属性，严格只输出一个 JSON 对象（不要任何解释/Markdown 代码块）：
{
  "confidence": number,
  "primaryColor": "#RRGGBB 或 null（主强调色，排除黑/白/灰）",
  "titleColor": "#RRGGBB 或 null（H1/H2/H3 标题文字色，允许近黑/白/灰，不强制排除）",
  "bodyColor": "#RRGGBB 或 null（li/p 正文文字色，允许近黑/白/灰，不强制排除）",
  "fontFamily": "sans" | "serif" | "mono" | null,
  "contentDensity": "compact" | "normal" | "spacious" | null,
  "iconStyle": "numbered" | "lettered" | "bullet" | "line" | "none" | null,
  "style": "academic" | "creative" | "business" | "simple" | "tech" | null,
  "backgroundEnabled": boolean | null,
  "master": {
    "logo": {
      "position": "top-left" | "top-right" | "bottom-left" | "bottom-right" | "center",
      "x": number, "y": number, "w": number, "h": number,
      "colorHex": "#RRGGBB 或 null",
      "description": "string 或 null",
      "confidence": number
    } | null,
    "header": { "elements": [ { "type": "string", "colorHex": "#RRGGBB 或 null" } ] } | null,
    "footer": { "textContent": "string 或 null", "hasPageNumber": boolean } | null,
    "sideDecorations": [ { "side": "left" | "right" | "top" | "bottom", "colorHex": "#RRGGBB 或 null" } ] | null
  } | null,
  "layout": { "type": "single" | "page-type-map", "single": "<LayoutSkeletonType>" | null, "pageTypeMap": { "pageType": "<LayoutSkeletonType>" } | null } | null,
  "visual": {
    "composition": "centered" | "left-aligned" | "split" | "full-bleed" | null,
    "columns": 1 | 2 | 3 | 4 | null,
    "titleScale": "poster" | "large" | "normal" | null,
    "decoration": "gradient-glow" | "geometric-shapes" | "thin-lines" | "solid-blocks" | "minimal" | null,
    "backgroundTone": "light" | "dark" | "colored" | null,
    "cardRadius": "none" | "small" | "large" | null,
    "imagery": "photo" | "illustration" | "icon" | "none" | null,
    "contentImageBBox": { "x": number, "y": number, "w": number, "h": number } | null
  } | null
}
注意：图片参考永远无法可靠推断 imagePreference / slideCount / pageHints 等结构性字段，不要输出这三项。只输出 JSON。
关于 master.logo：x/y/w/h 必须为相对图片宽高的归一化比例（0~1 小数，左上角为原点，w/h 为归一化宽高）。**务必紧贴 logo 图形本身框选**（logo+文字商标整体），不要把整条标题栏、整片页眉或大面积页面区域框进来；经验上限约为 w≤0.4 且 h≤0.2，若只能框出大片区域（w>0.5 或 h>0.3）则视为无法精确定位 logo，master.logo 务必返回 null，不要编造坐标。visual 为可选视觉特征（构图/栏数/标题层级/装饰风格/背景调性/圆角/图片调性），无法判断的维度可返回 null 或省略对应字段。contentImageBBox 为可选的主体内容图区域归一化坐标（0~1，左上角原点，w/h 为归一化宽高），仅当参考图主要是照片/插画且主体清晰时给出，否则返回 null。`;

const LAYOUT_SET = new Set<LayoutSkeletonType>([
  'table-dominant',
  'comparison',
  'flowchart',
  'org-chart',
  'timeline',
  'pyramid',
  'matrix-four-quadrant',
  'card-grid',
  'big-image-caption',
  'pure-text-list',
  'three-section',
  'text-left-image-right',
  'image-left-text-right',
  'fullscreen-quote',
]);

function minimalRef(): CategoryReference {
  return { uploaded: true, style: {} };
}

// L2：从可能含噪声的文本中抠出 JSON
function extractJsonBlock(raw: string): string | undefined {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : raw;
  const first = candidate.indexOf('{');
  const last = candidate.lastIndexOf('}');
  if (first >= 0 && last > first) return candidate.slice(first, last + 1);
  return undefined;
}

function asHex(v: unknown): string | undefined {
  return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : undefined;
}
function asOneOf<T extends string>(v: unknown, allowed: Set<string>): T | undefined {
  return typeof v === 'string' && allowed.has(v) ? (v as T) : undefined;
}

// 归一化 [0,1] 数值校验（母版 LOGO bbox 用）
function num01(v: unknown): number | undefined {
  return typeof v === 'number' && isFinite(v) && v >= 0 && v <= 1 ? v : undefined;
}

// VLM 调用 5s 超时保护（NFR-4）：超时按降级返回 minimal，绝不阻塞生成链路
async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('vlm-timeout')), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// L3：解析 + 关键字段兜底（无法解析时返回 minimal，由调用方走 L4/L5）
function toCategoryReference(parsed: any): CategoryReference {
  const style: ReferenceStyleAttrs = {};
  if (asHex(parsed.primaryColor)) style.primaryColor = asHex(parsed.primaryColor);
  // 文字色允许近黑/白/灰（与主色提取的排除语义相反），故直接 asHex 校验即可
  const titleColor = asHex(parsed.titleColor);
  if (titleColor) style.titleColor = titleColor;
  const bodyColor = asHex(parsed.bodyColor);
  if (bodyColor) style.bodyColor = bodyColor;
  const ff = asOneOf<'sans' | 'serif' | 'mono'>(
    parsed.fontFamily,
    new Set(['sans', 'serif', 'mono']),
  );
  if (ff) style.fontFamily = ff;
  const cd = asOneOf<'compact' | 'normal' | 'spacious'>(
    parsed.contentDensity,
    new Set(['compact', 'normal', 'spacious']),
  );
  if (cd) style.contentDensity = cd;
  const ic = asOneOf<IconStyle>(
    parsed.iconStyle,
    new Set(['numbered', 'lettered', 'bullet', 'line', 'none', 'auto']),
  );
  if (ic) style.iconStyle = ic;
  const st = asOneOf<ReferenceStyle>(
    parsed.style,
    new Set(['academic', 'creative', 'business', 'simple', 'tech']),
  );
  if (st) style.style = st;
  if (typeof parsed.backgroundEnabled === 'boolean')
    style.backgroundEnabled = parsed.backgroundEnabled;
  // 注意：imagePreference / slideCount / pageHints 为结构性字段，图片参考永远不推断（FR-2 强制 undefined）

  let master: ReferenceMaster | undefined;
  if (parsed.master && typeof parsed.master === 'object') {
    const m = parsed.master as any;
    master = {};
    // logo（含归一化 bbox + 置信度门控）
    if (m.logo && typeof m.logo === 'object') {
      const logoConf = typeof m.logo.confidence === 'number' ? m.logo.confidence : undefined;
      // 置信度 <0.5 → 丢弃整块 LOGO（AC-17 / FR-16.3）
      if (logoConf === undefined || logoConf >= 0.5) {
        const pos = asOneOf<'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center'>(
          m.logo.position,
          new Set(['top-left', 'top-right', 'bottom-left', 'bottom-right', 'center']),
        );
        const color = asHex(m.logo.colorHex);
        const x = num01(m.logo.x),
          y = num01(m.logo.y),
          w = num01(m.logo.w),
          h = num01(m.logo.h);
        const hasAny = !!(
          pos ||
          color ||
          x !== undefined ||
          y !== undefined ||
          w !== undefined ||
          h !== undefined ||
          typeof m.logo.description === 'string'
        );
        if (hasAny) {
          const logo: MasterLogo = { position: pos ?? 'top-left', colorHex: color };
          // bbox 收紧门控（FR-16 修正）：若框出整片页面区域（疑似整条标题栏 / 整页背景，
          // w>0.5 或 h>0.3），视为无法「紧贴 logo 图形」精确框选 → 丢弃 bbox（不回写 src），
          // 降级到 P2(htmlSnippet)/P3(colorHex) 分支，避免把大块参考页搬进新页面。
          const tooLoose = (w !== undefined && w > 0.5) || (h !== undefined && h > 0.3);
          if (!tooLoose) {
            if (x !== undefined) logo.x = x;
            if (y !== undefined) logo.y = y;
            if (w !== undefined) logo.w = w;
            if (h !== undefined) logo.h = h;
          }
          if (logoConf !== undefined) logo.confidence = logoConf;
          master.logo = logo;
        }
      }
    }
    // header（母版页眉元素）
    if (m.header && typeof m.header === 'object' && Array.isArray(m.header.elements)) {
      const els = (m.header.elements as unknown[])
        .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
        .map((e): MasterHeaderElement => {
          const c = asHex(e.colorHex);
          return {
            type: typeof e.type === 'string' ? e.type : 'unknown',
            ...(c ? { colorHex: c } : {}),
          };
        });
      if (els.length) master.header = { elements: els };
    }
    // footer（母版页脚）
    if (m.footer && typeof m.footer === 'object') {
      const txt = typeof m.footer.textContent === 'string' ? m.footer.textContent : undefined;
      const hpn = typeof m.footer.hasPageNumber === 'boolean' ? m.footer.hasPageNumber : undefined;
      if (txt !== undefined || hpn !== undefined)
        master.footer = { textContent: txt, hasPageNumber: hpn ?? false };
    }
    // sideDecorations（侧边装饰条）
    if (Array.isArray(m.sideDecorations)) {
      const sides = (m.sideDecorations as unknown[])
        .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
        .map((s): MasterSideDecoration | null => {
          const side = asOneOf<'left' | 'right' | 'top' | 'bottom'>(
            s.side,
            new Set(['left', 'right', 'top', 'bottom']),
          );
          const c = asHex(s.colorHex);
          if (!side && !c) return null;
          return { side: side ?? 'right', ...(c ? { colorHex: c } : {}) };
        })
        .filter((s): s is MasterSideDecoration => s !== null);
      if (sides.length) master.sideDecorations = sides;
    }
    if (Object.keys(master).length === 0) master = undefined;
  }

  let layout: CategoryReference['layout'];
  if (parsed.layout && typeof parsed.layout === 'object') {
    const type = parsed.layout.type === 'page-type-map' ? 'page-type-map' : 'single';
    const single = asOneOf<LayoutSkeletonType>(parsed.layout.single, LAYOUT_SET);
    const mapObj = parsed.layout.pageTypeMap;
    const pageTypeMap: Record<string, LayoutSkeletonType> = {};
    if (mapObj && typeof mapObj === 'object') {
      for (const [k, v] of Object.entries(mapObj)) {
        const lv = asOneOf<LayoutSkeletonType>(v, LAYOUT_SET);
        if (lv) pageTypeMap[k] = lv;
      }
    }
    if (type === 'page-type-map' && Object.keys(pageTypeMap).length) layout = { type, pageTypeMap };
    else if (single) layout = { type: 'single', single };
  }

  // 视觉特征（增强版式/视觉对齐参考图，FR-2.x）：逐维严格校验，非法值不写入
  let visual: ReferenceVisualFeatures | undefined;
  if (parsed.visual && typeof parsed.visual === 'object') {
    const vi = parsed.visual as Record<string, unknown>;
    const v: ReferenceVisualFeatures = {};
    const comp = asOneOf<'centered' | 'left-aligned' | 'split' | 'full-bleed'>(
      vi.composition,
      new Set(['centered', 'left-aligned', 'split', 'full-bleed']),
    );
    if (comp) v.composition = comp;
    const cols =
      typeof vi.columns === 'number' &&
      (vi.columns === 1 || vi.columns === 2 || vi.columns === 3 || vi.columns === 4)
        ? (vi.columns as 1 | 2 | 3 | 4)
        : undefined;
    if (cols !== undefined) v.columns = cols;
    const ts = asOneOf<'poster' | 'large' | 'normal'>(
      vi.titleScale,
      new Set(['poster', 'large', 'normal']),
    );
    if (ts) v.titleScale = ts;
    const dec = asOneOf<
      'gradient-glow' | 'geometric-shapes' | 'thin-lines' | 'solid-blocks' | 'minimal'
    >(
      vi.decoration,
      new Set(['gradient-glow', 'geometric-shapes', 'thin-lines', 'solid-blocks', 'minimal']),
    );
    if (dec) v.decoration = dec;
    const bg = asOneOf<'light' | 'dark' | 'colored'>(
      vi.backgroundTone,
      new Set(['light', 'dark', 'colored']),
    );
    if (bg) v.backgroundTone = bg;
    const cr = asOneOf<'none' | 'small' | 'large'>(
      vi.cardRadius,
      new Set(['none', 'small', 'large']),
    );
    if (cr) v.cardRadius = cr;
    const img = asOneOf<'photo' | 'illustration' | 'icon' | 'none'>(
      vi.imagery,
      new Set(['photo', 'illustration', 'icon', 'none']),
    );
    if (img) v.imagery = img;
    const bbox = normalizeBBox(vi.contentImageBBox);
    if (bbox) v.contentImageBBox = bbox;
    if (Object.keys(v).length > 0) visual = v;
  }

  return { uploaded: true, style, master, layout, briefText: undefined, visual };
}

export async function extractReferenceImageAttributes(
  dataUrl: string,
  vlmProvider: VlmTextProvider,
  _categoryHint?: 'cover' | 'content' | 'summary' | 'global',
): Promise<CategoryReference> {
  if (!dataUrl || !vlmProvider) return minimalRef();
  let raw = '';
  try {
    raw = await withTimeout(
      vlmProvider.generateText({ prompt: ATTR_PROMPT, imageDataUrl: dataUrl }),
      5000,
    );
  } catch {
    // L4/L5：VLM 不可达 / 5s 超时 → 返回 minimal（仅标记 uploaded，属性留空由用户/全局兜底）
    return minimalRef();
  }
  const block = extractJsonBlock(raw);
  if (!block) return minimalRef();
  try {
    const parsed = JSON.parse(block);
    // 全局置信度门控：<0.5 表示整次提取不可靠 → 整体降级（FR-2 / AC-17）
    if (typeof parsed.confidence === 'number' && parsed.confidence < 0.5) return minimalRef();
    return toCategoryReference(parsed);
  } catch {
    return minimalRef();
  }
}
