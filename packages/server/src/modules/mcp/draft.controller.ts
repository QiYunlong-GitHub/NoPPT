import { Controller, Get, Param, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { sanitizeScopeSegment } from '../../common/storage.service';
import { McpError } from '../../common/mcp-errors';
import { readDraft, readDraftIncludingExpired, toPrefillView, verifyDraftToken } from './draft-store';
import type { DraftPrefillView } from './draft-store';
import { getRequestLocale, translate } from '../../i18n/locale';

/**
 * 生成草稿读取：`GET /api/drafts/:draftId?tenant=&user=&token=`
 *
 * 「IM 拟题 + Web 确认生成」形态的读侧（联调指南第 15 章）：
 * Hermes 通过 MCP 工具 `noppt_prepare_outline_draft` 存草稿 → 用户点开深链 →
 * Web 端凭 **签名 token** 拉取草稿预填「AI 生成演示」配置页，确认后才生成。
 *
 * 安全（用户拍板：严格绑定 tenant/user + 签名 token，不做回环放行）：
 * - `draftId` / `tenant` / `user` 先过作用域白名单，非法即 400；
 * - token 必须与 `HMAC(secret, draftId|tenant|user|expiresAt)` 一致（定长比较）；
 * - 草稿内记录的 scope 必须与请求 scope 一致，否则 `forbidden_scope`；
 * - 过期返回 `draft_expired`，不存在返回 `draft_not_found`。
 *
 * 响应一律手写（不用 Nest 异常过滤器）：错误体只含 `error` / `message`，**不回传堆栈**。
 */
@Controller('drafts')
export class DraftController {
  @Get(':draftId')
  async get(
    @Param('draftId') draftId: string,
    @Query('tenant') tenant: string,
    @Query('user') user: string,
    @Query('token') token: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const locale = getRequestLocale(req);
    const deny = (status: number, error: string, message: string): void => {
      res.status(status).json({ error, message: translate(message, locale) });
    };

    let safeTenant: string;
    let safeUser: string;
    try {
      safeTenant = sanitizeScopeSegment(tenant, 'tenant');
      safeUser = sanitizeScopeSegment(user, 'userKey');
    } catch (e) {
      const body = e instanceof McpError ? e.toBody(locale) : { error: 'invalid_scope', message: '参数非法' };
      deny(400, body.error, body.message);
      return;
    }

    // 先做「存在 + 过期」判定（不含签名），以便给出可读的过期提示
    const existing = await readDraftIncludingExpired(draftId);
    if (!existing) {
      deny(404, 'draft_not_found', '草稿不存在或已被清理，请让助手重新生成一条链接');
      return;
    }
    if (existing.expiresAt <= Date.now()) {
      deny(410, 'draft_expired', '草稿已过期，请让助手重新生成一条链接');
      return;
    }

    // 作用域必须一致：防止拿到 draftId 后换 scope 读取他人的草稿
    if (existing.scope.tenant !== safeTenant || existing.scope.user !== safeUser) {
      deny(403, 'forbidden_scope', '草稿不属于当前作用域');
      return;
    }

    if (!verifyDraftToken(token, existing.draftId, safeTenant, safeUser, existing.expiresAt)) {
      deny(403, 'forbidden', '草稿访问令牌无效');
      return;
    }

    const rec = await readDraft(draftId);
    if (!rec) {
      deny(404, 'draft_not_found', '草稿不存在或已被清理，请让助手重新生成一条链接');
      return;
    }

    const view: DraftPrefillView = toPrefillView(rec);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(view);
  }
}
