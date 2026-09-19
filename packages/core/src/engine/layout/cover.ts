
import {
  COVER_CONTENT_SIGN_RE,
  COVER_MULTI_COL_RE,
} from './constants';
/**
 * 居中护栏单一真源（与 @noppt/ai 侧 ensureOuterContainer / enforceCoverPosterArtStyles 共用）。
 * 仅当 HTML 片段「只有标题、无任何内容标记、且非多列/分栏结构」时才判为封面式可居中，
 * 否则一律禁止注入「justify-content/align-items/text-align : center」三件套，
 * 避免内容页（尤其是图片被删后误判为「仅标题」的页面）被强制居中、构图被破坏。
 */
export function isCoverLikeHtml(innerHtml: string): boolean {
  const clean = innerHtml.replace(/<!--[\s\S]*?-->/g, '');
  if (COVER_CONTENT_SIGN_RE.test(clean) || COVER_MULTI_COL_RE.test(clean)) return false;
  const low = clean.toLowerCase();
  const h1Count = (low.match(/<h1\b/g) || []).length;
  return h1Count >= 1;
}

