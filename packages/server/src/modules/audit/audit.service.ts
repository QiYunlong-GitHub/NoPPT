import { Injectable, Logger, NotFoundException, OnModuleDestroy } from '@nestjs/common';
import { join } from 'path';
import { existsSync, mkdirSync, copyFileSync } from 'fs';
import type { Presentation } from '@noppt/core';
import type { PresentationPlan, ReferenceContext } from '@noppt/ai';
import {
  createChatProvider,
  openTraceSession,
  closeTraceSession,
  getLLMTraces,
  setSessionStage,
  setLogConfig,
  normalizeLogConfig,
  type TraceableProvider,
} from '@noppt/ai';
import {
  AuditEngine,
  VisualAuditEngine,
  ContentAuditEngine,
  FidelityAuditEngine,
  DEFAULT_AUDIT_CONFIG,
  getConfigPreset,
  type AuditReport,
  type AuditConfig,
  type ScreenshotInfo,
  assertIntegrityEvidenceForSave,
} from '@noppt/audit';
import { StorageService } from '../../common/storage.service';
import { ConfigService } from '../config/config.service';
import { LogsService } from '../logs/logs.service';

export interface AuditRunOptions {
  plan?: PresentationPlan;
  config?: Partial<AuditConfig>;
  designContext?: {
    style: string;
    primaryColor: string;
    fontFamily: string;
    iconStyle: string;
  };
  referenceContext?: ReferenceContext;
  engines?: {
    layout?: boolean;
    visual?: boolean;
    content?: boolean;
    fidelity?: boolean;
  };
  runId?: string;
  phase?: 'candidate' | 'preview' | 'promotion' | 'rollback';
  source?: 'plan' | 'deck' | 'canonical-html' | 'editor' | 'html-fallback' | 'unknown';
}

@Injectable()
export class AuditService implements OnModuleDestroy {
  private readonly logger = new Logger(AuditService.name);
  private engine: AuditEngine | null = null;
  private visualEngine: VisualAuditEngine | null = null;
  private fidelityEngine: FidelityAuditEngine | null = null;
  private contentProviderRef: any = null;
  private vlmProviderRef: any = null;
  private initPromise: Promise<AuditEngine> | null = null;
  private configFingerprint: string = '';
  private lifecycleGeneration = 0;

  constructor(
    private readonly storage: StorageService,
    private readonly configService: ConfigService,
    private readonly logsService: LogsService,
  ) {}

  private computeFingerprint(auditSettings: any, modelRouting: any): string {
    return JSON.stringify({
      enabled: auditSettings?.enabled,
      strictness: auditSettings?.strictness,
      autoFix: auditSettings?.autoFix,
      maxRegenerationRetries: auditSettings?.maxRegenerationRetries,
      llmReview: auditSettings?.llmReview,
      vlmReview: auditSettings?.vlmReview,
      engines: auditSettings?.engines,
      thresholds: auditSettings?.thresholds,
      audit: modelRouting?.audit,
      auditVlm: modelRouting?.auditVlm,
    });
  }

  private async getEngine(): Promise<AuditEngine> {
    const appConfig = await this.configService.getConfig();
    const fingerprint = this.computeFingerprint(appConfig.auditSettings, appConfig.modelRouting);

    if (this.engine && this.configFingerprint === fingerprint) {
      return this.engine;
    }

    if (this.initPromise && this.configFingerprint === fingerprint) {
      return this.initPromise;
    }

    if (this.initPromise || this.engine) {
      if (this.engine) this.logger.log('检测到审核配置变更，重新初始化审核引擎...');
      await this.destroy();
    }

    this.configFingerprint = fingerprint;
    this.initPromise = this.initializeEngine();
    return this.initPromise;
  }

  private async initializeEngine(): Promise<AuditEngine> {
    const generation = this.lifecycleGeneration;
    const appConfig = await this.configService.getConfig();
    if (generation !== this.lifecycleGeneration) throw new Error('审核引擎初始化已取消');
    const auditSettings = appConfig.auditSettings;
    const preset = getConfigPreset(auditSettings.strictness);

    const config: Partial<AuditConfig> = {
      ...DEFAULT_AUDIT_CONFIG,
      ...preset,
      engines: { ...auditSettings.engines },
      autoFix: auditSettings.autoFix,
      maxRegenerationRetries: auditSettings.maxRegenerationRetries,
      thresholds: { ...auditSettings.thresholds },
    };

    const engine = new AuditEngine(config);

    this.contentProviderRef = null;
    this.vlmProviderRef = null;
    this.visualEngine = null;
    this.fidelityEngine = null;

    let contentProvider: any = null;
    if (auditSettings.llmReview) {
      const auditModelConfig = await this.configService.resolveModelConfig('audit');
      if (generation !== this.lifecycleGeneration) throw new Error('审核引擎初始化已取消');
      if (auditModelConfig) {
        contentProvider = createChatProvider(auditModelConfig);
        this.logger.log(
          `审核 LLM 评审已启用：${auditModelConfig.provider}/${auditModelConfig.model}`,
        );
        if (/flash/i.test(String(auditModelConfig?.model || ''))) {
          this.logger.warn(
            `[MODEL] 当前审核 LLM 评审模型为 flash 档（${auditModelConfig?.model}），质量建议 ≥ plus 档（不影响流程）。`,
          );
        }
        this.logger.log(
          `audit 模型路由: modelRouting.audit=${auditModelConfig.model}（可通过全局配置调整）`,
        );
      } else {
        this.logger.warn('审核 LLM 评审已启用，但未配置 audit 路由模型，跳过文本评审');
      }
    }
    const contentEngine = new ContentAuditEngine({ provider: contentProvider ?? undefined });
    engine.registerEngine('content', contentEngine);

    let vlmProvider: any = null;
    if (auditSettings.vlmReview) {
      const vlmModelConfig = await this.configService.resolveModelConfig('auditVlm');
      if (generation !== this.lifecycleGeneration) throw new Error('审核引擎初始化已取消');
      if (vlmModelConfig) {
        vlmProvider = createChatProvider(vlmModelConfig);
        this.logger.log(
          `审核 VLM 视觉评审已启用：${vlmModelConfig.provider}/${vlmModelConfig.model}`,
        );
      } else {
        this.logger.warn('审核 VLM 视觉评审已启用，但未配置 auditVlm 路由模型，跳过视觉评审');
      }
    }

    try {
      this.visualEngine = new VisualAuditEngine(undefined, {
        workspaceDir: this.storage.getWorkspaceDir(),
      });
      if (vlmProvider) {
        this.visualEngine.setVlmProvider(vlmProvider);
      }
      engine.registerEngine('visual', this.visualEngine);
    } catch (err) {
      this.logger.warn(
        `VisualAuditEngine unavailable: ${err instanceof Error ? err.message : err}`,
      );
    }

    try {
      this.fidelityEngine = new FidelityAuditEngine();
      engine.registerEngine('fidelity', this.fidelityEngine);
    } catch (err) {
      this.logger.warn(
        `FidelityAuditEngine unavailable: ${err instanceof Error ? err.message : err}`,
      );
    }

    if (generation !== this.lifecycleGeneration) {
      try {
        await engine.destroy();
      } catch {
        /* best-effort cleanup of an initialization cancelled by destroy */
      }
      throw new Error('审核引擎初始化已取消');
    }
    this.contentProviderRef = contentProvider;
    this.vlmProviderRef = vlmProvider;
    this.engine = engine;
    return engine;
  }

  private getReportDir(presentationId: string): string {
    const dir = join(this.storage.getPresentationDir(presentationId), 'audit');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    return dir;
  }

  private getReportPath(presentationId: string): string {
    return join(this.getReportDir(presentationId), 'latest-report.json');
  }

  private getScreenshotDir(presentationId: string): string {
    const dir = join(this.getReportDir(presentationId), 'screenshots');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    return dir;
  }

  async auditPresentation(presentationId: string, options?: AuditRunOptions): Promise<AuditReport> {
    const presentationFile = join(
      this.storage.getPresentationDir(presentationId),
      'presentation.json',
    );
    const presentation = this.storage.readJsonFile<Presentation | null>(presentationFile, null);
    if (!presentation) {
      throw new NotFoundException('演示文稿不存在');
    }
    return this.auditPresentationFromData(presentation, presentationId, options);
  }

  async auditPresentationFromData(
    presentation: Presentation,
    presentationId?: string,
    options?: AuditRunOptions,
  ): Promise<AuditReport> {
    const engine = await this.getEngine();

    const appConfig = await this.configService.getConfig();
    setLogConfig(normalizeLogConfig(appConfig.logSettings));

    const traceSessionId = `audit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    openTraceSession(traceSessionId);
    setSessionStage(traceSessionId, 'audit');

    if (this.contentProviderRef) {
      (this.contentProviderRef as TraceableProvider).activeTraceSessionId = traceSessionId;
    }
    if (this.vlmProviderRef) {
      (this.vlmProviderRef as TraceableProvider).activeTraceSessionId = traceSessionId;
    }

    try {
      if (options?.config) {
        engine.updateConfig(options.config);
      }
      if (options?.engines) {
        engine.updateConfig({ engines: { ...engine.getConfig().engines, ...options.engines } });
      }

      const report = await engine.auditPresentation(
        presentation,
        options?.plan,
        options?.designContext,
        options?.referenceContext,
        options?.runId ?? traceSessionId,
        { phase: options?.phase, source: options?.source },
      );

      report.screenshots = this.collectScreenshots(report);

      if (presentationId) {
        await this.persistReport(presentationId, report);
      }

      if (presentationId && report.integrity) {
        for (const event of report.integrity.events) {
          await this.logsService.logIntegrityEvent(presentationId, {
            ...event,
            phase: options?.phase ?? event.phase,
            source: options?.source ?? event.source,
          });
        }
      }

      const auditTraces = getLLMTraces(traceSessionId);
      if (presentationId && auditTraces.length > 0) {
        try {
          await this.logsService.logAICall(presentationId, 'audit', {
            auditId: report.metadata.auditId,
            presentationTitle: presentation.title,
            slideCount: presentation.slides.length,
            config: {
              strictness: appConfig.auditSettings?.strictness,
              llmReview: appConfig.auditSettings?.llmReview,
              vlmReview: appConfig.auditSettings?.vlmReview,
            },
            llmCalls: auditTraces,
            llmCallCount: auditTraces.length,
          });
        } catch (logErr) {
          this.logger.warn(
            `审核日志写入失败（不影响审核结果）: ${logErr instanceof Error ? logErr.message : logErr}`,
          );
        }
      }

      return report;
    } finally {
      if (this.contentProviderRef) {
        (this.contentProviderRef as TraceableProvider).activeTraceSessionId = undefined;
      }
      if (this.vlmProviderRef) {
        (this.vlmProviderRef as TraceableProvider).activeTraceSessionId = undefined;
      }
      closeTraceSession(traceSessionId);
    }
  }

  async validateBeforeSave(
    presentation: Presentation,
    presentationId: string,
    options?: AuditRunOptions,
  ): Promise<AuditReport> {
    const report = await this.auditPresentationFromData(presentation, presentationId, {
      ...options,
      phase: options?.phase ?? 'candidate',
      source: options?.source ?? (presentation.slides.some((slide) => slide.deck) ? 'deck' : 'html-fallback'),
    });
    assertIntegrityEvidenceForSave(report);
    return report;
  }

  async auditOutline(plan: PresentationPlan): Promise<AuditReport> {
    const engine = await this.getEngine();
    return engine.auditOutline(plan);
  }

  async getVlmProvider(): Promise<any | null> {
    await this.getEngine();
    return this.vlmProviderRef;
  }

  async isVlmReviewEnabled(): Promise<boolean> {
    await this.getEngine();
    return !!this.vlmProviderRef;
  }

  async auditAndFix(
    presentation: Presentation,
    plan?: PresentationPlan,
    designContext?: { style: string; primaryColor: string; fontFamily: string; iconStyle: string },
  ): Promise<{ report: AuditReport; fixedPresentation: Presentation }> {
    const engine = await this.getEngine();
    const result = await engine.auditAndFix(presentation, plan, designContext);
    result.report.screenshots = this.collectScreenshots(result.report);
    return result;
  }

  getReport(presentationId: string): AuditReport | null {
    const reportPath = this.getReportPath(presentationId);
    if (!existsSync(reportPath)) return null;
    return this.storage.readJsonFile<AuditReport | null>(reportPath, null);
  }

  getScreenshotPath(presentationId: string, slideIndex: number): string | null {
    const report = this.getReport(presentationId);
    if (!report) return null;
    const screenshot = report.screenshots.find((s) => s.slideIndex === slideIndex);
    if (!screenshot) return null;
    const persisted = join(this.getScreenshotDir(presentationId), `slide-${slideIndex}.png`);
    if (existsSync(persisted)) return persisted;
    if (existsSync(screenshot.path)) return screenshot.path;
    return null;
  }

  private collectScreenshots(report: AuditReport): ScreenshotInfo[] {
    const screenshots: ScreenshotInfo[] = [];
    const visualResult = report.engineResults.find((r) => r.engine === 'visual');
    const paths = Array.isArray(visualResult?.raw?.screenshots)
      ? visualResult.raw.screenshots.filter((value): value is string => typeof value === 'string')
      : [];
    for (let i = 0; i < paths.length; i++) {
      screenshots.push({
        slideIndex: i,
        path: paths[i],
        width: report.metadata.config.viewport.width,
        height: report.metadata.config.viewport.height,
      });
    }
    return screenshots;
  }

  private async persistReport(presentationId: string, report: AuditReport): Promise<void> {
    const screenshotDir = this.getScreenshotDir(presentationId);
    for (const screenshot of report.screenshots) {
      if (existsSync(screenshot.path)) {
        const dest = join(screenshotDir, `slide-${screenshot.slideIndex}.png`);
        try {
          copyFileSync(screenshot.path, dest);
          screenshot.path = dest;
        } catch (err) {
          this.logger.warn(
            `Failed to persist screenshot: ${err instanceof Error ? err.message : err}`,
          );
        }
      }
    }

    const reportPath = this.getReportPath(presentationId);
    await this.storage.writeJsonFile(reportPath, report);
  }

  async destroy(): Promise<void> {
    this.lifecycleGeneration += 1;
    const pendingInitialization = this.initPromise;
    this.initPromise = null;
    if (pendingInitialization) {
      try {
        await pendingInitialization;
      } catch {
        // A destroy racing initialization must still clear all references below.
      }
    }

    const engine = this.engine;
    this.engine = null;
    this.contentProviderRef = null;
    this.vlmProviderRef = null;
    this.visualEngine = null;
    this.fidelityEngine = null;
    this.configFingerprint = '';

    if (engine) {
      try {
        await engine.destroy();
      } catch (error) {
        this.logger.warn(
          `审核引擎销毁失败：${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.destroy();
  }
}
