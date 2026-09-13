<div align="center">

# NoPPT

**Open-source, Gamma-style card presentation platform — generate slide decks with AI and export to HTML / PDF / PNG.**

[English](./README.md) · [简体中文](./README_CN.md)

</div>

---

NoPPT is an open-source alternative to Gamma / SlidesAI. Describe your topic (or supply reference
material) and NoPPT plans a structured deck, then renders self-contained, interactive HTML slides with
a card-style design system. It runs as a monorepo: a **React + Vite** editor and a **NestJS** backend
that orchestrates LLM providers (OpenAI / Anthropic / Ollama / Free.ai / v0 by Vercel).

## ✨ Features

- **AI deck generation** — topic → structured plan → interactive HTML slides, with optional reference
  HTML / image / text as grounding material.
- **Card-style design system** — consistent, responsive cards, theming, icon sets, and dense / compact
  layouts.
- **Full editor** — drag-and-drop canvas, element inspector, slide list, AI chat assistant, live preview.
- **Multi-language UI** — switch between **Simplified Chinese** and **English** from Settings → Interface;
  the language is persisted to the server config and also drives the language of generated content and
  server messages.
- **Flexible export** — single-file HTML, ZIP of static web assets, PDF, and PNG sequences.
- **Extensible model routing** — configure multiple providers per stage (planning / content / editing),
  with high-contrast and audit modes.
- **MCP server for AI agents** — 8 `noppt_*` tools let any MCP-compatible client (Hermes, Claude
  Desktop, …) generate, edit, export and preview decks programmatically.
- **Private & self-hostable** — all data lives under `packages/server/data/`; no cloud lock-in.

## 🧱 Tech Stack

| Layer | Technology |
| ----- | ---------- |
| Frontend | React 18 · TypeScript · Vite 5 · Zustand 4 · Immer · TailwindCSS 3 · React Router 6 |
| Backend | NestJS · TypeScript · Express |
| AI | OpenAI · Anthropic · Ollama · Free.ai · v0 by Vercel |
| Agent protocol | MCP (Model Context Protocol) · Streamable HTTP · JSON-RPC 2.0 |
| Export | html2canvas · jsPDF · JSZip |
| Test | Vitest · React Testing Library |
| Tooling | ESLint · Prettier |

## 📂 Project Structure

```
packages/
├── core/      # Shared domain types and utilities (@noppt/core)
├── ai/        # AI agent orchestration (@noppt/ai): planning, HTML slide generation, audit
├── audit/     # Visual / content self-audit engine (@noppt/audit)
├── server/    # NestJS backend (MCP + REST) (@noppt/server)
└── web/       # React editor and presentation viewer (@noppt/web)
```

## 🛡️ AI Quality Assurance (Inline Review · LLM / VLM Review · Auto-Regeneration · Auto-Fix)

NoPPT doesn't just generate slides — it verifies them. Two layers of checking wrap the generation pipeline,
both configurable under **Settings → AI Model → AI Audit Settings** and **AI Inline Self-Check Settings**.

### Inline review (per-slide, during generation)
Controlled by `inlineSelfCheckSettings`. As each slide is produced, NoPPT runs two immediate checks before
moving on:

- **LLM critique** (`llmCritique`) — reviews the slide copy for quality, typos, and semantic duplication.
- **VLM placeholder check** (`vlmPlaceholder`) — renders the slide and uses a vision model (VLM) to catch
  failed AI-image placeholders / obvious layout breakage.

When a slide's issue count exceeds `threshold` (default 7), it is **auto-regenerated in place**, up to
`maxRetries` (default 1) times — no user action required.

### Post-generation multi-engine audit (LLM + VLM review)
Controlled by `auditSettings`. After the full deck is assembled, the `@noppt/audit` engine runs four
sub-engines — `layout`, `visual`, `content`, `fidelity` (plus `sanitization`) — driven by:

- **LLM review** (`llmReview`) — an LLM grades content quality / correctness.
- **VLM review** (`vlmReview`) — a vision model screenshots each slide and grades the visual design / layout.

The combined score is gated against `thresholds.pass` / `thresholds.warn`. Strictness presets
(`strict` / `normal` / `relaxed`) tune the pass thresholds to 80 / 70 / 50.

### Auto-regeneration
When the audit still finds blocking issues that can't be auto-fixed, NoPPT **auto-regenerates** the affected
slide(s), feeding the LLM / VLM feedback back into the generator, up to `maxRegenerationRetries` (default 1)
times, then keeps the best-scoring version.

### Automatic post-processing fix
Controlled by `autoFix` (default `true`). Layout / style issues flagged as `fixable` are patched directly by
the `AutoFixer` (deterministic HTML / CSS transforms — e.g. fixing icon spans, overflow, contrast) and then
re-verified. Issues that can't be auto-fixed fall through to the auto-regeneration path above.

### Configuration

```jsonc
// packages/server/data/config.json
"auditSettings": {
  "enabled": true, "strictness": "normal",
  "autoFix": true,              // automatic post-processing fix
  "maxRegenerationRetries": 1,  // auto-regeneration ceiling
  "llmReview": true,            // LLM review
  "vlmReview": true,            // VLM review
  "engines": { "layout": true, "visual": true, "content": true, "fidelity": true, "sanitization": true }
},
"inlineSelfCheckSettings": {
  "enabled": true, "llmCritique": true, "vlmPlaceholder": true,
  "maxRetries": 1, "threshold": 7       // per-slide auto-regeneration
}
```

Requires an `audit` (text) and `auditVlm` (vision) model routed under **Settings → AI Model**; if a model is
missing, that review stage is skipped with a warning rather than failing the run.

## 🚀 Quick Start

Requirements: **Node ≥ 18.17.0**, **pnpm ≥ 8.0.0**.

```bash
# 1. Install dependencies
pnpm install

# 2. Start both frontend (5173) and backend (3001) in dev
pnpm dev:all

# Or run them separately
pnpm dev          # frontend only (http://localhost:5173)
pnpm dev:server   # backend only (http://localhost:3001)
```

Open http://localhost:5173. Configure a model provider under **Settings → AI Model** before generating.

### Build & Production

```bash
pnpm build         # build all packages
pnpm build:web     # build frontend only
pnpm build:server  # build backend only
pnpm start:server  # run the built backend (PORT=3001 by default)
```

### Scripts

| Script | Description |
| ------ | ----------- |
| `pnpm dev` / `dev:server` / `dev:all` | Dev servers |
| `pnpm build` / `build:web` / `build:server` | Production builds |
| `pnpm preview` | Preview the built frontend |
| `pnpm lint` / `lint:fix` | ESLint |
| `pnpm typecheck` | TypeScript type check |
| `pnpm test` / `test:ui` | Vitest |
| `pnpm format` / `format:check` | Prettier |

## 🌐 Internationalization (i18n)

- **UI language** is controlled in **Settings → Interface → Interface language** (`zh-CN` / `en`).
  It is persisted to `data/config.json` and also sent via the `Accept-Language` header, so server-side
  error messages follow the same setting.
- **Generation language** can be set independently per generation in the AI generate dialog (defaults to
  following the interface language). It is forwarded to the AI agents so the generated slide copy is
  produced in the chosen language.
- The frontend uses a lightweight, dependency-free dictionary (`packages/web/src/i18n/`); the backend
  keeps a parallel message catalog (`packages/server/src/i18n/`).

## 🔌 MCP Server & AI Agent Integration

NoPPT ships a built-in **MCP (Model Context Protocol) server**, so MCP-compatible agents (Hermes,
Claude Desktop, or your own client) can drive the whole deck lifecycle — generate → poll → edit →
export → preview — purely through tool calls.

| Item | Value |
| ---- | ----- |
| Endpoint | `POST http://localhost:3001/api/mcp` |
| Transport | MCP **Streamable HTTP**, **stateless** (no session), JSON-RPC 2.0 |
| Auth | `Authorization: Bearer nppt_<32-hex>` — each key is scoped to a `tenantId/userKey` |
| Async model | Calls enqueue a job and return `jobId`; `wait=true` blocks up to 60s, otherwise poll |
| Read-only preview | `GET /api/mcp-view/:tenant/:user/:presentationId`, plus the Web route `/mcp-preview/...` |

### Tools (8)

| Tool | What it does |
| ---- | ------------ |
| `noppt_generate` | Generate a deck from `topic` (optional `referenceText` / `referenceHtml` / `referenceImage`, `slideCount`, `style`, `audience`, `colorTheme`, `imageEnabled`). |
| `noppt_get_presentation` | Poll any job by `jobId` — shared by generation and all three edit tools. |
| `noppt_edit_slide` | Rewrite a whole slide (`slideIndex` + `userRequest`). |
| `noppt_edit_element` | Edit a single element precisely by `elementIndex` / `selector`. |
| `noppt_edit_global` | Deck-wide edit (palette, fonts, slide count). |
| `noppt_export_html` | Return self-contained HTML (assets inlined as data URLs). |
| `noppt_list_templates` | List available styles, colour themes and built-in templates. |
| `noppt_prepare_outline_draft` | **Stage material without generating** — saves a draft and returns `draftId` + `openUrl`, for an "agent drafts the outline, human confirms in the Web UI" flow. |

Results come back as JSON in `result.content[0].text`. Business errors set `result.isError = true`
while HTTP stays `200`; only auth failures return HTTP `401`.

### Connect a client (Hermes example)

```ini
# .env — keep the secret out of version-controlled config
MCP_NOPPT_API_KEY=nppt_<32-hex>
```

```yaml
# config.yaml
mcp_servers:
  noppt:
    url: http://localhost:3001/api/mcp
    enabled: true
    headers:
      Authorization: Bearer ${MCP_NOPPT_API_KEY}
      # optional: override the user scope
      # X-User-Id: local
```

Then run `hermes mcp test noppt` — it should report `Tools discovered: 8`. MCP configuration is only
loaded when a session starts, so restart the session after changing it.

### Issue an API key

**Option A — fixed dev key** in `packages/server/data/server.env` (auto-provisioned on first boot):

```ini
NOPPT_DEV_KEY=nppt_<32-hex>            # must be `nppt_` + 32 hex chars
NOPPT_ADMIN_KEY=<admin-key>            # required by /api/keys (x-admin-key header)
NOPPT_WEB_URL=http://localhost:5173    # used to build the viewUrl returned to agents
PORT=3001
```

**Option B — issue scoped keys at runtime** via the admin API (guarded by the `x-admin-key` header):

```bash
curl -X POST http://localhost:3001/api/keys \
  -H 'Content-Type: application/json' \
  -H 'x-admin-key: <admin-key>' \
  -d '{"name":"hermes-local","tenantId":"hermes","userKey":"local"}'
```

The plaintext key appears in the response **only once** — store it immediately. List keys with
`GET /api/keys` and revoke with `DELETE /api/keys/:id`.

### Scopes, artifacts & preview

- Artifacts are written per scope to
  `packages/server/data/tenants/<tenant>/users/<user>/workspace/`; different scopes cannot see each
  other's data (cross-scope reads fail with `E4001`).
- Agents receive a `viewUrl` of `{NOPPT_WEB_URL}/mcp-preview/{tenant}/{user}/{presentationId}`,
  which renders the deck in a sandboxed, read-only iframe.
- If `NOPPT_MCP_VIEW_TOKEN` is unset, the view endpoints only allow loopback requests — convenient for
  local use. Set it (and pass `?token=` / `X-View-Token`) when accessing from another machine.

### Agent integration conventions (recommended workflow)

> These conventions keep agents (e.g. Hermes) consistent with a "human-in-the-loop" flow. They are **not enforced by the server** — a cloner can run fine without them, but will generate directly and skip the confirmation page.

- **Prefer `noppt_prepare_outline_draft`; do not use `noppt_generate` to produce slides directly**: the former only stages a draft and returns `openUrl`, letting the user confirm generation mode / style / slide count / colour theme on the NoPPT Web "AI Generate Presentation" config page before generation; the latter generates asynchronously immediately, bypassing confirmation. Use `noppt_generate` only when the user explicitly asks for the final deck.
- **`referenceText` budget**: `800 × slideCount` characters, `clamp(3000, 20000)`; put the most important content first (overflow is truncated from the head). `referenceSource` is shown on the UI only.
- **`mode` is fixed to `auto`** (unless you intentionally want `guided` step-by-step).
- **Issue your own API key; do not reuse any literal key from outside the repo**: use "Way B" admin endpoint to issue your own scoped key, e.g. `{"name":"hermes-local","tenantId":"hermes","userKey":"local"}`; never commit a local Dev Key (`.gitignore` already excludes `server.env`, etc.).
- **Four-source RAG (suggested)**: local `wiki/` (L0 single-source LLM Wiki), `corpus/` (L1 local corpus), web search (L2), `aws-knowledge` (L3); conflict arbitration priority `L3 ≈ L1 > L2`. Note: `corpus/` and `wiki/` are git-ignored local assets — cloners must supply their own material or pass authoritative text directly via `referenceText`.
- **When to use it**: when the user only describes a need without asking for the deck yet, or needs to review the topic / material first, use `noppt_prepare_outline_draft`; after staging, return only `openUrl` and wait on the config page for the user's confirmation.
- **Ready-to-paste prompt templates**: see `HERMES_NOPPT_USER_PROMPT.md` (per-task user-message version) and `HERMES_NOPPT_SYSTEM.md` (system-prompt / Skill version) at the repo root. Note: this repo's `AGENTS.md` is git-ignored (it contains a local key literal); after cloning, issue your own key via the "Issue an API key" section above instead of relying on that file.

## 🔐 Data Storage & Self-hosting

- Runtime data lives under `packages/server/data/` (presentations, drafts, tenants, API keys, logs).
  **Do not commit this directory** — it is git-ignored; only `config.example.json` is tracked as a template.
- Before going public, rotate every API key / secret and replace `config.json` with `config.example.json`.
- MCP tool endpoints are protected by bearer API keys (`Authorization: Bearer nppt_…`); the key
  management routes (`/api/keys`) are guarded by the `x-admin-key` header (`NOPPT_ADMIN_KEY`).

## 🤝 Contributing

1. Fork and create a feature branch.
2. `pnpm install && pnpm dev:all` for local development.
3. Run `pnpm lint`, `pnpm typecheck`, and `pnpm test` before opening a PR.
4. Keep i18n strings in the dictionaries rather than hard-coding user-facing text.

## 🙏 Acknowledgements

NoPPT was designed by Qiyunlong (齐云龙). Every line of code was built from scratch with AI Coding
tools. It draws on the ideas and methods of **revealjs-validator**, **SlidesGen-Bench**, and
**huashu-skills**. Special thanks to them.

## 📄 License

[MIT](./LICENSE) © 2026 NoPPT Authors.
