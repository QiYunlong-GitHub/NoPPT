# @noppt/audit

> 包路径：`packages/audit` · npm 名 `@noppt/audit` · 质量层
> 配套：[架构总览](../ARCHITECTURE.md) · [core](./core.md) · [ai](./ai.md) · [server](./server.md) · [web](./web.md)

## 1. 定位

NoPPT 的**质量保障引擎**：在演示生成后（及 server 审核接口触发时）运行多引擎审核，并自动修复可确定的布局/样式问题。它依赖 `ai`（复用 LLM/VLM 能力评判成品）与 `core`（领域类型），被 `server` 的 `AuditModule` 封装暴露。

公共入口：仅根入口（`package.json` 未设子入口），聚合 `types` / `config` / 四个引擎 / `fix` 模块，并显式导出各 Engine 与工具类。

## 2. 公共 API（约 80 个符号）

### 2.1 `./types` — 审计领域类型（`types.ts`）
| 符号 | 种类 | 用途 |
| --- | --- | --- |
| `AuditSeverity` / `AuditEngineType` / `AuditResultStatus` / `OverallResult` | type | 严重度 / 引擎 / 状态 / 总结果 |
| `AuditIssue` / `AuditRule` / `AuditEngineResult` / `AuditReport` / `AuditReportMetadata` | interface | 问题 / 规则 / 引擎结果 / 报告 |
| `ScreenshotInfo` / `FixSummary` / `EngineWeights` / `AuditThresholds` / `AuditViewport` / `AuditConfig` / `AuditContext` | interface | 截图 / 修复 / 权重 / 阈值 / 视口 / 配置 / 上下文 |

### 2.2 `./config/default-config` — 默认配置（`config/default-config.ts`）
| 符号 | 种类 | 用途 |
| --- | --- | --- |
| `DEFAULT_AUDIT_CONFIG` / `STRICT_CONFIG_PRESET` / `RELAXED_CONFIG_PRESET` | const | 默认 / 严格 / 宽松预设（通过阈值门禁区分） |
| `mergeConfig` / `getConfigPreset` | function | 配置合并与预设取值 |

### 2.3 审计编排与四引擎
| 符号 | 种类 | 用途 |
| --- | --- | --- |
| `AuditEngine` | class | **审计总入口**：编排四个子引擎 + 汇总评分 |
| `LayoutAuditEngine`（`LayoutRuleContext` / `LayoutRule`） | class/interface | 布局规则审计（溢出/重叠/对齐） |
| `VisualAuditEngine`（`PerSlideVisualMetrics`） | class/interface | 视觉审计：对比度 / 配色和谐 / 色彩丰富度 / 图底对比 |
| `ContentAuditEngine`（`ContentEngineOptions`） | class/interface | 内容审计：LLM 评判内容质量/正确性 |
| `FidelityAuditEngine`（`OverflowRecord` / `OverlapRecord` / `TruncationRecord` / `ImageLoadRecord` / `LayoutShiftRecord`） | class/interface | 保真度审计：溢出/重叠/截断/图片加载/布局偏移 |

### 2.4 视觉指标工具（`engines/visual-engine/metrics/*`，经 `metrics/index.ts` 整体公开）
| 符号（分组） | 种类 | 用途 |
| --- | --- | --- |
| 颜色：`rgbToHsl` / `rgbToHsv` / `relativeLuminance` / `contrastRatio` / `normalizeContrastScore` / `hueDistance` | function | 颜色空间换算与对比度 |
| 图像：`downsampleImage` / `toGrayscale` / `extractHsvHistogram` | function | 图像降采样/灰度/HSV 直方图 |
| 图底对比：`computeGridContrast` / `computeTextContrast` / `computeFigureGroundContrast`（`GridContrastResult` / `LowContrastPair` / `TextContrastResult` / `FigureGroundContrastResult`） | function/interface | 图底对比计算 |
| 配色和谐：`computeColorHarmony`（`HUE_TEMPLATES` / `ColorHarmonyResult`） | function/interface/const | 配色和谐度 |
| 色彩丰富度：`computeColorfulness`（`ColorfulnessResult`） | function/interface | 色彩丰富度 |
| 子带熵：`haar2D` / `computeSubbandEntropy`（`HaarSubbands` / `SubbandEntropyResult`） | function/interface | Haar 子带熵（视觉复杂度） |
| 视觉 HRV：`computeVisualHrv` / `calculateRmssd` / `sigmoidNormalize`（`VisualHrvResult`） | function/interface | 视觉 HRV（生理化美感指标） |

### 2.5 `./fix` — 自动修复与反馈
| 符号 | 种类 | 用途 |
| --- | --- | --- |
| `AutoFixer`（`FixResult`） | class/interface | **自动后处理修复**：确定性 HTML/CSS 变换修复布局/样式问题，随后二次验证 |
| `ResolutionStrategy`（`ResolutionAction` / `ResolutionDecision`） | class/type/interface | 解决策略：对每类问题给出 `auto-fix` / `regenerate` / `warn` / `pass` 决策 |
| `FeedbackBuilder` | class | 把 LLM/VLM 反馈构造为重生成提示词，回灌生成器 |

## 3. 包关系

- **依赖**：`@noppt/ai`（复用 LLM/VLM）、`@noppt/core`。
- **被依赖**：`@noppt/server`（仅 server 封装并暴露审核能力；web 不直接依赖 audit）。
- **与生成流水线**：server 在生成拼装完成后调用 `AuditEngine`；`AutoFixer` 修复可确定问题，`FeedbackBuilder` 把不可自动修复的问题回灌 `ai` 做自动重生成（保留最高分一版）。

## 4. 使用提示

- 严格度由 `AuditThresholds.pass/warn` 控制（strict/normal/relaxed 对应 80/70/50）；缺 `audit`/`auditVlm` 模型时该阶段会被跳过并告警，不会让生成失败。
- `ResolutionAction` 是审核→修复/重生成的总开关；新增审核规则时同步在 `ResolutionStrategy` 登记决策。
