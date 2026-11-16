import type { Deck } from '@noppt/core/deck';
import type { PresentationPlan } from '../../../types';
import type { PlanContractIssue } from './slide-contract';
import type { PlanToDeckResult } from './plan-to-deck';
import {
  formatCompareNormalizationNotices,
  normalizeComparePlan,
  type CompareNormalizationNotice,
} from './compare-contract-normalizer';

export interface StrictDeckInspection {
  ok: boolean;
  deck?: Deck;
  issues: PlanContractIssue[];
  warnings: PlanContractIssue[];
}

export interface StrictDeckNormalization {
  plan: PresentationPlan;
  notices: CompareNormalizationNotice[];
}

export function formatStrictDeckIssues(issues: PlanContractIssue[]): string {
  return issues.length ? issues.map((issue) => issue.code).join(', ') : 'unknown';
}

/** 带页码 / 页型 / 路径 / observed 的可操作诊断，供 warning 与 error 日志分栏打印。 */
export function formatStrictDeckIssueDetails(
  issues: PlanContractIssue[],
  plan?: PresentationPlan,
): string {
  if (!issues.length) return 'none';
  return issues
    .map((issue) =>
      `slide${issue.slideIndex + 1}` +
      `(${plan?.slides?.[issue.slideIndex]?.pageType ?? 'unknown'}) ` +
      `${issue.code}@${issue.path} observed=${issue.observed}`,
    )
    .join('; ');
}

export function formatStrictDeckNotices(notices: CompareNormalizationNotice[]): string {
  return formatCompareNormalizationNotices(notices);
}

/**
 * strict 校验前的对比页安全归一。detailed 版本额外返回降级 notices，
 * 供调用方聚合打印；薄包装保持既有调用点与测试签名不变。
 */
export function normalizePlanForStrictDeckDetailed(plan: PresentationPlan): StrictDeckNormalization {
  return normalizeComparePlan(plan);
}

export function normalizePlanForStrictDeck(plan: PresentationPlan): PresentationPlan {
  return normalizeComparePlan(plan).plan;
}

/** fatal 与 recoverable 分流：只有 fatal 阻断。 */
function splitIssues(issues: PlanContractIssue[]): {
  fatal: PlanContractIssue[];
  warnings: PlanContractIssue[];
} {
  return {
    fatal: issues.filter((issue) => !issue.recoverable),
    warnings: issues.filter((issue) => issue.recoverable),
  };
}

/** 正式出片：整册 strict，任何 fatal 都阻断。 */
export function inspectStrictDeckResult(result: PlanToDeckResult): StrictDeckInspection {
  const issues = Array.isArray(result.issues) ? result.issues : [];
  const { fatal, warnings } = splitIssues(issues);
  if (!result.deck || result.status === 'fail' || fatal.length > 0) {
    return { ok: false, deck: undefined, issues, warnings };
  }
  return { ok: true, deck: result.deck, issues, warnings };
}

/**
 * 引导式首屏预览：只按窗口内的 issue 判定。
 * 整册 Deck 仍以 legacy 模式构建（fatal 时保留 deck），因此页脚总页数、
 * master 与 originalIdx 绝对下标语义不受窗口影响。
 */
export function inspectDeckResultInWindow(
  result: PlanToDeckResult,
  startIdx: number,
  endIdx: number,
): StrictDeckInspection {
  const issues = (Array.isArray(result.issues) ? result.issues : []).filter(
    (issue) => issue.slideIndex >= startIdx && issue.slideIndex < endIdx,
  );
  const { fatal, warnings } = splitIssues(issues);
  if (!result.deck || fatal.length > 0) {
    return { ok: false, deck: undefined, issues, warnings };
  }
  return { ok: true, deck: result.deck, issues, warnings };
}

export class StrictDeckValidationError extends Error {
  readonly fatalIssues: PlanContractIssue[];
  readonly warnings: PlanContractIssue[];

  constructor(
    fatalIssues: PlanContractIssue[],
    warnings: PlanContractIssue[] = [],
    plan?: PresentationPlan,
  ) {
    super(
      `Deck contract validation failed: ${formatStrictDeckIssues(fatalIssues)}` +
        ` | ${formatStrictDeckIssueDetails(fatalIssues, plan)}`,
    );
    this.name = 'StrictDeckValidationError';
    this.fatalIssues = fatalIssues;
    this.warnings = warnings;
  }
}
