import type { ComparisonItem } from '@noppt/ai';
import type { DeckNode, DeckSlide, DeckTextNode } from '@noppt/core/deck';
import { extractPlainText } from './html-text-utils';

export type CompareParityIssueCode =
  | 'canonical_structure_mismatch'
  | 'item_count_mismatch'
  | 'identity_mismatch'
  | 'text_mismatch'
  | 'order_mismatch'
  | 'column_mismatch'
  | 'bullet_mismatch'
  | 'rect_mismatch';

export interface CompareParityIssue {
  code: CompareParityIssueCode;
  contentId?: string;
  expected?: string;
  observed?: string;
  message: string;
}

export interface CompareParityResult {
  status: 'pass' | 'fail' | 'needs_review';
  issues: CompareParityIssue[];
  warnings: string[];
  observedContentIds: string[];
}

interface ObservedHtmlItem {
  contentId: string;
  text: string;
  column?: 'left' | 'right';
  order?: number;
  bullet: boolean;
}

interface ObservedDeckItem {
  contentId: string;
  text: string;
  column?: 'left' | 'right';
  order?: number;
  bullet: boolean;
  rect: { x: number; y: number; w: number; h: number };
}

function normalizeText(value: string): string {
  return value
    .replace(/[•●◦▪]\s*/gu, '')
    .replace(/\s+/gu, '')
    .trim()
    .toLocaleLowerCase();
}

function attr(attrs: string, name: string): string | undefined {
  const match = attrs.match(new RegExp(`${name}="([^"]*)"`, 'u'));
  return match?.[1];
}

function parseBoolean(value: string | undefined): boolean {
  return value === 'true' || value === '1';
}

function parseHtmlItems(html: string): ObservedHtmlItem[] {
  const items: ObservedHtmlItem[] = [];
  const itemPattern = /<[^>]*data-content-id="([^"]+)"([^>]*)>([\s\S]*?)(?=<[^>]*data-content-id="|<\/div>\s*<\/div>\s*<\/div>)/gu;
  for (const match of html.matchAll(itemPattern)) {
    const [, contentId, attrs, body] = match;
    const plain = extractPlainText(body);
    const role = attr(attrs, 'data-role');
    if (role === 'decoration' || attr(attrs, 'data-decoration') === 'true' || attr(attrs, 'aria-hidden') === 'true') continue;
    items.push({
      contentId,
      text: normalizeText(plain),
      column: attr(attrs, 'data-column') as 'left' | 'right' | undefined,
      order: attr(attrs, 'data-order') === undefined ? undefined : Number(attr(attrs, 'data-order')),
      bullet: parseBoolean(attr(attrs, 'data-bullet')) || /^[•●◦▪]/u.test(plain.trim()),
    });
  }
  return items;
}

function parseDeckItems(slide: DeckSlide): ObservedDeckItem[] {
  return slide.nodes
    .filter((node): node is DeckTextNode => node.kind === 'text' && Boolean(node.contentId) && node.role !== 'decoration')
    .map((node) => ({
      contentId: node.contentId!,
      text: normalizeText(node.paragraphs.flatMap((paragraph) => paragraph.runs.map((run) => run.text)).join(' ')),
      column: node.contentColumn,
      order: node.contentOrder,
      bullet: node.bullet ?? node.paragraphs.some((paragraph) => paragraph.bullet === true),
      rect: node.rect,
    }));
}

function pushMismatch(
  issues: CompareParityIssue[],
  code: CompareParityIssueCode,
  contentId: string | undefined,
  expected: string,
  observed: string,
): void {
  issues.push({ code, contentId, expected, observed, message: `${code}: expected ${expected}, observed ${observed}` });
}

function compareExpectedItems(
  issues: CompareParityIssue[],
  items: ComparisonItem[],
  deckById: Map<string, ObservedDeckItem>,
  htmlById: Map<string, ObservedHtmlItem>,
): void {
  for (const expected of items) {
    const deck = deckById.get(expected.contentId);
    const htmlItem = htmlById.get(expected.contentId);
    if (!deck && !htmlItem) continue;
    const expectedText = normalizeText(expected.text);
    if (deck && deck.text !== expectedText) pushMismatch(issues, 'text_mismatch', expected.contentId, expectedText, deck.text);
    if (htmlItem && htmlItem.text !== expectedText) pushMismatch(issues, 'text_mismatch', expected.contentId, expectedText, htmlItem.text);
    if ((deck && deck.order !== expected.order) || (htmlItem && htmlItem.order !== expected.order)) pushMismatch(issues, 'order_mismatch', expected.contentId, String(expected.order), `${deck?.order ?? 'missing'}/${htmlItem?.order ?? 'missing'}`);
    if ((deck && deck.column !== expected.column) || (htmlItem && htmlItem.column !== expected.column)) pushMismatch(issues, 'column_mismatch', expected.contentId, expected.column, `${deck?.column ?? 'missing'}/${htmlItem?.column ?? 'missing'}`);
    if ((deck && deck.bullet !== expected.bullet) || (htmlItem && htmlItem.bullet !== expected.bullet)) pushMismatch(issues, 'bullet_mismatch', expected.contentId, String(expected.bullet), `${deck?.bullet ?? 'missing'}/${htmlItem?.bullet ?? 'missing'}`);
    if (deck && (deck.rect.w <= 0 || deck.rect.h <= 0)) pushMismatch(issues, 'rect_mismatch', expected.contentId, 'positive rect', JSON.stringify(deck.rect));
  }
}

function compareRows(issues: CompareParityIssue[], items: ComparisonItem[], deckById: Map<string, ObservedDeckItem>): void {
  for (const column of ['left', 'right'] as const) {
    const columnItems = items.filter((item) => item.column === column).sort((a, b) => a.order - b.order);
    const observedOrders = columnItems.map((item) => deckById.get(item.contentId)?.order);
    if (observedOrders.some((order, index) => order !== columnItems[index].order)) pushMismatch(issues, 'order_mismatch', undefined, columnItems.map((item) => item.order).join(','), observedOrders.join(','));
  }
  const leftRows = items.filter((item) => item.column === 'left').map((item) => deckById.get(item.contentId)).filter(Boolean) as ObservedDeckItem[];
  const rightRows = items.filter((item) => item.column === 'right').map((item) => deckById.get(item.contentId)).filter(Boolean) as ObservedDeckItem[];
  const rightByOrder = new Map(rightRows.map((item) => [item.order, item]));
  for (const left of leftRows) {
    const right = rightByOrder.get(left.order);
    if (right && (left.rect.y !== right.rect.y || left.rect.h !== right.rect.h)) pushMismatch(issues, 'rect_mismatch', left.contentId, `${left.rect.y}/${left.rect.h}`, `${right.rect.y}/${right.rect.h}`);
  }
}

export function compareContentParity(input: {
  items: ComparisonItem[];
  slide: DeckSlide;
  html: string;
}): CompareParityResult {
  const { items, slide, html } = input;
  const issues: CompareParityIssue[] = [];
  const warnings: string[] = [];
  const deckItems = parseDeckItems(slide);
  const htmlItems = parseHtmlItems(html);
  const expectedIds = items.map((item) => item.contentId);
  const deckIds = deckItems.map((item) => item.contentId);
  const htmlIds = htmlItems.map((item) => item.contentId);

  if ((html.match(/data-compare-root="true"/gu) ?? []).length !== 1 || (html.match(/data-compare-column=/gu) ?? []).length !== 2) {
    issues.push({ code: 'canonical_structure_mismatch', message: 'canonical compare HTML must contain one root and two columns' });
  }
  if (deckItems.length !== items.length) pushMismatch(issues, 'item_count_mismatch', undefined, String(items.length), String(deckItems.length));
  if (htmlItems.length !== items.length) pushMismatch(issues, 'item_count_mismatch', undefined, String(items.length), String(htmlItems.length));
  if (deckIds.join('|') !== expectedIds.join('|')) pushMismatch(issues, 'identity_mismatch', undefined, expectedIds.join('|'), deckIds.join('|'));
  if (htmlIds.join('|') !== expectedIds.join('|')) pushMismatch(issues, 'identity_mismatch', undefined, expectedIds.join('|'), htmlIds.join('|'));

  const deckById = new Map(deckItems.map((item) => [item.contentId, item]));
  const htmlById = new Map(htmlItems.map((item) => [item.contentId, item]));
  compareExpectedItems(issues, items, deckById, htmlById);
  compareRows(issues, items, deckById);

  if (slide.layoutParams?.legacyDerived === true || (slide.layoutParams?.warnings as string[] | undefined)?.includes('compare_column_ownership_unverified')) {
    warnings.push('compare column ownership was derived from legacy content and is not independently verified');
  }
  return {
    status: issues.length > 0 ? 'fail' : warnings.length > 0 ? 'needs_review' : 'pass',
    issues,
    warnings,
    observedContentIds: [...new Set([...deckIds, ...htmlIds])],
  };
}


/**
 * Shared semantic manifest item used by plan, Deck, and canonical HTML audits.
 * Decoration is intentionally representable but never required for parity.
 */
export interface ContentManifestItem {
  contentId: string;
  text: string;
  role: string;
  order: number;
  ownership?: string;
  required?: boolean;
  decoration?: boolean;
}

export type ContentManifestSource = 'plan' | 'deck' | 'html';

export type ContentManifestIssueCode =
  | 'identity_mismatch'
  | 'missing_content'
  | 'text_mismatch'
  | 'order_mismatch'
  | 'role_mismatch'
  | 'ownership_mismatch';

export interface ContentManifestIssue {
  code: ContentManifestIssueCode;
  source: ContentManifestSource;
  contentId?: string;
  expected?: string;
  observed?: string;
  message: string;
}

export interface ContentManifestParityResult {
  status: 'pass' | 'fail' | 'needs_review';
  issues: ContentManifestIssue[];
  observedContentIds: string[];
}

function isDecoration(item: ContentManifestItem): boolean {
  return item.decoration === true || item.role === 'decoration';
}

function requiredManifest(items: ContentManifestItem[]): ContentManifestItem[] {
  return items.filter((item) => !isDecoration(item));
}

function semanticText(value: string): string {
  return String(value ?? '').replace(/[•●◦▪]\s*/gu, '').replace(/\s+/gu, '').trim().toLocaleLowerCase();
}

interface ManifestIssueInput {
  code: ContentManifestIssueCode;
  source: ContentManifestSource;
  contentId?: string;
  expected: string;
  observed: string;
}

function manifestIssue(issues: ContentManifestIssue[], input: ManifestIssueInput): void {
  const { code, source, contentId, expected, observed } = input;
  issues.push({
    code,
    source,
    contentId,
    expected,
    observed,
    message: `${source} ${code}${contentId ? ` (${contentId})` : ''}: expected ${expected}, observed ${observed}`,
  });
}

/**
 * Compare one required plan collection with Deck and HTML observations.
 * All three representations use the same identity/order/role/ownership fields;
 * extra decoration is ignored rather than treated as dropped content.
 */
export function compareContentCollections(input: {
  plan: ContentManifestItem[];
  deck: ContentManifestItem[];
  html: ContentManifestItem[];
}): ContentManifestParityResult {
  const expected = requiredManifest(input.plan);
  const expectedIds = expected.map((item) => item.contentId);
  const issues: ContentManifestIssue[] = [];
  const observedContentIds = [...new Set(
    [...requiredManifest(input.deck), ...requiredManifest(input.html)].map((item) => item.contentId),
  )];

  for (const [source, rawItems] of [
    ['deck', input.deck],
    ['html', input.html],
  ] as const) {
    const items = requiredManifest(rawItems);
    const ids = items.map((item) => item.contentId);
    if (ids.join('|') !== expectedIds.join('|')) {
      manifestIssue(issues, { code: 'identity_mismatch', source, expected: expectedIds.join('|'), observed: ids.join('|') });
    }
    const byId = new Map(items.map((item) => [item.contentId, item]));
    for (const expectedItem of expected) {
      const observed = byId.get(expectedItem.contentId);
      if (!observed) {
        manifestIssue(issues, { code: 'missing_content', source, contentId: expectedItem.contentId, expected: expectedItem.text, observed: '' });
        continue;
      }
      const expectedText = semanticText(expectedItem.text);
      const observedText = semanticText(observed.text);
      if (expectedText !== observedText) manifestIssue(issues, { code: 'text_mismatch', source, contentId: expectedItem.contentId, expected: expectedText, observed: observedText });
      if (expectedItem.order !== observed.order) manifestIssue(issues, { code: 'order_mismatch', source, contentId: expectedItem.contentId, expected: String(expectedItem.order), observed: String(observed.order) });
      if (observed.role && expectedItem.role !== observed.role) manifestIssue(issues, { code: 'role_mismatch', source, contentId: expectedItem.contentId, expected: expectedItem.role, observed: observed.role });
      if (expectedItem.ownership !== undefined && observed.ownership !== undefined && expectedItem.ownership !== observed.ownership) {
        manifestIssue(issues, { code: 'ownership_mismatch', source, contentId: expectedItem.contentId, expected: expectedItem.ownership, observed: observed.ownership });
      }
    }
  }

  return {
    status: issues.length > 0 ? 'fail' : 'pass',
    issues,
    observedContentIds,
  };
}


/** Collect observed semantic items from a Deck slide, preserving node text. */
export function collectDeckContentManifest(slide: DeckSlide): ContentManifestItem[] {
  const manifestById = new Map((slide.contentManifest ?? []).map((item) => [item.contentId, item]));
  const result: ContentManifestItem[] = [];
  const visit = (node: DeckNode, fallbackOrder: number): void => {
    if (node.kind === 'group') {
      node.children.forEach((child, index) => visit(child, fallbackOrder + index));
      return;
    }
    if (!node.contentId || (node.kind !== 'text' && node.kind !== 'shape')) return;
    const fallback = manifestById.get(node.contentId);
    const text = node.kind === 'text'
      ? node.paragraphs.flatMap((paragraph) => paragraph.runs.map((run) => run.text)).join(' ')
      : (node.text ?? []).flatMap((paragraph) => paragraph.runs.map((run) => run.text)).join(' ');
    result.push({
      contentId: node.contentId,
      text,
      role: node.role ?? fallback?.role ?? '',
      order: node.contentOrder ?? fallback?.order ?? fallbackOrder,
      ownership: node.contentColumn ?? fallback?.column,
      required: fallback?.required ?? node.role !== 'decoration',
      decoration: node.role === 'decoration',
    });
  };
  slide.nodes.forEach((node, index) => visit(node, index));
  return result;
}

function attribute(attrs: string, name: string): string | undefined {
  const match = attrs.match(new RegExp(`${name}=["']([^"']*)["']`, 'u'));
  return match?.[1];
}

/** Collect content identities emitted by canonical or edited HTML. */
export function collectHtmlContentManifest(html: string): ContentManifestItem[] {
  const result: ContentManifestItem[] = [];
  const itemPattern = /<[^>]*data-content-id=["']([^"']+)["']([^>]*)>([\s\S]*?)(?=<[^>]*data-content-id=|<\/body>|$)/giu;
  for (const match of html.matchAll(itemPattern)) {
    const [, contentId, attrs, body] = match;
    const role = attribute(attrs, 'data-role') ?? (attribute(attrs, 'data-column') ? 'compare' : '');
    const decoration = role === 'decoration' || attribute(attrs, 'data-decoration') === 'true' || attribute(attrs, 'aria-hidden') === 'true';
    result.push({
      contentId,
      text: extractPlainText(body),
      role,
      order: Number(attribute(attrs, 'data-order') ?? result.length),
      ownership: attribute(attrs, 'data-ownership') ?? attribute(attrs, 'data-column'),
      required: !decoration && attribute(attrs, 'data-required') !== 'false',
      decoration,
    });
  }
  return result;
}
