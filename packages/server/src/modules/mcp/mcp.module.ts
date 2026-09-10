import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { McpController } from './mcp.controller';
import { DraftController } from './draft.controller';
import { GenerationQueue } from './generation-queue';

@Module({
  imports: [AuthModule],
  controllers: [McpController, DraftController],
  providers: [
    // 工厂提供：GenerationQueue 构造函数带可选 options 对象，
    // 走类提供者时 Nest 会按 design:paramtypes 尝试注入 `Object` 而报错。
    { provide: GenerationQueue, useFactory: (): GenerationQueue => new GenerationQueue() },
  ],
  exports: [GenerationQueue],
})
export class McpModule {}
