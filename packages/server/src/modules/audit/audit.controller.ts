import { Controller, Get, Post, Param, Res, Body, NotFoundException } from '@nestjs/common';
import type { Response } from 'express';
import { existsSync } from 'fs';
import type { PresentationPlan } from '@noppt/ai';
import { AuditService } from './audit.service';

@Controller('api/audit')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Post('presentation/:id')
  async auditPresentation(
    @Param('id') id: string,
    @Body() body?: { plan?: PresentationPlan; engines?: Record<string, boolean> },
  ) {
    return this.auditService.auditPresentation(id, {
      plan: body?.plan,
      engines: body?.engines,
    });
  }

  @Get('presentation/:id/report')
  getReport(@Param('id') id: string) {
    const report = this.auditService.getReport(id);
    if (!report) {
      throw new NotFoundException('尚未生成审核报告');
    }
    return report;
  }

  @Get('presentation/:id/screenshot/:slideIndex')
  getScreenshot(
    @Param('id') id: string,
    @Param('slideIndex') slideIndex: string,
    @Res() res: Response,
  ) {
    const index = parseInt(slideIndex, 10);
    if (Number.isNaN(index)) {
      throw new NotFoundException('无效的幻灯片索引');
    }
    const path = this.auditService.getScreenshotPath(id, index);
    if (!path || !existsSync(path)) {
      throw new NotFoundException('截图不存在');
    }
    res.sendFile(path);
  }
}
