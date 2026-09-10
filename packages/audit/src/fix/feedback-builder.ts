import type { AuditReport, AuditIssue } from '../types';

export class FeedbackBuilder {
  static buildPromptFeedback(report: AuditReport): string {
    const lines: string[] = [];
    const fatalIssues = report.issues.filter((i) => i.severity === 'error' && !i.fixable);
    const fixableErrors = report.issues.filter((i) => i.severity === 'error' && i.fixable);
    const importantIssues = report.issues.filter((i) => i.severity === 'warn' && !i.fixable);
    const quickWins = report.issues.filter((i) => i.fixable || i.severity === 'info');

    lines.push('');
    lines.push('═══════════════════════════════════════');
    lines.push('【自动审核反馈：以下问题必须修复】');
    lines.push(
      `综合评分：${report.overallScore}/100（${
        report.overallResult === 'pass'
          ? '通过'
          : report.overallResult === 'warn'
            ? '警告'
            : '未通过'
      }）`,
    );
    lines.push('');

    if (fatalIssues.length > 0) {
      lines.push('## 致命问题（必须重新生成修复）');
      fatalIssues.forEach((iss, idx) => {
        lines.push(`${idx + 1}. [${iss.ruleId}] ${iss.message}`);
        if (iss.fixSuggestion) {
          lines.push(`   修复建议：${iss.fixSuggestion}`);
        }
        if (iss.slideIndex >= 0) {
          lines.push(
            `   位置：第 ${iss.slideIndex + 1} 页${iss.selector ? ` (${iss.selector})` : ''}`,
          );
        }
      });
      lines.push('');
    }

    if (fixableErrors.length > 0) {
      lines.push('## 已自动修复的问题');
      fixableErrors.forEach((iss) => {
        lines.push(`- [${iss.ruleId}] ${iss.message}`);
      });
      lines.push('');
    }

    if (importantIssues.length > 0) {
      lines.push('## 重要问题（应当修复）');
      importantIssues.forEach((iss, idx) => {
        lines.push(`${idx + 1}. [${iss.ruleId}] ${iss.message}`);
        if (iss.fixSuggestion) {
          lines.push(`   → ${iss.fixSuggestion}`);
        }
      });
      lines.push('');
    }

    if (quickWins.length > 0) {
      lines.push('## 快速修复清单');
      const seen = new Set<string>();
      quickWins.forEach((iss) => {
        if (!seen.has(iss.ruleId)) {
          lines.push(`- [ ] ${iss.message}`);
          seen.add(iss.ruleId);
        }
      });
      lines.push('');
    }

    const engineGroups = new Map<string, AuditIssue[]>();
    for (const iss of report.issues) {
      if (!iss.fixSuggestion) continue;
      const group = engineGroups.get(iss.engine) || [];
      group.push(iss);
      engineGroups.set(iss.engine, group);
    }

    if (engineGroups.size > 0) {
      lines.push('## 各维度具体修复建议');
      for (const [engine, issues] of engineGroups) {
        lines.push(`### ${engine}`);
        issues.forEach((iss) => {
          lines.push(`- ${iss.fixSuggestion}`);
        });
      }
      lines.push('');
    }

    lines.push('请根据以上反馈重新生成完整的HTML，必须解决所有致命问题。保持原有内容要点不变。');
    lines.push('═══════════════════════════════════════');

    return lines.join('\n');
  }

  static buildOutlineFeedback(report: AuditReport): string {
    const lines: string[] = [];
    const errors = report.issues.filter((i) => i.severity === 'error');
    const warns = report.issues.filter((i) => i.severity === 'warn');

    lines.push('');
    lines.push('═══════════════════════════════════════');
    lines.push('【大纲审核反馈】');
    lines.push(`评分：${report.overallScore}/100`);
    lines.push('');

    if (errors.length > 0) {
      lines.push('必须修复的问题：');
      errors.forEach((e, i) => {
        lines.push(`${i + 1}. ${e.message}`);
        if (e.fixSuggestion) lines.push(`   → ${e.fixSuggestion}`);
      });
    }

    if (warns.length > 0) {
      lines.push('建议改进：');
      warns.forEach((w, i) => {
        lines.push(`${i + 1}. ${w.message}`);
      });
    }

    lines.push('═══════════════════════════════════════');
    return lines.join('\n');
  }
}
