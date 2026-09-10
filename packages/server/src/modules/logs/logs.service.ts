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

  getAILogs(presentationId: string): AILogEntry[] {
    const logFile = join(this.storage.getPresentationDir(presentationId), 'ai-log.jsonl');
    return this.storage.readLogFile(logFile);
  }
}
