import type { Presentation } from '@noppt/core';
import type { PresentationPlan, ReferenceContext } from '@noppt/ai';
import { detectBlackBlockTitle, resolveReferenceComposition } from '@noppt/ai';
import { generateId } from '@noppt/core';
import type {
  AuditConfig,
  AuditContext,
  AuditReport,
  AuditReportMetadata,
  AuditEngineResult,
  AuditIssue,
  AuditEngineType,
  AuditEngineContract,
  FixSummary,
} from '../types';
import { DEFAULT_AUDIT_CONFIG, mergeConfig } from '../config/default-config';
import { AutoFixer } from '../fix/auto-fixer';
import { LayoutAuditEngine } from '../engines/layout-engine';
import { SanitizationAuditEngine } from '../engines/sanitization-engine';
import { buildIntegrityReport } from './integrity-evidence';

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

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const normalized = message.trim();
  return (normalized || '未知审核引擎错误').slice(0, 500);
}

function diagnosticResult(
  engine: AuditEngineType,
  code: string,
  message: string,
  durationMs: number,
): AuditEngineResult {
  return {
    engine,
    engineName: engine,
    status: 'error',
    score: 0,
    issues: [
      {
        ruleId: `audit.${code.toLowerCase()}`,
        severity: 'error',
        engine,
        slideIndex: -1,
        message,
        fixable: false,
        metadata: { diagnostic: true, code },
      },
    ],
    durationMs,
    raw: { code, message },
  };
}

export class AuditEngine {
  private config: AuditConfig;
  private engines: Map<AuditEngineType, AuditEngineContract> = new Map();
  private autoFixer: AutoFixer;
  private layoutEngine: LayoutAuditEngine;
  private sanitizationEngine: SanitizationAuditEngine;
  private destroyPromise: Promise<void> | null = null;

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

  registerEngine(type: AuditEngineType, engine: AuditEngineContract): void {
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
    ...args: [
      designContext?: { style: string; primaryColor: string; fontFamily: string; iconStyle: string },
      referenceContext?: ReferenceContext,
      runId?: string,
      integrityOptions?: { phase?: AuditContext['phase']; source?: AuditContext['source'] },
    ]
  ): Promise<AuditReport> {
    const [designContext, referenceContext, runId, integrityOptions] = args;
    const context: AuditContext = {
      presentation,
      plan,
      config: this.config,
      designContext,
      referenceContext,
      runId,
      phase: integrityOptions?.phase ?? 'candidate',
      source: integrityOptions?.source ?? (presentation.slides.some((slide) => slide.deck) ? 'deck' : 'html-fallback'),
    };

    const engineOrder: AuditEngineType[] = [
      'layout',
      'visual',
      'content',
      'fidelity',
      'sanitization',
    ];
    const engineResults: AuditEngineResult[] = [];
    const allIssues: AuditIssue[] = [];

    for (const engineType of engineOrder) {
      if (!this.config.engines[engineType]) continue;
      const engine = this.engines.get(engineType);
      if (!engine) {
        const missing = diagnosticResult(
          engineType,
          'AUDIT_ENGINE_MISSING',
          `已启用的审核引擎未注册：${engineType}`,
          0,
        );
        engineResults.push(missing);
        allIssues.push(...missing.issues);
        continue;
      }

      const engineStart = Date.now();
      try {
        const result: AuditEngineResult = await engine.audit(context);
        result.durationMs = Date.now() - engineStart;
        engineResults.push(result);
        allIssues.push(...result.issues);
      } catch (err: unknown) {
        const failed = diagnosticResult(
          engineType,
          'AUDIT_ENGINE_FAILED',
          `审核引擎执行失败（${engineType}）：${safeErrorMessage(err)}`,
          Date.now() - engineStart,
        );
        engineResults.push(failed);
        allIssues.push(...failed.issues);
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
      const comp = resolveReferenceComposition(referenceContext?.visualAttributes, pageType);
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
      const fixableIssues = allIssues.filter((i) => i.fixable && i.severity !== 'off');
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

        const reverifyContext: AuditContext = { ...context, presentation };
        const reverifiedResults: AuditEngineResult[] = [];
        const deterministicIssues = allIssues.filter((issue) => issue.metadata?.deterministic === true);
        for (const engineType of engineOrder) {
          if (!this.config.engines[engineType]) continue;
          const engine = this.engines.get(engineType);
          if (!engine) {
            reverifiedResults.push(
              diagnosticResult(
                engineType,
                'AUDIT_ENGINE_MISSING',
                `自动修复后的复核缺少已启用引擎：${engineType}`,
                0,
              ),
            );
            continue;
          }
          const reverifyStart = Date.now();
          try {
            const result = await engine.audit(reverifyContext);
            result.durationMs = Date.now() - reverifyStart;
            reverifiedResults.push(result);
          } catch (err: unknown) {
            reverifiedResults.push(
              diagnosticResult(
                engineType,
                'AUDIT_REVERIFY_FAILED',
                `自动修复后的${engineType}复核失败：${safeErrorMessage(err)}`,
                Date.now() - reverifyStart,
              ),
            );
          }
        }
        engineResults.length = 0;
        engineResults.push(...reverifiedResults);
        allIssues.length = 0;
        allIssues.push(...deterministicIssues, ...reverifiedResults.flatMap((result) => result.issues));
      }
    }

    const overallScore = this.calculateOverallScore(engineResults);
    const calculatedOverallResult = this.determineOverallResult(overallScore);
    const errorCount = allIssues.filter((i) => i.severity === 'error').length;
    const regenerationRequired = errorCount > 0;
    const integrity = buildIntegrityReport(context, engineResults, allIssues, fixSummary);
    const overallResult = integrity.status === 'fail'
      ? 'fail'
      : integrity.status === 'needs_review'
        ? 'warn'
        : calculatedOverallResult;

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
      integrity,
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
      if (!contentEngine && this.config.engines.content) {
        engineResult = diagnosticResult(
          'content',
          'AUDIT_ENGINE_MISSING',
          '已启用的审核引擎未注册：content',
          0,
        );
      } else if (contentEngine?.auditOutline) {
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
    } catch (err: unknown) {
      engineResult = diagnosticResult(
        'content',
        'AUDIT_ENGINE_FAILED',
        `大纲审核引擎执行失败：${safeErrorMessage(err)}`,
        Date.now() - engineStart,
      );
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
      regenerationRequired: engineResult.issues.some((i) => i.severity === 'error'),
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
      const report = await this.auditPresentation(
        presentation,
        plan,
        designContext,
        referenceContext,
      );
      return { report, fixedPresentation: presentation };
    } finally {
      this.config.autoFix = originalAutoFix;
    }
  }

  private calculateOverallScore(results: AuditEngineResult[]): number {
    const validResults = results.filter((r) => r.status !== 'error' && r.score > 0);
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
    if (this.destroyPromise) return this.destroyPromise;
    const engines = [...this.engines.values()];
    this.engines.clear();
    this.destroyPromise = (async () => {
      let firstError: unknown;
      for (const engine of engines) {
        try {
          await engine.destroy?.();
        } catch (error: unknown) {
          firstError ??= error;
        }
      }
      if (firstError) throw firstError;
    })();
    return this.destroyPromise;
  }
}
