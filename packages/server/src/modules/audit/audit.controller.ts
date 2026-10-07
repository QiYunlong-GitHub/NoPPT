import { Body, Controller, Get, NotFoundException, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { existsSync } from 'fs';
import type { PresentationPlan } from '@noppt/ai';
import type { McpAuth } from '../auth/api-key.guard';
import { CurrentAuth } from '../auth/api-key.guard';
import { withRestContext } from '../../common/rest-context';

@Controller('audit')
export class AuditController {
  @Post('presentation/:id')
  auditPresentation(
    @Param('id') id: string,
    @Body() body: { plan?: PresentationPlan; engines?: Record<string, boolean> } | undefined,
    @CurrentAuth() auth?: McpAuth,
  ) {
    return withRestContext(auth, ({ auditService }) =>
      auditService.auditPresentation(id, { plan: body?.plan, engines: body?.engines }),
    );
  }

  @Get('presentation/:id/report')
  async getReport(@Param('id') id: string, @CurrentAuth() auth?: McpAuth) {
    const report = await withRestContext(auth, ({ auditService }) => auditService.getReport(id));
    if (!report) throw new NotFoundException('尚未生成审核报告');
    return report;
  }

  @Get('presentation/:id/screenshot/:slideIndex')
  async getScreenshot(
    @Param('id') id: string,
    @Param('slideIndex') slideIndex: string,
    @Res() res: Response,
    @CurrentAuth() auth?: McpAuth,
  ): Promise<void> {
    const index = Number.parseInt(slideIndex, 10);
    if (Number.isNaN(index)) throw new NotFoundException('无效的幻灯片索引');
    const screenshotPath = await withRestContext(auth, ({ auditService }) =>
      auditService.getScreenshotPath(id, index),
    );
    if (!screenshotPath || !existsSync(screenshotPath)) {
      throw new NotFoundException('截图不存在');
    }
    res.sendFile(screenshotPath);
  }
}
