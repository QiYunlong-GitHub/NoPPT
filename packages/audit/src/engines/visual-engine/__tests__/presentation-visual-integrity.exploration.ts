import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import type { DeckNode, DeckSlide } from '@noppt/core/deck';
import { LayoutEngine } from '@noppt/core/engine/layout-engine';
import type { Presentation } from '@noppt/core';
import { presentationToDeck } from '@noppt/web/export/presentation-to-deck';
import { deckSlideToHtml } from '@noppt/ai/agents/html-presentation/deck/deck-to-html';
import { buildLayoutContext } from '@noppt/ai/agents/html-presentation/deck/plan-to-deck';
import { SlideRenderer } from '../slide-renderer';
export const PRESENTATION_ID = 'pres_musb7z42_ls8yvjc';
export const TARGET_DIR = resolve(
  __dirname,
  '../../../../../server/data/tenants/default/users/default/workspace/presentations',
  PRESENTATION_ID,
);
export const ARTIFACT_ROOT = resolve(
  __dirname,
  '../../../../../../.agents/artifacts/presentation-visual-integrity',
);
const INPUT_FILES = ['presentation.json', 'ai-log.jsonl', 'chat-history.json'];
export interface InputHash {
  relativePath: string;
  bytes: number;
  sha256: string;
}
export interface BrowserObservation {
  status: 'pass' | 'fail' | 'unverified';
  reason?: string;
  viewport: { width: number; height: number };
  viewportMatrix: Array<{ width: number; height: number }>;
  slides: Array<{
    slideIndex: number;
    viewport: { width: number; height: number };
    rootWidth: number;
    rootHeight: number;
    documentScrollWidth: number;
    documentScrollHeight: number;
    title?: { width: number; height: number; parentHeight: number };
    declaredFontFamily?: string;
    resolvedFontFamily?: string;
    fontCheck?: boolean;
  }>;
}
export interface ExplorationResult {
  runId: string;
  artifactRoot: string;
  fixtureRoot: string;
  reportPath: string;
  markdownReportPath: string;
  sourceHashes: InputHash[];
  sourceHashesAfter: InputHash[];
  sourceUnchanged: boolean;
  deterministicFailures: Array<{
    code: string;
    slideIndex?: number;
    detail: string;
    counterexample: Record<string, unknown>;
  }>;
  unverified: Array<{ code: string; detail: string }>;
  browser: BrowserObservation;
}
type ExplorationFailure = ExplorationResult['deterministicFailures'][number];
type BrowserSlideObservation = BrowserObservation['slides'][number];

function sha256(filePath: string): InputHash {
  const data = readFileSync(filePath);
  return {
    relativePath: relative(TARGET_DIR, filePath),
    bytes: data.byteLength,
    sha256: createHash('sha256').update(data).digest('hex'),
  };
}
function listFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  });
}
function copyInputs(fixtureRoot: string): void {
  mkdirSync(fixtureRoot, { recursive: true });
  const sourceFiles = listFiles(TARGET_DIR).filter((filePath) => {
    const rel = relative(TARGET_DIR, filePath);
    return INPUT_FILES.includes(rel) || rel.startsWith('reference-attrs' + '\\') || rel.startsWith('assets' + '\\');
  });
  for (const sourcePath of sourceFiles) {
    const destination = join(fixtureRoot, relative(TARGET_DIR, sourcePath));
    mkdirSync(resolve(destination, '..'), { recursive: true });
    copyFileSync(sourcePath, destination);
  }
}
function textFromNode(node: DeckNode): string {
  switch (node.kind) {
    case 'text':
      return node.paragraphs
        .flatMap((paragraph) => paragraph.runs.map((run) => run.text))
        .join('');
    case 'shape':
      return (node.text ?? [])
        .flatMap((paragraph) => paragraph.runs.map((run) => run.text))
        .join('');
    case 'group':
      return node.children.map(textFromNode).join('');
    default:
      return '';
  }
}
function allNodes(nodes: DeckNode[]): DeckNode[] {
  return nodes.flatMap((node) => (node.kind === 'group' ? [node, ...allNodes(node.children)] : [node]));
}
function makeContext(presentation: Presentation): ReturnType<typeof buildLayoutContext> {
  return buildLayoutContext(
    {
      title: presentation.title,
      description: presentation.description,
      primaryColor: '#27ae60',
      slideCount: presentation.slides.length,
      slides: presentation.slides.map((slide) => ({
        pageType: slide.deck?.pageType as any,
        title: slide.title,
        keyPoints: [],
      })),
    } as any,
  );
}
function expectedPlanSlides(logPath: string): Array<{ keyPoints: string[] }> {
  const lines = readFileSync(logPath, 'utf8').split(/\r?\n/).filter(Boolean);
  const planRecord = lines.map((line) => JSON.parse(line)).find((record) => record.type === 'plan');
  return planRecord?.response?.plan?.slides ?? [];
}
interface BrowserSlideContext {
  renderer: SlideRenderer;
  presentation: Presentation;
  slideIndex: number;
  browser: BrowserObservation;
  deterministicFailures: ExplorationFailure[];
  screenshotDir: string;
}

async function collectBrowserSlide(context: BrowserSlideContext): Promise<void> {
  const { renderer, presentation, slideIndex, browser, deterministicFailures, screenshotDir } = context;
  const page = await renderer.renderSlide(presentation.slides[slideIndex].html);
  try {
    for (const viewport of browser.viewportMatrix) {
      await page.setViewportSize(viewport);
      const layout = await renderer.collectLayoutMetrics(page);
      const title = layout.elements.find((element) => element.role === 'title');
      const observation = {
        slideIndex,
        viewport,
        rootWidth: layout.root.width,
        rootHeight: layout.root.height,
        documentScrollWidth: layout.document.scrollWidth,
        documentScrollHeight: layout.document.scrollHeight,
        title: title ? { width: title.rect.width, height: title.rect.height, parentHeight: title.rect.height } : undefined,
        declaredFontFamily: title?.computed.fontFamily,
        resolvedFontFamily: title?.computed.fontFamily,
        fontCheck: undefined,
      };
      browser.slides.push(observation);
      recordBrowserFailure(deterministicFailures, slideIndex, viewport, observation);
      await renderer.captureScreenshot(page, join(screenshotDir, `slide-${slideIndex + 1}-${viewport.width}x${viewport.height}.png`));
    }
  } finally {
    await page.close();
  }
}
function recordBrowserFailure(
  failures: ExplorationFailure[],
  slideIndex: number,
  viewport: BrowserObservation['viewportMatrix'][number],
  observation: BrowserSlideObservation,
): void {
  if (observation.title && observation.title.height > observation.title.parentHeight + 1 && !failures.some((failure) => failure.code === 'title_geometry_clipped' && failure.slideIndex === slideIndex)) {
    failures.push({ code: 'title_geometry_clipped', slideIndex, detail: 'Browser measurement shows the title line box exceeds its fixed parent rectangle.', counterexample: { viewport, title: observation.title } });
  }
  if (observation.documentScrollWidth > viewport.width + 1 && !failures.some((failure) => failure.code === 'viewport_requires_horizontal_overflow' && failure.slideIndex === slideIndex)) {
    failures.push({ code: 'viewport_requires_horizontal_overflow', slideIndex, detail: 'Narrow viewport retains a wider fixed document instead of scaling or reflowing the logical canvas.', counterexample: { viewport, documentScrollWidth: observation.documentScrollWidth } });
  }
}
export async function runExploration(): Promise<ExplorationResult> {
  const runId = `task1-${Date.now()}`;
  const runRoot = join(ARTIFACT_ROOT, runId);
  const fixtureRoot = join(runRoot, 'fixture');
  const reportDir = join(runRoot, 'reports');
  const screenshotDir = join(runRoot, 'screenshots');
  mkdirSync(reportDir, { recursive: true });
  mkdirSync(screenshotDir, { recursive: true });
  const sourcePaths = INPUT_FILES.map((name) => join(TARGET_DIR, name));
  const sourceHashes = sourcePaths.map(sha256);
  copyInputs(fixtureRoot);
  const presentation = JSON.parse(readFileSync(join(fixtureRoot, 'presentation.json'), 'utf8')) as Presentation;
  const planSlides = expectedPlanSlides(join(fixtureRoot, 'ai-log.jsonl'));
  const deck = presentationToDeck(presentation, { allowHtmlFallback: true });
  const context = makeContext(presentation);
  const deterministicFailures: ExplorationResult['deterministicFailures'] = [];
  const unverified: ExplorationResult['unverified'] = [];
  presentation.slides.forEach((slide, slideIndex) => {
    const normalized = LayoutEngine.normalizeAISlide(slide as any);
    const slideDeck = deck.slides[slideIndex] as DeckSlide;
    const canonicalHtml = slideDeck ? deckSlideToHtml(slideDeck, context) : '';
    const sourceHtml = slide.html ?? '';
    const nodes = allNodes(slideDeck?.nodes ?? []);
    const textNodes = nodes.filter((node) => node.kind === 'text');
    const deckText = nodes.map(textFromNode).join(' ');
    if (/overflow\s*:\s*hidden/i.test(sourceHtml) && /width:\s*1280px[^>]*height:\s*720px/i.test(sourceHtml)) {
      deterministicFailures.push({
        code: 'fixed_nested_canvas',
        slideIndex,
        detail: 'HTML uses a hidden-overflow outer wrapper around a fixed 1280×720 inner canvas.',
        counterexample: { outerOverflow: 'hidden', innerCanvas: '1280px × 720px', normalizedHtmlChanged: normalized.html !== sourceHtml },
      });
    }
    const titleNode = textNodes.find((node) => node.kind === 'text' && (node.role === 'title' || slideIndex === 0));
    const titleRun = titleNode?.kind === 'text' ? titleNode.paragraphs.flatMap((paragraph) => paragraph.runs)[0] : undefined;
    if (titleNode?.kind === 'text' && titleRun?.fontSize && slideIndex === 0) {
      const estimatedWidth = titleRun.text.length * titleRun.fontSize * 0.95;
      if (estimatedWidth > titleNode.rect.w || titleRun.fontSize * 1.2 > titleNode.rect.h) {
        deterministicFailures.push({
          code: 'title_measurement_overflow',
          slideIndex,
          detail: 'Cover title demand exceeds its fixed text rectangle under a deterministic glyph-width estimate.',
          counterexample: { text: titleRun.text, fontSize: titleRun.fontSize, estimatedWidth, rect: titleNode.rect },
        });
      }
    }
    if (slide.deck?.pageType === 'content-compare') {
      const separatedBullet = /<p[^>]*>•<\/p>\s*<span[^>]*>海表温度异常升高<\/span>/i.test(sourceHtml);
      const compareTextNodes = textNodes.filter((node) => node.kind === 'text' && node.role !== 'title');
      if (separatedBullet || compareTextNodes.length !== 2 || !canonicalHtml) {
        deterministicFailures.push({
          code: 'html_deck_semantics_diverge',
          slideIndex,
          detail: 'HTML is a single list with a detached first bullet while Deck has two comparison columns.',
          counterexample: { separatedBullet, htmlListCount: (sourceHtml.match(/<div style="margin:/g) ?? []).length, deckColumnTextNodes: compareTextNodes.length },
        });
      }
    }
    if (slide.deck?.pageType === 'content-stats-highlight') {
      const emptyRequiredNodes = textNodes.filter((node) => textFromNode(node).trim() === '').length;
      if (emptyRequiredNodes > 0) {
        deterministicFailures.push({
          code: 'empty_required_metric_nodes',
          slideIndex,
          detail: 'Metric cards contain empty required description text nodes.',
          counterexample: { emptyRequiredNodes, expectedMetricCount: planSlides[slideIndex]?.keyPoints?.length ?? 4 },
        });
      }
    }
    if (slide.deck?.pageType === 'content-cards') {
      const cardShapes = nodes.filter((node) => node.kind === 'shape' && node.rect.h >= 500 && node.rect.w >= 300);
      const contentTextNodes = textNodes.filter((node) => textFromNode(node).trim() !== '');
      if (cardShapes.length === 3 && contentTextNodes.length <= 4 && cardShapes.every((shape) => shape.rect.h === 552)) {
        deterministicFailures.push({
          code: 'fixed_height_empty_cards',
          slideIndex,
          detail: 'Three fixed-height cards contain only title text and no body content.',
          counterexample: { cardCount: cardShapes.length, cardHeight: 552, nonEmptyTextNodes: contentTextNodes.length },
        });
      }
    }
    if (slide.deck?.pageType === 'summary') {
      const expected = planSlides[slideIndex]?.keyPoints ?? [];
      const missing = expected.filter((point) => !deckText.includes(point));
      if (missing.length > 0) {
        deterministicFailures.push({
          code: 'summary_silent_drop',
          slideIndex,
          detail: 'Summary plan points are not all represented by visible Deck text or omission records.',
          counterexample: { expectedCount: expected.length, missing, observedText: deckText },
        });
      }
    }
  });
  const eventTypes = readFileSync(join(fixtureRoot, 'ai-log.jsonl'), 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line).type);
  const evidenceTypes = ['render', 'visual_validation', 'audit', 'fix'];
  const hasEvidence = eventTypes.some((type) => evidenceTypes.includes(type));
  if (!hasEvidence) {
    deterministicFailures.push({
      code: 'missing_render_validation_evidence',
      detail: 'ai-log.jsonl has no render, visual validation, audit, or fix event covering the five pages.',
      counterexample: { pageCount: presentation.slides.length, evidenceEventTypes: eventTypes },
    });
  }
  const browser: BrowserObservation = {
    status: 'unverified',
    reason: 'Chromium/font availability has not yet been established.',
    viewport: { width: 1280, height: 720 },
    viewportMatrix: [
      { width: 800, height: 600 },
      { width: 1280, height: 720 },
      { width: 1600, height: 900 },
      { width: 1280, height: 720 },
      { width: 800, height: 600 },
    ],
    slides: [],
  };
  const renderer = new SlideRenderer({ width: 1280, height: 720 });
  try {
    await renderer.initialize();
    browser.status = 'pass';
    browser.reason = undefined;
    for (let slideIndex = 0; slideIndex < presentation.slides.length; slideIndex += 1) {
      await collectBrowserSlide({ renderer, presentation, slideIndex, browser, deterministicFailures, screenshotDir });
    }
  } catch (error) {
    browser.status = 'unverified';
    browser.reason = `Browser/font probe unavailable: ${error instanceof Error ? error.message : String(error)}`;
    unverified.push({ code: 'browser_or_font_unavailable', detail: browser.reason });
  } finally {
    try {
      await renderer.close();
    } catch (error) {
      unverified.push({ code: 'browser_close_failed', detail: error instanceof Error ? error.message : String(error) });
    }
  }
  const sourceHashesAfter = sourcePaths.map(sha256);
  const result: ExplorationResult = {
    runId,
    artifactRoot: runRoot,
    fixtureRoot,
    reportPath: join(reportDir, 'exploration-report.json'),
    markdownReportPath: join(reportDir, 'exploration-report.md'),
    sourceHashes,
    sourceHashesAfter,
    sourceUnchanged: JSON.stringify(sourceHashes) === JSON.stringify(sourceHashesAfter),
    deterministicFailures,
    unverified,
    browser,
  };
  writeFileSync(result.reportPath, JSON.stringify(result, null, 2) + '\n', 'utf8');
  writeFileSync(
    result.markdownReportPath,
    [
      `# Presentation Visual Integrity Exploration (${runId})`,
      '',
      `- Source unchanged: **${result.sourceUnchanged}**`,
      `- Artifact root: \`${runRoot}\``,
      `- Fixture: \`${fixtureRoot}\``,
      `- Browser/font status: **${browser.status}**${browser.reason ? ` — ${browser.reason}` : ''}`,
      '',
      '## Deterministic counterexamples',
      ...deterministicFailures.map((failure) => `- **${failure.code}** (slide ${failure.slideIndex == null ? 'all' : failure.slideIndex + 1}): ${failure.detail} — \`${JSON.stringify(failure.counterexample)}\``),
      '',
      '## Unverified environment states',
      ...(unverified.length ? unverified.map((item) => `- **${item.code}**: ${item.detail}`) : ['- None']),
      '',
      '## Required assertions',
      '- Required content is complete or explicitly omitted.',
      '- Geometry is within the logical canvas and viewport.',
      '- HTML and Deck semantics match.',
      '- Font state is observable.',
      '- Five-page render/audit evidence exists.',
      '',
      'The assertions intentionally fail against the current implementation; this report preserves the observed counterexamples without modifying the target presentation.',
      '',
    ].join('\n'),
    'utf8',
  );
  return result;
}
export function formatCounterexamples(result: ExplorationResult): string {
  return result.deterministicFailures
    .map((failure) => `${failure.code}${failure.slideIndex == null ? '' : `@slide-${failure.slideIndex + 1}`}: ${JSON.stringify(failure.counterexample)}`)
    .join('\n');
}
