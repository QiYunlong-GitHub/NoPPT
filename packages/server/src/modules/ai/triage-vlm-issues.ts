import type { AuditIssue } from '@noppt/audit';
import type { VlmRootCause } from '@noppt/audit';

export type SlideTriage = 'html' | 'image' | 'both';

const IMAGE_KEYWORDS = [
  '图片模糊',
  '模糊',
  '畸变',
  '畸形',
  '扭曲',
  '无关',
  '不相关',
  '风格不符',
  '裁切',
  '低分辨率',
  '像素',
  '锯齿',
  '图片内容',
  '配图质量',
  '主体缺失',
  '画面违和',
  '图片质量',
  'blurry',
  'distorted',
  'irrelevant',
  'low quality',
  'pixelated',
];

const HTML_KEYWORDS = [
  '对齐',
  '重叠',
  '溢出',
  '超出',
  '裁切文本',
  '字号',
  '过小',
  '过大',
  '留白',
  '层级',
  '对比',
  '配色',
  '边距',
  '间距',
  '错位',
  '遮挡',
  '换行',
  '文字',
  '排版',
  '布局',
  'alignment',
  'overlap',
  'overflow',
  'font size',
  'spacing',
  'layout',
];

function keywordClassify(text: string): SlideTriage {
  const t = text.toLowerCase();
  const isImage = IMAGE_KEYWORDS.some((k) => t.includes(k.toLowerCase()));
  const isHtml = HTML_KEYWORDS.some((k) => t.includes(k.toLowerCase()));
  if (isImage && isHtml) return 'both';
  if (isImage) return 'image';
  if (isHtml) return 'html';
  return 'both';
}

function normalizeRootCause(raw: unknown): SlideTriage {
  if (raw === 'html' || raw === 'image' || raw === 'both') return raw;
  return 'both';
}

/**
 * 聚合某一页的所有 VLM issue，判定该页的修复目标。
 * 优先使用每条 issue 的 metadata.rootCause（VLM 已标注）；
 * 对缺失 rootCause 的旧 issue，用 message/fixSuggestion 关键词兜底分类。
 */
export function triageSlideIssues(issues: AuditIssue[]): SlideTriage {
  if (!issues || issues.length === 0) return 'html';

  let involvesHtml = false;
  let involvesImage = false;

  for (const issue of issues) {
    const raw = issue.metadata?.rootCause as VlmRootCause | undefined;
    const cause: SlideTriage = raw
      ? normalizeRootCause(raw)
      : keywordClassify(`${issue.message || ''} ${issue.fixSuggestion || ''}`);

    if (cause === 'html') involvesHtml = true;
    else if (cause === 'image') involvesImage = true;
    else {
      involvesHtml = true;
      involvesImage = true;
    }
  }

  if (involvesHtml && involvesImage) return 'both';
  if (involvesImage) return 'image';
  return 'html';
}
