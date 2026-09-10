import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import type { RenderedSlide } from '@noppt/ai';
import { SlideRenderer, runVlmCritique, type VlmReviewResult } from '@noppt/audit';
import type { AIModelProvider } from '@noppt/ai';
import { renderPlaceholdersAsGrayBlock } from './vlm-placeholder.util';

export interface HtmlAuditLoopParams {
  slides: RenderedSlide[];
  vlmProvider: AIModelProvider | null | undefined;
  slideWidth?: number;
  slideHeight?: number;
  maxRetries: number;
  traceSessionId?: string;
  onProgress?: (payload: { slideIndex: number; attempt: number; maxAttempts: number; message: string }) => void;
  regenerateSlideFn: (slideIndex: number, feedback: string) => Promise<RenderedSlide | null | undefined>;
  /** 频控：仅当该页 LLM critique 已通过时才执行占位 VLM 评审（默认关闭，开启后低于阈值/未通过的页整页跳过） */
  onlyAfterLlmPass?: boolean;
}

interface SlideSnapshot {
  html: string;
  score: number;
  issues: string[];
  critique: RenderedSlide['critique'];
}

function buildVlmFeedback(vlm: VlmReviewResult): string {
  if (!vlm.issues.length) return '';
  const lines = vlm.issues.map((issue, i) => {
    const sev = issue.severity === 'error' ? '[严重]' : issue.severity === 'warn' ? '[重要]' : '[轻微]';
    return `${i + 1}. ${sev} ${issue.message}${issue.fixSuggestion ? `\n   建议：${issue.fixSuggestion}` : ''}`;
  });
  return `【视觉评审（VLM）反馈 —— 图片为占位块，仅针对排版/布局】\n${lines.join('\n')}`;
}

function mergeIssues(vlm: VlmReviewResult): string[] {
  return vlm.issues.map(i => i.message);
}

function hasBlockingIssue(vlm: VlmReviewResult): boolean {
  // r5 阈值收紧：占位 VLM 渲染灰块占位，error(≈fatal)/warn 噪音多，仅最高档(≈fatal) 才阻塞重生成，warn 不再阻塞。
  return vlm.issues.some(i => i.severity === 'error');
}

/**
 * 综合分（0-100）：LLM 文本评审分（0-10）与 VLM 视觉分（0-100）各占一半。
 * VLM 不可用时退化为 LLM 分 * 10。
 */
function computeCombinedScore(slide: RenderedSlide, vlm: VlmReviewResult): number {
  const llmScore = (slide.critique?.score ?? 7) * 10;
  if (vlm.score > 0) return llmScore * 0.5 + vlm.score * 0.5;
  return llmScore;
}

async function captureScreenshot(
  renderer: SlideRenderer,
  html: string,
  index: number,
  tmpDir: string,
): Promise<string | null> {
  const screenshotPath = path.join(tmpDir, `html-audit-${index}-${Date.now()}.png`);
  let page;
  try {
    page = await renderer.renderSlide(html);
    await renderer.captureScreenshot(page, screenshotPath);
    return screenshotPath;
  } catch (e) {
    console.warn(`[HTML-AUDIT] 第 ${index + 1} 页截图失败:`, e instanceof Error ? e.message : e);
    return null;
  } finally {
    if (page) {
      try { await page.close(); } catch { /* ignore */ }
    }
  }
}

export async function runHtmlPlaceholderAuditLoop(
  params: HtmlAuditLoopParams,
): Promise<RenderedSlide[]> {
  const { slides, vlmProvider, slideWidth, slideHeight, maxRetries, regenerateSlideFn } = params;

  if (!vlmProvider || maxRetries <= 0 || slides.length === 0) {
    return slides;
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'noppt-html-audit-'));
  const renderer = new SlideRenderer({ width: slideWidth || 1280, height: slideHeight || 720 });

  const slidesWorking: RenderedSlide[] = slides.map(s => ({ ...s }));
  const bestByIndex = new Map<number, SlideSnapshot>();

  const rememberBest = (idx: number, slide: RenderedSlide, score: number, issues: string[]) => {
    const prev = bestByIndex.get(idx);
    if (!prev || score > prev.score) {
      bestByIndex.set(idx, {
        html: slide.html,
        score,
        issues,
        critique: slide.critique,
      });
    }
  };

  try {
    try {
      await renderer.initialize();
    } catch (e) {
      console.warn(`[HTML-AUDIT] 渲染器初始化失败，跳过占位 HTML 视觉评审:`, e instanceof Error ? e.message : e);
      return slides;
    }

    for (let idx = 0; idx < slidesWorking.length; idx++) {
      let attempt = 0;
      let vlm: VlmReviewResult = { issues: [], score: 0 };
      let blocking = false;

      // —— 频控：仅当该页 LLM critique 已通过时才执行占位 VLM 评审（未通过则整页跳过，节省 VLM 配额）——
      if (params.onlyAfterLlmPass && !(slidesWorking[idx].critique && slidesWorking[idx].critique.passed)) {
        console.warn(`[HTML-AUDIT] 第 ${idx + 1} 页 LLM critique 未通过，跳过占位 VLM（频控）`);
        continue;
      }

      while (true) {
        const htmlForShot = renderPlaceholdersAsGrayBlock(slidesWorking[idx].html);
        const shot = await captureScreenshot(renderer, htmlForShot, idx, tmpDir);
        if (shot) {
          try {
            vlm = await runVlmCritique(vlmProvider, shot, idx, slidesWorking[idx].title, 'placeholder');
          } catch (e) {
            console.warn(`[HTML-AUDIT] 第 ${idx + 1} 页 VLM 评审异常:`, e instanceof Error ? e.message : e);
            vlm = { issues: [], score: 0 };
          }
          try { fs.unlinkSync(shot); } catch { /* ignore */ }
        }

        const combinedScore = computeCombinedScore(slidesWorking[idx], vlm);
        rememberBest(idx, slidesWorking[idx], combinedScore, mergeIssues(vlm));

        blocking = hasBlockingIssue(vlm);
        if (!blocking || attempt >= maxRetries) {
          if (blocking) {
            console.warn(`[HTML-AUDIT] 第 ${idx + 1} 页达到最大重试次数 ${maxRetries}，保留历史最优版本`);
          }
          break;
        }

        attempt++;
        params.onProgress?.({
          slideIndex: idx,
          attempt,
          maxAttempts: maxRetries + 1,
          message: `正在重生成第 ${idx + 1} 页 HTML（${attempt}/${maxRetries}）...`,
        });

        const feedback = buildVlmFeedback(vlm);
        const regenerated = await regenerateSlideFn(idx, feedback);
        if (!regenerated) break;
        slidesWorking[idx] = regenerated;
      }

      const best = bestByIndex.get(idx);
      if (best) {
        slidesWorking[idx].html = best.html;
        const allIssues = Array.from(new Set([...(slidesWorking[idx].critique?.issues ?? []), ...best.issues]));
        slidesWorking[idx].critique = {
          score: Math.round(best.score) / 10,
          passed: !blocking,
          attempts: (slidesWorking[idx].critique?.attempts ?? 1) + attempt,
          issues: allIssues,
        };
      }
    }

    return slidesWorking;
  } finally {
    try { await renderer.close(); } catch { /* ignore */ }
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}
