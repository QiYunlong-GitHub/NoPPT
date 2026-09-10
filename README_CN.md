<div align="center">

# NoPPT

**开源的 Gamma 式卡片演示平台 —— 用 AI 生成演示文稿，并导出为 HTML / PDF / PNG。**

[English](./README.md) · [简体中文](./README_CN.md)

</div>

---

NoPPT 是一个开源的 Gamma / SlidesAI 替代品。你只需描述主题（或提供参考资料），NoPPT 就会先生成结构化大纲，
再以卡片式设计系统渲染出可交互的 HTML 幻灯片。项目采用 monorepo 结构：前端是 **React + Vite** 编辑器，
后端是 **NestJS** 服务，负责编排各类大模型（OpenAI / Anthropic / Ollama / Free.ai / v0 by Vercel）。

## ✨ 核心特性

- **AI 一键生成**：主题 → 结构化大纲 → 可交互 HTML 幻灯片，支持上传参考 HTML / 图片 / 文本作为素材。
- **卡片式设计系统**：统一、响应式的卡片排版，内置主题、图标集与紧凑 / 宽松布局。
- **完整编辑器**：拖拽画布、元素属性面板、幻灯片列表、AI 对话助手、实时预览。
- **多语言界面**：在「设置 → 界面设置」中切换**简体中文 / English**；语言会持久化到服务端配置，
  并同时驱动生成内容的语言与服务端返回的错误文案。
- **灵活导出**：单文件 HTML、静态网页 ZIP、PDF、PNG 序列。
- **可扩展模型路由**：按阶段（规划 / 正文 / 编辑）配置不同模型供应商，支持高对比度与自检模式。
- **MCP 智能体接入**：内置 8 个 `noppt_*` 工具，任何 MCP 兼容客户端（Hermes、Claude Desktop 等）
  都能以编程方式生成、编辑、导出并预览演示。
- **私有化部署**：所有数据保存在 `packages/server/data/`，无云端锁定。

## 🧱 技术栈

| 层 | 技术 |
| -- | ---- |
| 前端 | React 18 · TypeScript · Vite 5 · Zustand 4 · Immer · TailwindCSS 3 · React Router 6 |
| 后端 | NestJS · TypeScript · Express |
| AI | OpenAI · Anthropic · Ollama · Free.ai · v0 by Vercel |
| 智能体协议 | MCP（Model Context Protocol）· Streamable HTTP · JSON-RPC 2.0 |
| 导出 | html2canvas · jsPDF · JSZip |
| 测试 | Vitest · React Testing Library |
| 工具 | ESLint · Prettier |

## 📂 项目结构

```
packages/
├── core/      # 共享领域类型与工具 (@noppt/core)
├── ai/        # AI 智能体编排 (@noppt/ai)：大纲规划、HTML 幻灯片生成、自检
├── audit/     # 视觉 / 内容自检引擎 (@noppt/audit)
├── server/    # NestJS 后端（MCP + REST）(@noppt/server)
└── web/       # React 编辑器与演示预览 (@noppt/web)
```

## 🚀 快速开始

环境要求：**Node ≥ 18.17.0**，**pnpm ≥ 8.0.0**。

```bash
# 1. 安装依赖
pnpm install

# 2. 同时启动前端（5173）与后端（3001）
pnpm dev:all

# 也可分别启动
pnpm dev          # 仅前端 (http://localhost:5173)
pnpm dev:server   # 仅后端 (http://localhost:3001)
```

打开 http://localhost:5173。生成前请在「设置 → AI 模型」中至少配置一个模型供应商。

### 构建与生产

```bash
pnpm build         # 构建所有包
pnpm build:web     # 仅构建前端
pnpm build:server  # 仅构建后端
pnpm start:server  # 运行构建后的后端（默认端口 3001）
```

### 常用脚本

| 脚本 | 说明 |
| ---- | ---- |
| `pnpm dev` / `dev:server` / `dev:all` | 开发服务器 |
| `pnpm build` / `build:web` / `build:server` | 生产构建 |
| `pnpm preview` | 预览构建产物 |
| `pnpm lint` / `lint:fix` | ESLint |
| `pnpm typecheck` | TypeScript 类型检查 |
| `pnpm test` / `test:ui` | Vitest |
| `pnpm format` / `format:check` | Prettier |

## 🌐 多语言说明

- **界面语言**：在「设置 → 界面设置 → 界面语言」中切换（`zh-CN` / `en`）。该设置会持久化到
  `data/config.json`，并通过 `Accept-Language` 请求头下发，因此服务端错误文案也会跟随同一语言。
- **生成语言**：在 AI 生成弹窗中可单独指定本次生成正文的语言（默认跟随界面语言），会透传到 AI 智能体，
  使生成的幻灯片文案使用对应语言。
- 前端使用零依赖的轻量字典（`packages/web/src/i18n/`），后端维护独立的消息目录（`packages/server/src/i18n/`）。

## 🔌 MCP 服务与智能体接入

NoPPT 内置 **MCP（Model Context Protocol）服务端**，因此任何 MCP 兼容客户端（Hermes、Claude Desktop
或自建客户端）都能通过工具调用驱动完整的演示生命周期——生成 → 轮询 → 编辑 → 导出 → 预览。

| 项 | 值 |
| -- | -- |
| 端点 | `POST http://localhost:3001/api/mcp` |
| 传输协议 | MCP **Streamable HTTP**，**无状态**（无 session），JSON-RPC 2.0 |
| 鉴权 | `Authorization: Bearer nppt_<32 位十六进制>`；每个 Key 绑定 `tenantId/userKey` 作用域 |
| 异步模型 | 调用入队并返回 `jobId`；`wait=true` 最多同步等 60s，否则轮询 |
| 只读预览 | `GET /api/mcp-view/:tenant/:user/:presentationId`，Web 路由 `/mcp-preview/...` |

### 工具清单（8 个）

| 工具 | 作用 |
| ---- | ---- |
| `noppt_generate` | 按 `topic` 生成演示（可选 `referenceText` / `referenceHtml` / `referenceImage`、`slideCount`、`style`、`audience`、`colorTheme`、`imageEnabled`）。 |
| `noppt_get_presentation` | 按 `jobId` 轮询任务，生成与三类编辑工具共用。 |
| `noppt_edit_slide` | 整页改写（`slideIndex` + `userRequest`）。 |
| `noppt_edit_element` | 按 `elementIndex` / `selector` 精确改单个元素。 |
| `noppt_edit_global` | 整份级编辑（配色、字体、页数）。 |
| `noppt_export_html` | 返回自包含 HTML（资源内联为 data URL）。 |
| `noppt_list_templates` | 返回可用风格、配色与内置模板枚举。 |
| `noppt_prepare_outline_draft` | **只备料、不生成**：落草稿并返回 `draftId` + `openUrl`，适用于「智能体拟大纲、人在 Web 界面确认再生成」的形态。 |

业务结果以 JSON 形式返回在 `result.content[0].text` 中；业务失败时 `result.isError=true`、HTTP 仍为
`200`，仅鉴权失败返回 HTTP `401`。

### 接入客户端（以 Hermes 为例）

```ini
# .env —— 密钥不进配置库
MCP_NOPPT_API_KEY=nppt_<32 位十六进制>
```

```yaml
# config.yaml
mcp_servers:
  noppt:
    url: http://localhost:3001/api/mcp
    enabled: true
    headers:
      Authorization: Bearer ${MCP_NOPPT_API_KEY}
      # 可选：覆盖用户作用域
      # X-User-Id: local
```

随后执行 `hermes mcp test noppt`，预期输出 `Tools discovered: 8`。MCP 配置仅在会话启动时加载，
修改后需重开会话才生效。

### 签发 API Key

**方式 A —— 固定 Dev Key**，写入 `packages/server/data/server.env`（首次启动自动引导）：

```ini
NOPPT_DEV_KEY=nppt_<32 位十六进制>     # 格式必须是 nppt_ + 32 位十六进制
NOPPT_ADMIN_KEY=<管理密钥>              # /api/keys 需要（x-admin-key 请求头）
NOPPT_WEB_URL=http://localhost:5173     # 用于拼接返回给智能体的 viewUrl
PORT=3001
```

**方式 B —— 运行时签发作用域 Key**（管理接口，由 `x-admin-key` 请求头保护）：

```bash
curl -X POST http://localhost:3001/api/keys \
  -H 'Content-Type: application/json' \
  -H 'x-admin-key: <管理密钥>' \
  -d '{"name":"hermes-local","tenantId":"hermes","userKey":"local"}'
```

明文 Key **只在返回中出现一次**，请立即保存。列表用 `GET /api/keys`，吊销用 `DELETE /api/keys/:id`。

### 作用域、产物与预览

- 产物按作用域落盘到 `packages/server/data/tenants/<tenant>/users/<user>/workspace/`；
  不同作用域互不可见（跨作用域读取报 `E4001`）。
- 智能体拿到的 `viewUrl = {NOPPT_WEB_URL}/mcp-preview/{tenant}/{user}/{presentationId}`，
  页面以 iframe 沙箱**只读**渲染。
- 未设置 `NOPPT_MCP_VIEW_TOKEN` 时，预览接口仅放行本机回环（本机联调最省事）；跨机访问请设置该变量，
  并在请求中带 `?token=` 或 `X-View-Token`。

## 🔐 数据存储与私有化部署

- 运行时数据保存在 `packages/server/data/`（演示、草稿、租户、API Key、日志）。**请勿提交该目录** ——
  它已被 git 忽略，仅 `config.example.json` 作为脱敏模板入库。
- 公开发布前，请轮换所有 API Key / 密钥，并用 `config.example.json` 替换 `config.json`。
- MCP 工具接口由 Bearer API Key（`Authorization: Bearer nppt_…`）保护；
  Key 管理路由（`/api/keys`）由 `x-admin-key` 请求头保护（取值 `NOPPT_ADMIN_KEY`）。

## 🤝 参与贡献

1. Fork 并创建特性分支。
2. 本地开发执行 `pnpm install && pnpm dev:all`。
3. 提交 PR 前运行 `pnpm lint`、`pnpm typecheck`、`pnpm test`。
4. 用户可见文案请放入 i18n 字典，避免硬编码。

## 🙏 致谢

NoPPT 由齐云龙设计，全部代码使用 AI Coding 工具从零构建。借鉴了 revealjs-validator、SlidesGen-Bench
和 huashu-skills 的思路和方法。特此致谢。

## 📄 许可证

[MIT](./LICENSE) © 2026 NoPPT 作者团队。
