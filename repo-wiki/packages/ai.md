# @noppt/ai

> 包路径：`packages/ai` · npm 名 `@noppt/ai` · 智能体层
> 配套：[架构总览](../ARCHITECTURE.md) · [core](./core.md) · [audit](./audit.md) · [server](./server.md) · [web](./web.md)

## 1. 定位

NoPPT 的**生成能力核心**：模型供应商抽象、AI 智能体（大纲规划 / HTML 幻灯片生成 / v0 幻灯片）、提示词与图标模板、以及生成期的样式/参考属性工具。它站在 `core` 之上，被 `server`（后端编排）、`web`（前端直接调用）、`audit`（审核复用其 LLM/VLM 能力）依赖。

公共入口（`package.json` 的 `exports`）：`.`（根，聚合四类 + 一批 `utils/*` 具名导出）、`./providers`、`./agents`、`./templates`。

## 2. 公共 API（按子入口分组）

> 公共 API 规模约 **234 个符号**，是五包中最大者。下表按子入口列出代表符号与职责；完整符号见源码各 `index.ts`。

### 2.1 `./types` — AI 层领域类型（`types.ts`）
模型调用、版式规划、参考文件属性、生成选项的总类型约定。

| 符号 | 种类 | 用途 |
| --- | --- | --- |
| `ModelProvider` / `ModelRole` / `ChatMessage` / `ChatOptions` / `ChatResponse` | type/interface | 聊天模型调用契约 |
| `ModelConfig` / `ModelRef` / `ModelRoutingConfig` / `StageModelConfigs` / `RouteStage` | interface/type | 按阶段（规划/正文/编辑）的模型路由 |
| `GeneratedOutline` / `SlidePlan` / `PresentationPlan` / `DesignProposal` / `RenderedSlide` | interface | 大纲/规划/设计/渲染结果 |
| `SlidePageType` / `ContentDensity` / `ColorTheme` / `IconStyle` / `LayoutParams` / `StyleTheme` | type/interface | 版式/密度/配色/图标/布局参数 |
| `ImageRatio` / `ImageGenerationOptions` / `GeneratedImage` / `ImageRouteScene` / `ImageModelRoutingConfig` | type/interface | 图片生成与路由 |
| `ReferenceStyle` / `ReferenceLayout` / `ReferencePalette` / `ReferenceMaster` / `ReferenceVisualAttributes` / `ReferenceContext` | interface | 参考素材属性（注入生成的核心） |
| `SlideColorPolicy` | interface | 逐页配色策略（后处理颜色真源） |
| `GenerationProgress` / `GenerationCallback` / `CritiqueConfig` / `PresentationGenerationOptions` | interface/type | 生成进度与评审配置 |
| `pageTypeToCategory` | function | 版式→分类（cover/content/summary）映射 |

### 2.2 `./providers` — 模型供应商（`providers/*`）
统一聊天/图像生成供应商抽象与具体实现，加工厂方法。

| 符号 | 种类 | 用途 |
| --- | --- | --- |
| `AIModelProvider` / `TraceableProvider` / `BaseProvider` | interface/type/abstract class | 供应商接口与基类（含埋点/日志/Key 掩码） |
| `OpenAIProvider` / `AnthropicProvider` / `FreeAIProvider` | class | OpenAI 兼容 / Anthropic / FreeAI 聊天供应商 |
| `V0Provider`（`V0ProviderConfig`） | class | v0 供应商（返回 tsx 源码） |
| `QwenImageProvider` / `SeedreamProvider` | class | 通义万相 / 豆包 Seedream 图片供应商 |
| `createChatProvider` | function | 按配置创建聊天供应商工厂 |
| `getBeijingTime` / `formatMessages` / `maskApiKey` / `truncate` | function | 日志/格式化/安全工具 |

### 2.3 `./agents` — 生成 Agent（`agents/*`）
| 符号 | 种类 | 用途 |
| --- | --- | --- |
| `ContentAgent` | class | 内容生成 Agent |
| `HTMLPresentationAgent` | class | **HTML 演示生成 Agent**（核心），逐页产出 `HTMLSlide` |
| `V0SlideAgent`（`V0SlideOptions` / `GeneratedSlideHTML`） | class/interface | v0 幻灯片生成 Agent |
| `HTMLSlide` / `HTMLPresentation` / `GenerationTiming` / `SlideCountSpec` | interface/type | HTML 版幻灯片结构 |
| `resolveEffectivePrimaryColor` / `resolveProposalPrimaryColor` / `COLOR_THEMES` / `darkenColor` / `assertHueClose` | function/const | 主色解析与配色校验 |
| `IMAGE_PLACEHOLDER` / `replaceImagePlaceholderWithRealSrc` / `BODY_FONT_SIZE_MIN` / `BODY_FONT_SIZE_MAX` | const/function | 图片占位符与正文字号钳制常量 |
| `retryBudget` / `incRetryCount` / `getRetryState` / `MAX_RETRY_PER_SLIDE` / `CHANNEL_BUDGET` | const/function | 每页重试预算（内联自检重生成用） |
| `getImageSizeForRatio` / `selectImageModel` / `getRouteScene` / `PAGE_TYPE_DEFAULT_IMAGE_RATIO` | function/const | 图片尺寸与模型路由 |
| `extractSlideCount` / `extractPageStructureHints` / `deriveStructureFlags` | const/function | 大纲结构解析 |
| `hexToHsl` / `hueDelta` / `hueDeltaDeg` / `hslToHex` | function | 色相计算（与 `style-violation-signal` 同名符号已精确导出规避冲突） |

### 2.4 `./templates` — 提示词与图标模板（`templates/*`）
| 符号 | 种类 | 用途 |
| --- | --- | --- |
| `PRESENTATION_GENERATION_PROMPT` / `OUTLINE_REFINEMENT_PROMPT` / `CARD_CONTENT_EXPANSION_PROMPT` / `SYSTEM_PROMPT` | const | 大纲/内容/系统提示词 |
| `PRESENTATION_PLANNING_PROMPT` / `BACKGROUND_PLANNING_GUIDANCE` / `SLIDE_HTML_GENERATION_PROMPT` / `HTML_SLIDE_MODIFICATION_PROMPT` / `HTML_GLOBAL_MODIFICATION_PROMPT` | const | 规划/单页生成/编辑提示词 |
| `PAGE_TEMPLATES` / `getPageTemplates` / `getPageTemplatesByPageType` / `buildTemplateContext` | const/function | 页面版式模板 |
| `resolveIconName` / `isSemanticIconKey` / `renderSvgIcon` / `renderBadgeIcon` / `guessIconKey` / `CURATED_ICONS` / `resolveIcon` | function/const/type | 语义图标解析与 SVG 渲染（依赖 `lucide-static`） |
| `buildCritiqueFeedback` / `buildRegenerationPrompt` / `CritiqueScores` / `SlideCritique` | function/interface | 评审反馈与重生成提示词构造 |

### 2.5 `utils/*` 具名导出（根入口直出）
| 符号（分组） | 种类 | 用途 |
| --- | --- | --- |
| `logger`：`setLogConfig` / `getLogConfig` / `simpleLog` / `LogConfig` / `LogVerbosity` | function/interface/type | 日志配置 |
| `model-name-parser`：`parseModelName` / `getQualityScore` / `getSpeedScore` / `ParsedModelName` / `ModelTier` | function/interface/type | 模型名解析与档位评分 |
| `image-plan-guard`：`resolveSlideImageDecision` / `stripImagePlaceholders` / `isStructurePage` / `IMAGE_PLACEHOLDER_SRC` / `SlideImageDecision` | function/const/interface/type | 每页图片决策与占位符剥离 |
| `llm-tracer`：`openTraceSession` / `addTrace` / `getTraces` / `closeTraceSession` / `LLMCallTrace` / `ImageGenerationTrace` | function/interface | LLM/图片调用追踪（可观测性） |
| `style-violation-signal`：`styleViolationSignal` / `exceedsThreshold` / `detectBlackBlockTitle` / `STYLE_VIOLATION_THRESHOLDS` / `StyleViolationBreakdown` | function/const/type | 样式违规信号（黑块标题/px sticky 等） |
| `reference-attribute-resolver`：`mergeReferenceAttrs` / `assembleReferenceVisualAttributes` / `resolveReferencePrimaryColor` / `resolveDeckReferencePrimaryColor` / `resolveFinalPagePrimaryColor` / `getReferencePaletteForPage` / `resolveReferenceComposition` | function | 参考视觉属性解析与合并（生成期配色真源） |
| `reference-html-extractor`：`extractReferenceHtmlAttributes` | function | 提取参考 HTML 属性（server 侧注入用） |
| `reference-style-cascade`：`countStyleRules` | function | 样式级联统计 |
| `vlm-attribute-extraction`：`VlmTextProvider` | interface | VLM 文本供应商接口 |
| `reference-logo-src`：`applyMasterLogoSources` / `applyReferenceImageUrlSources` | function | 母版 Logo / 参考图 URL 源应用 |

## 3. 包关系

- **依赖**：`@noppt/core`（`workspace:*`）。
- **被依赖**：`audit`（复用 LLM/VLM）、`web`、`server`。
- **关键协作**：`server` 的 `AiService` 调用 `HTMLPresentationAgent` 做生成；`web` 的 `AIGenerateModal` 直接调用 ai 的类型/模板构造请求；`audit` 的 VLM 评审复用 ai 的图片供应商。

## 4. 使用提示

- 图片/配色/版式决策应尽量走 `reference-attribute-resolver` 与 `image-plan-guard`，保证「参考优先」的一致性。
- 内联自检（`retryBudget` / `vlmPlaceholder`）在生成期逐页触发自动重生成，阈值见 `style-violation-signal`。
- `exports` 中多处精确命名导出是为规避 `TS2308` 重复符号冲突，新增导出时勿再用 `export *` 覆盖同名内部符号。
