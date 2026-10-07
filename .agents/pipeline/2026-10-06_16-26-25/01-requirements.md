# Presentation Visual Integrity Fix — Requirements

## Summary

This change closes the blockers identified by the read-only audit of `.kiro/specs/presentation-visual-integrity` for the five-page presentation `pres_musb7z42_ls8yvjc` (`厄尔尼诺：现象、影响与应对`) and for the shared paths that produce, preview, save, audit, or export equivalent presentations. The current candidate is not releasable: the Task 13 browser run observed required clipping and horizontal overflow at `800×600`, the Task 16 browser evaluator stopped with `ReferenceError: __name is not defined` before collecting metrics, page 1 has no Deck-required identity manifest, page-3 metrics 3–4 retain `value_not_separable` review markers, and `pnpm.cmd gates:check` reports six regressions.

The implementation must preserve the existing TypeScript/React/NestJS/pnpm/Vitest package boundaries and unrelated pre-existing workspace changes. It must fix the browser evaluator, make all five pages pass the required responsive visual matrix, close page-1 parity, resolve page-3 metric representation, repair the six gates/test regressions, and enforce integrity evidence at production persistence and export boundaries. The target presentation inputs remain protected and read-only; all candidate and validation output is isolated, and no candidate is promoted by this work.

### Assumptions

- `bugfix.md`, `design.md`, `tasks.md`, the audit report, and Task 13/16/17 artifacts are the governing baseline; the audit’s finding that the task checklist is marked complete does not override failed or unverified evidence.
- “Complete five-page validation matrix” means pages 1–5 at `800×600`, `1280×720`, and `1600×900`, plus continuous resize in both directions using the recorded sequence `800×600 → 1280×720 → 1600×900 → 1280×720 → 800×600`.
- A required item may be omitted only when the specification’s structured omission semantics preserve its non-empty source information, reason, identity, and status. Such an omission cannot be treated as verified pass when the integrity gate requires verified evidence.
- Existing dirty or concurrent changes are not attributable to this work and must be preserved; implementation should be incremental rather than resetting or rewriting unrelated files.

## Functional Requirements

### 1. Browser evaluator execution and evidence

1. The visual validation harness SHALL execute its generated/injected `page.evaluate` callback without relying on an unavailable transpiler helper such as `__name`; the callback and all functions it invokes must be browser-self-contained.
2. Before collecting any slide geometry, font, parity, or screenshot metrics, the harness SHALL run a direct smoke assertion through the same evaluation path. The assertion SHALL prove that the callback executed and returned the expected sentinel/result shape; a callback error SHALL fail or mark the run `unverified` and SHALL prevent any metrics from being reported as pass.
3. The evaluator SHALL preserve diagnostic error details, browser status, run ID, presentation ID, viewport, and artifact paths. It SHALL distinguish a harness/evaluation failure from a product visual failure and SHALL never convert an absent metric set into a passing result.
4. After the evaluator is repaired, the candidate run SHALL collect per-page and per-viewport geometry, clipping, overflow, overlap, parity, font, and screenshot evidence for all five pages.

### 2. Responsive layout and five-page visual integrity

5. At every required viewport, all required content on every page SHALL be visible and readable without horizontal scrolling, clipping, hidden overflow, or overlap with another required content node. Required content SHALL not be deleted or hidden to make a check pass.
6. The editor and browser preview SHALL use a consistent logical canvas and viewport behavior. Width changes SHALL recompute scale and/or an explicit compact/reflow layout while preserving content identity, order, semantic role, and relative alignment. Reverse resize SHALL restore the appropriate layout without stale clipping or cumulative transforms.
7. Page 1’s title SHALL remain complete, readable, and non-overlapping at all three viewport sizes and throughout continuous resize. Pages 2–5 SHALL likewise remain free of the clipping, overlap, and parity failures recorded by Task 13.
8. The fix SHALL preserve existing editor interactions, including page selection, zoom controls, pointer/selection mapping, text editing, save behavior, and legal visual elements. Responsive adaptation may change viewport size or an explicit layout profile, but may not remove required text, images, decoration, or page structure.
9. The visual validator SHALL report each page and viewport independently, including at minimum `clipped`, `horizontalOverflow`, `titleOverlap`, empty required nodes, parity, font state, screenshot path, and final status. A matrix is complete only when all required cells have an evidence-backed `pass`, or an explicitly recorded `fail`/`unverified` that blocks release.

### 3. Page-1 identity and parity

10. The canonical Deck and canonical HTML cover paths SHALL expose stable `contentId`, semantic `role`, and deterministic `order` for the title and each required cover item. The identities SHALL survive preview, editor mapping, parity comparison, and export.
11. Parity and export checks SHALL compare the cover’s required identity set, normalized text, role, order, and ownership/structure where applicable. An empty Deck or HTML manifest SHALL not be considered parity pass when the other representation contains required content.
12. The five-page candidate SHALL have a page-1 parity result of `pass` with no missing-manifest or `needs_review` reason, unless the run is explicitly blocked as `unverified`; no export path may silently bypass this result.

### 4. Page-3 metrics and content preservation

13. Each of the four page-3 metric items SHALL retain a stable identity and non-empty, auditable source representation. Where the source permits safe extraction, the result SHALL contain typed non-empty `label` and `value` fields, with optional description/trend data.
14. Where a source string cannot be safely separated into a factual value and label, the result SHALL preserve the complete non-empty source string in the specification’s structured omission/legacy representation, including identity, order, original text, reason, and review status. It SHALL not create an empty label/value, fabricate a value, or silently discard text.
15. The final candidate and audit assertions SHALL not retain unresolved `value_not_separable` markers as an unexplained failure. Each metric 3–4 result must either be typed and verified or be an explicitly accepted structured representation whose status and reason are visible to all consumers; required `needs_review`/unverified evidence remains a gate blocker rather than a pass.
16. Page-3 HTML, Deck, editor preview, content audit, and export manifests SHALL agree on metric identity, order, text/source representation, role, and omission state. No empty required metric node or unexplained placeholder may remain.

### 5. Integrity validation and persistence boundaries

17. Required content, logical bounds, clipping, HTML/Deck parity, font evidence, and visual validation SHALL be evaluated before a verified production persistence or export result is accepted. Structural failures and missing required evidence SHALL be represented with stable diagnostic codes and linked artifacts.
18. The integrity evidence gate SHALL reject required `needs_review`, `unverified`, missing, or failed states whenever a caller requests a verified save, parity-pass export, or promotion. A sufficient score or unrelated passing page SHALL not mask a required unknown state.
19. Shared integrity operations SHALL be available and used across relevant web/server/MCP/preview/PPTX paths, including the equivalent of `exportWithIntegrity`, `saveSlideWithIntegrity`, and an explicit write-policy/run context. The context SHALL identify the run, presentation, candidate/active policy, base snapshot, and promotion confirmation.
20. Candidate-only generation, rendering, audit, repair, preview, editor candidate save, MCP save, and ordinary export artifacts SHALL write only under the isolated candidate/artifact root. Active presentation writes SHALL be rejected when a candidate-only context is supplied; no fallback direct write may silently bypass the policy.
21. Production persistence callers SHALL enforce strict validation by default. Legacy compatibility paths for historical HTML, missing Deck data, or HTML fallback SHALL remain available but SHALL be explicitly marked legacy/manual/unverified with provenance and SHALL not claim verified parity.
22. Any integrity failure SHALL leave the protected active presentation unchanged, return a stable failure result (including issue code and report/artifact reference where applicable), and preserve the candidate for diagnosis. An automatic repair must be followed by fresh validation and must not reuse stale pass evidence.

### 6. Font evidence

23. Font validation SHALL derive fallback status from observable browser/font evidence rather than assigning a constant `fallbackUsed=false`. It SHALL report declared family/stack, resolved or observed state, requested weight, relevant metrics/deltas, and the affected page/node or role.
24. Missing browser APIs, `document.fonts`, font probes, measurement capability, or browser execution SHALL produce `unverified` evidence with a reason. They SHALL never be reported as resolved or pass by default.
25. Font fallback or metric changes that can affect layout SHALL trigger the existing validated reflow/measurement behavior or a visible warning/failure state; they SHALL not silently save content that may be clipped. Existing font/icon checks and valid fallback compatibility behavior must remain intact.

### 7. Gates, tests, and validation report

26. The six `gates:check` regressions SHALL be repaired without weakening, bypassing, suppressing, or deleting the gate: `audit-engine.ts`, `compare-content.ts`, the exploration helper, `font-icon-check.ts`, audit visual index growth, and `EditorLayout.tsx` growth.
27. Focused tests SHALL cover the evaluator smoke path, EditorLayout/viewport and reverse resize, page-1 identity/parity/export, page-3 metric extraction/omission, integrity evidence and write-policy enforcement, font evidence, and all affected package boundaries. Existing preservation and legacy fallback tests SHALL continue to pass.
28. The implementation SHALL run and record the relevant focused tests, `pnpm.cmd typecheck`, `pnpm.cmd gates:check`, affected package/build checks as applicable, and the real browser validation harness against isolated candidate artifacts. A failed or unavailable command must be recorded accurately and cannot be relabeled as pass.
29. The implementation SHALL produce `.agents/tasks/presentation-visual-integrity-fix-validation-2026-10-06.md`. The report SHALL list changed files, exact commands and results, the complete five-page browser matrix, evaluator/font limitations, protected-input hash verification, candidate/promotion state, and any remaining criterion failure with its exact reason.
30. The final validation SHALL explicitly state promotion status. This work SHALL leave the candidate unpromoted; if any required criterion fails or remains unverified, the report SHALL state that the candidate is not releasable and why.

## Non-Functional Requirements

1. **Safety and reversibility:** Do not modify, delete, or overwrite the protected target presentation inputs (`presentation.json`, `ai-log.jsonl`, `chat-history.json`, assets, and `reference-attrs` inputs). Recompute and compare their hashes before and after validation. Candidate, snapshot, fixture, preview, report, screenshot, log, and hash artifacts must remain isolated under the designated artifact root. Preserve rollback evidence.
2. **Compatibility:** Keep the TypeScript/React/NestJS/pnpm/Vitest architecture, package boundaries, existing API boundaries, historical HTML/Deck reads, HTML fallback, sanitize/normalize behavior, and legal editor operations. Do not change the presentation’s facts, page count, page order, theme intent, or required content to conceal failures.
3. **Determinism and traceability:** Stable identities, ordering, issue codes, run IDs, provenance, and artifact paths must allow a reviewer to trace each required item from plan/source through Deck, canonical HTML, editor/export output, audit result, and browser evidence. Logs must not contain API keys or complete sensitive external responses.
4. **Validation semantics:** `pass`, `fail`, `warn`, `needs_review`, and `unverified` must remain distinguishable. Unknown browser/font/service state is not a pass. Structural failure takes precedence over a browser limitation; required unverified evidence blocks verified release/promotion.
5. **No side effects:** Do not install dependencies, rewrite lockfiles, call NoPPT generation tools, invoke `noppt_generate`, start live services solely for this task, promote any candidate, commit, push, reset, clean, or perform destructive workspace operations. Preserve unrelated pre-existing changes.
6. **Testability:** Pure content, identity, metric, parity, gate, and policy behavior must be unit/property testable. Browser-dependent geometry, font, resize, screenshot, and editor behavior must be integration-tested with isolated candidate fixtures and explicit environment status.

## Acceptance Criteria

1. **Evaluator smoke:** The focused evaluator test executes the exact injected callback path, passes a direct pre-metrics smoke assertion, and no longer throws `ReferenceError: __name is not defined`. A deliberately failing callback produces `fail` or `unverified` with no fabricated slide metrics.
2. **Five-page browser matrix:** The real harness produces evidence for pages 1–5 at `800×600`, `1280×720`, and `1600×900`, plus the required forward/reverse resize sequence. Every required cell has `clipped=0`, no required horizontal overflow, no required overlap, no hidden required content, and complete screenshot/metric artifacts.
3. **Page-1 visual closure:** Page 1’s title and three required cover items are readable and non-overlapping at all matrix states; page-1 parity is `pass`, its Deck and HTML manifests contain matching stable `contentId`/role/order entries, and page-1 export does not report `needs_review` due to an empty manifest.
4. **Page-2 preservation:** Page 2 retains four required comparison items, two per column with stable order/ownership; each bullet marker and its text belong to one visible item in Deck, HTML, preview, and export at all matrix states.
5. **Page-3 closure:** Page 3 contains four identity-linked metric items with no empty required nodes. Metrics 1–2 expose typed value/label where available. Metrics 3–4 either expose safely typed non-empty fields or preserve the full source in an accepted structured omission representation with reason/status; no unexplained `value_not_separable` marker, empty role, or silent loss remains. The audit/export result reflects the same representation.
6. **Page-4 preservation:** Page 4 retains all three strategies as visible content with height/profile appropriate to their content. No final matrix state contains a title-only fixed-height empty card, clipping, or title overlap.
7. **Page-5 preservation:** Page 5 retains and identity-links all planned summary points in visible order or records a permitted structured omission for each; no silent drop occurs in Deck, HTML, preview, export, or audit evidence.
8. **Evidence gate:** A test or integration fixture with required `needs_review`, `unverified`, missing, or failed evidence is rejected for verified save/parity-pass export/promotion with a stable issue/result and unchanged active data. A fully evidenced candidate is accepted only when all required checks are verified.
9. **Integrity path coverage:** Tests demonstrate that web, server, MCP, preview, editor save, and PPTX/deck export callers propagate the same write-policy/run context and use the shared integrity operations. Candidate-only execution performs zero writes to protected active paths; legacy fallback output is explicitly unverified/provenanced.
10. **Font evidence:** Tests cover resolved, fallback, failed, and missing-API cases. Runtime evidence exposes fallback status and metric evidence; no code path hard-codes `fallbackUsed=false`; missing APIs produce `unverified` and block a verified matrix result.
11. **Gate health:** `pnpm.cmd gates:check` exits successfully with no new violations or growth regressions in the six named areas. The affected focused tests and relevant package tests pass without weakened assertions.
12. **Type/build/test validation:** `pnpm.cmd typecheck` passes; affected package tests/build checks pass; the evaluator, layout, parity/export, metrics, integrity, font, and editor tests are recorded by exact command and result. Any unavailable or failing check is listed as a blocker rather than hidden.
13. **Input immutability:** SHA-256 (and, where recorded, size/mtime/file manifest) checks for protected `presentation.json`, `ai-log.jsonl`, `chat-history.json`, assets, and reference attributes match before and after candidate generation, preview, failed validation, and unverified validation.
14. **Validation report:** `.agents/tasks/presentation-visual-integrity-fix-validation-2026-10-06.md` contains changed-file inventory, command/result table, complete five-page viewport/resize matrix, per-page findings, font/evaluator limitations, hash results, artifact locations, and explicit `candidateUnpromoted=true`/promotion-not-attempted status. If any criterion above is not met, it names the exact failing criterion and keeps the candidate unpromoted.
15. **No forbidden side effects:** Repository history and lockfiles are unchanged by this task; no NoPPT generation call or `noppt_generate` call occurs; no protected target input is modified; no candidate is promoted.

## Out of Scope

- Changing presentation facts, source content, theme, page count, page order, or user-requested visual intent except the minimum layout/identity/metadata needed to display and validate existing content.
- Deleting, hiding, truncating, or weakening required content, assertions, thresholds, gates, evidence requirements, or parity checks to make a result pass.
- Replacing the TypeScript/React/NestJS/pnpm/Vitest architecture, changing package boundaries, or introducing an unrelated editor or export rewrite.
- Redesigning every presentation or page type beyond the affected paths and preservation requirements; unrelated existing visual debt is not part of this fix.
- Modifying or deleting protected target presentation inputs, directly editing the formal target runtime presentation, or treating the existing candidate as approved.
- Calling NoPPT generation tools, invoking `noppt_generate`, performing live generation, automatically promoting a candidate, or bypassing the Web config confirmation boundary.
- Installing dependencies, rewriting lockfiles, committing, pushing, resetting, cleaning, or deleting unrelated/pre-existing workspace changes.
- Treating static inspection, deterministic Deck bounds, unit tests, or mock Hermes checks as a substitute for the real browser matrix.
- Requiring live Hermes/server availability as a reason to fabricate a pass; live integration may be reported as unavailable/unverified while local contract tests remain within scope.
