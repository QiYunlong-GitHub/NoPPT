import type { AIModelProvider } from '../../../providers/base';
import type { TraceableProvider } from '../../../providers/base';
import { setSessionStage } from '../../../utils/llm-tracer';

export interface AgentDeps {
  readonly provider: AIModelProvider;
  readonly planningProvider: AIModelProvider;
  readonly contentProvider: AIModelProvider;
  readonly editingProvider: AIModelProvider;
  language: 'zh' | 'en';
}

export function switchStage(provider: AIModelProvider, stage: string): void {
  const sid = (provider as TraceableProvider).activeTraceSessionId;
  if (sid) setSessionStage(sid, stage);
}

