import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import type { AuditContext, AuditEngineResult, AuditIssue } from '../../types';
import { SlideRenderer } from './slide-renderer';
import { checkFontAndIcons, createFontProfile } from './font-icon-check';
import {
  DEFAULT_VISUAL_VIEWPORTS,
  runVisualValidation,
  type VisualValidationReport,
} from './visual-validation';
import type { FontProfile } from './font-icon-check';
import { runVlmCritique } from './vlm-critique';
import type { AIModelProvider } from '@noppt/ai';
import {
  computeFigureGroundContrast,
  computeColorHarmony,
  computeColorfulness,
  computeSubbandEntropy,
  computeVisualHrv,
} from './metrics';

export interface PerSlideVisualMetrics {
  slideIndex: number;
  contrast: {
    mean: number;
    min: number;
    max: number;
    lowContrastTextCount: number;
  };
  harmony: {
    bestTemplate: string;
    bestDistance: number;
    score: number;
  };
  colorfulness: number;
  entropy: number;
  fonts: {
    fontFamilyCount: number;
    fontSizeLevels: number;
    iconStyles: string[];
    iconStyleConsistent: boolean;
    state: 'resolved' | 'fallback' | 'unverified' | 'failed';
    profile: FontProfile;
    declaredFamily: string;
    resolvedFamily: string;
    declaredWeight: number | string;
    resolvedWeight?: number | string;
    fontSize?: number;
    lineHeight?: number;
    domMetrics: {
      scrollWidth?: number;
      clientWidth?: number;
      scrollHeight?: number;
      clientHeight?: number;
    };
    fontChecks?: Record<string, boolean>;
    weightState: 'matched' | 'mismatch' | 'unverified';
    fallbackUsed: boolean;
    metricStatus: 'ok' | 'warn' | 'fail';
    maxMetricDelta: number;
    metricDeltas: { width: number; height: number; canvas: number };
    reason?: string;
  };
  layoutProfile?: string;
  screenshotPath?: string;
}

interface VisualIssueCollectionInput {
  slideIndex: number;
  contrast: Awaited<ReturnType<typeof computeFigureGroundContrast>>;
  harmony: ReturnType<typeof computeColorHarmony>;
  colorfulness: ReturnType<typeof computeColorfulness>;
  entropy: ReturnType<typeof computeSubbandEntropy>;
  fontIcons: Awaited<ReturnType<typeof checkFontAndIcons>>;
  issues: AuditIssue[];
}

interface RenderedSlideAuditInput {
  renderer: SlideRenderer;
  slides: AuditContext['presentation']['slides'];
  viewport: { width: number; height: number };
  fontProfile: FontProfile;
  defaultLayoutProfile: string;
  perSlide: PerSlideVisualMetrics[];
  complexities: number[];
  screenshotPaths: string[];
  issues: AuditIssue[];
  vlmScores: number[];
  context: AuditContext;
  tempDir: string;
}
export class VisualAuditEngine {
  private renderer: SlideRenderer | null = null;
  private tempDir: string;
  private initialized = false;
  private initError: Error | null = null;
  private vlmProvider: AIModelProvider | null = null;
  private workspaceDir?: string;

  constructor(tempDir?: string, options?: { workspaceDir?: string }) {
    this.tempDir = tempDir || fs.mkdtempSync(path.join(os.tmpdir(), 'noppt-visual-'));
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
    this.workspaceDir = options?.workspaceDir;
  }

  setVlmProvider(provider: AIModelProvider | null): void {
    this.vlmProvider = provider;
  }

  private async ensureRenderer(): Promise<SlideRenderer | null> {
    if (this.initialized) return this.renderer;
    this.initialized = true;
    try {
      this.renderer = new SlideRenderer({ workspaceDir: this.workspaceDir });
      await this.renderer.initialize();
      return this.renderer;
    } catch (err) {
      this.initError = err instanceof Error ? err : new Error(String(err));
      this.renderer = null;
      return null;
    }
  }

  async audit(context: AuditContext): Promise<AuditEngineResult> {
    const startTime = Date.now();
    const issues: AuditIssue[] = [];
    const slides = context.presentation.slides.filter((s) => !s.hidden);

    const renderer = await this.ensureRenderer();
    const perSlide: PerSlideVisualMetrics[] = [];
    const complexities: number[] = [];
    const screenshotPaths: string[] = [];
    const vlmScores: number[] = [];

    if (!renderer || this.initError) {
      return {
        engine: 'visual',
        engineName: 'Visual Design Audit Engine',
        status: 'error',
        score: 0,
        issues: [
          {
            ruleId: 'visual-renderer-unavailable',
            severity: 'error',
            engine: 'visual',
            slideIndex: -1,
            message: `无法启动 Chromium 渲染器: ${this.initError?.message || 'unknown error'}`,
            fixable: false,
          },
        ],
        durationMs: Date.now() - startTime,
        raw: { error: this.initError?.message },
      };
    }

    const viewport = context.config.viewport || { width: 1280, height: 720 };
    const fontProfile: FontProfile = createFontProfile(
      context.designContext?.fontFamily || 'system-ui, sans-serif',
      400,
      { source: context.designContext ? 'design-context' : 'computed-default' },
    );
    const defaultLayoutProfile = viewport.width < 1000
      ? 'narrow'
      : viewport.width > 1400
        ? 'wide'
        : 'standard';

    let visualValidation: VisualValidationReport;
    try {
      visualValidation = await runVisualValidation(context.presentation, {
        presentationId: context.presentation.id,
        runId: context.runId,
        artifactRoot: path.join(this.tempDir, 'visual-validation'),
        viewports: DEFAULT_VISUAL_VIEWPORTS,
        resizeSequence: [
          DEFAULT_VISUAL_VIEWPORTS[0],
          DEFAULT_VISUAL_VIEWPORTS[1],
          DEFAULT_VISUAL_VIEWPORTS[2],
          DEFAULT_VISUAL_VIEWPORTS[1],
          DEFAULT_VISUAL_VIEWPORTS[0],
        ],
        renderer,
      });
    } catch (error) {
      visualValidation = {
        runId: context.runId || `visual-${Date.now()}`,
        presentationId: context.presentation.id,
        status: 'unverified',
        pageCount: slides.length,
        viewportSequence: DEFAULT_VISUAL_VIEWPORTS.map((item) => `${item.width}x${item.height}`),
        browser: { status: 'unverified', reason: error instanceof Error ? error.message : String(error) },
        slides: [],
        unverified: [{ code: 'visual_validation_failed', detail: error instanceof Error ? error.message : String(error) }],
        reportPath: path.join(this.tempDir, 'visual-validation', 'visual-validation-report.json'),
        markdownReportPath: path.join(this.tempDir, 'visual-validation', 'visual-validation-report.md'),
      };
    }

    for (const slideResult of visualValidation.slides) {
      if (slideResult.status === 'fail') {
        const metric = slideResult.metrics.find((item) => item.requiredClipped > 0 || item.emptyRequiredNodes > 0 || item.horizontalOverflow || item.titleOverlap || item.parity === 'fail' || item.font.status === 'failed');
        const code = metric?.parity === 'fail'
          ? 'parity_mismatch'
          : metric?.emptyRequiredNodes
            ? 'empty_required_node'
            : metric?.font.status === 'failed'
              ? 'font_metric_exceeded'
              : 'required_clipped';
        issues.push({
          ruleId: `visual-validation-${code}`,
          severity: 'error',
          engine: 'visual',
          slideIndex: slideResult.slideIndex,
          message: `第 ${slideResult.slideIndex + 1} 页视觉验证失败：${slideResult.error || 'required visual checks did not pass'}`,
          fixSuggestion: '保留隔离候选和截图证据，修复后重新执行全部 viewport 与 resize checks。',
          fixable: false,
          metadata: { code, visualValidation: true, artifactPath: visualValidation.reportPath },
        });
      } else if (slideResult.status === 'unverified') {
        issues.push({
          ruleId: 'visual-validation-unverified',
          severity: 'warn',
          engine: 'visual',
          slideIndex: slideResult.slideIndex,
          message: `第 ${slideResult.slideIndex + 1} 页视觉验证未完成：${slideResult.error || visualValidation.browser.reason || 'browser/font evidence unavailable'}`,
          fixSuggestion: '在可用 Chromium、字体和资源环境中重新执行视觉验证。',
          fixable: false,
          metadata: { code: 'visual_evidence_unverified', visualValidation: true, artifactPath: visualValidation.reportPath },
        });
      }
    }

    await this.collectRenderedSlideEvidence({
      renderer, slides, viewport, fontProfile, defaultLayoutProfile, perSlide, complexities,
      screenshotPaths, issues, vlmScores, context, tempDir: this.tempDir,
    });

    const hrv = computeVisualHrv(complexities);
    if (complexities.length >= 2 && hrv.rmssd < 0.15) {
      issues.push({
        ruleId: 'monotonous-pacing',
        severity: 'info',
        engine: 'visual',
        slideIndex: -1,
        message: `整套幻灯片视觉节奏过于单调（RMSSD=${hrv.rmssd.toFixed(3)}），建议在相邻页面间制造视觉层次变化`,
        fixSuggestion: '调整页面布局、颜色或信息量，避免每页视觉权重高度相似',
        fixable: false,
        metadata: { rmssd: hrv.rmssd, interpretation: hrv.interpretation },
      });
    }

    const scores = this.computeWeightedScore(perSlide, hrv.score);
    const metricScore = scores.total;
    let total = metricScore;

    if (vlmScores.length > 0) {
      const vlmAvg = vlmScores.reduce((a, b) => a + b, 0) / vlmScores.length;
      total = metricScore * 0.6 + vlmAvg * 0.4;
    }

    const score = Math.round(total * 10) / 10;

    const errorCount = issues.filter((i) => i.severity === 'error').length;
    const warnCount = issues.filter((i) => i.severity === 'warn').length;
    let status: AuditEngineResult['status'] = 'passed';
    if (errorCount > 0) status = 'fail';
    else if (warnCount > 0 || score < 80) status = 'warn';

    return {
      engine: 'visual',
      engineName: 'Visual Design Audit Engine',
      status,
      score,
      issues,
      durationMs: Date.now() - startTime,
      raw: {
        perSlide,
        fontEvidence: perSlide.map((slide) => ({
          slideIndex: slide.slideIndex,
          state: slide.fonts.state,
          profile: slide.fonts.profile,
          declaredFamily: slide.fonts.declaredFamily,
          resolvedFamily: slide.fonts.resolvedFamily,
          declaredWeight: slide.fonts.declaredWeight,
          resolvedWeight: slide.fonts.resolvedWeight,
          fontSize: slide.fonts.fontSize,
          lineHeight: slide.fonts.lineHeight,
          domMetrics: slide.fonts.domMetrics,
          fontChecks: slide.fonts.fontChecks,
          weightState: slide.fonts.weightState,
          fallbackUsed: slide.fonts.fallbackUsed,
          metricStatus: slide.fonts.metricStatus,
          maxMetricDelta: slide.fonts.maxMetricDelta,
          metricDeltas: slide.fonts.metricDeltas,
          layoutProfile: slide.layoutProfile,
          reason: slide.fonts.reason,
        })),
        pacing: hrv,
        componentScores: scores,
        metricScore,
        vlmScores,
        vlmEnabled: !!this.vlmProvider,
        screenshots: screenshotPaths,
        visualValidation,
      },
    };
  }

  private async collectRenderedSlideEvidence(input: RenderedSlideAuditInput): Promise<void> {
    const { renderer, slides, viewport, fontProfile, defaultLayoutProfile, perSlide, complexities, screenshotPaths, issues, vlmScores, context, tempDir } = input;
    for (let i = 0; i < slides.length; i++) {
      const slide = slides[i];
      const page = await renderer.renderSlide(slide.html);
      try {
        if (viewport.width !== 1280 || viewport.height !== 720) await page.setViewportSize(viewport);
        const screenshotPath = path.join(tempDir, `slide-${i}.png`);
        await renderer.captureScreenshot(page, screenshotPath);
        screenshotPaths.push(screenshotPath);
        const imageData = await renderer.getImageData(page);
        const [contrast, harmony, colorfulness, entropy, fontIcons] = await Promise.all([
          computeFigureGroundContrast(imageData, page),
          Promise.resolve(computeColorHarmony(imageData)),
          Promise.resolve(computeColorfulness(imageData)),
          Promise.resolve(computeSubbandEntropy(imageData)),
          checkFontAndIcons(page, fontProfile),
        ]);
        complexities.push(entropy.entropy);
        perSlide.push({
          slideIndex: i,
          contrast: { mean: contrast.mean, min: contrast.min, max: contrast.max, lowContrastTextCount: contrast.text.lowContrastPairs.length },
          harmony: { bestTemplate: harmony.bestTemplate, bestDistance: harmony.bestDistance, score: harmony.score },
          colorfulness: colorfulness.colorfulness,
          entropy: entropy.entropy,
          fonts: {
            fontFamilyCount: fontIcons.fontFamilyCount, fontSizeLevels: fontIcons.fontSizeLevels, iconStyles: fontIcons.iconStyles,
            iconStyleConsistent: fontIcons.iconStyleConsistent, state: fontIcons.font.state, profile: fontIcons.font.profile,
            declaredFamily: fontIcons.font.declaredFamily, resolvedFamily: fontIcons.font.resolvedFamily,
            declaredWeight: fontIcons.font.declaredWeight, resolvedWeight: fontIcons.font.resolvedWeight,
            fontSize: fontIcons.font.fontSize, lineHeight: fontIcons.font.lineHeight, domMetrics: fontIcons.font.domMetrics,
            fontChecks: fontIcons.font.fontChecks, weightState: fontIcons.font.weightState, fallbackUsed: fontIcons.font.fallbackUsed,
            metricStatus: fontIcons.font.metricStatus, maxMetricDelta: fontIcons.font.maxMetricDelta,
            metricDeltas: fontIcons.font.metricDeltas, reason: fontIcons.font.reason,
          },
          layoutProfile: fontIcons.layoutProfile || defaultLayoutProfile,
          screenshotPath,
        });
        this.collectPerSlideIssues({ slideIndex: i, contrast, harmony, colorfulness, entropy, fontIcons, issues });
        if (this.vlmProvider) {
          try {
            const vlmResult = await runVlmCritique(this.vlmProvider, screenshotPath, i, slide.title, undefined, context.referenceContext);
            if (vlmResult.issues.length > 0) issues.push(...vlmResult.issues);
            if (vlmResult.score > 0) vlmScores.push(vlmResult.score);
          } catch {
            // VLM critique is optional; preserve the deterministic audit result on failure.
          }
        }
      } finally {
        await page.close();
      }
    }
  }

  private collectPerSlideIssues(input: VisualIssueCollectionInput): void {
    const { slideIndex, contrast, harmony, colorfulness, entropy, fontIcons, issues } = input;
    const minRatio = contrast.text.min;

    if (minRatio < 3.0) {
      issues.push({
        ruleId: 'low-contrast',
        severity: 'error',
        engine: 'visual',
        slideIndex,
        message: `第 ${slideIndex + 1} 页存在严重低对比度文本（最低对比度 ${minRatio.toFixed(2)}:1），不满足可读性要求`,
        fixSuggestion: '提高文字与背景的亮度差，正文文本对比度至少达到 4.5:1',
        fixable: false,
        metadata: {
          minContrastRatio: minRatio,
          meanContrastRatio: contrast.text.mean,
          lowContrastPairs: contrast.text.lowContrastPairs.slice(0, 5),
        },
      });
    } else if (minRatio < 4.5) {
      issues.push({
        ruleId: 'low-contrast',
        severity: 'warn',
        engine: 'visual',
        slideIndex,
        message: `第 ${slideIndex + 1} 页存在低对比度文本（最低对比度 ${minRatio.toFixed(2)}:1），低于 WCAG AA 标准 4.5:1`,
        fixSuggestion: '增大文字颜色与背景色之间的对比度',
        fixable: false,
        metadata: { minContrastRatio: minRatio, meanContrastRatio: contrast.text.mean },
      });
    }

    if (harmony.score < 0.4) {
      issues.push({
        ruleId: 'poor-harmony',
        severity: 'warn',
        engine: 'visual',
        slideIndex,
        message: `第 ${slideIndex + 1} 页色彩和谐度较低（最佳模板=${harmony.bestTemplate}，距离=${harmony.bestDistance.toFixed(1)}°，评分=${harmony.score.toFixed(2)}）`,
        fixSuggestion: '使用互补色、类似色或三角色等经典配色方案，统一色相分布',
        fixable: false,
        metadata: {
          bestTemplate: harmony.bestTemplate,
          bestDistance: harmony.bestDistance,
          score: harmony.score,
        },
      });
    }

    if (colorfulness.colorfulness < 15) {
      issues.push({
        ruleId: 'colorfulness-extreme',
        severity: 'info',
        engine: 'visual',
        slideIndex,
        message: `第 ${slideIndex + 1} 页色彩丰富度偏低（M=${colorfulness.colorfulness.toFixed(1)}），整体显得单调`,
        fixSuggestion: '可适当增加强调色或品牌色，提升视觉吸引力',
        fixable: false,
        metadata: { colorfulness: colorfulness.colorfulness, direction: 'dull' },
      });
    } else if (colorfulness.colorfulness > 80) {
      issues.push({
        ruleId: 'colorfulness-extreme',
        severity: 'info',
        engine: 'visual',
        slideIndex,
        message: `第 ${slideIndex + 1} 页色彩过于丰富（M=${colorfulness.colorfulness.toFixed(1)}），可能造成视觉混乱`,
        fixSuggestion: '减少主色数量，控制在 2-3 种主色以内',
        fixable: false,
        metadata: { colorfulness: colorfulness.colorfulness, direction: 'chaotic' },
      });
    }

    if (entropy.entropy > 5.0) {
      issues.push({
        ruleId: 'high-complexity',
        severity: 'warn',
        engine: 'visual',
        slideIndex,
        message: `第 ${slideIndex + 1} 页视觉复杂度过高（子带熵=${entropy.entropy.toFixed(2)}），信息密度过大`,
        fixSuggestion: '精简内容、增加留白、分拆信息到多个页面',
        fixable: false,
        metadata: { entropy: entropy.entropy },
      });
    }

    if (fontIcons.fontFamilyCount > 3) {
      issues.push({
        ruleId: 'too-many-fonts',
        severity: 'warn',
        engine: 'visual',
        slideIndex,
        message: `第 ${slideIndex + 1} 页使用了 ${fontIcons.fontFamilyCount} 种字体（建议不超过 3 种）：${fontIcons.fontFamilies.join(', ')}`,
        fixSuggestion: '统一使用 1-2 个字体族，通过字重和字号建立层次',
        fixable: false,
        metadata: {
          fontFamilyCount: fontIcons.fontFamilyCount,
          fontFamilies: fontIcons.fontFamilies,
        },
      });
    }

    if (!fontIcons.iconStyleConsistent) {
      issues.push({
        ruleId: 'inconsistent-icons',
        severity: 'warn',
        engine: 'visual',
        slideIndex,
        message: `第 ${slideIndex + 1} 页图标风格不一致，同时存在：${fontIcons.iconStyles.join(', ')}`,
        fixSuggestion: '统一使用线性或实心一种图标风格',
        fixable: false,
        metadata: { iconStyles: fontIcons.iconStyles },
      });
    }

    if (fontIcons.font.state === 'unverified') {
      issues.push({
        ruleId: 'font-unverified',
        severity: 'warn',
        engine: 'visual',
        slideIndex,
        message: `第 ${slideIndex + 1} 页字体无法验证：${fontIcons.font.reason || 'unknown'}`,
        fixSuggestion: '在支持 document.fonts 的浏览器中重新验证字体和度量',
        fixable: false,
        metadata: { font: fontIcons.font },
      });
    } else if (fontIcons.font.state === 'fallback') {
      issues.push({
        ruleId: 'font-fallback',
        severity: 'warn',
        engine: 'visual',
        slideIndex,
        message: `第 ${slideIndex + 1} 页使用字体回退：${fontIcons.font.declaredFamily} → ${fontIcons.font.resolvedFamily}`,
        fixSuggestion: '触发安全重排并复核字体度量，不能将回退标记为 resolved',
        fixable: false,
        metadata: { font: fontIcons.font },
      });
    } else if (fontIcons.font.state === 'failed') {
      issues.push({
        ruleId: 'font-validation-failed',
        severity: 'error',
        engine: 'visual',
        slideIndex,
        message: `第 ${slideIndex + 1} 页字体验证失败：${fontIcons.font.reason || 'unknown'}`,
        fixSuggestion: '检查声明字体、字重和文本度量后重新布局',
        fixable: false,
        metadata: { font: fontIcons.font },
      });
    } else if (fontIcons.font.metricStatus === 'warn') {
      issues.push({
        ruleId: 'font-metric-delta',
        severity: 'warn',
        engine: 'visual',
        slideIndex,
        message: `第 ${slideIndex + 1} 页字体度量差达到 ${(fontIcons.font.maxMetricDelta * 100).toFixed(1)}%`,
        fixSuggestion: '触发重排或缩小文本区域内容，并保留度量证据',
        fixable: false,
        metadata: { font: fontIcons.font },
      });
    }
  }

  private computeWeightedScore(
    perSlide: PerSlideVisualMetrics[],
    pacingScore: number,
  ): {
    total: number;
    contrast: number;
    harmony: number;
    colorfulness: number;
    complexity: number;
    pacing: number;
    fontIcons: number;
  } {
    if (perSlide.length === 0) {
      return {
        total: 0,
        contrast: 0,
        harmony: 0,
        colorfulness: 0,
        complexity: 0,
        pacing: 0,
        fontIcons: 0,
      };
    }

    let sumContrast = 0;
    let sumHarmony = 0;
    let sumColorfulness = 0;
    let sumComplexity = 0;
    let sumFontIcons = 0;

    for (const m of perSlide) {
      sumContrast += m.contrast.mean;
      sumHarmony += m.harmony.score;
      sumColorfulness += Math.max(0, Math.min(1, m.colorfulness / 60));
      const target = 3.5;
      const tol = 2.0;
      sumComplexity += Math.max(0, Math.min(1, 1 - Math.abs(m.entropy - target) / tol));
      const fontPenalty = Math.max(0, m.fonts.fontFamilyCount - 3) * 0.2;
      const iconPenalty = m.fonts.iconStyleConsistent ? 0 : 0.3;
      sumFontIcons += Math.max(0, 1 - fontPenalty - iconPenalty);
    }

    const n = perSlide.length;
    const contrast = (sumContrast / n) * 100;
    const harmony = (sumHarmony / n) * 100;
    const colorfulness = (sumColorfulness / n) * 100;
    const complexity = (sumComplexity / n) * 100;
    const pacing = pacingScore;
    const fontIcons = (sumFontIcons / n) * 100;

    const total =
      contrast * 0.3 +
      harmony * 0.25 +
      colorfulness * 0.15 +
      complexity * 0.15 +
      pacing * 0.1 +
      fontIcons * 0.05;

    return {
      total: Math.max(0, Math.min(100, total)),
      contrast,
      harmony,
      colorfulness,
      complexity,
      pacing,
      fontIcons,
    };
  }

  async destroy(): Promise<void> {
    if (this.renderer) {
      await this.renderer.close();
      this.renderer = null;
    }
    this.initialized = false;
  }
}
