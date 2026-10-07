export type SseDataHandler = (data: string) => void | Promise<void>;

/** Consume an SSE byte stream without losing framing across network chunks. */
export async function consumeSse(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onData: SseDataHandler,
  signal?: AbortSignal,
): Promise<void> {
  const decoder = new TextDecoder();
  let buffer = '';
  let dataLines: string[] = [];
  let ended = false;
  let doneEvent = false;

  const flushEvent = async () => {
    if (dataLines.length === 0) return;
    const data = dataLines.join('\n');
    dataLines = [];
    if (data === '[DONE]') {
      doneEvent = true;
      return;
    }
    await onData(data);
  };

  const processLine = async (rawLine: string) => {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (line === '') {
      await flushEvent();
      return;
    }
    if (line.startsWith(':')) return;
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).replace(/^ /, ''));
    }
  };

  const processText = async (text: string) => {
    buffer += text;
    let newlineIndex = buffer.indexOf('\n');
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      await processLine(line);
      if (doneEvent) return;
      newlineIndex = buffer.indexOf('\n');
    }
  };

  try {
    while (!doneEvent) {
      if (signal?.aborted) {
        throw signal.reason ?? new DOMException('The operation was aborted.', 'AbortError');
      }
      const { done, value } = await reader.read();
      if (done) {
        ended = true;
        await processText(decoder.decode());
        if (!doneEvent && buffer !== '') {
          await processLine(buffer);
          buffer = '';
        }
        if (!doneEvent) await flushEvent();
        break;
      }
      await processText(decoder.decode(value, { stream: true }));
    }
  } finally {
    if (!ended) {
      try {
        await reader.cancel();
      } catch {
        // Preserve the original stream/abort error.
      }
    }
    reader.releaseLock();
  }
}
