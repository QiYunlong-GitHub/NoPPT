import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { WorkspaceModule } from '../workspace/workspace.module';
import { PresentationModule } from '../presentation/presentation.module';
import { LogsModule } from '../logs/logs.module';
import { AuditModule } from '../audit/audit.module';
import { ConfigModule } from '../config/config.module';

@Module({
  imports: [WorkspaceModule, PresentationModule, LogsModule, AuditModule, ConfigModule],
  controllers: [AiController],
  providers: [AiService],
  exports: [AiService],
})
export class AiModule {}
