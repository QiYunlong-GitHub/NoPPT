import type { PresentationPlan } from '@noppt/ai';
import type { AuditIssue } from '../../types';

const NARRATIVE_ORDER: Record<string, number> = {
  opening: 0,
  background: 1,
  problem: 2,
  solution: 3,
  evidence: 4,
  comparison: 5,
  closing: 6,
};

export function validateOutline(plan: PresentationPlan): AuditIssue[] {
  const issues: AuditIssue[] = [];
  const slides = plan.slides || [];
  const count = slides.length;

  if (count < 3) {
    issues.push({
      ruleId: 'outline-too-few-slides',
      severity: 'error',
      engine: 'content',
      slideIndex: -1,
      message: `幻灯片数量过少（共 ${count} 页），演示文稿至少需要 3 页`,
      fixSuggestion: '补充封面、内容页和总结页，确保内容完整',
      fixable: false,
    });
  } else if (count > 30) {
    issues.push({
      ruleId: 'outline-too-many-slides',
      severity: 'warn',
      engine: 'content',
      slideIndex: -1,
      message: `幻灯片数量过多（共 ${count} 页），建议控制在 30 页以内以保持观众注意力`,
      fixSuggestion: '合并相关内容或精简冗余页面',
      fixable: false,
    });
  }

  if (count > 0) {
    const firstPageType = slides[0].pageType;
    if (firstPageType !== 'cover') {
      issues.push({
        ruleId: 'outline-missing-cover',
        severity: 'error',
        engine: 'content',
        slideIndex: -1,
        message: `第一页类型为 "${firstPageType}"，演示文稿必须以 cover（封面）页开始`,
        fixSuggestion: '将第一页设置为封面页，包含标题和副标题',
        fixable: false,
      });
    }
  }

  const hasSummary = slides.some((s) => s.pageType === 'summary');
  const lastIsSummary = count > 0 && slides[count - 1].pageType === 'summary';
  if (!hasSummary) {
    issues.push({
      ruleId: 'outline-missing-summary',
      severity: 'warn',
      engine: 'content',
      slideIndex: -1,
      message: '演示文稿未包含 summary（总结）页',
      fixSuggestion: '在末尾添加总结页，回顾关键要点和行动号召',
      fixable: false,
    });
  } else if (!lastIsSummary) {
    issues.push({
      ruleId: 'outline-summary-not-last',
      severity: 'warn',
      engine: 'content',
      slideIndex: -1,
      message: '总结页未位于演示文稿末尾',
      fixSuggestion: '将总结页移至最后一页以收束全文',
      fixable: false,
    });
  }

  if (count > 0) {
    const typeCounts = new Map<string, number>();
    for (const slide of slides) {
      typeCounts.set(slide.pageType, (typeCounts.get(slide.pageType) || 0) + 1);
    }
    for (const [pageType, typeCount] of typeCounts) {
      const ratio = typeCount / count;
      if (ratio > 0.6) {
        issues.push({
          ruleId: 'outline-type-distribution',
          severity: 'warn',
          engine: 'content',
          slideIndex: -1,
          message: `页面类型 "${pageType}" 占比过高（${(ratio * 100).toFixed(0)}%，${typeCount}/${count} 页），同一类型不应超过 60%`,
          fixSuggestion: '丰富页面类型，使用图文、卡片、对比等不同版式',
          fixable: false,
          metadata: { pageType, count: typeCount, ratio },
        });
      }
    }
  }

  if (plan.narrativeArc) {
    let maxStage = -1;
    for (let i = 0; i < slides.length; i++) {
      const role = slides[i].narrativeRole;
      if (!role) continue;
      const stage = NARRATIVE_ORDER[role];
      if (stage === undefined) continue;
      if (maxStage >= 0 && stage + 1 < maxStage) {
        issues.push({
          ruleId: 'outline-narrative-order',
          severity: 'warn',
          engine: 'content',
          slideIndex: i,
          message: `叙事顺序异常：第 ${i + 1} 页的叙事角色 "${role}" 出现在更后期的叙事阶段之后（当前最大阶段为 ${maxStage}）`,
          fixSuggestion:
            '按照 opening→background→problem→solution→evidence→comparison→closing 的逻辑顺序编排页面',
          fixable: false,
          metadata: { narrativeRole: role, stage, maxStageBefore: maxStage },
        });
      }
      if (stage > maxStage) maxStage = stage;
    }
  }

  return issues;
}
