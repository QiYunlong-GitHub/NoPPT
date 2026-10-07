import { describe, expect, it, vi } from 'vitest';
import { createMcpContextOwnership } from './mcp-context';

describe('MCP context ownership', () => {
  it('disposes the owned resource once after request and queued owners release', async () => {
    const destroy = vi.fn(async () => undefined);
    const ownership = createMcpContextOwnership(destroy);
    const releaseJob = ownership.acquire();

    await ownership.dispose();
    expect(destroy).not.toHaveBeenCalled();

    await Promise.all([ownership.dispose(), ownership.release()]);
    expect(destroy).not.toHaveBeenCalled();

    await releaseJob();
    expect(destroy).toHaveBeenCalledTimes(1);
    await Promise.all([ownership.dispose(), ownership.release(), releaseJob()]);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('shares the same in-flight destroy promise for concurrent final releases', async () => {
    let resolveDestroy!: () => void;
    const destroy = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveDestroy = resolve;
        }),
    );
    const ownership = createMcpContextOwnership(destroy);
    const releaseJob = ownership.acquire();

    const requestRelease = ownership.dispose();
    const jobRelease = releaseJob();
    expect(destroy).toHaveBeenCalledTimes(1);
    resolveDestroy();
    await Promise.all([requestRelease, jobRelease]);
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});
