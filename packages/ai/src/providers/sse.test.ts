import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnthropicProvider } from './anthropic';
import { FreeAIProvider } from './freeai';
import { OpenAIProvider } from './openai';
import { consumeSse } from './sse';

function byteChunks(text: string): Uint8Array[] {
  const bytes = new TextEncoder().encode(text);
  return Array.from({ length: bytes.length }, (_, index) => bytes.slice(index, index + 1));
}

function streamResponse(chunks: Uint8Array[]) {
  let index = 0;
  return {
    ok: true,
    body: new ReadableStream<Uint8Array>({
      pull(controller) {
        if (index < chunks.length) {
          controller.enqueue(chunks[index++]);
        } else {
          controller.close();
        }
      },
    }),
  };
}

describe('provider SSE cancellation and framing', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    {
      name: 'OpenAI',
      create: () => new OpenAIProvider({ apiKey: 'test-key', model: 'test-model' }),
      event: (text: string) =>
        `data: ${JSON.stringify({ model: 'stream-model', choices: [{ delta: { content: text } }] })}`,
    },
    {
      name: 'Anthropic',
      create: () => new AnthropicProvider({ apiKey: 'test-key', model: 'test-model' }),
      event: (text: string) =>
        `data: ${JSON.stringify({ model: 'stream-model', type: 'content_block_delta', delta: { type: 'text_delta', text } })}`,
    },
    {
      name: 'FreeAI',
      create: () => new FreeAIProvider({ apiKey: 'test-key', model: 'test-model' }),
      event: (text: string) =>
        `data: ${JSON.stringify({ model: 'stream-model', choices: [{ delta: { content: text } }] })}`,
    },
  ])(
    '$name retains split UTF-8/SSE data and final event without newline',
    async ({ create, event }) => {
      const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body));
        expect(body.signal).toBeUndefined();
        return streamResponse(
          byteChunks(
            `: keep this comment\r\n\r\ndata: ${JSON.stringify({ model: 'stream-model' })}\r\n\r\n${event('你好')}`,
          ),
        );
      });
      vi.stubGlobal('fetch', fetchMock);

      const controller = new AbortController();
      const chunks: string[] = [];
      const result = await create().streamChat(
        [{ role: 'user', content: 'hello' }],
        (chunk) => chunks.push(chunk),
        { signal: controller.signal },
      );

      expect(fetchMock).toHaveBeenCalledOnce();
      expect(fetchMock.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
      expect(chunks).toEqual(['你好']);
      expect(result.content).toBe('你好');
      expect(result.model).toBe('stream-model');
    },
  );

  it('recognizes [DONE] and ignores blank/comment lines', async () => {
    const reader = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(': comment\n\ndata: {"ok":true}\n\ndata: [DONE]\n\n'),
        );
        controller.close();
      },
    }).getReader();
    const data: string[] = [];

    await consumeSse(reader, (value) => data.push(value));

    expect(data).toEqual(['{"ok":true}']);
  });

  it('propagates AbortError instead of treating it as malformed JSON', async () => {
    const abortError = new DOMException('The operation was aborted.', 'AbortError');
    const reader = {
      read: vi.fn().mockRejectedValue(abortError),
      cancel: vi.fn().mockResolvedValue(undefined),
      releaseLock: vi.fn(),
    } as unknown as ReadableStreamDefaultReader<Uint8Array>;

    await expect(consumeSse(reader, () => undefined)).rejects.toBe(abortError);
    expect(reader.releaseLock).toHaveBeenCalledOnce();
  });
});
