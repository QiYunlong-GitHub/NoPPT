// 母版 DOM 硬注入（Task5 / FR-3 母版复用）：将参考文件提取到的母版元素（logo / 页眉 / 页脚 /
// 侧边装饰 / 水印）作为绝对定位覆盖层注入单页 slide HTML，并在根节点写入 data-master 元数据。
//
// 设计约束：
// - 纯函数、幂等：已注入（含 data-master 标记）则原样返回，避免重复注入。
// - 覆盖层 pointer-events:none，不拦截内容交互；元素贴边布置，尽量不遮挡正文。
// - 无 master 时直接返回原 HTML（fallback 分支行为一致）。
import type { ReferenceMaster } from '../types';

const MASTER_ATTR = 'data-master';

export interface ApplyMasterOptions {
  pageType?: string;
  /** 用户是否开启「自动添加背景图」；开启时用户设置优先级高于参考图，不注入整页参考原图背景 */
  backgroundEnabled?: boolean;
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeHtml(s: string): string {
  return escapeAttr(s);
}

/** 构建母版覆盖层 HTML（绝对定位，贴边布置）。无内容时返回 ''。 */
function buildMasterLayer(master: ReferenceMaster): string {
  const parts: string[] = [];

  if (master.logo) {
    const pos = master.logo.position || 'top-left';
    const anchor: Record<string, string> = {
      'top-left': 'top:24px;left:24px;',
      'top-right': 'top:24px;right:24px;',
      'bottom-left': 'bottom:24px;left:24px;',
      'bottom-right': 'bottom:24px;right:24px;',
      center: 'top:50%;left:50%;transform:translate(-50%,-50%);',
    };
    const posStyle = anchor[pos] || anchor['top-left'];
    if (master.logo.src) {
      const { x, y, w, h, refW, refH } = master.logo;
      const hasBox =
        typeof x === 'number' &&
        typeof y === 'number' &&
        typeof w === 'number' &&
        typeof h === 'number' &&
        w > 0 &&
        h > 0;
      if (hasBox) {
        // P1 CSS 开窗（FR-16）：把整张参考原图按归一化 bbox 窗口化展示为 LOGO，
        // 无需服务端裁剪，JPEG/PNG 通用。
        // 修正点：历史上 background-size 用「同一 px 值」假定参考图为方形，把 2560×1440 拉成正方形严重变形。
        // 现改为百分比精灵图公式 + 按区域真实宽高比定盒尺寸，保证不变形：
        //   - 区域真实宽高比 = (w*refW)/(h*refH)（缺失按 16:9 退化，绝不抛错）
        //   - 在 180×120 约束内取 boxW/boxH = regionAspect
        //   - background-size:(100/w)% (100/h)% + background-position:(x/(1-w))% (y/(1-h))%
        const regionAspect =
          refW && refH && refW > 0 && refH > 0 ? (w * refW) / (h * refH) : 16 / 9;
        const MAX_W = 180;
        const MAX_H = 120;
        let boxW: number;
        let boxH: number;
        if (regionAspect >= MAX_W / MAX_H) {
          boxW = MAX_W;
          boxH = MAX_W / regionAspect;
        } else {
          boxH = MAX_H;
          boxW = MAX_H * regionAspect;
        }
        const sizeW = w >= 1 ? '100%' : `${(100 / w).toFixed(2)}%`;
        const sizeH = h >= 1 ? '100%' : `${(100 / h).toFixed(2)}%`;
        const posX = w >= 1 ? '0%' : `${((x / (1 - w)) * 100).toFixed(2)}%`;
        const posY = h >= 1 ? '0%' : `${((y / (1 - h)) * 100).toFixed(2)}%`;
        const style =
          `position:absolute;${posStyle}` +
          `width:${boxW.toFixed(1)}px;height:${boxH.toFixed(1)}px;` +
          `background-image:url('${escapeAttr(master.logo.src)}');background-repeat:no-repeat;` +
          `background-size:${sizeW} ${sizeH};` +
          `background-position:${posX} ${posY};pointer-events:none;`;
        parts.push(`<div style="${style}" data-master-logo></div>`);
      } else {
        parts.push(
          `<img src="${escapeAttr(master.logo.src)}" alt="logo" style="position:absolute;${posStyle}height:40px;width:auto;max-width:160px;object-fit:contain;pointer-events:none;" data-master-logo />`,
        );
      }
    } else if (master.logo.htmlSnippet) {
      parts.push(
        `<div style="position:absolute;${posStyle}pointer-events:none;" data-master-logo>${escapeHtml(master.logo.htmlSnippet)}</div>`,
      );
    }
    // 无 src 且 无 htmlSnippet → 不渲染 logo，避免 logo(#hex) 字面文本占位缺陷
  }

  if (master.header?.elements?.length) {
    const heads = master.header.elements
      .map(
        (e) =>
          `<span style="display:inline-block;height:3px;width:28px;background:${e.colorHex || '#9ca3af'};margin-right:8px;border-radius:2px;"></span>`,
      )
      .join('');
    parts.push(
      `<div style="position:absolute;top:20px;left:50%;transform:translateX(-50%);pointer-events:none;display:flex;align-items:center;" data-master-header>${heads}</div>`,
    );
  }

  if (master.footer?.textContent) {
    parts.push(
      `<div style="position:absolute;bottom:18px;left:0;right:0;text-align:center;font-size:13px;color:#6b7280;pointer-events:none;font-family:sans-serif;" data-master-footer>${escapeHtml(master.footer.textContent)}</div>`,
    );
  } else if (master.footer?.hasPageNumber) {
    parts.push(
      `<div style="position:absolute;bottom:18px;right:24px;font-size:13px;color:#6b7280;pointer-events:none;font-family:sans-serif;" data-master-footer>1</div>`,
    );
  }

  if (master.sideDecorations?.length) {
    for (const sd of master.sideDecorations) {
      const sideStyle =
        sd.side === 'left' || sd.side === 'right'
          ? `${sd.side}:16px;top:0;bottom:0;width:4px;`
          : `top:${sd.side === 'top' ? 16 : 'auto'};bottom:${sd.side === 'bottom' ? 16 : 'auto'};left:0;right:0;height:4px;`;
      parts.push(
        `<div style="position:absolute;${sideStyle}background:${sd.colorHex || '#9ca3af'};pointer-events:none;opacity:0.7;" data-master-side="${sd.side}"></div>`,
      );
    }
  }

  if (master.watermark?.text) {
    parts.push(
      `<div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%) rotate(-18deg);font-size:48px;font-weight:800;color:rgba(0,0,0,0.06);pointer-events:none;white-space:nowrap;font-family:sans-serif;user-select:none;" data-master-watermark>${escapeHtml(master.watermark.text)}</div>`,
    );
  } else if (master.watermark?.htmlSnippet) {
    parts.push(
      `<div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);pointer-events:none;opacity:0.08;" data-master-watermark>${escapeHtml(master.watermark.htmlSnippet)}</div>`,
    );
  }

  if (parts.length === 0) return '';

  const meta = escapeAttr(JSON.stringify(master));
  // 母版层定位改用 top/left/right/bottom 四边属性（而非 inset），
  // 原因是历史上 web 端 sanitize 白名单漏掉 inset 导致层被剥成 0 尺寸；
  // 四边属性是 server/web 双端自古放行的，绝不会丢，作为防御性兜底。
  return `<div class="noppt-master-layer" ${MASTER_ATTR}="${meta}" style="position:absolute;top:0;left:0;right:0;bottom:0;pointer-events:none;z-index:50;overflow:hidden;">${parts.join('')}</div>`;
}

/** 确保根 <div> 是定位上下文（position:relative），便于母版层绝对定位。 */
function ensureRootRelative(html: string): string {
  return html.replace(
    /^(\s*<div\b)([^>]*?)(\/?)>/i,
    (_m, p1: string, attrs: string, selfClose: string) => {
      if (/\bposition\s*:/i.test(attrs)) return _m;
      const styleMatch = attrs.match(/style\s*=\s*(["'])(.*?)\1/i);
      if (styleMatch) {
        const quote = styleMatch[1];
        const newStyle = `${styleMatch[2]};position:relative`;
        const newAttrs = attrs.replace(styleMatch[0], `style=${quote}${newStyle}${quote}`);
        return `${p1}${newAttrs}${selfClose}>`;
      }
      return `${p1}${attrs} style="position:relative;"${selfClose}>`;
    },
  );
}

/**
 * 页面是否已自行设计背景：根容器命中任意渐变，或任意不透明深色纯色，即视为已有背景（不再注入 hero 覆盖）。
 * 浅底实色 / 透明 / 无背景 → 返回 false（应注入 hero）。
 */
/**
 * 判断最外层 <div> 是否已自带「实质性」背景（真实渐变或深色不透明实色），
 * 从而不应再注入参考图背景（FR-0 注入三级条件的 P2 分支）。
 *
 * 优化点（相较旧实现）：
 * - 只扫描根容器自身的 `background` / `background-color` / `background-image` 等背景声明，
 *   不再对整段 style 字符串做全局渐变关键词匹配，避免把 text-shadow / box-shadow /
 *   装饰性子元素上的渐变误判为页面背景。
 * - 透明（alpha<0.2）或浅色（亮度≥0.6）背景不视为「已有背景」，允许注入参考图。
 *
 * @returns true = 页面已有真实背景（不注入参考 hero）；false = 浅底/无背景（可注入）。
 */
export function hasOpaqueDarkOrGradientBackground(html: string): boolean {
  // 仅取最外层 div 标签及其属性
  const outer = html.match(/^<div\b([^>]*)>/i) || html.match(/<div\b([^>]*)>/i);
  if (!outer) return false;
  const styleMatch = outer[1].match(/style\s*=\s*(["'])(.*?)\1/i);
  if (!styleMatch) return false;

  // 抽取根容器上的所有 background* 声明（background / background-color / background-image ...）
  const decls: { key: string; val: string }[] = [];
  const re = /(background(?:-[a-z]+)?)\s*:\s*([^;"]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(styleMatch[2]))) {
    decls.push({ key: m[1].toLowerCase(), val: m[2].trim().toLowerCase() });
  }
  if (decls.length === 0) return false;

  for (const d of decls) {
    const v = d.val;
    // 任意渐变（linear/radial/conic/repeating）→ 视为已设计的真实背景
    if (/linear-gradient|radial-gradient|conic-gradient|repeating-linear-gradient/i.test(v)) {
      return true;
    }
    const rgba = v.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/i);
    if (rgba) {
      const alpha = rgba[4] !== undefined ? parseFloat(rgba[4]) : 1;
      if (alpha < 0.2) continue; // 透明背景 → 视为无背景
      const lum = (0.299 * +rgba[1] + 0.587 * +rgba[2] + 0.114 * +rgba[3]) / 255;
      if (lum < 0.6) return true; // 不透明深色实色 → 已有背景
      continue;
    }
    const hex = v.match(/^#([0-9a-f]{3,8})/i);
    if (hex) {
      const raw = hex[1].toLowerCase();
      const full =
        raw.length >= 6
          ? raw.slice(0, 6)
          : raw
              .split('')
              .map((c) => c + c)
              .join('');
      const a = raw.length === 8 ? parseInt(raw.slice(6, 8), 16) / 255 : 1;
      if (a < 0.2) continue;
      const r = parseInt(full.slice(0, 2), 16);
      const g = parseInt(full.slice(2, 4), 16);
      const b = parseInt(full.slice(4, 6), 16);
      const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      if (lum < 0.6) return true; // 不透明深色实色 → 已有背景
    }
  }
  return false;
}

/**
 * 将母版元素注入 slide HTML。
 * @returns 注入后的 HTML（幂等：已含 data-master 则原样返回）。
 */
/**
 * FR-0：把参考原图作为整页背景（CSS 开窗裁切）注入到内容之下（z-index:-1）。
 * 含图片层与半透明蒙版层，确保正文文字浮于其上、可读性不受影响。
 * 若提供归一化 bbox 则开窗裁切主体区域，否则整图 cover 铺满。
 */
function injectHeroFirst(html: string, hero: NonNullable<ReferenceMaster['heroImage']>): string {
  const out = ensureRootRelative(html);
  const { src, x, y, w, h } = hero;
  let bg: string;
  if (
    typeof x === 'number' &&
    typeof y === 'number' &&
    typeof w === 'number' &&
    typeof h === 'number' &&
    w > 0 &&
    h > 0
  ) {
    // 归一化 bbox {x,y,w,h} → CSS 精灵图开窗：让主体区域恰好铺满容器
    const sizeW = (1 / w) * 100; // w=1 → 100%
    const sizeH = (1 / h) * 100; // h=1 → 100%
    const posX = w >= 1 ? 0 : (x / (1 - w)) * 100; // w=1 时无需横向偏移
    const posY = h >= 1 ? 0 : (y / (1 - h)) * 100; // h=1 时无需纵向偏移
    bg =
      // 蒙版渐变置于 url 之上（多层 background 首个绘制在最上），兼顾暗化与配图
      `background-image:linear-gradient(0deg, rgba(15,23,42,0.38), rgba(15,23,42,0.38)), url('${escapeAttr(src)}');` +
      `background-size:${sizeW.toFixed(2)}% ${sizeH.toFixed(2)}%, ${sizeW.toFixed(2)}% ${sizeH.toFixed(2)}%;` +
      `background-position:${posX.toFixed(2)}% ${posY.toFixed(2)}%, ${posX.toFixed(2)}% ${posY.toFixed(2)}%;` +
      `background-repeat:no-repeat, no-repeat;` +
      `background-color:#0f172a;`;
  } else {
    bg =
      `background-image:linear-gradient(0deg, rgba(15,23,42,0.38), rgba(15,23,42,0.38)), url('${escapeAttr(src)}');` +
      `background-size:cover, cover;` +
      `background-position:center, center;` +
      `background-repeat:no-repeat, no-repeat;` +
      `background-color:#0f172a;`;
  }
  // 关键修复：不再插入额外的 `z-index:-1` 子层（会被根容器白底完全遮住 → 背景不可见），
  // 而是把背景直接写进最外层 <div> 自身的 style。背景图本就绘制在根容器背景色之上、内容之下，
  // 天然可见；且只依赖白名单内的 background-* 属性，抗 sanitize 剥离。
  // 幂等标记用 HTML 注释 <!--noppt-hero-->（DOMParser/JSDOM 均保留注释），双保险。
  // 注意：必须用 replace（保留标签后的全部内容），不能用 match 后手动拼接（会把正文与 </div> 丢掉的致命 bug）。
  return out.replace(
    /^(\s*<div\b)([^>]*?)(\/?)>/i,
    (_m, p1: string, attrs: string, selfClose: string) => {
      const styleMatch = attrs.match(/style\s*=\s*(["'])(.*?)\1/i);
      let newAttrs: string;
      if (styleMatch) {
        const quote = styleMatch[1];
        const merged = `${styleMatch[2]};${bg}`;
        newAttrs = attrs.replace(styleMatch[0], `style=${quote}${merged}${quote}`);
      } else {
        newAttrs = `${attrs} style="${bg}"`;
      }
      return `${p1}${newAttrs}${selfClose}><!--noppt-hero-->`;
    },
  );
}

export function applyMasterToSlideHtml(html: string, master: ReferenceMaster | undefined): string {
  if (!html || !master) return html;
  // 幂等判据（双保险）：母版层与 hero 背景分别独立判定，避免「已注入一部分却重复叠加另一部分」。
  // - 母版层：data-master 属性（server/web 白名单均已放行）或 class="noppt-master-layer"。
  // - hero 背景：<!--noppt-hero--> 注释标记（DOMParser/JSDOM 均保留）。
  const masterPresent = html.includes(MASTER_ATTR) || html.includes('noppt-master-layer');
  const heroPresent = html.includes('noppt-hero');
  let out = html;
  // hero 背景注入决策（参考图优先于用户「自动背景图」开关）：
  //  - 参考图携带 heroImage（用户显式上传的参考背景）→ 优先级最高，直接注入参考图背景，
  //    不再受用户「自动背景图」开关否决（该开关仅控制「无参考图时系统自动生成背景」）。
  //  - 页面已自带真实深色/渐变背景（大模型自行设计）→ 不注入，保留大模型设计（浅底则注入）。
  //  无论是否注入 hero，母版层（logo/页眉/页脚/侧边/水印）均照常注入，与 backgroundEnabled 无关。
  const heroImage = master.heroImage;
  const heroEnabled = !!heroImage?.src && !hasOpaqueDarkOrGradientBackground(out);
  if (heroEnabled && heroImage && !heroPresent) {
    out = injectHeroFirst(out, heroImage);
  }
  const layer = buildMasterLayer(master);
  if (layer && !masterPresent) {
    out = ensureRootRelative(out);
    const idx = out.lastIndexOf('</div>');
    if (idx === -1) return out;
    out = out.slice(0, idx) + layer + out.slice(idx);
  }
  return out;
}
