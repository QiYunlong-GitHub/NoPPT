# @noppt/core

> 包路径：`packages/core` · npm 名 `@noppt/core` · 基座层（无内部依赖）
> 配套：[架构总览](../ARCHITECTURE.md) · [ai](./ai.md) · [audit](./audit.md) · [server](./server.md) · [web](./web.md)

## 1. 定位

NoPPT 的**地基包**：统一领域模型、类型、纯工具函数与「幻灯片工厂 + HTML 视觉修复」引擎。所有其它包（`ai`/`audit`/`server`/`web`）都依赖它，但它不依赖任何内部包——因此改动 core 的公共 API 会影响全栈，需格外谨慎（见 [contributing](../contributing/DOCS_WORKFLOW.md)）。

公共入口（`package.json` 的 `exports`）：

| 子入口 | 内容 |
| --- | --- |
| `.`（根） | 聚合下方四类 |
| `./types` | 基础领域类型 |
| `./models` | 幻灯片/演示文稿数据模型 |
| `./utils` | 纯工具函数 |
| `./engine` | 布局引擎 + 视觉修复 |
| `./security/html-allowlist` | HTML 净化白名单（server/web 双端单一真源） |

## 2. 公共 API

### 2.1 `./types` — 基础领域类型（`types/index.ts`）
几何、样式、主题、演示元数据的**定义层**，是整个 monorepo 类型系统的底座。

| 符号 | 种类 | 用途 |
| --- | --- | --- |
| `ID` | type | 通用标识符别名（string） |
| `ElementType` / `ShapeType` / `ChartType` | type | 元素 / 形状 / 图表类型枚举 |
| `TextAlign` / `FontWeight` / `FontStyle` / `TextDecoration` | type | 文本样式枚举 |
| `Position` / `Size` / `Rect` / `Padding` / `Margin` | interface | 几何基础结构 |
| `ColorStop` / `Gradient` / `BackgroundFill` | interface/type | 渐变与背景填充 |
| `BorderStyle` / `ShadowStyle` / `TextStyle` | interface | 边框 / 阴影 / 文本样式 |
| `AnimationConfig` | interface | 动画配置 |
| `ThemeMode` / `ThemeColors` / `ThemeTypography` / `ThemeConfig` | type/interface | 主题色板 / 排版 / 配置 |
| `PresentationType` / `PresentationMeta` | type/interface | 演示类型与元数据 |
| `HistoryState` | interface | 撤销/重做历史 |

### 2.2 `./models` — 数据模型（`models/slide.ts`）
幻灯片与演示文稿的核心数据结构（生成/编辑/审核都围绕它们）。

| 符号 | 种类 | 用途 |
| --- | --- | --- |
| `SlideElement` | interface | 单个幻灯片元素（文本/图片/形状…） |
| `Slide` | interface | 单张幻灯片 |
| `Presentation` | interface | 演示文稿（含多页与全局配置） |

### 2.3 `./utils` — 纯工具函数（无副作用）
| 符号 | 种类 | 用途 |
| --- | --- | --- |
| `generateId` / `generateSlideId` / `generateElementId` / `generatePresentationId` / `generateGroupId` / `generateThemeId` | function | 带前缀随机 ID 生成 |
| `hexToRgb` / `rgbToHex` / `rgba` / `lighten` / `darken` / `getContrastColor` | function | 颜色换算与调整 |
| `rectIntersects` / `pointInRect` / `clamp` / `snapToGrid` / `normalizeSize` | function | 几何计算与网格对齐 |
| `deepClone` | function | 深拷贝 |

### 2.4 `./engine` — 引擎（`engine/layout-engine.ts` + `visual-fixes.ts`）
幻灯片工厂 + 对 AI 产出 HTML 的安全/视觉修复层。

| 符号 | 种类 | 用途 |
| --- | --- | --- |
| `LayoutEngine` | class | 布局引擎：创建 / 复制 / 规范化幻灯片 |
| `isCoverLikeHtml` | function | 判断是否封面式 HTML |
| `cleanupEmptyInlineTags` | function | 清理空内联标签 |
| `parseStyleDeclarations` / `relativeLuminance` / `isEffectiveClipText` | function | style 解析与亮度/裁切判断 |
| `fixGradientTextDeclarationOrder` / `applyCompositionGuard` / `enforceImageStyles` / `enforceMinFontSize` / `enforceFlexChildrenMinWidth` / `enforceTextWrapping` / `enforceFlatStructure` / `enforceGridLayout` | function | 确定性 HTML/CSS 修复（供 AutoFixer 与生成后处理复用） |
| `ReferenceComposition` / `GradientTextFixOptions` / `EnforceImageStylesOptions` | type/interface | 上述修复的选项/结果类型 |

### 2.5 `./security/html-allowlist` — HTML 安全白名单（`security/html-allowlist.ts`）
server 与 web **双端统一的 HTML 净化白名单单一真源**（防母版层/背景层被误剥）。

| 符号 | 种类 | 用途 |
| --- | --- | --- |
| `ALLOWED_TAGS` | const | 允许的 HTML 标签白名单 |
| `ALLOWED_ATTRIBUTES` | const | 允许的 HTML 属性白名单 |
| `ALLOWED_CSS_PROPERTIES` | const | 允许的 CSS 属性白名单（Set） |
| `ALLOWED_ATTR_SET` | const | 属性白名单小写集合（大小写不敏感判定） |

## 3. 包关系

- **依赖**：无内部依赖（基座）。
- **被依赖**：`ai` → `core`、`audit` → `core`、`web` → `core`、`server` → `core`。任何跨包代码都应通过 `exports` 子入口消费 core，禁止 import core 私有路径。
- **公共 API 规模**：约 69 个导出符号（21 interface / 12 type / 31 function / 4 const / 1 class）。

## 4. 使用提示

- 颜色/几何工具是纯函数，可在任意层安全复用（如 ai 的配色解析、web 的属性面板）。
- `LayoutEngine` 是唯一有状态的工厂类；生成流水线通过它规范化 AI 产出的幻灯片结构。
- 修改 `./security/html-allowlist` 会同时影响 server 与 web 的净化逻辑，需两端联测。
