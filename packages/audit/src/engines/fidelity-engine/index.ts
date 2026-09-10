import type { Page } from 'playwright-core';
import type { AuditContext, AuditEngineResult, AuditIssue } from '../../types';
import { SlideRenderer } from '../visual-engine/slide-renderer';
import { detectOverflow } from './overflow-detector';
import { detectOverlap } from './overlap-detector';
import { detectTextTruncation } from './text-truncation-detector';
import { detectImageLoad } from './image-load-detector';
import { detectLayoutShift } from './layout-shift-detector';

function isPage(obj: unknown): obj is Page {
  return (
    !!obj &&
    typeof obj === 'object' &&
    typeof (obj as Page).goto === 'function' &&
    typeof (obj as Page).evaluate === 'function' &&
    typeof (obj as Page).setContent === 'function'
  );
}

function hasRenderSlide(obj: unknown): obj is SlideRenderer {
  return !!obj && typeof obj === 'object' && typeof (obj as SlideRenderer).renderSlide === 'function';
}

function classifyOverflow(overflowX: number, overflowY: number): 'error' | 'warn' {
  return overflowX > 10 || overflowY > 10 ? 'error' : 'warn';
}

export class FidelityAuditEngine {
  private renderer: SlideRenderer | null = null;
  private ownsRenderer: boolean = false;

  async audit(context: AuditContext): Promise<AuditEngineResult> {
    const startTime = Date.now();
    const issues: AuditIssue[] = [];
    const slides = context.presentation.slides;

    let sharedPage: Page | null = null;
    let useRenderSlide = false;
    let externalRenderer: SlideRenderer | null = null;

    const renderer = context.renderer;
    if (hasRenderSlide(renderer)) {
      externalRenderer = renderer;
      useRenderSlide = true;
    } else if (isPage(renderer)) {
      sharedPage = renderer;
    } else if (renderer && typeof renderer === 'object' && isPage((renderer as { page?: unknown }).page)) {
      sharedPage = (renderer as { page: Page }).page;
    }

    if (!externalRenderer && !sharedPage) {
      try {
        this.renderer = new SlideRenderer(context.config.viewport);
        await this.renderer.initialize();
        this.ownsRenderer = true;
        externalRenderer = this.renderer;
        useRenderSlide = true;
      } catch (err) {
        return {
          engine: 'fidelity',
          engineName: 'Render Fidelity Audit Engine',
          status: 'error',
          score: 0,
          issues: [
            {
              ruleId: 'fidelity-engine-init-failed',
              severity: 'error',
              engine: 'fidelity',
              slideIndex: -1,
              message: `Playwright failed to start: ${err instanceof Error ? err.message : String(err)}`,
              fixable: false,
            },
          ],
          durationMs: Date.now() - startTime,
        };
      }
    }

    for (let i = 0; i < slides.length; i++) {
      const slide = slides[i];
      let page: Page | null = null;
      let pageIsOurs = false;

      try {
        if (useRenderSlide && externalRenderer) {
          page = await externalRenderer.renderSlide(slide.html);
          pageIsOurs = true;
        } else if (sharedPage) {
          await sharedPage.setContent(slide.html, { waitUntil: 'networkidle' });
          page = sharedPage;
        } else {
          continue;
        }

        await page.waitForTimeout(150);

        const [overflows, overlaps, truncations, imageIssues, layoutShifts] = await Promise.all([
          detectOverflow(page),
          detectOverlap(page),
          detectTextTruncation(page),
          detectImageLoad(page),
          detectLayoutShift(page, context.config.viewport),
        ]);

        for (const rec of overflows) {
          const severity = classifyOverflow(rec.overflowX, rec.overflowY);
          issues.push({
            ruleId: 'fidelity-overflow',
            severity,
            engine: 'fidelity',
            slideIndex: i,
            selector: rec.selector,
            message: `Element <${rec.tagName}> content overflows its box (x: ${rec.overflowX}px, y: ${rec.overflowY}px)`,
            fixSuggestion: 'Add overflow:hidden/auto, increase container size, or reduce content size',
            fixable: true,
            metadata: rec,
          });
        }

        for (const rec of overlaps) {
          issues.push({
            ruleId: rec.isContentObscured ? 'fidelity-overlap-obscured' : 'fidelity-overlap',
            severity: rec.isContentObscured ? 'error' : 'warn',
            engine: 'fidelity',
            slideIndex: i,
            selector: rec.element1.selector,
            message: rec.isContentObscured
              ? `Elements overlap with content obscured (${rec.element1.selector} vs ${rec.element2.selector}, area: ${Math.round(rec.overlapArea)}px²)`
              : `Elements overlap (${rec.element1.selector} vs ${rec.element2.selector}, area: ${Math.round(rec.overlapArea)}px²)`,
            fixSuggestion: rec.isContentObscured
              ? 'Adjust positioning or z-index to prevent content occlusion'
              : 'Review layout to reduce overlap',
            fixable: true,
            metadata: rec,
          });
        }

        for (const rec of truncations) {
          if (!rec.truncated) continue;
          issues.push({
            ruleId: 'fidelity-text-truncation',
            severity: 'warn',
            engine: 'fidelity',
            slideIndex: i,
            selector: rec.selector,
            message: `Text in <${rec.tagName}> is truncated (scrollWidth: ${rec.scrollWidth}px, clientWidth: ${rec.clientWidth}px)`,
            fixSuggestion: 'Increase container width, allow wrapping, or reduce text content',
            fixable: true,
            metadata: rec,
          });
        }

        for (const rec of imageIssues) {
          if (rec.loaded) continue;
          issues.push({
            ruleId: 'fidelity-image-load-fail',
            severity: 'error',
            engine: 'fidelity',
            slideIndex: i,
            selector: rec.selector,
            message: `Image failed to load: ${rec.src || '(no src)'}`,
            fixSuggestion: 'Check image URL, ensure resource is accessible, or replace with a valid image',
            fixable: false,
            metadata: rec,
          });
        }

        for (const rec of layoutShifts) {
          issues.push({
            ruleId: `fidelity-layout-${rec.issue}`,
            severity: 'info',
            engine: 'fidelity',
            slideIndex: i,
            selector: rec.selector,
            message: rec.detail,
            fixable: false,
            metadata: { issue: rec.issue },
          });
        }
      } catch (err) {
        issues.push({
          ruleId: 'fidelity-engine-error',
          severity: 'info',
          engine: 'fidelity',
          slideIndex: i,
          message: `Fidelity detection failed: ${err instanceof Error ? err.message : String(err)}`,
          fixable: false,
        });
      } finally {
        if (pageIsOurs && page) {
          try {
            await page.close();
          } catch {
            // ignore
          }
        }
      }
    }

    const errorCount = issues.filter((i) => i.severity === 'error').length;
    const warnCount = issues.filter((i) => i.severity === 'warn').length;
    let score = 100 - errorCount * 25 - warnCount * 8;
    if (score < 0) score = 0;

    const status: AuditEngineResult['status'] =
      errorCount > 0 ? 'fail' : warnCount > 0 ? 'warn' : 'passed';

    return {
      engine: 'fidelity',
      engineName: 'Render Fidelity Audit Engine',
      status,
      score,
      issues,
      durationMs: Date.now() - startTime,
    };
  }

  async destroy(): Promise<void> {
    if (this.ownsRenderer && this.renderer) {
      await this.renderer.close();
      this.renderer = null;
      this.ownsRenderer = false;
    }
  }
}
