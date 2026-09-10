import fs from 'fs';
import path from 'path';
import type { Locale } from './types';

export { translate } from './translate';

/**
 * 语言解析（混合取值）：
 *   请求头 `X-NoPPT-Lang` → `Accept-Language` → 服务端 config.json 的 interfaceSettings.language → 默认 zh-CN
 *
 * 注意：`ConfigModule` 非 @Global，且 main.ts 的 middleware 无 DI 上下文，
 * 故 config 语言直接用 fs 短 TTL 缓存读取，避免每个请求都触发磁盘 IO。
 */

let cached: { locale: Locale; ts: number } | null = null;
const TTL_MS = 5000;

function readConfigLocale(): Locale {
  try {
    const p = path.join(process.cwd(), 'data', 'config.json');
    const raw = fs.readFileSync(p, 'utf-8');
    const cfg = JSON.parse(raw) as { interfaceSettings?: { language?: string } };
    return cfg?.interfaceSettings?.language === 'en' ? 'en' : 'zh-CN';
  } catch {
    return 'zh-CN';
  }
}

export function getConfigLocale(): Locale {
  const now = Date.now();
  if (cached && now - cached.ts < TTL_MS) return cached.locale;
  cached = { locale: readConfigLocale(), ts: now };
  return cached.locale;
}

/** 配置写入后主动失效缓存（供 saveConfig 调用，可选）。 */
export function invalidateLocaleCache(): void {
  cached = null;
}

export function parseAcceptLanguage(header?: string | null): Locale | undefined {
  if (!header) return undefined;
  const parts = header.split(',').map((s) => s.split(';')[0].trim().toLowerCase());
  if (parts.some((p) => p === 'zh' || p === 'zh-cn' || p === 'zh-hans')) return 'zh-CN';
  if (parts.some((p) => p.startsWith('en'))) return 'en';
  return undefined;
}

export function getRequestLocale(req: { headers?: Record<string, unknown> }): Locale {
  const h = req.headers || {};
  const custom =
    typeof h['x-noppt-lang'] === 'string' ? h['x-noppt-lang'].toLowerCase() : undefined;
  if (custom === 'en') return 'en';
  if (custom === 'zh-cn' || custom === 'zh') return 'zh-CN';
  const acc = parseAcceptLanguage(
    typeof h['accept-language'] === 'string' ? h['accept-language'] : undefined,
  );
  if (acc) return acc;
  return getConfigLocale();
}
