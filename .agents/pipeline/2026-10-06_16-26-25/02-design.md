# Presentation Visual Integrity Fix — Technical Design

## Overview

This design closes the blockers recorded by the 2026-10-06 audit for `pres_musb7z42_ls8yvjc` without introducing a second rendering architecture. The repository already has the relevant partial boundaries: `@noppt/ai` normalizes typed slide content and builds Deck nodes, `deck-to-html.ts` emits canonical HTML, `@noppt/audit` owns browser/font/content evidence, `@noppt/web` owns editor viewport and export adapters, and `@noppt/server` owns persistence plus the existing `PresentationIntegrityService`. The implementation will complete those boundaries rather than create parallel APIs. The locked flow is:

```text
PresentationPlan
  -> normalizeSlideContent / strict contract
  -> Deck (1280x720 logical semantic and geometric truth)
  -> canonical HTML (responsive screen representation with identities)
  -> editor / preview / export
  -> integrity evidence gate
  -> candidate-only or explicitly authorized active write
```

The target presentation inputs remain read-only. All repair, audit, browser, screenshot, report, and hash artifacts are written under the existing isolated `.agents/artifacts/presentation-visual-integrity/<runId>/` root. The candidate remains unpromoted. No generation tool, `noppt_generate`, dependency installation, lockfile rewrite, commit, push, reset, clean, or live service startup is part of this implementation.

The implementation keeps TypeScript 5.4, React 18/Vite, NestJS 10, pnpm workspace boundaries, Vitest, Playwright Core, and the zero-dependency `@noppt/core` package. No new runtime dependency is permitted.

## Current implementation facts and decisions

The audit and source inspection establish these facts which constrain the solution:

- `SlideRenderer.collectLayoutMetrics`, `visual-validation.ts`, and the exploration helper call `page.evaluate`; Task 16 failed before metrics with `ReferenceError: __name is not defined`.
- Task 13 reached Chromium and recorded a real failure: at `800x600`, pages 1–5 have required clipping; page 1 also has horizontal overflow; pages 2–4 have title/overlap failures; pages 3–5 have parity failures. This is not treated as an environment limitation.
- `planToDeck` defaults to `validationMode: 'legacy'`; `stages/finalize.ts` and `stages/render-deck.ts` call it without strict validation. Strict validation is therefore not yet a production invariant.
- Deck nodes already have optional `contentId`, `contentColumn`, `contentOrder`, `bullet`, `source`, and `DeckSlide` has an optional `contentManifest`, but cover nodes are not consistently annotated. `compareContentCollections` currently treats an empty required manifest as a pass when both observed collections are empty.
- `MetricItem` already has a discriminated `metric`/`omission` union, but omission entries are excluded from `collectRequiredContent`; the target candidate consequently reports pages 3 metrics 3–4 with empty roles and `value_not_separable` review markers.
- `deck-to-html.ts` has a responsive root, but descendant rectangles and font sizes remain logical pixel values; a `width:100%` root alone does not scale absolutely positioned children. The editor also applies a transformed fixed canvas and `EditorLayout.tsx` is already over the gate growth baseline.
- `visual-validation.ts:fontEvidence` hard-codes `fallbackUsed: false`, while `font-icon-check.ts` has a richer but separate observation/classification path.
- `PresentationIntegrityService` can create candidate writers, but `final-write.ts`, `auto-audit.ts`, `audit.service.ts`, `PresentationService.save`, and MCP edit paths still have direct active writes or do not carry a common run policy.
- `presentationToDeck` is the existing web export aggregator. There is no shared `exportWithIntegrity` or `saveSlideWithIntegrity` operation yet.
- `pnpm.cmd gates:check` currently reports six regressions: new violations in `audit-engine.ts`, `compare-content.ts`, the exploration helper, and `font-icon-check.ts`; audit visual `index.ts` growth; and `EditorLayout.tsx` growth. The fix must reduce or contain those changes, not alter the gate or baseline to hide them.

The design therefore chooses one canonical responsive representation based on CSS container-relative logical units, one typed integrity context shared through `@noppt/core`, and one strict operation boundary for save/export. Compatibility wrappers remain, but they cannot claim verified integrity when using legacy HTML-only or unverified browser/font evidence.

## 1. Shared contracts and invariants

### 1.1 Logical canvas transform

Add a small, dependency-free contract under `packages/core/src/integrity/` (exported by `packages/core/src/index.ts`) rather than importing web or server types into core:

```ts
export type IntegrityPhase =
  | 'candidate' | 'preview' | 'save' | 'export' | 'promotion' | 'rollback';
export type WritePolicy = 'candidate_only' | 'active' | 'legacy_unverified';
export type VerificationStatus = 'pass' | 'warn' | 'fail' | 'needs_review' | 'unverified';

export interface LogicalCanvasTransform {
  logicalWidth: 1280;
  logicalHeight: 720;
  renderedWidth: number;
  renderedHeight: number;
  scale: number;
  offsetX: number;
  offsetY: number;
  profile: 'narrow' | 'standard' | 'wide';
  forward(point: { x: number; y: number }): { x: number; y: number };
  inverse(point: { x: number; y: number }): { x: number; y: number };
}

export interface IntegrityRunContext {
  runId: string;
  presentationId: string;
  phase: IntegrityPhase;
  writePolicy: WritePolicy;
  baseHash?: string;
  candidateRoot?: string;
  artifactRoot?: string;
  activeWriteConfirmed: boolean;
  source: 'plan' | 'deck' | 'canonical-html' | 'editor' | 'html-fallback' | 'mcp' | 'preview' | 'unknown';
}

export interface ExportProvenance {
  source: 'plan' | 'deck' | 'html' | 'manual' | 'legacy';
  geometryFallback: boolean;
  parity: VerificationStatus;
  integrityRunId?: string;
  issueCodes?: string[];
}
```

`createLogicalCanvasTransform` is pure and lives beside the type. It validates finite positive viewport dimensions, clamps no content coordinates, rounds only rendered CSS dimensions to two decimals, and uses `scale = min(availableWidth / 1280, availableHeight / 720)`. `forward` and `inverse` use the same `scale` and offsets; pointer/selection code must not reimplement the formula. A zero/negative viewport is an `invalid_viewport` result with scale `0`, never a pass.

Deck geometry remains exactly `0 <= x`, `0 <= y`, `x + w <= 1280`, `y + h <= 720`. Presentation `width`/`height` remain accepted API metadata and export dimensions; they are mapped through an explicit transform, not used as a second semantic coordinate system. The canonical editor and HTML representation use the 1280×720 logical canvas.

### 1.2 Identity and manifest contract

Extend the existing `DeckSlide.contentManifest` entry in `packages/core/src/deck/schema.ts` with backward-compatible optional fields:

```ts
interface DeckContentManifestEntry {
  contentId: string;
  text: string;
  role: string;
  order: number;
  column?: 'left' | 'right';
  bullet?: boolean;
  required: boolean;
  status?: 'present' | 'omitted' | 'needs_review' | 'unverified';
  sourceText?: string;
  omissionReason?: string;
}
```

Add the same optional `integrity?: { status; issueCodes; source; geometryFallback }` metadata to `DeckSlide`. Existing JSON remains valid. `DeckNodeBase` already carries identity fields; the implementation will ensure every required node gets them rather than relying on the fallback matcher in `annotateContentNodes`.

The invariant is: a required plan item has one stable `contentId`, one role, one deterministic order, and one source text from plan through Deck, canonical HTML, editor DOM, export input, and audit evidence. Decoration nodes have no required identity and are excluded from content coverage. Duplicate IDs, empty required text, non-finite order, and missing role are structural failures.

### 1.3 Strict status aggregation

Use `VerificationStatus` at integrity boundaries while preserving existing `AuditEngineResult.status` (`passed | warn | fail | error`) for compatibility. The mapping is explicit:

- `error` from a missing/failed engine becomes `unverified` only when the failure is environmental (`browser_unavailable`, missing `document.fonts`, missing measurement API); a product/layout/parity error remains `fail`.
- Any required `needs_review`, `unverified`, missing, or failed evidence makes the per-slide result non-pass.
- Overall status precedence is `fail > needs_review > unverified > warn > pass` for a verified operation. `unverified` is kept distinct from `needs_review` in reports, but both block verified save/export/promotion.
- Legacy compatibility may return a result with `source=legacy` and `parity=unverified`; it must not be converted to `pass` by a wrapper.

`assertIntegrityEvidenceForSave` becomes policy-aware: `assertIntegrityEvidenceForSave(report, { requireVerified: true })` rejects missing report, incomplete page coverage, required `fail`, `needs_review`, `unverified`, missing events, missing artifacts, and any page without a required matrix result. `requireVerified: false` is allowed only for an explicitly supplied `legacy_unverified` context and still returns the downgraded status to the caller.

## 2. Typed slide contract and page-specific content

Modify the existing `packages/ai/src/types.ts`, `slide-contract.ts`, `plan-to-deck.ts`, `layout-content.ts`, and `layout-advanced.ts`; do not introduce a second plan model.

### 2.1 Strict production validation

`buildValidatedDeck` remains the primary API. Change production generation callers in `packages/ai/src/agents/html-presentation/stages/finalize.ts` and `stages/render-deck.ts` to pass `validationMode: 'strict'` and to propagate `PlanToDeckResult` issues to the candidate report. A strict fatal issue returns no persistable Deck. The compatibility `planToDeck` wrapper remains available for unit tests and historical callers, but production persistence must not call it in implicit legacy mode.

`normalizePresentationPlan` remains the only adapter for old `keyPoints`. Its limits are enforced before layout: title <= 500 characters, item text <= 10,000 characters, <= 32 required items per slide, safe unique IDs `[A-Za-z0-9_.-]{1,128}`, and finite non-negative order. It trims boundary whitespace but never deletes source content. Invalid input produces a structured `PlanContractIssue` with `code`, `slideIndex`, `contentId`, path, expected/observed values, and recoverability.

### 2.2 Explicit comparison semantics

`ComparisonItem` represents one visible item, not a left/right pair. A page consists of an equal number of `left` and `right` items with matching `order` rows. This matches the existing target candidate and avoids inventing a second pair model. The required four items on page 2 are therefore two left rows and two right rows.

Typed `comparisonItems` are authoritative. A legacy `legacyColumnManifest` is accepted only when its length equals the source item count and every entry has a unique non-negative order per column. Without that manifest, legacy `keyPoints` are mechanically split only for display preservation, and the normalizer emits `compare_column_ownership_unverified`; strict generated persistence marks the result `needs_review` and cannot claim parity pass. The fallback is never treated as verified column ownership.

The layout builder assigns `contentColumn`, `contentOrder`, `contentId`, role `compare`, and `bullet=true` directly to each text node. The bullet marker and item text are rendered by the same paragraph/node. Parity checks compare IDs, normalized text, role, order, column, bullet state, and positive rects.

### 2.3 Metrics 3–4 and accepted source preservation

Retain the discriminated `MetricItem` union but make omission status explicit. A metric is valid only when both `label` and `value` are non-empty. A source that has a safe numeric/unit token and non-empty remaining label becomes a typed metric with `originalText`. A source with no safe value is not assigned a fabricated value. It becomes:

```ts
{
  kind: 'omission',
  contentId,
  order,
  originalText: '<exact non-empty source>',
  reason: 'value_not_separable',
  status: 'omitted',
  legacyDerived: true
}
```

`status: 'needs_review'` is reserved for ambiguous parser results, malformed source, or a source that might contain a value but cannot be separated deterministically. `status: 'omitted'` is allowed only when the parser proves no factual numeric value was supplied; it preserves exact source text and is an accepted structured omission, not a silent drop. Machine-generated text such as `（需复核：value_not_separable）` is metadata and must not be appended to `originalText` or used as visible source content.

`collectRequiredContent` and manifest collection include omissions as required source entries with role `metric-source`, non-empty `sourceText`, `status=omitted`, and `omissionReason`. The layout emits a compact, visible source card using the original text; it does not emit an empty value or role. The audit reports `source_preserved_omission` rather than an unexplained `value_not_separable` marker. A `needs_review` omission remains a gate blocker; an accepted `omitted` entry passes content preservation only when its source, identity, order, reason, and status are all present.

For the target page 3, metrics 1–2 must be typed value/label items. Metrics 3–4 must either become typed if the source is safely separable or follow the structured omission branch above. Tests assert no empty role, no empty required node, no fabricated value, and no dropped original source.

### 2.4 Cover identities and all page manifests

Cover layout is updated to create deterministic identities for the title and each required cover item: `slide-1-title`, `slide-1-cover-1`, `slide-1-cover-2`, and `slide-1-cover-3` unless explicit source IDs exist. Roles are `title`, `subtitle`, `subtitle`, and `kicker`; order is `0..3`; all are required and `source=plan`. The cover Deck manifest and canonical HTML manifest must contain the same four entries. `annotateContentNodes` will not assign cover identity by fuzzy text matching; page-type layout functions supply identity at node creation.

`compareContentCollections` changes empty-manifest behavior: if the expected required collection is non-empty and either Deck or HTML collection is empty, it returns `fail` with `missing_content`/`identity_mismatch`. If both are empty only when the plan has no required items, it can pass. Role and order are mandatory for required entries; omission entries are compared by `sourceText`, reason, and status.

## 3. Responsive canonical HTML and measured layout

### 3.1 Canonical HTML scaling choice

Use one responsive representation, not an outer responsive wrapper around an unscaled fixed canvas. In `packages/ai/src/agents/html-presentation/deck/deck-to-html.ts`, add small render helpers:

- `logicalX(value)`, `logicalY(value)`, `logicalWidth(value)`, and `logicalHeight(value)` emit container-relative `cqw` lengths based on 1280 logical width. Vertical lengths also use the logical width because the root aspect ratio is fixed at 16:9.
- Font sizes, padding, border widths, shadows, chart labels, and absolute rects use the same logical unit conversion. SVG retains its logical `viewBox`, while its CSS width/height are responsive.
- The canonical root has `width:100%`, `max-width:1280px`, `aspect-ratio:1280 / 720`, `container-type:size`, `container-name:noppt-slide`, `box-sizing:border-box`, `margin:0 auto`, and `overflow:visible`. The logical canvas is `width:100%;height:100%;position:relative;min-width:0;overflow:visible`.
- The HTML fragment includes a scoped body reset (`margin:0;`) only in the standalone validation document wrapper, not in user content. Required text is never placed inside a hidden/clip overflow container. Shape/image/table/chart clipping remains local to that visual primitive and is only valid when the node is not a required text owner.

`cqw` is chosen because it scales absolute logical positions and typography together inside the actual root width; the supported Chromium/Edge validation baseline implements it. A browser that cannot compute container units is an environment limitation: the evaluator reports `unverified` and does not claim a pass. The renderer also emits `data-logical-width`, `data-logical-height`, `data-content-id`, `data-role`, `data-order`, `data-column`, `data-required`, and `data-deck-node-id` on every semantic node.

The helper is applied consistently to `renderTextNode`, `renderShape`, `renderImage`, `renderTable`, `renderChart`, groups, compare columns, and master overlays. No renderer may combine logical pixel `left/top/width/height` with responsive root dimensions.

### 3.2 Measured page layout

Keep `layout-primitives.ts` as the pure deterministic layout owner. `measureText` returns `{width,height,lines,status}` with status `heuristic | measured | unverified | failed`; generation uses deterministic heuristic metrics, and browser validation replaces them with DOM/canvas evidence. The order is fixed:

1. preserve intended type scale and natural wrapping;
2. allocate additional safe text height and reduce non-required gaps;
3. shrink font size/line height within page-type minimums;
4. select an explicit compact profile;
5. return `geometry_out_of_bounds` or `text_measure_unverified` rather than delete or clip text.

Cover title, compare title, stats title, cards title, and summary title reserve measured title height before body/card rects are assigned. `layout-content.ts` and `layout-advanced.ts` use actual content height for cards and metrics. A title rect and required content rect may not overlap; a fixed height is a maximum/layout hint, never a clipping mechanism.

Page profiles are deterministic and identity-preserving: narrow uses compare one column stacked vertically, stats 2×2, and cards 1–2 columns; standard uses the existing logical composition; wide may retain the standard composition with additional safe gaps. If a profile cannot fit a required item in 720 logical pixels, strict generation returns a structural failure and the candidate is not verified.

## 4. Browser evaluator and five-page validation

### 4.1 Self-contained evaluator

The evaluator must not pass TypeScript-transpiled function values to `page.evaluate`. Add a browser script module near `packages/audit/src/engines/visual-engine/` that exports plain JavaScript source strings, for example `layout-metrics.browser.ts` exporting `LAYOUT_METRICS_EVALUATOR` and `EVALUATOR_SMOKE_SCRIPT`. The strings contain only browser-native JavaScript, no imports, type annotations, closures over Node variables, decorators, or helper calls such as `__name`.

`SlideRenderer` gets a private `evaluateBrowserScript<T>(page, source, arg)` boundary. It invokes Playwright with the source string and serialized JSON arguments. Before any resource, geometry, font, parity, or screenshot metrics, `runEvaluatorSmoke(page)` invokes the same evaluation boundary with a sentinel script and asserts `{ evaluator: 'noppt', version: 1, ok: true }`. A smoke failure throws `BrowserEvaluationError` with code `browser_evaluation_failed`, page/viewport/run metadata, and the original browser message. It is caught by `runVisualValidation` as `unverified` with no metrics or screenshots claimed for that slide; the report does not synthesize zeros.

The metrics script returns a versioned JSON shape containing root rect, logical dimensions, document scroll/client dimensions, per-required-node rect/style/scroll metrics, clipping, overflow, title overlap, and a `scriptVersion`. The collector validates the shape in Node before accepting it. A deliberately failing evaluator fixture must produce `fail` or `unverified` and an empty metrics array.

The direct smoke assertion is also called after each resize before collecting that viewport’s metrics. This catches stale page contexts and reverse-resize failures without allowing later metrics to be treated as evidence from a failed callback.

### 4.2 Validation matrix and result semantics

`runVisualValidation` remains the orchestration API and continues to write JSON/Markdown artifacts under its supplied artifact root. It must execute:

- pages 1–5;
- `800x600`, `1280x720`, and `1600x900` initial viewport cells;
- resize sequence `800x600 -> 1280x720 -> 1600x900 -> 1280x720 -> 800x600` for every page;
- per cell: `clipped`, `horizontalOverflow`, `verticalOverflow`, `titleOverlap`, empty required nodes, parity, font evidence, resource readiness, and screenshot path.

A page cell is `pass` only if required clipping and overlap are zero, no required horizontal overflow exists, required content is non-empty/visible, parity is pass, and font/resource status is verified or the policy explicitly records a non-required environment warning. A browser callback failure is not a product geometry pass. The report includes run ID, presentation ID, slide index, viewport/profile, evaluator version, browser status, error code/message, and artifact paths.

The target harness uses the existing isolated candidate and does not read/write the protected presentation directory. It records original-input SHA-256 before candidate construction, after failed/unverified validation, and after final validation. Any hash difference is a fatal safety result independent of visual status.

## 5. Editor viewport and interaction preservation

`packages/web/src/hooks/useZoom.ts` owns viewport math and `packages/web/src/layouts/viewport-adapter.ts` (new pure module) owns the transform. `EditorLayout.tsx` becomes an orchestration component; extract the preview stage and pointer-coordinate helpers into `packages/web/src/layouts/EditorPreviewStage.tsx` and `packages/web/src/layouts/editor-pointer.ts` to reduce the existing gate growth.

The preview stage uses:

```ts
const availableWidth = Math.max(1, editorArea.clientWidth - 24);
const availableHeight = Math.max(1, editorArea.clientHeight - 24);
const adapter = createLogicalCanvasTransform(availableWidth, availableHeight);
const renderedWidth = 1280 * adapter.scale;
const renderedHeight = 720 * adapter.scale;
```

The stage has exactly the rendered dimensions. The logical canvas has exactly 1280×720 CSS dimensions and is scaled once at `transform-origin: top left`; no nested padding or second transform is applied to canonical HTML. The automatic fit scale is used until the user manually changes zoom; after manual zoom the stage may scroll as an editor operation, but automatic fit at all required widths never requires horizontal scrolling to read content. ResizeObserver updates one state snapshot in `requestAnimationFrame`, cancels pending frames on unmount, and clears/recomputes user-fit state when switching presentations. Reverse resize must restore the same scale/profile as the initial state within a two-decimal tolerance.

Pointer coordinates use `viewportToLogicalPoint` with the actual canvas bounding rect and rendered scale. Selection overlays use the same forward transform. Page selection, text editing, copy/paste, undo/redo, zoom controls, save state, legal decoration, and element paths remain unchanged at their public call sites. The save handler is moved behind `saveSlideWithIntegrity` but retains the current unsaved-state behavior on rejection.

## 6. Font evidence

`font-icon-check.ts` becomes the sole classifier; `visual-validation.ts` consumes its result instead of constructing a second observation with `fallbackUsed:false`. The classifier must expose:

- declared family and fallback stack, requested/resolved weight, size, line height, and source;
- `document.fonts` availability, `document.fonts.check` results for each requested weight, and `document.fonts.ready` status;
- representative required nodes by content ID/role, including Latin, CJK, number/unit samples when present;
- computed family/weight and DOM `scroll/client` dimensions;
- declared-vs-observed canvas measurement delta and a baseline identifier;
- state `resolved`, `fallback`, `failed`, or `unverified`, with reason and affected node IDs.

The browser probe compares declared-family measurement against the observed computed-family measurement for each representative sample. `fallbackUsed` is derived as `state === 'fallback'` and never assigned a constant. If `document.fonts`, `CanvasRenderingContext2D.measureText`, computed style, or a required node probe is missing, the result is `unverified`; missing APIs do not become resolved. Thresholds remain 5% warning and 10% failure unless existing config supplies a different explicit threshold. Fallback with a layout-affecting delta invokes the same compact/reflow validation; it cannot silently save a clipped candidate.

## 7. Shared integrity save/export/write policy

### 7.1 Shared operation APIs

Define structural request/result types in `@noppt/core/integrity` and implement the operations in their owning packages:

```ts
export interface SaveSlideWithIntegrityInput {
  presentation: Presentation;
  slideIndex?: number;
  context: IntegrityRunContext;
  evidencePolicy: 'verified' | 'legacy_unverified';
}
export interface IntegrityOperationResult<T> {
  status: VerificationStatus;
  value?: T;
  issueCodes: string[];
  reportPath?: string;
  artifactPaths: string[];
}
```

- `@noppt/server/modules/presentation/presentation-integrity.service.ts` implements `saveSlideWithIntegrity` and the server-side gate. It sanitizes and normalizes candidate data, runs audit/geometry/parity/font evidence through an injected `IntegrityRunContext`, writes only to the context’s candidate writer, and atomically commits active data only for `writePolicy='active'` with `activeWriteConfirmed=true` and a verified report.
- `@noppt/web/src/export/presentation-to-deck.ts` implements `exportWithIntegrity` and keeps `presentationToDeck` as a compatibility wrapper. The wrapper returns the Deck for old callers, but the `Deck.integrity`/slide provenance remains downgraded and callers cannot mistake it for verified export.
- Web editor save calls the server `PUT /presentations/:id` with a serialized context and receives a stable result. The server controller translates an integrity rejection to HTTP 422 with `{ code, reportPath, issueCodes }`; the editor keeps `hasUnsavedChanges=true` and shows the report reference.
- `packages/server/src/modules/mcp/mcp.controller.ts` routes `edit_slide`, `edit_element`, and `edit_global` through `saveSlideWithIntegrity`/the presentation save operation and passes `source='mcp'`, a generated run ID, and `writePolicy='active'` only for ordinary confirmed saves. Candidate-context MCP calls are rejected if their write path is outside the candidate root. The existing Hermes draft tool remains auto-only and does not invoke generation or promotion.
- Preview uses `PresentationIntegrityService.createPreview` and reads candidate files. It never calls an active save path. Audit reports, screenshots, and lifecycle events use the same run context and candidate artifact root.
- PPTX/deck export callers use `exportWithIntegrity` before `deck-to-pptx.ts`. `deck-to-pptx.ts` remains a pure consumer of the resulting Deck and cannot bypass the parity/provenance result.

### 7.2 Write-policy enforcement

Every write that can touch presentation output receives `IntegrityRunContext`: `PresentationService.save`, `saveSlideWithIntegrity`, `final-write.ts`, `auto-audit.ts`, `audit.service.ts` report persistence, AI audit regeneration loops, MCP edit tools, preview artifacts, and export artifacts. `IntegrityArtifactStore` exposes a policy-aware writer with these rules:

- `candidate_only`: target path must be within `candidateRoot` or `artifactRoot`; active presentation, active audit, and active log paths throw `candidate_write_outside_root`.
- `active`: active presentation writes require verified evidence, matching `baseHash`/`updatedAt`, and explicit confirmation; use existing atomic write behavior and preserve an original snapshot.
- `legacy_unverified`: historical HTML/Deck fallback may write only through the explicitly selected legacy endpoint, records provenance and `unverified`, and cannot be used by verified promotion.

Remove direct fallback writes from `final-write.ts` and `auto-audit.ts`; missing context/writer is a fatal `integrity_context_required` error for candidate-enabled production paths, not a reason to fall back to `storage.writeJsonFile`. Keep direct writes only for unrelated workspace/config/chat data and for explicit legacy compatibility operations that are not presented as verified integrity saves. Route `audit.service.ts.persistReport` to the context’s report writer when a run is supplied; without a run, its existing active report behavior is retained only for non-verified legacy audit endpoints and labeled accordingly.

On any failure, the active presentation remains byte-for-byte unchanged, the candidate and report are retained, and the caller receives stable issue code, status, report path, and artifact paths. Automatic repair updates the candidate hash and reruns all required checks; no prior pass evidence is reused.

## 8. Audit evidence and gate integration

`buildIntegrityReport` continues to construct per-slide events, but its event producer and aggregation are made explicit:

| Event | Producer | Required fields | Failure behavior |
|---|---|---|---|
| `render` | `SlideRenderer`/candidate renderer | run, presentation, slide, source, viewport, artifact | missing artifact is unverified |
| `visual_validation` | `runVisualValidation` | evaluator version, matrix cell, metrics, screenshot | evaluator failure produces no metrics and blocks verified result |
| `audit` | `AuditEngine`/`AuditService` | issue codes, status, report path | missing report blocks save |
| `fix` | auto-fix/regeneration loop | input hash, output hash, fixed rules, recheck result | stale/reused pass is rejected |

`IntegrityEventWriter` receives the same context and writes candidate logs under the run root. It stores hashes/truncated summaries rather than API keys or complete external responses. A failed event write does not erase the report; it changes the operation to `unverified` and blocks verified save.

The four existing structural rules remain registered: `no-required-content-clipping`, `logical-canvas-boundary`, `no-empty-required-text`, and `no-fixed-nested-canvas`. Their scope is required content only; decoration is excluded. Visual results and structural issues are aggregated with structural failures taking precedence.

### 8.1 Repairing the six gate regressions

The implementation must finish with no new gate violations and no growth regression:

1. `packages/audit/src/engine/audit-engine.ts`: extract `runEngine`, `runAutoFixAndReverify`, and `buildAuditContext` helpers to reduce nesting/complexity while keeping engine order and deterministic issue handling unchanged.
2. `packages/audit/src/engines/content-engine/compare-content.ts`: split HTML parsing, Deck parsing, and manifest comparison into small pure helpers; retain exact issue codes and empty-manifest failure behavior.
3. `packages/audit/src/engines/visual-engine/__tests__/presentation-visual-integrity.exploration.ts`: move browser observation/evidence serialization into a test helper module; keep the same expected counterexamples, source hash checks, and unverified semantics.
4. `packages/audit/src/engines/visual-engine/font-icon-check.ts`: move browser-side collection into a plain script/helper and keep classification pure; this also prevents evaluator transpiler helpers from leaking into the browser.
5. `packages/audit/src/engines/visual-engine/index.ts`: extract visual validation orchestration, per-slide metrics, and score calculation into focused modules so the file is no longer larger than its baseline. Preserve public `VisualAuditEngine` and `PerSlideVisualMetrics` exports.
6. `packages/web/src/layouts/EditorLayout.tsx`: extract `EditorPreviewStage`, viewport/pointer helpers, and non-layout editor handlers into adjacent modules. The parent remains responsible for composition and public callbacks; no ESLint suppression or baseline rewrite is allowed.

Use existing baseline rules as-is. Do not change `scripts/refactor/gates.mjs`, `.eslintrc.gates.cjs`, or `baseline/eslint-gates.json` to make the result pass.

## 9. Concrete failure handling and input validation

External/browser input and persistence operations use these rules:

- **HTML/Deck input:** strings are required for text; IDs use the safe-character/length rule; rect values must be finite and inside the logical canvas before responsive conversion. Invalid nodes are fatal in strict candidate generation; historical HTML is `legacy_unverified` with provenance.
- **Viewport input:** width/height must be finite positive integers between 320 and 4096 for the matrix API. Unsupported dimensions return `invalid_viewport`; the harness records a blocked cell rather than substituting another viewport.
- **Browser evaluator:** smoke sentinel and result schema are mandatory before metrics. Failure is recoverable by rerunning in a compatible browser, but is fatal to a verified matrix result. The raw error is logged with run/slide/viewport; no fabricated metrics are returned.
- **Font APIs:** missing `document.fonts`, `check`, canvas measurement, computed style, or representative node data is `unverified`; retry is recoverable, but verified save/export is blocked.
- **Integrity context:** `runId` is `[A-Za-z0-9_-]{1,128}`; presentation ID must match the loaded presentation; candidate/artifact roots must be contained paths; `candidate_only` with no candidate root is fatal. Active write confirmation is required and cannot be inferred from phase.
- **Evidence report:** required pages must equal the candidate’s visible page set; each required matrix cell has an artifact or explicit fail/unverified reason. Missing evidence is `unverified`, not pass.
- **Save/export:** a failed gate returns a stable typed error/result and leaves active files unchanged. HTTP save returns 422; MCP maps it to its existing structured error mechanism; web save retains unsaved state; export returns no silently usable verified Deck.
- **Hash/snapshot:** read, hash, or atomic write failure is fatal to the run; snapshot is retained. Base hash drift rejects promotion and active save rather than overwriting a concurrent change.

## 10. Testability and validation plan

Pure unit/property tests cover contract normalization, metric omission semantics, cover identity, manifest parity, logical transforms, CSS unit conversion, font classification, evidence aggregation, write-policy path validation, and export provenance. Browser integration tests cover real DOM geometry, fonts, screenshots, evaluator smoke, resize, and editor pointer mapping. Server integration tests cover context propagation, HTTP 422 behavior, MCP saves, candidate-only zero active writes, and snapshot/base-hash safety.

Add or update tests in these existing package locations:

- `packages/ai/src/agents/html-presentation/deck/__tests__/slide-contract.test.ts`, `plan-to-deck.test.ts`, `compare-content.test.ts`, `deck-to-html.test.ts`, layout tests, and new cover/metric identity cases.
- `packages/audit/src/engines/content-engine/__tests__/...`, `font-icon-check.test.ts`, visual validation tests, evaluator smoke tests, integrity evidence tests, and the existing exploration helper/test. The exploration test remains a bug-condition characterization and must not be weakened into a happy-path-only test.
- `packages/web/src/layouts/__tests__/EditorLayout.test.tsx`, `useZoom`/viewport-adapter tests, pointer/selection tests, `src/export/__tests__/presentation-to-deck.integrity.integration.test.ts`, and editor save integration tests.
- `packages/server/src/modules/presentation/presentation-integrity.service.test.ts`, presentation controller/service tests, audit integration tests, final-write/auto-audit tests, MCP edit tests, and export/preview contract tests.

Required focused commands after implementation, using Windows `pnpm.cmd`:

```text
pnpm.cmd --filter @noppt/ai exec vitest run src/agents/html-presentation/deck/__tests__/slide-contract.test.ts src/agents/html-presentation/deck/__tests__/plan-to-deck.test.ts src/agents/html-presentation/deck/__tests__/deck-to-html.test.ts
pnpm.cmd --filter @noppt/audit exec vitest run src/engines/visual-engine/font-icon-check.test.ts src/engines/visual-engine/__tests__/presentation-visual-integrity.exploration.test.ts src/engines/visual-engine/__tests__/presentation-visual-integrity.visual.test.ts src/engine/integrity-evidence.test.ts
pnpm.cmd --filter @noppt/web exec vitest run src/layouts src/hooks/useZoom.test.ts src/export/__tests__/presentation-to-deck.integrity.integration.test.ts
pnpm.cmd --filter @noppt/server exec vitest run src/modules/presentation src/modules/audit src/modules/mcp
pnpm.cmd typecheck
pnpm.cmd gates:check
```

Run the real browser harness against an isolated candidate artifact, not the protected presentation directory. The harness must produce the complete five-page matrix and reverse-resize evidence before the report can claim pass. Run the relevant package builds/tests as required by the actual package scripts; if Chromium, fonts, or live external Hermes are unavailable, record exact `unverified` evidence. Do not relabel Task 13’s previous fail or Task 16’s evaluator failure as a pass.

The final report `.agents/tasks/presentation-visual-integrity-fix-validation-2026-10-06.md` must list changed files, exact commands and statuses, focused and full checks, complete matrix cells and resize results, evaluator/font limitations, integrity/write-policy coverage, protected input hashes before/after, candidate artifact paths, `candidateUnpromoted=true`, `promotionAttempted=false`, and each remaining failed/unverified criterion. If any criterion remains failed or unverified, the report must explicitly say the candidate is not releasable.

## 11. Implementation sequence and dependency order

1. Add core integrity/transform/provenance types and tests; no callers change until the contract compiles.
2. Complete strict typed content, cover identities, metric omission semantics, and Deck manifest production; update AI unit/property tests.
3. Convert canonical HTML to consistent container-relative logical units and fix title/body/card measured layouts; update HTML snapshots and geometry tests.
4. Fix `SlideRenderer` evaluator scripts and smoke gate; integrate rich font evidence and update visual validation status aggregation.
5. Extract the editor preview stage and apply the shared transform to zoom, pointer, selection, and reverse resize; run editor tests.
6. Add manifest parity/export `exportWithIntegrity`, then route PPTX/deck callers through it while preserving explicit HTML fallback downgrade.
7. Thread `IntegrityRunContext` through server save, final-write, auto-audit, audit report, MCP edit, preview, and export paths; implement `saveSlideWithIntegrity`; remove active fallbacks for candidate runs.
8. Repair the six named gate regressions through extraction, not rule weakening.
9. Run focused tests, typecheck, gates, affected builds, isolated candidate validation, hash verification, and final report. Never call promotion.

Dependencies are one-way: core contracts before AI/web/server adapters; AI identities/layout before parity; evaluator before browser matrix; context/store before production write enforcement; all code before final validation. No step changes protected target inputs.

## 12. Acceptance mapping and explicit non-goals

This design directly addresses evaluator smoke (requirements 1.1–1.4), all five responsive pages and reverse resize (2.1–2.9), cover identity/parity (3.1–3.3), typed/structured page-3 metrics (4.1–4.4), pre-save integrity and candidate-only writes (5.1–5.6), observable font evidence (6.1–6.3), and the six gates/tests/report (7.1–7.5). It preserves historical HTML/Deck reads, `htmlToDeck` fallback, sanitization, editor interactions, content facts, page count/order, theme intent, and the Hermes auto-only config boundary.

It does not redesign unrelated page types, change source facts, delete or hide required content, change package architecture, install fonts/dependencies, modify the protected runtime presentation, invoke generation tools, perform promotion, or use static/unit results as a substitute for the real browser matrix.

No design-review file exists in the current run directory (`.agents/pipeline/2026-10-06_16-26-25`), so there are no current-run review findings to resolve. The design nevertheless incorporates the prior audit’s concrete gaps: explicit compare count semantics, structured metric omissions, typed transforms, strict unverified aggregation, per-slide provenance, atomic editor save gating, one export boundary, producer wiring for evidence events, and candidate-only write enforcement.
