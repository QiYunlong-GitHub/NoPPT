# NoPPT 用户任务指令版（直接粘贴进 Hermes 聊天框）

> 用法：把下面整段复制进 Hermes 对话框，作为**用户消息**发送即可触发一次「人在回路」演示筹备。
> 发送前把 `{{...}}` 占位替换成你的真实需求；不填的项可整行删掉，Hermes 会按约定给默认值。
> 本指令自包含（即使未加载 system 版也能跑）；若已把 system 版写进 AGENTS.md/Skill，本文件可只保留「演示需求」那几行。

```text
请用 NoPPT 帮我准备一份演示草稿。注意：只备料、不直接生成——投完料后把深链交给我，我到 Web 配置页确认参数后再点生成。

【演示需求】
- 主题(topic)：{{演示主题，≤500 字，必填}}
- 页数(slideCount)：{{例如 8，范围 1–40}}
- 风格(style)：{{business | tech | academic | creative}}
- 配色(colorTheme)：{{blue | purple | green | orange | teal | gray}}
- 受众(audience)：{{例如 技术决策者}}
- 字体(fontFamily)：{{sans | serif | mono，默认 sans}}
- 素材来源(referenceSource)：{{例如 企业知识库 / RAG}}

【执行流程】
1. 四源 RAG 取料并按优先级用：L0 单源 LLM Wiki（项目 wiki/，引用 [[concepts/xxx]]）、L1 本地 corpus（corpus/ 下 4 篇：01-product-overview / 02-architecture-mcp / 03-ai-modes / 04-glossary）、L2 联网检索（web.backend: ddgs）、L3 aws-knowledge（MCP aws___* 工具）。冲突仲裁：L3 ≈ L1 > L2。若本地 wiki/ 或 corpus/ 不存在，用 L2/L3 取料或向我索要素材。
2. referenceText 预算 = clamp(800 × slideCount, 3000, 20000)；把最重要内容放最前，超限从尾部丢弃。
3. 调用 MCP 工具 noppt_prepare_outline_draft 投递：topic 必填，referenceText / referenceSource / slideCount / style / colorTheme / audience / fontFamily 按上面填，mode 固定 "auto"。
4. 工具返回后，把 result.content[0].text（一段 JSON 字符串，需再 parse）里的 openUrl 回给我，并提示：请在 NoPPT Web「AI 生成演示」配置页确认生成模式/风格/页数/配色等，再点生成。

【禁止】
- 禁止调用 noppt_generate 直接出片。
- 禁止返回 jobId / viewUrl / 成片内容。
- 禁止用仓库外写死的 Key 字面值（用你自己签发的 Key，scope 为 tenant=hermes、user=local）。
```
