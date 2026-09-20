# @noppt/server

> 包路径：`packages/server` · npm 名 `@noppt/server`（私有） · 后端层
> 配套：[架构总览](../ARCHITECTURE.md) · [core](./core.md) · [ai](./ai.md) · [audit](./audit.md) · [web](./web.md)

## 1. 定位

NoPPT 的 **NestJS 后端**：REST API + MCP（Model Context Protocol）服务端，编排 `@noppt/ai`（生成/编辑）与 `@noppt/audit`（审核），并通过 `packages/server/data/` 持久化产物（私有化、无云端锁定）。依赖 `ai` + `audit` + `core`。

- 端口：`PORT`（默认 `3001`）；MCP 端点 `POST /api/mcp`（Streamable HTTP、无状态、JSON-RPC 2.0）。
- 鉴权：Bearer Key（`Authorization: Bearer nppt_…`），Key 绑定 `tenantId/userKey` 作用域；管理接口由 `x-admin-key` 保护。

## 2. 模块清单（`app.module.ts` 导入的 10 个模块）

| 模块 | 文件 | 控制器 / 路由前缀 | 职责 |
| --- | --- | --- | --- |
| `WorkspaceModule` | `modules/workspace/workspace.module.ts` | `WorkspaceController` `/workspace` | 工作空间元信息 |
| `PresentationModule` | `modules/presentation/presentation.module.ts` | `PresentationController` `/presentations` | 演示 CRUD / 聊天历史 |
| `AiModule` | `modules/ai/ai.module.ts` | `AiController` `/ai` | AI 生成与编辑流水线 |
| `AssetsModule` | `modules/assets/assets.module.ts` | `AssetsController` `/assets` | 图片/视频素材管理 |
| `LogsModule` | `modules/logs/logs.module.ts` | `LogsController` `/logs` | AI 调用日志 |
| `ConfigModule` | `modules/config/config.module.ts` | `ConfigController` `/config` | 服务器级模型/图片配置 |
| `AuditModule` | `modules/audit/audit.module.ts` | `AuditController` `/api/audit` | 审核引擎与报告 |
| `AuthModule` | `modules/auth/auth.module.ts` | `KeysController` `/keys` | API Key 管理 / 认证 / 限流 |
| `McpModule` | `modules/mcp/mcp.module.ts` | `McpController`+`DraftController` `/mcp`+`/drafts` | MCP 协议（8 工具 + 草稿） |
| `McpViewModule` | `modules/mcp/mcp-view.module.ts` | `McpViewController` `/mcp-view` | Web 只读预览 |

## 3. 核心模块详述

### 3.1 `AiModule` — 生成/编辑流水线
- `AiController` 路由：`POST /ai/generate`、`/ai/plan`、`/ai/generate-from-plan`、`/ai/design-proposals`、`/ai/render-slides`、`/ai/regenerate-slide`、`/ai/assemble-images`、`/ai/finalize`、`/ai/edit-slide`、`/ai/edit-element`、`/ai/edit-global`。
- `AiService`（`modules/ai/ai.service.ts`）：核心流水线，依赖 `LayoutEngine` + 各 Provider + `AuditModule` + `ConfigModule`。配套子文件：`html-audit-loop.ts`、`triage-vlm-issues.ts`、`audit/audit-loops.ts`、`postprocess/*`、`reference/resolve-for-generation.ts`。

### 3.2 `PresentationModule` — 演示 CRUD
- `PresentationController`：`GET/POST/PUT/PATCH/DELETE /presentations`、`/presentations/:id/duplicate`、`/presentations/:id/chat`（读写聊天历史）。
- `PresentationService`：演示持久化、复制、HTML 清洗（复用 `core` 的视觉修复）。

### 3.3 `AuditModule` — 审核
- `AuditController`：`POST /api/audit/presentation/:id`、`GET /api/audit/presentation/:id/report`、`GET .../screenshot/:slideIndex`。
- `AuditService`：封装 `@noppt/audit` 的 `AuditEngine`/`VisualAuditEngine`，生成报告与截图。

### 3.4 `AuthModule` — 安全
- `KeysController`（`/keys`，全部需 `x-admin-key`）：`GET`（列出脱敏）/ `POST`（创建，明文仅回一次）/ `DELETE`（吊销）。
- `ApiKeyService`：Key 哈希落盘（明文永不落盘）；`ApiKeyGuard.authenticateRequest`：认证守卫；`RateLimitService` + `rate-limit.guard.ts`：进程内滑动窗口限流（generate/edit 双桶）。启动时若设 `NOPPT_DEV_KEY` 自动确保 `dev` Key。

### 3.5 `McpModule` — MCP（重点）
所有工具共享入口 `POST /mcp`（`McpController.handleMcp`），用 `@modelcontextprotocol/sdk` 组装 Server 并注册 **8 个 `noppt_*` 工具**。认证走 `ApiKeyGuard`，编辑类工具经 `enforceRateLimit` 限流；编辑写入前通过 `loadScopedPresentation` 实现租户/用户目录隔离。

**MCP 8 工具 → 文件映射：**

| 工具 | 处理链路（文件） | 说明 |
| --- | --- | --- |
| `noppt_generate` | `mcp.controller.ts → runGenerate` → `GenerationQueue`（`generation-queue.ts`）→ `AiService.generatePresentation` | 异步入队生成 |
| `noppt_get_presentation` | `mcp.controller.ts → getPresentation` → `GenerationQueue.get/waitFor` | 轮询任务 |
| `noppt_edit_slide` | `mcp.controller.ts → runEdit('edit_slide')` → `AiService.editSlide` + `PresentationService.save` | 整页改写 |
| `noppt_edit_element` | `mcp.controller.ts → runEdit('edit_element')` → `AiService.editElement`（JSDOM 定位 selector）+ `save` | 单元素精确改 |
| `noppt_edit_global` | `mcp.controller.ts → runEdit('edit_global')` → `AiService.editGlobal` + `save` | 整份级编辑 |
| `noppt_export_html` | `mcp.controller.ts → exportHtml` → `buildSelfContainedDeck`（`deck-builder.ts`，资源内联 data URL） | 自包含 HTML 导出 |
| `noppt_list_templates` | `mcp.controller.ts → listTemplates` | 枚举 style/colorTheme/内置模板 |
| `noppt_prepare_outline_draft` | `mcp.controller.ts → prepareOutlineDraft` → `createDraft`+`buildOpenUrl`（`draft-store.ts`） | **只备料不生成**，返回 `openUrl`；读取侧为 `DraftController`（`/drafts/:draftId`） |

> 「人在回路」约定：智能体**优先用 `noppt_prepare_outline_draft`**，由用户在 Web 配置页确认后再生成；禁止直接 `noppt_generate` 出片。详见根 `README_CN.md` 的「Agent 联调约定」与 `HERMES_NOPPT_SOP.md`。

### 3.6 `McpViewModule` — 只读预览
- `McpViewController` `GET /mcp-view/:tenantId/:userKey/:presentationId`：复用 `buildSelfContainedDeck`，参数先 sanitize 再读盘；走独立 `ViewGuard`，不走 `ApiKeyGuard`。Web 侧 `McpPreviewPage` 以 `iframe srcdoc`（sandbox）只读渲染。

## 4. 包关系

- **依赖**：`@noppt/ai`、`@noppt/audit`、`@noppt/core`（均 `workspace:*`），外加 NestJS / Express / `@modelcontextprotocol/sdk` / multer / zod / jsdom。
- **被依赖**：无（顶层编排者）；对外通过 REST 供 `web`、通过 MCP 供外部智能体。
- **数据流**：Web/MCP → `AiModule`(`ai`) → 生成期 `audit` 内联自检 → 拼装后 `AuditModule`(`audit`) → `core` 持久化/修复。

## 5. 使用提示

- 产物落盘 `packages/server/data/tenants/<tenant>/users/<user>/workspace/`，跨作用域读取报 `E4001`。
- 运行时配置在 `data/config.json`（模板 `config.example.json`）；`AuditSettings`/`inlineSelfCheckSettings` 在此配置。
- 管理 API Key：方式 B 用 `POST /api/keys`（带 `x-admin-key`），明文仅返回一次。
