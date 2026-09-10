import { BaseProvider, formatMessages, truncate } from './base';
import type { ChatMessage, ChatOptions, ChatResponse, ModelConfig, ContentPart } from '../types';

export interface V0ProviderConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
}

interface V0ChatResponse {
  id: string;
  webUrl: string;
  latestVersion?: {
    id: string;
    demoUrl?: string;
    files?: Array<{
      name: string;
      content: string;
    }>;
  };
}

function extractTextContent(content: string | ContentPart[]): string {
  if (typeof content === 'string') return content;
  return content
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('\n');
}

export class V0Provider extends BaseProvider {
  name = 'v0';
  config: ModelConfig;
  private apiKey: string;
  private baseUrl: string;

  constructor(config: V0ProviderConfig | Omit<ModelConfig, 'provider'>) {
    super();
    this.apiKey = config.apiKey || '';
    this.baseUrl = config.baseUrl || 'https://api.v0.dev/v1';
    this.config = {
      provider: 'v0',
      apiKey: config.apiKey || '',
      baseUrl: this.baseUrl,
      model: config.model || 'v0-1.5-md',
    };
  }

  async chat(messages: ChatMessage[], options?: Partial<ChatOptions>): Promise<ChatResponse> {
    const opts = this.mergeOptions(options);
    const userMessage = messages
      .filter((m) => m.role === 'user')
      .map((m) => extractTextContent(m.content))
      .join('\n\n');

    const systemMessage = messages
      .filter((m) => m.role === 'system')
      .map((m) => extractTextContent(m.content))
      .join('\n\n');

    this.logRequest('chat', {
      endpoint: '/chats',
      model: opts.model,
      messages: formatMessages(messages),
      messageCount: messages.length,
      userMessageLength: userMessage.length,
      hasSystemMessage: !!systemMessage,
    });

    const startTime = Date.now();

    try {
      const body: Record<string, any> = {
        message: userMessage,
        modelConfiguration: {
          modelId: this.config.model || 'v0-1.5-md',
        },
      };

      if (systemMessage) {
        body.system = systemMessage;
      }

      const response = await fetch(`${this.baseUrl}/chats`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        const errorMsg = `v0 API error: ${response.status} ${errorText}`;
        this.logError('chat', {
          status: response.status,
          statusText: response.statusText,
          error: errorText,
        });
        throw new Error(errorMsg);
      }

      const data = (await response.json()) as V0ChatResponse;
      const duration = Date.now() - startTime;

      let content = '';
      let mainFileName = '';
      let fileCount = 0;
      if (data.latestVersion?.files && data.latestVersion.files.length > 0) {
        fileCount = data.latestVersion.files.length;
        const mainFile = data.latestVersion.files.find(
          (f) => f.name === 'App.tsx' || f.name === 'app/page.tsx' || f.name.endsWith('.tsx'),
        );
        if (mainFile) {
          content = mainFile.content;
          mainFileName = mainFile.name;
        } else {
          content = data.latestVersion.files.map((f) => `// ${f.name}\n${f.content}`).join('\n\n');
          mainFileName = data.latestVersion.files[0]?.name || '';
        }
      } else {
        content = `v0 chat created: ${data.webUrl}`;
      }

      const result = {
        content,
        model: this.config.model || 'v0-1.5-md',
        usage: {
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
        },
        raw: data,
      };

      this.logResponse('chat', {
        durationMs: duration,
        model: result.model,
        chatId: data.id,
        webUrl: data.webUrl,
        hasLatestVersion: !!data.latestVersion,
        versionId: data.latestVersion?.id,
        demoUrl: data.latestVersion?.demoUrl,
        fileCount,
        mainFileName,
        contentPreview: truncate(result.content, 1000),
        contentLength: result.content.length,
      });

      return result;
    } catch (e) {
      this.logError('chat', e);
      throw e;
    }
  }

  async streamChat(
    messages: ChatMessage[],
    onChunk: (chunk: string) => void,
    options?: Partial<ChatOptions>,
  ): Promise<ChatResponse> {
    this.logRequest('streamChat', {
      messages: formatMessages(messages),
      messageCount: messages.length,
      note: 'v0 does not support true streaming, will return complete response',
    });

    const startTime = Date.now();

    try {
      const result = await this.chat(messages, options);
      onChunk(result.content);
      const duration = Date.now() - startTime;

      this.logResponse('streamChat', {
        durationMs: duration,
        model: result.model,
        contentLength: result.content.length,
        note: 'simulated streaming - delivered full content as single chunk',
      });

      return result;
    } catch (e) {
      this.logError('streamChat', e);
      throw e;
    }
  }

  async validateConfig(): Promise<boolean> {
    this.logRequest('validateConfig', { action: 'test user endpoint', endpoint: '/user' });

    try {
      const startTime = Date.now();
      const response = await fetch(`${this.baseUrl}/user`, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
      });
      const duration = Date.now() - startTime;
      const success = response.ok;

      this.logResponse('validateConfig', {
        success,
        status: response.status,
        durationMs: duration,
      });

      return success;
    } catch (e) {
      this.logError('validateConfig', e);
      return false;
    }
  }

  async getModels(): Promise<string[]> {
    this.logRequest('getModels', { note: 'returning static model list' });
    try {
      const models = ['v0-1.5-md', 'v0-1.5-xl', 'v0-turbo'];
      this.logResponse('getModels', { success: true, modelCount: models.length, models });
      return models;
    } catch (e) {
      this.logError('getModels', e);
      return [];
    }
  }

  async getChatById(chatId: string): Promise<V0ChatResponse> {
    this.logRequest('getChatById', {
      endpoint: `/chats/${chatId}`,
      chatId: truncate(chatId, 50),
    });

    const startTime = Date.now();

    try {
      const response = await fetch(`${this.baseUrl}/chats/${chatId}`, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
      });
      const duration = Date.now() - startTime;

      if (!response.ok) {
        const errorMsg = `v0 API error: ${response.status}`;
        this.logError('getChatById', { status: response.status, durationMs: duration });
        throw new Error(errorMsg);
      }

      const data = await response.json();
      this.logResponse('getChatById', {
        durationMs: duration,
        chatId: data.id,
        webUrl: data.webUrl,
        hasLatestVersion: !!data.latestVersion,
      });

      return data;
    } catch (e) {
      this.logError('getChatById', e);
      throw e;
    }
  }

  async sendMessage(chatId: string, message: string): Promise<V0ChatResponse> {
    this.logRequest('sendMessage', {
      endpoint: `/chats/${chatId}/messages`,
      chatId: truncate(chatId, 50),
      message: truncate(message, 300),
      messageLength: message.length,
    });

    const startTime = Date.now();

    try {
      const response = await fetch(`${this.baseUrl}/chats/${chatId}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ message }),
      });
      const duration = Date.now() - startTime;

      if (!response.ok) {
        const errorMsg = `v0 API error: ${response.status}`;
        this.logError('sendMessage', { status: response.status, durationMs: duration });
        throw new Error(errorMsg);
      }

      const data = await response.json();
      this.logResponse('sendMessage', {
        durationMs: duration,
        chatId: data.id,
        webUrl: data.webUrl,
        hasLatestVersion: !!data.latestVersion,
        fileCount: data.latestVersion?.files?.length || 0,
      });

      return data;
    } catch (e) {
      this.logError('sendMessage', e);
      throw e;
    }
  }
}
