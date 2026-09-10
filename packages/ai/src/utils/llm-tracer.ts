import type {
  ChatMessage,
  ChatOptions,
  ChatResponse,
  ImageGenerationOptions,
  GeneratedImage,
} from '../types';

/** 单次 LLM 调用的完整报文（无任何截断），供详细日志排查用 */
export interface LLMCallTrace {
  /** 类型标签，便于日志解析时区分 chat / image */
  type?: 'chat';
  /** 阶段：planning / content / editing / other */
  stage: string;
  /** 供应商 */
  provider: string;
  /** 模型名 */
  model: string;
  /** 完整请求 messages（原始、不截断） */
  request: {
    messages: ChatMessage[];
    options: Partial<ChatOptions>;
  };
  /** 完整响应（原始、不截断。任何报错也会写入 error 字段） */
  response?: ChatResponse;
  /** 错误信息（若失败） */
  error?: {
    message: string;
    stack?: string;
  };
  /** 调用起始时间戳（ms） */
  startedAt: number;
  /** 调用结束时间戳（ms） */
  endedAt: number;
  /** 耗时（ms） */
  durationMs: number;
}

/** 单次图片生成调用的完整报文（无任何截断），供详细日志排查图片"半边/颜色错误/空白"等问题 */
export interface ImageGenerationTrace {
  /** 类型标签，便于日志解析时区分 chat / image */
  type: 'image';
  /** 阶段：image-slide / image-background / image-orphan / other */
  stage: string;
  /** 供应商（qwen-image / freeai / seedream） */
  provider: string;
  /** 模型名 */
  model: string;
  /** 图片尺寸，例如 1664x928 */
  size: string;
  /** 场景标签：slide 第几页 / background / orphan-rescue 等，便于定位问题对应的 slide */
  scene?: string;
  /** 完整的原始请求（prompt + options 零截断） */
  request: {
    /** 发送给模型的原始 prompt（**未经任何截断**，与实际传入 generateImage 的完全一致） */
    prompt: string;
    /** 完整的图片生成选项 */
    options: ImageGenerationOptions;
  };
  /** 完整响应（原始、不截断） */
  response?: {
    /** 生成的图片列表（含 url 和 revisedPrompt） */
    images: GeneratedImage[];
    /** 平台侧原始响应（如果有），便于排查平台返回异常 */
    raw?: any;
  };
  /** 错误信息（若失败） */
  error?: {
    message: string;
    stack?: string;
  };
  /** 调用起始时间戳（ms） */
  startedAt: number;
  /** 调用结束时间戳（ms） */
  endedAt: number;
  /** 耗时（ms） */
  durationMs: number;
}

/** 一次 session 中所有的 trace（chat 对话 + 图片生成） */
export type AnyTrace = LLMCallTrace | ImageGenerationTrace;

/**
 * LLM 调用追踪存储（单例）。
 * - 每次 HTMLPresentationAgent.generate() 开始时用 openSession(id) 创建会话
 * - BaseProvider 每次 chat/streamChat / generateImage 写入当前会话的 trace
 * - generate() 结束时 closeSession(id) 取出全部 traces，并清理内存
 * - 保证 traces 中 messages/prompt/response 完全不做任何截断（与实际发送给大模型的完全一致）
 */
interface Session {
  traces: AnyTrace[];
  /** 当前阶段标签，由 Agent 切换（planning/content/editing/images） */
  currentStage: string;
}

const sessions = new Map<string, Session>();

export function openTraceSession(sessionId: string): void {
  if (sessions.has(sessionId)) return;
  sessions.set(sessionId, { traces: [], currentStage: 'other' });
}

export function setSessionStage(sessionId: string, stage: string): void {
  const s = sessions.get(sessionId);
  if (s) s.currentStage = stage;
}

export function getSessionStage(sessionId: string): string {
  return sessions.get(sessionId)?.currentStage || 'other';
}

export function addTrace(sessionId: string, trace: AnyTrace): void {
  const s = sessions.get(sessionId);
  if (s) s.traces.push(trace);
}

export function getTraces(sessionId: string): AnyTrace[] {
  return sessions.get(sessionId)?.traces.slice() || [];
}

/** 仅获取 chat 对话类 traces（向后兼容） */
export function getLLMTraces(sessionId: string): LLMCallTrace[] {
  return (sessions.get(sessionId)?.traces || []).filter(
    (t): t is LLMCallTrace => !t.type || t.type === 'chat',
  );
}

/** 仅获取图片生成类 traces */
export function getImageTraces(sessionId: string): ImageGenerationTrace[] {
  return (sessions.get(sessionId)?.traces || []).filter(
    (t): t is ImageGenerationTrace => t.type === 'image',
  );
}

export function closeTraceSession(sessionId: string): AnyTrace[] {
  const s = sessions.get(sessionId);
  const result = s?.traces.slice() || [];
  sessions.delete(sessionId);
  return result;
}
