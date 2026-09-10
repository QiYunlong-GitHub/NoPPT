import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { McpJob } from './generation-queue';
import { GenerationQueue } from './generation-queue';
import type { McpContext } from './mcp-context';
import { McpError } from '../../common/mcp-errors';

/** TC-107（规格 5.2.1）：Job 状态机、信号量并发上限、TTL/上限驱逐、waitFor 与 E5006。 */
describe('M4 GenerationQueue', () => {
  let queue: GenerationQueue;
  const ctx = { keyId: 'k1', userKey: 'alice' } as unknown as McpContext;

  beforeEach(() => {
    queue = new GenerationQueue({ maxConcurrent: 2, ttlMs: 1000, max: 50 });
  });

  afterEach(() => {
    queue.onModuleDestroy();
  });

  it('入队为 queued，执行后转 done 并带 result', async () => {
    const jobId = queue.enqueue('generate', ctx, { topic: 't' }, async () => ({ presentationId: 'p1' }));
    // 入队后可能已被 pump 立即置为 running（信号量有空位），两者都合法
    expect(['queued', 'running']).toContain(queue.get(jobId)?.status);
    const job = await queue.waitFor(jobId, 3000);
    expect(job.status).toBe('done');
    expect(job.result).toEqual({ presentationId: 'p1' });
    expect(job.startedAt).toBeGreaterThan(0);
    expect(job.finishedAt).toBeGreaterThanOrEqual(job.startedAt!);
  });

  it('runner 抛错转 failed，error 结构化且不含堆栈', async () => {
    const jobId = queue.enqueue('generate', ctx, {}, async () => {
      throw new McpError('E5005', 'boom');
    });
    const job = await queue.waitFor(jobId, 3000);
    expect(job.status).toBe('failed');
    expect(job.error?.code).toBe('E5005');
    expect(job.error?.message).toBe('boom');
    expect(JSON.stringify(job.error)).not.toContain('at ');
  });

  it('并发不超过 maxConcurrent（信号量生效）', async () => {
    let running = 0;
    let peak = 0;
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) {
      ids.push(
        queue.enqueue('generate', ctx, { i }, async () => {
          running += 1;
          peak = Math.max(peak, running);
          await new Promise((r) => setTimeout(r, 60));
          running -= 1;
          return { i };
        }),
      );
    }
    for (const id of ids) await queue.waitFor(id, 5000);
    expect(peak).toBeLessThanOrEqual(2);
    expect(peak).toBeGreaterThan(0);
  });

  it('waitFor 未知 jobId 抛 E5006', async () => {
    await expect(queue.waitFor('j_missing', 100)).rejects.toMatchObject({ code: 'E5006' });
  });

  it('waitFor 超时返回当前 job（仍为 queued/running）', async () => {
    // 占满并发，让第三个任务保持 queued
    queue.enqueue('generate', ctx, {}, async () => {
      await new Promise((r) => setTimeout(r, 400));
      return {};
    });
    queue.enqueue('generate', ctx, {}, async () => {
      await new Promise((r) => setTimeout(r, 400));
      return {};
    });
    const pending = queue.enqueue('generate', ctx, {}, async () => ({}));
    const job = await queue.waitFor(pending, 50);
    expect(['queued', 'running']).toContain(job.status);
  });

  it('TTL 到期后终态 Job 被驱逐，轮询得到 E5006', async () => {
    const q = new GenerationQueue({ maxConcurrent: 1, ttlMs: 10, max: 50 });
    const jobId = q.enqueue('generate', ctx, {}, async () => ({}));
    await q.waitFor(jobId, 2000);
    // 触发一次新的入队以执行 evict
    q.enqueue('generate', ctx, {}, async () => ({}));
    await new Promise((r) => setTimeout(r, 30));
    q.enqueue('generate', ctx, {}, async () => ({}));
    expect(q.get(jobId)).toBeUndefined();
    await expect(q.waitFor(jobId, 50)).rejects.toMatchObject({ code: 'E5006' });
    q.onModuleDestroy();
  });

  it('超过 max 时按最早优先驱逐', async () => {
    const q = new GenerationQueue({ maxConcurrent: 1, ttlMs: 60000, max: 3 });
    const first = q.enqueue('generate', ctx, {}, async () => ({}));
    await q.waitFor(first, 2000);
    q.enqueue('generate', ctx, {}, async () => ({}));
    q.enqueue('generate', ctx, {}, async () => ({}));
    q.enqueue('generate', ctx, {}, async () => ({}));
    expect(q.get(first)).toBeUndefined();
    expect(q.stats().total).toBeLessThanOrEqual(3);
    q.onModuleDestroy();
  });

  it('stats 反映 queued / running 数量', async () => {
    queue.enqueue('generate', ctx, {}, async () => {
      await new Promise((r) => setTimeout(r, 120));
      return {};
    });
    await new Promise((r) => setTimeout(r, 20));
    const stats = queue.stats();
    expect(stats.running).toBe(1);
    expect(stats.maxConcurrent).toBe(2);
  });

  it('job 保留 tool 字段与入参', async () => {
    const jobId = queue.enqueue('edit_slide', ctx, { presentationId: 'p1' }, async () => ({}));
    const job = queue.get(jobId) as McpJob;
    expect(job.tool).toBe('edit_slide');
    expect(job.args).toEqual({ presentationId: 'p1' });
    await queue.waitFor(jobId, 2000);
  });
});
