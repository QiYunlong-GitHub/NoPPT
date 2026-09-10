import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { join } from 'path';
import express from 'express';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { loadServerEnvFile, readMcpEnv } from './common/env';
import { getRequestLocale, translate } from './i18n/locale';

// 必须在 Nest 启动前加载，以便 AuthModule 的 dev key 引导能读到 NOPPT_DEV_KEY（NFR-9）
loadServerEnvFile();

/**
 * `data/` 下不允许无鉴权直读的敏感文件（规格 2.6 / D-11）。
 * 保留 `/data` → `data/` 挂载以兼容既有 Web 的 `/data/workspace/...` 资源 URL，
 * 仅拦截凭据与演示元数据，放行 assets 图片/视频。
 */
const SENSITIVE_FILE_RE = /(^|\/)(apikeys\.json|config\.json|presentation\.json|chat-history\.json|[^/]*\.jsonl)$/i;
const SENSITIVE_DIR_RE = /(^|\/)(reference-attrs|reference-originals)(\/|$)/i;

function isSensitiveDataPath(url: string): boolean {
  const pathname = url.split('?')[0];
  if (!pathname.startsWith('/data/')) return false;
  const rel = pathname.slice('/data'.length);
  return SENSITIVE_FILE_RE.test(rel) || SENSITIVE_DIR_RE.test(rel);
}

function buildCorsOrigins(webUrl: string): string[] {
  const set = new Set<string>([webUrl, 'http://localhost:5173', 'http://127.0.0.1:5173']);
  return [...set].filter(Boolean);
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log', 'debug', 'verbose'],
    bodyParser: false,
  });

  // ⚠️ `/api/mcp` 必须跳过 express.json：MCP transport 需要读取未被预解析的原始流（规格 2.5.4）
  app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (req.path.startsWith('/api/mcp')) return next();
    return express.json({ limit: '50mb' })(req, res, next);
  });
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  // 解析请求语言：X-NoPPT-Lang / Accept-Language / 服务端 config.json / 默认 zh-CN
  app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
    (req as unknown as { locale?: string }).locale = getRequestLocale(req);
    next();
  });

  app.useGlobalFilters(new AllExceptionsFilter());

  const env = readMcpEnv();
  const allowedOrigins = buildCorsOrigins(env.webUrl);
  app.enableCors({
    // 无 Origin 的请求（Hermes CLI / curl / 服务端调用）不受 CORS 限制
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(null, false);
    },
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Admin-Key', 'X-NoPPT-Lang', 'Accept-Language'],
  });

  app.setGlobalPrefix('api');

  const dataDir = join(process.cwd(), 'data');
  app.use('/data', (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (isSensitiveDataPath(req.originalUrl)) {
      res.status(403).json({
        error: 'forbidden',
        message: translate('该文件不允许通过静态目录访问', getRequestLocale(req)),
      });
      return;
    }
    next();
  });
  app.use('/data', express.static(dataDir));

  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;
  await app.listen(port);
  console.log(`NoPPT Server is running on http://localhost:${port}`);
}

bootstrap().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
