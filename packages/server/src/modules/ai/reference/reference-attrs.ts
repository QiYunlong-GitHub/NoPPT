/**
 * 参考属性哈希（从 ai.service.ts 外置）。
 * 纯函数；REF_ATTRS_EXTRACTOR_VERSION 随提取逻辑变更而递增。
 * ai.service.ts 保留对应 private 方法作为薄委托，对外调用方与 Phase 4 测试网不变。
 */
import { createHash } from 'crypto';

export const REF_ATTRS_EXTRACTOR_VERSION = 'v2-structure';

export function computeRefAttrsHash(req: {
  referenceHtml?: string;
  referenceImage?: string;
  referenceHtmlCover?: string;
  referenceHtmlContent?: string;
  referenceHtmlSummary?: string;
  referenceHtmlGlobal?: string;
  referenceImageCover?: string;
  referenceImageContent?: string;
  referenceImageSummary?: string;
  referenceImageGlobal?: string;
}): string {
  const fields = [
    REF_ATTRS_EXTRACTOR_VERSION,
    req.referenceHtml ?? '',
    req.referenceImage ?? '',
    req.referenceHtmlCover ?? '',
    req.referenceHtmlContent ?? '',
    req.referenceHtmlSummary ?? '',
    req.referenceHtmlGlobal ?? '',
    req.referenceImageCover ?? '',
    req.referenceImageContent ?? '',
    req.referenceImageSummary ?? '',
    req.referenceImageGlobal ?? '',
  ];
  return createHash('sha1').update(fields.join('\u0001')).digest('hex');
}
