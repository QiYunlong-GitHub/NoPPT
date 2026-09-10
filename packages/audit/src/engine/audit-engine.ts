import type { Presentation } from '@noppt/core';
import type { PresentationPlan, ReferenceContext } from '@noppt/ai';
import { detectBlackBlockTitle, resolveReferenceComposition } from '@noppt/ai';
import { generateId } from '@noppt/core';
import type {
  AuditConfig, AuditContext, AuditReport, AuditReportMetadata,
  AuditEngineResult, AuditIssue, AuditEngineType, FixSummary,
} from '../types';
import { DEFAULT_AUDIT_CONFIG, mergeConfig } from '../config/default-config';
import { AutoFixer } from '../fix/auto-fixer';
import { LayoutAuditEngine } from '../engines/layout-engine';
import { SanitizationAuditEngine } from '../engines/sanitization-engine';

const ENGINE_VERSION = '0.1.0';

/** 判断最外层容器是否同时含居中三件套（justify-content/align-items/text-align:center） */
function rootContainerCentered(html: string): boolean {
  const m = /^<(div|section|article)\b([^>]*)>/i.exec(html.trim());
  if (!m) return false;
  const styleMatch = m[2].match(/style="([^"]*)"/i);
  if (!styleMatch) return false;
  const s = styleMatch[1];
  return (
    /justify-content\s*:\s*center/i.test(s) &&
    /align-items\s*:\s*center/i.test(s) &&
    /text-align\s*:\s*center/i.test(s)
  );
}

export class AuditEngine {
  private config: AuditConfig;
  private engines: Map<AuditEngineType, any> = new Map();
  private autoFixer: AutoFixer;
  private layoutEngine: LayoutAuditEngine;
  private sanitizationEngine: SanitizationAuditEngine;

  constructor(config?: Partial<AuditConfig>) {
    this.config = mergeConfig(DEFAULT_AUDIT_CONFIG, config);
    this.layoutEngine = new LayoutAuditEngine();
    this.sanitizationEngine = new SanitizationAuditEngine();
    this.autoFixer = new AutoFixer(this.layoutEngine);
    this.registerEngine('layout', this.layoutEngine);
    // AC-8 / Task10c: sanitization 引擎注册为系统内置（与 layout 同级），无需外部注入。
    // 它在 engineOrder 末尾执行（先跑 layout/content/visual/fidelity，最后读取 fallback 标记写 issue），
    // 这样其他引擎对 fallback 页自身的评分（例如"缺乏可视化支撑"）也会被一同记录，互不覆盖。
    this.registerEngine('sanitization', this.sanitizationEngine);
  }

  registerEngine(type: AuditEngineType, engine: any): void {
    this.engines.set(type, engine);
  }

  getConfig(): AuditConfig {
    return this.config;
  }

  updateConfig(config: Partial<AuditConfig>): void {
    this.config = mergeConfig(this.config, config);
  }

  async auditPresentation(
    presentation: Presentation,
    plan?: PresentationPlan,
    designContext?: { style: string; primaryColor: string; fontFamily: string; iconStyle: string },
    referenceContext?: ReferenceContext,
  ): Promise<AuditReport> {
    const context: AuditContext = {
      presentation,
      plan,
      config: this.config,
      designContext,
      referenceContext,
    };

    const engineOrder: AuditEngineType[] = ['layout', 'visual', 'content', 'fidelity', 'sanitization'];
    const engineResults: AuditEngineResult[] = [];
    const allIssues: AuditIssue[] = [];

    for (const engineType of engineOrder) {
      if (!this.config.engines[engineType]) continue;
      const engine = this.engines.get(engineType);
      if (!engine) continue;

      const engineStart = Date.now();
      try {
        const result: AuditEngineResult = await engine.audit(context);
        result.durationMs = Date.now() - engineStart;
        engineResults.push(result);
        allIssues.push(...result.issues);
      } catch (err: any) {
        engineResults.push({
          engine: engineType,
          engineName: engineType,
          status: 'error',
          score: 0,
          issues: [],
          durationMs: Date.now() - engineStart,
          raw: { error: err?.message || String(err) },
        });
      }
    }

    // 确定性致命检测（后处理黑名单兜底）：黑块标题 + 构图不符，命中即 severity='error' → 触发重生成
    for (let i = 0; i < presentation.slides.length; i++) {
      const slide = presentation.slides[i];
      if (detectBlackBlockTitle(slide.html)) {
        allIssues.push({
          ruleId: 'visual.black-block-title',
          severity: 'error',
          engine: 'visual',
          slideIndex: i,
          message:
            '标题存在「黑块渐变文字」：background 简写覆盖 background-clip:text，导致深色渐变铺满整个标题盒子且文字透明（不可见）。',
          fixSuggestion:
            '移除 H1 上的 background:linear-gradient 与 background-clip:text，改用纯色 color；或保证 background 简写写在 clip 声明之前。',
          fixable: false,
          metadata: { deterministic: true },
        });
      }
      const pageType = context.plan?.slides?.[i]?.pageType ?? '';
      const comp = resolveReferenceComposition((referenceContext as any)?.visualAttributes, pageType);
      if (comp === 'left-aligned' && rootContainerCentered(slide.html)) {
        allIssues.push({
          ruleId: 'layout.composition-mismatch',
          severity: 'error',
          // 与 visual.black-block-title 同为「确定性致命检测」，必须标记为 'visual' 而非 'layout'：
          // 否则在默认 autoFix=true 时会被 audit-engine 的 reassembly（保留 engine!=='layout' 的 issue）丢弃，导致检测静默失效。
          engine: 'visual',
          slideIndex: i,
          message: '参考为左对齐构图，但本页根容器仍被居中（居中三件套），与参考版式不符。',
          fixSuggestion: '移除根容器的 justify-content/align-items/text-align:center。',
          fixable: false,
          metadata: { deterministic: true },
        });
      }
    }

    let fixSummary: FixSummary | undefined;

    if (this.config.autoFix) {
      const fixableIssues = allIssues.filter(i => i.fixable && i.severity !== 'off');
      if (fixableIssues.length > 0) {
        const fixResult = this.autoFixer.fixAll(presentation.slides, allIssues);

        for (let i = 0; i < presentation.slides.length; i++) {
          presentation.slides[i] = { ...presentation.slides[i], html: fixResult.slides[i].html };
        }

        fixSummary = {
          fixedCount: fixResult.summary.fixedCount,
          failedCount: fixResult.summary.failedCount,
          fixedRuleIds: fixResult.summary.fixedRuleIds,
          failedRuleIds: fixResult.summary.failedRuleIds,
        };

        const layoutStart = Date.now();
        try {
          const reverifyContext: AuditContext = { ...context, presentation };
          const layoutResult = await this.layoutEngine.audit(reverifyContext);
          layoutResult.durationMs = Date.now() - layoutStart;

          const layoutIdx = engineResults.findIndex(r => r.engine === 'layout');
          if (layoutIdx >= 0) {
            engineResults[layoutIdx] = layoutResult;
          } else {
            engineResults.unshift(layoutResult);
          }

          const nonLayoutIssues = allIssues.filter(i => i.engine !== 'layout');
          allIssues.length = 0;
          allIssues.push(...nonLayoutIssues, ...layoutResult.issues);
        } catch {
        }
      }
    }

    const overallScore = this.calculateOverallScore(engineResults);
    const overallResult = this.determineOverallResult(overallScore);
    const errorCount = allIssues.filter(i => i.severity === 'error').length;
    const regenerationRequired = errorCount > 0;

    const metadata: AuditReportMetadata = {
      auditId: generateId(),
      timestamp: new Date().toISOString(),
      engineVersion: ENGINE_VERSION,
      config: this.config,
      presentationTitle: presentation.title,
      slideCount: presentation.slides.length,
    };

    return {
      metadata,
      overallScore,
      overallResult,
      engineResults,
      issues: allIssues,
      screenshots: [],
      fixSummary,
      regenerationRequired,
    };
  }

  async auditOutline(plan: PresentationPlan): Promise<AuditReport> {
    const context: AuditContext = {
      presentation: {
        id: generateId(),
        title: plan.title,
        slides: [],
        zoom: 1,
        width: 1280,
        height: 720,
        transition: 'none',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        version: 1,
      },
      plan,
      config: this.config,
    };

    const engineStart = Date.now();
    let engineResult: AuditEngineResult;
    try {
      const contentEngine = this.engines.get('content');
      if (contentEngine?.auditOutline) {
        engineResult = await contentEngine.auditOutline(context);
      } else {
        engineResult = {
          engine: 'content',
          engineName: 'content',
          status: 'passed',
          score: 100,
          issues: [],
          durationMs: 0,
        };
      }
      engineResult.durationMs = Date.now() - engineStart;
    } catch (err: any) {
      engineResult = {
        engine: 'content',
        engineName: 'content',
        status: 'error',
        score: 0,
        issues: [],
        durationMs: Date.now() - engineStart,
        raw: { error: err?.message || String(err) },
      };
    }

    const overallScore = engineResult.score;
    const overallResult = this.determineOverallResult(overallScore);

    return {
      metadata: {
        auditId: generateId(),
        timestamp: new Date().toISOString(),
        engineVersion: ENGINE_VERSION,
        config: this.config,
        presentationTitle: plan.title,
        slideCount: plan.slides.length,
      },
      overallScore,
      overallResult,
      engineResults: [engineResult],
      issues: engineResult.issues,
      screenshots: [],
      regenerationRequired: engineResult.issues.some(i => i.severity === 'error'),
    };
  }

  async auditAndFix(
    presentation: Presentation,
    plan?: PresentationPlan,
    designContext?: { style: string; primaryColor: string; fontFamily: string; iconStyle: string },
    referenceContext?: ReferenceContext,
  ): Promise<{ report: AuditReport; fixedPresentation: Presentation }> {
    const originalAutoFix = this.config.autoFix;
    this.config.autoFix = true;
    try {
      const report = await this.auditPresentation(presentation, plan, designContext, referenceContext);
      return { report, fixedPresentation: presentation };
    } finally {
      this.config.autoFix = originalAutoFix;
    }
  }

  private calculateOverallScore(results: AuditEngineResult[]): number {
    const validResults = results.filter(r => r.status !== 'error' && r.score > 0);
    if (validResults.length === 0) return 0;

    let totalWeight = 0;
    let weightedSum = 0;
    for (const result of validResults) {
      const weight = this.config.weights[result.engine] ?? 0.25;
      weightedSum += result.score * weight;
      totalWeight += weight;
    }
    if (totalWeight === 0) return 0;
    return Math.round((weightedSum / totalWeight) * 10) / 10;
  }

  private determineOverallResult(score: number): 'pass' | 'warn' | 'fail' {
    if (score >= this.config.thresholds.pass) return 'pass';
    if (score >= this.config.thresholds.warn) return 'warn';
    return 'fail';
  }

  async destroy(): Promise<void> {
    for (const engine of this.engines.values()) {
      if (engine.destroy) {
        await engine.destroy();
      }
    }
  }
}
