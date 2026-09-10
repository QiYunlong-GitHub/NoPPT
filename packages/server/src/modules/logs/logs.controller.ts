import { Controller, Get, Param } from '@nestjs/common';
import { LogsService, AILogEntry } from './logs.service';
import { getStorageService } from '../../common/storage.service';

@Controller('logs')
export class LogsController {
  private readonly logsService: LogsService;

  constructor() {
    this.logsService = new LogsService(getStorageService());
  }

  @Get('ai/:presentationId')
  getAILogs(@Param('presentationId') presentationId: string): AILogEntry[] {
    return this.logsService.getAILogs(presentationId);
  }
}
