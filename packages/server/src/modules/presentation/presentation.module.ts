import { Module } from '@nestjs/common';
import { PresentationController } from './presentation.controller';
import { PresentationIntegrityService } from './presentation-integrity.service';
import { PresentationService } from './presentation.service';
import { WorkspaceModule } from '../workspace/workspace.module';

@Module({
  imports: [WorkspaceModule],
  controllers: [PresentationController],
  providers: [PresentationIntegrityService, PresentationService],
  exports: [PresentationIntegrityService, PresentationService],
})
export class PresentationModule {}
