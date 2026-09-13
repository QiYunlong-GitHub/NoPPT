/**
 * 配图决策单一真源（Single Source of Truth）。
 *
 * 缺陷复盘（pres_mtzke4lj_ovu6r61）：
 *  1) 生图阶段曾以「HTML 里出现了 NOPPT 占位符」作为生图依据
 *     （`(needsImagePerPlan || hasPlaceholder) && hasPlaceholder`），
 *     于是只要 LLM 自发在封面/总结页写了占位符，就会被配图 —— 参考模板本身无图槽却出了图。
 *  2) 兜底升级分支显式为 cover/toc/summary 指定 `content-image-top` 带图版式，
 *     与 `normalizePlanByImagePreference` 中「content-only 下结构页 needsImage=false」互相冲突，
 *     且未检查逐页 imagePreference==='none'。
 *
 * 本模块把「该页到底要不要图」收敛为唯一入口：
 *  - 结构页（cover / toc / summary）在任何偏好下都不配图（与参考模板保持一致）；
 *  - 内容页遵循 `plan.needsImage`（内容页的升级/归一策略维持现状，不在本模块内改变）；
 *  - 页面若带着不该存在的占位符，统一由 `stripImagePlaceholders` 剥离，避免渲染成破图。
 */
import type { ImagePreference, SlidePageType } from '../types';

/** 占位图 src（必须与 agent 侧的 IMAGE_PLACEHOLDER 完全一致） */
export const IMAGE_PLACEHOLDER_SRC = 'https://NOPPT_IMAGE_PLACEHOLDER';

/** 结构页（封面 / 目录 / 总结）：与参考模板一致，恒不配图 */
export const STRUCTURE_PAGE_TYPES: readonly SlidePageType[] = ['cover', 'toc', 'summary'];

export function isStructurePage(pageType?: string | null): boolean {
  return !!pageType && (STRUCTURE_PAGE_TYPES as readonly string[]).includes(pageType);
}

export type SlideImageDecisionReason =
  | 'structure-page'
  | 'image-disabled'
  | 'pref-none'
  | 'plan-needs-image'
  | 'content-placeholder'
  | 'content-no-image';

export interface SlideImageDecision {
  /** 该页是否需要（允许）生成配图 */
  needsImage: boolean;
  /** 该页 HTML 中若存在占位符，是否必须剥离 */
  stripPlaceholder: boolean;
  reason: SlideImageDecisionReason;
}

/**
 * 配图决策唯一入口。
 *  - 结构页（cover/toc/summary）在任何偏好下都不配图，且必须剥离占位符（与参考模板一致）；
 *  - 图片开关关闭 / pref=none → 不配图并剥离占位符；
 *  - 内容页维持既有行为：plan.needsImage=true 或 HTML 已含占位符即配图（不做剥离，避免改变既有内容页配图策略）。
 */
export function resolveSlideImageDecision(input: {
  pageType?: string | null;
  planNeedsImage?: boolean;
  imagePreference?: ImagePreference;
  imageEnabled?: boolean;
  hasPlaceholder?: boolean;
}): SlideImageDecision {
  const { pageType, planNeedsImage, imagePreference, imageEnabled, hasPlaceholder } = input;
  if (isStructurePage(pageType)) {
    return { needsImage: false, stripPlaceholder: true, reason: 'structure-page' };
  }
  if (imageEnabled === false) {
    return { needsImage: false, stripPlaceholder: true, reason: 'image-disabled' };
  }
  if (imagePreference === 'none') {
    return { needsImage: false, stripPlaceholder: true, reason: 'pref-none' };
  }
  if (planNeedsImage) {
    return { needsImage: true, stripPlaceholder: false, reason: 'plan-needs-image' };
  }
  if (hasPlaceholder) {
    return { needsImage: true, stripPlaceholder: false, reason: 'content-placeholder' };
  }
  return { needsImage: false, stripPlaceholder: false, reason: 'content-no-image' };
}

function isPlaceholderImgTag(tag: string): boolean {
  return /src\s*=\s*["']?\s*`?\s*https:\/\/NOPPT_IMAGE_PLACEHOLDER/i.test(tag);
}

function extractStyleAttr(attrs: string): string {
  const m = attrs.match(/style\s*=\s*"([^"]*)"/i) || attrs.match(/style\s*=\s*'([^']*)'/i);
  return m ? m[1] : '';
}

/**
 * 空图片外壳判定：被移除图片后剩下的容器。
 * 特征——带 overflow:hidden（图片容器标志）且不含 background（排除几何色块装饰）。
 */
function isEmptyImageShellStyle(style: string): boolean {
  if (!style) return false;
  if (!/overflow\s*:\s*hidden/i.test(style)) return false;
  if (/background(-color|-image)?\s*:/i.test(style)) return false;
  return /flex\s*:\s*0\s+0\s+\d+%|width\s*:\s*100%|max-height|aspect-ratio|border-radius/i.test(
    style,
  );
}

export interface StripPlaceholderOptions {
  /**
   * 结构页场景：移除图片列后，把同一分栏行里残留的固定宽度列（flex:0 0 NN%，NN≥40）
   * 收敛为 `flex:1` 让其占满，避免留下半屏空白。
   */
  collapseLayout?: boolean;
}

/**
 * 剥离 NOPPT 占位图（幂等）：
 *  - 只移除 `src="https://NOPPT_IMAGE_PLACEHOLDER"` 的 <img>，其余图片原样保留；
 *  - 顺带清理因此变空的「图片外壳」容器（不含颜色的 overflow:hidden 容器）；
 *  - 不触碰装饰性色块（其 style 必含 background）。
 */
export function stripImagePlaceholders(
  html: string,
  opts: StripPlaceholderOptions = {},
): string {
  if (!html || !html.includes('NOPPT_IMAGE_PLACEHOLDER')) return html;
  const stripped = html.replace(/<img\b[^>]*>/gi, (tag) => (isPlaceholderImgTag(tag) ? '' : tag));
  if (stripped === html) return html; // 占位符不在 <img> 标签内（异常态），保持原样避免误伤
  let out = stripped;
  // 清理变空的图片外壳（最多 3 轮，覆盖嵌套外壳）
  for (let i = 0; i < 3; i++) {
    const next = out.replace(/<div\b([^>]*)>\s*<\/div>/gi, (whole: string, attrs: string) => {
      const style = extractStyleAttr(attrs);
      return style && isEmptyImageShellStyle(style) ? '' : whole;
    });
    if (next === out) break;
    out = next;
  }
  if (opts.collapseLayout) {
    out = out.replace(/flex\s*:\s*0\s+0\s+(\d{2,3})%/gi, (m: string, p1: string) =>
      Number(p1) >= 40 ? 'flex:1' : m,
    );
  }
  return out;
}
