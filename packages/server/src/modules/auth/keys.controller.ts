import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Headers,
  Param,
  Post,
  ServiceUnavailableException,
  UnauthorizedException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
// ApiKeyService 必须是值导入：KeysController 的构造注入依赖运行时类引用
import { ApiKeyService } from './api-key.service';
import type { ApiKeyRecord, CreateKeyInput, PublicApiKeyRecord } from './api-key.service';
import { envStr } from '../../common/env';
import { getConfigLocale, translate } from '../../i18n/locale';

/**
 * API Key 管理接口（规格 3.1 / UC-1）。
 * 全部受 `x-admin-key` 头保护，值取自环境变量 `NOPPT_ADMIN_KEY`。
 */
@Controller('keys')
export class KeysController {
  constructor(private readonly apiKeyService: ApiKeyService) {}

  private assertAdmin(adminKey?: string): void {
    const locale = getConfigLocale();
    const expected = envStr('NOPPT_ADMIN_KEY');
    if (!expected) {
      // 未配置管理密钥时返回 503 而非放行，避免"配置缺失 = 不设防"
      throw new ServiceUnavailableException({
        error: 'admin_key_not_configured',
        message: translate('未配置 NOPPT_ADMIN_KEY，管理接口不可用', locale),
      });
    }
    if (!adminKey) {
      throw new UnauthorizedException({
        error: 'missing_admin_key',
        message: translate('缺少 x-admin-key 请求头', locale),
      });
    }
    if (adminKey !== expected) {
      throw new ForbiddenException({
        error: 'admin_key_mismatch',
        message: translate('x-admin-key 不匹配', locale),
      });
    }
  }

  @Get()
  list(@Headers('x-admin-key') adminKey?: string): PublicApiKeyRecord[] {
    this.assertAdmin(adminKey);
    return this.apiKeyService.listKeys();
  }

  @Post()
  async create(
    @Headers('x-admin-key') adminKey: string | undefined,
    @Body() body: CreateKeyInput,
  ): Promise<{ key: string; record: PublicApiKeyRecord }> {
    this.assertAdmin(adminKey);
    if (!body || !String(body.name || '').trim()) {
      throw new BadRequestException({
        error: 'invalid_argument',
        message: translate('name 必填', getConfigLocale()),
        field: 'name',
      });
    }
    const rateLimit = this.normalizeRateLimit(body.rateLimit);
    return this.apiKeyService.createKey({ ...body, rateLimit });
  }

  @Delete(':id')
  async revoke(
    @Headers('x-admin-key') adminKey: string | undefined,
    @Param('id') id: string,
  ): Promise<{ success: boolean }> {
    this.assertAdmin(adminKey);
    const ok = await this.apiKeyService.revokeKey(id);
    if (!ok) {
      throw new NotFoundException({
        error: 'presentation_not_found',
        message: translate('API Key {id} 不存在', getConfigLocale(), { id }),
      });
    }
    return { success: true };
  }

  private normalizeRateLimit(
    input: ApiKeyRecord['rateLimit'],
  ): ApiKeyRecord['rateLimit'] | undefined {
    if (!input) return undefined;
    const out: ApiKeyRecord['rateLimit'] = {};
    for (const bucket of ['generate', 'edit'] as const) {
      const cfg = input[bucket];
      if (!cfg) continue;
      const limit = Number(cfg.limit);
      const windowMs = Number(cfg.windowMs);
      if (!Number.isFinite(limit) || limit <= 0) continue;
      out[bucket] = {
        limit: Math.floor(limit),
        windowMs: Number.isFinite(windowMs) && windowMs > 0 ? Math.floor(windowMs) : 60000,
      };
    }
    return Object.keys(out).length ? out : undefined;
  }
}
