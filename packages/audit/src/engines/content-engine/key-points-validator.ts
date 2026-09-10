import type { PresentationPlan } from '@noppt/ai';
import type { Slide } from '@noppt/core';
import type { AuditIssue } from '../../types';
import { extractPlainText, extractKeywords } from './html-text-utils';

function computeCoverage(keyPoint: string, htmlText: string): { ratio: number; keywords: string[]; matched: string[] } {
  const keywords = extractKeywords(keyPoint);
  if (keywords.length === 0) {
    return { ratio: 1, keywords: [], matched: [] };
  }
  const lowerText = htmlText.toLowerCase();
  const matched: string[] = [];
  for (const kw of keywords) {
    if (lowerText.includes(kw.toLowerCase())) {
      matched.push(kw);
    }
  }
  return {
    ratio: matched.length / keywords.length,
    keywords,
    matched,
  };
}

export function validateKeyPoints(slides: Slide[], plan: PresentationPlan): AuditIssue[] {
  const issues: AuditIssue[] = [];
  const planSlides = plan.slides || [];

  for (let i = 0; i < slides.length; i++) {
    const slidePlan = planSlides[i];
    if (!slidePlan || !slidePlan.keyPoints || slidePlan.keyPoints.length === 0) continue;

    const slide = slides[i];
    const plainText = extractPlainText(slide.html);

    for (const keyPoint of slidePlan.keyPoints) {
      if (!keyPoint || !keyPoint.trim()) continue;
      const { ratio, keywords, matched } = computeCoverage(keyPoint, plainText);

      if (ratio < 0.3) {
        issues.push({
          ruleId: 'keypoint-missing',
          severity: 'error',
          engine: 'content',
          slideIndex: i,
          message: `关键要点"${keyPoint}"在幻灯片中几乎未体现（覆盖率 ${(ratio * 100).toFixed(0)}%）`,
          fixSuggestion: '在幻灯片正文中补充该要点的核心信息，确保每个关键点都有对应内容',
          fixable: false,
          metadata: {
            keyPoint,
            coverage: ratio,
            expectedKeywords: keywords,
            matchedKeywords: matched,
          },
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
          metadata: {
            keyPoint,
            coverage: ratio,
            expectedKeywords: keywords,
            matchedKeywords: matched,
          },
        });
      }
    }
  }

  return issues;
}
