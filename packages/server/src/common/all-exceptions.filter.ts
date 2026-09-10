import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { getRequestLocale, translate } from '../i18n/locale';
import { isMcpError } from './mcp-errors';

/**
 * 全局异常过滤器。
 * - McpError：按请求语言渲染 `toBody().message`。
 * - HttpException：提取其 payload 中的 message（可能是对象），按当前语言本地化。
 * - 生产环境剔除 stack，避免泄漏内部信息。
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const locale = getRequestLocale(req);

    const status = exception instanceof HttpException ? exception.getStatus() : 500;

    let message: string;
    if (isMcpError(exception)) {
      message = exception.toBody(locale).message;
    } else if (exception instanceof HttpException) {
      const res = exception.getResponse();
      const raw = typeof res === 'string' ? res : (res as { message?: unknown })?.message;
      message = typeof raw === 'string' ? raw : 'Internal server error';
    } else if (exception instanceof Error) {
      message = exception.message || 'Internal server error';
    } else {
      message = 'Internal server error';
    }

    // 中文文案按当前语言本地化（en 缺失覆盖则保留中文）
    message = translate(message, locale);

    const body: Record<string, unknown> = { statusCode: status, message };
    if (process.env.NODE_ENV !== 'production') {
      body.stack = exception instanceof Error ? exception.stack : undefined;
    }

    response.status(status).json(body);
  }
}
