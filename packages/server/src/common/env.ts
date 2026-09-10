import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * 环境变量读取（规格附录 A）+ `data/server.env` 免系统级设置（NFR-9，Windows 友好）。
 *
 * 约定：
 * - `data/server.env` 每行 `KEY=VALUE`，`#` 开头为注释，空行忽略；
 * - **已存在的系统环境变量优先**，文件只做兜底填充（便于 CI/容器覆盖）；
 * - 相对路径基准为服务进程 cwd（即 `packages/server`）。
 */

let serverEnvLoaded = false;

/** 加载 `data/server.env`（可重复调用，只生效一次）。缺失文件静默跳过。 */
export function loadServerEnvFile(cwd: string = process.cwd()): void {
  if (serverEnvLoaded) return;
  serverEnvLoaded = true;
  try {
    const file = join(cwd, 'data', 'server.env');
    if (!existsSync(file)) return;
    const content = readFileSync(file, 'utf-8');
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
        (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
      ) {
        value = value.slice(1, -1);
      }
      if (!key || process.env[key] !== undefined) continue;
      process.env[key] = value;
    }
  } catch {
    /* env 文件为可选能力，任何读取失败都不应阻断启动 */
  }
}

export function envStr(key: string, fallback = ''): string {
  const v = process.env[key];
  return v === undefined || v === '' ? fallback : v;
}

export function envInt(key: string, fallback: number): number {
  const v = process.env[key];
  if (v === undefined || v === '') return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

export function envBool(key: string, fallback = false): boolean {
  const v = process.env[key];
  if (v === undefined || v === '') return fallback;
  return /^(1|true|yes|on)$/i.test(v.trim());
}

/** 只读快照，便于日志/审计引用与测试断言。 */
export interface McpEnv {
  adminKey: string;
  devKey: string;
  identityHeader: string;
  maxConcurrent: number;
  rateLimitGenerate: number;
  rateLimitEdit: number;
  rateLimitWindowMs: number;
  mcpViewToken: string;
  maxRefTextChars: number;
  maxRefImageBytes: number;
  webUrl: string;
  jobTtlMs: number;
  jobMax: number;
  /** 生成草稿（Hermes 预填深链）HMAC 签名密钥；未配置时回退见 `resolveDraftSigningSecret`。 */
  draftSigningSecret: string;
  /** 草稿有效期（毫秒），默认 24h。 */
  draftTtlMs: number;
  /** 素材长度分档：每页预算字符数（乘以页数，再受上下限约束）。 */
  draftCharsPerSlide: number;
}

export function readMcpEnv(): McpEnv {
  return {
    adminKey: envStr('NOPPT_ADMIN_KEY'),
    devKey: envStr('NOPPT_DEV_KEY'),
    identityHeader: envStr('NOPPT_IDENTITY_HEADER', 'x-user-id').toLowerCase(),
    maxConcurrent: Math.max(1, envInt('NOPPT_MAX_CONCURRENT', 2)),
    rateLimitGenerate: Math.max(1, envInt('NOPPT_RATE_LIMIT_GENERATE', 10)),
    rateLimitEdit: Math.max(1, envInt('NOPPT_RATE_LIMIT_EDIT', 10)),
    rateLimitWindowMs: Math.max(1000, envInt('NOPPT_RATE_LIMIT_WINDOW_MS', 60000)),
    mcpViewToken: envStr('NOPPT_MCP_VIEW_TOKEN'),
    maxRefTextChars: Math.max(0, envInt('NOPPT_MAX_REF_TEXT_CHARS', 20000)),
    maxRefImageBytes: Math.max(0, envInt('NOPPT_MAX_REF_IMAGE_BYTES', 5242880)),
    webUrl: envStr('NOPPT_WEB_URL', 'http://localhost:5173').replace(/\/+$/, ''),
    jobTtlMs: Math.max(1000, envInt('NOPPT_JOB_TTL_MS', 3600000)),
    jobMax: Math.max(10, envInt('NOPPT_JOB_MAX', 1000)),
    draftSigningSecret: envStr('NOPPT_DRAFT_SIGNING_SECRET'),
    draftTtlMs: Math.max(60_000, envInt('NOPPT_DRAFT_TTL_MS', 24 * 60 * 60 * 1000)),
    draftCharsPerSlide: Math.max(0, envInt('NOPPT_DRAFT_CHARS_PER_SLIDE', 800)),
  };
}

/**
 * 草稿签名密钥回退链：`NOPPT_DRAFT_SIGNING_SECRET` → `NOPPT_ADMIN_KEY` → `NOPPT_DEV_KEY` → 内置兜底。
 *
 * 前三者都缺失（本机最小联调）时用内置兜底值并打印一次告警；
 * 生产/跨机部署必须显式配置 `NOPPT_DRAFT_SIGNING_SECRET`，否则深链 token 可被预测。
 */
export function resolveDraftSigningSecret(env: McpEnv = readMcpEnv()): string {
  const secret = env.draftSigningSecret || env.adminKey || env.devKey;
  if (secret) return secret;
  if (!warnedDraftSecret) {
    warnedDraftSecret = true;
    console.warn(
      '[DraftStore] 未配置 NOPPT_DRAFT_SIGNING_SECRET，已回退内置兜底密钥；跨机/多用户部署请显式配置该变量。',
    );
  }
  return 'noppt-local-draft-secret';
}

let warnedDraftSecret = false;
