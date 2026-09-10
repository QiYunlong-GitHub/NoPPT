import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, promises as fs } from 'fs';
import { join } from 'path';
import { readMcpEnv, resolveDraftSigningSecret } from '../../common/env';
import type { McpEnv } from '../../common/env';
import { sanitizeScopeSegment } from '../../common/storage.service';
import { truncateReferenceText } from './reference-input';

/**
 * 生成草稿（Draft）——「IM 拟题 + Web 确认生成」形态的载体（联调指南第 15 章）。
 *
 * 定位：Hermes 只**备料不生成**：把自拟的 topic / RAG 素材 / 风格参数存成草稿，
 * 拿回一条深链；用户点开后 Web 端凭签名 token 拉取草稿预填配置页，确认后才走原生流水线。
 *
 * 设计要点：
 * - 草稿落**服务器级** `data/drafts/<draftId>.json`，内部记录 `scope{tenant,user}`：
 *   写入方是 MCP 作用域（tenants 目录），读取方是 Web 主工作区，二者存储根不同；
 * - 读取必须携带 HMAC 签名 token 且 scope 与草稿内一致（用户拍板：严格绑定 + 签名，不做回环放行）；
 * - 素材按「页数 × 每页预算」分档裁剪，上限沿用 `NOPPT_MAX_REF_TEXT_CHARS`，前后端同一公式。
 */

export const DRAFT_ID_PREFIX = 'drf_';
/** 素材长度分档的下限（页数很少时也不至于把素材压得无法使用）。 */
export const REFERENCE_TEXT_MIN_CHARS = 3000;
/** 分档计算时未给出 slideCount 所采用的默认页数。 */
export const DEFAULT_SLIDE_COUNT = 8;
/** 单次过期清理最多删除的草稿数（避免启动/写入期 IO 抖动）。 */
const PURGE_MAX_DELETES = 200;

export type DraftStyle = 'business' | 'tech' | 'academic' | 'creative';
export type DraftColorTheme = 'blue' | 'purple' | 'green' | 'orange' | 'teal' | 'gray';
export type DraftFontFamily = 'sans' | 'serif' | 'mono';
export type DraftMode = 'auto' | 'guided';

/** 草稿承载的生成参数（字段对齐 `GeneratePresentationRequest` 的子集）。 */
export interface DraftParams {
  topic: string;
  referenceText?: string;
  style?: DraftStyle;
  audience?: string;
  slideCount?: number;
  colorTheme?: DraftColorTheme;
  fontFamily?: DraftFontFamily;
  iconStyle?: string;
  /** 预选生成模式（默认 `auto` 全自动，用户仍可在配置页改）。 */
  mode?: DraftMode;
}

export interface DraftScope {
  tenant: string;
  user: string;
}

export interface DraftMeta {
  /** 素材来源标识，如「企业知识库 / RAG」「对话上下文」，仅用于前端展示。 */
  source?: string;
  referenceTextChars: number;
  originalChars: number;
  limitApplied: number;
  truncated: boolean;
}

export interface DraftRecord {
  draftId: string;
  scope: DraftScope;
  params: DraftParams;
  meta: DraftMeta;
  createdAt: number;
  expiresAt: number;
}

/** 草稿目录：`packages/server/data/drafts`。 */
export function getDraftDir(): string {
  return join(process.cwd(), 'data', 'drafts');
}

function draftPath(draftId: string): string {
  return join(getDraftDir(), `${draftId}.json`);
}

/**
 * 素材长度上限：**按生成要求分档**——页数越多可承载的素材越长。
 * `limit = clamp(每页预算 × slideCount, 3000, NOPPT_MAX_REF_TEXT_CHARS)`。
 * 与前端 `packages/web/src/utils/referenceTextLimit.ts` 必须保持一致。
 */
export function referenceTextLimit(slideCount?: number, maxChars?: number): number {
  const env = readMcpEnv();
  const perSlide = env.draftCharsPerSlide > 0 ? env.draftCharsPerSlide : 800;
  const slides = Number.isFinite(slideCount) && (slideCount as number) > 0 ? (slideCount as number) : DEFAULT_SLIDE_COUNT;
  const ceiling = maxChars && maxChars > 0 ? maxChars : env.maxRefTextChars > 0 ? env.maxRefTextChars : 20000;
  const raw = perSlide * slides;
  return Math.min(Math.max(raw, REFERENCE_TEXT_MIN_CHARS), ceiling);
}

function newDraftId(): string {
  return `${DRAFT_ID_PREFIX}${randomBytes(16).toString('hex')}`;
}

// ————————————————————————— 签名 —————————————————————————

function tokenPayload(draftId: string, tenant: string, user: string, exp: number): string {
  return `${draftId}|${tenant}|${user}|${exp}`;
}

/** 生成草稿读取签名：`HMAC-SHA256(secret, draftId|tenant|user|expiresAt)`。 */
export function signDraftToken(draftId: string, tenant: string, user: string, exp: number, env: McpEnv = readMcpEnv()): string {
  return createHmac('sha256', resolveDraftSigningSecret(env))
    .update(tokenPayload(draftId, tenant, user, exp))
    .digest('hex');
}

/** 校验签名（定长比较，防时序侧信道）。任何异常都视为不通过。 */
export function verifyDraftToken(
  token: string,
  draftId: string,
  tenant: string,
  user: string,
  exp: number,
  env: McpEnv = readMcpEnv(),
): boolean {
  if (typeof token !== 'string' || !token) return false;
  const expected = signDraftToken(draftId, tenant, user, exp, env);
  const a = Buffer.from(expected, 'utf-8');
  const b = Buffer.from(token, 'utf-8');
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/** 深链：`${webUrl}/?ai=1&draft=<id>&t=<tenant>&u=<user>&token=<sig>`。 */
export function buildOpenUrl(rec: DraftRecord, env: McpEnv = readMcpEnv()): string {
  const token = signDraftToken(rec.draftId, rec.scope.tenant, rec.scope.user, rec.expiresAt, env);
  const query = new URLSearchParams({
    ai: '1',
    draft: rec.draftId,
    t: rec.scope.tenant,
    u: rec.scope.user,
    token,
  });
  return `${env.webUrl}/?${query.toString()}`;
}

// ————————————————————————— 存取 —————————————————————————

function normalizeParams(input: DraftParams): DraftParams {
  const params: DraftParams = { topic: String(input.topic || '').trim().slice(0, 500) };
  if (input.style) params.style = input.style;
  if (input.audience) params.audience = String(input.audience).slice(0, 200);
  if (Number.isFinite(input.slideCount)) {
    params.slideCount = Math.min(40, Math.max(1, Math.trunc(input.slideCount as number)));
  }
  if (input.colorTheme) params.colorTheme = input.colorTheme;
  if (input.fontFamily) params.fontFamily = input.fontFamily;
  if (input.iconStyle) params.iconStyle = String(input.iconStyle).slice(0, 50);
  params.mode = input.mode === 'guided' ? 'guided' : 'auto';
  return params;
}

/**
 * 创建草稿：**不触发 LLM、不生成演示**，仅落盘并返回深链所需信息。
 * @param input 生成参数（含 RAG 素材）
 * @param scope 作用域（来自 MCP Key / 身份头）
 * @param source 素材来源标识，仅用于前端展示
 */
export async function createDraft(input: DraftParams, scope: DraftScope, source?: string): Promise<DraftRecord> {
  const env = readMcpEnv();
  const params = normalizeParams(input);
  const limit = referenceTextLimit(params.slideCount, env.maxRefTextChars);
  const originalChars = typeof input.referenceText === 'string' ? input.referenceText.length : 0;
  const { referenceText, truncated } = truncateReferenceText(input.referenceText, limit);
  if (referenceText) params.referenceText = referenceText;

  const now = Date.now();
  const rec: DraftRecord = {
    draftId: newDraftId(),
    scope: {
      tenant: sanitizeScopeSegment(scope.tenant || 'default', 'tenant'),
      user: sanitizeScopeSegment(scope.user || 'default', 'userKey'),
    },
    params,
    meta: {
      source: source ? String(source).slice(0, 100) : undefined,
      referenceTextChars: referenceText?.length ?? 0,
      originalChars,
      limitApplied: limit,
      truncated,
    },
    createdAt: now,
    expiresAt: now + env.draftTtlMs,
  };

  const dir = getDraftDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  await fs.writeFile(draftPath(rec.draftId), JSON.stringify(rec, null, 2), 'utf-8');

  // 顺带做一次有上限的过期清理，避免目录无限增长（失败不影响主流程）。
  void purgeExpiredDrafts().catch(() => undefined);
  return rec;
}

/** 读取草稿；不存在或已过期返回 `null`（过期顺带删文件）。 */
export async function readDraft(draftId: string): Promise<DraftRecord | null> {
  if (typeof draftId !== 'string' || !draftId.startsWith(DRAFT_ID_PREFIX)) return null;
  // draftId 直接参与路径拼接：只允许 `drf_` + 16 进制，杜绝路径穿越。
  if (!/^drf_[a-f0-9]{32}$/.test(draftId)) return null;
  const file = draftPath(draftId);
  let rec: DraftRecord;
  try {
    if (!existsSync(file)) return null;
    rec = JSON.parse(readFileSync(file, 'utf-8')) as DraftRecord;
  } catch {
    return null;
  }
  if (!rec || typeof rec.expiresAt !== 'number') return null;
  if (rec.expiresAt <= Date.now()) {
    try {
      unlinkSync(file);
    } catch {
      /* 过期文件删除失败可忽略 */
    }
    return null;
  }
  return rec;
}

/** 判断是否过期（用于区分 E5007 与 E5008：先读原始记录再判定）。 */
export async function readDraftIncludingExpired(draftId: string): Promise<DraftRecord | null> {
  if (typeof draftId !== 'string' || !/^drf_[a-f0-9]{32}$/.test(draftId)) return null;
  const file = draftPath(draftId);
  try {
    if (!existsSync(file)) return null;
    return JSON.parse(readFileSync(file, 'utf-8')) as DraftRecord;
  } catch {
    return null;
  }
}

/** 清理过期草稿；返回删除条数。扫描与删除均有上限，失败静默。 */
export async function purgeExpiredDrafts(maxDeletes = PURGE_MAX_DELETES): Promise<number> {
  const dir = getDraftDir();
  if (!existsSync(dir)) return 0;
  let deleted = 0;
  try {
    for (const name of readdirSync(dir)) {
      if (deleted >= maxDeletes) break;
      if (!name.startsWith(DRAFT_ID_PREFIX) || !name.endsWith('.json')) continue;
      const file = join(dir, name);
      try {
        const rec = JSON.parse(readFileSync(file, 'utf-8')) as DraftRecord;
        if (typeof rec?.expiresAt === 'number' && rec.expiresAt <= Date.now()) {
          unlinkSync(file);
          deleted++;
        }
      } catch {
        /* 单个文件损坏不影响其余清理 */
      }
    }
  } catch {
    /* 目录读取失败：静默跳过 */
  }
  return deleted;
}

/** 脱敏后的草稿视图：供前端预填，绝不含签名密钥等内部字段。 */
export interface DraftPrefillView {
  draftId: string;
  topic: string;
  referenceText?: string;
  referenceSource?: string;
  referenceLimit: number;
  referenceTruncated: boolean;
  referenceOriginalChars: number;
  style?: string;
  audience?: string;
  slideCount?: number;
  colorTheme?: string;
  fontFamily?: string;
  iconStyle?: string;
  mode: DraftMode;
  expiresAt: number;
}

export function toPrefillView(rec: DraftRecord): DraftPrefillView {
  return {
    draftId: rec.draftId,
    topic: rec.params.topic,
    referenceText: rec.params.referenceText,
    referenceSource: rec.meta.source,
    referenceLimit: rec.meta.limitApplied,
    referenceTruncated: rec.meta.truncated,
    referenceOriginalChars: rec.meta.originalChars,
    style: rec.params.style,
    audience: rec.params.audience,
    slideCount: rec.params.slideCount,
    colorTheme: rec.params.colorTheme,
    fontFamily: rec.params.fontFamily,
    iconStyle: rec.params.iconStyle,
    mode: rec.params.mode ?? 'auto',
    expiresAt: rec.expiresAt,
  };
}
