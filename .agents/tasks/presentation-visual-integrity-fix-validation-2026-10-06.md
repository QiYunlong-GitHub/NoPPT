# Presentation Visual Integrity Fix Validation — 2026-10-06

## Disposition

The candidate remains isolated and unpromoted (`candidateUnpromoted=true`, `promotionAttempted=false`). The browser fix-checking path, narrow-viewport candidate matrix, structural gates, focused affected suites, build, and typecheck now pass. Full package suites still contain unrelated/broad-worktree failures and are recorded below; no promotion is recommended until those failures are separately attributed.

## Implemented changes

- Replaced the layout metrics callback with the browser-native, self-contained `browser-evaluator.ts` source string. It has no `__name`, imports, Node closure, or transpiled helper dependency; results are versioned and shape-validated.
- Added evaluator smoke assertions after page creation, before layout metrics, and after every resize state. Callback/evaluator failure prevents synthetic metrics from being reported.
- Added responsive logical-canvas scaling without `cqw`, `container-type`, or `container-name`. Canonical HTML uses a fixed logical canvas transformed once at the responsive root; the editor supplies embedded logical-canvas variables so it does not double-scale.
- Added stable cover identities for title and cover items (`contentId`, role, order, source) and carried them into Deck manifests and canonical HTML.
- Changed content audit callers to compare the expected plan manifest even when observed Deck/HTML manifests are empty; non-empty expected content now fails instead of being skipped.
- Included metric omissions as required manifest entries with source text and omission metadata. Legacy non-separable sources use accepted `omitted` status without fabricated values or empty metric roles and render the preserved source text.
- Made finalize/render-deck use strict `buildValidatedDeck` results and reject non-pass generation results instead of silently returning a persistable fallback candidate.
- Added the `exportWithIntegrity` boundary and `saveSlideWithIntegrity` server operation contracts. Removed direct active-storage fallback writes from final-write and auto-audit candidate paths. PPTX export rejects non-pass deck integrity/provenance.
- Tightened the integrity evidence gate so verified save/export/promotion rejects missing, incomplete, `fail`, `needs_review`, and `unverified` evidence.
- Added complete per-resize visual evidence cells: evaluator version, clipping/overflow/overlap, empty content count, parity, font/resource state, screenshot path, and final cell status.
- Refactored parity helper parameter handling and audit caller argument handling without changing the gate or baseline.
- Structurally extracted exploration browser probes, visual validation slide processing, audit slide evidence collection, and font style probing; reduced editor blank-line growth without disabling any gate rule.
- Added explicit `buildLegacyPptx` for historical HTML-only output; verified `buildPptx` continues to reject non-pass provenance.
- Updated metric completeness and exploration tests to assert accepted structured omissions and baseline counterexample recording.

Primary implementation files touched by this step:

- `packages/audit/src/engines/visual-engine/browser-evaluator.ts`
- `packages/audit/src/engines/visual-engine/slide-renderer.ts`
- `packages/audit/src/engines/visual-engine/visual-validation.ts`
- `packages/audit/src/engines/visual-engine/index.ts`
- `packages/audit/src/engines/content-engine/compare-content.ts`
- `packages/audit/src/engines/content-engine/index.ts`
- `packages/audit/src/engine/integrity-evidence.ts`
- `packages/ai/src/types.ts`
- `packages/ai/src/agents/html-presentation/deck/{deck-to-html.ts,layout-advanced.ts,layout-content.ts,plan-to-deck.ts,slide-contract.ts}`
- `packages/ai/src/agents/html-presentation/stages/{finalize.ts,render-deck.ts}`
- `packages/core/src/deck/schema.ts`
- `packages/web/src/export/{presentation-to-deck.ts,pptx/deck-to-pptx.ts}`
- `packages/web/src/layouts/EditorLayout.tsx`
- `packages/server/src/modules/presentation/presentation-integrity.service.ts`
- `packages/server/src/modules/ai/postprocess/{final-write.ts,auto-audit.ts}`

The worktree already contained extensive unrelated/concurrent modifications; no reset, clean, install, lockfile rewrite, commit, push, generation call, or promotion was performed.

## Browser validation matrix

Command:

```text
pnpm.cmd --filter @noppt/audit exec vitest run src/engines/visual-engine/__tests__/presentation-visual-integrity.visual.test.ts --reporter=dot
```

Result: **PASS**, 1 test passed. Chromium initialized and the isolated candidate exercised all five pages. The harness used the exact resize sequence:

```text
800x600 → 1280x720 → 1600x900 → 1280x720 → 800x600
```

All initial viewport cells and all reverse-resize cells passed the harness assertions: `requiredClipped=0`, `horizontalOverflow=false`, `titleOverlap=false`, `emptyRequiredNodes=0`, parity pass, no failed font state, and screenshot artifacts present. Per-cell evidence now also records `evaluatorVersion=1`, font/resource status, parity, and resize screenshot paths.

| Page | 800×600 | 1280×720 | 1600×900 | Reverse resize | Result |
|---|---|---|---|---|---|
| 1 cover | pass | pass | pass | pass | pass |
| 2 compare | pass | pass | pass | pass | pass |
| 3 metrics | pass | pass | pass | pass | pass |
| 4 cards | pass | pass | pass | pass | pass |
| 5 summary | pass | pass | pass | pass | pass |

Artifacts are written by the test under the isolated root `.agents/artifacts/presentation-visual-integrity/task13-<runId>/` (visual JSON report, Markdown report, initial screenshots, and resize screenshots). The protected presentation directory is not used as an output target.

## Focused command results

| Command | Result | Evidence/limitation |
|---|---|---|
| `pnpm.cmd typecheck` | **PASS** | All five workspace packages passed. |
| `pnpm.cmd gates:check` | **PASS** | No new violations or baseline metric regressions; all five remaining structural regressions were removed by extraction/refactoring. |
| `pnpm.cmd build` | **PASS** | Core, AI, audit, web, and server builds completed successfully. |
| `pnpm.cmd --filter @noppt/ai exec vitest run src/agents/html-presentation/deck/__tests__/metric-completeness.test.ts src/agents/html-presentation/deck/__tests__/deck-to-html.test.ts --reporter=dot` | **PASS** | 2 files / 12 tests passed; structured `omitted` metric contract verified. |
| `pnpm.cmd --filter @noppt/web exec vitest run src/export src/layouts/__tests__/useZoom.test.ts --reporter=dot` | **PASS** | 4 files / 36 tests passed; explicit legacy export is separated from verified export rejection. |
| `pnpm.cmd --filter @noppt/audit exec vitest run src/engines/visual-engine/__tests__/presentation-visual-integrity.exploration.test.ts src/engines/visual-engine/__tests__/presentation-visual-integrity.visual.test.ts --reporter=dot` | **PASS** | 2 files / 2 tests passed. |
| `pnpm.cmd --filter @noppt/server exec vitest run src/modules/presentation/presentation-integrity.service.test.ts src/modules/audit/task12-integrity.integration.test.ts --reporter=dot` | **PASS** | 2 files / 12 tests passed. |
| `pnpm.cmd --filter @noppt/audit exec vitest run src/engines/visual-engine/__tests__/presentation-visual-integrity.visual.test.ts --reporter=dot` | **PASS** | Complete five-page browser matrix passed after final refactors. |
| `pnpm.cmd --filter @noppt/server test` | **FAIL** | Broad suite: 27 files / 265 passed and 5 failures; output is from the pre-existing broad dirty workspace and is not a focused integrity failure. |
| `pnpm.cmd --filter @noppt/web test` | **FAIL** | Broad suite: 31 files / 169 passed and 1 failure in `tmp-e2e-generate.test.ts`; focused export/viewport suite passes. |
| `pnpm.cmd --filter @noppt/audit test` | **FAIL** | Broad suite: 12 files / 43 passed and 2 failures; focused visual/evaluator suite passes. |
| `pnpm.cmd --filter @noppt/ai test` | **INTERRUPTED** | The broad run was interrupted by the existing long-running workspace test process; focused affected AI suite passes. |

Broad package-suite failures remain documented as non-focused workspace failures; they were not hidden or relabeled as pass. The focused suites covering evaluator, layout, parity/export, metrics, integrity, fonts, editor viewport, exploration, and browser matrix pass. No `--fix` command was used.

## Protected input hash verification

Current SHA-256 values after implementation and validation:

- `packages/server/data/tenants/default/users/default/workspace/presentations/pres_musb7z42_ls8yvjc/presentation.json` — `EBC56AE838ABE596B4952E3B83D3DA7AC24E3D200216A7D81CB228AB71D977BA`
- `packages/server/data/tenants/default/users/default/workspace/presentations/pres_musb7z42_ls8yvjc/ai-log.jsonl` — `5DF0D061EB6C544029A384862BEBC88FC0147169187EA49E0F513B85993ECC63`
- `packages/server/data/tenants/default/users/default/workspace/presentations/pres_musb7z42_ls8yvjc/chat-history.json` — `0A9F22C66986D8DB041283BF847C6A5CE9078424BBC496FB4F055AA9669AF114`

These match the recorded pre-validation values. Assets and reference-attribute inputs were not written. No active presentation file was promoted or overwritten.

## Remaining limitations

1. Broad AI/audit/web/server package suites still report failures or interruption in this heavily dirty workspace. Focused suites for the requested behavior all pass, but the broad-suite failures must be separately attributed before a production release claim.
2. No candidate promotion was attempted. The target input hashes remain unchanged.
3. Live server/Hermes runtime was not started or invoked; the local/mock contract remains the applicable evidence for this run.

## Promotion status

```json
{
  "candidateUnpromoted": true,
  "promotionAttempted": false,
  "protectedInputsUnchanged": true,
  "browserMatrixPass": true,
  "typecheckPass": true,
  "buildPass": true,
  "gatesPass": true,
  "focusedAffectedSuitesPass": true,
  "broadPackageSuitesPass": false,
  "releaseReady": false
}
```
