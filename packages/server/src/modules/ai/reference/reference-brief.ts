/**
 * 参考视觉属性的「字段汇总 / brief 拼装 / 母版 LOGO 资源回填」纯函数（从 ai.service.ts 外置）。
 * ai.service.ts 保留对应 private 方法作为薄委托，对外调用方不变量不变。
 */
import {
  applyMasterLogoSources,
  applyReferenceImageUrlSources,
  type ReferenceVisualAttributes,
} from '@noppt/ai';

export interface ReferenceOriginalSources {
  cover?: { url: string; width?: number; height?: number };
  content?: { url: string; width?: number; height?: number };
  summary?: { url: string; width?: number; height?: number };
}

/** 汇总已应用的参考字段（去重），用于 UI/观测 */
export function collectAppliedReferenceFields(rva: ReferenceVisualAttributes | null): string[] {
  if (!rva) return [];
  const appliedFields = new Set<string>();
  for (const c of [
    rva.global,
    rva.byCategory.cover,
    rva.byCategory.content,
    rva.byCategory.summary,
  ]) {
    if (!c?.uploaded || !c.style) continue;
    for (const k of Object.keys(c.style)) appliedFields.add(k);
  }
  return appliedFields.size ? Array.from(appliedFields) : [];
}

/** 把分类参考摘要合并为单一 brief 文本（注入生成 prompt） */
export function buildReferenceBrief(attrs: ReferenceVisualAttributes | null): string {
  if (!attrs) return '';
  const parts = [
    attrs.byCategory.cover.briefText,
    attrs.byCategory.content.briefText,
    attrs.byCategory.summary.briefText,
    attrs.global.briefText,
  ].filter((p): p is string => !!p && p.length > 0);
  return parts.join('\n\n');
}

/** 把落盘的原图 URL 回写到 RVA 的 master.logo.src / referenceImageUrl（幂等，失败仅 warn） */
export function attachMasterLogoSources(
  referenceVisualAttributes: ReferenceVisualAttributes | null | undefined,
  originals: ReferenceOriginalSources,
): void {
  if (!referenceVisualAttributes) return;
  try {
    applyMasterLogoSources(referenceVisualAttributes, originals);
    // FR-0：同步把各分类参考原图 URL 回写到 referenceImageUrl，使封面/总结页 hero 背景走落盘 URL（避免 base64 内联膨胀）
    applyReferenceImageUrlSources(referenceVisualAttributes, originals);
  } catch (e) {
    console.warn('[REF-LOGO] attach master logo sources failed:', e);
  }
}
