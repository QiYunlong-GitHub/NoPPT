import { BadRequestException, Controller, Get, NotFoundException, Param, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { createScopedStorage, sanitizeScopeSegment } from '../../common/storage.service';
import { PresentationService } from '../presentation/presentation.service';
import { buildSelfContainedDeck } from './deck-builder';
import { checkViewAccess } from './view.guard';
import { McpError } from '../../common/mcp-errors';
import { getRequestLocale } from '../../i18n/locale';

/**
 * 只读预览（规格 2.5.7 / 3.4）：`GET /api/mcp-view/:tenantId/:userKey/:presentationId`
 *
 * - **不走 ApiKeyGuard**（Web 无 Key），走独立 ViewGuard（默认本机 / 可选 token）；
 * - 参数先 sanitize 再落文件系统，非法即 400，不做任何磁盘读取；
 * - 复用 `noppt_export_html` 同一条 deck 组装链（逐页 sanitize + 资源内联）。
 */
@Controller('mcp-view')
export class McpViewController {
  @Get(':tenantId/:userKey/:presentationId')
  async view(
    @Param('tenantId') tenantId: string,
    @Param('userKey') userKey: string,
    @Param('presentationId') presentationId: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const guard = checkViewAccess(req);
    if (!guard.ok) {
      res.status(guard.status).json(guard.body);
      return;
    }

    let safeTenant: string;
    let safeUser: string;
    let safeId: string;
    try {
      safeTenant = sanitizeScopeSegment(tenantId, 'tenantId');
      safeUser = sanitizeScopeSegment(userKey, 'userKey');
      // presentationId 为 uuid，但同样过白名单，杜绝 `..` / 斜杠穿越
      safeId = sanitizeScopeSegment(presentationId, 'presentationId');
    } catch (e) {
      throw new BadRequestException(
        e instanceof McpError ? e.toBody(getRequestLocale(req)) : { error: 'invalid_scope', message: '参数非法' },
      );
    }

    const storage = createScopedStorage('tenants', safeTenant, 'users', safeUser);
    const presentationService = new PresentationService(storage);
    const presentation = await presentationService.get(safeId);
    if (!presentation) {
      throw new NotFoundException('产物不存在或不属于该作用域');
    }

    const deck = await buildSelfContainedDeck(presentation, storage, getRequestLocale(req));
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.send(deck.html);
  }
}
