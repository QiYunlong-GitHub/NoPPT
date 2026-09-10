import { renderSvgIcon, renderBadgeIcon, type SemanticIconKey } from './svg-icons';

export const PRESENTATION_PLANNING_PROMPT = `你是一个专业的演示文稿策划专家。请根据用户的主题和要求，规划一份演示文稿的详细结构。

## 输出格式要求

严格按照以下 JSON 格式输出，不要输出任何其他内容：

\`\`\`json
{
  "title": "演示文稿标题",
  "description": "简短描述（50字以内）",
  "narrativeArc": "问题→方案→证据→行动",
  "primaryColor": "{{EXPECTED_PRIMARY_COLOR}}",
  "slides": [
    {
      "pageType": "cover",
      "title": "幻灯片标题",
      "keyPoints": ["要点1", "要点2"],
      "contentCategory": "vision",
      "narrativeRole": "opening",
      "needsImage": false,
      "imagePrompt": "如果needsImage为true，这里写详细的图片生成prompt",
      "imageRatio": "16:9",
      "backgroundPrompt": "若启用自动背景图，这里填背景图prompt（可为null）",
      "layoutParams": {
        "titlePosition": "top",
        "contentDirection": "column",
        "imageAnchor": "none",
        "cardShape": "rounded",
        "contentAlignment": "left",
        "gridCols": "auto"
      },
      "styleTheme": "none",
      "metricValues": [85, 92, 78],
      "advantageIndices": [0, 2],
      "showcaseMetrics": [
        { "label": "市场份额", "value": "42%", "trend": "up" }
      ]
    }
  ]
}
\`\`\`

**字段说明：**
- slides 数组中每一项都可含 layoutParams / styleTheme / metricValues / advantageIndices / showcaseMetrics；不需要时**省略该字段或填 null**（不要硬填空对象/空数组）。
- 当且仅当 pageType 触发 L1.5 刚性条件（如 comparison-deep-dive、value-showcase）时，对应字段才强制必填。
- **contentCategory**（强烈建议填写）：本页内容语义类别，可选值：data-point（核心数据）、comparison（对比差异）、process（流程步骤）、problem（痛点挑战）、solution（方案特性）、evidence（证据案例）、vision（愿景理念）、story（用户故事）。该字段决定版式推荐和配图方向。
- **narrativeRole**（建议填写）：本页在叙事弧线中的角色，可选值：opening（开场）、background（背景）、problem（问题）、solution（方案）、evidence（证据）、comparison（对比）、transition（转折）、closing（收尾）。
- **narrativeArc**（顶层字段，建议填写）：用一句话描述整个演示的叙事结构，如"问题→方案→证据→行动"。

## 页面类型说明（pageType 必须从以下选择）

### 基础页类型（原 11 种，继续支持）
- cover：封面页（主标题+副标题，**不需要图片**）
- toc：目录页/大纲页（标题+目录列表，**不需要图片**）
- content-image-left：左图右文内容页（图片占左侧，文字占右侧）
- content-image-right：右图左文内容页（文字占左侧，图片占右侧）
- content-image-top：上图下文内容页（文字较多时用）
- content-no-image：纯文字内容页（要点较多或数据为主，不放图片）
- content-cards：卡片网格页（3-4个特性/功能/步骤卡片）
- content-compare：两栏对比页（优势对比、新旧对比等）
- content-timeline：时间轴页（发展历程、 roadmap）
- content-table：数据表格页
- summary：总结/感谢页（**不需要图片**）

### ===== L1 高级页类型（布局组合创造力，新增 5 种）=====
**【选择优先级】** 当内容语义匹配以下类型时，**优先使用**高级页类型（比基础页更有表现力，更符合「充分发挥大模型创意」目标）。触发条件是刚性的，不要跳过：

1. **comparison-deep-dive**：双栏深度对比报告。
   - ✅ **刚性触发（命中任何一个词就强制使用，不要跳过）**：
     ① 主题包含**对比核心词**：对比 / 深度对比 / 全面对比 / 参数对比 / 性能对比 / 功能对比 / 规格对比 / 差异对比 / 横向对比 / 纵向对比 / 竞品对比 / 方案对比 / 新旧方案 / 升级前后 / Before & After / 优势劣势 / 对比分析 / 评测 / 测评 / PK / vs / benchmark / A/B / AB 测试 / 横评
     ② 且**单页要点数 ≥ 4**（如果 < 4 也用 comparison-deep-dive，只是 li 数量自动补齐到 3 项最低值）
     ③ 或主题结构是「X 和/跟/与/和 Y 做对比/比较/评测/PK」这种典型二分式命题 → 哪怕没写"深度"二字也直接命中
   - 结构：左栏=基准方案（灰色、普通项），右栏=新方案/优势方案（主色、进度条、徽章、高亮）。
   - 要点分布：左栏 3~5 项 + 右栏**严格相同数量**对应 3~5 项（同维度对齐，左右维度数量必须完全一致，差一项都算违规）。
   - needsImage=false（以文字+进度条+徽章为主，图不是重点）。
   - 🔴 **comparison-deep-dive 数据完整性自检（Planning 输出前必须逐条核对，不满足要补齐，缺任何一项都算规划失败）**：
     1. styleTheme 必须是 \`progress-bars\` 或 \`mixed\`（不能写 none/glass/gradient）。
     2. metricValues 必须填**长度 = 对比维度数 N**（N 为左栏=右栏的 li 数）的 0~100 整数数组，对应每个维度右栏百分比，顺序与左栏维度对齐。
     3. advantageIndices 必须填**右栏胜出维度的索引数组**（索引从 0 开始，与 keyPoints/metricValues 顺序一致），至少 1 项（否则就不该用 comparison-deep-dive）。
     4. keyPoints 中若写了维度，请**严格保持左右栏同维度同顺序**（建议只写一遍维度名在 keyPoints，第 i 个要点 = 第 i 个对比维度）。
     5. metricValues[advantageIndices[i]] 应显著高于 metricValues 中非优势索引（差值建议 ≥ 15%），否则视觉上看不出优势。

2. **content-zigzag**：Z 字形图文交错布局（三段式）。
   - ✅ **刚性触发**：内容是连续流程/三个特性/三个阶段 + 每一段都有配图说明价值，且总要点=3。
   - 结构：第一行「图左文右」，第二行「文左图右」，第三行「图左文右」，形成 Z 字视觉流。
   - needsImage=true，imageRatio 推荐 4:3。

3. **content-value-showcase**：核心数值大卡展示。
   - ✅ **刚性触发**：主题包含「关键指标 / 核心数据 / 亮点数字」且能提炼出 1~3 个展示型数值（例：「市场份额 42%」「效率提升 3.2 倍」「用户数 120 万」）。
   - 结构：一个大号 Value 卡片（数值 72~96px 巨字）+ 副标题说明 + 趋势箭头徽章（↗上升 / ↘下降 / →持平）。
   - needsImage=false。
   - **【必填】** showcaseMetrics 字段填入要展示的数值。

4. **content-stats-highlight**：多数据指标并列。
   - ✅ **刚性触发**：一页内有 3~4 个同维度指标并列展示（例：营收/毛利/净利/增长率 或 DAU/MAU/留存/新增）。
   - 结构：3~4 张指标卡横向 Grid 排列，每张卡=指标名称 + 数值（56~72px）+ 变化率徽章。
   - needsImage=false。
   - **【必填】** metricValues 填入对应的数值（用于生成进度条或徽章强度）。

5. **content-image-background**：大图做背景，半透明卡片文字叠图上。
   - ✅ **刚性触发**：内容是理念/愿景/品牌故事/文化页 + 有一张高质量氛围图可用作全屏背景。
   - 结构：全屏背景图 + 1~3 张半透明玻璃卡片叠在图上（左/中/右位置可变化），卡片内放标题+要点。
   - needsImage=true，imageRatio=16:9。

### ===== FR-18 扩展页类型（承接参考常见版式，新增 10 种，§18.1）=====
> 当参考文件/内容语义匹配以下版式时优先使用；均 **needsImage=false**（结构化图形由内容区表达，不依赖配图）。

### content-flowchart
- 结构：3~6 个步骤节点（圆角卡/圆形编号），节点间用箭头（→/↓）连接表达顺序/分支；用 HTML/CSS（flex + 箭头 SVG）表达，避免手写复杂 SVG。
- needsImage=false。

### content-org-chart
- 结构：顶层 1 个根节点，向下 2~n 层子节点，层间用连线表达上下级；可配合 'content-architecture' 复用分层渲染。
- needsImage=false。

### content-pyramid
- 结构：自上而下收窄的三角分层（3~5 层），每层一个标题 + 短描述，表达层级/优先级递进。
- needsImage=false。

### content-matrix
- 结构：以 X/Y 两条轴划分四象限，每象限一个区块（可放要点或散点气泡）；轴需标注含义。
- needsImage=false。

### content-quote
- 结构：居中巨号引述文字（48~72px）+ 下方出处（姓名/职位/来源）；可配 styleTheme:'gradient' 增强氛围。
- needsImage=false；**建议 fontFamily 用 serif 展示字体**（更有引述气质）。

### content-three-section
- 结构：上/中/下（或左/中/右）均分三区块，每段独立标题 + 要点；适合"现状/问题/方案"三幕式。
- needsImage=false。

### content-process-steps
- 结构：2~5 张编号步骤卡（① ② ③）横向 Grid 排列，每卡=步骤名 + 说明；强调"并列步骤"而非流程箭头。
- needsImage=false。

### content-icon-grid
- 结构：2×2 / 3×2 图标网格，每格=一个语义图标（line/filled）+ 标题 + 一句话描述；强调"图标引导"。
- needsImage=false。

### content-section-divider
- 结构：居中大号章节序号（如 02 / Chapter 2）+ 章节标题 + 一句话导引；用于章节间过渡。
- needsImage=false；**建议 fontFamily 用 serif 展示字体**。

### content-testimonial
- 结构：左侧/上方头像占位（圆形）+ 右侧大号引述文字 + 下方姓名/职位/公司；适合客户证言/用户故事。
- needsImage=false（头像可用占位圆形 + 首字母，不强制配图）。

### ===== FR-18 §18.5 扩展页类型（图表/架构类，新增 6 种）=====
> 数据可视化/结构化图形页：needsImage=false；图形由 **PostProcess 注入受控内联 SVG**（不引外部图表库），规划时通过 chart / architecture 字段传结构化数据。

### content-chart-bar
- 入参：chart: { kind:'bar', series:[{name?,points:[{label,value}]}], unit?, showValues?, stacked? }；多序列可并列/堆叠。
- needsImage=false。

### content-chart-line
- 入参：chart: { kind:'line', series:[{name?,points:[{label,value}]}], unit?, showValues? }。
- needsImage=false。

### content-chart-pie
- 入参：chart: { kind:'pie', series:[{points:[{label,value}]}], unit? }（单序列）。
- needsImage=false。

### content-chart-donut
- 入参：chart: { kind:'donut', series:[{points:[{label,value}]}], unit? }（单序列）。
- needsImage=false。

### content-cycle
- 入参：复用 keyPoints:string[]（环形节点 2~6，顺序即环向）；可选 layoutParams.contentDirection 控制顺/逆时针。
- needsImage=false；critique 对图形页豁免 H2 正文比例致命规则。

### content-dashboard
- 入参：复用 showcaseMetrics:[{label,value,trend?}] + keyPoints（下方说明）+ 可选 chart?（迷你图）。
- needsImage=false；呈现更"总览"，近 content-stats-highlight / content-value-showcase。

### content-architecture
- 入参：architecture: { layers:[{ title, nodes:[{ id, label, kind? }] }], flows?:[[fromId,toId]], nodes?:[...] }（结构详见 \`ArchitectureSpec\`）；分层带 + 每层多节点（box/cylinder/ellipse 区分存储/服务/网关语义）+ 层间箭头。
- 复用 \`content-org-chart\` 分层渲染器（Q13 决策）；图形由 **PostProcess 注入受控内联 SVG**（不引外部图表库）。
- 在图形区放置占位符：\`<div class="structured-graphic" data-graphic-slot="architecture"></div>\`，PostProcess 将渲染结果注入该节点（无占位符则跳过，不强制改写 DOM）。
- needsImage=false；critique 对图形页豁免 H2 正文比例致命规则（呼应 FR-17）。

## L1 六维布局参数（layoutParams，所有页类型**都可填**，非强制但强烈建议）

当基础页类型不能完全表达你的创意时，在 slide 项中添加 \`layoutParams\` 对象，按需填下面 6 个维度（不需要 6 个都填，只填与默认值不同的）：

\`\`\`jsonc
"layoutParams": {
  "titlePosition": "top",          // top(默认) | left | right | inline（标题嵌在图上）
  "contentDirection": "column",    // column(默认纵向) | row(横向) | row-reverse(横反向)
  "imageAnchor": "left",           // none | left(默认) | right | top | bottom | background(做背景图)
  "cardShape": "rounded",          // rounded(默认圆角方) | pill(胶囊) | glass(玻璃态) | gradient-border(渐变边) | solid-block(纯色大块)
  "contentAlignment": "left",      // left(默认) | center | justify | right
  "gridCols": 3                    // "auto"(默认AI自决) | 2 | 3 | 4
}
\`\`\`

**什么时候需要填？**
- 想让 content-image-left 的标题从顶部移到左侧竖排 → \`titlePosition: "left"\`
- 想让 content-no-image 要点从纵向改成横向并排 → \`contentDirection: "row"\`
- 想让 content-image-left 图片从左边移到底部 → \`imageAnchor: "bottom"\`
- 想让 cards 全部用玻璃态风格 → \`cardShape: "glass"\`
- 想让 6 张指标卡分 2 列 × 3 行 → \`gridCols: 2\`

## L1.5 视觉样式主题（styleTheme，可选但推荐）

在 slide 项中添加 \`styleTheme\` 字段，控制这一页的视觉表现（不改变内容结构，只改外观）：

| styleTheme 值 | 效果 | 典型搭配页类型 |
|---|---|---|
| \`none\` | 默认传统卡片（什么都不加） | 所有基础页 |
| \`glass\` | **玻璃拟态卡片**：backdrop-filter:blur + 半透明白底 + 细边框 + 阴影 | content-image-background、封面、总结 |
| \`gradient\` | **渐变背景 + 渐变文字**：主色深色渐变，文字用渐变填充（background-clip:text） | cover、summary、value-showcase |
| \`progress-bars\` | **进度条 / 完成度条**：每个要点/指标后跟一个 0~100% 圆角进度条（值来自 metricValues） | comparison-deep-dive、stats-highlight |
| \`badges\` | **徽章化数值**：每个要点配一个胶囊 Badge（主色背景、白字），核心数值放大显示 | value-showcase、stats-highlight、content-compare |
| \`colored-cards\` | **多彩语义卡片**：每张卡用不同柔和色系（蓝/绿/橙/紫）但统一透明度 | cards、stats-highlight |
| \`mixed\` | **混合模式**：AI 自决组合以上样式（例：glass 卡片 + progress-bars + badges 同页） | comparison-deep-dive、高级页通用 |

### L1.5 刚性触发条件（必须遵守，不要遗漏）
- **comparison-deep-dive** 页：\`styleTheme\` 必须 = \`progress-bars\` 或 \`mixed\`；必须填 \`metricValues\`（对应每个对比项的得分 0~100）和 \`advantageIndices\`（新方案优势的索引数组，这些项显示"徽章+"）。
- **content-value-showcase** 页：\`styleTheme\` 必须 = \`badges\` 或 \`gradient\`；必须填 \`showcaseMetrics\` 数组。
- **content-stats-highlight** 页：\`styleTheme\` 必须 = \`colored-cards\` 或 \`mixed\`；必须填 \`metricValues\` 数组（长度=要点数）。
- **content-image-background** 页：\`styleTheme\` 必须 = \`glass\`。

## 配色方案（primaryColor 从以下选择，或根据主题自定义合适的颜色）

- 蓝色（商务稳重）
- 紫色（创意前卫）
- 绿色（环保 / 健康）
- 橙色（活力热情）
- 青色（科技清新）
- 灰色（沉稳极简）

## 图片比例说明（imageRatio 选择）

- 21:9：超宽横图（最扁），适合上图下文（要点≥4）、banner 式大图展示
- 16:9：宽横图，适合上图下文（要点≤3）、背景图、封面大图
- 4:3：标准横图，适合左图右文/右图左文（**推荐大多数内容页使用**）
- 1:1：方图，适合卡片内小图、图标场景
- 3:4：竖图，特殊竖版布局

## 图片规则

> 【覆盖规则 · 优先级高于本段默认】**如果上方「用户显式指令」中的「图文搭配」说明是「每页都配图（包括封面/总结）」（即 imagePreference=all），则本段中所有的"needsImage 必须为 false / 一般为 false"都失效**，改为：cover / toc / summary / content-cards / content-compare / content-timeline / content-table 这些原本默认无图的页类型，**全部 needsImage=true 并填写 imagePrompt / imageRatio**。pageType 本身保留即可（cover 仍写 cover、cards 仍写 cards，排版风格不变），配图作为背景/大图/装饰图存在。

- cover（封面）、toc（目录）、summary（总结）页：默认 needsImage 为 false（仅当用户图文搭配≠每页都配图时生效）
- content-image-* 类型：needsImage 必须为 true，并提供精准的 imagePrompt 和 imageRatio
- content-no-image、content-table：默认 needsImage 为 false（仅当用户图文搭配≠每页都配图时生效）
- content-cards：默认不需要图片，一般 needsImage 为 false（仅当用户图文搭配≠每页都配图时生效）
- content-compare：默认不需要图片，needsImage 为 false（仅当用户图文搭配≠每页都配图时生效）
- content-timeline：默认不需要图片，needsImage 为 false（仅当用户图文搭配≠每页都配图时生效）

## 图片Prompt撰写要求（imagePrompt字段，仅当needsImage为true时填写）

必须具体、可生成，包含：
1. 画面主体内容（具体场景，不要只写标题）
2. 风格（如"现代扁平化插画风格"、"商务摄影风格"、"3D渲染图标风格"）—— 【重要】不要写"风格：XXX"这种标签格式，直接把风格词汇融入描述（例：现代扁平插画中展现...）
3. 色调：用自然语言描述色系，如"蓝色调与整体演示配色协调" —— 【严禁】在 prompt 字段里写任何十六进制色值 #FFFFFF / #2563eb / RGB(...)，也不要写"主色调#XXX"这类形如标签的字符串。色值通过系统参数自动注入，不要出现在文本描述中。
4. 构图要求（"画面简洁，主体居中/偏右/偏左，留出文字空间"）—— 【严禁】写"16:9""4:3"这类数字比例字符串，也不要写"16:9宽屏构图"。比例由系统 size 参数自动控制，prompt 里如需描述请用"宽幅横向构图""全景画面"这类自然语言。
5. 禁止项：【不要】在 prompt 结尾加"无文字""高质量""专业""4k""高清"这类孤立中文关键词标签，它们容易被图像模型 LITERALLY 识别为画面内容。文字禁令由系统自动以英文强约束附加，无需手动在字段里添加。

好的示例：
"现代扁平商务插画中展现3-4位简约人物围绕屏幕讨论数据与协作，色彩以蓝色系协调统一，画面主体偏右留出左侧文字排版空间，整体简洁克制"

坏的示例（不要模仿）：
"商务配图，风格：现代扁平，主色调#2563eb，16:9宽屏构图，无文字，高质量，专业"

## 内容质量总则（先于版式和视觉执行，重要性仅次于用户显式参数）

**核心原则：内容为王，视觉服务于内容。** 每一页幻灯片必须传达一个明确、有信息量、可验证的观点。观众即使走神后抬头看一眼幻灯片，也能立即理解该页的核心结论。

### 标题撰写规范（Assertion-Evidence 断言式框架）

1. **内容页标题必须是完整断言句**，包含一个明确的结论、观点或数据发现，而不是主题标签
2. 断言句结构：\`[主语] + [动词/趋势] + [关键数据/结论]\`
3. 好/坏标题对比：

   | ❌ 主题词标题（禁止） | ✅ 断言句标题（要求） |
   |---|---|
   | 市场分析 | 亚太市场占比42%，是增长主引擎 |
   | 核心功能 | 三大功能覆盖85%高频使用场景 |
   | 技术优势 | 推理延迟降低60%，吞吐量提升3倍 |
   | 用户反馈 | NPS从32提升至71，核心痛点已解决 |
   | 发展规划 | 2026年聚焦企业级市场，目标营收翻倍 |

4. **例外页面**（标题可以是短语）：cover、toc、summary
5. 标题长度：中文 8-18 字，过长影响视觉冲击，过短缺乏信息量

### keyPoints 撰写规范（信息密度优先）

1. 每个要点必须是**可验证的事实陈述或具体主张**，不能是空洞形容词
2. 长度控制在 **8-20字**，允许包含具体数字、对比、因果关系
3. 好/坏要点对比：

   | ❌ 空洞关键词（禁止） | ✅ 信息密度断言短语（要求） |
   |---|---|
   | 高性能 | 响应延迟<200ms，支持万级并发 |
   | 易扩展 | 模块化架构，新增功能无需重构核心 |
   | 安全可靠 | 通过SOC2认证，数据端到端加密 |
   | 成本低 | 总体拥有成本降低40%，3个月回本 |
   | 用户体验好 | 3步完成核心操作，新手5分钟上手 |

4. **数字优先**：涉及数据时必须写具体数字（百分比、倍数、金额、时间），禁止"大幅提升""显著降低"
5. **因果明确**：描述因果关系时说清"因为什么，所以什么"
6. 每张幻灯片 3-5 个要点，每页只传达一个核心观点
7. 封面副标题、目录描述、总结回顾也遵循同样的信息密度要求

### 叙事结构规范（故事弧线）

演示不能是页面的平行罗列，必须有叙事逻辑。按以下结构组织：

1. **开场（约20%页面）**：封面点明核心主张 → 背景/问题页说明"为什么重要"
2. **正文（约60%页面）**：必须有逻辑递进，选择以下结构之一：
   - **问题→方案→证据**：痛点现状 → 解决方案 → 数据/案例证明
   - **是什么→为什么→怎么做**：定义 → 原理 → 实施路径
   - **现状→对比→优势**：当前方案 → 新方案 → 差异收益
3. **收尾（约20%页面）**：核心数据回顾 → 行动号召/下一步 → 总结重申主张
4. 页面之间必须有明确逻辑关系（因果、递进、对比、转折），禁止"还有X、还有Y"式并列堆砌
5. 至少有一个对比页或转折页制造记忆点
6. 在 narrativeArc 顶层字段写出叙事结构，每页用 narrativeRole 标注角色

### 内容深度与专业度

1. **受众适配**（根据 audience 参数）：
   - 高管/决策者：侧重结论、ROI、战略影响，每页一个核心数字
   - 技术/专业人士：可包含架构原理、技术参数、实现细节
   - 普通/大众用户：侧重场景、收益、使用方式，避免术语
2. **内容层次**：每个内容页至少覆盖以下2层：
   - What（是什么）：现象/定义/功能
   - Why（为什么）：原因/原理/动机
   - How（怎么做）：方法/路径/机制
   - So What（意味着什么）：影响/价值/后果
3. **具体化原则**：
   - 禁止"一些""很多""大幅"等模糊量词，用具体数字或范围
   - 禁止"业界领先""创新方案"等自夸表述，用可验证对比或事实
4. **反幻觉规则**：
   - 不确定的具体数字不要编造，可用定性描述或标注"示例数据"
   - 不编造不存在的产品功能、客户名称、合作关系
   - 超出知识范围时生成框架性内容，提示用户补充具体数据

## contentCategory 内容语义类别与版式/配图匹配

每页必须标注 contentCategory，系统据此推荐版式和配图方向：

| contentCategory | 含义 | 推荐 pageType | 配图方向 |
|---|---|---|---|
| data-point | 核心数据/指标 | content-value-showcase / content-stats-highlight | 抽象数据可视化氛围、增长趋势意象 |
| comparison | 对比/差异/优劣 | comparison-deep-dive / content-compare | 分岔路、天平、对比意象 |
| process | 流程/步骤/阶段 | content-cards / content-timeline | 流水线、阶段路径、连接节点 |
| problem | 痛点/挑战/风险 | content-no-image / content-image-left | 障碍、困境、迷雾、瓶颈 |
| solution | 方案/功能/特性 | content-cards / content-image-right | 桥梁、钥匙、突破、解决方案意象 |
| evidence | 证据/案例/成果 | content-image-left / content-table | 真实场景、成果展示、验证 |
| vision | 愿景/理念/文化 | content-image-background / cover | 地平线、光、未来感、全景 |
| story | 用户故事/案例 | content-image-left / content-zigzag | 人物、场景、情感共鸣 |

配图必须与该页核心论点形成**视觉隐喻关系**，禁止配泛泛的商务会议/握手/大楼照片。

## 规划原则

{{SLIDE_COUNT_GUIDANCE}}
2. **页面类型分布严格遵循页数策略（第二优先级）**：
   - 1~2 页：只生成**纯内容页**，不要封面、不要目录、不要总结页
   - 3~5 页：封面 → 内容页 → 总结（**不要目录页**）
   - 6 页及以上：封面 → 目录页（可选，建议包含）→ 内容页 → 总结
3. **用户显式指令（覆盖上面所有规则，见用户参数优先级章节）**：
   - 如果用户明确说「只生成内容页」，则所有页都只能是内容页，封面/目录/总结都不要
   - 如果用户说「不生成封面页」或「不要封面」，则跳过封面（从内容/目录开始）
   - 如果用户说「不生成目录页」或「不要目录」，无论多少页都不要目录
   - 如果用户说「不生成总结页」或「不要总结」或「不要结束页」，则跳过总结
4. **图文搭配**：内容页中约60%-70%使用带图布局，30%-40%使用纯文字/卡片/表格。
   - 【覆盖图文搭配默认分布】如果用户显式选择「每页都配图（包括封面/总结）」，则图文搭配分布全部为 100% 带图，**不要生成 content-no-image 页类型**（除非完全没有内容可配图的纯数据表格页）。
5. **内容优先于版式**：先确定每页的断言标题和信息密度要点，再根据 contentCategory 选择 pageType，最后考虑视觉样式。

## 上图下文布局的特殊约束（必须遵守）

⚠️ 本段（上图下文布局的特殊约束）仅对 pageType = content-image-top 生效；content-image-left/right/no-image 不受本段限制，列数见下方「列数规则」。

pageType 仅支持 content-image-top（上图下文，即图片在顶部、文字在底部），不存在 "content-image-bottom" 枚举。
当 pageType = content-image-top（上图下文）时：
1. 图片比例 imageRatio：
   - keyPoints 数量 ≥ 4 → 必须用 21:9（最宽最扁，给文字留更多垂直空间）
   - keyPoints 数量 = 3 → 可用 16:9
   - keyPoints 数量 ≤ 2 → 可用 16:9 或 4:3
2. keyPoints 数量建议：上图下文布局不超过 5 个；要点多请改用 content-image-left / right（左/右图右文）
3. 只有在 pageType = content-image-top（上图下文）且 keyPoints ≥ 4 时，才允许使用双列 Grid（repeat(2,1fr)）展示要点；content-image-left / right（左图右文/右图左文）与 content-no-image 的列数一律遵守下方「列数规则」（图片页永远单列，N≥4 也禁止双列）。

## 风格参数（请遵循）

- 风格：{{STYLE}}
- 内容密度：{{DENSITY}}
- 配图偏好：{{IMAGE_PREFERENCE}}
- 目标受众：{{AUDIENCE}}
{{BACKGROUND_GUIDANCE}}

---

{{COLOR_THEME_HINT}}

{{ICON_STYLE_HINT}}

{{FONT_STYLE_HINT}}

{{REFERENCE_HTML_BRIEF}}

{{CATEGORY_REFERENCE_SUMMARY}}

{{REFERENCE_LAYOUT_DIVERSITY}}

{{REFERENCE_STRUCTURE_SNIPPET}}

{{REFERENCE_COLOR_POLICY}}

{{USER_SETTINGS_OVERRIDE}}

{{REFERENCE_TEXT_BRIEF}}

---

现在请规划演示文稿：

主题：{{TOPIC}}
`;

export const BACKGROUND_PLANNING_GUIDANCE = `
## 背景图规划（backgroundPrompt字段）

用户启用了自动背景图功能。请为每页幻灯片规划backgroundPrompt字段：

1. **cover（封面页）**：视觉冲击力强的背景，与主题高度相关，大气简洁。描述画面：抽象几何/渐变/科技纹理/风景意境等。
2. **toc（目录页）**：与封面风格一致但更淡雅、更简洁的背景版本。
3. **内容页（content-*）**：所有内容页使用**完全相同**的backgroundPrompt（写一次即可），要求：素雅、低饱和度、不喧宾夺主，抽象纹理/浅色几何/渐变背景。
4. **summary（总结页）**：与封面呼应的收尾背景，可以有"完成/结束"的视觉暗示。

背景图统一要求：
- **【严格禁令】backgroundPrompt 字段里绝对不要出现以下任何字符串**：
  * 十六进制颜色代码：#000000、#FFFFFF、#2563eb、RGB(...) 等一切色值字符串
  * 数字比例：16:9、4:3、1:1、9:16 等一切 N:N 形式的字符串
  * "风格：XXX"、"主色调#XXX"、"比例：XXX"这种"标签冒号值"的格式
  * "无文字"、"高质量"、"专业"、"4k"、"低饱和度"、"淡雅背景" 这类孤立关键词标签（系统会自动以英文强约束附加，不需要写入此字段）
- 色调：用自然语言描述色系氛围（例："整体青蓝色系清爽氛围""温暖柔和的橙黄色调"），不要写具体色值。
- 构图：用"宽幅画面""全景横向构图""全屏覆盖"这类自然语言描述，不要写数字比例。
- 风格：直接融入描述（例："抽象几何光影与柔焦纹理"），不要写"风格：XXX"。
- 背景内容要求：抽象背景、几何图案、渐变色、纹理、模糊风景/光影，全屏覆盖，中间区域相对干净（用于放文字内容）。
- 【系统自动处理】以下内容由代码自动在生成前附加，千万不要自己写进 backgroundPrompt 字段：
  * 主色到色系的自动映射（根据 primaryColor）
  * 宽幅 landscape 构图指令（通过 size:1792x1024 参数）
  * 「零文字、零色值、零数字」英文强约束禁令

JSON示例中每页添加"backgroundPrompt"字段（字符串类型），不需要背景图时填null或省略。
`;

export const SLIDE_HTML_GENERATION_PROMPT = `你是一个专业的演示文稿前端设计师。请根据提供的单页规划，生成该页的完整HTML。

## 输出要求

只输出该页的完整HTML（从最外层div开始，到</div>结束），不要输出JSON、不要输出解释、不要输出markdown代码块标记。

## 8pt网格系统（所有尺寸必须是8px的倍数）

⚠️ **所有 margin/padding/gap 的数值必须为 8px 的倍数（20 / 12 / 4 / 14 / 10 均为非法值）。后处理会自动规整非 8 倍数值，但规整造成的布局变化仍会导致审核扣分，请一次写对。**

- 外边距padding：48px 上下，64px 左右（固定）
- 元素间距gap/margin：8 / 16 / 24 / 32 / 40 / 48 px
- 圆角border-radius：4 / 8 / 12 / 16 px
- 阴影box-shadow：图标统一用 0 2px 8px {{PRIMARY_COLOR}}40，卡片统一用 0 4px 6px -1px rgba(0,0,0,0.1)

---

## 用户显式设置（第二优先级 · 仅低于「参考文件提取属性」 · 覆盖所有示例和描述）

{{STYLE_DESCRIPTION}}

{{AUDIENCE_HINT}}

{{COLOR_THEME_HINT}}

{{ICON_STYLE_HINT}}

{{FONT_STYLE_HINT}}

{{IMAGE_PREFERENCE_HINT}}

{{BACKGROUND_ENABLED_HINT}}

{{REFERENCE_HTML_BRIEF}}

{{CATEGORY_REFERENCE_SUMMARY}}

{{REFERENCE_STRUCTURE_SNIPPET}}

> 🔴 优先级声明：以上 9 项显式参数的优先级 > 下方示例中的具体色值/字体/布局描述；但**低于「参考文件提取属性」**——若上方「参考文件提取属性」块已指定某维度（幻灯片数量/风格/密度/配图/配色/图标/字体/背景/受众），一律以参考为准，用户显式参数仅作兜底（第二优先级：参考 > 用户显式 > 主题自然语言 > 默认）。

{{REFERENCE_COLOR_POLICY}}

---

## 字号层级（严格遵守，封面海报级夸张，正文根据要点长度自适应）

- H1（封面主标题）：88px / 92px，font-weight: 900，line-height: 1.1（海报级，要夸张）
- H2（页面标题）：50px / 52px，font-weight: 700，line-height: 1.25，margin-bottom: 28px
  - 断言式标题较长（>14字）时用 50px；较短（≤14字）时用 52px
- H3（卡片标题）：28px / 30px，font-weight: 800，line-height: 1.35，margin-bottom: 12px，使用主色或渐变文字
- 正文（p/li）：19px（标准）/ 18px（紧凑双列）/ 20px（宽松卡片条），font-weight: 500，line-height: 1.7-1.9
- 左图右文/右图左文 卡片条 li 文字：20px，font-weight: 600（要点较长时降至 19px）
- 上图下文双列 li 文字：18px / 19px，font-weight: 600
- 辅助文字 / tag 胶囊：16~18px，color: #6B7280
- **最小字号：16px**
- **正文字号唯一表（所有 li/p 必须从此表取值）**：19px（标准）/ 18px（紧凑 / N≥4 双列）/ 20px（宽松卡片条）。出现任何其他正文字号（22 / 24 / 28 / 32 / 16px 作为正文）即为违规，会被审核 fatal 并强制返工。
🔴 🔴 【致命红线再次重申：左图右文 / 右图左文卡片条化正文的 28px 禁令】
若 pageType 是 content-image-left / content-image-right，其 li 卡片条中 li > span 正文文字必须使用 19px（标准）或 20px（宽松），**绝对禁止写 font-size:28px**。
出现 28px 的后果链：H2 标题 50px 与 正文 28px 比值 50÷28 = 1.79 < 2.5 → 审核系统 fatal 级扣分 → overallScore ≤ 5.0 → 触发返工重新生成（浪费 token）。
请务必执行正文字号唯一表。即便你觉得文字较短可以放大，也绝对不能超过 20px；内容较长时应降为 19 或 18，不能反向增加。
- **字号对比硬指标**：H2 页面标题与正文 li/p 的字号比值必须 ≥ 2.5 倍（50÷19=2.63，52÷20=2.6，均达标）。H2 最小不得低于 50px，保证与 20px 正文比值 50÷20=2.5。禁止使用 22px 作为标准正文字号。
- **字号自适应原则**：当要点文字超过15字或单页要点≥4个时，主动降一档字号（20→19→18），宁可小一号也不能溢出

## 图标颜色对比强制红线（致命Bug禁令，违反=图标完全隐形 → 审核判fatal）

历史致命Bug重现：当 <span>图标容器背景是 主色实心/渐变深色（如 background:{{PRIMARY_COLOR}} 或 background:linear-gradient(135deg,{{PRIMARY_COLOR}},{{PRIMARY_COLOR_DARKER}})），内部 <svg> 却用 stroke="{{PRIMARY_COLOR}}" 主色描边 → 同色描边画在同色背景上完全不可见，用户和VLM审核都看不到图标。

### 正确搭配（严格遵守）
1. **filled 风格：深色背景（主色实心/渐变） + 白色SVG图标**（✅ 唯一正确组合）
   - 图标容器：\`background:linear-gradient(135deg,{{PRIMARY_COLOR}},{{PRIMARY_COLOR_DARKER}})\` 或 \`background:{{PRIMARY_COLOR}}\`
   - 内部SVG必须：\`fill="#fff"\` 或 \`stroke="#fff"\`（文字徽章也必须 \`color:#fff\`）
   - 例：\`<span style="display:inline-flex;...background:linear-gradient(135deg,{{PRIMARY_COLOR}},{{PRIMARY_COLOR_DARKER}});"><svg ... stroke="#fff" stroke-width="2">...</svg></span>\`
2. **line 风格：浅色透明背景（主色×8%~12%） + 主色SVG图标**（✅ 唯一正确组合）
   - 图标容器：\`background:{{PRIMARY_COLOR}}08\` 或 \`background:{{PRIMARY_COLOR}}10\` 或 \`background:{{PRIMARY_COLOR}}12\`（透明度后缀，看起来是白底淡淡染色）
   - 内部SVG必须：\`stroke="{{PRIMARY_COLOR}}"\` 或 \`fill="{{PRIMARY_COLOR}}"\`（描边/填充用主色）
   - 例：\`<span style="display:inline-flex;...background:{{PRIMARY_COLOR}}12;border-radius:10px;"><svg ... stroke="{{PRIMARY_COLOR}}" stroke-width="2">...</svg></span>\`

### 绝对禁止组合（出现即 fatal）
🚫 禁止 filled 背景 + 主色 stroke/fill：\`background:{{PRIMARY_COLOR}}\` 搭配 \`stroke="{{PRIMARY_COLOR}}"\` 或 \`fill="{{PRIMARY_COLOR}}"\`（同色完全隐形）
🚫 禁止 主色渐变背景 + 主色 stroke/fill：\`background:linear-gradient(135deg,{{PRIMARY_COLOR}},{{PRIMARY_COLOR_DARKER}})\` 搭配 \`stroke="{{PRIMARY_COLOR}}"\`（同色完全隐形）
🚫 禁止 line 浅背景（{{PRIMARY_COLOR}}12） 搭配 \`stroke="#fff"\` 或 \`fill="#fff"\`（白色在浅底上几乎隐形）

filled 与 line 风格不得在同一页面混用——所有 li 卡片图标风格严格遵循当前 iconStyle 参数（auto/line/filled/numbered/bullet/lettered/emoji/none）。

## 列数规则（极其重要 · 防溢出红线）

不同布局类型下列表 ul/ol 的列数必须严格遵守：

═══════════════════════════════════════════════════════════
### 🔒 左图右文 / 右图左文（content-image-left / right）单列强制红线 ⚠️ N≥4 也绝对禁止双列Grid
═══════════════════════════════════════════════════════════
文字区在右侧/左侧单列，**无论要点数量 N 是多少，列表永远是单列 flex-column，绝对不能 grid-template-columns:repeat(2,1fr) 双列**！
左图右文/右图左文的图片已经占了画布45%，文字区仅剩55%空间，再加双列会导致卡片严重挤压、图标同色隐形、大面积空白溢出。
  ul 正确写法：style="display:flex; flex-direction:column; gap:24px;"（严禁 display:grid / repeat(2)）

═══════════════════════════════════════════════════════════
### 上图下文（content-image-top） ← 仅这种pageType允许N≥4时用双列 Grid ⚠️
═══════════════════════════════════════════════════════════
不存在 content-image-bottom 枚举（pageType 仅支持 top）。若你想实现"下文上图"视觉，也必须使用 **content-image-top** 作为 pageType，然后自行调整容器顺序（图片容器放在最后）；但推荐一律保持"图片在顶、文字在底"不换序，否则后处理兜底可能失效。
仅 content-image-top 场景下，根据要点数量 N（即 li 标签数量）自动选择列数：
  - N ≤ 3 → 单列：ul style="display:flex; flex-direction:column; gap:16px;"
  - N ≥ 4 → **双列 Grid**（仅 content-image-top 允许！content-image-left/right 禁用见上）：必须写成：
    ul style="display:grid; grid-template-columns:repeat(2,1fr); gap:16px 24px; margin:0; padding:0; list-style:none; min-width:0;"
    对应的每个 li：
    - padding 从 16px 24px 缩减为 16px 24px（紧凑模式可减为 12px 16px）
    - li 内文字 font-size 使用 19px（标准）或 18px（紧凑）
    - 图标容器 width/height 使用 40px（标准）或 32px（紧凑），font-size 对应 20px 或 16px

### 纯文字页 content-no-image
  - N ≤ 5 → 单列 flex-direction:column
  - N ≥ 6 → 双列 Grid：grid-template-columns:repeat(2,1fr)

## 上图下文布局的图片高度规则（防溢出）

对于 content-image-top（上图下文），图片容器高度（flex:0 0 XX%）与要点数量 N 绑定：
  - N ≤ 2 → 图片容器 flex:0 0 45%
  - N = 3 → 图片容器 flex:0 0 40%
  - N ≥ 4 → 图片容器 flex:0 0 33%（必须压缩图片，给文字腾空间）
图片容器规则（严格区分父容器布局方向）：
  ✅ 当父容器是 flex-direction:column（仅 content-image-top 上图下文）：图片容器带 min-height:0; overflow:hidden; display:flex; align-items:stretch; margin-bottom 相应值（N≥4 → 16px；N≤3 → 24px）。
  🚫 当父容器是 flex-direction:row（content-image-left 左图右文 / content-image-right 右图左文）：**图片容器绝对禁止 margin-bottom / margin-top**，父容器靠 gap:24px~40px 控制图片与文字两列之间的水平间距。row 方向给子元素加 vertical margin 会破坏 align-items:stretch 的等高对齐！
  所有图片 <img> 标签自身必须：width:100%; height:100%; object-fit:cover; border-radius:16px; display:block;

## 色彩系统

- 主色primary：{{PRIMARY_COLOR}}
- 主色深色变体：{{PRIMARY_COLOR_DARKER}}（用于渐变终点）
- 主色透明度变体：{{PRIMARY_COLOR}}15（15%）、{{PRIMARY_COLOR}}08（8%）、{{PRIMARY_COLOR}}40（25%阴影）
- 标题文字：{{TITLE_TEXT_COLOR}}（参考标题色，无参考时回落 #111827）
- 正文：{{BODY_TEXT_COLOR}}（参考正文色，无参考时回落 #374151）；次要文字：#6B7280；辅助：#9CA3AF
- 边框：#E5E7EB；背景：#FFFFFF

### 【色彩红线 · 绝对禁止违反】

> ⚠️【参考克隆 · 色彩红线豁免】若本页上方「参考克隆·色彩红线豁免」段落已列出参考调色板 accent 色/粗描边色，则这些色视为参考风格的一部分，**不计入下方「单色系红线」的违规**（但仍严禁引入该段落未列明的其他色值）；若未出现该豁免段落，则下方红线保持不变，严格执行单色系。

0. **单色系红线（强制 · 先于下方全部色彩规则执行）** 本页所有视觉元素只能使用 {{PRIMARY_COLOR}} / {{PRIMARY_COLOR_DARKER}} 及其透明度变体与中性灰阶。**禁止出现任何其他十六进制色值，任何非本页主色系的 # 色值（含模板/示例中出现的其他写死色）一律不得出现在最终输出中；必须以本页 PRIMARY_COLOR/PRIMARY_COLOR_DARKER 或中性灰阶替代。**即使模板示例中写死过某个 # 色值（如示例色 {{EXPECTED_PRIMARY_COLOR}}），也必须替换为 {{PRIMARY_COLOR}} 系后再输出。本约束不限制由参考文件提取的标题/正文色（{{TITLE_TEXT_COLOR}} / {{BODY_TEXT_COLOR}}），该二色为允许例外（见【参考文字色优先级】）。
1. **禁止编造色值**：除主色系（PRIMARY_COLOR 及其透明度变体、PRIMARY_COLOR_DARKER）与中性灰阶白名单外，禁止引入任何其他十六进制色值；不得输出第二种强调色相。所有彩色元素只能使用 {{PRIMARY_COLOR}} 及其透明度变体、{{PRIMARY_COLOR_DARKER}}。本约束不限制由参考文件提取的标题/正文色（{{TITLE_TEXT_COLOR}} / {{BODY_TEXT_COLOR}}），即使非中性色相亦属允许例外（高优先级，见【参考文字色优先级】）。
2. **禁止跨色系渐变**：所有 \`linear-gradient\` 必须在同色系内进行，即 \`linear-gradient(135deg, {{PRIMARY_COLOR}}, {{PRIMARY_COLOR_DARKER}})\`。严禁将主色与其他色系（橙色、绿色、紫色、红色等）混合做渐变——蓝→橙、蓝→绿、紫→粉等跨色渐变会产生浑浊中间色，视觉效果极差。
3. **禁止卡片交替使用不同色系背景**：同一页所有卡片使用统一的背景色（{{PRIMARY_COLOR}}08 ~ {{PRIMARY_COLOR}}15 或 #F8FAFC/#F1F5F9），不要蓝/橙/绿交替排列。
4. **灰阶色可用**：#111827、#374151、#6B7280、#9CA3AF、#E5E7EB、#F3F4F6、#F9FAFB、#FFFFFF 是中性灰阶，不受限制。由参考提取的 {{TITLE_TEXT_COLOR}} / {{BODY_TEXT_COLOR}} 即使非中性灰阶，亦属允许例外（高优先级，见【参考文字色优先级】）。
5. **语义色例外**：进度条/对比页中表示"胜出/优势"的绿色（#10b981）、表示"劣势/警告"的红色（#ef4444）可以使用，但仅限明确语义场景，不得用于标题、图标、装饰条等主视觉元素。

### 文字颜色红线（防隐形与低对比度 · 必遵守）
- **正文 li/p、数值大字（≥24px）、卡片描述文字、卡片内小标签标题**：一律使用 {{BODY_TEXT_COLOR}}（参考正文色；无参考时回落 #374151 深灰）；**上述正文维度禁止主色文字**（主色在白底对比度仅 3.5~3.9:1，低于可读标准 4.5:1，会被渲染审核判 low-contrast）。页面级标题 H1/H2/H3 不属于本条禁令范围，标题颜色由下方【参考文字色优先级】与【反色规则·浅底禁白字】规定。
- **主色（及深色变体、或二者的渐变文字效果）可用于**：① 图标容器内 SVG/数字/字母；② ≤16px 的标签/徽章/强调符号；③ 进度条填充；④ 装饰线/装饰块。（说明：页面级 H1/H2/H3 标题字颜色由【参考文字色优先级】与【反色规则·浅底禁白字】规定——有参考标题色时用 {{TITLE_TEXT_COLOR}}，无参考浅底时可用主色/主色深色变体渐变文字效果。）深底/主色背景下标题必须用白色（【反色规则】已覆盖）。
- **禁止组合**：主色文字（或深色文字）放在主色透明浅底上（如 \`{{PRIMARY_COLOR}}03/08/12\` 背景 + \`{{PRIMARY_COLOR}}\` 文字）——对比度约 1.0:1 完全隐形，属 fatal
- 深色/渐变主色背景（第 1 轮反色规则已覆盖）文字用 #FFFFFF
- **执行优先级说明**：本小节（文字颜色红线）的任何条款，如下方【反色规则】或【反色规则·浅底禁白字】小节中对同一维度（尤其是标题 H1/H2/H3 颜色）有更具体显式的规定，则以【反色规则】规定为准。本小节仅为正文/装饰层的一般基线。

### 参考文字色优先级（高优先级 · 必遵守）
- 若参考文件/参考图提取到 \`titleColor\`，所有页面级 H1/H2/H3 标题文字一律使用 {{TITLE_TEXT_COLOR}}（覆盖主色/渐变标题规则）；若提取到 \`bodyColor\`，所有 li/p 正文文字一律使用 {{BODY_TEXT_COLOR}}（覆盖默认深灰）。
- 上述仅作用于浅色/白色背景区域；任何深色或主色背景区块内，无论参考文字色为何，一律强制白字（见【反色规则】），对比度红线优先。
- 次要/辅助文字（#6B7280 / #9CA3AF）、边框、背景中性色保持不变，不随参考文字色改变。

### 渐变文字书写铁律（防黑块 · 必遵守）
- 渐变文字（background-clip:text）的**唯一正确声明顺序**是：'background:linear-gradient(...)' 必须写在 '-webkit-background-clip:text' / 'background-clip:text' **之前**。即：'background:linear-gradient(135deg,A,B);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;'
- ⚠️ **致命反例**：若把 'background:...' 写在 clip 之后（如 '...background-clip:text;background:linear-gradient(...)'，或 'background' 简写出现在 clip 声明之后），'background' 简写会把 clip 重置回 'border-box'，导致深色渐变铺满整个标题盒子，而 '-webkit-text-fill-color:transparent' 使文字完全不可见 → 整块黑/深色矩形 + 看不见的标题（fatal）。
- 【标题色收敛】若提取到参考 'titleColor'，则 H1/H2/H3 **一律使用纯色 'color:{{TITLE_TEXT_COLOR}}'**，禁止使用 'background-clip:text' / '-webkit-text-fill-color:transparent' / 渐变填充去实现标题字（封面"海报级冲击力"改由 'text-shadow' 多层光晕 + 加粗装饰条 + 参考风格色块高亮实现）。
- 【渐变文字色相红线】只有当需要渐变艺术字时，渐变两端必须取自**主色系（{{PRIMARY_COLOR}}/{{PRIMARY_COLOR_DARKER}}）或参考 accent 白名单**，禁止两端均为低亮度深色（如 #22223b→#5c5c72 这类深色→深灰）的渐变字，禁止在浅底上使用低亮度（min 亮度<0.25）的渐变字。

### 反色规则（对比度兜底，必须遵守）

**当任何区块（卡片/div/section）的背景是深色或主色时（满足任意一条）：**
- 背景颜色 = \`{{PRIMARY_COLOR}}\`、\`{{PRIMARY_COLOR_DARKER}}\`
- 背景渐变色包含 \`{{PRIMARY_COLOR}}\`、\`{{PRIMARY_COLOR_DARKER}}\`
- 背景色整体亮度较低（肉眼看着偏深色，不是白色/浅灰）

**则该区块内所有文字必须反色为白色：**
- H1/H2/H3：**color:#FFFFFF**（**禁止再用主色**，禁止渐变文字效果）
- p/li：**color:#FFFFFF**（正文白色，line-height保持2.0-2.2）
- 辅助文字：**color:#F3F4F6**
- 图标容器内的 SVG/数字/字母 保持白色不变
- （对比页右栏"新方案优势"、深色卡片、主色背景的面板、主色渐变装饰块 都必须遵守本规则）

### 反色规则 · 浅底禁白字（对比度兜底绝对红线，必遵守，违反=不可用）

**当任何区块（卡片/div/section）的背景是浅色/白色/极浅半透明主色时（满足任意一条）：**
- 背景颜色 = #FFFFFF / #F9FAFB / #F3F4F6 / #ffffff 等白色或浅灰
- 背景颜色 = \`{{PRIMARY_COLOR}}08\`、\`{{PRIMARY_COLOR}}10\`、\`{{PRIMARY_COLOR}}15\`、\`{{PRIMARY_COLOR}}20\`（透明度 ≤ 20% 的半透明主色——看起来几乎是白色，只带淡淡氛围色）
- 背景渐变色整体偏白（肉眼看着是浅色，不是深色/紫色深蓝）
- 背景色整体亮度较高（亮度 ≥ 0.75，肉眼偏白/浅）

**则该区块内**绝对禁止使用白色字 \`color:#FFFFFF\`/\`color:#F9FAFB\`/\`color:#F3F4F6\` 等极浅字**，必须使用深色字，WCAG 对比度 ≥ 4.5:1：**
- H1/H2/H3：**color:\`{{TITLE_TEXT_COLOR}}\`**（参考标题色；无参考标题色时回落 \`{{PRIMARY_COLOR}}\` 或 \`{{PRIMARY_COLOR_DARKER}}\` 渐变文字效果）
- p/li：**color:{{BODY_TEXT_COLOR}}**（参考正文色；无参考时回落 #374151 深灰）
- 辅助文字 / 次要文字：**color:#6B7280**
- SVG/数字/字母 放在图标容器里的继续保持白色，容器外文字一律深字
- （对比页右栏"优势/Work Buddy/推荐方案"卡片、\`{{PRIMARY_COLOR}}08\`浅氛围色卡片、浅紫/浅蓝白色面板、所有浅色背景卡片 都必须遵守本规则）

## 封面页海报级艺术字规范（电影海报视觉冲击，必遵守）

封面 H1 主标题必须做到**视觉冲击强烈、有艺术气息**，不是普通文字，具体规则：
1. **超大字号 + 超重字重**：H1 \`font-size:88~92px; font-weight:900; line-height:1.1\`
2. **多层发光阴影（光晕）**：至少 3 层 text-shadow 叠加：
   \`\`\`
   text-shadow:0 4px 30px {{PRIMARY_COLOR}}50, 0 0 70px {{PRIMARY_COLOR}}30, 0 0 140px {{PRIMARY_COLOR}}15;
   \`\`\`
3. **渐变描边 + 渐变填充**（双效叠加）：
   - 基础：背景渐变填充文字（和 H2 一致效果）
   - 额外加 1~1.5px 描边：\`-webkit-text-stroke:1.5px {{PRIMARY_COLOR}}80;\`
4. **装饰形状层（海报氛围）**：封面外层容器必须包含至少 2 个装饰性渐变形状：
   - 例1：右上角/左下角放半透明渐变椭圆/斜切面
   - 例2：标题下方/背景角落放 SVG 泼墨/渐变光晕 blobs 形状
5. **装饰下划线/分隔线**：H1 下方必须放 120~200px 宽、6~10px 高的圆角渐变装饰条（不是细 6px，**加粗** 到 8-10px）
6. **副标题分层**：副标题不能全是一样的灰色 24px，要分层：
   - 第 1 行副标题（"核心定位"）：32~36px，font-weight:700，主色字或渐变字
   - 第 2~3 行副标题：26~28px，深灰 #374151，font-weight:600
   - 最后一行"作者/公司/出品"：做**胶囊 badge**（浅主色背景 padding:10px 24px，border-radius:999px，主色字 + 字重 600），不要只一行浅灰字
7. **居中规则（条件化）**：默认封面所有内容整体垂直居中；但**当参考图/覆盖指令标注「左对齐构图」时，改为内容列左对齐、垂直居中（align-items:flex-start + text-align:left），禁止 justify-content/align-items/text-align:center 三件套**，以贴合参考版式。
8. **封面占比**：所有标题+副标题+装饰条整体垂直占比必须 ≥ 65%（页面上下各留 ~17% 空白，不要挤在顶部）

## 对比页左右比例与卡片条化（content-image-left/right + 对比页）

1. **左文右图 55:45 比例**：左文字列 \`flex:0 0 55%\`，右图片列 \`flex:0 0 45%\`（或图片左 45% 文字右 55%），图片不能大于文字
2. **卡片条化**：左列每一行 li 必须是独立卡片条样式：
   \`\`\`
   li 外层：padding:20px 24px; border-radius:14px; background:linear-gradient(135deg,{{PRIMARY}}08,{{PRIMARY}}10);
          border-left:5px solid {{PRIMARY_COLOR}}; box-shadow:0 4px 16px {{PRIMARY_COLOR}}15;
   li 图标：width 28px → 40px（放大一档，height:40px font-size/ svg: 22px）
   li 文字：font-size:20px; ⚠️ [上限，绝不能 28] font-weight:600; color:#111827; line-height:1.4; flex:1;
   ul gap：16px → 24px（行间距更大）
   \`\`\`
   重申：卡片条 20px / H2 50px → 比值 2.5 刚好合格；若写 28 则 50÷28 = 1.79 必被审核 fatal。长内容时应降到 19px，而不是反向增加到 28。
3. **左列均匀分布**：左列容器 justify-content:space-between 或 space-evenly，让卡片条分布均匀，不挤一坨在顶部

## 卡片网格页（content-cards）字号与图标比例修正

1. 卡片内图标：56px 圆标 → **48px**（略微缩小，不再压住标题）
2. H3 卡片标题：font-size:22px → **30~32px**; font-weight:700 → **800**；用渐变文字效果（主色渐变）
3. p 正文：font-size:18px → **19~20px**; font-weight:400 → **500**; line-height:1.8 → **1.6**
4. 卡片 padding:32px → **36px**

### 【卡片内容密度红线 · 禁止大面积空白】

卡片网格页（content-cards）是最容易出现"头重脚轻、卡片大面积空白"的版式。必须遵守：

1. **每张卡片必须有足够内容填充**：除图标+标题+一句简短描述外，还必须包含 **2~3 条要点列表**（用小圆点或短横线引导的短句），让卡片内容垂直撑开到合理比例。禁止卡片只有图标+标题+一行描述。
2. **卡片内容垂直居中**：卡片使用 \`justify-content:center\` 让内容在卡片内垂直居中分布，而不是全部堆在顶部。
3. **要点列表样式**：用 \`<ul style="margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:8px;">\` + \`<li style="display:flex;align-items:flex-start;gap:8px;font-size:18px;color:#4B5563;line-height:1.5;">\` 呈现，每条 li 前加一个小圆点（\`<span style="width:6px;height:6px;border-radius:50%;background:{{PRIMARY_COLOR}};flex-shrink:0;margin-top:8px"></span>\`）。
4. **内容不足时调整卡片数量**：如果某页只有 2 个要点，不要硬撑 3~4 张空卡片，改用两栏布局或大卡片布局。
5. **禁止 height:100% 导致空白**：卡片不要设置 \`height:100%\` 强制拉伸填满网格行高；用 \`align-content:center\` 让网格行在容器中垂直居中，卡片高度由内容自然撑开。
6. **字号梯度**：卡片标题 28~30px（不要过大），描述 20~22px，要点 17~19px，形成三层级。
7. **内容左对齐，不要居中**：卡片网格页是内容页，不是封面/标题页。外层容器和卡片内部一律左对齐（\`align-items:flex-start;text-align:left\`），禁止给外层容器加 \`justify-content:center;align-items:center;text-align:center\`，否则会显得像标题页且产生上下不平衡的留白。

## 图标风格（iconStyle: {{ICON_STYLE}}）

当前用户选择的图标风格为 \`{{ICON_STYLE}}\`。列表项必须使用对应的图标。

### 【黄金规则 · 所有风格通用】

1. **同一张幻灯片只能使用一种图标类型**：禁止在同一页混用线性SVG、面性SVG、emoji、数字序号。整份演示文稿也应保持图标风格统一。
2. **平级并列的模块（如三栏/四栏卡片），图标必须同风格、同尺寸、同背景形状、同位置**。每个卡片/列表项都必须有图标，不能遗漏。禁止出现"一个卡片有图标、另一个没有"的情况。
3. **数字序号和左侧图标不能同时出现在同一个卡片中**：如果使用数字序号（numbered风格），数字就是唯一的图标标识，不要再在左侧加圆圈/SVG图标。
4. **禁止生成纯圆圈作为图标**：SVG图标必须包含 path/polyline/rect/line 等真实形状（如对勾、箭头、星形、文档图标等），不能只画一个 circle 圆圈。空SVG或仅含circle的SVG会被系统自动替换为对勾图标。
5. **越严肃/技术/B端/正式汇报 → 越用线性图标；越重点/行动/封面/大屏 → 越用面性图标；越轻松/内部/C端 → 越可用emoji**。
6. 所有列表项使用 \`display:flex;align-items:center;gap:16px;\` 布局，图标容器 \`flex-shrink:0;\`，list-style:none。
7. 图标/卡片背景色使用低透明度（8%-15%），确保背景图上也清晰可读。

### line（线性/描边图标 · 推荐B端技术场景）
- **气质**：简约、理性、轻盈、专业冷静，留白多，不抢夺文字焦点
- **适用**：B端产品、技术PPT、研发平台、企业中台、云服务/AI/运维类材料、大量信息并列排布（三栏/四栏卡片）、浅色白底页面
- **实现**：使用系统内置语义化SVG图标库（stroke 描边风格，stroke-width:2，圆角端点），图标颜色为主色，放在 8%-10% 透明度的主色圆角方形浅底上（border-radius:8px）
- **列表小图标**：28px 容器 + 18px SVG
- **卡片大图标**：48px 圆角矩形容器 + 22px SVG
- **语义匹配**：必须根据内容语义选择对应图标（见下方语义映射表）

### filled（面性/填充图标）
- **气质**：扎实、醒目、力量感强，视觉权重高，远距离易识别
- **适用**：封面页、核心结论页、方案亮点、大屏展示、深色背景、需要一眼捕捉的重点模块、C端产品介绍
- **实现**：使用系统内置语义化SVG图标库（fill 填充风格），图标为白色，放在渐变色实心圆角方形背景上（带柔和阴影）
- **不适用**：一页大量并排十几个图标、文字密集的技术卡片（显得杂乱）
- **列表小图标**：28px 渐变容器 + 18px 白色SVG
- **卡片大图标**：48px 渐变圆角矩形容器 + 22px 白色SVG

### auto（智能匹配 · 默认线性）
- auto 默认使用**线性SVG图标**（与 line 风格一致），这是最安全、最专业的选择
- 如果用户明确选择了其他风格或内容明显偏轻松/C端，AI可酌情切换，但**同一页内必须统一**
- 步骤/流程/阶段类内容可使用数字序号（numbered），目录页可使用数字
- **禁止在auto模式下随意混合emoji和SVG**，除非整份演示文稿都是emoji风格

### numbered（数字序号）：
所有列表项统一使用「渐变圆角方形+白色数字1/2/3/4」，适合步骤、流程、阶段类内容。

### bullet（对勾/圆点）：
- 特性/优势/完成类项 → 渐变圆形+白色对勾SVG
- 普通/中性列表项 → 10px主色小圆点
- 可根据语义在同一页混合使用对勾和圆点（它们属于同一种符号体系）

### lettered（字母分类）：
所有列表项统一使用「渐变圆形+白色字母A/B/C/D…」，适合分类、维度类内容。

### emoji（Emoji风格）：
**谨慎使用**。仅适用于：内部轻松沟通、团队分享、团建、C端消费产品、新媒体、年轻群体内容。
**禁止用于**：B端技术方案、研发工具汇报、管理层正式评审、对外商务宣讲、企业平台产品介绍。
- 两种形式（可在同一页混合）：纯Emoji无背景（font-size:20-22px）；Emoji+浅色圆角矩形/圆形背景（容器36-44px，emoji 18-22px）
- 必须与要点语义强匹配

### none（无图标）：
不使用图标，纯文字列表，list-style:none。

### 【语义化SVG图标映射表】（line / filled / auto 使用）

系统内置以下语义图标，AI必须根据卡片/列表项的标题和文字内容选择最匹配的图标，**不要全部用同一个图标**：

| 语义类别 | 图标key | 适用关键词 |
|---------|---------|-----------|
| 目标/定位/核心 | target | 目标、定位、使命、愿景、宗旨、核心 |
| 代码/研发/开发 | code | 代码、研发、开发、编程、程序、developer |
| 效率/速度/性能 | zap | 效率、速度、性能、快速、高性能 |
| 安全/保护/合规 | shield | 安全、保护、合规、风控、防御 |
| 创意/灵感/创新 | bulb | 创意、灵感、想法、创新、思路 |
| 团队/协作/用户 | users | 团队、协作、用户、客户、人员 |
| 启动/发布/腾飞 | rocket | 启动、发布、上线、增长、加速 |
| 数据/分析/统计 | chart | 数据、分析、统计、报表、指标、营收 |
| 架构/层级/模块 | layers | 架构、层级、模块、组件、分层 |
| 云/云端/SaaS | cloud | 云、云端、云服务、云原生 |
| 数据库/存储 | database | 数据库、存储、持久化 |
| 工具/配置/运维 | tool | 工具、设置、配置、维护、运维 |
| 全球/网络/互联网 | globe | 全球、国际化、网络、互联网、web |
| 搜索/发现/研究 | search | 搜索、发现、研究、查找、检索 |
| 亮点/特色/智能 | sparkle | 亮点、特色、优势、AI、智能 |
| 关键/解锁/权限 | key | 关键、核心、解锁、密钥、权限 |
| 算力/处理器 | cpu | 算力、处理器、计算、硬件 |
| 流程/分支/流水线 | branch | 流程、工作流、版本、流水线、pipeline |
| 打包/部署/交付 | package | 打包、部署、交付、发布 |
| 命令行/终端/自动化 | terminal | 命令行、终端、CLI、脚本、自动化 |
| 完成/通过/优势 | check | 完成、通过、正确、已实现 |
| 设置/管理/偏好 | settings | 设置、配置、管理、偏好 |
| 视图/监控/洞察 | eye | 视图、预览、监控、洞察 |
| 时间/时效/日程 | clock | 时间、时效、日程、周期、实时 |

如果上述图标均不匹配内容语义，选择含义最接近的一个；同一页内相邻卡片/列表项**不要重复使用相同图标**（除非语义确实相同）。

## 图标 HTML 片段（直接复制使用）

**① 线性图标+浅色圆角底（line / auto · 列表项28px）**
\`\`\`html
<span style="display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:28px;height:28px;border-radius:8px;background:{{PRIMARY_COLOR}}10;color:{{PRIMARY_COLOR}};">
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="{{PRIMARY_COLOR}}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="..."/></svg>
</span>
\`\`\`

**② 面性图标+渐变实心底（filled · 列表项28px）**
\`\`\`html
<span style="display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:28px;height:28px;border-radius:8px;background:linear-gradient(135deg,{{PRIMARY_COLOR}},{{PRIMARY_COLOR_DARKER}});box-shadow:0 2px 8px {{PRIMARY_COLOR}}40;">
  <svg width="18" height="18" viewBox="0 0 24 24" fill="#fff"><path d="..."/></svg>
</span>
\`\`\`

**③ 线性大图标+浅色圆角底（line / auto · 卡片顶部48px）**
\`\`\`html
<span style="display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:48px;height:48px;border-radius:12px;background:{{PRIMARY_COLOR}}14;">
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="{{PRIMARY_COLOR}}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="..."/></svg>
</span>
\`\`\`

**④ 面性大图标+渐变实心底（filled · 卡片顶部48px）**
\`\`\`html
<span style="display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:48px;height:48px;border-radius:12px;background:linear-gradient(135deg,{{PRIMARY_COLOR}},{{PRIMARY_COLOR_DARKER}});box-shadow:0 4px 16px {{PRIMARY_COLOR}}35;">
  <svg width="22" height="22" viewBox="0 0 24 24" fill="#fff"><path d="..."/></svg>
</span>
\`\`\`

**⑤ 渐变圆角方形+数字（numbered · 列表项28px）**
\`\`\`html
<span style="display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:28px;height:28px;border-radius:8px;background:linear-gradient(135deg,{{PRIMARY_COLOR}},{{PRIMARY_COLOR_DARKER}});box-shadow:0 2px 8px {{PRIMARY_COLOR}}40;color:#fff;font-size:14px;font-weight:800;">1</span>
\`\`\`

**⑥ 渐变圆形+白色对勾（bullet-特性）**
\`\`\`html
<span style="display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,{{PRIMARY_COLOR}},{{PRIMARY_COLOR_DARKER}});box-shadow:0 2px 8px {{PRIMARY_COLOR}}40;">
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M13 4L6.5 10.5L3 7" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
</span>
\`\`\`

**⑦ 极简圆点（bullet-普通项）**
\`\`\`html
<span style="display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:10px;height:10px;border-radius:50%;background:{{PRIMARY_COLOR}};"></span>
\`\`\`

**⑧ 渐变圆形+字母（lettered）**
\`\`\`html
<span style="display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,{{PRIMARY_COLOR}},{{PRIMARY_COLOR_DARKER}});box-shadow:0 2px 8px {{PRIMARY_COLOR}}40;color:#fff;font-size:13px;font-weight:800;">A</span>
\`\`\`

**⑨ 纯Emoji无背景（emoji风格）**
\`\`\`html
<span style="display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:32px;height:28px;font-size:22px;line-height:1;">🎯</span>
\`\`\`

**⑩ Emoji+圆角矩形浅色背景（emoji风格）**
\`\`\`html
<span style="display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:40px;height:40px;border-radius:10px;background:{{PRIMARY_COLOR}}12;font-size:20px;line-height:1;">📊</span>
\`\`\`

**⑪ 大圆+数字（numbered · 卡片顶部48px）**
\`\`\`html
<span style="display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:48px;height:48px;border-radius:50%;background:linear-gradient(135deg,{{PRIMARY_COLOR}},{{PRIMARY_COLOR_DARKER}});box-shadow:0 4px 16px {{PRIMARY_COLOR}}35;color:#fff;font-size:22px;font-weight:800;">1</span>
\`\`\`

**⑫ 灰色圆形+横线（对比页左栏/普通项）**
\`\`\`html
<span style="display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:20px;height:20px;border-radius:50%;background:#E5E7EB;">
  <svg width="10" height="10" viewBox="0 0 10 10"><rect x="2" y="4.5" width="6" height="1.5" rx="0.75" fill="#9CA3AF"/></svg>
</span>
\`\`\`

## 现代卡片化视觉设计（所有风格通用，强烈建议遵循）

无论选择哪种图标风格，都要积极使用卡片和装饰线条增强视觉层次，让PPT更具现代感：

### 1. 卡片化布局
- **内容块用卡片包裹**：每个要点块、信息块、功能介绍块都应放在卡片容器中：padding:20-28px; border-radius:12-16px;
- **卡片背景色**：使用 \`{{PRIMARY_COLOR}}08\` ~ \`{{PRIMARY_COLOR}}15\` 半透明浅色（不要用纯白），或使用浅灰\`#F8FAFC\`/\`#F1F5F9\`；也可以使用柔和渐变：\`linear-gradient(135deg, {{PRIMARY_COLOR}}08, {{PRIMARY_COLOR}}12)\`
- **卡片间距**：卡片之间 gap:16-24px，保持呼吸感
- **嵌套层级**：最多1-2层卡片嵌套，不要过度嵌套
- **密度适配**：density=compact时padding:16px/gap:16px，density=spacious时padding:32px/gap:24px

### 2. 装饰性线条
- **左侧竖线强调**：卡片/要点块可加左侧5-6px主色竖线边框：\`border-left:5px solid {{PRIMARY_COLOR}};\`（border-radius搭配使用时用overflow:hidden确保圆角）
- **标题装饰条**：h2标题下方可加80-150px宽、6-8px高的圆角渐变装饰条（\`border-radius:4px;background:linear-gradient(90deg,{{PRIMARY_COLOR}},{{PRIMARY_COLOR_DARKER}});height:6px;\`）
- **分隔线**：卡片之间可用1px \`{{PRIMARY_COLOR}}15\` 浅色分隔线，或直接用gap留白
- **进度条/完成度**：可用圆角矩形填充条（\`border-radius:999px;background:{{PRIMARY_COLOR}}20;\` 内加填充矩形）

### 3. 图标点缀
- **h2标题前**：可加与内容语义相关的小图标（线性SVG优先，emoji仅限iconStyle=emoji时使用），图标与文字间距8-12px
- **卡片标题前**：可加图标（与当前iconStyle保持一致，不要在line/filled风格的页面突然插入emoji）
- **语义匹配要求**：选择与内容强相关的图标，参考上方语义映射表；不要用不相关的符号
- **密度控制**：每屏（页）图标数量与要点数匹配即可，不要每个词都加图标
- **B端/技术/正式场景**：优先使用线性SVG图标，不要用emoji（emoji会削弱专业度，且不同系统渲染不一致）

### 4. 背景色与背景图兼容
- **透明度要求**：所有卡片背景色、emoji背景色必须使用8%-15%透明度（如\`{{PRIMARY_COLOR}}0C\`=~7%、\`{{PRIMARY_COLOR}}14\`=~8%、\`{{PRIMARY_COLOR}}1F\`=~12%、\`{{PRIMARY_COLOR}}26\`=~15%），确保背景图开启时卡片内容清晰可读、不冲突
- **圆角统一**：同一页内所有卡片圆角保持一致（12-16px），图标背景圆角与卡片圆角风格协调（方形圆角图标配方形圆角卡片）

---

## ===== L1.5 视觉样式（风格增强 · 可控创造力 · 强烈建议使用）=====

### 【重要可编辑性规则】所有 L1.5 装饰性子元素必须加 \`pointer-events:none;\`，保证点击时选中**父容器**（便于编辑器修改属性）！

以下 5 种样式可根据 styleTheme 字段混合使用，不要只局限于一种。

### L1.5-1 玻璃拟态（glass）— backdrop-filter: blur
适用：styleTheme=glass / content-image-background 页 / 封面叠在图上的卡片。

\`\`\`html
<!-- 玻璃卡片 ✅ 可选中（点击卡片选到这个div，因为内部子元素都 pointer-events:none）-->
<div style="padding:28px 32px;border-radius:16px;background:rgba(255,255,255,0.55);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border:1px solid rgba(255,255,255,0.6);box-shadow:0 8px 32px rgba(0,0,0,0.08);">
  <h3 style="font-size:28px;font-weight:800;margin:0 0 12px 0;color:{{PRIMARY_COLOR_DARKER}};">卡片标题</h3>
  <p style="font-size:19px;color:#111827;font-weight:500;line-height:1.8;margin:0;">正文内容文字，玻璃背景衬底清晰可读</p>
</div>
\`\`\`
关键：
- backdrop-filter **必须** 同时写标准属性 + -webkit- 前缀（兼容 Safari）
- background 用 rgba 白色半透明（0.45~0.65 之间，不要 100% 透明也不要 100% 实）
- border 加 1px 细白边增强玻璃边缘

### L1.5-2 渐变背景 + 渐变文字（gradient）
适用：styleTheme=gradient / cover / summary / value-showcase。

\`\`\`html
<!-- 渐变背景大卡（整页背景或局部面板）-->
<div style="padding:36px;border-radius:20px;background:linear-gradient(135deg,{{PRIMARY_COLOR}},{{PRIMARY_COLOR_DARKER}});box-shadow:0 12px 40px {{PRIMARY_COLOR}}35;">
  <!-- 深色背景→文字必须白色，遵守反色规则 -->
  <h2 style="font-size:44px;font-weight:800;margin:0;color:#fff;">大号渐变背景+白字标题</h2>
</div>

<!-- 渐变文字效果（浅底，用 background-clip:text）-->
<h3 style="font-size:32px;font-weight:800;margin:0;background:linear-gradient(135deg,{{PRIMARY_COLOR}},{{PRIMARY_COLOR_DARKER}});-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;">
  渐变文字效果标题
</h3>
\`\`\`

### L1.5-3 进度条（progress-bars）— ⚠️ 填充子块必须 pointer-events:none
适用：styleTheme=progress-bars / comparison-deep-dive / stats-highlight。

\`\`\`html
<!-- 进度条容器（✅ 点击选中这个容器）—— 渐变：135°斜向+对比色+内高光，不要 90°水平同色 -->
<div style="width:100%;height:14px;border-radius:999px;background:{{PRIMARY_COLOR}}20;overflow:hidden;">
  <!-- ⚠️ 填充子块必须 pointer-events:none；渐变用 135° 斜向 + 高对比色（亮→深），内阴影 inset 做高光，不要 box-shadow 外阴影 -->
  <div style="pointer-events:none;width:85%;height:100%;border-radius:999px;background:linear-gradient(135deg,{{PRIMARY_COLOR_LIGHTER}} 0%,{{PRIMARY_COLOR}} 45%,{{PRIMARY_COLOR_DARKER}} 100%);box-shadow:inset 0 1px 2px rgba(255,255,255,0.45),inset 0 -1px 2px rgba(0,0,0,0.12);"></div>
</div>

<!-- 完整对比项（文字+进度条+徽章，推荐 comparison-deep-dive 右栏）-->
<li style="display:flex;flex-direction:column;gap:10px;padding:24px 24px;border-radius:14px;background:linear-gradient(135deg,{{PRIMARY_COLOR}}0A,{{PRIMARY_COLOR}}15);border-left:5px solid {{PRIMARY_COLOR}};">
  <div style="display:flex;align-items:center;gap:12px;">
    <span style="display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,{{PRIMARY_COLOR}},{{PRIMARY_COLOR_DARKER}});color:#fff;font-size:14px;font-weight:800;">✓</span>
    <span style="font-size:20px;font-weight:700;color:#111827;line-height:1.4;flex:1;">核心竞争力提升</span>
    <!-- 值徽章 Badge -->
    <span style="pointer-events:none;display:inline-flex;align-items:center;padding:6px 14px;border-radius:999px;background:{{PRIMARY_COLOR}}18;color:{{PRIMARY_COLOR_DARKER}};font-size:18px;font-weight:800;">
      +85%
    </span>
  </div>
  <!-- 进度条容器：渐变 135°+三档色差，inset 内高光（不要外阴影） -->
  <div style="width:100%;height:12px;border-radius:999px;background:{{PRIMARY_COLOR}}20;overflow:hidden;">
    <div style="pointer-events:none;width:85%;height:100%;border-radius:999px;background:linear-gradient(135deg,{{PRIMARY_COLOR_LIGHTER}} 0%,{{PRIMARY_COLOR}} 45%,{{PRIMARY_COLOR_DARKER}} 100%);box-shadow:inset 0 1px 2px rgba(255,255,255,0.45),inset 0 -1px 2px rgba(0,0,0,0.12);"></div>
  </div>
</li>
\`\`\`

### L1.5-4 徽章 + 大号值块（badges）
适用：styleTheme=badges / value-showcase / content-compare。

\`\`\`html
<!-- 胶囊 Badge（✅ 选容器，文字子元素 pointer-events:none）-->
<span style="display:inline-flex;align-items:center;padding:10px 22px;border-radius:999px;background:linear-gradient(135deg,{{PRIMARY_COLOR}},{{PRIMARY_COLOR_DARKER}});box-shadow:0 4px 16px {{PRIMARY_COLOR}}35;color:#fff;font-size:20px;font-weight:700;">
  <span style="pointer-events:none;">🆕 NEW</span>
</span>

<!-- 大号 Value 展示卡（value-showcase 核心）-->
<div style="padding:40px;border-radius:20px;background:linear-gradient(135deg,{{PRIMARY_COLOR}}08,{{PRIMARY_COLOR}}18);border:1px solid {{PRIMARY_COLOR}}25;display:flex;flex-direction:column;gap:16px;align-items:center;justify-content:center;text-align:center;">
  <!-- ✅ 超大值块（选整个大卡，值文字本身 pointer-events:none）-->
  <div style="font-size:96px;font-weight:900;line-height:1;background:linear-gradient(135deg,{{PRIMARY_COLOR}},{{PRIMARY_COLOR_DARKER}});-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;">
    <span style="pointer-events:none;">42%</span>
  </div>
  <div style="display:flex;align-items:center;gap:10px;">
    <h3 style="font-size:28px;font-weight:700;margin:0;color:#111827;">市场份额同比增长</h3>
    <!-- 趋势徽章（↗ up 绿色 / ↘ down 红色 / → flat 灰色）-->
    <span style="pointer-events:none;display:inline-flex;align-items:center;padding:6px 14px;border-radius:999px;background:#10b98118;color:#059669;font-size:20px;font-weight:800;">
      ↗ +12.3pp
    </span>
  </div>
  <p style="font-size:22px;color:#6B7280;font-weight:500;margin:0;">2024 Q2 vs 2023 Q2</p>
</div>
\`\`\`

### L1.5-5 多彩语义卡片（colored-cards）
适用：styleTheme=colored-cards / cards / stats-highlight。

\`\`\`html
<!-- 4 张同结构同主色系卡片 Grid（✅ 单色系红线 0：仅用 {{PRIMARY_COLOR}} / {{PRIMARY_COLOR_DARKER}}）-->
<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:24px;">
  <!-- 卡片 1 -->
  <div style="padding:28px 24px;border-radius:16px;background:{{PRIMARY_COLOR}}12;border:1px solid {{PRIMARY_COLOR}}28;display:flex;flex-direction:column;gap:12px;min-width:0;">
    <span style="pointer-events:none;font-size:56px;font-weight:900;line-height:1;color:#111827;">¥12.8M</span>
    <h3 style="font-size:22px;font-weight:700;margin:0;color:{{PRIMARY_COLOR_DARKER}};">营收</h3>
    <span style="pointer-events:none;display:inline-flex;align-items:center;padding:4px 12px;border-radius:999px;background:{{PRIMARY_COLOR}}18;color:{{PRIMARY_COLOR}};font-size:16px;font-weight:700;width:fit-content;">YoY +23%</span>
  </div>
  <!-- 卡片 2 -->
  <div style="padding:28px 24px;border-radius:16px;background:{{PRIMARY_COLOR}}10;border:1px solid {{PRIMARY_COLOR}}24;display:flex;flex-direction:column;gap:12px;min-width:0;">
    <span style="pointer-events:none;font-size:56px;font-weight:900;line-height:1;color:#111827;">¥3.2M</span>
    <h3 style="font-size:22px;font-weight:700;margin:0;color:{{PRIMARY_COLOR_DARKER}};">毛利</h3>
    <span style="pointer-events:none;display:inline-flex;align-items:center;padding:4px 12px;border-radius:999px;background:{{PRIMARY_COLOR}}18;color:{{PRIMARY_COLOR}};font-size:16px;font-weight:700;width:fit-content;">margin 25%</span>
  </div>
  <!-- 卡片 3 -->
  <div style="padding:28px 24px;border-radius:16px;background:{{PRIMARY_COLOR}}10;border:1px solid {{PRIMARY_COLOR}}24;display:flex;flex-direction:column;gap:12px;min-width:0;">
    <span style="pointer-events:none;font-size:56px;font-weight:900;line-height:1;color:#111827;">86%</span>
    <h3 style="font-size:22px;font-weight:700;margin:0;color:{{PRIMARY_COLOR_DARKER}};">客户留存</h3>
    <span style="pointer-events:none;display:inline-flex;align-items:center;padding:4px 12px;border-radius:999px;background:{{PRIMARY_COLOR}}18;color:{{PRIMARY_COLOR}};font-size:16px;font-weight:700;width:fit-content;">↗ +5.2pp</span>
  </div>
  <!-- 卡片 4 -->
  <div style="padding:28px 24px;border-radius:16px;background:{{PRIMARY_COLOR}}12;border:1px solid {{PRIMARY_COLOR}}28;display:flex;flex-direction:column;gap:12px;min-width:0;">
    <span style="pointer-events:none;font-size:56px;font-weight:900;line-height:1;color:#111827;">2.3M</span>
    <h3 style="font-size:22px;font-weight:700;margin:0;color:{{PRIMARY_COLOR_DARKER}};">DAU</h3>
    <span style="pointer-events:none;display:inline-flex;align-items:center;padding:4px 12px;border-radius:999px;background:{{PRIMARY_COLOR}}18;color:{{PRIMARY_COLOR}};font-size:16px;font-weight:700;width:fit-content;">QoQ +41%</span>
  </div>
</div>
\`\`\`

**单色系卡片调色板（直接复制使用，不要复刻模板里的写死 hex；对比度与一致性由系统主色保证）：**
- 卡片/面板统一使用 {{PRIMARY_COLOR}} 的 10%~16% 透明度背景、24%~28% 边框；标题用 {{PRIMARY_COLOR_DARKER}}；正文/数值用中性灰阶 #111827 / #374151。
- 数值大字（≥24px）、卡片标题一律用深灰 #111827 或 {{PRIMARY_COLOR_DARKER}}；仅 ≤16px 的标签/徽章/强调符号、图标容器内 SVG/数字/字母可用 {{PRIMARY_COLOR}}。
- 成功/增长/胜出等明确语义才用 #10b981，警告/劣势/风险才用 #ef4444（其余不使用）。

### L1.5 编辑器可选中 · 强制红线（**必须遵守，不遵守=输出作废**）
保证幻灯片在编辑器中「元素可选、属性可改」的全局规则（常驻，单行速记）：
- 装饰性子元素（进度条填充/Badge文字/大Value数字/渐变halo）一律加 \`pointer-events:none;\`，点击穿透到父容器。
- 有意义容器（玻璃卡/进度条整体/大卡外壳/彩色卡片外层）须含非透明background、非零border、≥8px圆角或box-shadow之一，便于可选中。
- 勿用 \`writing-mode:vertical-rl\` 竖排（正文除外）；勿在装饰div写纯数字/字母"水印"；勿用position:absolute做主要布局（仅装饰halo/blob/分隔线可用）。

### 🔴 comparison-deep-dive 7 条刚性红线（本版式专属，违反任一条立即返工）
**⚠️ 只要 PAGE_TYPE = comparison-deep-dive，以下 7 条必须一字不差严格遵守：**
1. **左右栏 li 数量必须严格相等**（左栏 N 条 → 右栏 N 条，N=3~5，一条不差，多一条少一条都算违规；不要在右栏加"其他"占位或在左栏少一项）。
2. **禁止在 li 内部再嵌套 <p> 标签**：li 是 flex-direction:column 容器，内部直接放「图标行 div（display:flex 含图标+文字+徽章）」+「进度条容器 div」，不要有多余 <p> 包裹文字（会导致行高不统一、高度差溢出）。
3. **右栏每个 metricValues 对应进度条 width 必须用真实值**：第 i 项进度条填充 width = \`metricValues[i] + '%'\`，不要全部写成 85%、不要编造数值（12%→实际 12%，95%→实际 95%）。
4. **右栏 advantageIndices 对应项必须视觉强化三件套**（缺一不可）：① 图标替换为主色渐变圆背景 + 白色对勾（linear-gradient(135deg,{{PRIMARY_COLOR}},{{PRIMARY_COLOR_DARKER}}) 底 + fill="#fff" 对勾 SVG），**不用绿色渐变**；② 徽章 Badge 右侧额外加"+"号或"胜出"标识（如"+85% 胜出"样式，绿色字/绿色底浅背景）；③ 进度条填充 gradient 比非优势项深一档（暗 20%），**颜色仍为主色系（{{PRIMARY_COLOR}} / {{PRIMARY_COLOR_DARKER}}），不使用绿色——绿色仅保留用于胜出徽章/左边框/边框色**。
5. **禁止在左右栏容器内写入固定 width/height/left/top/max-width:none 等脏属性**：外层双栏容器永远用 flex:1 + gap:28px，内部卡片用 padding/border-radius/border/background 做造型，不要硬写 \`width:500px\`、\`height:600px\`、\`position:absolute\`、\`max-width:none\` 会被 LayoutEngine 后处理剔除（写了白写还容易错位）。
6. **禁止在普通项进度条渐变中使用与主题无关的 hex 颜色**：所有「非胜出项（NO 项）」进度条渐变必须**严格只使用以下 3 个颜色值**（本页上方示例里刚出现过的 3 个值，一字不差）：① \`{{PRIMARY_COLOR_LIGHTER}}\`（浅一档主色，首段 0%）→ ② \`{{PRIMARY_COLOR}}\`（主色，中段 45%）→ ③ \`{{PRIMARY_COLOR_DARKER}}\`（深一档主色，末段 100%），角度统一 135°，内高光用 \`box-shadow:inset 0 1px 2px rgba(255,255,255,0.45),inset 0 -1px 2px rgba(0,0,0,0.12)\`，**不要自己编造 #a855f7、#fbbf24 这类与主题色无关的颜色值**。「胜出项」进度条同样只用主色系，仅比普通项深一档（如 \`linear-gradient(135deg,{{PRIMARY_COLOR}} 0%,{{PRIMARY_COLOR_DARKER}} 45%,{{PRIMARY_COLOR_DARKER}} 100%)\`）；绿色仅保留用于胜出件的 ✓ 图标 / 胜出徽章 / 左边框，不进入进度条。
7. **本页型颜色总览 ≤5 种**：主色系（{{PRIMARY_COLOR}} / {{PRIMARY_COLOR_DARKER}}）+ 1 个语义绿（胜出 #10b981 / #059669）+ 中性灰阶；**禁止出现红/紫等其他色相**（如 #ef4444 / #dc2626 / #7c3aed / #34d399 等一律不得作为本页面板、进度条、图标或字体的主色）。

## 字体

> ⚠️ **禁止手写全局 font-family**：正确的字体栈已在下方「页面类型对应的HTML模板」中预置在最外层 <div> 的 style 里（与用户 fontFamily 显式参数匹配）。你只需要直接复制模板使用，**不要在自己的代码里再写 font-family 属性**（局部标题放大加粗可以保留 font-weight / font-size，但不要改字体族）。

{{FONT_STYLE_HINT}}

## 页面尺寸与容器（极其重要）

- 画布：{{SLIDE_WIDTH}}x{{SLIDE_HEIGHT}}
- 外边距padding：上下{{PADDING_Y}}px，左右{{PADDING_X}}px（固定）
- 最外层div必须包含：width:100%;height:100%;overflow:hidden;position:relative;box-sizing:border-box;padding:{{PADDING_Y}}px {{PADDING_X}}px;display:flex;flex-direction:column;background-color:#fff;font-family:...
- 所有flex直接子元素必须设置 min-width:0
- 文字容器设置 min-height:0;overflow:hidden;
- 图片容器设置 min-height:0;max-height:100%;overflow:hidden;display:flex;align-items:center;justify-content:center;
- 所有p、li、h标签必须设置 overflow-wrap:break-word;word-break:break-word;
- 不要使用position:absolute做主要布局（仅允许装饰性小元素）
- **装饰性元素绝对禁止规则（必遵守）**：
  1. **禁止生成任何「颜色代码水印/装饰文字」div**：页面背景/画布上绝对不允许出现 \`#\` 开头的十六进制颜色代码作为装饰文字（例："#2563b"、"#2563eb"、"#ffffff"、"主色#2563eb"、"RGB(37,99,235)" 等）。颜色信息只允许出现在 style 属性里，不允许出现在 div 文本内容中。
  2. 禁止在装饰性 div 中放数字/字母/符号作为纯视觉装饰（如 0、1、2、3、RGB、HEX、COLOR 等字符串），装饰性元素只能是纯形状（SVG/渐变/圆形/线条），不能带文字字符。
  3. **禁止使用 writing-mode 做装饰性竖排文字**：正文/列表/卡片中的文字全部使用默认横排（不要使用 writing-mode:vertical-rl/vertical-lr）。如果页面主题就是"竖排文字/古诗/中文古籍"类，只有在 li/ul 里明确使用 display:grid 两列布局（icon 列 + 文字列，列独立）才允许竖排文字；除此场景外一律横排。
  4. 禁止使用 position:absolute 把装饰文字叠在正文/卡片/列表之上做"水印效果"。

## 页面类型对应的HTML模板（严格使用对应模板，只替换文字内容）

> 🔴【参考优先 · 结构克隆】若上方「参考版式结构指引 / 参考结构骨架」已给出本页的版式结构（分区/栏数/图文方位/装饰形态/圆角/描边），**请以参考骨架为结构范本，下方内置模板仅作兜底样式参考**。禁止为了套用内置模板而改写参考明确给出的分栏方向、装饰元素或图文方位（例如参考为「左文右图」时不得生成「左图右文」镜像）。

{{PAGE_TEMPLATES}}

## 图片规范 · 强制遵守（红线 · 必须遵守，否则返工）

- **只要页面类型是 content-image-left / content-image-right / content-image-top，或任何"需要配图"的页面，HTML 中必须出现且只出现 1 处 &lt;img&gt; 占位符**
  - img 的 src 必须精确为："https://NOPPT_IMAGE_PLACEHOLDER"（前后加双引号、不要加任何前缀后缀、不要改成别的字符串）
  - 必须添加 data-image-ratio="{{IMAGE_RATIO}}" 属性
  - img 样式必须写：width:100%;height:100%;object-fit:cover;border-radius:16px;display:block;
  - img 的外层容器必须写：overflow:hidden;display:flex;align-items:stretch;
- **禁止**：把占位符写在注释里、写成 src="data:image/..." 代替占位符、遗漏占位符、占位符写 2 个及以上

## 语义化标签 · 强制红线（必须遵守，否则返工）

### 定义
**裸文本 = 可见文字字符（非注释、非 style/class 属性值）直接出现在容器标签内，没有被任何文字语义标签包裹。**
- 允许作为文字"容器"的语义标签（文字放在这里面 = 安全）：h1, h2, h3, h4, h5, h6, p, li, span, a, strong, em, b, i, u, figcaption, td, th, label, code, pre, blockquote, sup, sub, button
- 容器标签（内部不允许直接出现文字，必须再套上面的语义标签）：div, section, article, aside, nav, main, header, footer

### 映射规则
- 主标题 → h1；页面标题 → h2；卡片小标题 → h3
- 正文段落（独立的一句话）→ p
- 正文要点列表（2 条及以上、按行展示的要点）→ ul/ol + li（推荐！）
- 禁止用 <div> / <section> / <article> 直接包裹纯文本
- 禁止无意义多层嵌套 div
- <li> 内部直接放 <span> 图标 + 文字内容，不要再额外套 <div> 或独立 <p>

### BAD / GOOD 对比例（必须遵守）

❌ BAD 1（每行文字裸放在容器里）：
~~~html
<div style="...padding:48px 64px;...">
  <h2>产品定位</h2>
  字节跳动自研
  深度集成大模型
  无缝衔接 IDE
  团队知识共享
</div>
~~~

✅ GOOD 1（用 ul + li 列表包裹每一条要点，推荐写法）：
~~~html
<div style="...padding:48px 64px;...">
  <h2>产品定位</h2>
  <ul style="list-style:none;...">
    <li style="display:flex;align-items:center;..."><span>图标</span><span>字节跳动自研</span></li>
    <li style="display:flex;align-items:center;..."><span>图标</span><span>深度集成大模型</span></li>
    <li style="display:flex;align-items:center;..."><span>图标</span><span>无缝衔接 IDE</span></li>
    <li style="display:flex;align-items:center;..."><span>图标</span><span>团队知识共享</span></li>
  </ul>
</div>
~~~

❌ BAD 2（h2 后直接跟裸文本行，没有任何包裹）：
~~~html
<h2>智能工作流</h2>
需求智能拆解
上下文精准理解
代码自动补全
测试用例生成
~~~

✅ GOOD 2（如果确实不想用列表，用 <p> 逐段包裹也可以，但推荐优先用 li）：
~~~html
<h2>智能工作流</h2>
<p style="font-size:20px;color:#374151;font-weight:600;line-height:2.0;">需求智能拆解</p>
<p style="font-size:20px;color:#374151;font-weight:600;line-height:2.0;">上下文精准理解</p>
<p style="font-size:20px;color:#374151;font-weight:600;line-height:2.0;">代码自动补全</p>
<p style="font-size:20px;color:#374151;font-weight:600;line-height:2.0;">测试用例生成</p>
~~~

## 内容要求

- **信息密度优先**：要点是有信息量的断言短语（8-20字），包含具体数字或事实，不是空洞形容词
- **禁止"标题：解释"格式**：要点本身就是完整的事实陈述，不需要冒号后补充说明
- **图标使用**：严格按照iconStyle选择对应图标，放在<li>内最前面
- **自适应填充**：通过合理字号、行高（line-height:1.7-1.9）、间距（gap:16-24px）填充空间；要点较长时缩小字号和间距而非溢出
- 图片撑满容器宽度（width:100%）
- **防溢出优先**：当要点文字较长时，优先降字号、缩间距、用双列，绝不允许文字超出画布

## 自检清单 · 逐条核对后再输出

1. 最外层div是否有正确padding和overflow:hidden？
2. h2标题是否使用了渐变色文字效果（background-clip:text）？断言式标题较长(>14字)时用50px；较短(≤14字)时用52px？H2最小不得低于50px，确保与正文字号比≥2.5倍。
3. 列表项是否使用了对应iconStyle的图标，是否flex布局？
4. 卡片/目录/时间轴的图标是否是渐变圆形+阴影？
5. flex子元素是否都有min-width:0？
6. 文字是否在p/h/li标签内？
7. 要点是否为有信息量的断言短语（8-20字），无空洞形容词、无冒号解释？
8. 要点文字较长（>15字）或要点较多（≥4个）时，是否主动降了字号（20→19→18，不低于最小字号16px）？标准正文字号禁止用22px或24px。22/24/28 均为非法正文。
9. **【关键】** 若页面类型要求配图（content-image-left/right/top 等），是否已添加且仅添加了 1 个 &lt;img src="https://NOPPT_IMAGE_PLACEHOLDER" data-image-ratio="..."&gt; 标签？禁止遗漏，也禁止写 2 个及以上。
10. **【关键 · 语义化红线】** 所有可见文字（除注释内的文字外）是否都被包裹在语义标签中？
    - 页面标题 → &lt;h2&gt;；卡片小标题 → &lt;h3&gt;；正文要点 → &lt;ul&gt;/&lt;ol&gt; + &lt;li&gt;（推荐）或 &lt;p&gt; 段落
    - 禁止：&lt;div&gt; / &lt;section&gt; / &lt;article&gt; 内部直接出现可见文字（不以 < 开头的可见行）
    - 自检方法：逐行看 h2 之后的内容，如有可见行不以标签字符开头，立刻把该行包一层 &lt;p style="font-size:19px;color:#374151;font-weight:600;line-height:1.8;"&gt;...&lt;/p&gt; 或放入 &lt;li&gt; 内
11. 所有正文/数值文字是否避开了主色与主色浅底组合（白底主色字=对比不足，主色浅底主色字=隐形）？

## 该页规划信息

- 页面类型：{{PAGE_TYPE}}
- 页面标题：{{PAGE_TITLE}}
- 要点内容：
{{KEY_POINTS}}
- 配图要求：{{IMAGE_REQUIREMENT}}
- 内容密度：{{DENSITY}}
- 图标风格：{{ICON_STYLE}}

请生成该页HTML：
`;

/**
 * S2 · 本地字体栈工具：根据 fontFamily (sans/serif/mono) 输出不同的 CSS font-family 栈。
 * 和 packages/ai/src/agents/html-presentation-agent.ts 中 getFontStack 保持内容一致（双份定义以避免跨模块依赖）。
 *
 * ★ 漂移回归守卫：三分支（sans/serif/mono）返回值必须与 html-presentation-agent.ts#getFontStack 逐字节全等。
 *   CI 通过 fontstack-dual-source-sync.test.ts 保证此约束，修改任意一处时必须同步另一处并过测试。
 *   长期 TODO：抽 packages/shared/fonts.ts 常量，两处 import 同一个对象（避免双份）。
 * ★ 修改同步点：
 *   - templates: packages/ai/src/templates/generate-html-presentation.ts#getFontStackLocal
 *   - ai: packages/ai/src/agents/html-presentation-agent.ts#getFontStack
 */
function getFontStackLocal(family: 'sans' | 'serif' | 'mono' = 'sans'): string {
  switch (family) {
    case 'serif':
      return "'Noto Serif SC', 'Source Han Serif SC', Georgia, 'Times New Roman', Times, serif";
    case 'mono':
      return "'JetBrains Mono', ui-monospace, 'Cascadia Code', Consolas, 'PingFang SC', 'Microsoft YaHei', '微软雅黑', 'Noto Sans SC', 'Noto Sans Mono CJK SC', monospace";
    case 'sans':
    default:
      return "system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', '微软雅黑', 'Noto Sans SC', 'Segoe UI', Roboto, sans-serif";
  }
}

function roundTo8(n: number): number {
  return Math.round(n / 8) * 8;
}

function computePadding(slideWidth: number, slideHeight: number): { x: number; y: number } {
  const baseX = 64,
    baseY = 48;
  const scale = Math.min(slideWidth / 1280, slideHeight / 720);
  return { x: roundTo8(Math.max(32, baseX * scale)), y: roundTo8(Math.max(24, baseY * scale)) };
}

const GRAD_TEXT =
  'background:linear-gradient(135deg,{{PRIMARY_COLOR}},{{PRIMARY_COLOR_DARKER}});-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;';

/**
 * 线性/面性图标按索引循环使用的语义 key 序列。
 * 顺序经过设计，覆盖 B 端技术场景最常见的概念，相邻图标语义不重复。
 */
const SEMANTIC_ICON_SEQUENCE: SemanticIconKey[] = [
  'target',
  'code',
  'zap',
  'shield',
  'bulb',
  'users',
  'rocket',
  'chart',
  'layers',
  'cloud',
  'database',
  'tool',
  'globe',
  'search',
  'sparkle',
  'key',
  'cpu',
  'branch',
  'package',
  'terminal',
  'check',
  'settings',
  'eye',
  'clock',
];

function getSemanticIconByIndex(idx: number): SemanticIconKey {
  return SEMANTIC_ICON_SEQUENCE[idx % SEMANTIC_ICON_SEQUENCE.length];
}

function getIcons(iconStyle: string, idx: number, primary: string, darker: string): string {
  const grad = `linear-gradient(135deg,${primary},${darker})`;
  const shadow = `0 2px 8px ${primary}40`;
  const letter = String.fromCharCode(65 + (idx % 26));

  // Emoji池，按索引循环使用
  const emojiPool = [
    '🎯',
    '📊',
    '⚡',
    '🛡️',
    '💡',
    '🤝',
    '🚀',
    '📈',
    '🔍',
    '✨',
    '🔥',
    '⭐',
    '🏆',
    '🎨',
    '💎',
    '🌐',
    '🔑',
    '📱',
    '💻',
    '🔧',
  ];
  const emoji = emojiPool[idx % emojiPool.length];

  switch (iconStyle) {
    case 'line': {
      // 线性（描边）图标：Lucide 风格，主色描边，无背景，轻量化
      const key = getSemanticIconByIndex(idx);
      return `<span style="display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:28px;height:28px;border-radius:8px;background:${primary}10;color:${primary};">${renderSvgIcon(key, 'line', 18, primary, 2)}</span>`;
    }
    case 'filled': {
      // 面性（填充）图标：实心色块，主色填充，视觉权重高
      const key = getSemanticIconByIndex(idx);
      return `<span style="display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:28px;height:28px;border-radius:8px;background:${grad};box-shadow:${shadow};color:#fff;">${renderSvgIcon(key, 'filled', 18, '#fff', 0)}</span>`;
    }
    case 'numbered':
      return `<span style="display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:28px;height:28px;border-radius:8px;background:${grad};box-shadow:${shadow};color:#fff;font-size:14px;font-weight:800;">${idx + 1}</span>`;
    case 'checkmark': // 兼容旧值
    case 'bullet': {
      // 对勾样式（bullet默认对勾，AI可在生成时自行切换圆点）
      return `<span style="display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:28px;height:28px;border-radius:50%;background:${grad};box-shadow:${shadow};"><svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M13 4L6.5 10.5L3 7" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg></span>`;
    }
    case 'lettered':
      return `<span style="display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:28px;height:28px;border-radius:50%;background:${grad};box-shadow:${shadow};color:#fff;font-size:13px;font-weight:800;">${letter}</span>`;
    case 'minimal': // 兼容旧值
      return `<span style="display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:10px;height:10px;border-radius:50%;background:${primary};"></span>`;
    case 'emoji': {
      // 交替使用纯emoji和圆角矩形背景emoji，让模板效果更丰富
      const useBg = idx % 2 === 1;
      if (useBg) {
        const radius = idx % 4 === 1 ? '10px' : '50%'; // 交替圆角矩形和圆形
        return `<span style="display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:40px;height:40px;border-radius:${radius};background:${primary}12;font-size:20px;line-height:1;">${emoji}</span>`;
      }
      return `<span style="display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:32px;height:28px;font-size:22px;line-height:1;">${emoji}</span>`;
    }
    case 'none':
      return '';
    case 'auto':
    default:
      // auto 默认使用线性图标（B 端技术场景最安全、最专业的选择）
      const key = getSemanticIconByIndex(idx);
      return `<span style="display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:28px;height:28px;border-radius:8px;background:${primary}10;color:${primary};">${renderSvgIcon(key, 'line', 18, primary, 2)}</span>`;
  }
}

/**
 * 生成emoji大图标（用于卡片顶部/目录/时间轴的emoji版本）
 * @param size 容器尺寸
 * @param emojiSize emoji字体大小
 * @param idx 索引（用于从池中取emoji并决定背景形状）
 * @param primary 主色
 */
function getEmojiBigIcon(size: number, emojiSize: number, idx: number, primary: string): string {
  const emojiPool = [
    '🎯',
    '📊',
    '⚡',
    '🛡️',
    '💡',
    '🤝',
    '🚀',
    '📈',
    '🔍',
    '✨',
    '🔥',
    '⭐',
    '🏆',
    '🎨',
    '💎',
    '🌐',
    '🔑',
    '📱',
    '💻',
    '🔧',
  ];
  const emoji = emojiPool[idx % emojiPool.length];
  // 大图标默认使用圆角矩形背景
  const radius = Math.round(size / 4);
  return `<span style="display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:${size}px;height:${size}px;border-radius:${radius}px;background:${primary}12;font-size:${emojiSize}px;line-height:1;">${emoji}</span>`;
}

/**
 * 生成纯emoji图标（无背景版本，用于标题前点缀等）
 */
function getCircleIcon(
  size: number,
  fontSize: number,
  num: number,
  primary: string,
  darker: string,
  fontWeight: number = 700,
  shadowAlpha: string = '30',
): string {
  const grad = `linear-gradient(135deg,${primary},${darker})`;
  const shadow = `0 ${size > 44 ? 4 : 3}px ${size > 44 ? 16 : 12}px ${primary}${shadowAlpha}`;
  return `<span style="display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:${size}px;height:${size}px;border-radius:50%;background:${grad};box-shadow:${shadow};color:#fff;font-size:${fontSize}px;font-weight:${fontWeight};">${num}</span>`;
}

function getCompareRightIcon(primary: string, darker: string): string {
  const grad = `linear-gradient(135deg,${primary},${darker})`;
  const shadow = `0 2px 8px ${primary}40`;
  return `<span style="display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:28px;height:28px;border-radius:50%;background:${grad};box-shadow:${shadow};"><svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M13 4L6.5 10.5L3 7" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg></span>`;
}

function getCompareLeftIcon(): string {
  return `<span style="display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:20px;height:20px;border-radius:50%;background:#E5E7EB;"><svg width="10" height="10" viewBox="0 0 10 10"><rect x="2" y="4.5" width="6" height="1.5" rx="0.75" fill="#9CA3AF"/></svg></span>`;
}

function buildLi(icon: string, text: string): string {
  if (!icon) {
    return `<li style="overflow-wrap:break-word;word-break:break-word;">${text}</li>`;
  }
  return `<li style="display:flex;align-items:center;gap:16px;overflow-wrap:break-word;word-break:break-word;">${icon}<span style="line-height:1.4;flex:1;">${text}</span></li>`;
}

function getPageTemplates(
  slideWidth: number = 1280,
  slideHeight: number = 720,
  iconStyle: string = 'auto',
  fontFamily: 'sans' | 'serif' | 'mono' = 'sans',
): string {
  const pad = computePadding(slideWidth, slideHeight);
  const PX = pad.x,
    PY = pad.y;
  const P = '{{PRIMARY_COLOR}}';
  const PD = '{{PRIMARY_COLOR_DARKER}}';
  const FONT_STACK_ACTIVE = getFontStackLocal(fontFamily);
  const GRAD = `linear-gradient(135deg,${P},${PD})`;
  const OUTER = `width:100%;height:100%;overflow:hidden;position:relative;box-sizing:border-box;padding:${PY}px ${PX}px;display:flex;flex-direction:column;background-color:{{CANVAS_BG_COLOR}};font-family:${FONT_STACK_ACTIVE}`;
  const GRAD_H2 = `font-size:50px;font-weight:700;margin:0 0 32px 0;line-height:1.25;letter-spacing:-0.01em;overflow-wrap:break-word;word-break:break-word;${GRAD_TEXT}`;
  // 封面海报级 H1：超字号+900字重+多层发光+渐变描边（注意 text-shadow 与 -webkit-text-fill-color:transparent 不冲突，阴影在透明字外发光）
  const GRAD_H1 = `font-size:92px;font-weight:900;margin:0 0 32px 0;line-height:1.1;letter-spacing:0.01em;width:100%;text-align:center;overflow-wrap:break-word;word-break:break-word;${GRAD_TEXT}-webkit-text-stroke:1.5px ${P}80;text-shadow:0 4px 30px ${P}50, 0 0 70px ${P}30, 0 0 140px ${P}15;`;
  const GRAD_SUMMARY = `font-size:72px;font-weight:800;margin:0 0 24px 0;line-height:1.1;letter-spacing:0.01em;text-align:center;overflow-wrap:break-word;word-break:break-word;${GRAD_TEXT}text-shadow:0 4px 24px ${P}45;`;
  // 渐变文字 for H3 卡片标题
  const GRAD_H3_CARD = `background:linear-gradient(135deg,${P},${PD});-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;`;

  const icon0 = getIcons(iconStyle, 0, P, PD);
  const icon1 = getIcons(iconStyle, 1, P, PD);
  const icon2 = getIcons(iconStyle, 2, P, PD);
  const icon3 = getIcons(iconStyle, 3, P, PD);
  const icon4 = getIcons(iconStyle, 4, P, PD);

  const li0 = (text: string) => buildLi(icon0, text);
  const li1 = (text: string) => buildLi(icon1, text);
  const li2 = (text: string) => buildLi(icon2, text);
  const li3 = (text: string) => buildLi(icon3, text);
  const li4 = (text: string) => buildLi(icon4, text);

  // 根据iconStyle选择大图标类型
  // - emoji: emoji圆角背景
  // - line: 线性SVG图标 + 浅色圆角背景
  // - filled: 面性SVG图标 + 渐变实心背景
  // - 其他（numbered/bullet/lettered/auto）: 数字渐变圆
  const useEmojiBigIcons = iconStyle === 'emoji';
  const useLineBigIcons = iconStyle === 'line' || iconStyle === 'auto';
  const useFilledBigIcons = iconStyle === 'filled';

  const getBigIcon = (idx: number, size: number, iconSize: number): string => {
    if (useEmojiBigIcons) return getEmojiBigIcon(size, Math.round(iconSize * 1.27), idx, P);
    if (useLineBigIcons) {
      const key = getSemanticIconByIndex(idx);
      return renderBadgeIcon(key, 'line', size, iconSize, P, 'rounded');
    }
    if (useFilledBigIcons) {
      const key = getSemanticIconByIndex(idx);
      return renderBadgeIcon(key, 'filled', size, iconSize, P, 'rounded');
    }
    return getCircleIcon(size, Math.round(iconSize * 0.82), idx + 1, P, PD, 800, '35');
  };

  const tocIcon0 = getBigIcon(0, 44, 20);
  const tocIcon1 = getBigIcon(1, 44, 20);
  const tocIcon2 = getBigIcon(2, 44, 20);

  const cardIcon0 = getBigIcon(0, 48, 22);
  const cardIcon1 = getBigIcon(1, 48, 22);
  const cardIcon2 = getBigIcon(2, 48, 22);
  const cardIcon3 = getBigIcon(3, 48, 22);

  const listCardIcon0 = getBigIcon(0, 40, 20);
  const listCardIcon1 = getBigIcon(1, 40, 20);
  const listCardIcon2 = getBigIcon(2, 40, 20);
  const listCardIcon3 = getBigIcon(3, 40, 20);

  const gridCardIcon0 = getBigIcon(0, 36, 18);
  const gridCardIcon1 = getBigIcon(1, 36, 18);
  const gridCardIcon2 = getBigIcon(2, 36, 18);
  const gridCardIcon3 = getBigIcon(3, 36, 18);

  const tlIcon0 = getBigIcon(0, 40, 18);
  const tlIcon1 = getBigIcon(1, 40, 18);
  const tlIcon2 = getBigIcon(2, 40, 18);

  const zigzagIcon1 = getBigIcon(7, 64, 32);
  const zigzagIcon2 = getBigIcon(6, 64, 32);

  const cmpRight = getCompareRightIcon(P, PD);
  const cmpLeft = getCompareLeftIcon();

  return `
### cover（封面页 · 海报级艺术字版本）
\`\`\`html
<div style="${OUTER};justify-content:center;align-items:center;text-align:center;overflow:hidden;">
  <!-- 装饰渐变形状1：右上角光晕椭圆 -->
  <div style="position:absolute;top:-80px;right:-120px;width:520px;height:520px;border-radius:50%;background:radial-gradient(circle,${P}35 0%,${P}10 45%,transparent 75%);pointer-events:none;"></div>
  <!-- 装饰渐变形状2：左下角渐变斜切 -->
  <div style="position:absolute;left:-160px;bottom:-120px;width:480px;height:400px;background:linear-gradient(135deg,${P}18,${PD}10);clip-path:polygon(0 30%,40% 0,80% 60%,30% 100%);pointer-events:none;"></div>
  <!-- 装饰细线：左侧渐变竖线 -->
  <div style="position:absolute;left:80px;top:20%;bottom:20%;width:3px;background:linear-gradient(180deg,transparent,${P},transparent);border-radius:2px;pointer-events:none;"></div>
  <!-- 加粗渐变装饰下划线/分隔线（在标题下方） -->
  <h1 style="${GRAD_H1}">主标题文字</h1>
  <div style="width:180px;height:8px;background:linear-gradient(90deg,${P},${PD});border-radius:4px;margin:0 0 32px 0;box-shadow:0 4px 20px ${P}45;"></div>
  <!-- 副标题分层：第1行加粗+主色渐变，第2~3行深灰，最后胶囊badge -->
  <p style="font-size:32px;font-weight:700;line-height:1.4;margin:0 0 16px 0;overflow-wrap:break-word;word-break:break-word;${GRAD_TEXT.replace(/background:linear/, 'background:linear').slice(0, -1)};">副标题·核心定位（加粗渐变大字）</p>
  <p style="font-size:24px;color:#1F2937;font-weight:600;margin:0 0 8px 0;line-height:1.5;overflow-wrap:break-word;word-break:break-word;">副标题第二行·亮点描述</p>
  <p style="font-size:24px;color:#1F2937;font-weight:600;margin:0 0 32px 0;line-height:1.5;overflow-wrap:break-word;word-break:break-word;">副标题第三行·延伸信息</p>
  <!-- 胶囊 badge -->
  <div style="display:inline-flex;align-items:center;padding:8px 24px;border-radius:999px;background:${P}12;color:${P};font-size:18px;font-weight:600;letter-spacing:0.02em;box-shadow:0 2px 8px ${P}20;overflow-wrap:break-word;word-break:break-word;">作者 / 公司 / 出品信息</div>
</div>
\`\`\`

### cover-left（封面页 · 左对齐构图版本 · 当参考为左对齐构图时使用）
**当上方「参考版式结构指引 / 覆盖指令」标注左对齐构图时，使用本模板而非上面的居中封面；内容列左对齐、垂直居中，禁止居中三件套。**
\`\`\`html
<div style="width:100%;height:100%;overflow:hidden;position:relative;box-sizing:border-box;padding:${PY}px ${PX}px;display:flex;flex-direction:column;justify-content:center;align-items:flex-start;text-align:left;background-color:{{CANVAS_BG_COLOR}};font-family:${FONT_STACK_ACTIVE}">
  <!-- 装饰：左上角几何色块（参考孟菲斯撞色风格） -->
  <div style="position:absolute;top:48px;left:48px;width:120px;height:120px;background:linear-gradient(135deg,${P},${PD});border-radius:24px;transform:rotate(12deg);opacity:0.9;pointer-events:none;"></div>
  <div style="position:absolute;bottom:-60px;right:-60px;width:320px;height:320px;border-radius:50%;background:radial-gradient(circle,${P}30 0%,${P}10 45%,transparent 75%);pointer-events:none;"></div>
  <!-- 内容列左对齐，占 ~58% 宽 -->
  <div style="position:relative;max-width:58%;min-width:0;display:flex;flex-direction:column;align-items:flex-start;gap:24px;">
    <h1 style="font-size:80px;font-weight:900;line-height:1.1;margin:0;letter-spacing:-0.01em;color:{{TITLE_TEXT_COLOR}};overflow-wrap:break-word;word-break:break-word;">主标题文字</h1>
    <div style="width:160px;height:8px;background:linear-gradient(90deg,${P},${PD});border-radius:4px;box-shadow:0 4px 20px ${P}45;"></div>
    <p style="font-size:28px;font-weight:700;line-height:1.4;margin:0;color:{{TITLE_TEXT_COLOR}};overflow-wrap:break-word;word-break:break-word;">核心定位副标题</p>
    <p style="font-size:22px;color:#5c5c72;font-weight:600;margin:0;line-height:1.5;overflow-wrap:break-word;word-break:break-word;">延伸说明副标题</p>
    <div style="display:inline-flex;align-items:center;padding:8px 24px;border-radius:999px;background:${P}12;color:${P};font-size:18px;font-weight:600;letter-spacing:0.02em;box-shadow:0 2px 8px ${P}20;">作者 / 公司 / 出品信息</div>
  </div>
</div>
\`\`\`

### toc（目录页）
\`\`\`html
<div style="${OUTER};">
  <h2 style="${GRAD_H2}">目录</h2>
  <div style="flex:1;display:flex;flex-direction:column;gap:24px;justify-content:center;min-height:0;">
    <div style="display:flex;align-items:center;gap:24px;padding:24px 32px;background:${P}08;border-radius:12px;min-width:0;">
      ${tocIcon0}
      <span style="font-size:20px;color:#374151;font-weight:600;overflow-wrap:break-word;word-break:break-word;">条目一</span>
    </div>
    <div style="display:flex;align-items:center;gap:24px;padding:24px 32px;background:${P}08;border-radius:12px;min-width:0;">
      ${tocIcon1}
      <span style="font-size:20px;color:#374151;font-weight:600;overflow-wrap:break-word;word-break:break-word;">条目二</span>
    </div>
    <div style="display:flex;align-items:center;gap:24px;padding:24px 32px;background:${P}08;border-radius:12px;min-width:0;">
      ${tocIcon2}
      <span style="font-size:20px;color:#374151;font-weight:600;overflow-wrap:break-word;word-break:break-word;">条目三</span>
    </div>
  </div>
</div>
\`\`\`

### content-image-left（左图右文 · 55:45比例 · 卡片条化）
**本模板为最终版式准绳：图片容器 flex:0 0 45% 且绝对不得有 margin；文字列 flex:0 0 55%；除替换文字内容外，不要改动结构与尺寸比例。**
\`\`\`html
<div style="${OUTER};">
  <h2 style="${GRAD_H2}">页面标题</h2>
  <div style="flex:1;display:flex;gap:40px;align-items:stretch;min-height:0;min-width:0;">
    <div style="flex:0 0 45%;display:flex;align-items:stretch;min-height:0;min-width:0;overflow:hidden;border-radius:16px;">
      <img src="https://NOPPT_IMAGE_PLACEHOLDER" data-image-ratio="4:3" style="width:100%;height:100%;object-fit:cover;border-radius:16px;display:block;">
    </div>
    <div style="flex:0 0 55%;display:flex;flex-direction:column;gap:0;min-height:0;min-width:0;overflow:hidden;justify-content:space-evenly;">
      <ul style="margin:0;padding:0;list-style:none;min-width:0;display:flex;flex-direction:column;gap:24px;flex:1;min-height:0;">
        <li style="display:flex;align-items:center;gap:16px;overflow-wrap:break-word;word-break:break-word;padding:24px 24px;border-radius:16px;background:linear-gradient(135deg,${P}08,${P}10);border-left:5px solid ${P};box-shadow:0 4px 16px ${P}15;min-width:0;">
          ${listCardIcon0}
          <span style="font-size:20px;font-weight:600;color:#111827;line-height:1.4;flex:1;min-width:0;overflow-wrap:break-word;word-break:break-word;">核心要点一</span>
        </li>
        <li style="display:flex;align-items:center;gap:16px;overflow-wrap:break-word;word-break:break-word;padding:24px 24px;border-radius:16px;background:linear-gradient(135deg,${P}08,${P}10);border-left:5px solid ${P};box-shadow:0 4px 16px ${P}15;min-width:0;">
          ${listCardIcon1}
          <span style="font-size:20px;font-weight:600;color:#111827;line-height:1.4;flex:1;min-width:0;overflow-wrap:break-word;word-break:break-word;">核心要点二</span>
        </li>
        <li style="display:flex;align-items:center;gap:16px;overflow-wrap:break-word;word-break:break-word;padding:24px 24px;border-radius:16px;background:linear-gradient(135deg,${P}08,${P}10);border-left:5px solid ${P};box-shadow:0 4px 16px ${P}15;min-width:0;">
          ${listCardIcon2}
          <span style="font-size:20px;font-weight:600;color:#111827;line-height:1.4;flex:1;min-width:0;overflow-wrap:break-word;word-break:break-word;">核心要点三</span>
        </li>
        <li style="display:flex;align-items:center;gap:16px;overflow-wrap:break-word;word-break:break-word;padding:24px 24px;border-radius:16px;background:linear-gradient(135deg,${P}08,${P}10);border-left:5px solid ${P};box-shadow:0 4px 16px ${P}15;min-width:0;">
          ${listCardIcon3}
          <span style="font-size:20px;font-weight:600;color:#111827;line-height:1.4;flex:1;min-width:0;overflow-wrap:break-word;word-break:break-word;">核心要点四</span>
        </li>
      </ul>
    </div>
  </div>
</div>
\`\`\`

### content-image-right（右图左文 · 55:45比例 · 卡片条化）
**本模板为最终版式准绳：图片容器 flex:0 0 45% 且绝对不得有 margin；文字列 flex:0 0 55%；除替换文字内容外，不要改动结构与尺寸比例。**
\`\`\`html
<div style="${OUTER};">
  <h2 style="${GRAD_H2}">页面标题</h2>
  <div style="flex:1;display:flex;gap:40px;align-items:stretch;min-height:0;min-width:0;">
    <div style="flex:0 0 55%;display:flex;flex-direction:column;gap:0;min-height:0;min-width:0;overflow:hidden;justify-content:space-evenly;">
      <ul style="margin:0;padding:0;list-style:none;min-width:0;display:flex;flex-direction:column;gap:24px;flex:1;min-height:0;">
        <li style="display:flex;align-items:center;gap:16px;overflow-wrap:break-word;word-break:break-word;padding:24px 24px;border-radius:16px;background:linear-gradient(135deg,${P}08,${P}10);border-left:5px solid ${P};box-shadow:0 4px 16px ${P}15;min-width:0;">
          ${listCardIcon0}
          <span style="font-size:20px;font-weight:600;color:#111827;line-height:1.4;flex:1;min-width:0;overflow-wrap:break-word;word-break:break-word;">核心要点一</span>
        </li>
        <li style="display:flex;align-items:center;gap:16px;overflow-wrap:break-word;word-break:break-word;padding:24px 24px;border-radius:16px;background:linear-gradient(135deg,${P}08,${P}10);border-left:5px solid ${P};box-shadow:0 4px 16px ${P}15;min-width:0;">
          ${listCardIcon1}
          <span style="font-size:20px;font-weight:600;color:#111827;line-height:1.4;flex:1;min-width:0;overflow-wrap:break-word;word-break:break-word;">核心要点二</span>
        </li>
        <li style="display:flex;align-items:center;gap:16px;overflow-wrap:break-word;word-break:break-word;padding:24px 24px;border-radius:16px;background:linear-gradient(135deg,${P}08,${P}10);border-left:5px solid ${P};box-shadow:0 4px 16px ${P}15;min-width:0;">
          ${listCardIcon2}
          <span style="font-size:20px;font-weight:600;color:#111827;line-height:1.4;flex:1;min-width:0;overflow-wrap:break-word;word-break:break-word;">核心要点三</span>
        </li>
        <li style="display:flex;align-items:center;gap:16px;overflow-wrap:break-word;word-break:break-word;padding:24px 24px;border-radius:16px;background:linear-gradient(135deg,${P}08,${P}10);border-left:5px solid ${P};box-shadow:0 4px 16px ${P}15;min-width:0;">
          ${listCardIcon3}
          <span style="font-size:20px;font-weight:600;color:#111827;line-height:1.4;flex:1;min-width:0;overflow-wrap:break-word;word-break:break-word;">核心要点四</span>
        </li>
      </ul>
    </div>
    <div style="flex:0 0 45%;display:flex;align-items:stretch;min-height:0;min-width:0;overflow:hidden;border-radius:16px;">
      <img src="https://NOPPT_IMAGE_PLACEHOLDER" data-image-ratio="4:3" style="width:100%;height:100%;object-fit:cover;border-radius:16px;display:block;">
    </div>
  </div>
</div>
\`\`\`

### content-image-top（上图下文 · 要点 ≤ 3 → 单列）
\`\`\`html
<div style="${OUTER};">
  <h2 style="${GRAD_H2}">页面标题</h2>
  <div style="flex:0 0 40%;display:flex;align-items:stretch;min-height:0;min-width:0;overflow:hidden;border-radius:16px;margin-bottom:20px;">
    <img src="https://NOPPT_IMAGE_PLACEHOLDER" data-image-ratio="21:9" style="width:100%;height:100%;object-fit:cover;border-radius:16px;display:block;">
  </div>
  <div style="flex:1;display:flex;flex-direction:column;gap:0;min-height:0;min-width:0;overflow:hidden;justify-content:center;">
    <ul style="font-size:19px;color:#374151;margin:0;padding:0;list-style:none;min-width:0;display:flex;flex-direction:column;gap:16px;">
      ${li0('核心要点一')}
      ${li1('核心要点二')}
      ${li2('核心要点三')}
    </ul>
  </div>
</div>
\`\`\`

### content-image-top（上图下文 · 要点 ≥ 4 → 双列 Grid）
要点数 ≥ 4 时必须用以下双列 Grid 版本（图片更扁 21:9 + 图片更矮 33% + li padding/字号/icon 更紧凑）：
\`\`\`html
<div style="${OUTER};">
  <h2 style="${GRAD_H2}">页面标题</h2>
  <div style="flex:0 0 33%;display:flex;align-items:stretch;min-height:0;min-width:0;overflow:hidden;border-radius:16px;margin-bottom:16px;">
    <img src="https://NOPPT_IMAGE_PLACEHOLDER" data-image-ratio="21:9" style="width:100%;height:100%;object-fit:cover;border-radius:16px;display:block;">
  </div>
  <div style="flex:1;display:flex;flex-direction:column;gap:0;min-height:0;min-width:0;overflow:hidden;justify-content:center;">
    <ul style="font-size:19px;color:#374151;margin:0;padding:0;list-style:none;min-width:0;display:grid;grid-template-columns:repeat(2,1fr);gap:16px 24px;">
      <li style="display:flex;align-items:center;gap:16px;overflow-wrap:break-word;word-break:break-word;padding:16px 24px;border-radius:12px;background:linear-gradient(135deg,${P}08,${P}12);border-left:5px solid ${P};box-shadow:0 4px 16px ${P}15;min-width:0;list-style:none;">
        ${gridCardIcon0}
        <span style="font-size:19px;font-weight:600;color:#111827;line-height:1.4;flex:1;min-width:0;overflow-wrap:break-word;word-break:break-word;">核心要点一</span>
      </li>
      <li style="display:flex;align-items:center;gap:16px;overflow-wrap:break-word;word-break:break-word;padding:16px 24px;border-radius:12px;background:linear-gradient(135deg,${P}08,${P}12);border-left:5px solid ${P};box-shadow:0 4px 16px ${P}15;min-width:0;list-style:none;">
        ${gridCardIcon1}
        <span style="font-size:19px;font-weight:600;color:#111827;line-height:1.4;flex:1;min-width:0;overflow-wrap:break-word;word-break:break-word;">核心要点二</span>
      </li>
      <li style="display:flex;align-items:center;gap:16px;overflow-wrap:break-word;word-break:break-word;padding:16px 24px;border-radius:12px;background:linear-gradient(135deg,${P}08,${P}12);border-left:5px solid ${P};box-shadow:0 4px 16px ${P}15;min-width:0;list-style:none;">
        ${gridCardIcon2}
        <span style="font-size:19px;font-weight:600;color:#111827;line-height:1.4;flex:1;min-width:0;overflow-wrap:break-word;word-break:break-word;">核心要点三</span>
      </li>
      <li style="display:flex;align-items:center;gap:16px;overflow-wrap:break-word;word-break:break-word;padding:16px 24px;border-radius:12px;background:linear-gradient(135deg,${P}08,${P}12);border-left:5px solid ${P};box-shadow:0 4px 16px ${P}15;min-width:0;list-style:none;">
        ${gridCardIcon3}
        <span style="font-size:19px;font-weight:600;color:#111827;line-height:1.4;flex:1;min-width:0;overflow-wrap:break-word;word-break:break-word;">核心要点四</span>
      </li>
    </ul>
  </div>
</div>
\`\`\`

### content-no-image（纯文字内容页）
\`\`\`html
<div style="${OUTER};">
  <h2 style="${GRAD_H2}">页面标题</h2>
  <div style="flex:1;display:flex;flex-direction:column;gap:16px;min-height:0;min-width:0;overflow:hidden;justify-content:center;">
    <ul style="font-size:20px;color:#374151;margin:0;padding:0;list-style:none;min-width:0;display:flex;flex-direction:column;gap:24px;">
      ${li0('核心要点一')}
      ${li1('核心要点二')}
      ${li2('核心要点三')}
      ${li3('核心要点四')}
      ${li4('核心要点五')}
    </ul>
  </div>
</div>
\`\`\`

### content-cards（卡片网格页，4个卡片）
\`\`\`html
<div style="${OUTER};">
  <h2 style="${GRAD_H2}">页面标题</h2>
  <div style="flex:1;display:grid;grid-template-columns:repeat(2,1fr);gap:24px;min-height:0;align-content:center;min-width:0;">
    <div style="padding:32px 32px 32px 32px;background:#F9FAFB;border-radius:16px;border:1px solid #E5E7EB;border-left:5px solid ${P};box-shadow:0 4px 6px -1px rgba(0,0,0,0.06);display:flex;flex-direction:column;gap:16px;min-height:0;min-width:0;align-items:flex-start;justify-content:center;">
      ${cardIcon0}
      <h3 style="font-size:28px;font-weight:800;margin:0;line-height:1.35;overflow-wrap:break-word;word-break:break-word;${GRAD_H3_CARD}">卡片标题一</h3>
      <p style="font-size:20px;line-height:1.5;color:#374151;margin:0;font-weight:500;overflow-wrap:break-word;word-break:break-word;">简短描述概括核心价值</p>
      <ul style="margin:4px 0 0 0;padding:0;list-style:none;display:flex;flex-direction:column;gap:8px;min-width:0;">
        <li style="display:flex;align-items:flex-start;gap:8px;font-size:17px;color:#4B5563;line-height:1.5;">
          <span style="width:6px;height:6px;border-radius:50%;background:${P};flex-shrink:0;margin-top:7px"></span>
          <span style="overflow-wrap:break-word;word-break:break-word;">要点一的具体说明</span>
        </li>
        <li style="display:flex;align-items:flex-start;gap:8px;font-size:17px;color:#4B5563;line-height:1.5;">
          <span style="width:6px;height:6px;border-radius:50%;background:${P};flex-shrink:0;margin-top:7px"></span>
          <span style="overflow-wrap:break-word;word-break:break-word;">要点二的具体说明</span>
        </li>
      </ul>
    </div>
    <div style="padding:32px 32px 32px 32px;background:#F9FAFB;border-radius:16px;border:1px solid #E5E7EB;border-left:5px solid ${P};box-shadow:0 4px 6px -1px rgba(0,0,0,0.06);display:flex;flex-direction:column;gap:16px;min-height:0;min-width:0;align-items:flex-start;justify-content:center;">
      ${cardIcon1}
      <h3 style="font-size:28px;font-weight:800;margin:0;line-height:1.35;overflow-wrap:break-word;word-break:break-word;${GRAD_H3_CARD}">卡片标题二</h3>
      <p style="font-size:20px;line-height:1.5;color:#374151;margin:0;font-weight:500;overflow-wrap:break-word;word-break:break-word;">简短描述概括核心价值</p>
      <ul style="margin:4px 0 0 0;padding:0;list-style:none;display:flex;flex-direction:column;gap:8px;min-width:0;">
        <li style="display:flex;align-items:flex-start;gap:8px;font-size:17px;color:#4B5563;line-height:1.5;">
          <span style="width:6px;height:6px;border-radius:50%;background:${P};flex-shrink:0;margin-top:7px"></span>
          <span style="overflow-wrap:break-word;word-break:break-word;">要点一的具体说明</span>
        </li>
        <li style="display:flex;align-items:flex-start;gap:8px;font-size:17px;color:#4B5563;line-height:1.5;">
          <span style="width:6px;height:6px;border-radius:50%;background:${P};flex-shrink:0;margin-top:7px"></span>
          <span style="overflow-wrap:break-word;word-break:break-word;">要点二的具体说明</span>
        </li>
      </ul>
    </div>
    <div style="padding:32px 32px 32px 32px;background:#F9FAFB;border-radius:16px;border:1px solid #E5E7EB;border-left:5px solid ${P};box-shadow:0 4px 6px -1px rgba(0,0,0,0.06);display:flex;flex-direction:column;gap:16px;min-height:0;min-width:0;align-items:flex-start;justify-content:center;">
      ${cardIcon2}
      <h3 style="font-size:28px;font-weight:800;margin:0;line-height:1.35;overflow-wrap:break-word;word-break:break-word;${GRAD_H3_CARD}">卡片标题三</h3>
      <p style="font-size:20px;line-height:1.5;color:#374151;margin:0;font-weight:500;overflow-wrap:break-word;word-break:break-word;">简短描述概括核心价值</p>
      <ul style="margin:4px 0 0 0;padding:0;list-style:none;display:flex;flex-direction:column;gap:8px;min-width:0;">
        <li style="display:flex;align-items:flex-start;gap:8px;font-size:17px;color:#4B5563;line-height:1.5;">
          <span style="width:6px;height:6px;border-radius:50%;background:${P};flex-shrink:0;margin-top:7px"></span>
          <span style="overflow-wrap:break-word;word-break:break-word;">要点一的具体说明</span>
        </li>
        <li style="display:flex;align-items:flex-start;gap:8px;font-size:17px;color:#4B5563;line-height:1.5;">
          <span style="width:6px;height:6px;border-radius:50%;background:${P};flex-shrink:0;margin-top:7px"></span>
          <span style="overflow-wrap:break-word;word-break:break-word;">要点二的具体说明</span>
        </li>
      </ul>
    </div>
    <div style="padding:32px 32px 32px 32px;background:#F9FAFB;border-radius:16px;border:1px solid #E5E7EB;border-left:5px solid ${P};box-shadow:0 4px 6px -1px rgba(0,0,0,0.06);display:flex;flex-direction:column;gap:16px;min-height:0;min-width:0;align-items:flex-start;justify-content:center;">
      ${cardIcon3}
      <h3 style="font-size:28px;font-weight:800;margin:0;line-height:1.35;overflow-wrap:break-word;word-break:break-word;${GRAD_H3_CARD}">卡片标题四</h3>
      <p style="font-size:20px;line-height:1.5;color:#374151;margin:0;font-weight:500;overflow-wrap:break-word;word-break:break-word;">简短描述概括核心价值</p>
      <ul style="margin:4px 0 0 0;padding:0;list-style:none;display:flex;flex-direction:column;gap:8px;min-width:0;">
        <li style="display:flex;align-items:flex-start;gap:8px;font-size:17px;color:#4B5563;line-height:1.5;">
          <span style="width:6px;height:6px;border-radius:50%;background:${P};flex-shrink:0;margin-top:7px"></span>
          <span style="overflow-wrap:break-word;word-break:break-word;">要点一的具体说明</span>
        </li>
        <li style="display:flex;align-items:flex-start;gap:8px;font-size:17px;color:#4B5563;line-height:1.5;">
          <span style="width:6px;height:6px;border-radius:50%;background:${P};flex-shrink:0;margin-top:7px"></span>
          <span style="overflow-wrap:break-word;word-break:break-word;">要点二的具体说明</span>
        </li>
      </ul>
    </div>
  </div>
</div>
\`\`\`
如果是3个卡片，用grid-template-columns:repeat(3,1fr)。

### content-cards（卡片网格页，3个卡片）
\`\`\`html
<div style="${OUTER};">
  <h2 style="${GRAD_H2}">页面标题</h2>
  <div style="flex:1;display:grid;grid-template-columns:repeat(3,1fr);gap:24px;min-height:0;align-content:center;min-width:0;">
    <div style="padding:32px 32px 32px 32px;background:#F9FAFB;border-radius:16px;border:1px solid #E5E7EB;border-left:5px solid ${P};box-shadow:0 4px 6px -1px rgba(0,0,0,0.06);display:flex;flex-direction:column;gap:16px;min-height:0;min-width:0;align-items:flex-start;justify-content:center;">
      ${cardIcon0}
      <h3 style="font-size:28px;font-weight:800;margin:0;line-height:1.35;overflow-wrap:break-word;word-break:break-word;${GRAD_H3_CARD}">卡片标题一</h3>
      <p style="font-size:20px;line-height:1.5;color:#374151;margin:0;font-weight:500;overflow-wrap:break-word;word-break:break-word;">简短描述概括核心价值</p>
      <ul style="margin:4px 0 0 0;padding:0;list-style:none;display:flex;flex-direction:column;gap:8px;min-width:0;">
        <li style="display:flex;align-items:flex-start;gap:8px;font-size:17px;color:#4B5563;line-height:1.5;">
          <span style="width:6px;height:6px;border-radius:50%;background:${P};flex-shrink:0;margin-top:7px"></span>
          <span style="overflow-wrap:break-word;word-break:break-word;">要点一的具体说明</span>
        </li>
        <li style="display:flex;align-items:flex-start;gap:8px;font-size:17px;color:#4B5563;line-height:1.5;">
          <span style="width:6px;height:6px;border-radius:50%;background:${P};flex-shrink:0;margin-top:7px"></span>
          <span style="overflow-wrap:break-word;word-break:break-word;">要点二的具体说明</span>
        </li>
        <li style="display:flex;align-items:flex-start;gap:8px;font-size:17px;color:#4B5563;line-height:1.5;">
          <span style="width:6px;height:6px;border-radius:50%;background:${P};flex-shrink:0;margin-top:7px"></span>
          <span style="overflow-wrap:break-word;word-break:break-word;">要点三的具体说明</span>
        </li>
      </ul>
    </div>
    <div style="padding:32px 32px 32px 32px;background:#F9FAFB;border-radius:16px;border:1px solid #E5E7EB;border-left:5px solid ${P};box-shadow:0 4px 6px -1px rgba(0,0,0,0.06);display:flex;flex-direction:column;gap:16px;min-height:0;min-width:0;align-items:flex-start;justify-content:center;">
      ${cardIcon1}
      <h3 style="font-size:28px;font-weight:800;margin:0;line-height:1.35;overflow-wrap:break-word;word-break:break-word;${GRAD_H3_CARD}">卡片标题二</h3>
      <p style="font-size:20px;line-height:1.5;color:#374151;margin:0;font-weight:500;overflow-wrap:break-word;word-break:break-word;">简短描述概括核心价值</p>
      <ul style="margin:4px 0 0 0;padding:0;list-style:none;display:flex;flex-direction:column;gap:8px;min-width:0;">
        <li style="display:flex;align-items:flex-start;gap:8px;font-size:17px;color:#4B5563;line-height:1.5;">
          <span style="width:6px;height:6px;border-radius:50%;background:${P};flex-shrink:0;margin-top:7px"></span>
          <span style="overflow-wrap:break-word;word-break:break-word;">要点一的具体说明</span>
        </li>
        <li style="display:flex;align-items:flex-start;gap:8px;font-size:17px;color:#4B5563;line-height:1.5;">
          <span style="width:6px;height:6px;border-radius:50%;background:${P};flex-shrink:0;margin-top:7px"></span>
          <span style="overflow-wrap:break-word;word-break:break-word;">要点二的具体说明</span>
        </li>
        <li style="display:flex;align-items:flex-start;gap:8px;font-size:17px;color:#4B5563;line-height:1.5;">
          <span style="width:6px;height:6px;border-radius:50%;background:${P};flex-shrink:0;margin-top:7px"></span>
          <span style="overflow-wrap:break-word;word-break:break-word;">要点三的具体说明</span>
        </li>
      </ul>
    </div>
    <div style="padding:32px 32px 32px 32px;background:#F9FAFB;border-radius:16px;border:1px solid #E5E7EB;border-left:5px solid ${P};box-shadow:0 4px 6px -1px rgba(0,0,0,0.06);display:flex;flex-direction:column;gap:16px;min-height:0;min-width:0;align-items:flex-start;justify-content:center;">
      ${cardIcon2}
      <h3 style="font-size:28px;font-weight:800;margin:0;line-height:1.35;overflow-wrap:break-word;word-break:break-word;${GRAD_H3_CARD}">卡片标题三</h3>
      <p style="font-size:20px;line-height:1.5;color:#374151;margin:0;font-weight:500;overflow-wrap:break-word;word-break:break-word;">简短描述概括核心价值</p>
      <ul style="margin:4px 0 0 0;padding:0;list-style:none;display:flex;flex-direction:column;gap:8px;min-width:0;">
        <li style="display:flex;align-items:flex-start;gap:8px;font-size:17px;color:#4B5563;line-height:1.5;">
          <span style="width:6px;height:6px;border-radius:50%;background:${P};flex-shrink:0;margin-top:7px"></span>
          <span style="overflow-wrap:break-word;word-break:break-word;">要点一的具体说明</span>
        </li>
        <li style="display:flex;align-items:flex-start;gap:8px;font-size:17px;color:#4B5563;line-height:1.5;">
          <span style="width:6px;height:6px;border-radius:50%;background:${P};flex-shrink:0;margin-top:7px"></span>
          <span style="overflow-wrap:break-word;word-break:break-word;">要点二的具体说明</span>
        </li>
        <li style="display:flex;align-items:flex-start;gap:8px;font-size:17px;color:#4B5563;line-height:1.5;">
          <span style="width:6px;height:6px;border-radius:50%;background:${P};flex-shrink:0;margin-top:7px"></span>
          <span style="overflow-wrap:break-word;word-break:break-word;">要点三的具体说明</span>
        </li>
      </ul>
    </div>
  </div>
</div>
\`\`\`

### content-compare（两栏对比 · 右栏浅底禁白字，强制主色字）
\`\`\`html
<div style="${OUTER};">
  <h2 style="${GRAD_H2}">页面标题</h2>
  <div style="flex:1;display:flex;gap:32px;min-height:0;min-width:0;align-items:stretch;">
    <div style="flex:1;padding:32px;border-radius:16px;border:2px solid #E5E7EB;display:flex;flex-direction:column;gap:24px;min-width:0;min-height:0;">
      <h3 style="font-size:28px;font-weight:700;color:#374151;margin:0;text-align:center;padding-bottom:16px;border-bottom:2px solid #E5E7EB;overflow-wrap:break-word;word-break:break-word;">左栏标题</h3>
      <ul style="font-size:22px;color:#374151;margin:0;padding:0;list-style:none;flex:1;min-width:0;display:flex;flex-direction:column;gap:16px;">
        <li style="display:flex;align-items:center;gap:16px;overflow-wrap:break-word;word-break:break-word;">${cmpLeft}<span style="line-height:1.4;flex:1;">对比项一</span></li>
        <li style="display:flex;align-items:center;gap:16px;overflow-wrap:break-word;word-break:break-word;">${cmpLeft}<span style="line-height:1.4;flex:1;">对比项二</span></li>
        <li style="display:flex;align-items:center;gap:16px;overflow-wrap:break-word;word-break:break-word;">${cmpLeft}<span style="line-height:1.4;flex:1;">对比项三</span></li>
      </ul>
    </div>
    <div style="flex:1;padding:32px;border-radius:16px;background:${P}08;border:2px solid ${P};display:flex;flex-direction:column;gap:24px;min-width:0;min-height:0;">
      <h3 style="font-size:28px;font-weight:800;margin:0;text-align:center;padding-bottom:16px;border-bottom:2px solid ${P}30;overflow-wrap:break-word;word-break:break-word;${GRAD_H3_CARD}">右栏标题</h3>
      <ul style="font-size:22px;color:#374151;margin:0;padding:0;list-style:none;flex:1;min-width:0;display:flex;flex-direction:column;gap:16px;">
        <li style="display:flex;align-items:center;gap:16px;overflow-wrap:break-word;word-break:break-word;">${cmpRight}<span style="line-height:1.4;flex:1;color:#111827;font-weight:600;">对比项一</span></li>
        <li style="display:flex;align-items:center;gap:16px;overflow-wrap:break-word;word-break:break-word;">${cmpRight}<span style="line-height:1.4;flex:1;color:#111827;font-weight:600;">对比项二</span></li>
        <li style="display:flex;align-items:center;gap:16px;overflow-wrap:break-word;word-break:break-word;">${cmpRight}<span style="line-height:1.4;flex:1;color:#111827;font-weight:600;">对比项三</span></li>
      </ul>
    </div>
  </div>
</div>
\`\`\`

### content-timeline（时间轴页）
\`\`\`html
<div style="${OUTER};">
  <h2 style="${GRAD_H2}">页面标题</h2>
  <div style="flex:1;display:flex;flex-direction:column;gap:0;min-height:0;overflow:hidden;justify-content:center;position:relative;padding-left:56px;">
    <div style="position:absolute;left:27px;top:16px;bottom:16px;width:4px;background:${P}20;border-radius:2px;"></div>
    <div style="display:flex;gap:24px;align-items:center;min-width:0;">
      <div style="flex-shrink:0;margin-left:-56px;z-index:1;position:relative;">${tlIcon0}</div>
      <div style="flex:1;padding-bottom:24px;min-width:0;">
        <h3 style="font-size:22px;font-weight:700;color:${P};margin:0 0 8px 0;line-height:1.4;overflow-wrap:break-word;word-break:break-word;">第一阶段标题</h3>
        <p style="font-size:18px;line-height:1.7;color:#6B7280;margin:0;overflow-wrap:break-word;word-break:break-word;">简要描述</p>
      </div>
    </div>
    <div style="display:flex;gap:24px;align-items:center;min-width:0;">
      <div style="flex-shrink:0;margin-left:-56px;z-index:1;position:relative;">${tlIcon1}</div>
      <div style="flex:1;padding-bottom:24px;min-width:0;">
        <h3 style="font-size:22px;font-weight:700;color:${P};margin:0 0 8px 0;line-height:1.4;overflow-wrap:break-word;word-break:break-word;">第二阶段标题</h3>
        <p style="font-size:18px;line-height:1.7;color:#6B7280;margin:0;overflow-wrap:break-word;word-break:break-word;">简要描述</p>
      </div>
    </div>
    <div style="display:flex;gap:24px;align-items:center;min-width:0;">
      <div style="flex-shrink:0;margin-left:-56px;z-index:1;position:relative;">${tlIcon2}</div>
      <div style="flex:1;padding-bottom:0;min-width:0;">
        <h3 style="font-size:22px;font-weight:700;color:${P};margin:0 0 8px 0;line-height:1.4;overflow-wrap:break-word;word-break:break-word;">第三阶段标题</h3>
        <p style="font-size:18px;line-height:1.7;color:#6B7280;margin:0;overflow-wrap:break-word;word-break:break-word;">简要描述</p>
      </div>
    </div>
  </div>
</div>
\`\`\`

### content-table（数据表格页）
\`\`\`html
<div style="${OUTER};">
  <h2 style="${GRAD_H2}">页面标题</h2>
  <div style="flex:1;display:flex;flex-direction:column;min-height:0;overflow:hidden;border-radius:12px;border:1px solid #E5E7EB;">
    <table style="width:100%;border-collapse:collapse;font-size:18px;">
      <thead>
        <tr style="background:${GRAD};">
          <th style="padding:16px 24px;text-align:left;color:#fff;font-weight:600;font-size:18px;border-right:1px solid rgba(255,255,255,0.2);overflow-wrap:break-word;word-break:break-word;">列标题一</th>
          <th style="padding:16px 24px;text-align:left;color:#fff;font-weight:600;font-size:18px;border-right:1px solid rgba(255,255,255,0.2);overflow-wrap:break-word;word-break:break-word;">列标题二</th>
          <th style="padding:16px 24px;text-align:left;color:#fff;font-weight:600;font-size:18px;overflow-wrap:break-word;word-break:break-word;">列标题三</th>
        </tr>
      </thead>
      <tbody>
        <tr style="background:#fff;">
          <td style="padding:16px 24px;border-bottom:1px solid #E5E7EB;border-right:1px solid #E5E7EB;color:#374151;font-size:18px;overflow-wrap:break-word;word-break:break-word;">数据一</td>
          <td style="padding:16px 24px;border-bottom:1px solid #E5E7EB;border-right:1px solid #E5E7EB;color:#374151;font-size:18px;overflow-wrap:break-word;word-break:break-word;">数据二</td>
          <td style="padding:16px 24px;border-bottom:1px solid #E5E7EB;color:#374151;font-size:18px;overflow-wrap:break-word;word-break:break-word;">数据三</td>
        </tr>
        <tr style="background:#F9FAFB;">
          <td style="padding:16px 24px;border-bottom:1px solid #E5E7EB;border-right:1px solid #E5E7EB;color:#374151;font-size:18px;overflow-wrap:break-word;word-break:break-word;">数据四</td>
          <td style="padding:16px 24px;border-bottom:1px solid #E5E7EB;border-right:1px solid #E5E7EB;color:#374151;font-size:18px;overflow-wrap:break-word;word-break:break-word;">数据五</td>
          <td style="padding:16px 24px;border-bottom:1px solid #E5E7EB;color:#374151;font-size:18px;overflow-wrap:break-word;word-break:break-word;">数据六</td>
        </tr>
        <tr style="background:#fff;">
          <td style="padding:16px 24px;border-right:1px solid #E5E7EB;color:#374151;font-size:18px;overflow-wrap:break-word;word-break:break-word;">数据七</td>
          <td style="padding:16px 24px;border-right:1px solid #E5E7EB;color:#374151;font-size:18px;overflow-wrap:break-word;word-break:break-word;">数据八</td>
          <td style="padding:16px 24px;color:#374151;font-size:18px;overflow-wrap:break-word;word-break:break-word;">数据九</td>
        </tr>
      </tbody>
    </table>
  </div>
</div>
\`\`\`

### comparison-deep-dive（双栏深度对比报告 · L1高级版式 · 进度条+徽章）
⚠️ 图例说明（放在模板顶部，生成页面时也默认生成这一行便于阅读）：
  ▢ 灰色外框卡片 = 基准方案 / 现有方案　　▢ 主色外框卡片 = 升级方案 / 优势方案
  ✓ 绿色对勾图标 + 绿色"胜出"徽章 = 该维度右栏优势项（对应 advantageIndices）
\`\`\`html
<div style="${OUTER};" data-layout="comparison-deep-dive">
  <h2 style="${GRAD_H2}">页面标题（深度对比）</h2>
  <!-- 顶部图例栏（3 个图例胶囊，点击选中整个图例容器）-->
  <div style="pointer-events:none;display:flex;gap:24px;align-items:center;justify-content:center;margin-bottom:24px;min-width:0;">
    <div style="display:inline-flex;align-items:center;gap:10px;padding:8px 18px;border-radius:999px;background:#F9FAFB;border:1px solid #E5E7EB;">
      <span style="display:inline-block;width:16px;height:16px;border-radius:4px;border:2px solid #E5E7EB;background:#fff;"></span>
      <span style="font-size:18px;color:#4B5563;font-weight:600;">基准方案</span>
    </div>
    <div style="display:inline-flex;align-items:center;gap:10px;padding:8px 18px;border-radius:999px;background:${P}10;border:1px solid ${P}35;">
      <span style="display:inline-block;width:16px;height:16px;border-radius:4px;border:2px solid ${P};background:${P}05;"></span>
      <span style="font-size:18px;color:${PD};font-weight:700;">升级方案</span>
    </div>
    <div style="display:inline-flex;align-items:center;gap:10px;padding:8px 18px;border-radius:999px;background:#10b98112;border:1px solid #10b98135;">
      <span style="display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;background:linear-gradient(135deg,${P},${PD});color:#fff;font-size:11px;font-weight:900;">✓</span>
      <span style="font-size:18px;color:#059669;font-weight:700;">右栏胜出维度</span>
    </div>
  </div>
  <div style="flex:1;display:flex;gap:28px;min-height:0;min-width:0;align-items:stretch;">
    <!-- 左栏：基准方案（灰色、普通项）-->
    <div style="flex:1;padding:28px 24px;border-radius:16px;border:2px solid #E5E7EB;background:#F9FAFB;display:flex;flex-direction:column;gap:16px;min-width:0;min-height:0;">
      <h3 style="font-size:28px;font-weight:700;color:#4B5563;margin:0;text-align:center;padding-bottom:14px;border-bottom:2px solid #E5E7EB;overflow-wrap:break-word;word-break:break-word;">基准方案 / 现有方案</h3>
      <ul style="margin:0;padding:0;list-style:none;flex:1;min-width:0;display:flex;flex-direction:column;gap:16px;min-height:0;">
        <li style="display:flex;flex-direction:column;gap:8px;padding:16px 24px;border-radius:12px;background:#FFFFFF;border:1px solid #E5E7EB;min-width:0;overflow-wrap:break-word;word-break:break-word;">
          <div style="display:flex;align-items:center;gap:12px;">
            <span style="display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:22px;height:22px;border-radius:50%;background:#E5E7EB;">
              <svg width="10" height="10" viewBox="0 0 10 10"><rect x="2" y="4.5" width="6" height="1.5" rx="0.75" fill="#9CA3AF"/></svg>
            </span>
            <span style="font-size:19px;font-weight:600;color:#374151;line-height:1.4;flex:1;min-width:0;">对比维度一</span>
          </div>
          <div style="width:100%;height:8px;border-radius:999px;background:#E5E7EB;overflow:hidden;">
            <div style="pointer-events:none;width:55%;height:100%;border-radius:999px;background:linear-gradient(135deg,#9CA3AF,#6B7280);"></div>
          </div>
        </li>
        <li style="display:flex;flex-direction:column;gap:8px;padding:16px 24px;border-radius:12px;background:#FFFFFF;border:1px solid #E5E7EB;min-width:0;overflow-wrap:break-word;word-break:break-word;">
          <div style="display:flex;align-items:center;gap:12px;">
            <span style="display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:22px;height:22px;border-radius:50%;background:#E5E7EB;">
              <svg width="10" height="10" viewBox="0 0 10 10"><rect x="2" y="4.5" width="6" height="1.5" rx="0.75" fill="#9CA3AF"/></svg>
            </span>
            <span style="font-size:19px;font-weight:600;color:#374151;line-height:1.4;flex:1;min-width:0;">对比维度二</span>
          </div>
          <div style="width:100%;height:8px;border-radius:999px;background:#E5E7EB;overflow:hidden;">
            <div style="pointer-events:none;width:62%;height:100%;border-radius:999px;background:linear-gradient(135deg,#9CA3AF,#6B7280);"></div>
          </div>
        </li>
        <li style="display:flex;flex-direction:column;gap:8px;padding:16px 24px;border-radius:12px;background:#FFFFFF;border:1px solid #E5E7EB;min-width:0;overflow-wrap:break-word;word-break:break-word;">
          <div style="display:flex;align-items:center;gap:12px;">
            <span style="display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:22px;height:22px;border-radius:50%;background:#E5E7EB;">
              <svg width="10" height="10" viewBox="0 0 10 10"><rect x="2" y="4.5" width="6" height="1.5" rx="0.75" fill="#9CA3AF"/></svg>
            </span>
            <span style="font-size:19px;font-weight:600;color:#374151;line-height:1.4;flex:1;min-width:0;">对比维度三</span>
          </div>
          <div style="width:100%;height:8px;border-radius:999px;background:#E5E7EB;overflow:hidden;">
            <div style="pointer-events:none;width:48%;height:100%;border-radius:999px;background:linear-gradient(135deg,#9CA3AF,#6B7280);"></div>
          </div>
        </li>
        <li style="display:flex;flex-direction:column;gap:8px;padding:16px 24px;border-radius:12px;background:#FFFFFF;border:1px solid #E5E7EB;min-width:0;overflow-wrap:break-word;word-break:break-word;">
          <div style="display:flex;align-items:center;gap:12px;">
            <span style="display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:22px;height:22px;border-radius:50%;background:#E5E7EB;">
              <svg width="10" height="10" viewBox="0 0 10 10"><rect x="2" y="4.5" width="6" height="1.5" rx="0.75" fill="#9CA3AF"/></svg>
            </span>
            <span style="font-size:19px;font-weight:600;color:#374151;line-height:1.4;flex:1;min-width:0;">对比维度四</span>
          </div>
          <div style="width:100%;height:8px;border-radius:999px;background:#E5E7EB;overflow:hidden;">
            <div style="pointer-events:none;width:40%;height:100%;border-radius:999px;background:linear-gradient(135deg,#9CA3AF,#6B7280);"></div>
          </div>
        </li>
      </ul>
    </div>
    <!-- 右栏：新方案/优势方案（主色、进度条、徽章、高亮）—— 示例：advantageIndices=[0,2,3]（第1/3/4项胜出），metricValues=[92,70,95,88] -->
    <div style="flex:1;padding:28px 24px;border-radius:16px;background:linear-gradient(135deg,${P}06,${P}0A);display:flex;flex-direction:column;gap:16px;min-width:0;min-height:0;box-shadow:0 8px 28px ${P}18;">
      <h3 style="font-size:28px;font-weight:800;margin:0;text-align:center;padding-bottom:14px;border-bottom:2px solid ${P}35;overflow-wrap:break-word;word-break:break-word;${GRAD_H3_CARD}">升级方案 / 优势方案</h3>
      <ul style="margin:0;padding:0;list-style:none;flex:1;min-width:0;display:flex;flex-direction:column;gap:16px;min-height:0;">
        <!-- 右栏第 1 项：advantageIndices 包含（✅ 胜出 → 绿色三件套 + 深渐变）-->
        <li style="display:flex;flex-direction:column;gap:10px;padding:18px 22px;border-radius:14px;background:#FFFFFF;border-left:5px solid #10b981;box-shadow:0 4px 16px ${P}18;min-width:0;overflow-wrap:break-word;word-break:break-word;">
          <div style="display:flex;align-items:center;gap:12px;">
            <span style="display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,${P},${PD});box-shadow:0 2px 8px #10b98140;">
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M13 4L6.5 10.5L3 7" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </span>
            <span style="font-size:24px;font-weight:700;color:#111827;line-height:1.4;flex:1;min-width:0;">对比维度一（优势）</span>
            <!-- 绿色胜出徽章（+92% 胜出）-->
            <span style="pointer-events:none;display:inline-flex;align-items:center;gap:6px;padding:4px 14px;border-radius:999px;background:#10b98118;color:#059669;font-size:16px;font-weight:800;white-space:nowrap;border:1px solid #10b98130;">+92% 胜出</span>
          </div>
          <!-- 进度条：主色系深一档渐变（比非优势项深，颜色用 primary/darker，不用绿色）-->
          <div style="width:100%;height:12px;border-radius:999px;background:${P}20;overflow:hidden;">
            <div style="pointer-events:none;width:92%;height:100%;border-radius:999px;background:linear-gradient(135deg,${P} 0%,${PD} 45%,${PD} 100%);box-shadow:inset 0 1px 2px rgba(255,255,255,0.45),inset 0 -1px 2px rgba(0,0,0,0.12);"></div>
          </div>
        </li>
        <!-- 右栏第 2 项：非 advantageIndices（普通项 → 主色蓝色三件套，渐变主色）-->
        <li style="display:flex;flex-direction:column;gap:10px;padding:18px 22px;border-radius:14px;background:#FFFFFF;border-left:5px solid ${P};box-shadow:0 4px 16px ${P}18;min-width:0;overflow-wrap:break-word;word-break:break-word;">
          <div style="display:flex;align-items:center;gap:12px;">
            <span style="display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,${P},${PD});box-shadow:0 2px 8px ${P}40;">
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M13 4L6.5 10.5L3 7" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </span>
            <span style="font-size:24px;font-weight:700;color:#111827;line-height:1.4;flex:1;min-width:0;">对比维度二（普通）</span>
            <span style="pointer-events:none;display:inline-flex;align-items:center;padding:4px 12px;border-radius:999px;background:${P}20;color:${PD};font-size:16px;font-weight:800;white-space:nowrap;">+70%</span>
          </div>
          <div style="width:100%;height:12px;border-radius:999px;background:${P}20;overflow:hidden;">
            <div style="pointer-events:none;width:70%;height:100%;border-radius:999px;background:linear-gradient(135deg,{{PRIMARY_COLOR_LIGHTER}} 0%,${P} 45%,${PD} 100%);box-shadow:inset 0 1px 2px rgba(255,255,255,0.45),inset 0 -1px 2px rgba(0,0,0,0.12);"></div>
          </div>
        </li>
        <!-- 右栏第 3 项：advantageIndices 包含（✅ 胜出 → 绿色三件套 + 深渐变）-->
        <li style="display:flex;flex-direction:column;gap:10px;padding:18px 22px;border-radius:14px;background:#FFFFFF;border-left:5px solid #10b981;box-shadow:0 4px 16px ${P}18;min-width:0;overflow-wrap:break-word;word-break:break-word;">
          <div style="display:flex;align-items:center;gap:12px;">
            <span style="display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,${P},${PD});box-shadow:0 2px 8px #10b98140;">
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M13 4L6.5 10.5L3 7" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </span>
            <span style="font-size:24px;font-weight:700;color:#111827;line-height:1.4;flex:1;min-width:0;">对比维度三（优势）</span>
            <span style="pointer-events:none;display:inline-flex;align-items:center;gap:6px;padding:4px 14px;border-radius:999px;background:#10b98118;color:#059669;font-size:16px;font-weight:800;white-space:nowrap;border:1px solid #10b98130;">+95% 胜出</span>
          </div>
          <div style="width:100%;height:12px;border-radius:999px;background:${P}20;overflow:hidden;">
            <div style="pointer-events:none;width:95%;height:100%;border-radius:999px;background:linear-gradient(135deg,${P} 0%,${PD} 45%,${PD} 100%);box-shadow:inset 0 1px 2px rgba(255,255,255,0.45),inset 0 -1px 2px rgba(0,0,0,0.12);"></div>
          </div>
        </li>
        <!-- 右栏第 4 项：advantageIndices 包含（✅ 胜出 → 绿色三件套 + 深渐变）-->
        <li style="display:flex;flex-direction:column;gap:10px;padding:18px 22px;border-radius:14px;background:#FFFFFF;border-left:5px solid #10b981;box-shadow:0 4px 16px ${P}18;min-width:0;overflow-wrap:break-word;word-break:break-word;">
          <div style="display:flex;align-items:center;gap:12px;">
            <span style="display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,${P},${PD});box-shadow:0 2px 8px #10b98140;">
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M13 4L6.5 10.5L3 7" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </span>
            <span style="font-size:24px;font-weight:700;color:#111827;line-height:1.4;flex:1;min-width:0;">对比维度四（优势）</span>
            <span style="pointer-events:none;display:inline-flex;align-items:center;gap:6px;padding:4px 14px;border-radius:999px;background:#10b98118;color:#059669;font-size:16px;font-weight:800;white-space:nowrap;border:1px solid #10b98130;">+88% 胜出</span>
          </div>
          <div style="width:100%;height:12px;border-radius:999px;background:${P}20;overflow:hidden;">
            <div style="pointer-events:none;width:88%;height:100%;border-radius:999px;background:linear-gradient(135deg,${P} 0%,${PD} 45%,${PD} 100%);box-shadow:inset 0 1px 2px rgba(255,255,255,0.45),inset 0 -1px 2px rgba(0,0,0,0.12);"></div>
          </div>
        </li>
      </ul>
    </div>
  </div>
</div>
\`\`\`

### content-zigzag（Z字形图文交错 · L1高级版式 · 三段式）
\`\`\`html
<div style="${OUTER};" data-layout="content-zigzag">
  <h2 style="${GRAD_H2}">页面标题（Z字三段式）</h2>
  <div style="flex:1;display:flex;flex-direction:column;gap:16px;min-height:0;min-width:0;">
    <!-- 第一段：图左文右 -->
    <div style="display:flex;gap:24px;align-items:stretch;min-height:0;min-width:0;flex:1;">
      <div style="flex:0 0 38%;display:flex;align-items:stretch;min-height:0;min-width:0;overflow:hidden;border-radius:14px;">
        <img src="https://NOPPT_IMAGE_PLACEHOLDER" data-image-ratio="4:3" style="width:100%;height:100%;object-fit:cover;border-radius:14px;display:block;">
      </div>
      <div style="flex:1;display:flex;align-items:center;min-height:0;min-width:0;">
        <div style="padding:20px 24px;border-radius:14px;background:linear-gradient(135deg,${P}08,${P}12);border-left:5px solid ${P};box-shadow:0 4px 16px ${P}15;min-width:0;flex:1;">
          <h3 style="font-size:26px;font-weight:800;margin:0 0 10px 0;line-height:1.35;overflow-wrap:break-word;word-break:break-word;${GRAD_H3_CARD}">第一阶段 · 图左文右</h3>
          <p style="font-size:22px;color:#374151;font-weight:500;line-height:1.8;margin:0;overflow-wrap:break-word;word-break:break-word;">第一部分内容描述，图文左右排列，形成 Z 字视觉流的第一段。文字放在带主色左侧竖线的渐变卡片里，清晰可读。</p>
        </div>
      </div>
    </div>
    <!-- 第二段：文左图右（方向反转）-->
    <div style="display:flex;gap:24px;align-items:stretch;min-height:0;min-width:0;flex:1;">
      <div style="flex:1;display:flex;align-items:center;min-height:0;min-width:0;">
        <div style="padding:20px 24px;border-radius:14px;background:linear-gradient(135deg,${P}08,${P}12);border-right:5px solid ${P};box-shadow:0 4px 16px ${P}15;min-width:0;flex:1;">
          <h3 style="font-size:26px;font-weight:800;margin:0 0 10px 0;line-height:1.35;overflow-wrap:break-word;word-break:break-word;${GRAD_H3_CARD}">第二阶段 · 文左图右</h3>
          <p style="font-size:22px;color:#374151;font-weight:500;line-height:1.8;margin:0;overflow-wrap:break-word;word-break:break-word;">第二部分内容描述，文字在左图片在右，方向与第一段反转，形成 Z 字视觉流的中间转折。卡片改成右侧竖线保持视觉平衡。</p>
        </div>
      </div>
      <div style="flex:0 0 38%;display:flex;align-items:stretch;min-height:0;min-width:0;overflow:hidden;border-radius:14px;">
        <div style="pointer-events:none;flex:1;border-radius:14px;background:linear-gradient(135deg,${P}15,${PD}20);display:flex;align-items:center;justify-content:center;">
          ${zigzagIcon1}
        </div>
      </div>
    </div>
    <!-- 第三段：图左文右（回到第一段方向）-->
    <div style="display:flex;gap:24px;align-items:stretch;min-height:0;min-width:0;flex:1;">
      <div style="flex:0 0 38%;display:flex;align-items:stretch;min-height:0;min-width:0;overflow:hidden;border-radius:14px;">
        <div style="pointer-events:none;flex:1;border-radius:14px;background:linear-gradient(135deg,${PD}20,${P}15);display:flex;align-items:center;justify-content:center;">
          ${zigzagIcon2}
        </div>
      </div>
      <div style="flex:1;display:flex;align-items:center;min-height:0;min-width:0;">
        <div style="padding:20px 24px;border-radius:14px;background:linear-gradient(135deg,${P}08,${P}12);border-left:5px solid ${P};box-shadow:0 4px 16px ${P}15;min-width:0;flex:1;">
          <h3 style="font-size:26px;font-weight:800;margin:0 0 10px 0;line-height:1.35;overflow-wrap:break-word;word-break:break-word;${GRAD_H3_CARD}">第三阶段 · 回到图左</h3>
          <p style="font-size:22px;color:#374151;font-weight:500;line-height:1.8;margin:0;overflow-wrap:break-word;word-break:break-word;">第三部分内容描述，图片重新回到左侧，与第一段方向一致，完成 Z 字形三段式的视觉收尾。整个页面节奏富有韵律。</p>
        </div>
      </div>
    </div>
  </div>
</div>
\`\`\`
⚠️ 注意：content-zigzag 中仅第一段保留真实 img 占位符（NOPPT_IMAGE_PLACEHOLDER），后两段用 emoji+渐变色块代替，避免触发"每页多图占位符"违规。

### content-value-showcase（核心数值大卡展示 · L1高级版式 · badges+渐变巨字）
\`\`\`html
<div style="${OUTER};" data-layout="content-value-showcase">
  <h2 style="${GRAD_H2}">页面标题（核心数值展示）</h2>
  <div style="flex:1;display:grid;grid-template-columns:repeat(3,1fr);gap:24px;min-height:0;align-content:stretch;min-width:0;">
    <!-- 数值大卡 1 -->
    <div style="padding:32px 24px;border-radius:20px;background:linear-gradient(135deg,${P}08,${P}1C);border:1px solid ${P}30;box-shadow:0 12px 32px ${P}20;display:flex;flex-direction:column;gap:16px;align-items:center;justify-content:center;text-align:center;min-width:0;min-height:0;">
      <div style="font-size:88px;font-weight:900;line-height:1;background:linear-gradient(135deg,${P},${PD});-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;">
        <span style="pointer-events:none;">42%</span>
      </div>
      <h3 style="font-size:28px;font-weight:700;margin:0;color:#111827;overflow-wrap:break-word;word-break:break-word;">市场份额同比</h3>
      <div style="display:flex;align-items:center;gap:10px;">
        <span style="pointer-events:none;display:inline-flex;align-items:center;padding:6px 16px;border-radius:999px;background:#10b98118;color:#059669;font-size:20px;font-weight:800;">↗ +12.3pp</span>
      </div>
      <p style="pointer-events:none;font-size:18px;color:#6B7280;font-weight:500;margin:0;overflow-wrap:break-word;word-break:break-word;">2024 Q2 vs 2023 Q2</p>
    </div>
    <!-- 数值大卡 2 -->
    <div style="padding:32px 24px;border-radius:20px;background:linear-gradient(135deg,#05966908,#0596691C);border:1px solid #05966930;box-shadow:0 12px 32px #05966920;display:flex;flex-direction:column;gap:16px;align-items:center;justify-content:center;text-align:center;min-width:0;min-height:0;">
      <div style="font-size:88px;font-weight:900;line-height:1;background:linear-gradient(135deg,#059669,#047857);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;">
        <span style="pointer-events:none;">3.2×</span>
      </div>
      <h3 style="font-size:28px;font-weight:700;margin:0;color:#111827;overflow-wrap:break-word;word-break:break-word;">效率提升倍数</h3>
      <div style="display:flex;align-items:center;gap:10px;">
        <span style="pointer-events:none;display:inline-flex;align-items:center;padding:6px 16px;border-radius:999px;background:{{PRIMARY_COLOR}}18;color:{{PRIMARY_COLOR}};font-size:20px;font-weight:800;">↗ +220%</span>
      </div>
      <p style="pointer-events:none;font-size:18px;color:#6B7280;font-weight:500;margin:0;overflow-wrap:break-word;word-break:break-word;">自动化部署前后对比</p>
    </div>
    <!-- 数值大卡 3 -->
    <div style="padding:32px 24px;border-radius:20px;background:linear-gradient(135deg,${P}08,${P}1C);border:1px solid ${P}30;box-shadow:0 12px 32px ${P}20;display:flex;flex-direction:column;gap:16px;align-items:center;justify-content:center;text-align:center;min-width:0;min-height:0;">
      <div style="font-size:88px;font-weight:900;line-height:1;background:linear-gradient(135deg,${P},${PD});-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;">
        <span style="pointer-events:none;">120万</span>
      </div>
      <h3 style="font-size:28px;font-weight:700;margin:0;color:#111827;overflow-wrap:break-word;word-break:break-word;">累计用户规模</h3>
      <div style="display:flex;align-items:center;gap:10px;">
        <span style="pointer-events:none;display:inline-flex;align-items:center;padding:6px 16px;border-radius:999px;background:${P}18;color:${PD};font-size:20px;font-weight:800;">↗ +41% QoQ</span>
      </div>
      <p style="pointer-events:none;font-size:18px;color:#6B7280;font-weight:500;margin:0;overflow-wrap:break-word;word-break:break-word;">截至 2024 年 6 月底</p>
    </div>
  </div>
</div>
\`\`\`
如果只展示 1 个核心数值，用单列 100% 宽的超大卡（font-size 放大到 120px）。2 个数值就用 grid-template-columns:repeat(2,1fr)。

### content-stats-highlight（多数据指标并列 · L1高级版式 · 彩色语义卡片+进度条）
\`\`\`html
<div style="${OUTER};" data-layout="content-stats-highlight">
  <h2 style="${GRAD_H2}">页面标题（多数据指标并列）</h2>
  <div style="flex:1;display:grid;grid-template-columns:repeat(4,1fr);gap:24px;min-height:0;align-content:stretch;min-width:0;">
    <!-- 蓝卡：营收 -->
    <div style="padding:24px 20px;border-radius:16px;background:{{PRIMARY_COLOR}}12;border:1px solid {{PRIMARY_COLOR}}28;box-shadow:0 6px 20px {{PRIMARY_COLOR}}18;display:flex;flex-direction:column;gap:12px;min-width:0;min-height:0;height:100%;">
      <span style="pointer-events:none;font-size:56px;font-weight:900;line-height:1;color:#111827;">¥12.8M</span>
      <h3 style="font-size:22px;font-weight:700;margin:0;color:#111827;overflow-wrap:break-word;word-break:break-word;">营收</h3>
      <div style="width:100%;height:10px;border-radius:999px;background:{{PRIMARY_COLOR}}20;overflow:hidden;">
        <div style="pointer-events:none;width:86%;height:100%;border-radius:999px;background:linear-gradient(90deg,{{PRIMARY_COLOR}},{{PRIMARY_COLOR_DARKER}});"></div>
      </div>
      <span style="pointer-events:none;display:inline-flex;align-items:center;padding:4px 12px;border-radius:999px;background:{{PRIMARY_COLOR}}18;color:{{PRIMARY_COLOR}};font-size:16px;font-weight:700;width:fit-content;">YoY +23%</span>
    </div>
    <!-- 绿卡：毛利 -->
    <div style="padding:24px 20px;border-radius:16px;background:{{PRIMARY_COLOR}}10;border:1px solid {{PRIMARY_COLOR}}24;box-shadow:0 6px 20px {{PRIMARY_COLOR}}16;display:flex;flex-direction:column;gap:12px;min-width:0;min-height:0;height:100%;">
      <span style="pointer-events:none;font-size:56px;font-weight:900;line-height:1;color:#111827;">¥3.2M</span>
      <h3 style="font-size:22px;font-weight:700;margin:0;color:#111827;overflow-wrap:break-word;word-break:break-word;">毛利</h3>
      <div style="width:100%;height:10px;border-radius:999px;background:{{PRIMARY_COLOR}}20;overflow:hidden;">
        <div style="pointer-events:none;width:75%;height:100%;border-radius:999px;background:linear-gradient(90deg,{{PRIMARY_COLOR}},{{PRIMARY_COLOR_DARKER}});"></div>
      </div>
      <span style="pointer-events:none;display:inline-flex;align-items:center;padding:4px 12px;border-radius:999px;background:{{PRIMARY_COLOR}}18;color:{{PRIMARY_COLOR}};font-size:16px;font-weight:700;width:fit-content;">margin 25%</span>
    </div>
    <!-- 橙卡：留存 -->
    <div style="padding:24px 20px;border-radius:16px;background:{{PRIMARY_COLOR}}10;border:1px solid {{PRIMARY_COLOR}}24;box-shadow:0 6px 20px {{PRIMARY_COLOR}}16;display:flex;flex-direction:column;gap:12px;min-width:0;min-height:0;height:100%;">
      <span style="pointer-events:none;font-size:56px;font-weight:900;line-height:1;color:#111827;">86%</span>
      <h3 style="font-size:22px;font-weight:700;margin:0;color:#111827;overflow-wrap:break-word;word-break:break-word;">客户留存</h3>
      <div style="width:100%;height:10px;border-radius:999px;background:{{PRIMARY_COLOR}}20;overflow:hidden;">
        <div style="pointer-events:none;width:86%;height:100%;border-radius:999px;background:linear-gradient(90deg,{{PRIMARY_COLOR}},{{PRIMARY_COLOR_DARKER}});"></div>
      </div>
      <span style="pointer-events:none;display:inline-flex;align-items:center;padding:4px 12px;border-radius:999px;background:{{PRIMARY_COLOR}}18;color:{{PRIMARY_COLOR}};font-size:16px;font-weight:700;width:fit-content;">↗ +5.2pp</span>
    </div>
    <!-- 紫卡：DAU -->
    <div style="padding:24px 20px;border-radius:16px;background:{{PRIMARY_COLOR}}12;border:1px solid {{PRIMARY_COLOR}}28;box-shadow:0 6px 20px {{PRIMARY_COLOR}}18;display:flex;flex-direction:column;gap:12px;min-width:0;min-height:0;height:100%;">
      <span style="pointer-events:none;font-size:56px;font-weight:900;line-height:1;color:#111827;">2.3M</span>
      <h3 style="font-size:22px;font-weight:700;margin:0;color:#111827;overflow-wrap:break-word;word-break:break-word;">DAU</h3>
      <div style="width:100%;height:10px;border-radius:999px;background:{{PRIMARY_COLOR}}20;overflow:hidden;">
        <div style="pointer-events:none;width:72%;height:100%;border-radius:999px;background:linear-gradient(90deg,{{PRIMARY_COLOR}},{{PRIMARY_COLOR_DARKER}});"></div>
      </div>
      <span style="pointer-events:none;display:inline-flex;align-items:center;padding:4px 12px;border-radius:999px;background:{{PRIMARY_COLOR}}18;color:{{PRIMARY_COLOR}};font-size:16px;font-weight:700;width:fit-content;">QoQ +41%</span>
    </div>
  </div>
</div>
\`\`\`
3 个指标就用 grid-template-columns:repeat(3,1fr)，保持卡片数量和列数一致。

### content-image-background（大图背景+玻璃卡片叠层 · L1高级版式 · backdrop-filter玻璃拟态）
\`\`\`html
<div style="${OUTER};padding:0;" data-layout="content-image-background">
  <!-- 全屏背景图（先占位，等实际图替换）-->
  <div style="position:absolute;inset:0;overflow:hidden;z-index:0;">
    <img src="https://NOPPT_IMAGE_PLACEHOLDER" data-image-ratio="16:9" style="width:100%;height:100%;object-fit:cover;display:block;">
    <!-- 背景暗化蒙版：保证文字可读性 -->
    <div style="pointer-events:none;position:absolute;inset:0;background:linear-gradient(135deg,rgba(17,24,39,0.55),rgba(17,24,39,0.25));"></div>
  </div>
  <!-- 内容层：玻璃卡片叠在背景图上 -->
  <div style="position:relative;z-index:1;width:100%;height:100%;padding:${PY}px ${PX}px;box-sizing:border-box;display:flex;flex-direction:column;justify-content:center;min-height:0;min-width:0;">
    <h2 style="font-size:44px;font-weight:800;margin:0 0 32px 0;line-height:1.25;letter-spacing:-0.01em;overflow-wrap:break-word;word-break:break-word;color:#FFFFFF;text-shadow:0 2px 12px rgba(0,0,0,0.4);">页面标题（叠在背景图上）</h2>
    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:24px;min-width:0;">
      <!-- 玻璃卡片 1（✅ 可选中：有 background+backdrop-filter+border+border-radius+box-shadow）-->
      <div style="padding:28px 32px;border-radius:16px;background:rgba(255,255,255,0.55);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border:1px solid rgba(255,255,255,0.6);box-shadow:0 8px 32px rgba(0,0,0,0.12);display:flex;flex-direction:column;gap:12px;min-width:0;">
        <h3 style="font-size:28px;font-weight:800;margin:0;color:${PD};overflow-wrap:break-word;word-break:break-word;">玻璃卡片标题一</h3>
        <p style="font-size:22px;color:#111827;font-weight:600;line-height:1.8;margin:0;overflow-wrap:break-word;word-break:break-word;">正文内容文字，玻璃背景衬底清晰可读，半透明+模糊让背景图透出来但不影响阅读。</p>
      </div>
      <!-- 玻璃卡片 2 -->
      <div style="padding:28px 32px;border-radius:16px;background:rgba(255,255,255,0.55);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border:1px solid rgba(255,255,255,0.6);box-shadow:0 8px 32px rgba(0,0,0,0.12);display:flex;flex-direction:column;gap:12px;min-width:0;">
        <h3 style="font-size:28px;font-weight:800;margin:0;color:${PD};overflow-wrap:break-word;word-break:break-word;">玻璃卡片标题二</h3>
        <p style="font-size:22px;color:#111827;font-weight:600;line-height:1.8;margin:0;overflow-wrap:break-word;word-break:break-word;">正文内容文字。backdrop-filter 必须同时写标准属性 + -webkit- 前缀，确保 Safari 兼容。</p>
      </div>
    </div>
  </div>
</div>
\`\`\`
content-image-background 只有 1 张图（全屏背景图），符合"每页一张 img 占位符"约束。文字卡片都放在玻璃容器内（✅ 可选中编辑）。

### summary（总结页）
\`\`\`html
<div style="${OUTER};justify-content:center;align-items:center;text-align:center;">
  <div style="width:80px;height:6px;background:${P};border-radius:3px;margin-bottom:40px;"></div>
  <h2 style="${GRAD_SUMMARY}">感谢观看</h2>
  <p style="font-size:24px;color:#6B7280;margin:0 0 8px 0;overflow-wrap:break-word;word-break:break-word;">Q & A</p>
</div>
\`\`\`
`;
}

const PAGE_TEMPLATES = getPageTemplates(1280, 720, 'auto', 'sans');

/**
 * 未知/无专属模板页型的「最小基础模板集」——仅包含封面装饰参考的简短提取 + 一段通用要点列表写法。
 * 总长控制在 ~1.2KB，避免未知页型时把全部模板注入（回归全量），也避免模型完全无参考。
 */
const MINIMAL_TEMPLATE_KIT = `当前页型无专属模板，请套用以下通用结构（单页优雅呈现；所有彩色元素仅使用 {{PRIMARY_COLOR}} / {{PRIMARY_COLOR_DARKER}} 及其透明度变体 + 中性灰阶）：
\`\`\`html
<div style="width:100%;height:100%;overflow:hidden;position:relative;box-sizing:border-box;padding:48px 64px;display:flex;flex-direction:column;background-color:{{CANVAS_BG_COLOR}};">
  <h2 style="font-size:50px;font-weight:700;margin:0 0 32px 0;line-height:1.25;letter-spacing:-0.01em;overflow-wrap:break-word;word-break:break-word;background:linear-gradient(135deg,{{PRIMARY_COLOR}},{{PRIMARY_COLOR_DARKER}});-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;">页面标题</h2>
  <div style="pointer-events:none;width:80px;height:6px;background:{{PRIMARY_COLOR}};border-radius:3px;margin-bottom:24px;"></div>
  <ul style="margin:0;padding:0;list-style:none;flex:1;min-width:0;display:flex;flex-direction:column;gap:16px;justify-content:center;">
    <li style="display:flex;align-items:center;gap:12px;padding:16px 24px;border-radius:12px;background:{{PRIMARY_COLOR}}08;border:1px solid {{PRIMARY_COLOR}}24;overflow-wrap:break-word;word-break:break-word;min-width:0;"><span style="font-size:18px;line-height:1.7;color:#374151;flex:1;">要点一</span></li>
    <li style="display:flex;align-items:center;gap:12px;padding:16px 24px;border-radius:12px;background:#F9FAFB;border:1px solid #E5E7EB;overflow-wrap:break-word;word-break:break-word;min-width:0;"><span style="font-size:18px;line-height:1.7;color:#374151;flex:1;">要点二</span></li>
    <li style="display:flex;align-items:center;gap:12px;padding:16px 24px;border-radius:12px;background:{{PRIMARY_COLOR}}08;border:1px solid {{PRIMARY_COLOR}}24;overflow-wrap:break-word;word-break:break-word;min-width:0;"><span style="font-size:18px;line-height:1.7;color:#374151;flex:1;">要点三</span></li>
  </ul>
</div>
\`\`\``;

/**
 * 按 pageType 过滤返回对应模板（baseTypes 全覆盖基础 11 + L1 高级 5，精确 section 切取）。
 * 目标：减少注入模板的冗余字符 ~60-70%，降低 prompt token。
 *
 * 单测思路：
 * - 取 16 个页型（cover/toc/summary、各 content-*、5 个 L1 高级）调用本函数，断言返回串仅含目标 section 标题、不含其他 section 标题；
 * - 'content-foo' 等不在 baseTypes 的未知页型：断言返回 === MINIMAL_TEMPLATE_KIT 且触发 console.warn；
 * - content-* 内容页返回串应额外包含「封面装饰参考」段头（cover/toc/summary 本身不含）。
 */
export function getPageTemplatesByPageType(
  pageType: string | undefined,
  slideWidth: number = 1280,
  slideHeight: number = 720,
  iconStyle: string = 'auto',
  fontFamily: 'sans' | 'serif' | 'mono' = 'sans',
): string {
  const all = getPageTemplates(slideWidth, slideHeight, iconStyle, fontFamily);
  if (!pageType) return all; // 兜底：pageType 缺失时返回全部，避免模型缺少参考
  const normalized = String(pageType).trim().toLowerCase();
  // 页型 → section 标题匹配关键词（heading 用能唯一匹配模板 section 标题的关键词）
  const baseTypes: Record<string, string[]> = {
    cover: ['cover'],
    toc: ['toc'],
    summary: ['summary'],
    'content-image-left': ['content-image-left'],
    'content-image-right': ['content-image-right'],
    'content-image-top': ['content-image-top'],
    'content-no-image': ['content-no-image'],
    'content-cards': ['content-cards'],
    'content-compare': ['content-compare'],
    'content-timeline': ['content-timeline'],
    'content-table': ['content-table'],
    'content-zigzag': ['content-zigzag'],
    'comparison-deep-dive': ['comparison-deep-dive'],
    'content-value-showcase': ['content-value-showcase'],
    'content-stats-highlight': ['content-stats-highlight'],
    'content-image-background': ['content-image-background'],
    'content-quote': ['content-quote'],
    // ===== FR-18 §18.1 / §18.5 扩展 =====
    // 新 Layout 暂无独立 slide 级 HTML 模板段落；映射到结构最相近的既有段落作为参考骨架，
    // 详细结构约束由「页面类型说明」区（PRESENTATION_PLANNING_PROMPT）的 ### content-* 段落给出。
    'content-flowchart': ['content-cards'],
    'content-org-chart': ['content-cards'],
    'content-pyramid': ['content-cards'],
    'content-matrix': ['content-cards'],
    'content-three-section': ['content-no-image'],
    'content-process-steps': ['content-cards'],
    'content-icon-grid': ['content-cards'],
    'content-section-divider': ['content-no-image'],
    'content-testimonial': ['content-no-image'],
    'content-chart-bar': ['content-cards'],
    'content-chart-line': ['content-cards'],
    'content-chart-pie': ['content-cards'],
    'content-chart-donut': ['content-cards'],
    'content-cycle': ['content-cards'],
    'content-dashboard': ['content-cards'],
    'content-architecture': ['content-org-chart'],
  };
  const headings = baseTypes[normalized];
  if (!headings) {
    // 弱兜底：未知 pageType（不在 baseTypes）→ 注入最小模板集，不再 return all
    console.warn('[TEMPLATE] 未知页型:' + pageType + '，已注入最小模板集，请在 baseTypes 补充');
    return MINIMAL_TEMPLATE_KIT;
  }

  // 通用切取：对每个 heading 关键词匹配所有同名 section（用 exec 处理 content-cards / content-image-top 等两个同名标题），按原始顺序拼接
  const extracted = extractSections(all, headings);
  if (extracted.length === 0) {
    // 已知页型但模板区无匹配 section（如 content-quote 暂无专属段）：同样走最小集，避免全量回归
    console.warn(
      '[TEMPLATE] 页型"' +
        pageType +
        '"在模板区无匹配 section，已注入最小模板集，请在 baseTypes 补充对应模板段',
    );
    return MINIMAL_TEMPLATE_KIT;
  }

  // content 内容页额外注入封面 section 作为「装饰参考」（仍是精确 section 切取，不回归全量）
  if (!['cover', 'toc', 'summary'].includes(normalized)) {
    const coverSections = extractSections(all, ['cover']);
    if (coverSections.length) {
      extracted.push(
        '【封面装饰参考 · 仅参考其装饰性元素/版式手法，勿整页照搬，正文遵守其他红线】\n' +
          coverSections.join('\n\n'),
      );
    }
  }
  return extracted.join('\n\n');
}

/**
 * 对模板串按 heading 关键词切取所有匹配的 section，按原始出现顺序返回并去重。
 * 用 `regex.exec` 配合全局标志（而非 matchAll）规避低版本 TS lib 的差异。
 */
function extractSections(all: string, headings: string[]): string[] {
  const collected: Array<{ index: number; text: string }> = [];
  for (const tag of headings) {
    const re = new RegExp(
      `(###\\s+\\*?\\*?.*?${escapeReg(tag)}[\\s\\S]*?)(?=\\n###\\s|\\n\`\`\`\\s*$|$)`,
      'gi',
    );
    let m: RegExpExecArray | null;
    while ((m = re.exec(all)) !== null) {
      collected.push({ index: m.index, text: m[0] });
      // 避免 matchAll 找不到下一段时死循环（lookahead 不消费，需手动推进）
      if (re.lastIndex === m.index) re.lastIndex = m.index + 1;
    }
  }
  collected.sort((a, b) => a.index - b.index);
  const seen = new Set<number>();
  const out: string[] = [];
  for (const c of collected) {
    if (!seen.has(c.index)) {
      seen.add(c.index);
      out.push(c.text);
    }
  }
  return out;
}

function escapeReg(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export { getPageTemplates };

export const HTML_PRESENTATION_GENERATION_PROMPT = PRESENTATION_PLANNING_PROMPT;
export const HTML_PRESENTATION_FROM_REFERENCE_PROMPT = PRESENTATION_PLANNING_PROMPT;

export const HTML_SLIDE_MODIFICATION_PROMPT = `你是一个专业的前端设计师。请根据用户的要求，修改当前幻灯片的 HTML 内容。

## 要求（非常重要，必须严格遵守）

1. 只输出修改后的完整 HTML，不要输出其他解释，不要markdown代码块
2. 保持整体设计风格一致，保持8pt网格规范
3. 所有样式使用 inline style
4. 外层容器保持 width:100%;height:100%;position:relative;overflow:hidden;box-sizing:border-box;padding:48px 64px;display:flex;flex-direction:column;
5. 按 1280x720 的比例设计，所有内容必须完全显示，不能超出边界
6. 优先使用 Flexbox 或 CSS Grid 布局
7. **flex子元素必须加 min-width:0 防止溢出**
8. 图片必须设置 max-width:100%;max-height:100%;object-fit:contain;border-radius:12px;
9. 图片容器必须有 overflow:hidden 和 max-height:100%
10. img必须保留data-image-ratio属性
11. 文字标签用h1-h6/p/ul/ol，禁止div包裹纯文本
12. 所有文本元素必须有 overflow-wrap:break-word;word-break:break-word;
13. 字号：H2>=32px，正文16-20px，最小14px
14. 主色统一使用：{{PRIMARY_COLOR}}
15. 文字和图片不能重叠
16. 不要使用position:absolute做主要布局

## 当前幻灯片 HTML

\`\`\`html
{{CURRENT_HTML}}
\`\`\`

## 用户修改要求

{{USER_REQUEST}}

## 修改范围

{{SCOPE_NOTE}}

请输出修改后的完整 HTML：
`;

export const HTML_GLOBAL_MODIFICATION_PROMPT = `你是一个专业的演示文稿设计总监。请根据用户的要求，修改整个演示文稿。

## 要求（非常重要，必须严格遵守）

1. 输出完整的 JSON 格式，包含所有幻灯片
2. 保持每张幻灯片的标题和整体结构，只修改需要调整的部分
3. 所有样式使用 inline style
4. 保持整体设计风格统一（8pt网格、统一配色、字号层级）
5. 每页外层容器保持 width:100%;height:100%;position:relative;overflow:hidden;box-sizing:border-box;padding:48px 64px;display:flex;flex-direction:column;
6. 按 1280x720 比例设计，内容不能超出边界
7. **flex子元素必须加 min-width:0**，图片容器必须有 overflow:hidden
8. 优先使用 Flexbox/Grid 布局
9. 图片必须有 max-width:100%;max-height:100%;object-fit:contain;border-radius:12px; 和 data-image-ratio属性
10. 所有文本元素必须有 overflow-wrap:break-word;word-break:break-word;
11. 语义化标签：h1-h6/p/ul/ol，禁止div包裹纯文本
12. 幻灯片数量（严格遵守，不要添加或减少）：严格遵守用户要求，不要添加额外页面

## 输出格式

\`\`\`json
{
  "title": "演示文稿标题",
  "transition": "none",
  "slides": [
    {
      "title": "幻灯片标题",
      "html": "<div>修改后的 HTML</div>",
      "notes": ""
    }
  ]
}
\`\`\`

## 当前演示文稿

标题：{{PRESENTATION_TITLE}}
幻灯片数量：{{SLIDE_COUNT}}
主色调：{{PRIMARY_COLOR}}

当前幻灯片内容（第 {{CURRENT_SLIDE_INDEX}} 页）：

\`\`\`html
{{CURRENT_HTML}}
\`\`\`

## 用户修改要求

{{USER_REQUEST}}

请输出完整的JSON：
`;

export { PAGE_TEMPLATES };
