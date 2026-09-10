import { Module } from '@nestjs/common';
import { WorkspaceModule } from './modules/workspace/workspace.module';
import { PresentationModule } from './modules/presentation/presentation.module';
import { AiModule } from './modules/ai/ai.module';
import { AssetsModule } from './modules/assets/assets.module';
import { LogsModule } from './modules/logs/logs.module';
import { ConfigModule } from './modules/config/config.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { McpModule } from './modules/mcp/mcp.module';
import { McpViewModule } from './modules/mcp/mcp-view.module';

@Module({
  imports: [
    WorkspaceModule,
    PresentationModule,
    LogsModule,
    AssetsModule,
    AiModule,
    ConfigModule,
    AuditModule,
    // MCP：认证 / 限流 / 隔离 / 8 工具（M2–M4 + 草稿备料 noppt_prepare_outline_draft）
    AuthModule,
    McpModule,
    // M7：Web 只读预览
    McpViewModule,
  ],
})
export class AppModule {}
