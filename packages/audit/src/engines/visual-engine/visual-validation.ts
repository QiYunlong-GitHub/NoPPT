import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Presentation } from '@noppt/core';
import {
  collectDeckContentManifest,
  collectHtmlContentManifest,
} from '../content-engine/compare-content';
import {
  SlideRenderer,
  type LayoutMetrics,
  type ResourceReadiness,
  type ViewportProfile,
  viewportProfile,
} from './slide-renderer';
import { EVALUATOR_VERSION } from './browser-evaluator';
import {
  checkFontAndIcons,
  type FontIconCheckResult,
} from './font-icon-check';

export const DEFAULT_VISUAL_VIEWPORTS = [
  { width: 800, height: 600 },
  { width: 1280, height: 720 },
  { width: 1600, height: 900 },
] as const;

export interface VisualViewportFixture {
  width: number;
  height: number;
}

export interface VisualFontEvidence {
  status: 'resolved' | 'fallback' | 'unverified' | 'failed';
  declaredFamily: string;
  resolvedFamily: string;
  fallbackUsed: boolean;
  readiness: ResourceReadiness['fonts'];
  metricDelta?: number;
  reason?: string;
}

export interface VisualMetric extends LayoutMetrics {
  parity: 'pass' | 'fail' | 'unverified';
  parityReason?: string;
  font: VisualFontEvidence;
}

export interface VisualValidationCell {
  phase: 'initial' | 'resize';
  viewport: VisualViewportFixture & { profile?: ViewportProfile };
  requiredClipped: number;
  emptyRequiredNodes: number;
  horizontalOverflow: boolean;
  verticalOverflow: boolean;
  titleOverlap: boolean;
  parity: VisualMetric['parity'];
  fontStatus: VisualFontEvidence['status'];
  resourceStatus: { fonts: ResourceReadiness['fonts']['status']; images: ResourceReadiness['images']['status'] };
  evaluatorVersion: number;
  screenshotPath: string;
  status: 'pass' | 'fail' | 'unverified';
}


export interface VisualResizeCheck {
  sequence: string[];
  metrics: VisualValidationCell[];
  status: 'pass' | 'fail' | 'unverified';
}
export interface VisualSlideValidation {
  slideIndex: number;
  status: 'pass' | 'fail' | 'unverified';
  viewports: VisualViewportFixture[];
  metrics: VisualMetric[];
  cells: VisualValidationCell[];
  resizeChecks: VisualResizeCheck[];
  screenshotPaths: string[];
  parity: 'pass' | 'fail' | 'unverified';
  error?: string;
}

export interface VisualValidationReport {
  runId: string;
  presentationId: string;
  status: 'pass' | 'fail' | 'unverified';
  pageCount: number;
  viewportSequence: string[];
  browser: { status: 'ready' | 'unverified' | 'error'; reason?: string };
  slides: VisualSlideValidation[];
  unverified: Array<{ code: string; detail: string }>;
  reportPath: string;
  markdownReportPath: string;
}

export interface VisualValidationOptions {
  presentationId?: string;
  runId?: string;
  artifactRoot: string;
  viewports?: readonly VisualViewportFixture[];
  resizeSequence?: readonly VisualViewportFixture[];
  renderer?: SlideRenderer;
}

function key(viewport: VisualViewportFixture): string {
  return `${viewport.width}x${viewport.height}`;
}

function normalizedText(value: string): string {
  return value.replace(/[•●◦▪]\s*/gu, '').replace(/\s+/gu, '').trim().toLocaleLowerCase();
}

function compareDeckAndHtml(slide: Presentation['slides'][number]): { status: VisualMetric['parity']; reason?: string } {
  if (!slide.deck) return { status: 'unverified', reason: 'slide has no Deck representation' };
  const deck = collectDeckContentManifest(slide.deck);
  const deckRequired = deck.filter((item) => item.required !== false && !item.decoration);
  const htmlObserved = collectHtmlContentManifest(slide.html || '').filter((item) => item.required !== false && !item.decoration);
  const deckIds = new Set(deckRequired.map((item) => item.contentId));
  const htmlRequired = htmlObserved.filter((item) => deckIds.has(item.contentId));
  // A non-empty observed cover/content manifest cannot be accepted when the Deck
  // side is empty; empty observations are only valid when the slide has no title
  // or required source content at all.
  if (deckRequired.length === 0) {
    if (htmlObserved.length > 0 || Boolean(slide.title?.trim())) {
      return { status: 'fail', reason: 'required manifest is empty on Deck while source/HTML content exists' };
    }
    return { status: 'pass' };
  }
  if (htmlRequired.length !== deckRequired.length) {
    return { status: 'fail', reason: `content count differs: Deck=${deckRequired.length}, HTML=${htmlRequired.length}` };
  }
  for (let index = 0; index < deckRequired.length; index += 1) {
    const expected = deckRequired[index];
    const observed = htmlRequired[index];
    if (expected.contentId !== observed.contentId) {
      return { status: 'fail', reason: `content identity differs at ${index}: ${expected.contentId} / ${observed.contentId}` };
    }
    if (normalizedText(expected.text) !== normalizedText(observed.text)) {
      return { status: 'fail', reason: `content text differs for ${expected.contentId}` };
    }
    if (expected.order !== observed.order || expected.ownership !== observed.ownership) {
      return { status: 'fail', reason: `content ownership/order differs for ${expected.contentId}` };
    }
  }
  return { status: 'pass' };
}

function fontEvidence(
  metrics: LayoutMetrics,
  readiness: ResourceReadiness['fonts'],
  observed?: FontIconCheckResult,
): VisualFontEvidence {
  const firstText = metrics.elements.find((element) => element.required && element.text.length > 0);
  const resolvedFamily = observed?.font.resolvedFamily || firstText?.computed.fontFamily || '';
  const status = observed?.font.state ?? (readiness.status === 'ready' ? 'resolved' : readiness.status === 'failed' ? 'failed' : 'unverified');
  return {
    status,
    declaredFamily: observed?.font.declaredFamily || resolvedFamily.split(',')[0]?.trim().replace(/["']/gu, '') || '',
    resolvedFamily,
    fallbackUsed: observed?.font.fallbackUsed ?? status === 'fallback',
    readiness,
    metricDelta: observed?.font.maxMetricDelta,
    reason: observed?.font.reason,
  };
}

function hasBlockingMetric(metric: VisualMetric): boolean {
  return metric.requiredClipped > 0 || metric.emptyRequiredNodes > 0 || metric.horizontalOverflow || metric.titleOverlap || metric.parity === 'fail' || metric.font.status === 'failed';
}

function markdownReport(report: VisualValidationReport): string {
  const lines = [
    `# Visual validation report (${report.runId})`,
    '',
    `- Presentation: \`${report.presentationId}\``,
    `- Status: **${report.status}**`,
    `- Browser: **${report.browser.status}**${report.browser.reason ? ` — ${report.browser.reason}` : ''}`,
    `- Pages: ${report.pageCount}`,
    `- Viewport/resize sequence: ${report.viewportSequence.join(' → ')}`,
    '',
    '## Per-page checks',
  ];
  for (const slide of report.slides) {
    lines.push(`- Slide ${slide.slideIndex + 1}: **${slide.status}**, parity=${slide.parity}, screenshots=${slide.screenshotPaths.length}`);
    if (slide.error) lines.push(`  - error: ${slide.error}`);
    for (const metric of slide.metrics) {
      lines.push(`  - ${key(metric.viewport)} profile=${metric.viewport.profile}: clipped=${metric.requiredClipped}, empty=${metric.emptyRequiredNodes}, horizontalOverflow=${metric.horizontalOverflow}, titleOverlap=${metric.titleOverlap}, parity=${metric.parity}, font=${metric.font.status}`);
    }
  }
  if (report.unverified.length > 0) {
    lines.push('', '## Unverified environment evidence', ...report.unverified.map((item) => `- **${item.code}**: ${item.detail}`));
  }
  lines.push('', 'Screenshots and the JSON report are isolated under this run artifact root.');
  return lines.join('\n') + '\n';
}

interface SlideValidationInput {
  slide: Presentation['slides'][number];
  slideIndex: number;
  viewports: VisualViewportFixture[];
  resizeSequence: VisualViewportFixture[];
  viewportSequence: string[];
  screenshotRoot: string;
  renderer: SlideRenderer;
  aggregateUnverified: Array<{ code: string; detail: string }>;
}

async function validateSlideVisual(input: SlideValidationInput): Promise<VisualSlideValidation> {
  const { slide, slideIndex, viewports, resizeSequence, viewportSequence, screenshotRoot, renderer, aggregateUnverified } = input;
  const parity = compareDeckAndHtml(slide);
  const result: VisualSlideValidation = {
    slideIndex,
    status: parity.status === 'fail' ? 'fail' : parity.status === 'unverified' ? 'unverified' : 'pass',
    viewports: [...viewports], metrics: [], cells: [], resizeChecks: [], screenshotPaths: [], parity: parity.status,
  };
  const page = await renderer.renderSlide(slide.html || '');
  try {
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      const resources = await renderer.waitForResources(page);
      const layout = await renderer.collectLayoutMetrics(page);
      const font = await checkFontAndIcons(page);
      const metric: VisualMetric = { ...layout, parity: parity.status, parityReason: parity.reason, font: fontEvidence(layout, resources.fonts, font) };
      result.metrics.push(metric);
      const screenshotPath = join(screenshotRoot, `slide-${slideIndex + 1}-${key(viewport)}.png`);
      await renderer.captureScreenshot(page, screenshotPath);
      result.screenshotPaths.push(screenshotPath);
      result.cells.push({
        phase: 'initial', viewport: metric.viewport, requiredClipped: metric.requiredClipped,
        emptyRequiredNodes: metric.emptyRequiredNodes, horizontalOverflow: metric.horizontalOverflow,
        verticalOverflow: metric.verticalOverflow, titleOverlap: metric.titleOverlap, parity: metric.parity,
        fontStatus: metric.font.status, resourceStatus: { fonts: resources.fonts.status, images: resources.images.status },
        evaluatorVersion: EVALUATOR_VERSION, screenshotPath,
        status: hasBlockingMetric(metric) ? 'fail' : metric.font.status === 'unverified' || resources.images.status !== 'ready' ? 'unverified' : 'pass',
      });
      if (resources.fonts.status !== 'ready' && !aggregateUnverified.some((item) => item.code === 'font_unverified')) {
        aggregateUnverified.push({ code: 'font_unverified', detail: resources.fonts.reason || 'font loading could not be verified' });
      }
      if (resources.images.status !== 'ready') {
        aggregateUnverified.push({ code: 'asset_unverified', detail: resources.images.reason || 'image loading could not be verified' });
      }
    }
    const resizeMetrics: VisualResizeCheck['metrics'] = [];
    let resizeStatus: VisualResizeCheck['status'] = 'pass';
    for (const viewport of resizeSequence) {
      await page.setViewportSize(viewport);
      await renderer.runEvaluatorSmoke(page);
      const resources = await renderer.waitForResources(page);
      const layout = await renderer.collectLayoutMetrics(page);
      const fontState = fontEvidence(layout, resources.fonts, await checkFontAndIcons(page));
      const screenshotPath = join(screenshotRoot, `slide-${slideIndex + 1}-resize-${key(viewport)}-${resizeMetrics.length}.png`);
      await renderer.captureScreenshot(page, screenshotPath);
      const failed = layout.requiredClipped > 0 || layout.emptyRequiredNodes > 0 || layout.horizontalOverflow || layout.titleOverlap || parity.status === 'fail' || fontState.status === 'failed';
      resizeMetrics.push({
        phase: 'resize', viewport: layout.viewport, requiredClipped: layout.requiredClipped,
        emptyRequiredNodes: layout.emptyRequiredNodes, horizontalOverflow: layout.horizontalOverflow,
        verticalOverflow: layout.verticalOverflow, titleOverlap: layout.titleOverlap, parity: parity.status,
        fontStatus: fontState.status, resourceStatus: { fonts: resources.fonts.status, images: resources.images.status },
        evaluatorVersion: EVALUATOR_VERSION, screenshotPath,
        status: failed ? 'fail' : fontState.status === 'unverified' || resources.images.status !== 'ready' ? 'unverified' : 'pass',
      });
      if (failed) resizeStatus = 'fail';
      if ((resources.fonts.status !== 'ready' || resources.images.status !== 'ready' || fontState.status === 'unverified') && resizeStatus === 'pass') resizeStatus = 'unverified';
    }
    result.resizeChecks.push({ sequence: viewportSequence, metrics: resizeMetrics, status: resizeStatus });
    const blocking = result.metrics.some(hasBlockingMetric) || resizeStatus === 'fail';
    const unverified = result.metrics.some((metric) => metric.font.status === 'unverified') || resizeStatus === 'unverified';
    result.status = blocking ? 'fail' : unverified || result.parity === 'unverified' ? 'unverified' : 'pass';
    result.error = parity.reason;
  } finally {
    await page.close();
  }
  return result;
}

export async function runVisualValidation(
  presentation: Presentation,
  options: VisualValidationOptions,
): Promise<VisualValidationReport> {
  const runId = options.runId || `visual-${Date.now()}`;
  const presentationId = options.presentationId || presentation.id;
  const viewports = options.viewports?.length ? [...options.viewports] : [...DEFAULT_VISUAL_VIEWPORTS];
  const resizeSequence = options.resizeSequence?.length ? [...options.resizeSequence] : viewports;
  const viewportSequence = resizeSequence.map(key);
  const screenshotRoot = join(options.artifactRoot, 'screenshots');
  const reportPath = join(options.artifactRoot, 'visual-validation-report.json');
  const markdownReportPath = join(options.artifactRoot, 'visual-validation-report.md');
  mkdirSync(screenshotRoot, { recursive: true });

  const report: VisualValidationReport = {
    runId,
    presentationId,
    status: 'unverified',
    pageCount: presentation.slides.length,
    viewportSequence,
    browser: { status: 'unverified' },
    slides: [],
    unverified: [],
    reportPath,
    markdownReportPath,
  };

  const renderer = options.renderer || new SlideRenderer({ width: viewports[0].width, height: viewports[0].height });
  const ownsRenderer = !options.renderer;
  try {
    await renderer.initialize();
    report.browser = { status: 'ready' };
    for (let slideIndex = 0; slideIndex < presentation.slides.length; slideIndex += 1) {
      report.slides.push(await validateSlideVisual({
        slide: presentation.slides[slideIndex], slideIndex, viewports, resizeSequence,
        viewportSequence, screenshotRoot, renderer, aggregateUnverified: report.unverified,
      }));
    }
  } catch (error) {
    report.browser = {
      status: 'unverified',
      reason: error instanceof Error ? error.message : String(error),
    };
    report.unverified.push({ code: 'browser_unavailable', detail: report.browser.reason || 'browser initialization failed' });
  } finally {
    if (ownsRenderer) await renderer.close();
  }

  if (report.browser.status !== 'ready') report.status = 'unverified';
  else if (report.slides.some((slide) => slide.status === 'fail')) report.status = 'fail';
  else if (report.slides.some((slide) => slide.status === 'unverified') || report.unverified.length > 0) report.status = 'unverified';
  else report.status = 'pass';
  mkdirSync(options.artifactRoot, { recursive: true });
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
  writeFileSync(markdownReportPath, markdownReport(report), 'utf8');
  return report;
}

export function viewportFixture(width: number, height: number): VisualViewportFixture & { profile: ViewportProfile } {
  return { width, height, profile: viewportProfile(width) };
}

export function visualArtifactExists(report: VisualValidationReport): boolean {
  return existsSync(report.reportPath) && existsSync(report.markdownReportPath);
}
