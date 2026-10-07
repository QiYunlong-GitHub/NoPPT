# LLM-HTML 行为快照（deckToHtml 对标基准）

> 用途：记录现状「LLM 生成 HTML 预览」的真实样式/结构约定，作为新增确定性渲染器
> `deckToHtml`（`DeckNode[]` → 绝对定位 HTML/CSS）的对标基准。后续实现与 parity 测试
> 均以本文件为单一事实来源。
> 探查范围：`packages/ai`（html-presentation agent）、`packages/core`（deck schema + html-allowlist）。
> 本文件为只读调研产物；不修改任何业务代码。

---

## 1. 现状渲染管线（render.ts）

```
renderSlides
 ├─ generateSlideHtmlSafe(deps, slidePlan, rp, …)        // ★ LLM 调用：system=“只输出 HTML 代码”
 │     └─ buildSlideHtmlPrompt(...) → deps.contentProvider.chat(temperature=0.4, maxTokens=8192)
 │        → extractHtml(...)                            // 解析 <html> 片段
 ├─ postProcessSlideHtml(html, slidePlan, primary, primaryDark, W, H, bg, font, refAttrs)
 ├─ [可选] critiqueSlide(...) LLM 评审循环（未通过则带 feedback 重新生成）
 └─ applyMasterToSlideHtml(html, master)                // 幂等：hero 背景 + 母版层
```

`postProcessSlideHtml`（`palette.ts:67`）执行 18 个 pass（顺序固定）：

| #   | pass                          | 作用                                   | deckToHtml 是否需预生成替代             |
| --- | ----------------------------- | -------------------------------------- | --------------------------------------- |
| 1   | `sanitizeSlideHtml`           | 安全消毒                               | 是（deckToHtml 只输出白名单内标签/CSS） |
| 2   | `sanitizeStyleSyntax`         | 修正 style 语法                        | 是                                      |
| 3   | `sanitizeGradientColors`      | 跨色相渐变归一为 primary→darker        | 是（生成时颜色已定）                    |
| 4   | `enforceSinglePalette`        | 单色系红线重写                         | 是（生成时颜色已定）                    |
| 5   | `enforceBodyFontSize`         | 正文最小字号                           | 是                                      |
| 6   | `enforce8ptGrid`              | 8pt 网格对齐                           | 是（布局常量本就 8 的倍数）             |
| 7   | `fixRowImageMargins`          | 图片行边距                             | 否（图片节点可自带）                    |
| 8   | `wrapTextNodes`               | 文本包裹                               | 否                                      |
| 9   | `flattenMeaninglessNesting`   | 压平无意义嵌套                         | 否                                      |
| 10  | `ensureSemanticWrapping`      | 语义包裹                               | 否                                      |
| 11  | `ensureImageProperWrapper`    | 图片包裹兜底                           | 否                                      |
| 12  | `postProcessLayout`           | 版式后处理（标题色/构图）              | 是（布局阶段已定版式）                  |
| 13  | `ensureImageRatio`            | 图片比例                               | 否（节点 rect 已定）                    |
| 14  | `enforceSingleColumn`         | 单列约束                               | 否                                      |
| 15  | `injectBackgroundPlaceholder` | 背景占位（仅 backgroundEnabled）       | 否（deck 无此概念，跳过）               |
| 16  | `assertGrid8pt`               | 8pt 网格自检                           | 是（生成时保证）                        |
| 17  | `injectStructuredGraphics`    | **图表内联 SVG**（chart/architecture） | 是（改为原生 SVG 渲染）                 |

> 关键结论：**deckToHtml 必须把 1–6、12、16、17 在「节点→HTML」阶段一次性做对**，
> 从而跳过这些 pass；其余 pass（7–11、13–15）可选择性在 `deckToHtml` 后再跑一次
> `sanitizeSlideHtml` 等「与标记无关」的安全 pass 作为 parity 兜底（取舍由 parity 快照测试决定）。

---

## 2. 根容器约定（deckToHtml 起点）

- 现状根 `<div>` 由 LLM 产出，经 `ensureRootRelative` / `injectHeroFirst` 注入 `position:relative`。
- **deckToHtml 必须直接产出**：
  ```html
  <div style="position:relative;width:1280px;height:720px;background:#FFFFFF;font-family:…;"></div>
  ```
- 背景取 `slide.background`（solid/gradient）→ 解析后写 `background` / `background-color` / `background-image`。
- **严禁用 `inset`**：历史坑（`html-allowlist.ts` 注释，pres_mtp807ui 复盘）web 端曾漏放行 `inset`
  导致母版层被剥成 0 尺寸。一律用 `top/left/right/bottom` 四边属性。

---

## 3. 文本 / 标题（deck-to-html 必须复用 DECK_FONT_SIZE）

| 语义          | 标签                                       | 字号(pt)                                     | 颜色                                   | 对齐         |
| ------------- | ------------------------------------------ | -------------------------------------------- | -------------------------------------- | ------------ |
| H1 封面大标题 | `<h1>`（或 `<div>` 但 `slide.title` 已填） | 92 (`h1`)                                    | `ctx.primary`                          | center       |
| H2 页标题     | `<h2>`                                     | 50 (`h2`)                                    | `ctx.primary`（参考页用 `titleColor`） | left         |
| H3 卡片标题   | `<h3>`                                     | 28 (`h3`)                                    | `ctx.primary`                          | left         |
| 正文          | `<div>`/`<p>`/`<li>`                       | 20 (`body`) / 18 (`bodySm`) / 16 (`caption`) | `ctx.text` / `ctx.textMuted`           | 跟随 `align` |
| 数值/统计     | —                                          | 88 (`value`) / 56 (`stat`) / 44 (`quote`)    | `ctx.primary`                          | center       |
| 分隔标题      | —                                          | 64 (`divider`)                               | —                                      | center       |

- 富文本：先 `escapeHtml` 再输出；`hyperlink` 渲染为 `<a>`（需落白名单）。
- 项目符号：`bullet:true` 段落渲染 `• ` 前缀或 `list-style`；`level` 控制缩进（8pt 网格）。
- **标题语义标签必须存在**：`audit` 的 `extractSlideTitle` 优先 `slide.title`，否则退回 `<h1>/<h2>` 正则。
  deckToHtml 保证 `slide.title` 已写，或对标题节点额外输出 `<h1>/<h2>` 兜底。
- 颜色策略：在生成时由 `resolveColorPolicyForPage(referenceVisualAttributes, pageType, primary, primaryDark)`
  - `ctx.text`/`ctx.textMuted` 解析后直接写 `color`，不依赖 `postProcessSlideHtml` 的字符串重写。

---

## 4. 卡片 / 形状（DeckShapeNode → `<div>`）

- 圆角：`border-radius: rectRadius * min(w,h)`（`rectRadius` 0–1；历史取值 0.1/0.12/0.15）。
- 背景：`solid(color)` → `background:#RRGGBB`（可带透明度 `transparency`→`#RRGGBBAA`）；
  `gradient(angle,stops)` → `background:linear-gradient(${angle}deg, #from, #to)`。
- 描边：`border:${width}px solid #color`（来自 `line`）。
- 阴影：`box-shadow`（来自 `shadow`，近似：`0 ${offset}px ${blur}px rgba(r,g,b,opacity)`）。
- 形状内文本 `text:DeckParagraph[]` 复用 text 渲染（见 §3）。
- 中性色取自 `DECK_NEUTRAL`：卡片底 `F9FAFB`、边框 `E5E7EB`、灰字 `6B7280`、深字 `1F2937`。

---

## 5. 图片（★ 最易踩坑）

### 两种占位标记（务必区分）

| 层      | 常量                                                  | 值                                | 判定                                 |
| ------- | ----------------------------------------------------- | --------------------------------- | ------------------------------------ |
| HTML 层 | `IMAGE_PLACEHOLDER`（`constants.ts:8`）               | `https://NOPPT_IMAGE_PLACEHOLDER` | `s.html.includes(IMAGE_PLACEHOLDER)` |
| Deck 层 | `DECK_IMAGE_PLACEHOLDER`（`core/deck/schema.ts:365`） | `noppt:image-placeholder`         | `isDeckImagePlaceholder(src)`        |

- **deckToHtml 消费 Deck 层占位**：`src === DECK_IMAGE_PLACEHOLDER` → 渲染**可见灰块**
  （`background:#E5E7EB` + 居中提示文字 `alt`），**绝不能**输出 `<img src="noppt:image-placeholder">`
  （VLM placeholder 模式会误判为「图片缺失/未加载」）。
- 真实图（`assemble-images` 回填 `src` 后）：`<img src="…" style="object-fit:cover;border-radius:16px;display:block;width:100%;height:100%">`。
- 占位图 `data-image-ratio` 由 `slide.imageRatio` 提供（现状 `4:3` / `16:9` / `21:9`）。

### 图片节点层决策（现状 render.ts 字符串手术，需上提到节点层 → image-plan-guard.ts）

- `isStructurePage(pageType)`：cover/toc/summary 恒不配图。
- `resolveSlideImageDecision({pageType, planNeedsImage, imagePreference, imageEnabled, hasPlaceholder})`：
  结构页 / `imagePreference==='none'` → `stripPlaceholder` / `needsImage=false`。
- `NEVER_UPGRADE_FOR_IMAGE`（现状 `render.ts:548` 与 `587` 两处重复集合，合并上提）：
  ```
  comparison-deep-dive, content-value-showcase, content-stats-highlight, content-image-background,
  content-zigzag, content-cards, content-compare, content-timeline, content-table,
  content-flowchart, content-org-chart, content-pyramid, content-matrix, content-quote,
  content-three-section, content-process-steps, content-icon-grid, content-section-divider,
  content-testimonial, content-chart-bar, content-chart-line, content-chart-pie,
  content-chart-donut, content-cycle, content-dashboard
  ```
  → 这些版式**禁止**被「纯文字 → 带图」升级。
- `slideHasMeaningfulBody(html)`：去标题/标签后纯文本 ≥ 6 字符（上提到节点层用 `keyPoints` 长度近似）。
- `injectImagePlaceholderForContentSlide` / `stripImagePlaceholders`：现状基于 JSDOM 操作 HTML，
  上提后改为对 `DeckSlide.nodes` 增删 `DeckImageNode`（内容页升级为 `content-image-left`/`content-image-top`）。

---

## 6. 表格（DeckTableNode → `<table>`）

- `<table>` 含 `<thead>/<tbody>/<tr>/<th>/<td>`，`colspan`/`rowspan` 由单元格 `colspan`/`rowspan` 决定。
- 表头首行加粗（`header:true`）；`border` 来自 `node.border`；`fontSize` 来自 `node.fontSize`。
- `colW`/`rowH` 定列宽/行高（px）；单元格 `fill`→`background`，`color`/`bold`/`align`/`valign` 直写。

---

## 7. 图表（★ deckToHtml 改原生 SVG）

- 现状：`postProcessSlideHtml` 的 `injectStructuredGraphics` 用 **受控内联 SVG**（NFR-2 静默降级：
  失败不抛错，降级为占位文本）。
- deckToHtml 改为从 `DeckChartNode.chart:DeckChartSpec` 直接渲染：
  - `bar` → `<rect>` 柱（`bar`/`barStacked`/`barStacked100`）；
  - `line` → `<polyline>`；
  - `pie`/`donut` → `<path>` 扇区（`donut` 留 `holeSize` 中空）；
  - 颜色取 `chart.colors` 或主题衍生（primary 系）；`title`/`unit`/`showLegend`/`showValue` 渲染为文本/图例。
- SVG 标签白名单已放行：`svg/path/circle/rect/polyline/polygon/line/g` + 属性
  `viewBox/fill/stroke/stroke-width/d/cx/cy/r/x/y/points/transform`（见 §9）。

---

## 8. 母版 / 参考图（★ 复用 applyMasterToSlideHtml，不重写）

`applyMasterToSlideHtml(html, master)`（`utils/apply-master-to-slide-html.ts`）已验证、幂等，deckToHtml 直接复用：

1. **Hero 背景** `injectHeroFirst`：把参考原图作为整页背景注入**根 `<div>` 自身 style**（非 z-index:-1 子层，避免被白底遮住）。
   - 带 `bbox{x,y,w,h}`：精灵图开窗公式 `background-size:(1/w)% (1/h)%, …; background-position:(x/(1-w))% …`；
   - 蒙版：`linear-gradient(0deg, rgba(15,23,42,0.38), rgba(15,23,42,0.38))` 置于 url 之上；
   - 幂等标记：`<!--noppt-hero-->` 注释。
   - **跳过条件**：`hasOpaqueDarkOrGradientBackground(html)` 为真（页面已自带深色/渐变背景）→ 不注入。
     → deckToHtml 对左对齐/浅底内容页**不要**自行写深色渐变根背景，以免挡掉 hero。
2. **母版层** `buildMasterLayer`：logo / header / footer / side / watermark，包裹为
   `<div class="noppt-master-layer" data-master="…" style="position:absolute;top:0;left:0;right:0;bottom:0;pointer-events:none;z-index:50;overflow:hidden;">`。
   - logo：P1 CSS 开窗（`background-size:(100/w)% (100/h)%, background-position:(x/(1-w))% …`），或 `<img>`。
   - 页脚：`bottom:18px;…;color:#6b7280;font-size:13px`。
3. `ensureRootRelative`：根 div 无 `position` 时补 `position:relative`（deckToHtml 已自带，保险）。

---

## 9. 安全白名单（core/src/security/html-allowlist.ts，单一真源）

- **标签**：`div span p h1-h6 ul ol li strong em b i u s del br hr a img table thead tbody tr th td
section article header footer main nav aside blockquote pre code sub sup small font mark center
video source svg path circle rect polyline polygon line g`。
- **属性**：`class style href src alt title width height colspan rowspan target rel
data-element-type data-group-scale-x/y data-slide-title data-slide-content data-image-ratio
data-noppt-id data-master data-master-hero(-wrap/-scrim) data-master-logo/header/footer/side/watermark
data-noppt-coverart data-layout contenteditable data-list-index face color size dir viewBox
fill stroke stroke-width stroke-linecap stroke-linejoin d cx cy r rx ry x y points transform xmlns`。
- **CSS 属性**（节选，全部放行）：`position left top right bottom width height min/max-* margin* padding*
border* background* color font-* text-* line-height letter-spacing vertical-align white-space
list-style* display flex* align-* justify-* gap grid* object-fit object-position transform*
box-shadow overflow* z-index cursor opacity visibility outline* user-select pointer-events
aspect-ratio box-sizing clip-path* mix-blend-mode text-shadow backdrop-filter filter
text-transform -webkit-text-stroke* font-variant-numeric writing-mode text-overflow will-change
transition animation background-blend-mode isolation **inset**`。
  - **注意**：`inset` 历史坑已修但**仍建议用 top/left/right/bottom** 以最大兼容。

---

## 10. DeckImageNode 模型（core/src/deck/schema.ts）

```ts
interface DeckImageNode extends DeckNodeBase {
  kind: 'image';
  src: string; // 占位时 = DECK_IMAGE_PLACEHOLDER，回填后为 data URL / http(s)
  fit?: 'cover' | 'contain';
  alt?: string; // 占位时 = imagePrompt
  radius?: number; // 圆角 px（现状默认 16）
}
export const DECK_IMAGE_PLACEHOLDER = 'noppt:image-placeholder';
export function isDeckImagePlaceholder(src: unknown): boolean; // src===常量 或 空串
```

- 节点树已在 `planToDeck` → `layoutSlideNodes` 阶段按 `needsImage`/`referenceHeroImage`
  建好图片节点（`imageNode(rect, sp.imagePrompt, 16)`，src=DECK_IMAGE_PLACEHOLDER）。
- `image-plan-guard.ts`（新）用 `isDeckImagePlaceholder` 判定，不再正则匹配 `<img>`/`IMAGE_PLACEHOLDER`。
- **结论**：`packages/core/src/deck/schema.ts` 本次**无需修改**。

---

## 11. 几何 / 主题常量（deck-to-html 必须复用，禁止重新发明）

来源：`deck/layout-templates.ts`（已与 HTML 版式约定对齐）。

| 常量                          | 值                                                                                  | 用途         |
| ----------------------------- | ----------------------------------------------------------------------------------- | ------------ |
| `DECK_PAD_X` / `DECK_PAD_Y`   | 64 / 48                                                                             | 外边距       |
| `DECK_GAP`                    | 24                                                                                  | 卡片/列间距  |
| `DECK_CONTENT_RECT`           | `{x:64,y:48,w:1152,h:624}`                                                          | 正文安全区   |
| `DECK_TITLE_H`                | 72                                                                                  | 标题区高     |
| `DECK_BODY_RECT`              | `{x:64,y:120,w:1152,h:552}`                                                         | 标题下正文区 |
| `DECK_FONT_SIZE`              | h1:92 h2:50 h3:28 body:20 bodySm:18 caption:16 value:88 stat:56 quote:44 divider:64 | 字号层级     |
| `DECK_NEUTRAL`                | cardBg:F9FAFB border:E5E7EB muted:6B7280 ink:1F2937 white:FFFFFF                    | 中性色       |
| `DeckLayoutContext`           | `{primary, primaryDark, background, text, textMuted, fontFamily?, style?}`          | 主题上下文   |
| `DEFAULT_DECK_LAYOUT_CONTEXT` | primary:2563EB primaryDark:1D4ED8 bg:FFFFFF text:1F2937 muted:6B7280                | 默认值       |

Helper（直接复用）：`solid(color,transparency?)`、`tint(color,alphaHex)`、`gradientFill(from,to,angle=135)`、
`run(text,o?)`、`para(text,o?)`、`textNode(rect,paragraphs,o?)`、`shapeNode(rect,shape,o?)`、
`imageNode(rect,alt?,radius=16)`、`bulletList(rect,items,o?)`。
图表经 `layoutChart(kind)`（bar/line/pie/donut）产出 `DeckChartNode`（`{kind:'chart', rect, chart}`），
spec 由 `toDeckChartSpec(sp.chart, kind, kind)` 归一。

`planToDeck`（`plan-to-deck.ts`）为**纯 TS、无 DOM 依赖**：

- `buildLayoutContext`：primary 取自 `plan.primaryColor`，`primaryDark=darkenHex(primary)`（按 0.18 压暗）。
- `buildDeckMaster` / `buildDeckTheme` / `buildDeckMeta` 构造 deck 级母版/主题/元信息。

---

## 12. 审计 HTML 假设（deckToHtml 必须满足，否则审计误报）

`@noppt/audit` 各引擎消费 `presentation.slides[].html` 契约不变；deckToHtml 产物即新 `slide.html`。

| 引擎                                                              | 约束                                                         | deckToHtml 必须满足                            |
| ----------------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------- |
| VLM（`visual-engine/vlm-critique.ts` + `slide-renderer.ts`）      | placeholder 模式忽略灰块、final 模式评审终稿                 | 占位图 = 可见灰块（非无效 URL `<img>`）        |
| LLM（`content-engine/llm-critique-adapter.ts` → `critiqueSlide`） | `extractSlideTitle` 优先 `slide.title` 否则 `<h1>/<h2>` 正则 | `slide.title` 已填 或 标题输出 `<h1>/<h2>`     |
| `detectBlackBlockTitle`（`audit-engine`）                         | 检测 `background` 简写覆盖 `background-clip:text` 黑块标题   | **绝不**生成此类标题                           |
| `rootContainerCentered`（`audit-engine`）                         | 左对齐参考时根容器含居中三件套则误报                         | 根容器仅 `position:relative`，不输出居中三件套 |
| re-validation                                                     | 两套 HTML 跑 `runLlmCritique` + `vlm-critique`               | 评分不回退、不抛错                             |

---

## 13. 现状是否有 golden HTML 快照样本

- 搜索结论：在 `packages/ai/src/agents/html-presentation` 下**无** `toMatchSnapshot` /
  `*.snap` / golden `.html` fixture；`postProcessSlideHtml` 各 pass 也无快照基准。
- **后果**：parity 测试需**首次采集**——用现状 `generateSlideHtmlSafe` + `postProcessSlideHtml`
  - `applyMasterToSlideHtml` 在当前环境对代表性 `SlidePlan`（覆盖 cover/content-image-left/
    content-cards/content-chart-bar/summary 等）落盘为 `deck/__tests__/__snapshots__/llm-*.html`，
    再断言 `deckToHtml(planToDeck(plan), {referenceMaster})` 在 DOM 结构 + 关键样式上等价。

---

## 14. 实施要点回顾（来自本快照）

1. deckToHtml 输出根 `<div style="position:relative;width:1280px;height:720px;…">`，再调
   `applyMasterToSlideHtml(html, master)` 注入 hero + 母版层（复用，不重写）。
2. 颜色/字号/8pt 网格/图表在生成时一次做对，跳过 `postProcessSlideHtml` 的颜色与图表 pass。
3. 图片占位 = 可见灰块；真实图 = `<img object-fit:cover border-radius:16px>`。
4. 仅输出 §9 白名单内标签/CSS；优先四边属性而非 `inset`。
5. 不修改 `schema.ts` / `render.ts` 既有导出 / `audit` 包；图片决策上提到 `image-plan-guard.ts` 节点层。
