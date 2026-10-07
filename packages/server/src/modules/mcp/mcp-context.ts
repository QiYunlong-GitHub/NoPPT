import { join } from 'path';
import type { StorageService } from '../../common/storage.service';
import {
  createScopedStorage,
  getStorageService,
  sanitizeScopeSegment,
} from '../../common/storage.service';
import { readMcpEnv } from '../../common/env';
import type { McpAuth } from '../auth/api-key.guard';
import { LogsService } from '../logs/logs.service';
import { ConfigService } from '../config/config.service';
import { AuditService } from '../audit/audit.service';
import { AiService } from '../ai/ai.service';
import { PresentationService } from '../presentation/presentation.service';

/**
 * MCP 每请求作用域上下文（规格 2.5.4）。
 *
 * 隔离策略：**不复制业务逻辑**，而是给全部业务 Service 注入 scoped `StorageService`，
 * 由目录天然隔离（不同 tenant/user 的 presentationId 互不可见）。
 * 构造方式与既有 `ai.controller.ts:27-33` 保持一致（手工 new，不走 Nest DI）。
 */

export interface McpAuditEntry {
  keyId: string;
  tenantId?: string;
  userKey: string;
  jobId: string;
  tool: string;
  startedAt: number;
  finishedAt?: number;
  durationMs?: number;
  status?: string;
  presentationId?: string;
  referenceTextChars?: number;
  hasReferenceHtml?: boolean;
  hasReferenceImage?: boolean;
  truncated?: boolean;
  sourceCount?: number;
  [key: string]: unknown;
}

export interface McpContext {
  keyId: string;
  tenantId: string;
  userKey: string;
  storage: StorageService;
  aiService: AiService;
  presentationService: PresentationService;
  configService: ConfigService;
  /** 审计落盘（作用域内 `workspace/mcp-audit.jsonl`） */
  audit: (entry: McpAuditEntry) => Promise<void>;
  /**
   * Acquire an ownership token for work that may outlive the request. Each
   * returned release function is idempotent and disposal starts only after all
   * owners have released the context.
   */
  acquire: () => () => Promise<void>;
  /** Release the request owner; safe to call repeatedly from close/error paths. */
  release: () => Promise<void>;
  /** Idempotent request-owner disposer (kept separate from job ownership). */
  dispose: () => Promise<void>;
  /** 只读预览基址：`{webUrl}/mcp-preview/{tenant}/{user}` */
  previewBase: string;
}

/**
 * 解析用户身份（规格 2.4.1）：
 * `identity_header` 请求头值 > API Key 记录 userKey > `default`，并过 sanitize 白名单。
 */
export function resolveUserKey(headers: Record<string, unknown>, recordUserKey?: string): string {
  const headerName = readMcpEnv().identityHeader;
  const raw = headers?.[headerName] ?? headers?.[headerName.toLowerCase()];
  const value = Array.isArray(raw) ? raw[0] : raw;
  const candidate =
    typeof value === 'string' && value.trim() ? value.trim() : recordUserKey || 'default';
  return sanitizeScopeSegment(candidate, 'userKey');
}

export interface McpContextOwnership {
  acquire: () => () => Promise<void>;
  release: () => Promise<void>;
  dispose: () => Promise<void>;
}

/** Shared ownership primitive for request-scoped resources and queued work. */
export function createMcpContextOwnership(destroy: () => Promise<void>): McpContextOwnership {
  let nextOwner = 1;
  const owners = new Set<number>([0]);
  let disposePromise: Promise<void> | null = null;

  const releaseOwner = async (owner: number): Promise<void> => {
    if (!owners.delete(owner) || owners.size > 0) return;
    if (!disposePromise) disposePromise = destroy();
    await disposePromise;
  };
  const acquire = (): (() => Promise<void>) => {
    if (owners.size === 0) throw new Error('MCP context has already been disposed');
    const owner = nextOwner++;
    owners.add(owner);
    let released = false;
    return async () => {
      if (released) return;
      released = true;
      await releaseOwner(owner);
    };
  };
  const dispose = (): Promise<void> => releaseOwner(0);
  return { acquire, release: dispose, dispose };
}

export function buildMcpContext(auth: McpAuth, headers: Record<string, unknown>): McpContext {
  const tenantId = sanitizeScopeSegment(auth.tenantId || 'default', 'tenantId');
  const userKey = resolveUserKey(headers, auth.record?.userKey);

  const storage = createScopedStorage('tenants', tenantId, 'users', userKey);
  const logsService = new LogsService(storage);
  // ConfigService 的 configPath 固定为 `data/config.json`（服务器级模型配置），
  // 不随作用域变化——符合规格 2.4.3「config.json 不随用户隔离」。
  const configService = new ConfigService(getStorageService());
  const auditService = new AuditService(storage, configService, logsService);
  const aiService = new AiService(storage, logsService, auditService, configService);
  const presentationService = new PresentationService(storage);

  const auditPath = join(storage.getWorkspaceDir(), 'mcp-audit.jsonl');
  const audit = async (entry: McpAuditEntry): Promise<void> => {
    try {
      await storage.appendToLogFile(auditPath, entry);
    } catch {
      /* 审计失败绝不影响主流程 */
    }
  };

  const webUrl = readMcpEnv().webUrl;
  const ownership = createMcpContextOwnership(() => auditService.destroy());

  return {
    keyId: auth.keyId,
    tenantId,
    userKey,
    storage,
    aiService,
    presentationService,
    configService,
    audit,
    ...ownership,
    previewBase: `${webUrl}/mcp-preview/${tenantId}/${userKey}`,
  };
}
