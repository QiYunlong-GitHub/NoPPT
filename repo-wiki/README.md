# NoPPT Repo Wiki

> NoPPT monorepo 的**开发者文档**（人类可读、参与版本控制）。
> 用代码自动分析（解析各包 `index.ts` 导出 + LSP/代码分析抽取公共 API 与跨包依赖）生成，覆盖 `core / ai / audit / server / web` 五包及其关系。
>
> ⚠️ 与根目录 `wiki/`（git 忽略的 L0 单源 LLM Wiki，供 Hermes 检索注入演示 RAG）**面向不同受众、互不冲突**：本文档写给人看，不沿用其 `[[wikilinks]]` 格式。

## 导航

| 文档 | 内容 |
| --- | --- |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 高层架构、包依赖 Mermaid 图、演示生成数据流（web→server→ai→audit→core） |
| [packages/core.md](./packages/core.md) | `@noppt/core` 领域模型/类型/工具/引擎（基座，无内部依赖） |
| [packages/ai.md](./packages/ai.md) | `@noppt/ai` 模型供应商/智能体/模板与样式工具（~234 导出符号） |
| [packages/audit.md](./packages/audit.md) | `@noppt/audit` 多引擎审核 + 自动修复（AutoFixer/FeedbackBuilder） |
| [packages/server.md](./packages/server.md) | `@noppt/server` 10 个 NestJS 模块、MCP 8 工具、数据流 |
| [packages/web.md](./packages/web.md) | `@noppt/web` React 编辑器：组件/store/hooks/页面 |
| [contributing/DOCS_WORKFLOW.md](./contributing/DOCS_WORKFLOW.md) | 改了包公共 API 时如何同步对应文档 |

## 阅读顺序建议

1. 先读 [ARCHITECTURE.md](./ARCHITECTURE.md) 建立全局心智模型。
2. 按依赖自下而上：`core.md` → `ai.md` → `audit.md` → `server.md` / `web.md`。
3. 改了某包**对外导出**的公共 API，务必同步更新对应 `packages/*.md`（见 contributing）。

## 维护约定（摘要）

- **目录固定 `repo-wiki/`**：`.gitignore` 已忽略 `wiki/` 与 `docs/`，故用此名确保文档入库；不要挪到被忽略的路径。
- **纯 Markdown + Mermaid**：零构建，GitHub 原生渲染；不要引入需额外工具链才能查看的格式。
- **只列对外导出**：文档只覆盖各包 `exports` 暴露的符号，不罗列私有实现细节。
- **代码自动分析为源**：公共 API 表应来自对各包 `src/index.ts` 及其子入口的 `export` 抽取（可用 LSP/代码分析或 `code-explorer` 子代理），而非凭记忆。
- 完整 SOP 见 [contributing/DOCS_WORKFLOW.md](./contributing/DOCS_WORKFLOW.md)；该工作流已固化为 CodeBuddy 项目级 Skill `repo-wiki`（`.codebuddy/skills/repo-wiki/SKILL.md`）。
