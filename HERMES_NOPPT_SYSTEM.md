# NoPPT 系统提示版（写进 Hermes AGENTS.md / Skill 的 SKILL.md）

> 用法：把下面整段作为**系统提示 / 项目约定**固化进 Hermes，使其在每个会话默认遵守「人在回路」工作流。
> - 放进项目级 `AGENTS.md`：随 NoPPT 仓库 clone 自动加载（需取消 gitignore 并抹掉 Key 字面值）。
> - 放进 Hermes 用户目录的 Skill（`SKILL.md`）：只对配了该 Skill 的会话生效，不随仓库走。
> - 放进 `SOUL.md`：作为全局身份/行为基调的一部分（不推荐放纯项目约定）。
>
> ⚠️ 维护提示：本文件是 Hermes `skills/research/knowledge-to-noppt-brief/SKILL.md` 的「源码 / 真相源」，两者约定文本须保持一致；改了这边记得同步到该 Skill（反之亦然）。

```text
# NoPPT 人在回路工作流（Hermes 项目约定）

当用户要求做一份演示、且应「先让用户把关主题/素材/风格」时，强制走「只备料、不生成」的人回路流程。

## 铁律
1. 只用 noppt_prepare_outline_draft 投递，禁止 noppt_generate 直接出片。
2. referenceText 预算 = clamp(800 × slideCount, 3000, 20000)；最重要内容放最前（超限后端从头截断）。
3. 草稿 mode 固定 auto；投递后只回 openUrl，停在 Web「AI 生成演示」配置页等用户确认。

## 流程
1. 四源 RAG 取料：L0 单源 LLM Wiki（项目 wiki/，引用 [[concepts/xxx]]）、L1 本地 corpus（corpus/ 下 4 篇：01-product-overview / 02-architecture-mcp / 03-ai-modes / 04-glossary）、L2 联网（web.backend: ddgs）、L3 aws-knowledge（MCP aws___* 工具）。冲突仲裁：L3 ≈ L1 > L2。若 wiki/corpus 缺失，用 L2/L3 或向用户索要素材。
2. 按预算裁剪素材，重要在前。
3. 调用 noppt_prepare_outline_draft：topic(必填, ≤500 字) / referenceText / referenceSource / slideCount(1–40) / style(business|tech|academic|creative) / colorTheme(blue|purple|green|orange|teal|gray) / audience / fontFamily(sans|serif|mono) / mode=auto。
4. 把 result.content[0].text（JSON 字符串，需 parse）里的 openUrl 回给用户，并提示去 Web 配置页确认参数后点生成。

## 禁止
- 调用 noppt_generate 直接出片。
- 返回 jobId / viewUrl / 成片内容。
- 用仓库外写死的 Key 字面值（自行签发 scope 为 `tenant=hermes`、`user=local` 的 Key）。

## 鉴权与作用域
- Hermes 经环境变量 `MCP_NOPPT_API_KEY` 持有 NoPPT Key（name=`hermes-local`，其 scope 由该 Key 的 `tenantId=hermes` / `userKey=local` 决定），连接 `http://localhost:3001/api/mcp`（`Authorization: Bearer ${MCP_NOPPT_API_KEY}`）。
- 作用域：该 Key 的 `tenantId=hermes`、`userKey=local`，深链里的 `t=hermes&u=local` 即由此决定；备料与确认两端须同一 scope，否则 Web 端返回 `forbidden_scope`。详见 README「Agent 联调约定」。
```
