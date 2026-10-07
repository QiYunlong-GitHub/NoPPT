import { collectOmissions, collectRequiredContent, normalizeSlideContent } from '@noppt/ai';
import type { PresentationPlan } from '@noppt/ai';
import type { Slide } from '@noppt/core';
import type { AuditIssue } from '../../types';
import { extractRequiredText, extractKeywords } from './html-text-utils';

function computeCoverage(
  keyPoint: string,
  htmlText: string,
): { ratio: number; keywords: string[]; matched: string[] } {
  const keywords = extractKeywords(keyPoint);
  if (keywords.length === 0) {
    return { ratio: htmlText.includes(keyPoint) ? 1 : 0, keywords: [], matched: [] };
  }
  const lowerText = htmlText.toLowerCase();
  const matched: string[] = [];
  for (const kw of keywords) {
    if (lowerText.includes(kw.toLowerCase())) matched.push(kw);
  }
  return {
    ratio: matched.length / keywords.length,
    keywords,
    matched,
  };
}

function metadataFor(input: {
  contentId: string;
  expectedSummary: string;
  observedSummary: string;
  coverage: number;
  omissionReason: string;
  keywords: string[];
  matched: string[];
}): Record<string, unknown> {
  return {
    // keyPoint is retained for consumers of the legacy validator contract.
    keyPoint: input.expectedSummary,
    contentId: input.contentId,
    expectedSummary: input.expectedSummary,
    observedSummary: input.observedSummary,
    expectedText: input.expectedSummary,
    observedText: input.observedSummary,
    coverage: input.coverage,
    omissionReason: input.omissionReason,
    expectedKeywords: input.keywords,
    matchedKeywords: input.matched,
  };
}

export function validateKeyPoints(slides: Slide[], plan: PresentationPlan): AuditIssue[] {
  const issues: AuditIssue[] = [];
  const planSlides = plan.slides || [];

  for (let i = 0; i < slides.length; i++) {
    const slidePlan = planSlides[i];
    if (!slidePlan || !slidePlan.keyPoints || slidePlan.keyPoints.length === 0) continue;

    const slide = slides[i];
    const plainText = extractRequiredText(slide.html);
    const content = normalizeSlideContent(slidePlan, i);
    const requiredItems = collectRequiredContent(content);
    const omissions = collectOmissions(content);

    for (let keyPointIndex = 0; keyPointIndex < slidePlan.keyPoints.length; keyPointIndex += 1) {
      const rawKeyPoint = slidePlan.keyPoints[keyPointIndex];
      const keyPoint = typeof rawKeyPoint === 'string' ? rawKeyPoint.trim() : '';
      const normalizedContentId = requiredItems[keyPointIndex]?.contentId
        ?? omissions[keyPointIndex]?.contentId
        ?? `slide-${i + 1}-keypoint-${keyPointIndex + 1}`;
      const explicitOmission = omissions.find((omission) =>
        omission.contentId === normalizedContentId || (keyPoint && omission.originalText?.trim() === keyPoint),
      );
      const contentId = explicitOmission?.contentId ?? normalizedContentId;
      if (!keyPoint) {
        issues.push({
          ruleId: 'keypoint-empty',
          severity: 'error',
          engine: 'content',
          slideIndex: i,
          message: `关键要点 ${contentId} 为空，不能用空节点替代必需内容`,
          fixSuggestion: '补充非空要点，或记录带原因的逐项 omission',
          fixable: false,
          metadata: metadataFor({
            contentId,
            expectedSummary: '',
            observedSummary: '',
            coverage: 0,
            omissionReason: explicitOmission?.reason ?? 'empty_required_text',
            keywords: [],
            matched: [],
          }),
        });
        continue;
      }
      const { ratio, keywords, matched } = computeCoverage(keyPoint, plainText);
      const observedSummary = ratio > 0 ? plainText : '';

      if (explicitOmission) {
        issues.push({
          ruleId: 'keypoint-omitted',
          severity: 'warn',
          engine: 'content',
          slideIndex: i,
          message: `关键要点"${keyPoint}"已明确省略：${explicitOmission.reason}`,
          fixSuggestion: '保留逐项省略原因并在候选审核结果中继续追踪该 contentId',
          fixable: false,
          metadata: metadataFor({
            contentId,
            expectedSummary: keyPoint,
            observedSummary,
            coverage: ratio,
            omissionReason: explicitOmission.reason,
            keywords,
            matched,
          }),
        });
        continue;
      }

      if (ratio < 0.3) {
        issues.push({
          ruleId: 'keypoint-missing',
          severity: 'error',
          engine: 'content',
          slideIndex: i,
          message: `关键要点"${keyPoint}"在幻灯片中几乎未体现（覆盖率 ${(ratio * 100).toFixed(0)}%）`,
          fixSuggestion: '在幻灯片正文中补充该要点的核心信息，确保每个关键点都有对应内容',
          fixable: false,
          metadata: metadataFor({
            contentId,
            expectedSummary: keyPoint,
            observedSummary,
            coverage: ratio,
            omissionReason: 'silent_drop',
            keywords,
            matched,
          }),
        });
      } else if (ratio < 0.5) {
        issues.push({
          ruleId: 'keypoint-partial',
          severity: 'warn',
          engine: 'content',
          slideIndex: i,
          message: `关键要点"${keyPoint}"在幻灯片中体现不足（覆盖率 ${(ratio * 100).toFixed(0)}%）`,
          fixSuggestion: '补充与该要点相关的详细描述，确保信息完整传达',
          fixable: false,
          metadata: metadataFor({
            contentId,
            expectedSummary: keyPoint,
            observedSummary,
            coverage: ratio,
            omissionReason: 'partial_match',
            keywords,
            matched,
          }),
        });
      }
    }
  }

  return issues;
}
