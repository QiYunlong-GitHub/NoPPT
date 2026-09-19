/**
 * 孤儿配图救援 + 可见文本长度 + imagePreference 启发式推断（从 ai.service.ts 外置）。
 * 纯函数；依赖 isStructurePage（来自 @noppt/ai）与 JSDOM（来自 jsdom）。
 * ai.service.ts 保留对应 private 方法作为薄委托，对外调用方与 Phase 4 测试网不变。
 */
import { JSDOM } from 'jsdom';
import {
  isStructurePage,
  formatBeijingTime,
  simpleLog,
  type ImagePreference,
  type SlidePageType,
} from '@noppt/ai';

/** 可见文本长度（去标签/注释/空白），用于「图片注入不得吞文本」的不变量校验 */
export function visibleTextLength(html: string): number {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, '').length;
}

/**
 * 启发式推断 imagePreference（当 presentation.imagePreference 未被显式提供时使用）。
 *   - cover 有 <img> 且 summary 有 <img> 且 >70% 内容页有 <img> → 'all'
 *   - 0 有图占比 → 'none'
 *   - 0 < 有图占比 < 15% → 'minimal'
 *   - 其它 → 'content-only'（默认最常见）
 */
export function inferImagePreferenceFromPresentation(result: {
  slides: Array<{ html: string; title?: string; pageType?: string }>;
}): ImagePreference {
  const slides = result.slides || [];
  if (slides.length === 0) return 'content-only';
  const hasImg = (h: string) => /<img\b/i.test(h);
  const isStructureLike = (
    idx: number,
    s: { title?: string; pageType?: string; html: string },
  ) => {
    if (s.pageType === 'cover' || s.pageType === 'toc' || s.pageType === 'summary') return true;
    if (idx === 0) return true; // 第一张按封面看
    if (idx === slides.length - 1) return true; // 最后一张按总结看
    return /font-size:\s*[7-9]\dpx|font-size:\s*1\d{2,}px|<h1\b|目录|总结|感谢|开启.*纪元|结论/i.test(
      `${s.title} ${s.html}`,
    );
  };
  const structureIdxs = slides.map((s, i) => isStructureLike(i, s));
  const contentIdxs = structureIdxs.map((x) => !x);
  const contentSlides = slides.filter((_, i) => contentIdxs[i]);
  const first = slides[0];
  const last = slides[slides.length - 1];
  const coverHasImage = hasImg(first.html);
  const summaryHasImage = hasImg(last.html);
  const contentWithImage = contentSlides.filter((s) => hasImg(s.html)).length;
  const contentImageRatio =
    contentSlides.length > 0 ? contentWithImage / contentSlides.length : 0;
  const totalWithImage = slides.filter((s) => hasImg(s.html)).length;
  const totalRatio = totalWithImage / slides.length;
  if (totalRatio === 0) return 'none';
  if (coverHasImage && summaryHasImage && totalRatio >= 0.7) return 'all';
  if (totalRatio < 0.15) return 'minimal';
  return 'content-only';
}

/**
 * B-3 · 将孤儿配图作为【左图右文】注入内容页 slide。
 * 仅对内容页生效；结构页 / 受保护 layout（comparison-deep-dive / cards / timeline 等）/ 已含图 slide 不注入。
 * 注入失败（文本被吞 / 未注入图片）时 fail-safe 返回原 html。
 */
export function injectOrphanImageIntoSlide(
  html: string,
  localImageUrl: string,
  opts: { pageType?: SlidePageType | string } = {},
): string {
  if (!html || !localImageUrl) return html;
  if (/<img\b/i.test(html)) return html;
  const explicitPt = typeof opts.pageType === 'string' ? opts.pageType.toLowerCase() : undefined;
  // 结构页（封面/目录/总结）恒不配图：结构化救援只服务内容页（与参考模板一致）
  if (explicitPt && isStructurePage(explicitPt)) return html;
  // ——— FR-2 同构（Server 侧 L5.3 + L5.4 共用入口）———
  const PROTECTED_LAYOUT_FOR_INJECT: ReadonlySet<string> = new Set([
    'comparison-deep-dive',
    'content-value-showcase',
    'content-stats-highlight',
    'content-compare',
    'content-timeline',
    'content-table',
    // 以下虽然主要出现在 AI 端 NEVER_UPGRADE_FOR_IMAGE（cards/zigzag/image-background 等），
    // 但为了与 AI 端白名单覆盖面一致，这里一并扩展保护，避免未来 orphan 救援意外 overwrite：
    'content-image-background',
    'content-zigzag',
    'content-cards',
  ]);
  const layoutFromHtml = (html.match(
    /<\s*(?:div|section|article)\b[^>]*\bdata-layout\s*=\s*["']?([a-z0-9-]+)["']?[^>]*>/i,
  ) || [])[1]?.toLowerCase();
  if (
    (explicitPt && PROTECTED_LAYOUT_FOR_INJECT.has(explicitPt)) ||
    (layoutFromHtml && PROTECTED_LAYOUT_FOR_INJECT.has(layoutFromHtml))
  ) {
    return html;
  }

  // ——— DOM 级最小侵入（与 agent 侧同构）：只把原正文容器整段搬进文字列，绝不重建页面 ———
  const dom = new JSDOM(
    `<!doctype html><html><body><div id="__noppt_orphan_root">${html}</div></body></html>`,
  );
  const doc = dom.window.document;
  const wrap = doc.getElementById('__noppt_orphan_root');
  const outer = wrap?.firstElementChild as HTMLElement | null;
  if (!wrap || !outer) return html;
  const outerStyle = outer.getAttribute('style') || '';
  if (
    /flex-direction\s*:\s*row/i.test(outerStyle) &&
    !/flex-direction\s*:\s*column/i.test(outerStyle)
  ) {
    return html;
  }
  const h2 = outer.querySelector('h2');
  if (!h2) return html;
  const isMeaningful = (el: HTMLElement): boolean => {
    if (el.matches('ul,ol,p,table,section,article')) return true;
    if (el.querySelector('ul,ol,p,table,li')) return true;
    return (el.textContent || '').trim().length >= 20;
  };
  let body: HTMLElement | undefined;
  const h2Siblings = Array.from(h2.parentElement?.children ?? []) as HTMLElement[];
  const h2Idx = h2Siblings.indexOf(h2);
  if (h2Idx >= 0) body = h2Siblings.slice(h2Idx + 1).find(isMeaningful);
  if (!body) {
    const children = Array.from(outer.children) as HTMLElement[];
    const anchorIdx = children.findIndex((c) => c === h2 || c.contains(h2));
    if (anchorIdx >= 0) body = children.slice(anchorIdx + 1).find(isMeaningful);
  }
  if (!body) return html;

  const makeDiv = (style: string): HTMLElement => {
    const div = doc.createElement('div');
    div.setAttribute('style', style);
    return div;
  };
  const img = doc.createElement('img');
  img.setAttribute('src', localImageUrl);
  img.setAttribute('data-image-ratio', '4:3');
  img.setAttribute(
    'style',
    'width:100%;height:100%;object-fit:cover;border-radius:16px;display:block;',
  );

  const imageCol = makeDiv(
    'flex:0 0 45%;display:flex;align-items:stretch;min-height:0;min-width:0;overflow:hidden;border-radius:16px;',
  );
  imageCol.appendChild(img);
  const contentCol = makeDiv(
    'flex:0 0 55%;display:flex;flex-direction:column;gap:16px;min-height:0;min-width:0;overflow:hidden;justify-content:space-evenly;',
  );
  contentCol.appendChild(body);
  const row = makeDiv(
    'flex:1;display:flex;gap:40px;align-items:stretch;min-height:0;min-width:0;',
  );
  row.appendChild(imageCol);
  row.appendChild(contentCol);
  outer.appendChild(row);

  const rebuilt = wrap.innerHTML;
  if (!rebuilt.includes(localImageUrl)) return html;
  // 文本不许丢失（否则 fail-safe 回退原 HTML，交给后续链路处理）
  if (visibleTextLength(rebuilt) < visibleTextLength(html)) return html;
  return rebuilt;
}

export interface OrphanRescueStorage {
  getImagesDir(presentationId: string): string;
  listDir(dir: string): string[];
}

export interface OrphanRescueDeps {
  storage: OrphanRescueStorage;
  injectOrphanImageIntoSlide: (
    html: string,
    url: string,
    opts?: { pageType?: string },
  ) => string;
  injectOrphanImageIntoBackground: (
    html: string,
    url: string,
    kind: 'cover' | 'summary',
    opts?: { pageType?: string },
  ) => string;
  slideHasMeaningfulBody: (html: string) => boolean;
  inferImagePreferenceFromPresentation: (r: {
    slides: Array<{ html: string; title?: string; pageType?: string }>;
  }) => ImagePreference;
}

export interface OrphanRescuePresentation {
  id: string;
  imagePreference?: ImagePreference;
  slides: Array<{ id?: string; title?: string; html: string }>;
}

/**
 * 孤儿配图救援（纯编排，从 ai.service.ts 外置）。
 * 依赖 storage / 两个 inject / slideHasMeaningfulBody / inferImagePreferenceFromPresentation 经 deps 注入，
 * ai.service.ts 保留 private rescueOrphanImages 作为薄委托，调用方与 Phase 4 测试网不变。
 * 返回成功救援的孤儿图数量。
 */
export function rescueOrphanImages(
  result: OrphanRescuePresentation,
  detailed: boolean,
  deps: OrphanRescueDeps,
): number {
  const {
    storage,
    injectOrphanImageIntoSlide,
    injectOrphanImageIntoBackground,
    slideHasMeaningfulBody,
    inferImagePreferenceFromPresentation,
  } = deps;
  let orphanRescued = 0;
  try {
    const imagesDir = storage.getImagesDir(result.id);
    const allFiles = storage.listDir(imagesDir);
    const imageFiles = allFiles.filter((f) => /\.(png|jpe?g|webp)$/i.test(f));
    const htmlSoup = result.slides.map((s) => s.html).join('\n');
    const orphans = imageFiles.filter((name) => !htmlSoup.includes(name));
    if (orphans.length > 0) {
      if (detailed) {
        console.log(
          `[${formatBeijingTime()}] [AI] Found ${orphans.length} orphan images on disk, trying to rescue:`,
          orphans,
        );
      }

      // B-3 · step1：确定本次生成的 imagePreference
      const explicitPref = result.imagePreference as ImagePreference | undefined;
      const pref = explicitPref || inferImagePreferenceFromPresentation(result);
      if (detailed) {
        console.log(
          `[${formatBeijingTime()}] [AI]   effective imagePreference: ${pref} (explicit=${Boolean(explicitPref)})`,
        );
      }

      let orphanIdx = 0;
      const orphanUrlAt = (i: number) =>
        `/data/workspace/presentations/${result.id}/assets/images/${orphans[i]}`;

      // B-3 · step2：all 模式优先回填封面（第一张 cover-like）和总结（最后一张 summary-like）
      const singleSlideMode = result.slides.length === 1;
      if (
        (pref === 'all' || pref === 'content-only' || singleSlideMode) &&
        result.slides.length > 0
      ) {
        const tryInjectCoverSummary = (index: number, kind: 'cover' | 'summary') => {
          if (orphanIdx >= orphans.length) return;
          const slide = result.slides[index];
          if (!slide) return;
          if (/<img\b/i.test(slide.html)) return;
          if (pref !== 'all' && !singleSlideMode) return;
          const orphanUrl = orphanUrlAt(orphanIdx);
          // 结构页（封面/总结）恒不配图：result.slides 为 core Slide 无 pageType 字段，
          // 这里显式传入 kind（'cover'/'summary'）让 injectOrphanImageIntoBackground 的
          // isStructurePage 守卫真正生效，避免 pref=all 下往封面/总结叠无关的孤儿背景图。
          const rebuilt = injectOrphanImageIntoBackground(slide.html, orphanUrl, kind, {
            pageType: kind,
          });
          if (rebuilt !== slide.html) {
            if (detailed) {
              console.log(
                `[${formatBeijingTime()}] [AI]   + slide ${index + 1} "${slide.title}" <-- ${orphans[orphanIdx]} (${kind} BG injection)`,
              );
            }
            slide.html = rebuilt;
            orphanIdx++;
          }
        };
        tryInjectCoverSummary(0, 'cover');
        tryInjectCoverSummary(result.slides.length - 1, 'summary');
      }

      if (orphanIdx < orphans.length) {
        const rescueFew = pref === 'minimal' || pref === 'none';
        const maxFill = rescueFew ? Math.min(2, orphans.length) : orphans.length;
        for (
          let s = 0;
          s < result.slides.length && orphanIdx < orphans.length && orphanIdx < maxFill;
          s++
        ) {
          const slide = result.slides[s];
          // 结构页（封面/目录/总结）恒不配图：孤儿救援一律跳过（与参考模板一致）。
          // result.slides 为 core Slide，无 pageType 字段，故用 index 推断 + HTML 特征识别。
          const inferredPt =
            s === 0 ? 'cover' : s === result.slides.length - 1 ? 'summary' : 'content';
          if (isStructurePage(inferredPt)) continue;
          if (
            /data-layout\s*=\s*["']?toc\b/i.test(slide.html) ||
            /目录|table\s*of\s*contents|大纲/i.test(slide.html)
          ) continue;
          if (/<img\b/i.test(slide.html)) continue;
          if (pref !== 'all' && !singleSlideMode) {
            const isCoverLike =
              /font-size:\s*[7-9]\dpx|font-size:\s*1\d{2,}px|<h1\b|总结|感谢|开启.*纪元|结论/i.test(
                `${slide.title} ${slide.html}`,
              );
            if (isCoverLike) continue;
          }
          if (!slideHasMeaningfulBody(slide.html)) continue;
          const orphanUrl = orphanUrlAt(orphanIdx);
          const rebuilt = injectOrphanImageIntoSlide(slide.html, orphanUrl, {
            pageType: inferredPt,
          });
          if (rebuilt !== slide.html) {
            if (detailed) {
              console.log(
                `[${formatBeijingTime()}] [AI]   + slide ${s + 1} "${slide.title}" <-- ${orphans[orphanIdx]}`,
              );
            }
            slide.html = rebuilt;
            orphanIdx++;
          }
        }
      }
      orphanRescued = orphanIdx;
      if (orphanIdx > 0) {
        if (detailed) {
          console.log(
            `[${formatBeijingTime()}] [AI] Orphan rescue complete: ${orphanIdx}/${orphans.length} attached (pref=${pref})`,
          );
        } else {
          simpleLog('AI:ORPHAN', '孤儿配图救援完成', {
            rescued: `${orphanIdx}/${orphans.length}`,
            pref,
          });
        }
      } else if (orphans.length > 0) {
        console.warn(
          `[${formatBeijingTime()}] [AI] Orphan rescue: none of ${orphans.length} could be injected (pref=${pref})`,
        );
      }
    }
  } catch (orphanErr) {
    console.warn(
      `[${formatBeijingTime()}] [AI] Orphan image rescue skipped due to error:`,
      orphanErr,
    );
  }

  return orphanRescued;
}
