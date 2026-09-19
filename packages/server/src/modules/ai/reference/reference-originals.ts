/**
 * 参考原图（Q7）落盘与回写相关纯函数（从 ai.service.ts 外置）。
 *
 * - backfillReferenceOriginalSources：单一出口补齐「参考原图 URL + 尺寸」（缓存命中/未重传时从磁盘兜底）。
 * - persistReferenceOriginals：将本轮上传的参考原图副本按 presentationId 暂存，供母版 LOGO 开窗复用。
 *
 * storage 通过参数注入，ai.service.ts 保留对应 private 方法作为薄委托，调用方与 Phase 4 测试网不变。
 */
import { applyMasterLogoSources, applyReferenceImageUrlSources } from '@noppt/ai';
import type { ReferenceVisualAttributes } from '@noppt/ai';

export interface ReferenceOriginalImage {
  url: string;
  width?: number;
  height?: number;
}

export interface ReferenceOriginalSourcesMap {
  cover?: ReferenceOriginalImage;
  content?: ReferenceOriginalImage;
  summary?: ReferenceOriginalImage;
}

export interface ReferenceOriginalsStorage {
  readReferenceOriginalImage(
    presentationId: string,
    slot: 'cover' | 'content' | 'summary',
  ): ReferenceOriginalImage | undefined;
  saveReferenceOriginalImage(
    presentationId: string,
    slot: 'cover' | 'content' | 'summary',
    dataUrl: string,
  ): Promise<ReferenceOriginalImage>;
}

// 单一出口补齐「参考原图 URL + 尺寸」：用已落盘文件兜底回写 master.logo.src / refW / refH / referenceImageUrl。
// 与 attachMasterLogoSources 职责区分：后者本论新上传原图→落盘；本方法缓存命中/未重传时从磁盘兜底。
// 两者幂等（同值覆盖），且在 4 个已覆盖入口会重复执行，无副作用。失败仅 warn，绝不中断生成。
export function backfillReferenceOriginalSources(
  referenceVisualAttributes: ReferenceVisualAttributes | null | undefined,
  presentationId: string | undefined,
  storage: ReferenceOriginalsStorage,
): void {
  if (!referenceVisualAttributes || !presentationId) return;
  try {
    const originals: ReferenceOriginalSourcesMap = {};
    let count = 0;
    for (const slot of ['cover', 'content', 'summary'] as const) {
      try {
        const ex = storage.readReferenceOriginalImage(presentationId, slot);
        if (ex) {
          originals[slot] = ex;
          count++;
        }
      } catch (e) {
        console.warn(`[REF-CACHE] read existing original image failed (${slot}):`, e);
      }
    }
    if (count === 0) return;
    applyMasterLogoSources(referenceVisualAttributes, originals);
    applyReferenceImageUrlSources(referenceVisualAttributes, originals);
    console.log(`[REF-CACHE] 单一出口补齐 src/尺寸: 命中 ${count} 个槽位`);
  } catch (e) {
    console.warn('[REF-LOGO] backfill reference original sources failed:', e);
  }
}

// 将参考图片原图副本（Q7）按 presentationId 暂存，供后续母版 LOGO 开窗复用（FR-16）。
// 返回各分类暂存后可访问的 URL 映射，供 applyMasterLogoSources 回写到 master.logo.src。
export async function persistReferenceOriginals(
  req: {
    presentationId?: string;
    referenceImageCoverOriginal?: string;
    referenceImageContentOriginal?: string;
    referenceImageSummaryOriginal?: string;
  },
  storage: ReferenceOriginalsStorage,
): Promise<ReferenceOriginalSourcesMap> {
  const presentationId = req.presentationId;
  const result: ReferenceOriginalSourcesMap = {};
  if (!presentationId) return result;
  const slots: Array<['cover' | 'content' | 'summary', string | undefined]> = [
    ['cover', req.referenceImageCoverOriginal],
    ['content', req.referenceImageContentOriginal],
    ['summary', req.referenceImageSummaryOriginal],
  ];
  for (const [slot, dataUrl] of slots) {
    if (dataUrl) {
      try {
        result[slot] = await storage.saveReferenceOriginalImage(presentationId, slot, dataUrl);
      } catch (e) {
        console.warn(`[REF-CACHE] save original image failed (${slot}):`, e);
      }
    } else {
      // 分步生成 / 缓存命中：本轮未重新上传原图 dataURL，但上一轮已落盘 → 直接复用磁盘文件，
      // 使 content/summary 的 master.logo.src 跨步骤不丢失（FR-16 修正）。
      try {
        const existing = storage.readReferenceOriginalImage(presentationId, slot);
        if (existing) result[slot] = existing;
      } catch (e) {
        console.warn(`[REF-CACHE] read existing original image failed (${slot}):`, e);
      }
    }
  }
  return result;
}
