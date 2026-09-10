import type { ChatMessage, ChatOptions, ChatResponse, ModelConfig, ImageGenerationOptions, GeneratedImage } from '../types';
import { isConsoleDetailed, simpleLog } from '../utils/logger';
import { addTrace, getSessionStage } from '../utils/llm-tracer';
import type { LLMCallTrace, ImageGenerationTrace, AnyTrace } from '../utils/llm-tracer';

export interface AIModelProvider {
  name: string;
  config: ModelConfig;

  chat(messages: ChatMessage[], options?: Partial<ChatOptions>): Promise<ChatResponse>;

  streamChat(
    messages: ChatMessage[],
    onChunk: (chunk: string) => void,
    options?: Partial<ChatOptions>,
  ): Promise<ChatResponse>;

  validateConfig(): Promise<boolean>;

  getModels(): Promise<string[]>;

  generateImage?(prompt: string, options?: ImageGenerationOptions): Promise<GeneratedImage[]>;
}

/** 以 sessionId 为粒度记录 LLM 调用；由 Agent 在调用前设置到每个 provider 上 */
export type TraceableProvider = AIModelProvider & { activeTraceSessionId?: string };

function maskApiKey(key: string | undefined): string {
  if (!key) return '[NOT SET]';
  if (key.length <= 8) return '***';
  return key.substring(0, 4) + '****' + key.substring(key.length - 4);
}

function truncate(str: string, maxLen: number = 500): string {
  if (!str) return '';
  if (str.length <= maxLen) return str;
  return str.substring(0, maxLen) + `... [truncated, total ${str.length} chars]`;
}

function formatContentForLog(content: string | import('../types').ContentPart[]): string {
  if (typeof content === 'string') return truncate(content, 300);
  return content
    .map(part => {
      if (part.type === 'text') return truncate(part.text, 300);
      const url = part.image_url?.url || '';
      return url.startsWith('data:') ? '[image data]' : `[image: ${truncate(url, 120)}]`;
    })
    .join(' | ');
}

function formatMessages(messages: ChatMessage[]): any[] {
  return messages.map(m => ({
    role: m.role,
    content: formatContentForLog(m.content),
  }));
}

export function getBeijingTime(): Date {
  const now = new Date();
  const utcTime = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utcTime + 8 * 3600000);
}

export function formatBeijingTime(date?: Date, includeSeconds: boolean = true): string {
  const d = date || getBeijingTime();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');
  let result = `${year}-${month}-${day} ${hours}:${minutes}`;
  if (includeSeconds) {
    result += `:${seconds}`;
  }
  return result;
}

export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else if (seconds > 0) {
    return `${seconds}.${Math.floor((ms % 1000) / 100)}s`;
  } else {
    return `${ms}ms`;
  }
}

export abstract class BaseProvider implements AIModelProvider {
  abstract name: string;
  abstract config: ModelConfig;
  /** Agent 在调用前设置，chat/streamChat 埋点时会读取并写入 tracer */
  activeTraceSessionId?: string;

  /** 写入完整 trace（无任何截断）。仅当 activeTraceSessionId 已设置时生效 */
  protected recordTrace(trace: Omit<LLMCallTrace, 'stage'> | Omit<ImageGenerationTrace, 'stage'>) {
    if (!this.activeTraceSessionId) return;
    const stage = getSessionStage(this.activeTraceSessionId);
    const enriched: AnyTrace =
      (trace as ImageGenerationTrace).type === 'image'
        ? ({ ...(trace as ImageGenerationTrace), stage } as ImageGenerationTrace)
        : ({ type: 'chat' as const, ...(trace as Omit<LLMCallTrace, 'stage'>), stage } as LLMCallTrace);
    addTrace(this.activeTraceSessionId, enriched);
  }

  protected logRequest(method: string, details: any) {
    const tag = `LLM:${this.name}:REQUEST`;
    if (isConsoleDetailed()) {
      const timestamp = formatBeijingTime();
      console.log(`\n[${timestamp}] [${tag}] ${method}`);
      console.log(JSON.stringify({
        provider: this.name,
        baseUrl: this.config.baseUrl ? truncate(this.config.baseUrl, 100) : '[default]',
        model: this.config.model,
        apiKey: maskApiKey(this.config.apiKey),
        ...details,
      }, null, 2));
    } else {
      // 简单模式：一行状态，不打印 messages 大对象
      const msgCount = Array.isArray(details?.messages) ? details.messages.length : 0;
      simpleLog(tag, `→ ${method}`, {
        model: this.config.model,
        messages: msgCount > 0 ? `${msgCount}条` : undefined,
      });
    }
  }

  protected logResponse(method: string, details: any) {
    const tag = `LLM:${this.name}:RESPONSE`;
    if (isConsoleDetailed()) {
      const timestamp = formatBeijingTime();
      console.log(`[${timestamp}] [${tag}] ${method}`);
      console.log(JSON.stringify(details, null, 2));
      console.log('');
    } else {
      // 简单模式：摘要信息
      const usage = details?.usage as any;
      const tokens = usage ? `tok=${usage.total_tokens ?? usage.output_tokens ?? '?'}` : undefined;
      const contentLen = typeof details?.content === 'string' ? details.content.length : 0;
      simpleLog(tag, `← ${method}`, {
        model: this.config.model,
        ...(tokens ? { tokens } : {}),
        content: contentLen > 0 ? `${contentLen}chars` : undefined,
      });
    }
  }

  protected logError(method: string, error: any) {
    // 错误信息永远输出（不受简单模式限制），否则难以排查故障
    const timestamp = formatBeijingTime();
    console.error(`[${timestamp}] [LLM:${this.name}:ERROR] ${method}`);
    console.error(error);
    console.log('');
  }

  abstract chat(messages: ChatMessage[], options?: Partial<ChatOptions>): Promise<ChatResponse>;

  abstract streamChat(
    messages: ChatMessage[],
    onChunk: (chunk: string) => void,
    options?: Partial<ChatOptions>,
  ): Promise<ChatResponse>;

  abstract validateConfig(): Promise<boolean>;

  abstract getModels(): Promise<string[]>;

  async generateImage(_prompt: string, _options?: ImageGenerationOptions): Promise<GeneratedImage[]> {
    throw new Error(`Image generation is not supported by ${this.name} provider`);
  }

  protected mergeOptions(options?: Partial<ChatOptions>): ChatOptions {
    return {
      model: this.config.defaultOptions?.model || this.config.model,
      temperature: options?.temperature ?? this.config.defaultOptions?.temperature ?? 0.7,
      maxTokens: options?.maxTokens ?? this.config.defaultOptions?.maxTokens ?? 8192,
      topP: options?.topP ?? this.config.defaultOptions?.topP ?? 1,
      stream: options?.stream ?? false,
    };
  }
}

export { formatMessages, truncate, maskApiKey };
