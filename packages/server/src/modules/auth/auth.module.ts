import type { OnModuleInit } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { ApiKeyService } from './api-key.service';
import { ApiKeyGuard } from './api-key.guard';
import { KeysController } from './keys.controller';
import { RateLimitService } from './rate-limit.service';
import { envStr } from '../../common/env';

@Module({
  controllers: [KeysController],
  providers: [ApiKeyService, ApiKeyGuard, RateLimitService],
  exports: [ApiKeyService, ApiKeyGuard, RateLimitService],
})
export class AuthModule implements OnModuleInit {
  constructor(private readonly apiKeyService: ApiKeyService) {}

  /** 启动引导：设置 NOPPT_DEV_KEY 时确保存在名为 dev 的 Key（联调用）。 */
  async onModuleInit(): Promise<void> {
    const dev = envStr('NOPPT_DEV_KEY');
    if (!dev) return;
    try {
      await this.apiKeyService.ensureDevKey(dev);
    } catch (e) {
      // 引导失败不阻断启动
      console.error('[AuthModule] dev key 引导失败：', e instanceof Error ? e.message : e);
    }
  }
}
