import type { AuditIssue, AuditReport } from '../types';

export type { FixResult } from './auto-fixer';

export type ResolutionAction = 'auto-fix' | 'regenerate' | 'warn' | 'pass';

export interface ResolutionDecision {
  action: ResolutionAction;
  fixableIssues: AuditIssue[];
  regenerateIssues: AuditIssue[];
  warnIssues: AuditIssue[];
  reason: string;
}

export class ResolutionStrategy {
  static decide(
    report: AuditReport,
    config: { autoFix: boolean; maxRetries: number; currentRetry?: number },
  ): ResolutionDecision {
    const fixableIssues = report.issues.filter(
      i => i.fixable && (i.severity === 'error' || i.severity === 'warn'),
    );
    const unfixableErrors = report.issues.filter(i => !i.fixable && i.severity === 'error');
    const warnIssues = report.issues.filter(i => i.severity === 'warn' && !i.fixable);
    const infoIssues = report.issues.filter(i => i.severity === 'info');

    const retries = config.currentRetry ?? 0;
    const canRegenerate = retries < config.maxRetries;

    if (unfixableErrors.length > 0 && canRegenerate) {
      return {
        action: 'regenerate',
        fixableIssues: config.autoFix ? fixableIssues : [],
        regenerateIssues: unfixableErrors,
        warnIssues: [...warnIssues, ...infoIssues],
        reason: `存在 ${unfixableErrors.length} 个不可自动修复的致命问题，需要重新生成`,
      };
    }

    if (config.autoFix && fixableIssues.length > 0) {
      return {
        action: 'auto-fix',
        fixableIssues,
        regenerateIssues: canRegenerate ? unfixableErrors : [],
        warnIssues: [...warnIssues, ...infoIssues],
        reason: `存在 ${fixableIssues.length} 个可自动修复的问题，尝试修复`,
      };
    }

    if (unfixableErrors.length > 0 && !canRegenerate) {
      return {
        action: 'warn',
        fixableIssues: [],
        regenerateIssues: unfixableErrors,
        warnIssues: [...warnIssues, ...infoIssues],
        reason: `已达最大重试次数，${unfixableErrors.length} 个致命问题未能修复，降级处理`,
      };
    }

    if (warnIssues.length > 0) {
      return {
        action: 'warn',
        fixableIssues: [],
        regenerateIssues: [],
        warnIssues: [...warnIssues, ...infoIssues],
        reason: `存在 ${warnIssues.length} 个警告级问题`,
      };
    }

    return {
      action: 'pass',
      fixableIssues: [],
      regenerateIssues: [],
      warnIssues: infoIssues,
      reason: '审核通过',
    };
  }
}
