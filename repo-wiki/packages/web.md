# @noppt/web

> 包路径：`packages/web` · npm 名 `@noppt/web`（私有） · 前端层
> 配套：[架构总览](../ARCHITECTURE.md) · [core](./core.md) · [ai](./ai.md) · [server](./server.md) · [audit](./audit.md)

## 1. 定位

NoPPT 的 **React 编辑器与演示预览**：拖拽画布、元素属性面板、幻灯片列表、AI 对话助手、实时预览，以及导出（HTML / PDF / PNG / PPTX）。技术栈：React 18 + Vite 5 + Zustand 4 + Immer + TailwindCSS 3 + React Router 6。依赖 `@noppt/ai`（直接构造生成请求/消费类型）与 `@noppt/core`（领域类型）。

- 开发：`pnpm dev`（默认 `http://localhost:5173`）；`NOPPT_WEB_URL` 供 server 拼接 `viewUrl`/`openUrl`。

## 2. 入口与全局文件

| 文件 | 角色 |
| --- | --- |
| `main.tsx` | 引导入口：动态 `import('./App')` → `ReactDOM.createRoot` 挂载 `<BrowserRouter><I18nProvider><App/></I18nProvider>`；注册 `error`/`unhandledrejection` 兜底（`renderFatal` 把白屏报错绘到页面便于诊断） |
| `App.tsx` | 根组件：定义 `<Routes>` 路由表（见 §5）；启动 `useSettingsStore.loadSettings()` 并按主题切 `<html>.dark`；渲染全局 `<Toast>` |
| `vite-env.d.ts` | Vite 环境类型：补充 `import.meta.env` 上的 `VITE_APP_TITLE` / `VITE_API_BASE_URL` / `VITE_USE_MOCK` |

## 3. 组件（`src/components/*`）

按子目录分组（每个子目录覆盖代表性组件）：

### 3.1 编辑器核心（`components/` 根）
| 组件 | 文件 | 用途 |
| --- | --- | --- |
| `AIChatPanel` | `components/AIChatPanel.tsx` | 编辑器内 AI 对话助手（current/global/selection 作用域编辑） |
| `AIGenerateModal` | `components/AIGenerateModal.tsx` | 「AI 生成演示」主模态框（配置→大纲→设计提案→渲染页审批） |
| `ExportModal` | `components/ExportModal.tsx` | 导出（HTML/图片/PDF/PPTX，含 jsPDF/html2canvas/JSZip） |
| `PropertyPanel` | `components/PropertyPanel.tsx` | 右侧属性面板（文本/样式/布局/对齐分区） |
| `SlideListPanel` | `components/SlideListPanel.tsx` | 左侧幻灯片列表（缩略图/排序/复制/删除/右键菜单） |
| `SelectionOverlay` / `SelectionBreadcrumb` / `GuidesOverlay` / `Toast` | 对应 `.tsx` | 选中包围框 / DOM 层级面包屑 / 智能参考线 / 全局轻提示 |

### 3.2 AI 生成流程（`components/ai-generate/`）
`ConfigPanel`（生成配置）、`OutlineEditor`（大纲编辑）、`DesignProposals`（设计提案选择）、`RenderedSlides`（逐页审批/重生成）、`preview.tsx`（Stepper/HtmlPreview）、`useGenerateState.ts`（流程集中状态）。

### 3.3 属性面板（`components/property-panel/`）
`sections/TextSection`（文本）、`StyleSection`（样式）、`LayoutSection`（布局）、`AlignSection`（对齐/分布）、`useComputedStyleSync.ts`（面板↔计算样式双向同步）、`updaters.ts`（属性写入 DOM 的更新器）。

### 3.4 设置（`components/settings/`）
`AIModelSettings`、`InterfaceSettings`、`ExportSettings`、`EditorSettings`、`LogSettings`、`DataManagementSettings`、`SettingsSidebar`、`SettingsHeader`。模型配置经 `useSettingsStore` 持久化。

### 3.5 列表与布局
- `components/slide-list/`：`SlideThumbnailItem`、`SlideContextMenu`、`BlankAreaContextMenu`。
- `layouts/EditorLayout.tsx`：编辑器主布局（工具栏+列表+画布+属性面板）；`layouts/editor-sections/EditorToolbar.tsx`（顶部工具栏）、`ContextMenu.tsx`、`PresentationListModal.tsx`。
- `i18n/I18nProvider.tsx`：国际化 Provider（zh-CN / en 切换），零依赖轻量字典。

## 4. 状态管理（Zustand，`src/stores/*`）

| Store | 文件 | 负责状态域 |
| --- | --- | --- |
| `usePresentationStore` | `stores/presentation.ts` | 演示数据、幻灯片 CRUD、撤销/重做历史、缩放、聊天历史、未保存标记 |
| `useSettingsStore` | `stores/settings.ts` | 模型/图片路由配置、界面/编辑器/导出/日志/数据管理设置（加载与持久化） |
| `useUIStore` | `stores/ui.ts` | 全局 UI：各模态开关、AI 预填载荷 `aiPrefill`、Toast |

> `stores/index.ts` 统一导出三个 store；`stores/presentation-utils.ts` 提供历史/重建/默认消息工具。

## 5. 主要 Hooks（`src/hooks/*`）

| Hook | 文件 | 用途 |
| --- | --- | --- |
| `useSelection` | `hooks/useSelection.ts` | 元素/幻灯片选择，结合 Dragger/Resizer/SmartGuides 实现拖拽/缩放/对齐 |
| `useElementOperations` | `hooks/useElementOperations.ts` | 元素对齐/分布/移动/层叠编辑 |
| `useClipboard` | `hooks/useClipboard.ts` | 复制粘贴（元素/幻灯片/HTML/文本/图片），含跨页与格式刷 |
| `useTextEditing` | `hooks/useTextEditing.ts` | 富文本编辑，同步属性面板 |
| `useContextMenu` | `hooks/useContextMenu.ts` | 右键菜单行为编排 |
| `useZoom` | `hooks/useZoom.ts` | 画布缩放自适应 |
| `usePropertyValues` | `hooks/usePropertyValues.ts` | 属性面板读取/写入选中元素样式值（多元素混合态） |

## 6. 路由页面（`src/pages/*`）

路由表定义于 `App.tsx`（`react-router-dom`）：

| 路由 | 页面 | 文件 | 说明 |
| --- | --- | --- | --- |
| `/` | `HomePage` | `pages/HomePage.tsx` | 落地页；消费 `?draft=` 深链预填 AI 配置 |
| `/presentations` | `PresentationsPage` | `pages/PresentationsPage.tsx` | 演示列表管理 |
| `/editor/:id` | `EditorPage` | `pages/EditorPage.tsx` | 编辑器；`?ai=1` 自动开生成框 |
| `/preview/:id` | `PreviewPage` | `pages/PreviewPage.tsx` | 放映/预览（键盘翻页、过渡） |
| `/settings` | `SettingsPage` | `pages/SettingsPage.tsx` | 设置页（未保存提示） |
| `/mcp-preview/:tenant/:user/:id` | `McpPreviewPage` | `pages/McpPreviewPage.tsx` | MCP 只读预览（`iframe srcdoc` sandbox 渲染 `/api/mcp-view/...` 自包含 deck） |

## 7. 包关系

- **依赖**：`@noppt/ai`、`@noppt/core`（均 `workspace:*`），外加 React / Zustand / Tailwind / lucide-react / html2canvas / jspdf / jszip。
- **被依赖**：无（前端终点）；通过 REST 调 `server`，通过深链/`iframe` 消费 server 的 MCP 草稿与只读预览。
- **与 server 关键协作**：
  - AI 预填：server `noppt_prepare_outline_draft` 落草稿 → Web `DraftController` 读草稿 → `HomePage` 经 `useUIStore.setAIPrefill` 暂存 → `AIGenerateModal` 消费。
  - 只读预览：server `McpViewController` 复用 `deck-builder.ts` 的 `buildSelfContainedDeck` → Web `McpPreviewPage` iframe 渲染。
  - REST 生成：Web `AIGenerateModal` → `utils/api.ts` 调 `/ai/*` → server `AiController`。

## 8. 使用提示

- 用户可见文案请放入 `i18n/` 字典，避免硬编码（与「参与贡献」约定一致）。
- 界面语言与生成语言相互独立：界面语言持久化到 `data/config.json` 并经 `Accept-Language` 下发；生成语言在 AI 弹窗单独指定。
