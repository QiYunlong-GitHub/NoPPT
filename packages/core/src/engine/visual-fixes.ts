// ============================================================================
// visual-fixes.ts — 通用 HTML/CSS 级视觉兜底修正工具（不依赖 LayoutEngine）
// 本文件提供 enforceXxx 系列纯函数：输入 HTML 字符串，返回修正后的 HTML。
// 所有函数均为"幂等"——对同一 HTML 重复调用不产生新的样式冲突。
// ============================================================================

/** 跳过单个 HTML 实体（如 &#59; / &#x3a; / &quot; / &nbsp;），返回其末尾位置 + 1（若不匹配则返回 pos 本身） */
function skipHtmlEntity(str: string, pos: number): number {
  if (str[pos] !== '&') return pos;
  const end = str.indexOf(';', pos);
  if (end === -1) return pos;
  const entity = str.substring(pos, end + 1);
  if (/^&(?:#[0-9]+|#x[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);$/.test(entity)) {
    return end + 1;
  }
  return pos;
}

/**
 * 将 CSS 声明字符串（"key:value;key2:value2;..."）解析为 {key,value} 数组。
 * 正确处理：括号嵌套 url(...)、引号内的冒号/分号、&entity; 以及空白/多余分号。
 * 注意：返回值均为 lower-case key 与原始 value（未 trim 时保留尾部空格但通常都干净）。
 */
export function parseStyleDeclarations(styleStr: string): Array<{ key: string; value: string }> {
  const declarations: Array<{ key: string; value: string }> = [];
  let i = 0;
  const len = styleStr.length;
  while (i < len) {
    // 1) 跳过分隔符（分号 / 空格 / 换行 / 制表），同时识别 HTML 实体里的 &; 以免误跳
    while (
      i < len &&
      (styleStr[i] === ';' || styleStr[i] === ' ' || styleStr[i] === '\n' || styleStr[i] === '\t')
    ) {
      if (styleStr[i] === ';') {
        const afterEntity = skipHtmlEntity(styleStr, i);
        if (afterEntity !== i) {
          i = afterEntity;
          continue;
        }
      }
      i++;
    }
    if (i >= len) break;
    // 2) 找冒号：在括号外 + 引号外 且 跳过实体
    let colonIdx = -1;
    let depth = 0; // 括号深度（url(xxx) / calc(1 + 2)）
    let inQuote = 0; // 0 无，1 单引号，2 双引号
    for (let j = i; j < len; j++) {
      const ch = styleStr[j];
      if (ch === '&') {
        const afterEntity = skipHtmlEntity(styleStr, j);
        if (afterEntity !== j) {
          j = afterEntity - 1;
          continue;
        }
      }
      // 引号状态机（括号外才切换）
      if (depth === 0) {
        if (ch === "'" && inQuote !== 2) inQuote = inQuote === 1 ? 0 : 1;
        else if (ch === '"' && inQuote !== 1) inQuote = inQuote === 2 ? 0 : 2;
      }
      if (inQuote === 0) {
        if (ch === '(') depth++;
        else if (ch === ')') depth--;
        else if (ch === ':' && depth === 0) {
          colonIdx = j;
          break;
        }
      }
    }
    if (colonIdx === -1) break; // 无冒号 → 到此为止
    const key = styleStr.substring(i, colonIdx).trim().toLowerCase();
    // 3) 找分号：括号/引号外且跳过实体
    let valStart = colonIdx + 1;
    let semiIdx = -1;
    depth = 0;
    inQuote = 0;
    for (let j = valStart; j < len; j++) {
      const ch = styleStr[j];
      if (ch === '&') {
        const afterEntity = skipHtmlEntity(styleStr, j);
        if (afterEntity !== j) {
          j = afterEntity - 1;
          continue;
        }
      }
      if (depth === 0) {
        if (ch === "'" && inQuote !== 2) inQuote = inQuote === 1 ? 0 : 1;
        else if (ch === '"' && inQuote !== 1) inQuote = inQuote === 2 ? 0 : 2;
      }
      if (inQuote === 0) {
        if (ch === '(') depth++;
        else if (ch === ')') depth--;
        else if (ch === ';' && depth === 0) {
          semiIdx = j;
          break;
        }
      }
    }
    const valueEnd = semiIdx === -1 ? len : semiIdx;
    const value = styleStr.substring(valStart, valueEnd).trim();
    if (key) declarations.push({ key, value });
    i = valueEnd === len ? len : valueEnd + 1;
  }
  return declarations;
}

// ============================================================================
// 渐变文字（background-clip:text）声明顺序修复
// 根因：background 是简写属性，若写在 -webkit-background-clip:text /
// background-clip:text 之后，会把裁剪重置回初始值 border-box，导致深色渐变铺满
// 整个元素盒子、而 -webkit-text-fill-color:transparent 使文字完全不可见（黑块）。
// 这里的 parseStyleDeclarations 不会把 background 简写展开，因此必须按"声明顺序"
// 建模 shorthand 对 background-clip 的覆盖。
// ============================================================================

/** 将 #rgb / #rrggbb 解析为 [r,g,b]；非法返回 null */
function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** WCAG 相对亮度（0=黑，1=白） */
export function relativeLuminance(rgb: [number, number, number]): number {
  const a = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
}

/** 从任意字符串中提取全部 #hex 颜色 */
function extractHexColors(value: string): string[] {
  const re = /#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(value))) out.push('#' + m[1]);
  return out;
}

/**
 * 按声明顺序判定 background-clip 的最终有效值是否为 text。
 * 关键点：一旦遇到 background（或 background-image）简写声明，clip 被重置为 border-box，
 * 因此只有当"最后一个"相关声明仍是 *-background-clip:text 且其后无 background 简写覆盖时，
 * 才视为有效的渐变文字。
 */
export function isEffectiveClipText(styleStr: string): boolean {
  let effectiveClip = 'border-box'; // CSS 初始值
  for (const { key, value } of parseStyleDeclarations(styleStr)) {
    if (key === 'background' || key === 'background-image') {
      // 简写重置 background-clip 为初始 border-box
      effectiveClip = 'border-box';
    } else if (key === '-webkit-background-clip' || key === 'background-clip') {
      effectiveClip = value.trim().toLowerCase();
    }
  }
  return effectiveClip === 'text';
}

export interface GradientTextFixOptions {
  /** 参考标题色，降级为纯色时的优先取值 */
  titleColor?: string;
  /** 主色，降级时的次选取值 */
  primaryColor?: string;
  /** 参考 accent 白名单（含主色系），降级时若已有这些色则保留 */
  allowedAccents?: string[];
  /** 页面底色调性；light 下调变深色渐变一律降级为纯色 */
  backgroundTone?: 'light' | 'dark' | 'unknown';
}

/**
 * 修复渐变文字声明顺序 / 黑块缺陷。
 * - 有效渐变文字：保证 background 简写位于 clip 声明之前（顺序归一，幂等）。
 * - 无效（background 简写覆盖 clip）或深色→深色低亮度渐变（落在浅底上会糊成黑块）：
 *   直接降级为纯色 color（参考标题色 > 主色 > 已有 color > #22223b），并删除
 *   background / background-image / background-clip / -webkit-background-clip /
 *   -webkit-text-fill-color，保留 text-shadow 与 -webkit-text-stroke 等装饰。
 */
export function fixGradientTextDeclarationOrder(
  html: string,
  options?: GradientTextFixOptions,
): string {
  const opts = options || {};
  const allowed = new Set<string>(
    [opts.titleColor, opts.primaryColor, ...(opts.allowedAccents || [])]
      .filter((c): c is string => !!c)
      .map((c) => c.trim().toLowerCase()),
  );
  return html.replace(/style="([^"]*)"/gi, (whole, styleStr: string) => {
    const hasFill = /-webkit-text-fill-color\s*:\s*transparent/i.test(styleStr);
    const hasClip = /(?:-webkit-)?background-clip\s*:\s*text/i.test(styleStr);
    if (!hasFill && !hasClip) return whole;

    const decs = parseStyleDeclarations(styleStr);
    const effective = isEffectiveClipText(styleStr);

    // 是否应当降级为纯色
    let shouldSolidify = !effective;
    if (!shouldSolidify) {
      const bgVal = decs.find((d) => d.key === 'background' || d.key === 'background-image');
      if (bgVal) {
        const colors = extractHexColors(bgVal.value);
        if (colors.length > 0) {
          const lums = colors.map((c) => {
            const rgb = hexToRgb(c);
            return rgb ? relativeLuminance(rgb) : 1;
          });
          const minLum = Math.min(...lums);
          // 浅底上低亮度（min<0.25）渐变文字几乎不可见 → 降级
          if ((opts.backgroundTone || 'light') === 'light' && minLum < 0.25) shouldSolidify = true;
        }
      }
    }

    if (shouldSolidify) {
      // 选择纯色：已有 color 且在白名单中 → 保留；否则 titleColor > primary > 已有 color > #22223b
      const existingColor = decs.find((d) => d.key === 'color');
      let solid = opts.titleColor || opts.primaryColor || '#22223b';
      if (existingColor) {
        const v = existingColor.value.trim();
        if (
          /#([0-9a-f]{3}|[0-9a-f]{6})/i.test(v) &&
          (allowed.has(v.toLowerCase()) || !opts.titleColor)
        ) {
          solid = v;
        } else if (
          /#([0-9a-f]{3}|[0-9a-f]{6})/i.test(v) &&
          !allowed.has(v.toLowerCase()) &&
          allowed.size > 0
        ) {
          // 已有 color 不在白名单：回落到 titleColor/primary 以免出现意外色
          solid = opts.titleColor || opts.primaryColor || v;
        }
      }
      const kept = decs.filter(
        (d) =>
          ![
            'background',
            'background-image',
            'background-clip',
            '-webkit-background-clip',
            '-webkit-text-fill-color',
          ].includes(d.key),
      );
      if (!kept.some((d) => d.key === 'color')) kept.push({ key: 'color', value: solid });
      const newStyle = kept.map((d) => `${d.key}:${d.value}`).join(';');
      return `style="${newStyle}"`;
    }

    // 有效渐变：仅当 background 简写出现在 clip 之后时才重排（幂等）
    const bgIdx = decs.findIndex((d) => d.key === 'background' || d.key === 'background-image');
    const clipIdx = decs.findIndex(
      (d) => d.key === '-webkit-background-clip' || d.key === 'background-clip',
    );
    if (bgIdx !== -1 && clipIdx !== -1 && bgIdx > clipIdx) {
      const reordered = [...decs].sort((a, b) => {
        const rank = (d: { key: string }) =>
          d.key === 'background' || d.key === 'background-image' ? 0 : 1;
        return rank(a) - rank(b);
      });
      const newStyle = reordered.map((d) => `${d.key}:${d.value}`).join(';');
      return `style="${newStyle}"`;
    }
    return whole;
  });
}

export type ReferenceComposition = 'left-aligned' | 'centered' | 'unknown';

/**
 * 构图护栏：当参考构图为 left-aligned（或页面含内容标记而非纯标题）时，
 * 从根（外层）容器**移除** justify-content/align-items/text-align 的 center 取值，
 * 避免封面/标题被强制居中而与参考左对齐版式相悖。
 * 当 composition 未提供时仅在"非纯标题页"保守移除，避免误伤真正的居中封面。
 */
export function applyCompositionGuard(html: string, composition?: ReferenceComposition): string {
  // 找最外层容器
  const firstOuter = /^<(div|section|article)\b([^>]*)>/i.exec(html.trim());
  if (!firstOuter) return html;
  // 内容标记：存在 H2/H3 / 列表 / 图片 / 表格 / 多栏 → 非纯标题页
  const hasContentMarks =
    /<h[23]\b|<(ul|ol)\b|<img[\s>]|<table\b|grid-template-columns\s*:|flex-direction\s*:\s*row\b|flex\s*:\s*0\s+0\s+\d+%/i.test(
      html,
    );
  const mustRemoveCenter =
    composition === 'left-aligned' ||
    (composition !== 'centered' && hasContentMarks && !/^<h1\b/i.test(html.trim()));

  if (!mustRemoveCenter) return html;

  const tag = firstOuter[1];
  const attrs = firstOuter[2];
  const styleMatch = attrs.match(/style="([^"]*)"/i);
  if (!styleMatch) return html;
  const props = new Map<string, string>();
  for (const d of parseStyleDeclarations(styleMatch[1])) props.set(d.key, d.value);
  let changed = false;
  for (const k of ['justify-content', 'align-items', 'text-align']) {
    if ((props.get(k) || '').trim().toLowerCase() === 'center') {
      props.delete(k);
      changed = true;
    }
  }
  if (!changed) return html;
  const newStyle = Array.from(props.entries())
    .map(([k, v]) => `${k}:${v}`)
    .join(';');
  const newAttrs = attrs.replace(/style="[^"]*"/i, `style="${newStyle}"`);
  return html.replace(firstOuter[0], `<${tag}${newAttrs}>`);
}

export interface EnforceImageStylesOptions {
  /** CSS border-radius applied when <img> has none. Pass undefined to leave unchanged. */
  borderRadius?: string;
  /** When true, add data-image-ratio="4:3" to imgs missing it. */
  addDataImageRatio?: boolean;
}

export function enforceImageStyles(html: string, options?: EnforceImageStylesOptions): string {
  return html.replace(/<img([^>]*)>/gi, (_match, attrs: string) => {
    let style = '';
    const styleMatch = attrs.match(/style="([^"]*)"/i);
    if (styleMatch) style = styleMatch[1];
    const styles: Record<string, string> = {};
    if (style) {
      for (const { key, value } of parseStyleDeclarations(style)) {
        styles[key] = value;
      }
    }
    // B3L：缺省补全策略——AI 已显式设置的（包括 object-fit: contain / cover / fill）完全保留，不再强转
    const defaults: Record<string, string> = {
      width: '100%',
      'max-width': '100%',
      'max-height': '100%',
      display: 'block',
    };
    if (options?.borderRadius !== undefined) {
      defaults['border-radius'] = options.borderRadius;
    }
    for (const [k, v] of Object.entries(defaults)) {
      if (!styles[k]) styles[k] = v;
    }
    // FR-2 高度兜底：
    //   1) 用户/AI 未显式设置 height → 按 data-image-ratio 归一化（aspect-ratio + height:auto）
    //   2) AI 显式写了 height:100% 且带 data-image-ratio → LLM 默认"铺满容器"旧写法，
    //      会导致图片在 flex:column 下撑爆父容器，仍按 aspect-ratio 归一化。
    //   3) 用户/AI 写了其他 height（固定 px / 80% 等）→ 保持原样
    const ratioM = attrs.match(/data-image-ratio\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s"'`=>]+))/i);
    const ratio = (ratioM && (ratioM[1] || ratioM[2] || ratioM[3])) || '';
    const hasRatio = !!ratio && /^(\d+)\s*:\s*(\d+)$/.test(ratio);
    const explicitHeight = styles['height'];
    const isBadDefault = explicitHeight && explicitHeight.trim() === '100%';
    if (!explicitHeight || (hasRatio && isBadDefault)) {
      if (hasRatio) {
        const rm = /^(\d+)\s*:\s*(\d+)$/.exec(ratio)!;
        styles['aspect-ratio'] = `${rm[1]} / ${rm[2]}`;
        styles['height'] = 'auto';
        if (!styles['object-fit']) styles['object-fit'] = 'cover';
      } else if (!explicitHeight) {
        styles['height'] = 'auto';
      }
    }
    const newStyle = Object.entries(styles)
      .map(([k, v]) => `${k}:${v}`)
      .join(';');
    let finalAttrs = attrs;
    if (styleMatch) {
      finalAttrs = finalAttrs.replace(/style="[^"]*"/i, `style="${newStyle}"`);
    }
    if (options?.addDataImageRatio && !attrs.includes('data-image-ratio')) {
      finalAttrs += ' data-image-ratio="4:3"';
    }
    if (styleMatch) {
      return `<img${finalAttrs}>`;
    }
    return `<img${finalAttrs} style="${newStyle}">`;
  });
}

export function enforceMinFontSize(html: string, minSize: number = 14): string {
  return html.replace(/font-size:\s*(\d+)px/gi, (m, size) => {
    const n = parseInt(size);
    return n < minSize ? `font-size:${minSize}px` : m;
  });
}

export function enforceFlexChildrenMinWidth(html: string): string {
  return html.replace(
    /<(?:div|section|article|ul|ol|table)([^>]*style="[^"]*"[^>]*)>/gi,
    (match) => {
      const styleMatch = match.match(/style="([^"]*)"/i);
      if (!styleMatch) return match;
      const style = styleMatch[1];
      if (style.includes('position:absolute') || style.includes('position: absolute')) return match;
      if (style.includes('min-width:0') || style.includes('min-width: 0')) return match;
      const isFlexChild =
        /flex:\s*\d/.test(style) ||
        /flex:\d/.test(style) ||
        style.includes('display:grid') ||
        style.includes('grid-template');
      if (!isFlexChild) return match;
      return match.replace(/style="([^"]*)"/i, `style="${style};min-width:0"`);
    },
  );
}

export function enforceTextWrapping(html: string): string {
  return html.replace(/<(p|li|h[1-6])([^>]*)>/gi, (match, tag, attrs) => {
    if (/style="[^"]*"/i.test(match)) {
      return match.replace(/style="([^"]*)"/i, (_s: string, style: string) => {
        let newStyle = style;
        if (!newStyle.includes('overflow-wrap')) newStyle += ';overflow-wrap:break-word';
        if (!newStyle.includes('word-break')) newStyle += ';word-break:break-word';
        return `style="${newStyle}"`;
      });
    }
    return `<${tag}${attrs} style="overflow-wrap:break-word;word-break:break-word;">`;
  });
}

export function enforceFlatStructure(html: string): string {
  let result = html;
  result = result.replace(
    /<p([^>]*)>\s*(<span[^>]*>\d+<\/span>\s*<span[^>]*>[^<]*<\/span>)\s*<\/p>/gi,
    (_match: string, _attrs: string, inner: string) => inner,
  );
  result = result.replace(
    /<p\s*>\s*(<span[^>]*>[\s\S]*?<\/span>)\s*<\/p>/gi,
    (_match: string, inner: string) => inner,
  );
  result = result.replace(
    /<p\s*>\s*(<div[\s\S]*?<\/div>)\s*<\/p>/gi,
    (_match: string, inner: string) => inner,
  );
  result = result.replace(
    /<p\s*>\s*(<h[1-6][^>]*>[\s\S]*?<\/h[1-6]>)\s*<\/p>/gi,
    (_match: string, inner: string) => inner,
  );
  return result;
}

export function enforceGridLayout(html: string): string {
  return html.replace(/<div([^>]*style="[^"]*display:\s*grid[^"]*"[^>]*)>/gi, (match) => {
    if (/style="[^"]*"/i.test(match)) {
      return match.replace(/style="([^"]*)"/i, (_s: string, style: string) => {
        let newStyle = style;
        if (!newStyle.includes('align-content')) newStyle += ';align-content:center';
        if (!newStyle.includes('min-height')) newStyle += ';min-height:0';
        return `style="${newStyle}"`;
      });
    }
    return match;
  });
}
