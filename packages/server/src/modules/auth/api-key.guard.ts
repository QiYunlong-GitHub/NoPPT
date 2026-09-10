import type { CanActivate, ExecutionContext} from '@nestjs/common';
import { Injectable, UnauthorizedException, createParamDecorator } from '@nestjs/common';
import type { Request } from 'express';
// ApiKeyService 必须是值导入：ApiKeyGuard 的构造注入依赖运行时类引用
import { ApiKeyService } from './api-key.service';
import type { ApiKeyRecord } from './api-key.service';
import { McpError, toMcpError } from '../../common/mcp-errors';
import { getRequestLocale } from '../../i18n/locale';

/** 认证通过后挂在 `req.auth` 上的调用方身份（规格 2.5.2）。 */
export interface McpAuth {
  keyId: string;
  tenantId: string;
  userKey: string;
  record: ApiKeyRecord;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: McpAuth;
    }
  }
}

/** 取 `Authorization: Bearer <key>`，缺失或格式不符返回 null。 */
export function extractBearer(req: Pick<Request, 'headers'> | { headers: Record<string, unknown> }): string | null {
  const raw = (req.headers as Record<string, unknown>)?.authorization;
  const header = Array.isArray(raw) ? raw[0] : raw;
  if (typeof header !== 'string' || !header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!m) return null;
  return m[1].trim() || null;
}

/**
 * 校验请求并构建 McpAuth。
 * @throws McpError E1001（缺头）/ E1002（无效）/ E1003（已禁用）
 */
export async function authenticateRequest(req: Pick<Request, 'headers'>, service: ApiKeyService): Promise<McpAuth> {
  const raw = extractBearer(req);
  if (!raw) {
    throw new McpError('E1001');
  }
  const record = service.locateByRawKeySync(raw);
  if (!record) {
    throw new McpError('E1002');
  }
  if (!record.enabled) {
    throw new McpError('E1003');
  }
  service.touchKey(record.id);
  return {
    keyId: record.id,
    tenantId: record.tenantId || 'default',
    userKey: record.userKey || 'default',
    record,
  };
}

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly apiKeyService: ApiKeyService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    try {
      req.auth = await authenticateRequest(req, this.apiKeyService);
      return true;
    } catch (e) {
      // E1xxx 一律 401；错误体为结构化 JSON，不含堆栈
      throw new UnauthorizedException(toMcpError(e).toBody(getRequestLocale(req)));
    }
  }
}

/** 在控制器参数上取 `req.auth`。 */
export const CurrentAuth = createParamDecorator((_data: unknown, ctx: ExecutionContext): McpAuth | undefined => {
  const req = ctx.switchToHttp().getRequest<Request>();
  return req.auth;
});
