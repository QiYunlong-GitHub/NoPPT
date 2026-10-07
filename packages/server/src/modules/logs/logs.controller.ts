import { Controller, Get, Param } from '@nestjs/common';
import type { McpAuth } from '../auth/api-key.guard';
import { CurrentAuth } from '../auth/api-key.guard';
import { withRestContext } from '../../common/rest-context';
import type { AILogEntry } from './logs.service';

@Controller('logs')
export class LogsController {
  @Get('ai/:presentationId')
  async getAILogs(
    @Param('presentationId') presentationId: string,
    @CurrentAuth() auth?: McpAuth,
  ): Promise<AILogEntry[]> {
    return withRestContext(auth, ({ logsService }) => logsService.getAILogs(presentationId));
  }
}
