/**
 * `Presentation` → `Deck` 聚合器。
 *
 * 三条数据来源，按优先级：
 * 1. `slide.deck` —— AI 生成阶段由 `planToDeck` 落盘的结构化节点树（最准）
 * 2. `htmlToDeck(html)` —— DOM 解析兜底，覆盖历史数据与手工改稿（次准）
 * 3. 空节点 —— 极端兜底，导出仍会生成对应页数
 *
 * deck 级 `master` / `meta` 直接取自 `Presentation`（由 AIGenerateModal 落盘）。
 */

import type { Presentation } from '@noppt/core';
import type { Deck, DeckParityStatus, DeckSlide, DeckNode } from '@noppt/core/deck';
import { htmlToDeck } from './html-to-deck';

export interface PresentationToDeckOptions {
  /** 是否允许 DOM 解析兜底（浏览器环境为 true；单测中可关掉）。 */
  allowHtmlFallback?: boolean;
  /** 画布宽（px）。 */
  width?: number;
  /** 画布高（px）。 */
  height?: number;
}

export interface IntegrityRunContext {
  runId: string;
  presentationId: string;
  writePolicy: 'candidate_only' | 'active' | 'legacy_unverified';
  baseHash?: string;
  baseUpdatedAt?: number;
  snapshotRef?: string;
  activeWriteConfirmed: boolean;
}

export interface IntegrityExportResult {
  deck: Deck;
  status: DeckParityStatus;
  context: IntegrityRunContext;
  issueCodes: string[];
}

/** Verified export boundary; compatibility callers must opt into legacy provenance explicitly. */
export function exportWithIntegrity(
  presentation: Presentation | null | undefined,
  context: IntegrityRunContext,
  options: PresentationToDeckOptions & { allowLegacyUnverified?: boolean } = {},
): IntegrityExportResult {
  if (!context.runId || !context.presentationId || !context.activeWriteConfirmed && context.writePolicy === 'active') {
    throw new Error('integrity_context_required: export context is incomplete');
  }
  const deck = presentationToDeck(presentation, options);
  const issueCodes = deck.integrity?.issues ?? [];
  if (deck.integrity?.status !== 'pass' && !options.allowLegacyUnverified) {
    throw new Error(`integrity_export_blocked: ${deck.integrity?.status ?? 'unverified'}`);
  }
  return {
    deck,
    status: deck.integrity?.status ?? 'unverified',
    context,
    issueCodes,
  };
}


function semanticText(value: string): string {
  return value
    .replace(/[•●◦▪]\s*/gu, '')
    .replace(/\s+/gu, '')
    .trim()
    .toLocaleLowerCase();
}

function textFromNode(node: DeckNode): string {
  if (node.kind === 'group') return node.children.map(textFromNode).join(' ');
  if (node.kind !== 'text' || node.role === 'decoration') return '';
  return node.paragraphs.flatMap((paragraph) => paragraph.runs.map((run) => run.text)).join(' ');
}

function plainHtmlText(html: string): string {
  if (typeof document !== 'undefined') {
    const container = document.createElement('div');
    container.innerHTML = html;
    return container.textContent ?? '';
  }
  return html.replace(/<[^>]+>/gu, ' ');
}

function hasCanonicalRoot(html: string): boolean {
  return /data-canonical-root=["']true["']/u.test(html);
}

function compareDeckHtml(slide: DeckSlide, html: string): { status: DeckParityStatus; issues: string[] } {
  // Legacy/manual HTML has no identity contract. Keep Deck as the semantic truth
  // for that preservation path; canonical HTML is the only representation that
  // can fail the generated-page parity gate.
  if (!hasCanonicalRoot(html)) return { status: 'pass', issues: [] };

  const issues: string[] = [];
  const canonicalText = semanticText(plainHtmlText(html));
  const visit = (node: DeckNode): void => {
    if (node.kind === 'group') {
      node.children.forEach(visit);
      return;
    }
    if (node.kind !== 'text' || node.role === 'decoration') return;
    const expected = semanticText(textFromNode(node));
    if (!expected) return;
    if (node.contentId && !new RegExp(`data-content-id=["']${escapeRegExp(node.contentId)}["']`, 'u').test(html)) {
      issues.push(`identity mismatch: ${node.contentId}`);
    }
    if (!canonicalText.includes(expected)) {
      issues.push(`text mismatch: ${node.contentId ?? node.id ?? 'anonymous'}`);
    }
  };
  slide.nodes.forEach(visit);
  return { status: issues.length > 0 ? 'needs_review' : 'pass', issues };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function blockedDeckSlide(slide: DeckSlide, issues: string[]): DeckSlide {
  return {
    ...slide,
    nodes: [],
    source: 'plan',
    geometryFallback: false,
    parity: 'needs_review',
    parityIssues: issues,
  };
}

/**
 * 把编辑器里的 Presentation 聚合成可导出的 Deck。
 * Deck-backed canonical HTML mismatch is returned as an explicit review state
 * with no exportable nodes; historical/manual HTML remains a geometry fallback.
 */
export function presentationToDeck(
  presentation: Presentation | null | undefined,
  options: PresentationToDeckOptions = {},
): Deck {
  const slides = presentation?.slides ?? [];
  const allowFallback = options.allowHtmlFallback !== false;
  const parityIssues: string[] = [];

  const deckSlides: DeckSlide[] = slides.map((slide, i) => {
    if (slide.deck) {
      const parity = compareDeckHtml(slide.deck, slide.html ?? '');
      if (parity.status !== 'pass') {
        parityIssues.push(`slide ${i + 1}: ${parity.issues.join('; ')}`);
        return blockedDeckSlide({
          ...slide.deck,
          id: slide.deck.id || slide.id,
          notes: slide.notes ?? slide.deck.notes,
        }, parity.issues);
      }
      return {
        ...slide.deck,
        id: slide.deck.id || slide.id,
        notes: slide.notes ?? slide.deck.notes,
        source: 'plan',
        geometryFallback: false,
        parity: 'pass',
        parityIssues: undefined,
      };
    }
    if (allowFallback && slide.html) {
      const parsed = htmlToDeck(slide.html, {
        width: options.width ?? presentation?.width ?? 1280,
        height: options.height ?? presentation?.height ?? 720,
      });
      const fallbackIssues = ['HTML-only fallback uses approximate DOM geometry'];
      parityIssues.push(`slide ${i + 1}: ${fallbackIssues[0]}`);
      return {
        ...parsed,
        id: slide.id,
        source: 'html',
        geometryFallback: true,
        parity: 'needs_review',
        parityIssues: fallbackIssues,
        notes: slide.notes,
      };
    }
    return {
      id: slide.id,
      title: slide.title,
      nodes: [],
      source: 'manual',
      geometryFallback: false,
      parity: 'unverified',
      notes: slide.notes,
      hidden: slide.hidden,
    };
  });

  const integrityStatus: DeckParityStatus = parityIssues.length > 0 ? 'needs_review' : 'pass';
  return {
    title: presentation?.title ?? '未命名演示',
    slides: deckSlides,
    master: presentation?.master,
    theme: undefined,
    meta: presentation?.meta ?? {
      title: presentation?.title,
      author: presentation?.author,
      subject: presentation?.description,
      keywords: presentation?.tags?.join('; '),
      revision: presentation?.version ? String(presentation.version) : undefined,
    },
    source: slides.some((s) => s.deck) ? 'plan' : 'html',
    integrity: { status: integrityStatus, issues: parityIssues.length > 0 ? parityIssues : undefined },
  };
}

/** 逐页备注映射（slideId → notes），供 PPTX 渲染器使用。 */
export function collectNotesById(
  presentation: Presentation | null | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const slide of presentation?.slides ?? []) {
    if (slide.notes) out[slide.id] = slide.notes;
  }
  return out;
}
