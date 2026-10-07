import { Injectable } from '@nestjs/common';
import { StorageService } from '../../common/storage.service';
import { join } from 'path';

/**
 * AI 日志单条记录结构。
 * 注意：**不能使用固定字段白名单**。
 * ai.service.ts 的「详细模式」会动态扩展字段（如 llmCalls / llmCallCount /
 * response.postProcessing / slides.imagePrompt 等），用于排查问题的完整原始证据链。
 * 所以这里只保留「框架级固定字段」(id/timestamp/type)，其他字段全部通过 ...data 展开原样保留，
 * 未来再新增字段也不需要修改 logsService。
 */
export interface AILogEntry {
  id: string;
  timestamp: number;
  type: string;
  // 以下均为调用方 logAICall(data) 透传的字段，只做最基础的约束
  request?: unknown;
  response?: unknown;
  model?: string;
  provider?: string;
  routing?: Record<string, string>;
  duration?: number;
  error?: unknown;
  // ⚠️ 详细模式扩展字段：不要在这里硬编码新字段，保持 AILogEntry 开放
  llmCalls?: unknown[];
  llmCallCount?: number;
  // 任意其他扩展字段（例如以后加 stages / retries / cost 等）
  [key: string]: unknown;
}

@Injectable()
export class LogsService {
  constructor(private readonly storage: StorageService) {}

  /**
   * 追加一条 AI 调用日志到 <presentationId>/ai-log.jsonl。
   * data 中的字段会**原样透传**写入，不做任何裁剪/白名单过滤。
   */
  async logAICall(presentationId: string, type: string, data: Record<string, unknown>) {
    const entry: AILogEntry = {
      id: this.storage.generateId(),
      timestamp: Date.now(),
      type,
      ...data,
    };

    const logFile = join(this.storage.getPresentationDir(presentationId), 'ai-log.jsonl');
    await this.storage.appendToLogFile(logFile, entry);
  }

  /**
   * Append a privacy-safe visual-integrity evidence event. Unlike legacy AI traces,
   * this path is deliberately allowlisted and never persists prompts, HTML, keys,
   * or provider responses.
   */
  async logIntegrityEvent(presentationId: string, event: Record<string, unknown>): Promise<void> {
    const eventType = typeof event.eventType === 'string' ? event.eventType : 'audit';
    const safeEvent = sanitizeIntegrityEvent(event);
    await this.logAICall(presentationId, eventType, safeEvent);
  }
  getAILogs(presentationId: string): AILogEntry[] {
    const logFile = join(this.storage.getPresentationDir(presentationId), 'ai-log.jsonl');
    return this.storage.readLogFile(logFile);
  }
}

const INTEGRITY_ALLOWED_KEYS = new Set([
  'eventType', 'presentationId', 'slideIndex', 'runId', 'phase', 'source', 'pageType',
  'viewport', 'logicalCanvas', 'expected', 'observed', 'emptyRequiredNodes',
  'outOfBoundsNodes', 'clippedNodes', 'parity', 'font', 'status', 'fixAction',
  'artifactPath', 'durationMs', 'errorCode',
]);
const INTEGRITY_NESTED_KEYS = new Set([
  'width', 'height', 'profile', 'content', 'state', 'declaredFamily', 'resolvedFamily',
  'declaredWeight', 'resolvedWeight', 'fallbackUsed', 'metricDelta', 'metricStatus',
  'maxMetricDelta', 'weightState', 'reason',
]);

function sanitizeIntegrityValue(value: unknown, nested = false): unknown {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.length > 160 ? `[redacted:${value.length}]` : value;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitizeIntegrityValue(item, true));
  if (typeof value !== 'object') return undefined;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (/api.?key|token|secret|password|sensitive|external.?response|full.?material|^html$|^request$|^response$|^raw$/iu.test(key)) continue;
    if (nested && !INTEGRITY_NESTED_KEYS.has(key)) continue;
    const safe = sanitizeIntegrityValue(child, true);
    if (safe !== undefined) result[key] = safe;
  }
  return result;
}

function sanitizeIntegrityEvent(event: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(event)) {
    if (!INTEGRITY_ALLOWED_KEYS.has(key)) continue;
    const safe = sanitizeIntegrityValue(value, key === 'font' || key === 'viewport' || key === 'logicalCanvas' || key === 'expected' || key === 'observed');
    if (safe !== undefined) result[key] = safe;
  }
  return result;
}
