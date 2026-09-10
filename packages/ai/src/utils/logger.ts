export type LogVerbosity = 'detailed' | 'simple';

export interface LogConfig {
  consoleVerbosity: LogVerbosity;
  fileVerbosity: LogVerbosity;
}

/**
 * 运行时日志配置（单例）。
 * 服务端在收到 generatePresentation 请求时通过 setLogConfig 注入用户设置；
 * 未设置时默认使用 detailed，保持向后兼容。
 */
let runtimeConfig: LogConfig = {
  consoleVerbosity: 'detailed',
  fileVerbosity: 'detailed',
};

const VALID_VERBOSITY: ReadonlyArray<LogVerbosity> = ['detailed', 'simple'];

function isValidVerbosity(v: unknown): v is LogVerbosity {
  return typeof v === 'string' && (VALID_VERBOSITY as readonly string[]).includes(v);
}

export function normalizeLogConfig(cfg: Partial<LogConfig> | null | undefined): Partial<LogConfig> {
  if (!cfg || typeof cfg !== 'object') return {};
  const result: Partial<LogConfig> = {};
  if (isValidVerbosity(cfg.consoleVerbosity)) result.consoleVerbosity = cfg.consoleVerbosity;
  if (isValidVerbosity(cfg.fileVerbosity)) result.fileVerbosity = cfg.fileVerbosity;
  return result;
}

export function setLogConfig(cfg: Partial<LogConfig> | null | undefined) {
  const safe = normalizeLogConfig(cfg);
  if (Object.keys(safe).length > 0) {
    runtimeConfig = { ...runtimeConfig, ...safe };
  }
}

export function getLogConfig(): LogConfig {
  return { ...runtimeConfig };
}

/** 控制台是否允许输出详细报文（请求/响应 JSON 等） */
export function isConsoleDetailed(): boolean {
  return runtimeConfig.consoleVerbosity === 'detailed';
}

/** 文件日志是否允许记录详细报文 */
export function isFileDetailed(): boolean {
  return runtimeConfig.fileVerbosity === 'detailed';
}

/** 简单模式下的控制台：仅输出一行基础状态，不打印大 JSON */
export function simpleLog(tag: string, message: string, extra?: Record<string, any>) {
  const timestamp = formatBeijingTimeShort();
  const extraStr = extra
    ? ' | ' +
      Object.entries(extra)
        .map(([k, v]) => `${k}=${typeof v === 'object' ? '[object]' : v}`)
        .join(' ')
    : '';
  console.log(`[${timestamp}] [${tag}] ${message}${extraStr}`);
}

function formatBeijingTimeShort(): string {
  const now = new Date();
  const utcTime = now.getTime() + now.getTimezoneOffset() * 60000;
  const d = new Date(utcTime + 8 * 3600000);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}
