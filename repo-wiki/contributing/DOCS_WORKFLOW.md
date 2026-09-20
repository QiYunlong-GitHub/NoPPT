# 文档更新约定（Docs Workflow）

本文件规定「何时、如何同步 `repo-wiki/` 文档」，使仓库 Wiki 与代码不脱节。配套的自动化工作流已固化为 CodeBuddy 项目级 Skill `repo-wiki`（`.codebuddy/skills/repo-wiki/SKILL.md`）：当用户要求「创建/生成 Repo Wiki / 仓库文档 / 架构文档」时触发。

## 1. 何时需要更新文档

满足任一条件即应同步：

1. **改了某包的对外导出 API**：新增 / 删除 / 重命名 / 改签名了任何被 `package.json` 的 `exports` 暴露的符号（含各 `src/index.ts` 及其子入口的 `export`）。
2. **新增或删除了包 / 模块**：例如 server 新增一个 NestJS 模块、web 新增一个路由页面。
3. **改变了包间依赖**：在任意 `package.json` 的 `dependencies` 增删 `workspace:*` 引用。
4. **改变了 MCP 工具 / REST 路由**：server 的 `noppt_*` 工具或 Controller 路由变动。
5. **大规模重构**：某包职责重新划分。

> 仅修改私有实现（未触达 `exports`）、仅改注释、仅改测试，**不需要**更新文档。

## 2. 更新步骤

1. **定位受影响文档**：对照下表，改了哪个包就更新哪份（及其在 `ARCHITECTURE.md` 的相关描述）。

   | 改动的包 | 主要更新文档 |
   | --- | --- |
   | `packages/core` | `packages/core.md`、`ARCHITECTURE.md`（依赖图底座） |
   | `packages/ai` | `packages/ai.md` |
   | `packages/audit` | `packages/audit.md` |
   | `packages/server` | `packages/server.md`、`ARCHITECTURE.md`（MCP/数据流） |
   | `packages/web` | `packages/web.md` |

2. **重新抽取公共 API（代码自动分析）**：不要凭记忆改。用 LSP/代码分析或 `code-explorer` 子代理，解析对应 `src/index.ts` 及子入口的 `export`，得到最新符号清单，再更新文档中的 API 表。
3. **保持表格风格一致**：沿用现有文档的「符号 / 种类 / 用途」三列表格；新增符号补一行，删除符号删一行，重命名同步更新正文引用。
4. **更新导航（如新增文档）**：若新增了 `packages/*.md` 或新章节，同步更新 [`../README.md`](../README.md) 的导航表。
5. **验证不破坏仓库**：文档是纯 Markdown，不影响构建；但提交前应确认 `repo-wiki/` 仍未被 `.gitignore` 忽略（`git check-ignore repo-wiki/ARCHITECTURE.md` 应返回空）。

## 3. 约定（不可违反）

- **目录固定 `repo-wiki/`**：`.gitignore` 已忽略 `wiki/`（L0 RAG 源）与 `docs/`，文档必须留在此名以确保入库；不要移到被忽略路径，也不要把本文档并入 `wiki/`。
- **只列对外导出**：文档仅覆盖 `exports` 暴露的符号，避免罗列私有细节，减少维护负担与失真。
- **纯 Markdown + Mermaid**：零构建、GitHub 原生渲染；不引入需额外工具链的格式。
- **中文为主**：代码块用中文注释，与 `README_CN.md` 风格一致。
- **不改动源码来迁就文档**：文档服务于代码；若文档与代码不符，以代码为准并修正文档。

## 4. 反例（不要这样做）

| 反例 | 后果 |
| --- | --- |
| 改了 `ai` 的导出却只更新 `ARCHITECTURE.md` | 包文档过期，读者在 `packages/ai.md` 找不到新 API |
| 凭记忆手写 API 表 | 与真实 `index.ts` 漂移，逐步失真 |
| 把文档放进 `docs/` 或 `wiki/` | 被 `.gitignore` 忽略，无法入库 |
| 沿用 `wiki/` 的 `[[wikilinks]]` | 与本文档的普通 Markdown 链接风格冲突，GitHub 渲染为纯文本 |
| 为私有函数写文档 | 维护成本无收益，且私有符号易变 |
