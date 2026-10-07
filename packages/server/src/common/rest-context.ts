import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { existsSync } from 'fs';
import { join } from 'path';
import type { McpAuth } from '../modules/auth/api-key.guard';
import { createScopedStorage, getStorageService, sanitizeScopeSegment } from './storage.service';
import type { StorageService } from './storage.service';
import { LogsService } from '../modules/logs/logs.service';
import { ConfigService } from '../modules/config/config.service';
import { AuditService } from '../modules/audit/audit.service';
import { AiService } from '../modules/ai/ai.service';
import { PresentationService } from '../modules/presentation/presentation.service';
import { AssetsService } from '../modules/assets/assets.service';
import { WorkspaceService } from '../modules/workspace/workspace.service';

export interface RestContext {
  tenantId: string;
  userKey: string;
  storage: StorageService;
  workspaceService: WorkspaceService;
  presentationService: PresentationService;
  assetsService: AssetsService;
  logsService: LogsService;
  /** Server-global configuration; workspace data remains scoped. */
  configService: ConfigService;
  auditService: AuditService;
  aiService: AiService;
  dispose: () => Promise<void>;
}

export function resolveRestIdentity(auth: McpAuth | undefined): {
  tenantId: string;
  userKey: string;
} {
  if (!auth) throw new UnauthorizedException('Authentication required');
  return {
    tenantId: sanitizeScopeSegment(auth.tenantId || 'default', 'tenantId'),
    userKey: sanitizeScopeSegment(auth.userKey || 'default', 'userKey'),
  };
}

/**
 * Keep the existing default/default workspace readable during migration only.
 * No other tenant/user can fall back to the legacy unscoped root.
 */
export function createRestStorage(auth: McpAuth | undefined): StorageService {
  const { tenantId, userKey } = resolveRestIdentity(auth);
  const legacy = getStorageService();
  if (tenantId === 'default' && userKey === 'default') {
    const legacyPresentations = join(legacy.getWorkspaceDir(), 'presentations');
    const scopedPresentations = join(
      legacy.getBaseDir(),
      'tenants',
      'default',
      'users',
      'default',
      'workspace',
      'presentations',
    );
    if (existsSync(legacyPresentations) && !existsSync(scopedPresentations)) return legacy;
  }
  return createScopedStorage('tenants', tenantId, 'users', userKey);
}

export function buildRestContext(auth: McpAuth | undefined): RestContext {
  const { tenantId, userKey } = resolveRestIdentity(auth);
  const storage = createRestStorage(auth);
  const globalStorage = getStorageService();
  const logsService = new LogsService(storage);
  const configService = new ConfigService(globalStorage);
  const auditService = new AuditService(storage, configService, logsService);
  const aiService = new AiService(storage, logsService, auditService, configService);
  const dispose = async (): Promise<void> => {
    await auditService.destroy();
  };
  return {
    tenantId,
    userKey,
    storage,
    workspaceService: new WorkspaceService(storage),
    presentationService: new PresentationService(storage),
    assetsService: new AssetsService(storage),
    logsService,
    configService,
    auditService,
    aiService,
    dispose,
  };
}

export async function withRestContext<T>(
  auth: McpAuth | undefined,
  run: (context: RestContext) => Promise<T> | T,
): Promise<T> {
  const context = buildRestContext(auth);
  try {
    return await run(context);
  } finally {
    await context.dispose();
  }
}

export function assertDefaultRestConfig(auth: McpAuth | undefined): void {
  const { tenantId, userKey } = resolveRestIdentity(auth);
  if (tenantId !== 'default' || userKey !== 'default') {
    throw new ForbiddenException('Global configuration is restricted to the default owner');
  }
}
