import type { AuditIssue, AuditSeverity } from '../../types';

export interface LayoutRuleContext {
  html: string;
  slideIndex: number;
  config: Record<string, AuditSeverity>;
}

export interface LayoutRule {
  id: string;
  description: string;
  defaultSeverity: AuditSeverity;
  fixable: boolean;
  check(ctx: LayoutRuleContext): AuditIssue[];
  fix?(html: string): string;
}
