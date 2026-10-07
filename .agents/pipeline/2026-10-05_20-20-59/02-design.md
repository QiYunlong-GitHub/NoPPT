# Presentation Visual Integrity Bug Fix — Technical Design

## Overview

本设计将 `PresentationPlan → Deck → canonical HTML → editor preview/export` 收敛为一条可追踪的语义链，修复 `pres_musb7z42_ls8yvjc` 的裁切、空内容、HTML/Deck 分叉、响应式和字体不可观测问题，同时保留历史 HTML、缺失 `slide.deck`、人工 HTML、编辑器操作和 HTML-to-Deck 导出 fallback。设计基于 `.agents/pipeline/2026-10-05_20-20-59/01-requirements.md`、`.kiro/specs/presentation-visual-integrity/bugfix.md` 与已审核的 `.kiro/specs/presentation-visual-integrity/design.md`；本次检查没有发现该运行目录中的 `design-review.json`，因此没有需要回环处理的审查意见。

当前仓库是 pnpm workspace，技术栈锁定为 TypeScript 5.4、Vitest、React 18/Vite、NestJS 10、`@noppt/core` 的零依赖 Deck schema、`@noppt/ai` 的纯 TypeScript 生成器、`@noppt/audit` 的 `playwright-core` 浏览器审计，以及现有 `@noppt/web`/`@noppt/server` API 边界。不引入第二套布局引擎、不调用 `noppt_generate`，不要求安装专有字体，也不启动长驻服务作为验证步骤。

源码核对显示：`SlidePlan` 目前只有 `keyPoints`/`metricValues`/`showcaseMetrics` 等弱结构字段；`planToDeck` 直接调用 `layoutSlideNodes` 并对异常 plan 仍生成 Deck；`layout-content.ts` 用 `splitTitleBody` 将无分隔符策略句当作 title；`layout-advanced.ts` 可从无结构 key point 生成空 value/label；`layoutSummary` 只取第一个 key point；`deck-to-html.ts` 的文本、shape、table、chart 容器默认 `overflow:hidden`；`presentationToDeck` 只按 `slide.deck` 是否存在选择 Deck 或 DOM fallback；`EditorLayout` 将含固定 1280×720 根节点的 HTML 放入固定尺寸容器并 `transform: scale`；`useZoom` 只调整缩放；`VisualAuditEngine` 当前无法启动 Chromium 时返回 error，字体检查只统计 computed family；`runFinalWrite` 先写正式 `presentation.json`，`runAutoAudit` 再审计且失败不阻断。目标演示的只读证据与这些观察一致：5 页均有外层 padding/overflow 与内层固定画布，第 2 页 HTML 单列而 Deck 双栏，第 3 页有 4 个空指标节点，第 4 页是 3 张固定高仅标题卡，第 5 页有 summary 丢点风险，且没有视觉完整性事件闭环。

最终架构如下：

```text
PresentationPlan
  └─ normalizeSlideContent / validateSlideContent
       └─ validated Typed Slide Contract + contentId
            └─ planToDeck(strict) → Deck (唯一语义/逻辑几何真值)
                 └─ deckSlideToHtml → canonical HTML (屏幕表示)
                      ├─ EditorLayout viewport adapter / DOM edit adapter
                      ├─ presentationToDeck parity gate / Deck→PPTX
                      └─ integrity audit: content + geometry + parity + font + visual
```

所有自动修复先进入 `.visual-integrity/<runId>/` 的隔离 candidate；原始运行时文件只读。只有显式 promotion API 在通过策略和用户确认后才可写活动版本；本次目标回归不调用 promotion。

## 1. 责任边界与数据契约

### 1.1 Typed Slide Contract

在 `packages/ai/src/agents/html-presentation/deck/slide-contract.ts` 新增纯 TypeScript 模块，在 `packages/ai/src/types.ts` 增加以下可选字段。旧字段保留，旧客户端可忽略新增字段：

```ts
interface ContentBase {
  contentId: string;                 // 1–128 个安全字符，slide 内唯一
  legacyDerived?: boolean;
  sourceIndex?: number;
}
interface ComparisonItem extends ContentBase {
  leftText: string;
  rightText: string;
  leftGroup?: string;
  rightGroup?: string;
  bullet?: boolean;
}
interface MetricItem extends ContentBase {
  label: string;
  value: string;
  description?: string;
  trend?: 'up' | 'down' | 'flat';
}
interface CardItem extends ContentBase {
  title?: string;
  body: string;
  compact?: boolean;
}
interface SummaryItem extends ContentBase {
  text: string;
  role?: 'point' | 'action' | 'takeaway';
}
interface ContentOmission extends ContentBase {
  reason: string;
  status: 'omitted' | 'needs_review';
}
```

`SlidePlan` 增加 `comparisonItems?`、`metricItems?`、`cardItems?`、`summaryItems?`、`omissions?`。字段全部可选以兼容历史输入，但在 `pageType` 对应的 strict 生成路径中由 normalizer 补齐并校验。

`normalizeSlideContent(slide, index)` 是唯一 legacy adapter：

- `content-compare` 优先读取 `comparisonItems`；如果只有 `keyPoints`，按来源顺序保留每一整句，只有存在明确的左右分隔格式时才拆成左右文本，否则生成 `legacyDerived` 的单侧/需复核 item，不伪造另一侧事实。不能安全组成配对项时返回 `contract_fail`，而不是用空 item 补位。
- `content-stats-highlight` 优先读取 `metricItems`，其次使用 `showcaseMetrics`，最后对 `keyPoints` 做可逆的数字/单位解析。解析不到非空 label 时保留完整句子作为 label，并将 value 缺失记录为 `needs_review`；不得把空字符串当 value。
- `content-cards` 优先读取 `cardItems`。`splitTitleBody` 能安全识别标题/正文时分别填充；无法识别时将完整 key point 作为 `body`，`title` 为空且 `compact=true`，不得生成虚假的标题或说明。
- `summary` 优先读取 `summaryItems`，否则每个非空 `keyPoint` 生成一个 `legacyDerived` item；不再只读取 `[0]`。
- 其它页型继续读取 `keyPoints`，但 required 文本在进入布局前必须非空且保留原顺序。

`validateSlideContent` 返回 `{ normalized, issues, requiredItems, omissions }`，不在纯校验函数中抛出。每个 issue 包含 `code`（如 `empty_required_text`、`duplicate_content_id`、`unpaired_compare_item`、`metric_count_mismatch`）、slide index、contentId、字段路径、期望/观测摘要和 `recoverable`。文本只在受保护 candidate artifact 中保存完整原文；普通日志只保存 hash 和截断摘要。

限制：标题最长 500 字符；单项文本最长 10,000 字符；每页 item 最多 32 个；`contentId` 只允许字母、数字、`_-.`，长度 1–128；超限、非字符串、空 required 字段和重复 identity 产生结构化错误。解析器不修剪事实内容，只移除边界空白并保留原文摘要。`omitted` 只有输入明确提供原因时才合法；自动推断失败只能是 `needs_review`，不能作为完整通过。

### 1.2 Deck schema 与 identity

在 `packages/core/src/deck/schema.ts` 的 `DeckNodeBase` 增加可选 `contentId?: string` 与 `source?: 'plan' | 'manual' | 'legacy'`，不改变现有节点联合类型。文本节点的多个 paragraph 共享 item 的 `contentId`；compare 的 bullet marker 与正文放在同一个 `DeckParagraph`，不创建孤立 bullet 节点。形状、图片、渐变、装饰节点没有 contentId，审计时由 `role=decoration` 排除。

Deck 仍是唯一语义和逻辑矩形真值。`DeckSlide` 保留 `id/pageType/title/nodes/layoutParams`，新增可选 `contentManifest` 与 `layoutProfile` 仅用于追踪，不要求旧客户端理解。所有 required text、item identity、列/组归属和节点 rect 都从 Deck 反查。

### 1.3 plan-to-deck API 兼容策略

在 `plan-to-deck.ts` 增加：

```ts
interface PlanToDeckResult {
  deck?: Deck;
  normalizedPlan: PresentationPlan;
  issues: PlanContractIssue[];
  status: 'pass' | 'fail' | 'needs_review';
}
function buildValidatedDeck(plan: PresentationPlan, options?: PlanToDeckOptions): PlanToDeckResult;
```

`PlanToDeckOptions` 增加 `validationMode?: 'legacy' | 'strict'`、`fontProfile?`、`layoutProfile?`。生成链路使用 `strict`：存在 error 时不返回可持久化 Deck，并将 issue 交给上层重试/候选报告。为保持现有直接调用者和历史测试，`planToDeck` 保留原返回 `Deck` 的 API；默认走 `legacy` adapter，但调用 strict builder 发现 error 时抛出带 `code/issues` 的 `PlanContractError`，不再伪造完整 required 节点。只依赖旧 `keyPoints` 且可安全适配的历史计划仍成功。

`packages/ai/src/agents/html-presentation-agent.ts` 及其 render stage 使用 `buildValidatedDeck`，将 `Deck` 和 manifest 一起放入 `RenderedSlide`。`RenderedSlide` 增加可选 `deck?: DeckSlide`、`contentManifest?`、`integrityStatus?`；旧 LLM-HTML feature flag 仍保留，但生成页必须标记 `source=manual/legacy` 并经 parity gate，不能冒充 Deck parity。

## 2. 逻辑画布与测量布局

### 2.1 单一坐标语义

`packages/core/src/deck/geometry.ts` 的 `SLIDE_W_PX/SLIDE_H_PX` 作为 1280×720 logical canvas 唯一来源。`layout-primitives.ts` 的 `DECK_CONTENT_RECT/DECK_BODY_RECT` 继续基于该常量，但不再把“固定标题高”当作事实。新增：

```ts
interface LayoutMetrics {
  width: number;
  height: number;
  lineHeight: number;
  lines: number;
  status: 'measured' | 'heuristic' | 'unverified' | 'failed';
}
interface LayoutProfile {
  name: 'standard' | 'compact' | 'reflow-1x2' | 'reflow-2x2' | 'legacy-fallback';
  logicalWidth: 1280;
  logicalHeight: 720;
  density: 'normal' | 'compact';
}
```

生成 Deck 的 rect 永远是 1280×720 逻辑像素。Presentation 自定义 `width/height` 只作为导出/显示目标，通过显式线性变换映射，不能成为第二套内容坐标。历史 HTML-only 数据保留其原始坐标，转换结果标记 `source=html`、`geometryFallback=true`。

### 2.2 文本测量与超限顺序

在 `layout-primitives.ts` 增加 `measureText`, `fitTextRect`, `allocateVerticalRegions`。生成阶段使用无 DOM 的确定性测量器：CJK 字符按字体 profile 的 em 宽度、拉丁/数字按字符类别估算，显式返回 `heuristic`；同一文本、字号、字体 profile 和宽度必须稳定。浏览器阶段使用 DOM/canvas 实测覆盖 heuristic，并在结果中记录 `measured/heuristic/unverified/failed`。

布局处理顺序固定为：

1. 保持原字号层级并自然换行；
2. 根据测量结果增大文本区域并压缩相邻安全间距；
3. 在不低于 page-type 最小字号的范围内缩字号、收紧行高；
4. 切换已声明的 compact/reflow profile；
5. 若仍不满足，返回 `geometry_out_of_bounds`/`text_measure_failed` 的 `fail` 或环境不足时 `unverified`，禁止删除文本或仅靠 `overflow:hidden` 取得通过。

标题的最终字号、行数、行高、rect、测量状态和采用的 profile 写入 Deck node metadata/IntegrityReport。`titleBlock` 不再固定使用 `DECK_TITLE_H=72` 隐藏超出的标题；其它页型的正文高度由标题实际需求和剩余空间计算。

### 2.3 具体布局修改

- `layout-content.ts`：cover 标题先测量；content-compare 使用 typed paired items；cards 根据 body 测量选择完整/compact 卡片，动态计算 cell height；summary 渲染所有 summary items。
- `layout-advanced.ts`：stats/value showcase 只使用非空 `MetricItem`，无 description 使用紧凑 value+label 卡并记录 `descriptionState=not_provided`；卡片/指标列数在标准和窄屏 profile 间确定性选择。
- `layout-templates.ts`：在 clamp 前执行 required node 边界校验。装饰节点可以被 `clampToSlide` 处理；required 内容超界不得静默 clamp，必须返回 issue。
- `layout-engine.ts`：继续保留历史 `normalizeAISlide` 和 sanitize，但对 canonical Deck HTML 不 flatten/重写 identity；旧双重固定画布生成 warning。sanitize 失败是 candidate 的 fatal issue，不能继续保存为完整通过。

第 1 页标题会使用实际内容高度和 fallback 字体 profile 计算，不能固定 `92px/112px`；第 2 页两栏各两个 compare item，第一项 bullet 和正文共享同一 paragraph；第 3 页四个 metric item 各有非空 value/label 或逐项 omission；第 4 页三项 strategy 以完整 body 或 compact single-text 卡显示；第 5 页所有 summary item 逐项显示或有明确 omission。

## 3. Canonical HTML、parity 与导出

### 3.1 Deck → HTML

改造 `packages/ai/src/agents/html-presentation/deck/deck-to-html.ts`：

- 根节点输出 `data-noppt-canvas="logical"`、`data-logical-width="1280"`、`data-logical-height="720"`、`data-slide-id` 和 `data-page-type`。外层 viewport 只负责缩放/居中，不增加 padding 或内容坐标。
- 每个正文元素输出 `data-content-id`、`data-deck-node-id`、`data-role`；compare 输出一个 compare root、两个带 group 标识的 column 和 item 节点。
- bullet marker 由同一 paragraph 的 CSS/text renderer 输出，禁止单独的 `<p>•</p>`。
- required text 节点不输出 `overflow:hidden`；必要时使用 `overflow:visible`/自然高度。shape、图片和装饰可继续裁剪自身内容，但不能包住并遮蔽 required text。
- 所有文本继续 HTML escape，href 继续只允许 `http/https/mailto`；生成的 HTML 仍通过现有 allowlist/sanitize。渲染器遇到非法 Deck node 不抛给用户，而返回带 node id 的 render issue；strict candidate 将该 issue 视为 fail。

canonical HTML 仍是纯 TS、无 DOM 依赖，PPTX 仍消费同一个 Deck，不增加第三种布局算法。已有 `referenceMaster`/master 注入保留，但 master 只能增加可标识的 decoration/header/footer，不得覆盖 required content。

### 3.2 Content/parity manifest

在 `packages/audit/src/engines/content-engine/content-compare.ts` 新增统一 manifest：

```ts
interface ContentManifestEntry {
  contentId: string;
  text: string;
  role: string;
  order: number;
  group?: string;
  column?: 'left' | 'right' | string;
  source: 'plan' | 'deck' | 'html' | 'editor' | 'export';
  required: boolean;
}
interface ParityResult {
  status: 'pass' | 'fail' | 'unverified';
  missing: ContentManifestEntry[];
  extra: ContentManifestEntry[];
  mismatches: Array<{ contentId?: string; field: string; expected: string; observed: string }>;
}
```

比较顺序固定为 contentId、normalized text、role、order、group/column、required flag、节点数量和 logical rect containment；装饰不参与 required coverage。规范化只折叠空白和 bullet 表示，不删除正文。计划→Deck、Deck→HTML、HTML→editor DOM、export input 逐阶段生成 manifest，同一 contentId 必须可回查。

### 3.3 Editor save 与导出

`packages/web/src/export/presentation-to-deck.ts` 增加 `presentationToDeckWithIntegrity`，返回 `{ deck, source, parity, issues }`；保留现有 `presentationToDeck` 返回 `Deck` 的兼容包装。

- 有 `slide.deck` 且 generated/canonical identity parity 通过：Deck 优先导出，`source=plan`。
- 有 Deck 但 HTML 与 Deck parity 失败：返回 `parity_mismatch`，导出 UI/API 拒绝静默导出，调用方收到可定位的 `needs_review` 错误；不自动选择较短的 HTML。
- HTML-only、旧数据或人工 HTML：继续 `htmlToDeck`，返回 `source=html`、`geometryFallback=true`、`parity=unverified`/`needs_review`；合法图片、渐变、shape、list、table、card 仍由现有 parser 保留。
- `deck-to-pptx.ts` 只接收通过 schema/geometry 的 Deck，不改变导出 API；HTML fallback 继续可以生成同页数 PPTX，但报告不能标为 Deck parity pass。

Editor 保存适配器在 `packages/web/src/utils` 新增 `canonicalDomToDeckPatch`：带 `data-content-id` 的文本变化只更新对应 Deck run；DOM rect 通过 viewport inverse transform 转回 logical rect。无法映射的新增/删除/手工结构将 slide 标成 `source=manual`，保留 HTML 并走 HTML fallback，同时生成 warning。保存不丢失原 HTML；如果 required content 被删除，轻量 gate 返回 422/`content_missing`，UI 保留未保存状态并提示用户，不覆盖活动文件。

## 4. EditorLayout/useZoom 响应式设计

新增 `packages/web/src/layouts/viewport-adapter.ts`（纯计算）并在 `useZoom.ts` 使用：

```ts
interface ViewportState {
  logicalWidth: 1280;
  logicalHeight: 720;
  viewportWidth: number;
  viewportHeight: number;
  scale: number;
  profile: 'narrow' | 'standard' | 'wide';
  userZoom?: number;
}
```

`scale = min(availableWidth / 1280, availableHeight / 720)`，只在可用尺寸大于 0 时更新，范围保留现有 `0.25..2`。用户手动 zoom 仍覆盖自动 fit；窗口变化只更新 fit scale，不篡改用户 override。`ResizeObserver` 直接更新 `ViewportState` 和 profile，不依赖多次定时器竞态。

`EditorLayout.tsx` 改为：外围 `editorAreaRef` 可滚动；一个 viewport wrapper 负责居中/实际尺寸；一个 logical canvas 是唯一绝对定位坐标根。移除固定画布外层 padding + 内层固定画布组合对有效内容的遮蔽；required 内容不由 canvas `overflow:hidden` 隐藏。`contentRef` 仍接收当前 HTML，`slideContainerRef`、SelectionOverlay、GuidesOverlay、pointer handlers、文本编辑、复制粘贴、撤销/重做、页面切换和保存接口不改名。

指针坐标统一为：

```ts
logicalX = (clientX - canvasRect.left) / renderedScale;
logicalY = (clientY - canvasRect.top) / renderedScale;
```

选择框和 resize box 由同一 `renderedScale` 正向映射。窄屏安全 profile：compare 由 2×1 切 1×2，cards 由 3 列切 1/2 列，stats 由 4 列切 2×2；item order/contentId 不变。没有安全 profile 时完整缩放 logical canvas，不允许水平滚动作为读取正文的前提。目标验证固定覆盖 800×600、1280×720、1600×900 及窄→标准→宽→窄连续 resize。

## 5. FontProfile 与字体可观测性

在 `packages/audit/src/engines/visual-engine/font-profile.ts` 定义：

```ts
interface FontProfile {
  declaredFamily: string;
  fallbackStack: string[];
  requestedWeights: number[];
  language?: string;
  source: 'theme' | 'deck' | 'browser' | 'default';
}
interface FontObservation {
  declaredFamily: string;
  resolvedFamily?: string;
  weight: string;
  sizePx: number;
  lineHeight: string;
  status: 'resolved' | 'fallback' | 'unverified' | 'failed';
  metricDelta?: number;
  checkedNodes: number;
  reason?: string;
}
```

`font-icon-check.ts` 保留现有 icon 统计，并在 `document.fonts.ready` 后对 title/body required 节点执行 `document.fonts.check`、computed style、DOM `scroll/client` 尺寸和 canvas/DOM measurement delta。声明字体与首个 fallback 相同才是 `resolved`；字体不可用为 `fallback`，API/Chromium 不可用为 `unverified`，读取/测量异常为 `failed`。metric delta 超过配置阈值触发 reflow；无法重排时为 warning/fail/unverified，绝不伪造 pass。

`SlideRenderer` 增加 `renderSlideAtViewport`/`observeSlide`，等待字体和可访问本地图片；Chromium 启动失败由完整性 orchestration 转为 `unverified`，而不是将环境缺失伪装为产品 fail。字体 profile 不强制专有字体，系统 fallback 不阻断与其无关的编辑操作。

## 6. Integrity audit、保存门禁和日志

### 6.1 审计接口

在 `packages/audit/src/engines/integrity/` 新增纯确定性检查模块，并从 `packages/audit/src/index.ts` 导出：

```ts
interface IntegrityInput {
  presentation: Presentation;
  plan?: PresentationPlan;
  runId: string;
  phase: 'exploration' | 'candidate' | 'preview' | 'save' | 'promotion' | 'rollback';
  viewports: Array<{ width: number; height: number }>;
  fontProfile?: FontProfile;
  browser?: SlideRenderer;
}
interface IntegrityReport {
  runId: string;
  presentationId: string;
  status: 'pass' | 'warn' | 'fail' | 'unverified' | 'needs_review';
  slides: IntegritySlideReport[];
  checks: IntegrityCheckResult[];
  artifacts: string[];
  baseHash?: string;
}
```

检查分为：contract/content coverage、empty required text、logical bounds、required clipping/CSS overflow、nested fixed canvas、Deck/HTML parity、font state、viewport matrix、source/fallback status。结构化 check 可在无浏览器时运行；浏览器检查缺失只产生 `unverified`，但 required structural error 仍是 `fail`。自动修复后使用新的 input hash 重跑全部受影响检查，不复用旧 pass。

扩展 `AuditReport` 的可选 `integrity?: IntegrityReport`，不改变既有 audit engine 的 `passed/warn/fail/error` 联合值，避免破坏旧客户端。`latest-report.json` 仍可读取，但新完整性报告在 candidate reports 中保存完整状态。

在 `packages/audit/src/engines/layout-engine/rules/index.ts` 注册 `no-required-content-clipping`、`logical-canvas-boundary`、`no-empty-required-text`、`no-fixed-nested-canvas`；规则只处理 required/content 节点，装饰节点不误报。`ContentAuditEngine` 保留 `validateKeyPoints` 兼容检查，并追加 identity coverage；不再跳过空 key point 而不留 issue。

### 6.2 生成和保存门禁

`runFinalWrite`、`runAutoAudit` 和 `PresentationService.save` 共享 `IntegrityGate`，但按来源分级：

- strict generated candidate：contract/content/geometry/parity 必须 pass；browser/font 不可用为 unverified，候选可保留但不可宣称整体通过或 promotion。
- editor manual save：先执行同步 content/geometry 检查。required 删除、越界或 parity 破坏返回 `IntegrityGateError`，HTTP 层返回 422 与 `code/reportPath`；未触发缺陷的 legacy HTML 允许保存并标 `needs_review`。
- export：Deck parity fail 或 required geometry fail 直接拒绝；HTML-only fallback 允许导出但携带降级元数据。
- final write：先 sanitize → build candidate → run integrity gate → 写 candidate artifacts；只有 `writePolicy='active'` 且策略通过才写活动 `presentation.json`。目标演示及本次回归固定为 `candidate_only`。

具体失败语义：

| 操作 | 失败条件 | 调用方收到 | 级别/恢复 |
|---|---|---|---|
| plan normalize/validate | 类型、空 required、重复 identity、数量不匹配 | 结构化 issues；strict builder 不返回 Deck | 可修复，回到计划/LLM 重试；不写盘 |
| layout/measure | required rect 越界、测量失败、无安全 profile | `IntegrityReport` fail 或 unverified | 内容越界为 fatal；环境测量缺失为 unverified |
| Deck→HTML | 非法节点、sanitize 拒绝、identity 无法输出 | render issue + candidate fail | fatal；保留 candidate 诊断 |
| parity/export | missing/extra/mismatch contentId、column/role 不同 | `parity_mismatch`/`needs_review`，不输出静默结果 | 需人工/修复后重试 |
| editor save | required 内容删除/越界或保存前 gate 失败 | HTTP 422，UI 保留 unsaved changes | 可恢复；原始活动文件不变 |
| browser/font | Chromium、document.fonts、外部资源不可用 | unverified 原因和 artifact 路径 | 可重试；不能标 pass |
| snapshot/candidate | 读源、hash、原子写或 manifest 失败 | candidate run failed | fatal；保留已创建快照，不改源 |
| promotion | base hash/updatedAt 漂移、required 非 pass、无确认 | 拒绝 promotion 的明确 code | fatal；重新快照或人工确认 |
| rollback | snapshot 读回/schema/hash 不一致 | `rollback_failed` | fatal；不删除 snapshot，告警 |
| Hermes draft | schema/素材限制或 draft write 失败 | MCP 标准错误；成功只给 openUrl | 参数错误可修复；不触发生成 |

### 6.3 ai-log 事件

新增 `IntegrityEventWriter`，正常运行时可经 `LogsService` 写事件；目标 candidate 运行时写入 `.visual-integrity/<runId>/candidate/ai-log.jsonl`，不追加正式只读 `ai-log.jsonl`。每个 `render`、`visual_validation`、`audit`、`fix` 事件至少包含：`runId`、presentationId、slideIndex、phase、source、pageType、viewport、logicalCanvas、expected/observed count、empty/out-of-bounds/clipped count、parity、font summary、status、fixAction、durationMs、errorCode、artifactPath。只写 content hash/截断摘要，不写 API key、完整素材全文或完整外部响应。事件写入失败不会抹掉报告；若 required evidence 无法持久化，整体 candidate 状态为 `unverified`/`needs_review`，不能宣称通过。

## 7. 隔离 snapshot/candidate/preview/promotion/rollback

新增 `packages/server/src/modules/presentation-integrity/integrity-artifact-store.ts` 与 `presentation-integrity.service.ts`。使用现有 `StorageService` 的 contained path、原子 JSON 写入和序列化写锁，不新增绕过 storage 安全检查的文件写入。

`runId` 为 `[A-Za-z0-9_-]{8,80}`；路径固定为目标 presentation 目录下：

```text
.visual-integrity/<runId>/
  original/
    presentation.json
    ai-log.jsonl
    chat-history.json
    assets.manifest.json
    reference-attrs.manifest.json
    manifest.json
  candidate/
    presentation.json
    ai-log.jsonl
    reports/latest-report.json
    diff.json
  preview/
  reports/
  screenshots/
```

`createSnapshot` 只读并 hash 原始 `presentation.json`、`ai-log.jsonl`、`chat-history.json`、assets 文件清单/文件 hash、reference-attrs 文件清单/文件 hash，并写 `sourceRevision`、mtime、presentationId、createdAt、SHA-256。它不修改源目录。candidate 每个产物写入 `baseHash` 和 source revision；preview 读取 candidate，不把 candidate URL 冒充正式 presentation。

`promoteCandidate` 需要显式 operator/confirmation、candidate report 和 promotion policy；在写之前重新检查原始 base hash/mtime，漂移则拒绝。原子临时文件/rename 或活动版本指针切换前保留 `active-original`。本次任务的 service 只暴露/测试接口，不从目标回归调用它。`rollback` 只从快照或指针恢复，读回验证字节 hash、JSON schema、页数和顺序；失败状态保留全部 artifact。

目标运行时目录中的 `presentation.json`、`ai-log.jsonl`、`chat-history.json`、`assets/`、`reference-attrs/` 只作为输入。不得通过 `PresentationService.get` 的 normalization side effect 写回目标；目标回归使用 `auditPresentationFromData`/candidate data API，不能调用现有会产生正式 report 的路径，除非 report 已重定向到 candidate artifact store。

## 8. Hermes mock contract

`packages/server/src/modules/mcp/mcp.controller.ts` 与 `draft-store.ts` 的契约固定为：

- `PrepareDraftArgsSchema` 要求 `topic` 为 1–500 字符；`slideCount` 为 1–40；`referenceText` 为可选字符串；`mode` 使用 `z.literal('auto').default('auto')`，不接受 guided。
- `referenceTextLimit(slideCount)` 只使用 `clamp(3000, 20000, 800 * slideCount)`；输入素材的优先级由调用方按重要性先排序，截断永远从尾部进行，因此头部重要内容保留。长度统计按 JavaScript 字符，空白输入视为无素材。
- `createDraft` 仍只落服务器草稿，不触发 LLM、队列、正式 presentation 写入、candidate promotion 或 `noppt_generate`。
- MCP 成功响应对外只返回 `{ openUrl }`；draftId、mode、素材统计留在内部 audit/mock observation，不放入工具成功 payload。`openUrl` 仍由 `buildOpenUrl` 生成，包含 `ai=1`、草稿 scope `t/u`、签名 token，Web 打开 config 界面等待确认。
- key 只通过 `MCP_NOPPT_API_KEY`/现有 `readMcpEnv` 路径读取；测试用环境变量 mock，不能把 key 写入源码、fixture、log 或 candidate。

参数校验失败沿用现有 `McpError`/Zod 映射，返回 E3001/E3002/E3005；草稿存储失败返回内部错误并保证没有 generate 调用。contract test 对 `noppt_generate` 设置 reject spy，断言调用次数为 0；对 promotion service 设置 spy，断言调用次数为 0。

## 9. 文件级实现边界

### `@noppt/core`

- `packages/core/src/deck/schema.ts`：Deck node identity/source metadata。
- 必要时 `packages/core/src/deck/geometry.ts`：统一 1280×720 常量、logical transform helper。
- `packages/core/src/models/slide.ts`：仅增加可选 integrity/source metadata，保持历史 JSON 可读。

### `@noppt/ai`

- `packages/ai/src/types.ts`：typed content types、SlidePlan/RenderedSlide 可选字段。
- 新增 `.../deck/slide-contract.ts` 及 unit/property tests。
- `plan-to-deck.ts`、`layout-primitives.ts`、`layout-content.ts`、`layout-advanced.ts`、`layout-templates.ts`：normalization、测量、动态区域、contentId、目标五页修复。
- `deck-to-html.ts`：canonical root、identity attributes、required overflow 规则、bullet ownership。
- `html-presentation-agent.ts` 与 render/finalize stage：严格 plan→Deck→HTML 传递和 candidate metadata。

### `@noppt/audit`

- `src/types.ts`：完整性报告/状态的可选公共类型。
- 新增 `engines/integrity/content-compare.ts`、`geometry-check.ts`、`integrity-engine.ts` 及 tests。
- `engines/content-engine/index.ts`、`key-points-validator.ts`、`html-text-utils.ts`：完整 coverage/omission issue。
- `engines/layout-engine/rules/index.ts`：required geometry/clipping rules。
- `engines/visual-engine/font-icon-check.ts`、`slide-renderer.ts`、`visual-engine/index.ts`：FontProfile、viewport matrix、unverified。
- `src/index.ts`：导出 integrity API，不删除既有引擎。

### `@noppt/web`

- 新增 `src/layouts/viewport-adapter.ts` 与测试。
- `src/hooks/useZoom.ts`、`src/layouts/EditorLayout.tsx`：响应式 scale/profile、pointer inverse mapping、保留交互。
- 新增 DOM→Deck patch/parity helper；必要时在 `SelectionOverlay`/selection utility 只替换坐标计算，不改变操作 API。
- `src/export/presentation-to-deck.ts`、`html-to-deck.ts`、`pptx/deck-to-pptx.ts`：strict parity result、Deck 优先和历史 fallback。

### `@noppt/server`

- 新增 `modules/presentation-integrity/integrity-artifact-store.ts`、`presentation-integrity.service.ts` 及 snapshot/candidate/promotion/rollback tests。
- `modules/presentation/presentation.service.ts`：save 前调用轻量/strict gate，保留 legacy fallback。
- `modules/ai/postprocess/final-write.ts`、`auto-audit.ts`：先 candidate gate 后写；自动修复后重新审计；目标 run 禁止正式写入。
- `modules/logs/logs.service.ts`：新增脱敏 integrity event writer，不改变旧动态日志兼容。
- `modules/mcp/mcp.controller.ts`、`draft-store.ts`：auto-only、预算、openUrl-only mock contract。

目标目录下的正式文件不在修改列表中；所有目标产物只能出现在 `.visual-integrity/<runId>/`。

## 10. 测试设计与执行顺序

每个实现任务遵循“先补失败测试 → 运行确认失败 → 实现 → 重跑同一测试 → preservation 回归”。不新增依赖；property 测试使用现有 Vitest 加固定 seed 的生成器/表驱动随机组合，避免引入未锁定包。浏览器测试使用仓库已有 `playwright-core`；Chromium 不存在时保存 unverified artifact。

1. **Bug-condition exploration**：新增 `packages/audit/src/engines/visual-engine/__tests__/presentation-visual-integrity.exploration.test.ts`。只读目标原件，snapshot hash 后提取五页 HTML/Deck/pageType/title/text/rect/log events；确认长标题、compare divergence/bullet 分离、4 个空 metric、3 个空 card、summary coverage、font evidence、事件缺失。当前实现预期 `FAIL (expected)`；读取失败不能伪造产品失败。
2. **Preservation baseline**：新增 AI/Audit/Web preservation suites，使用合法 synthetic fixtures 覆盖旧 HTML、missing Deck、valid Deck、图片/渐变/shape/list/card，以及页面选择、缩放、编辑、复制粘贴、撤销/重做、保存、PPTX fallback。修复前通过；浏览器/字体未知为 unverified。
3. **Typed contract**：先测空串、重复 id、compare 不配对、metric 数量不一致、card 无 body、summary 全量、legacy keyPoints，再实现 contract/plan-to-deck/prompt contract。重复运行 task 1 和 task 2，不改断言迎合实现。
4. **Logical canvas/measurement**：先测 title fit、rect bounds、measurement status、随机中英数字标题和窄 profile，再实现布局 primitives 和五页 layout。
5. **Compare**：先测任意 paired items 的两栏等量、顺序、identity、bullet 同 paragraph，再实现 compare builder/HTML/parity。
6. **Stats**：先测 label/value、无 description、中文数字单位、legacy key point、长度不一致，再实现 metric layout；断言无 required empty text。
7. **Cards**：先测 title/body、完整策略句、compact 卡、1/2/3 列、窄屏顺序，再实现动态 card layout。
8. **Summary/content audit**：先测 exact/partial/missing/explicit omission/decoration exclusion，再实现全量 summary 和 content compare issue。
9. **Canonical HTML/export**：先测 identity attrs、root、bullet、required overflow、Deck 优先、HTML fallback、parity fail 阻断，再实现 canonical renderer 和 export result。
10. **EditorLayout/useZoom**：先测 800/1280/1600 与连续 resize、scale/profile、pointer inverse、selection/save，再实现 viewport adapter 和布局调整。
11. **Font**：先测 resolved/fallback/unverified/failed、weight、delta threshold、缺 document.fonts，再实现 FontProfile/renderer observation。
12. **Audit/log**：先测规则注册、五页事件、runId、敏感信息脱敏、自动修复重审和证据缺失阻断，再接入 audit service/postprocess。
13. **Playwright**：先写五页×三 viewport×双向 resize 的失败测试，检查文本/rect/scroll-client/CSS clipping/截图；实现后 Chromium 缺失只能出 unverified。
14. **Isolation lifecycle**：先测 snapshot manifest、candidate path、baseHash conflict、required fail/unverified promotion reject、explicit promotion、atomic rollback；实现 artifact store/service。
15. **Hermes**：先测 only prepare tool、auto、预算、head-preserving truncation、openUrl-only、config deep link、no generate/no promotion/key not persisted，再改 controller/store。
16. **Target candidate regression**：创建一次性 runId/original manifest，读取目标原件构建 candidate，运行五页 content/parity/geometry/font/visual、editor/export 和日志检查；只写隔离目录，不 promotion。
17. **Checkpoint**：一次性执行受影响包 test、typecheck/build，并按仓库脚本执行 `pnpm typecheck`、`pnpm test`、`pnpm gates:check`、`pnpm deps:circular`；不启动 server/watch，不调用 generate。

建议定向命令保持 task order，例如：

```text
pnpm --filter @noppt/audit test --run presentation-visual-integrity.exploration
pnpm --filter @noppt/ai test --run slide-contract plan-to-deck deck-to-html
pnpm --filter @noppt/audit test --run integrity visual
pnpm --filter @noppt/web test --run presentation-to-deck EditorLayout useZoom
pnpm --filter @noppt/server test --run presentation-integrity mcp
pnpm --filter @noppt/ai typecheck
pnpm --filter @noppt/audit typecheck
pnpm --filter @noppt/web typecheck
pnpm --filter @noppt/server typecheck
pnpm typecheck
pnpm build
```

命令均为一次性运行；如果 Chromium、字体、外部资源或运行时服务不可用，报告必须保留 `unverified`，不能将它降级为 pass。测试失败产物和 candidate 不删除。

## 11. 关键不变量与验收映射

1. **内容不变性**：任何 required plan item 在 normalized plan、Deck、canonical HTML、editor/export manifest 中具有相同 contentId；缺失只能是显式 omission。由 contract/content compare 负责。
2. **几何不变性**：required rect 满足 `0≤x,y`、`x+w≤1280`、`y+h≤720`；装饰可独立处理。由 layout builder 生成前和 audit rule 双重负责。
3. **单画布**：编辑器选择框、pointer、HTML preview 和 PPTX export 均以 logical 1280×720 坐标，经 viewport adapter 只做缩放。由 core geometry、web adapter、export 负责。
4. **表示一致**：Deck parity 通过才走 Deck export；manual/legacy fallback 必须带 source/geometryFallback 降级标志。由 parity engine 和 `presentationToDeckWithIntegrity` 负责。
5. **未知不通过**：浏览器/字体/外部服务不可用是 unverified/needs_review；任何汇总器不得将其转成 pass。由 IntegrityReport gate 负责。
6. **原始保护**：snapshot hash 是 candidate 的 baseHash；目标 run 任何 preview/fix/save 都不写原始文件。由 artifact store 和 target regression harness 负责。
7. **保存闭环**：任何自动 fix 后必须对新 candidate 重新执行 content/geometry/parity/font/visual 检查，并写 render/visual_validation/audit/fix 事件。由 final-write/auto-audit/integrity service 负责。
8. **兼容保留**：缺失 Deck 的 HTML-only、sanitize、normalizeAISlide、合法视觉元素和编辑导出能力必须有 preservation tests；由 adapters 而非删除旧路径负责。
9. **Hermes 边界**：只备料并返回 openUrl/config；`noppt_generate` 与 promotion 调用次数为 0。由 MCP contract test 负责。

该设计满足 requirements 1–11 与 acceptance criteria 1–20 的实现路径；它定义的是模块、接口、失败语义和验证证据，不在本阶段修改应用源码或正式演示原始数据。
