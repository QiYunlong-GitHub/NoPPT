import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { existsSync, promises as fs, readFileSync } from 'fs';
import { dirname, join } from 'path';

/**
 * API Key 服务（规格 2.5.2 / FR-1 / FR-2）。
 *
 * 安全约束：
 * - 明文 Key（`nppt_` + 32 hex）**仅在 createKey 返回值中出现一次**，落盘只存 `sha256:<hex>`；
 * - `apikeys.json` 为服务器级凭据（规格 2.4.3），**不随租户/用户隔离**；
 * - 单文件并发读-改-写用「进程内写锁 + 临时文件 rename」保证原子性。
 */

export interface RateLimitBucketConfig {
  limit: number;
  windowMs: number;
}

export interface ApiKeyRecord {
  id: string;
  name: string;
  tenantId: string;
  userKey: string;
  enabled: boolean;
  /** `sha256:<hex>`，明文永不落盘 */
  keyHash: string;
  rateLimit?: {
    generate?: RateLimitBucketConfig;
    edit?: RateLimitBucketConfig;
  };
  createdAt: number;
  lastUsedAt?: number;
}

/** 脱敏后的 Key 记录：不含 keyHash，可安全返回给管理端。 */
export type PublicApiKeyRecord = Omit<ApiKeyRecord, 'keyHash'>;

export interface CreateKeyInput {
  name: string;
  tenantId?: string;
  userKey?: string;
  rateLimit?: ApiKeyRecord['rateLimit'];
}

export interface CreateKeyResult {
  /** 明文 Key，仅此一次 */
  key: string;
  record: PublicApiKeyRecord;
}

interface ApiKeyFile {
  keys: ApiKeyRecord[];
}

const KEY_PREFIX = 'nppt_';
const KEY_PATTERN = /^nppt_[0-9a-f]{32}$/;

function hashKey(raw: string): string {
  return `sha256:${createHash('sha256').update(raw).digest('hex')}`;
}

export function generatePlainKey(): string {
  return `${KEY_PREFIX}${randomBytes(16).toString('hex')}`;
}

export function isPlainKeyFormat(raw: string): boolean {
  return typeof raw === 'string' && KEY_PATTERN.test(raw);
}

function toPublic(record: ApiKeyRecord): PublicApiKeyRecord {
  const { keyHash, ...rest } = record;
  void keyHash;
  return rest;
}

@Injectable()
export class ApiKeyService {
  private readonly logger = new Logger(ApiKeyService.name);
  /** 串行化所有写操作，避免并发读-改-写互相覆盖。 */
  private writeChain: Promise<unknown> = Promise.resolve();

  /** 惰性取路径：以 cwd 为基准，便于单测通过 mock cwd 隔离数据目录。 */
  private get filePath(): string {
    return join(process.cwd(), 'data', 'apikeys.json');
  }

  private readFileSyncSafe(): ApiKeyFile {
    try {
      if (!existsSync(this.filePath)) return { keys: [] };
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf-8')) as ApiKeyFile;
      if (!parsed || !Array.isArray(parsed.keys)) return { keys: [] };
      return parsed;
    } catch {
      this.logger.warn('apikeys.json 解析失败，按空表处理');
      return { keys: [] };
    }
  }

  /** 原子写：先写临时文件再 rename，杜绝中途读到半写文件。 */
  private async writeFileAtomic(data: ApiKeyFile): Promise<void> {
    const target = this.filePath;
    await fs.mkdir(dirname(target), { recursive: true });
    const tmp = `${target}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8');
    await fs.rename(tmp, target);
  }

  private withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.writeChain.then(fn, fn);
    this.writeChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async createKey(input: CreateKeyInput): Promise<CreateKeyResult> {
    const name = String(input?.name || '').trim();
    if (!name) throw new Error('name 必填');
    const tenantId = String(input?.tenantId || 'default').trim() || 'default';
    const userKey = String(input?.userKey || 'default').trim() || 'default';
    const plain = generatePlainKey();
    const record: ApiKeyRecord = {
      id: `k_${randomBytes(8).toString('hex')}`,
      name,
      tenantId,
      userKey,
      enabled: true,
      keyHash: hashKey(plain),
      createdAt: Date.now(),
    };
    if (input?.rateLimit) record.rateLimit = input.rateLimit;

    await this.withWriteLock(async () => {
      const file = this.readFileSyncSafe();
      file.keys.push(record);
      await this.writeFileAtomic(file);
    });

    return { key: plain, record: toPublic(record) };
  }

  /** 按明文 Key 定位记录（**不检查 enabled**，用于区分「无效」与「已禁用」）。 */
  locateByRawKeySync(raw: string): ApiKeyRecord | null {
    if (!isPlainKeyFormat(raw)) return null;
    const hash = hashKey(raw);
    return this.readFileSyncSafe().keys.find((k) => k.keyHash === hash) || null;
  }

  /** 异步刷新最近使用时间（审计字段，失败静默）。 */
  touchKey(id: string): void {
    void this.withWriteLock(async () => {
      const file = this.readFileSyncSafe();
      const target = file.keys.find((k) => k.id === id);
      if (!target) return;
      target.lastUsedAt = Date.now();
      await this.writeFileAtomic(file);
    }).catch(() => undefined);
  }

  /** 校验明文 Key。命中且启用返回记录（含 keyHash，仅供内部使用）；否则 null。 */
  verifyKeySync(raw: string): ApiKeyRecord | null {
    if (!isPlainKeyFormat(raw)) return null;
    const hash = hashKey(raw);
    const record = this.readFileSyncSafe().keys.find((k) => k.keyHash === hash);
    if (!record) return null;
    if (!record.enabled) return null;
    return record;
  }

  /**
   * 校验并异步刷新 lastUsedAt。
   * 返回 null 表示无效 / 禁用 Key。
   */
  async verifyKey(raw: string): Promise<ApiKeyRecord | null> {
    const record = this.verifyKeySync(raw);
    if (!record) return null;
    // 刷新最近使用时间：失败不影响鉴权结果（审计性质字段）
    void this.withWriteLock(async () => {
      const file = this.readFileSyncSafe();
      const target = file.keys.find((k) => k.id === record.id);
      if (!target) return;
      target.lastUsedAt = Date.now();
      await this.writeFileAtomic(file);
    }).catch(() => undefined);
    return record;
  }

  listKeys(): PublicApiKeyRecord[] {
    return this.readFileSyncSafe().keys.map(toPublic);
  }

  async revokeKey(id: string): Promise<boolean> {
    return this.withWriteLock(async () => {
      const file = this.readFileSyncSafe();
      const target = file.keys.find((k) => k.id === id);
      if (!target) return false;
      target.enabled = false;
      await this.writeFileAtomic(file);
      return true;
    });
  }

  /** 启动引导：存在 NOPPT_DEV_KEY 时确保存在名为 dev 的 Key（联调用）。 */
  async ensureDevKey(devKeyEnv: string): Promise<PublicApiKeyRecord | null> {
    if (!devKeyEnv) return null;
    const existing = this.readFileSyncSafe().keys.find((k) => k.name === 'dev');
    if (existing) return toPublic(existing);

    // 若环境变量本身即合法明文 Key，则直接采用（便于联调确定性配置）；否则随机生成。
    if (isPlainKeyFormat(devKeyEnv)) {
      const record: ApiKeyRecord = {
        id: `k_${randomBytes(8).toString('hex')}`,
        name: 'dev',
        tenantId: 'default',
        userKey: 'default',
        enabled: true,
        keyHash: hashKey(devKeyEnv),
        createdAt: Date.now(),
      };
      await this.withWriteLock(async () => {
        const file = this.readFileSyncSafe();
        if (file.keys.some((k) => k.name === 'dev')) return;
        file.keys.push(record);
        await this.writeFileAtomic(file);
      });
      this.logger.log(`已按 NOPPT_DEV_KEY 引导 dev Key：${record.id}`);
      return toPublic(record);
    }

    const created = await this.createKey({ name: 'dev', tenantId: 'default', userKey: 'default' });
    this.logger.warn(`已自动生成 dev Key（仅本次启动可见明文）：${created.key}`);
    return created.record;
  }
}
