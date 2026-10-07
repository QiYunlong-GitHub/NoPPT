# 演示视觉完整性 Bug Fix 需求

## Summary

本需求定义 NoPPT 中演示视觉完整性缺陷的修复范围与可验证结果，目标演示为 `pres_musb7z42_ls8yvjc`，主题为“厄尔尼诺：现象、影响与应对”。修复必须同时覆盖当前演示、后续生成链路、编辑器预览、导出和验证证据，不能只通过修改目标演示的落盘 HTML 来消除表面现象。

当前已确认的缺陷包括：内容裁切或不可见、长标题固定高度不足、同一页面的 HTML 与 Deck 表示分叉、空指标正文、仅标题空卡片、summary 要点静默丢失、字体回退不可观测、窗口变化时编辑器未正确重排，以及缺少 render/visual validation/audit/fix 证据。目标演示共 5 页，验收必须覆盖所有页面。

本需求以 `.kiro/specs/presentation-visual-integrity/bugfix.md` 为行为基线，以 `design.md` 和 `tasks.md` 中的范围、安全约束及验证策略为约束来源。实现前必须先完成 bug-condition exploration 和 preservation baseline；后续每项实现均须先有失败测试，再实现并复验。当前任务不授权正式 promotion，所有测试和候选产物必须与正式运行时原件隔离。

### 假设与解释

1. 目标运行时目录中的 `presentation.json`、`ai-log.jsonl`、`chat-history.json`、`assets/` 和 `reference-attrs/` 是只读原始证据；除非用户另行明确确认，不得修改其中的正式内容。
2. “完整显示”指必需文本和视觉语义在逻辑画布及受支持窗口中可读、未被静默裁切；如果环境无法提供浏览器或字体证据，结果必须是 `unverified`/`needs_review`，不是 `pass`。
3. 历史 HTML-only 数据、缺少 `slide.deck` 的数据、人工编辑的 HTML 以及现有 HTML-to-Deck fallback 均属于必须保留的兼容行为。
4. 对旧计划中无法可靠拆分的内容，系统应保留原文并明确标记 legacy/omitted/needs_review，而不是编造事实、删除文本或创建空正文占位。
5. “后续生成链路”包括从计划生成到预览、编辑保存、导出及保存前验证的相关路径；本需求不要求改变演示主题、事实数据、页数或用户明确配置的视觉风格。

## Functional Requirements

### FR-1：建立可复现的缺陷与保留行为基线

1. 修复前必须使用目标演示的只读副本记录每页 HTML、Deck、页型、标题、可见文本、节点矩形、字体状态和现有日志事件。
2. Exploration 必须分别检查并记录以下 bug condition：必需内容越界或裁切、固定画布无法适配、HTML/Deck 语义分叉、空节点或静默丢失、字体状态不可验证，以及缺少视觉验证证据。
3. 必须建立不满足 bug condition 的 synthetic preservation fixtures，覆盖合法 HTML、合法 Deck、缺失 Deck 的历史数据、图片/渐变/shape/list/card，以及编辑和导出能力。
4. 基线结果必须区分真实产品失败与浏览器、字体、外部资源或服务不可用导致的 `unverified`，不得把环境缺失伪造为通过或失败。

### FR-2：保留并完整承载计划内容

1. 计划中的必需内容必须以可追踪的结构化条目表示，至少覆盖 compare item、metric item、card item 和 summary item；每个条目必须有稳定身份或明确的省略原因。
2. 必需正文不得以空字符串、空文本节点或无解释的占位节点代替。非法、缺失或数量不一致的计划必须产生可定位的结构化问题，并阻止其作为“完整通过”的结果保存。
3. 旧计划中的 `keyPoints` 必须继续可读取和适配。适配过程中不得静默丢弃原文，无法安全推断结构时必须保留整句并标记兼容来源或需复核状态。
4. 内容集合在计划、最终 Deck、HTML、编辑器预览和导出输入之间必须可逐项追踪；允许省略时必须记录条目身份、原因和状态。

### FR-3：修复五页目标演示的具体内容缺陷

1. 第 1 页标题“厄尔尼诺：现象、影响与应对”必须在所有验收窗口中完整可读，不得裁切、重叠或遮挡其他必需内容。
2. 第 2 页必须保持 Deck 语义声明的双栏结构。四个 compare item 的顺序、文本和列归属必须一致；首个“海表温度异常升高”及其 bullet marker 必须属于同一可见列表项，不得拆成孤立符号和正文。
3. 第 3 页的四个指标必须各自有可读的非空 value/label，或有明确、逐项可追踪的 omission 状态；不得以空正文卡片补齐数量。
4. 第 4 页的三项策略必须全部可读。卡片高度和正文区域必须与实际内容匹配；没有可拆分标题时也必须保留完整策略句，不得继续生成三张固定高、仅标题的空卡片。
5. 第 5 页计划中的 summary 要点必须逐项出现在最终可见内容中，或逐项带有明确省略理由；不得只保留第一项而静默丢弃其余要点。
6. 修复不得改变上述页面的事实数据、页数、顺序、主题或用户明确要求保留的视觉风格。

### FR-4：统一逻辑画布并保证文本布局完整

1. 生成、预览、编辑选择框和导出必须使用同一逻辑画布坐标语义，标准画布为 `1280×720`；外层响应式容器和内层固定画布不得形成会遮蔽有效内容的重复坐标模型。
2. 文本区域必须在确定最终字号、行高、换行和可用空间前完成可验证的需求测量。布局可通过自然换行、动态高度、字号/间距调整或安全的 compact/reflow 方式解决超限。
3. 必需正文不得依赖 `overflow:hidden` 静默裁切。固定高度只能作为布局约束或告警依据，不能在未确认内容完整前隐藏文本。
4. 所有必需节点必须在逻辑画布边界内；无法安全布局时必须返回明确 `fail` 或 `unverified`，不得通过删除内容取得表面通过。

### FR-5：编辑器响应式预览和交互保持可用

1. 编辑器在窄窗口 `800×600`、标准窗口 `1280×720`、宽窗口 `1600×900` 下必须完整显示目标演示的必需内容，并支持从窄到宽、从宽到窄的连续 resize 验证。
2. 窗口变化必须重新计算可用尺寸、缩放或安全布局档位；无安全重排方案时必须完整缩放逻辑画布，而不是依赖水平滚动或裁切正文。
3. 画布比例、内容层级、相对对齐和 content identity 在重排或缩放后必须保持稳定；指针坐标、选择框、页面切换和缩放操作必须继续正确工作。
4. 既有文本编辑、复制粘贴、撤销/重做、页面选择、保存和用户缩放行为不得因响应式修复而消失或无法定位。

### FR-6：保持 HTML/Deck、编辑和导出一致

1. Deck 与 HTML 同时存在时，二者必须具有相同的可见文本集合、顺序、文本归属、角色、列/组语义和必需节点身份。
2. 生成链路必须避免两套独立语义真值导致后续分叉；预览、编辑和导出所使用的表示必须能回查到相同内容身份。
3. Deck parity 通过时，导出必须继续优先使用 Deck。Parity 失败时不得静默导出不一致结果，应返回可诊断的 `fail`/`needs_review` 状态。
4. 历史 HTML-only 或人工 HTML 必须继续能够打开并经现有 HTML-to-Deck fallback 导出；fallback 必须标明来源和几何精度/验证降级，不能冒充 Deck parity 通过。
5. 现有 HTML 清理、历史数据读取、页面编辑和 Deck-to-PPTX 能力必须继续可用；修复不得删除合法图片、渐变、装饰形状、列表或卡片。

### FR-7：字体回退和度量状态可观测

1. 对每页关键标题、正文和字重，系统必须记录声明字体、实际解析字体/回退状态、字号、字重、行高及必要的文本度量结果。
2. 字体状态至少要能区分 `resolved`、`fallback`、`unverified` 和 `failed`。无法访问字体 API、浏览器或外部字体时不得标记为 `pass` 或伪装为已解析。
3. 字体回退造成的可见度量变化必须触发重新布局、告警或失败/需复核状态；不得让回退导致的换行变化和裁切静默发生。
4. 字体检查不得强制某个专有字体，也不得因为无关字体服务不可用而破坏已可独立验证的合法编辑行为。

### FR-8：保存前完整验证和可追踪日志

1. 生成、自动修复、候选保存、预览、编辑保存和导出相关路径必须在最终接受前检查内容完整性、空必需节点、逻辑边界、裁切、HTML/Deck parity、响应式窗口和字体状态。
2. 每页、每个必要检查类别和每次候选运行必须能关联同一 `runId`、presentation id、页面索引、阶段、输入来源、检查结果和产物路径。
3. 运行日志必须支持 `render`、`visual_validation`、`audit`、`fix` 事件；事件至少记录期望/观察内容数量、空节点数、越界/裁切数、parity 状态、字体摘要、状态、修复动作、耗时和错误码（适用时）。
4. 未运行、无法验证或证据不足的检查必须是 `unverified`/`needs_review`，不得被汇总为通过。自动修复后必须重新执行相关检查，不能复用修复前的通过结果。
5. 日志和报告不得写入 API key、完整敏感素材全文或完整外部响应；必要原文只能保存在受保护的隔离候选产物中。

### FR-9：原始文件保护和候选生命周期

1. 修复运行开始时必须为目标演示原始 `presentation.json`、`ai-log.jsonl`、`chat-history.json`、资产清单和 reference-attrs 清单建立不可变快照，并记录 SHA-256、时间、演示 id 和源版本信息。
2. 测试、审计、自动修复和预览的所有写入必须位于目标目录下隔离的 `.visual-integrity/<runId>/` 目录或等价临时目录，至少区分 `original`、`candidate`、`preview`、`reports` 和 `screenshots` 产物。
3. candidate 必须携带原始基线 hash；如果正式原件在运行期间发生 hash 或更新时间漂移，系统必须拒绝继续提升并要求重新快照或人工决策。
4. 在本次任务中禁止 promotion。即使候选检查通过，也只能保留未提升 candidate 和报告；不能写回正式 `presentation.json` 或其他原始文件。
5. 后续若启用 promotion，必须要求显式用户确认、满足 promotion policy、采用可恢复的原子更新并保留 active-original；rollback 必须可恢复原始字节和 hash，失败时保留快照并进入明确失败状态。

### FR-10：Hermes 联调边界

1. 联调只能验证 Hermes MCP `noppt_prepare_outline_draft` 的 mock contract，不得调用 `noppt_generate`，不得借助 Hermes 绕过视觉验证或自动 promotion。
2. 草稿参数 `mode` 必须为 `auto`；`referenceText` 长度预算必须为 `clamp(3000, 20000, 800 × slideCount)`，最重要内容置前，超限从开头截断。
3. 成功结果只能提供 `openUrl`，并停留在 Web config 界面等待用户确认；不得自动进入生成、正式保存或提升流程。
4. 测试必须能断言 `noppt_generate` 调用次数为 0、未发生 promotion，且 key 仅从环境变量读取，不写入源码、fixture、日志或候选产物。

### FR-11：验证执行方式和最终交付报告

1. 必须按 `tasks.md` 的依赖顺序执行：先运行/补充 bug-condition exploration 和 preservation baseline，再逐项先写失败测试后实现，最后执行目标演示候选回归。
2. 验证使用一次性 test/typecheck/build 命令；不得启动长驻服务器或 watch，不得使用 worktree、commit、reset 或 clean，也不得覆盖无关已有改动。
3. 最终报告必须列出实际修改文件、`tasks.md` 每项状态、测试/类型检查/构建结果、候选路径、原始文件 hash 保护证据、Hermes 限制验证、所有 `unverified` 项和剩余风险。
4. 报告必须明确区分 `pass`、`warn`、`fail`、`unverified` 和“candidate 未提升”，不得因任务完成或环境限制伪造通过。

## Non-Functional Requirements

### NFR-1：数据安全与可恢复性

原始运行时数据必须可证明未被 preview、测试或自动修复修改。快照、candidate、报告和截图必须可按 run id 定位；任何失败都应保留诊断产物而不是删除唯一证据。正式提升不是本次交付的一部分。

### NFR-2：兼容性

必须兼容现有 1280×720 及自定义画布尺寸的读取、历史 HTML、缺失 Deck 数据、HTML fallback、服务端 API、编辑器操作和导出路径。新增元数据必须允许旧客户端忽略，且不得改变不满足 bug condition 的输入的可观察内容和语义顺序。

### NFR-3：可测试性和确定性

结构化内容检查、文本/几何边界检查、parity、字体状态和候选生命周期必须可以在无浏览器时进行确定性单元/集成测试；浏览器相关检查不可用时必须返回明确 `unverified`。同一输入、字体 profile 和 viewport 下的布局、身份映射和报告结果应稳定可复现。

### NFR-4：性能与日志最小化

内容和身份比较应随节点及文本规模近似线性；批量 DOM 几何读取不得产生不必要的逐节点 layout thrashing；完整浏览器验证不应在每次编辑按键时启动。日志只记录诊断所需摘要，不泄露密钥或敏感素材全文。

### NFR-5：可观测性

每个通过、警告、失败、未验证和候选未提升状态都必须能回查到输入、页面、检查项、原因和 artifact 路径。未知状态必须保持未知，不能通过默认值或缺省日志被解释为通过。

## Acceptance Criteria

以下标准均为必需且按编号验证；任何 required 项失败、无证据或被标为 `unverified` 时，不得宣称整体通过，也不得 promotion。

1. **基线可复现。** 在未修复实现上，exploration 测试从目标只读副本记录：第 1 页标题裁切/越界条件、第 2 页 HTML/Deck 单列与双栏分叉及 bullet 分离、第 3 页四个空指标正文、第 4 页三个固定高仅标题卡、第 5 页 summary 覆盖不足、字体证据缺失或回退未验证、五页验证日志缺失；测试结果明确为预期失败或 `unverified`，并保存临时报告。
2. **preservation 基线通过。** 合法 synthetic fixtures 在未修复实现上通过 preservation baseline，至少覆盖旧 HTML、缺失 Deck、合法 Deck、图片/渐变/shape/list/card、页面选择、缩放、文本编辑、复制粘贴、撤销/重做、保存和 HTML/PPTX fallback；未知环境状态为 `unverified`，不是 `pass`。
3. **typed 内容完整。** 合法 compare 每项有稳定身份和左右文本且两栏数量相等；metric 每项有非空 label/value；card 每项有 title/body 或明确 compact 状态；summary 承载全部 item 或逐项 omission。空字符串、重复身份、缺失 pair、数量不一致和必需字段缺失均产生结构化 issue。
4. **旧计划兼容。** 仅含合法旧 `keyPoints` 的历史计划仍可读取和生成；适配不静默删除原文，并对无法安全推断的结构保留整句和兼容/需复核标记。
5. **逻辑边界通过。** 生成的必需节点均满足 `0 ≤ x`、`0 ≤ y`、`x + width ≤ 1280`、`y + height ≤ 720`；文本不会因必需 `overflow:hidden` 被静默裁切。测量失败必须产生明确 `fail` 或 `unverified`。
6. **长标题通过。** 第 1 页标题在 `800×600`、`1280×720`、`1600×900` 和连续 resize 中完整可读，不与其他元素重叠、不越界、不依赖水平滚动；最终字号、行数、矩形和状态可追踪。
7. **compare parity 通过。** 第 2 页在 Deck、canonical HTML、编辑器预览和导出输入中均保持双栏、四项、每栏两项、顺序和列归属一致；“海表温度异常升高”的 bullet 与正文属于同一可见项；parity 不一致时结果为 `fail`/`needs_review`，不能静默导出。
8. **stats completeness 通过。** 第 3 页四个指标卡均有可见非空 label/value，或各自有 omission reason；required empty node 数为 0；description 缺失时采用可解释的紧凑状态，不伪造数据。
9. **cards completeness 通过。** 第 4 页三项策略均有可读信息，卡片高度与内容量匹配，不存在三张固定 `552px` 仅标题空卡，也不存在被隐藏的必需正文；窄屏改变列数时 item 顺序和身份不变。
10. **summary coverage 通过。** 第 5 页计划中的全部 summary 要点可在最终预览逐项回查，或每个缺失项有 content id、原因和状态；不得只显示首项后静默丢失。
11. **响应式编辑器通过。** 五页在窄、标准、宽三档以及双向连续 resize 中没有必需裁切、不可见正文或必须水平滚动才能读取的内容；画布比例、相对对齐、选择/指针坐标、缩放、页面切换和保存能力保持可用。
12. **字体状态通过。** 每页字体结果可区分 resolved/fallback/unverified/failed，至少记录声明族、实际/回退状态、字重、字号/行高和度量差；字体不可用或 API 缺失时不产生伪造 pass，回退导致的风险会触发重排、warning、fail 或 unverified。
13. **验证证据完整。** 目标五页均有可按 run id 回查的 render、visual validation、audit、fix（或明确不适用/未验证原因）证据，覆盖 content、geometry、clipping、parity、font 和 viewport；自动修复后存在重新验证结果。
14. **编辑和导出回归通过。** Deck-backed 数据继续 Deck 优先导出；HTML-only/历史/人工 HTML 继续 fallback 导出并标识来源及几何降级；合法装饰、图片、渐变、列表、卡片、编辑操作和保存契约未丢失。
15. **隔离候选通过。** 测试开始前生成原始快照及 SHA-256 manifest；所有测试、候选、预览、报告和截图写入 `.visual-integrity/<runId>/` 隔离路径；目标原始 `presentation.json`、`ai-log.jsonl`、资产和 reference-attrs hash 在整个本次任务中保持不变。
16. **禁止提升通过。** 本次运行不执行 promotion；即使 candidate 检查通过，也必须报告为 candidate 未提升，并给出候选路径。原件 hash 保护证据必须出现在最终报告中。
17. **Hermes contract 通过。** mock/contract 测试确认仅调用 `noppt_prepare_outline_draft`，`mode=auto`，referenceText 遵守 `clamp(3000,20000,800×slideCount)` 和从头截断规则，成功响应只返回 `openUrl` 并停在 config；`noppt_generate` 调用次数为 0，未发生 promotion，密钥未落盘。
18. **测试与交付报告完整。** 按 tasks 顺序运行受影响测试、typecheck 和 build；报告列出实际修改文件、每项任务状态、命令及结果、失败产物、候选路径、原始 hash、所有 unverified/风险。任何未运行项、环境限制或失败项均明确标记，不能用“完成”替代证据。
19. **保留属性通过。** 对所有不满足 bug condition 的 fixture，修复前后用户可见内容、页数/顺序、语义顺序、合法视觉元素、编辑能力和导出契约等价，除必要 viewport 尺寸换算和非侵入式验证元数据外没有无关变化。
20. **端到端门槛通过。** 只有当第 1–19 项均有证据，且没有 required 检查处于未解释的 fail/unverified 状态时，才能将视觉完整性修复报告为通过；本次即使满足门槛也不得自动 promotion。

## Out of Scope

1. 不改变演示主题、事实数据、页数、页面顺序、页面类型或用户明确保留的视觉风格；不以删减文本、改变事实或降低可读性解决缺陷。
2. 不重做与上述缺陷无关的全局视觉设计、品牌系统、编辑器架构或无关编辑功能。
3. 不要求引入或强制安装某个具体专有字体；不把浏览器/字体不可用伪装为成功，也不把字体环境差异扩大为无关功能故障。
4. 不以本需求交付新的 PPT/PPTX 能力；仅要求保留并验证既有 Deck 导出及 HTML fallback 契约。
5. 不覆盖、迁移、清理或删除目标演示正式原始文件、原始资产、历史日志或唯一快照；不执行本次未授权的 promotion 或 rollback。
6. 不调用 `noppt_generate`，不绕过 Hermes config 确认，不自动调用外部生成流程；Hermes 仅限 `noppt_prepare_outline_draft` mock/contract 验证。
7. 不启动长驻服务器、watch、开发服务或后台进程作为交付步骤；不创建 worktree、commit、reset、clean，也不覆盖无关已有改动。
8. 不要求在缺少 Chromium、字体、外部资源或运行时服务时伪造视觉通过；这类环境限制必须保留为 `unverified`，并在最终报告中列出。
9. 不把单次目标演示修复扩大为删除历史 HTML/Deck fallback、移除 `normalizeAISlide`/sanitize、改变已有 API 边界或破坏合法人工编辑保存。
10. 不要求在本需求文档中决定具体模块划分、算法实现或代码改动方案；这些属于后续设计与实现阶段，但必须满足本文件的行为、兼容、安全和验收约束。
