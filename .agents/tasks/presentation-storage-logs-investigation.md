# 演示 `pres_musb7z42_ls8yvjc` 的保存位置、日志与报文调查报告

## 摘要结论

1. **已从当前磁盘确认目标演示存在**：
   `D:\TraeSOLO\NoPPT\packages\server\data\tenants\default\users\default\workspace\presentations\pres_musb7z42_ls8yvjc\`。
   目录中已确认有 `presentation.json`、`ai-log.jsonl` 和 `chat-history.json`；演示元数据文件的标题是“厄尔尼诺：现象、影响与应对”。这是当前工作区的实际运行时状态，不只是源码推断。
2. **存储不是数据库、S3 或其他对象存储**。代码使用 Node `fs` 把 JSON/JSONL 和资源写到 `packages/server/data` 下；作用域路径是 `data/tenants/<tenant>/users/<user>/workspace/`。本例是 `tenant=default`、`user=default`。
3. **编辑器 URL 不是数据文件 URL**。`/editor/:id` 是 Vite/React 路由；前端随后调用 `GET http://localhost:3001/api/presentations/:id` 和聊天历史接口加载数据。当前只读探测中 `5173` 返回了 200，但 `3001` 不可达，因此不能把浏览器拿到 5173 的 HTML 解释为后端已正常加载该演示。
4. **AI 详细日志已落盘**：目标目录的 `ai-log.jsonl` 当前可读，内容包含 `reference-parse`、`plan` 等详细记录，且详细记录可以包含完整 LLM request/response、提示词、生成 HTML 和图片调用信息。简单模式只保存摘要/计数，不保存完整报文。
5. **原始 MCP JSON-RPC HTTP 信封没有通用落盘实现**。`mcp-audit.jsonl` 只记录工具、job、作用域、状态、时长、演示 ID 等审计元数据；`GenerationQueue` 的作业参数和结果只在进程内 `Map` 中保留，默认终态 TTL 为 1 小时。MCP 的原始请求头、JSON-RPC body 和响应 body 应从调用方/Hermes 日志、实时 `curl.exe -v` 或抓包工具取得；AI provider 的报文则可从详细 `ai-log.jsonl` 取得。
6. **本次状态限制**：调查没有修改代码、配置、数据，也没有重启服务。当前 `3001` 未监听，所以没有执行接口级 GET/MCP 验证；下面同时给出服务恢复后可执行的命令。当前磁盘上读取到的 `mcp-audit.jsonl`（default/default 与 hermes/local）没有出现该演示 ID，因而不能仅凭现有审计文件证明这个演示是由 MCP 生成的。

## 当前已确认的运行时文件

目标目录（已从磁盘确认）：

```text
D:\TraeSOLO\NoPPT\packages\server\data\tenants\default\users\default\workspace\presentations\pres_musb7z42_ls8yvjc\
```

已确认存在：

```text
presentation.json       # 演示元数据、slides、每页 HTML/结构化 deck 数据
ai-log.jsonl            # AI 调用/生成/后处理日志，JSON Lines
chat-history.json       # 编辑器 AI 对话记录
```

源码约定的同一演示目录还可能包含以下按功能产生的内容：

```text
assets\images\         # 下载/保存的图片
assets\videos\         # 上传的视频
reference-attrs\       # 参考素材视觉属性缓存（若使用）
reference-originals\   # 参考原图副本（若使用）
audit\                  # 审核报告与 screenshots（若运行审核）
```

本次读取的 `chat-history.json` 记录了“生成一个关于厄尔尼诺简介的演示文稿”以及“共 5 页”的生成结果消息；这是文件当前内容的运行时证据。`presentation.json` 开头的 `id` 与目标 ID 一致，标题为“厄尔尼诺：现象、影响与应对”。完整 JSON 含较长的每页 HTML，报告没有复制其全部内容。

## 证据与代码定位

### 1. 文件系统存储和作用域路径

- `packages/server/src/common/storage.service.ts`：`StorageService.constructor` 把根目录设置为 `join(process.cwd(), 'data', ...scope)`；`getPresentationDir(presentationId)` 把演示定位到 `workspace/presentations/<id>`；`ensurePresentationDir` 创建演示目录及 `assets/images`、`assets/videos`。
- 同文件的 `writeJsonFile` 使用临时文件加 rename 写 JSON，`appendToLogFile` 以 JSON Lines 方式追加，`readJsonFile`/`readLogFile` 直接从磁盘读取。这些实现没有数据库驱动、S3 client 或对象存储适配器。
- `packages/server/src/common/rest-context.ts`：`createRestStorage` 将认证身份映射为 `tenants/<tenantId>/users/<userKey>`；仅 `default/default` 在没有新作用域目录时兼容旧的未作用域目录 `data/workspace`。
- `packages/server/src/modules/mcp/mcp-context.ts`：`buildMcpContext` 明确创建 `createScopedStorage('tenants', tenantId, 'users', userKey)`，因此 MCP 生成的演示通常在调用 Key 的作用域下，而不是全局共享目录。
- `README.md` 的“Data Storage & Self-hosting”和“MCP Scopes, artifacts & preview”也声明运行时数据在 `packages/server/data/`，并按作用域存放。

**对本例的路径判断**：当前目标目录位于 `default/default`，与上述源码路径规则完全一致。仓库中另有旧的未作用域目录 `packages/server/data/workspace/presentations/` 和 `hermes/local` 作用域目录，但当前目标 ID 不在这两个位置。

### 2. 演示 ID 的定位、读取和编辑器加载

- `packages/server/src/modules/presentation/presentation.service.ts`：
  - `list()` 枚举当前 `workspace/presentations` 下的目录并读取各目录的 `presentation.json`；
  - `get(id)` 读取 `getPresentationDir(id)/presentation.json`，并在必要时做服务端 HTML 标准化/消毒；
  - `save(id, presentation)` 写回该演示的 `presentation.json`；
  - `getChatHistory`/`saveChatHistory` 访问同目录 `chat-history.json`。
- `packages/server/src/modules/presentation/presentation.controller.ts`：
  - `GET /api/presentations` 列出当前作用域演示；
  - `GET /api/presentations/:id` 按 ID 读取；
  - `PUT/PATCH/DELETE /api/presentations/:id` 分别保存、更新元数据、删除；
  - `GET/PUT /api/presentations/:id/chat` 读写聊天历史。
- `packages/web/src/App.tsx`：`/editor/:id` 映射到 `EditorPage`，所以 URL 中的 `pres_musb7z42_ls8yvjc` 是路由参数。
- `packages/web/src/pages/EditorPage.tsx`：`useParams()` 取 `id`，然后调用 store 的 `loadPresentation(id)`。
- `packages/web/src/stores/presentation-async.ts` 与 `packages/web/src/stores/presentation.ts`：加载演示后又请求聊天历史；加载失败只在前端记录 `Failed to load presentation` 并显示“演示文稿不存在”。
- `packages/web/src/utils/api.ts`：开发环境 `API_BASE` 固定为 `http://localhost:3001/api`；`presentationApi.get(id)` 请求 `/presentations/${id}`，`logsApi.getAILogs(id)` 请求 `/logs/ai/${id}`。

因此，最直接的 ID 定位是先定位当前认证作用域，再访问该作用域下的 `presentations/<id>/presentation.json`；仅凭编辑器 URL 不能确定租户/用户作用域，当前磁盘文件才确认了本例是 `default/default`。

### 3. AI 日志和审核/审计实现

- `packages/server/src/modules/logs/logs.service.ts`：`logAICall(presentationId, type, data)` 将固定的 `id/timestamp/type` 与 `data` 原样合并，追加到当前作用域演示目录的 `ai-log.jsonl`；`getAILogs` 读取该文件。
- `packages/server/src/modules/logs/logs.controller.ts`：`GET /api/logs/ai/:presentationId` 返回该日志数组。由于它走正常 REST 作用域上下文，必须使用能访问该作用域的认证 Key。
- `packages/ai/src/utils/llm-tracer.ts`：LLM/image trace 先保存在进程内 session；注释和 `LLMCallTrace`/`ImageGenerationTrace` 结构表明详细模式保留完整 messages、prompt、options、response、usage、错误和耗时。
- `packages/server/src/modules/ai/ai.service.ts`：`writeEditLog` 以及生成流程的最终日志写入会根据 `fileVerbosity` 分支：详细模式把 `llmCalls`（请求/响应）写入，简单模式只写 `llmCallCount` 和摘要字段。生成流程还会写 `plan`、`reference-parse` 等类型；`packages/server/src/modules/ai/postprocess/presentation.ts` 会写生成终局记录和 `finalize-deck` 结构化 deck 记录。
- `packages/ai/src/utils/logger.ts` 与 `packages/web/src/components/settings/LogSettings.tsx`：日志配置有 `consoleVerbosity` 与 `fileVerbosity` 两个独立开关；详细模式用于完整请求/响应排查，简单模式只输出/记录基本状态。详细日志可能包含演示内容，应谨慎分享。
- `packages/server/src/modules/audit/audit.service.ts`：审核结果通常落到当前演示目录的 `audit/latest-report.json`，截图在 `audit/screenshots/`；这不是 MCP HTTP 日志。
- `packages/server/src/modules/mcp/mcp-context.ts`：MCP 审计写入当前作用域 workspace 下的 `mcp-audit.jsonl`，字段包括 `keyId/tenantId/userKey/jobId/tool/status/presentationId/durationMs` 等。
- `packages/server/src/modules/mcp/generation-queue.ts`：队列为进程内 `Map<string, McpJob>`；job 的 args/result 不写文件，终态只按 TTL 保留。默认 TTL 和并发配置来自环境变量，默认 TTL 为 1 小时。

### 4. HTTP/MCP 报文是否落盘

已确认的落盘内容：

- AI 调用的详细 provider 报文：在 `ai-log.jsonl` 的详细模式记录中，包含 LLM request/response 及相关后处理数据；目标日志当前已读到 `reference-parse` 和 `plan` 类型的详细记录。
- 演示业务数据：`presentation.json`、`chat-history.json`、资源目录、可能的审核报告。
- MCP 业务审计摘要：`workspace/mcp-audit.jsonl`。

没有找到通用 HTTP access logger、Nest interceptor 或 `res.on('finish')` 类型的持久化实现。`packages/server/src/main.ts` 只开启 Nest 控制台 logger、JSON body parser、CORS、静态 `/data` 和端口监听；`packages/server/src/modules/mcp/mcp.controller.ts` 只在 MCP 处理异常时写一条 `Logger.error`，没有把原始 JSON-RPC 请求/响应写到文件。`mcp-audit.jsonl` 也不含原始 `params` 或响应全文。

另外，`main.ts` 的 `/data` 静态访问会拦截 `presentation.json`、`chat-history.json`、所有 `.jsonl`、`config.json`、`apikeys.json` 以及参考缓存目录；因此不能通过浏览器直接打开 `/data/.../presentation.json` 或 `/data/.../ai-log.jsonl`，应使用 REST API 或本机文件读取。资源图片/视频是允许静态访问的例外。

## Windows PowerShell 定位和查看命令

以下命令只读取当前已落盘数据，不会启动或重启服务。

### A. 直接定位目标目录和文件

```powershell
$id = 'pres_musb7z42_ls8yvjc'
$presDir = Join-Path 'D:\TraeSOLO\NoPPT\packages\server\data\tenants\default\users\default\workspace\presentations' $id

Test-Path -LiteralPath $presDir
Get-ChildItem -LiteralPath $presDir -Force
Get-ChildItem -LiteralPath $presDir -Recurse -File -Force |
  Select-Object FullName, Length, LastWriteTime
```

### B. 只读演示摘要，不把整份 HTML 打到终端

```powershell
$presentation = Get-Content -LiteralPath (Join-Path $presDir 'presentation.json') -Raw |
  ConvertFrom-Json

$presentation |
  Select-Object id, title, description, createdAt, updatedAt,
    @{Name='slideCount'; Expression={ @($_.slides).Count }}
```

### C. 查看 AI 日志的类型、时间和摘要

```powershell
$aiLog = Join-Path $presDir 'ai-log.jsonl'

Get-Content -LiteralPath $aiLog |
  Where-Object { $_.Trim() } |
  ForEach-Object { $_ | ConvertFrom-Json } |
  Select-Object id, timestamp, type, model, provider, duration, llmCallCount
```

查看某类日志的完整 JSON（详细模式文件可能很大）：

```powershell
Get-Content -LiteralPath $aiLog |
  Where-Object { $_ -match '"type":"(plan|generate-presentation|edit-slide|edit-element|edit-global|finalize-deck)"' } |
  ForEach-Object { $_ | ConvertFrom-Json | ConvertTo-Json -Depth 100 }
```

按关键词定位请求/响应或错误，不修改文件：

```powershell
Select-String -LiteralPath $aiLog -Pattern 'error|response|llmCalls|imageGenerationCalls|presentationId' -CaseSensitive:$false
```

### D. 查看 MCP 审计摘要

```powershell
$defaultAudit = 'D:\TraeSOLO\NoPPT\packages\server\data\tenants\default\users\default\workspace\mcp-audit.jsonl'
$hermesAudit  = 'D:\TraeSOLO\NoPPT\packages\server\data\tenants\hermes\users\local\workspace\mcp-audit.jsonl'

foreach ($file in @($defaultAudit, $hermesAudit)) {
  if (Test-Path -LiteralPath $file) {
    Write-Host "--- $file ---"
    Get-Content -LiteralPath $file |
      Where-Object { $_.Trim() } |
      ForEach-Object { $_ | ConvertFrom-Json } |
      Select-Object keyId, tenantId, userKey, jobId, tool, status, presentationId, startedAt, finishedAt, durationMs
  }
}
```

本次读取到的两个现有审计文件都没有该目标 ID；default/default 文件当前主要是 `prepare_outline_draft` 记录，hermes/local 文件有其他生成/草稿记录。审计文件不是完整请求记录，不能据此排除已被清理、未写审计或从 REST 入口生成的情况。

### E. 服务恢复后用同作用域 Key 查询 REST

当前 `3001` 不可达，以下命令是服务恢复后的查询方法。必须换成**能访问 `default/default` 作用域的 Key**；AGENTS.md 中的 `MCP_NOPPT_API_KEY` 是 `hermes/local` 作用域，按代码隔离规则不能用它读取本例的 `default/default` 演示。

```powershell
$id = 'pres_musb7z42_ls8yvjc'
$apiKey = $env:MCP_NOPPT_API_KEY  # 仅示例；必须确认它属于 default/default 作用域
$headers = @{ Authorization = "Bearer $apiKey"; Accept = 'application/json' }

Invoke-RestMethod `
  -Method Get `
  -Uri "http://localhost:3001/api/presentations/$id" `
  -Headers $headers

Invoke-RestMethod `
  -Method Get `
  -Uri "http://localhost:3001/api/logs/ai/$id" `
  -Headers $headers
```

若只想保留响应头和状态码，可用：

```powershell
curl.exe -i "http://localhost:3001/api/presentations/$id" `
  -H "Authorization: Bearer $apiKey" `
  -H 'Accept: application/json'

curl.exe -i "http://localhost:3001/api/logs/ai/$id" `
  -H "Authorization: Bearer $apiKey" `
  -H 'Accept: application/json'
```

若返回 401/403/“不属于当前作用域”，优先检查 Key 的 `tenantId/userKey`，不要把同一个 ID 直接换到另一个作用域目录。

### F. 使用仓库已有解包脚本查看详细 AI 报文

`D:\TraeSOLO\NoPPT\scripts\extract-ai-log.js` 支持按演示 ID 导出可读的 planning、LLM、slides、audit、reference-parse、deck 等文件。它默认只查旧的未作用域目录，因此本例必须覆盖 `NOPPT_PRES_DIR`：

```powershell
$id = 'pres_musb7z42_ls8yvjc'
$env:NOPPT_PRES_DIR = 'D:\TraeSOLO\NoPPT\packages\server\data\tenants\default\users\default\workspace\presentations'
node 'D:\TraeSOLO\NoPPT\scripts\extract-ai-log.js' $id `
  --out 'D:\TraeSOLO\NoPPT\scripts\output\pres_musb7z42_ls8yvjc-debug' `
  --only llm
```

其他可选值包括 `planning`、`slides`、`edit`、`audit`、`reference-parse`、`deck`。该脚本会写入/覆盖输出目录，不属于本次只读调查；需要保留只读状态时只查看原始 `ai-log.jsonl`，不要执行该导出命令。

### G. 查看前端 REST 报文

打开 `http://localhost:5173/editor/pres_musb7z42_ls8yvjc` 后按 F12：

1. **Network** 勾选 Preserve log，筛选 `presentations`、`chat`、`logs`、`ai`。
2. 点击 `GET .../api/presentations/pres_musb7z42_ls8yvjc`，查看 Headers、Payload、Response、Timing。
3. 同时查看 `GET .../api/presentations/<id>/chat`；编辑器首次加载会请求它。
4. 若从 Web UI 查看 AI 日志，关注 `GET .../api/logs/ai/<id>`；源码已有 `logsApi.getAILogs`，但当前仓库没有发现把该 API 绑定到一个独立日志查看页面的实现。
5. **Console** 查看 `Failed to load presentation`、`Failed to save presentation` 及服务端返回错误。

当前前端开发模式直连 3001（`packages/web/src/utils/api.ts`），所以即使 5173 的页面壳能打开，3001 停止时仍会加载失败。

### H. 查看未来服务端控制台日志（不应对当前停服状态执行）

源码没有配置服务端日志文件 sink；`main.ts` 启用 Nest `error/warn/log/debug/verbose`，AI 代码也使用 `console.log/warn/error`。服务启动的终端就是主要服务端日志来源。若下次明确需要把**未来**输出复制到文件，可在根目录启动时使用：

```powershell
Set-Location 'D:\TraeSOLO\NoPPT'
pnpm dev:server 2>&1 | Tee-Object -FilePath 'D:\TraeSOLO\NoPPT\server-console.log'
```

这会启动服务并创建一个新的捕获文件；本调查没有执行它，也没有重启服务。若服务已经由其他终端运行，应直接查看那个终端，而不是再启动第二个实例。

### I. 查看 MCP 原始请求/响应（实时获取，不是读取历史落盘）

MCP 端点是 `POST http://localhost:3001/api/mcp`，代码使用 stateless Streamable HTTP JSON-RPC。获取工具列表的最小示例：

```powershell
$apiKey = $env:MCP_NOPPT_API_KEY
$body = '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'

curl.exe -i -N -X POST 'http://localhost:3001/api/mcp' `
  -H "Authorization: Bearer $apiKey" `
  -H 'Content-Type: application/json' `
  --data-raw $body
```

若已有 `jobId`，轮询 MCP 作业：

```powershell
$body = '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"noppt_get_presentation","arguments":{"jobId":"<job_id>","wait":true}}}'

curl.exe -i -N -X POST 'http://localhost:3001/api/mcp' `
  -H "Authorization: Bearer $apiKey" `
  -H 'Content-Type: application/json' `
  --data-raw $body
```

如果要针对当前 ID 查看 MCP 导出结果而不是作业状态，可调用 `noppt_export_html`，但仍必须使用该 ID 所属作用域的 Key：

```powershell
$body = '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"noppt_export_html","arguments":{"presentationId":"pres_musb7z42_ls8yvjc"}}}'

curl.exe -i -N -X POST 'http://localhost:3001/api/mcp' `
  -H "Authorization: Bearer $apiKey" `
  -H 'Content-Type: application/json' `
  --data-raw $body
```

Hermes 调用的完整 MCP 报文应优先在 Hermes 会话/调试日志中查看；NoPPT 的 `mcp-audit.jsonl` 只能用于把工具调用和演示/job 做时间线关联。

## 结论和建议

- **现在要看这份演示**：直接打开目标目录下的 `presentation.json`，或在后端恢复且拿到 `default/default` Key 后调用 `GET /api/presentations/<id>`；不要直接请求 `/data/.../presentation.json`，因为 `main.ts` 明确禁止静态暴露演示 JSON。
- **现在要看 AI 过程**：先看目标目录的 `ai-log.jsonl`；需要可读拆分时使用 `extract-ai-log.js` 的 `NOPPT_PRES_DIR` 覆盖（该脚本会写输出，执行前应确认允许产生调试文件）。
- **要看前端请求**：使用浏览器 Network/Console；这比猜测 editor URL 是否已加载更可靠。
- **要看 MCP 请求/响应**：查看 Hermes 原始调用日志，或在服务运行期间用带 `-v/-i/-N` 的 `curl.exe` 复现；当前实现没有历史 MCP body 的持久化存档。
- **推荐的可维护性改进（本次不实现）**：增加可配置、默认脱敏的 HTTP/MCP access log（至少 request ID、方法、路径、状态、耗时、jobId/presentationId；禁止记录 Authorization/API key 和完整素材），并为 scoped data 增加只读诊断 CLI/API。若需保存完整报文，应采用显式 opt-in、大小上限和敏感字段脱敏，避免把模型 Key、用户素材或完整演示内容无界写入日志。

## 验证限制与调查边界

- 已执行的本机探测：`http://localhost:5173/editor/pres_musb7z42_ls8yvjc` 返回 HTTP 200；`http://localhost:3001/api/presentations/pres_musb7z42_ls8yvjc` 与 `http://localhost:3001/api/mcp` 当前不可达，且 3001/5173 当时没有可见的 Listen 结果。因此没有取得当前后端的实时 JSON 响应，也没有查看到当前进程 stdout。
- 已读取的磁盘状态：目标 `default/default` 演示目录及 `presentation.json`、`ai-log.jsonl`、`chat-history.json`；default/default 与 hermes/local 的 `mcp-audit.jsonl`。
- 没有修改应用源码、配置、运行时数据，没有启动/重启服务器，没有运行会向 `scripts/output` 写文件的解包命令。
- 运行时数据可能随服务后续生成、删除、TTL 清理或人工操作变化；因此“当前存在”和“源码通常如何保存”在本报告中已明确区分。
