import { Module } from '@nestjs/common';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';
import { WorkspaceModule } from '../workspace/workspace.module';
import { ConfigModule } from '../config/config.module';
import { LogsModule } from '../logs/logs.module';

@Module({
  imports: [WorkspaceModule, ConfigModule, LogsModule],
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
