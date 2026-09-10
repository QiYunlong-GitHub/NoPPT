// FR-16：将母版 LOGO 的参考"原图副本"地址（由 server 侧 persistReferenceOriginals 暂存后得到的可访问 URL）
// 按分类回写到 ReferenceVisualAttributes 的 master.logo.src，使下游 applyMasterToSlideHtml 能以 P1 CSS 开窗
// 方式复用 LOGO（无需服务端裁剪，JPEG/PNG 通用）。
//
// 仅当该分类母版 LOGO 含有效归一化 bbox（x/y/w/h 均 ∈ [0,1] 且 w>0、h>0）时才回写 src —— 这样才具备"开窗"依据；
// 否则保留原 logo（P2 htmlSnippet / P3 colorHex 占位）。
import type { ReferenceVisualAttributes } from '../types';

/** 单个分类参考原图落盘后可访问的信息。 */
export interface ReferenceOriginalInfo {
  url: string;
  width?: number;
  height?: number;
}
export type ReferenceOriginalUrls = {
  cover?: ReferenceOriginalInfo | string;
  content?: ReferenceOriginalInfo | string;
  summary?: ReferenceOriginalInfo | string;
};

/** 归一化为 {url,width?,height?}，兼容旧调用方直接传字符串 URL 的场景。 */
function toInfo(orig: ReferenceOriginalInfo | string | undefined): ReferenceOriginalInfo | undefined {
  if (!orig) return undefined;
  return typeof orig === 'string' ? { url: orig } : orig;
}

/**
 * 把各分类参考原图 URL 写入对应 master.logo.src（就地修改 rva）。
 * 同时把参考原图像素宽高回写到 master.logo.refW/refH，供下游 P1 CSS 开窗按真实宽高比「不变形」定尺。
 * 纯函数、无副作用（除 mutate 入参）、可单测。
 */
export function applyMasterLogoSources(
  rva: ReferenceVisualAttributes | null | undefined,
  originals: ReferenceOriginalUrls,
): void {
  if (!rva) return;
  const slots: Array<'cover' | 'content' | 'summary'> = ['cover', 'content', 'summary'];
  for (const slot of slots) {
    const info = toInfo(originals[slot]);
    if (!info || !info.url) continue;
    const logo = rva.byCategory[slot]?.master?.logo;
    if (!logo) continue;
    const { x, y, w, h } = logo;
    const hasBox =
      typeof x === 'number' &&
      typeof y === 'number' &&
      typeof w === 'number' &&
      typeof h === 'number' &&
      w > 0 &&
      h > 0;
    if (hasBox) {
      logo.src = info.url;
      if (info.width && info.height) {
        logo.refW = info.width;
        logo.refH = info.height;
      }
    }
  }
}

/**
 * 把各分类参考原图 URL 回写到对应分类的 referenceImageUrl（就地修改 rva）。
 * 与 applyMasterLogoSources 同源：server 侧 persistReferenceOriginals 暂存原图后得到可访问 URL，
 * 此处让参考原图（封面/总结页 hero 背景）同样走落盘 URL，避免 96KB base64 内联膨胀单页 HTML。
 * 纯函数、无副作用（除 mutate 入参）、可单测。
 */
export function applyReferenceImageUrlSources(
  rva: ReferenceVisualAttributes | null | undefined,
  originals: ReferenceOriginalUrls,
): void {
  if (!rva) return;
  const slots: Array<'cover' | 'content' | 'summary'> = ['cover', 'content', 'summary'];
  for (const slot of slots) {
    const info = toInfo(originals[slot]);
    if (!info || !info.url) continue;
    const cat = rva.byCategory[slot];
    if (cat) cat.referenceImageUrl = info.url;
  }
}
