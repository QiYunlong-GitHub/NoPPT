import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import type { AuditContext, AuditEngineResult, AuditIssue } from '../../types';
import { SlideRenderer } from './slide-renderer';
import { checkFontAndIcons } from './font-icon-check';
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
  };
  screenshotPath?: string;
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

    for (let i = 0; i < slides.length; i++) {
      const slide = slides[i];
      const page = await renderer.renderSlide(slide.html);
      try {
        if (viewport.width !== 1280 || viewport.height !== 720) {
          await page.setViewportSize({ width: viewport.width, height: viewport.height });
        }

        const screenshotPath = path.join(this.tempDir, `slide-${i}.png`);
        await renderer.captureScreenshot(page, screenshotPath);
        screenshotPaths.push(screenshotPath);

        const imageData = await renderer.getImageData(page);

        const [contrast, harmony, colorfulness, entropy, fontIcons] = await Promise.all([
          computeFigureGroundContrast(imageData, page),
          Promise.resolve(computeColorHarmony(imageData)),
          Promise.resolve(computeColorfulness(imageData)),
          Promise.resolve(computeSubbandEntropy(imageData)),
          checkFontAndIcons(page),
        ]);

        complexities.push(entropy.entropy);

        perSlide.push({
          slideIndex: i,
          contrast: {
            mean: contrast.mean,
            min: contrast.min,
            max: contrast.max,
            lowContrastTextCount: contrast.text.lowContrastPairs.length,
          },
          harmony: {
            bestTemplate: harmony.bestTemplate,
            bestDistance: harmony.bestDistance,
            score: harmony.score,
          },
          colorfulness: colorfulness.colorfulness,
          entropy: entropy.entropy,
          fonts: {
            fontFamilyCount: fontIcons.fontFamilyCount,
            fontSizeLevels: fontIcons.fontSizeLevels,
            iconStyles: fontIcons.iconStyles,
            iconStyleConsistent: fontIcons.iconStyleConsistent,
          },
          screenshotPath,
        });

        this.collectPerSlideIssues(i, contrast, harmony, colorfulness, entropy, fontIcons, issues);

        if (this.vlmProvider) {
          try {
            const vlmResult = await runVlmCritique(
              this.vlmProvider,
              screenshotPath,
              i,
              slide.title,
              undefined,
              context.referenceContext,
            );
            if (vlmResult.issues.length > 0) {
              issues.push(...vlmResult.issues);
            }
            if (vlmResult.score > 0) {
              vlmScores.push(vlmResult.score);
            }
          } catch {}
        }
      } finally {
        await page.close();
      }
    }

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
    let metricScore = scores.total;
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
        pacing: hrv,
        componentScores: scores,
        metricScore,
        vlmScores,
        vlmEnabled: !!this.vlmProvider,
        screenshots: screenshotPaths,
      },
    };
  }

  private collectPerSlideIssues(
    slideIndex: number,
    contrast: Awaited<ReturnType<typeof computeFigureGroundContrast>>,
    harmony: ReturnType<typeof computeColorHarmony>,
    colorfulness: ReturnType<typeof computeColorfulness>,
    entropy: ReturnType<typeof computeSubbandEntropy>,
    fontIcons: Awaited<ReturnType<typeof checkFontAndIcons>>,
    issues: AuditIssue[],
  ): void {
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
