import { Injectable } from '@nestjs/common';
import type { McpContext } from './mcp-context';
import { McpError, sanitizeMessage } from '../../common/mcp-errors';
import { readMcpEnv } from '../../common/env';

/**
 * 异步任务队列（规格 2.5.4 / 4.3）：进程内 `Map` + 信号量。
 *
 * - `enqueue` 立即返回 jobId（NFR-7：<1s，入队前无任何 I/O）；
 * - 并发上限 `NOPPT_MAX_CONCURRENT`（默认 2），由 `running` 计数充当信号量；
 * - 终态 Job 保留 `NOPPT_JOB_TTL_MS`（默认 1h）供轮询，总数超 `NOPPT_JOB_MAX` 按最早优先驱逐；
 * - 替换点：可整体换成 BullMQ + Redis，`enqueue/get/waitFor` 接口不变。
 */

export type McpJobTool = 'generate' | 'edit_slide' | 'edit_element' | 'edit_global';
export type McpJobStatus = 'queued' | 'running' | 'done' | 'failed';

export interface McpJobError {
  code: string;
  message: string;
}

export interface McpJob {
  jobId: string;
  tool: McpJobTool;
  status: McpJobStatus;
  ctx: McpContext;
  args: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: McpJobError;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
}

export type JobRunner = (
  ctx: McpContext,
  args: Record<string, unknown>,
  jobId: string,
) => Promise<Record<string, unknown>>;

export interface GenerationQueueOptions {
  maxConcurrent: number;
  ttlMs: number;
  max: number;
}

const EVICT_INTERVAL_MS = 60_000;

@Injectable()
export class GenerationQueue {
  private readonly jobs = new Map<string, McpJob>();
  private readonly runners = new Map<string, JobRunner>();
  private readonly options: GenerationQueueOptions;
  private running = 0;
  private seq = 0;
  private timer?: NodeJS.Timeout;

  constructor(options?: Partial<GenerationQueueOptions>) {
    const env = readMcpEnv();
    this.options = {
      maxConcurrent: Math.max(1, options?.maxConcurrent ?? env.maxConcurrent),
      ttlMs: Math.max(1, options?.ttlMs ?? env.jobTtlMs),
      max: Math.max(1, options?.max ?? env.jobMax),
    };
    this.timer = setInterval(() => this.evict(), EVICT_INTERVAL_MS);
    this.timer.unref?.();
  }

  /** 入队，立即返回 jobId。 */
  enqueue(
    tool: McpJobTool,
    ctx: McpContext,
    args: Record<string, unknown>,
    runner: JobRunner,
  ): string {
    this.seq += 1;
    const jobId = `j_${Date.now().toString(36)}_${this.seq.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const job: McpJob = { jobId, tool, status: 'queued', ctx, args, createdAt: Date.now() };
    this.jobs.set(jobId, job);
    this.runners.set(jobId, runner);
    this.evict();
    this.pump();
    return jobId;
  }

  get(jobId: string): McpJob | undefined {
    return this.jobs.get(jobId);
  }

  stats(): { queued: number; running: number; total: number; maxConcurrent: number } {
    let queued = 0;
    let running = 0;
    for (const job of this.jobs.values()) {
      if (job.status === 'queued') queued += 1;
      else if (job.status === 'running') running += 1;
    }
    return { queued, running, total: this.jobs.size, maxConcurrent: this.options.maxConcurrent };
  }

  /** 同步等待终态；超时（或 job 不存在）抛 E5006。 */
  async waitFor(jobId: string, timeoutMs: number, pollMs = 100): Promise<McpJob> {
    const deadline = Date.now() + Math.max(0, timeoutMs);
    for (;;) {
      const job = this.jobs.get(jobId);
      if (!job) throw new McpError('E5006', undefined, { jobId });
      if (job.status === 'done' || job.status === 'failed') return job;
      if (Date.now() >= deadline) return job;
      await new Promise((r) => setTimeout(r, pollMs));
    }
  }

  private pump(): void {
    while (this.running < this.options.maxConcurrent) {
      let next: McpJob | undefined;
      for (const job of this.jobs.values()) {
        if (job.status !== 'queued') continue;
        if (!next || job.createdAt < next.createdAt) next = job;
      }
      if (!next) return;
      next.status = 'running';
      next.startedAt = Date.now();
      this.running += 1;
      void this.runJob(next);
    }
  }

  private async runJob(job: McpJob): Promise<void> {
    const runner = this.runners.get(job.jobId);
    try {
      job.result = runner ? await runner(job.ctx, job.args, job.jobId) : {};
      job.status = 'done';
    } catch (e) {
      const err = e instanceof McpError ? e : null;
      job.error = {
        code: err?.code ?? 'E5005',
        message: sanitizeMessage(err?.message ?? (e instanceof Error ? e.message : String(e))),
      };
      job.status = 'failed';
    } finally {
      job.finishedAt = Date.now();
      this.running = Math.max(0, this.running - 1);
      this.runners.delete(job.jobId);
      this.evict();
      this.pump();
    }
  }

  /** TTL 驱逐 + 总数上限驱逐（按 createdAt 最早优先）。 */
  private evict(): void {
    const now = Date.now();
    const expired: McpJob[] = [];
    for (const job of this.jobs.values()) {
      const terminal = job.status === 'done' || job.status === 'failed';
      if (terminal && now - (job.finishedAt ?? job.createdAt) > this.options.ttlMs)
        expired.push(job);
    }
    for (const job of expired) this.remove(job.jobId);

    if (this.jobs.size <= this.options.max) return;
    const overflow = this.jobs.size - this.options.max;
    const candidates = [...this.jobs.values()]
      .filter((j) => j.status !== 'running')
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(0, overflow);
    for (const job of candidates) this.remove(job.jobId);
  }

  private remove(jobId: string): void {
    this.jobs.delete(jobId);
    this.runners.delete(jobId);
  }

  /** 清空（测试用）。 */
  reset(): void {
    this.jobs.clear();
    this.runners.clear();
    this.running = 0;
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}
