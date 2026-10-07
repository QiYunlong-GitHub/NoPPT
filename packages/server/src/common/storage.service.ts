import { Injectable } from '@nestjs/common';
import {
  mkdirSync,
  existsSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  rmdirSync,
  statSync,
  lstatSync,
  promises as fs,
} from 'fs';
import { isIP } from 'net';
import { join, dirname } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { formatBeijingTime } from '@noppt/ai';
import { McpError } from './mcp-errors';
import { assertContainedPath, isSafeRegularFile, resolveContainedPath } from './path-security';
import { fetchPinnedRemoteImage, type RemoteImageFetcher } from './remote-image-fetcher';

export interface WorkspaceInfo {
  id: string;
  name: string;
  path: string;
  createdAt: number;
  updatedAt: number;
}

/** 作用域段白名单：仅 `[A-Za-z0-9_-]`，长度 1–64。天然拒绝 `.` `/` `%` 与中文，杜绝路径穿越。 */
const SCOPE_SEGMENT_RE = /^[A-Za-z0-9_-]{1,64}$/;
const SCOPE_SEGMENT_MAX = 64;

/**
 * Process-local write serialization shared by every StorageService instance.
 * The key is the resolved path so separately constructed scoped services still
 * serialize writes to the same JSON/JSONL file.
 */
const fileWriteLocks = new Map<string, Promise<void>>();

async function withSerializedFileWrite<T>(
  resolvedPath: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = fileWriteLocks.get(resolvedPath) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  const settled = current.then(
    () => undefined,
    () => undefined,
  );
  fileWriteLocks.set(resolvedPath, settled);
  try {
    return await current;
  } finally {
    if (fileWriteLocks.get(resolvedPath) === settled) fileWriteLocks.delete(resolvedPath);
  }
}

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_DATA_URL_CHARS = Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 128;
export const REMOTE_IMAGE_TIMEOUT_MS = 10_000;
const IMAGE_MIME_TO_EXTENSION: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

function assertSafePathSegment(value: unknown, field: string): string {
  if (
    typeof value !== 'string' ||
    !value ||
    value.includes('\0') ||
    value === '.' ||
    value === '..' ||
    value.includes('/') ||
    value.includes('\\') ||
    /^[A-Za-z]:/.test(value) ||
    value.startsWith('/')
  ) {
    throw new McpError('E3002', `${field} 参数非法`, { field });
  }
  return value;
}

function imageKind(buffer: Buffer): string | null {
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'png';
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpg';
  }
  if (
    (buffer.length >= 6 && buffer.subarray(0, 6).toString('ascii') === 'GIF87a') ||
    (buffer.length >= 6 && buffer.subarray(0, 6).toString('ascii') === 'GIF89a')
  ) {
    return 'gif';
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'webp';
  }
  return null;
}

function isMatchingImage(mime: string, buffer: Buffer): string | null {
  const normalized = mime.toLowerCase().split(';', 1)[0].trim();
  const extension = IMAGE_MIME_TO_EXTENSION[normalized];
  const kind = imageKind(buffer);
  if (!extension || !kind || extension !== kind) return null;
  return extension;
}

function isForbiddenRemoteHost(hostname: string): boolean {
  const host = hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host === 'metadata.google.internal' ||
    host === 'metadata'
  ) {
    return true;
  }

  const ipVersion = isIP(host);
  if (ipVersion === 4) {
    const octets = host.split('.').map(Number);
    const [a, b] = octets;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 0 || b === 168)) ||
      (a === 198 && ((b >= 18 && b <= 19) || b === 51)) ||
      (a === 203 && b === 0) ||
      a >= 224
    );
  }
  if (ipVersion === 6) {
    return (
      host === '::' ||
      host === '::1' ||
      host.startsWith('fc') ||
      host.startsWith('fd') ||
      host.startsWith('fe8') ||
      host.startsWith('fe9') ||
      host.startsWith('fea') ||
      host.startsWith('feb') ||
      host.startsWith('::ffff:')
    );
  }
  return false;
}

function decodeImageDataUrl(dataUrl: string): { buffer: Buffer; extension: string } {
  if (typeof dataUrl !== 'string' || dataUrl.length > MAX_DATA_URL_CHARS) {
    throw new Error('Image data URL exceeds the size limit');
  }
  const match = /^data:(image\/(?:png|jpeg|jpg|gif|webp));base64,([A-Za-z0-9+/]*={0,2})$/i.exec(
    dataUrl,
  );
  if (!match || !match[2] || match[2].length % 4 !== 0) {
    throw new Error('Invalid image data URL');
  }
  const encoded = match[2];
  const estimatedBytes =
    Math.floor((encoded.length * 3) / 4) -
    (encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0);
  if (estimatedBytes <= 0 || estimatedBytes > MAX_IMAGE_BYTES) {
    throw new Error('Image data URL exceeds the size limit');
  }
  const buffer = Buffer.from(encoded, 'base64');
  const extension = isMatchingImage(match[1], buffer);
  if (!extension || buffer.length > MAX_IMAGE_BYTES) {
    throw new Error('Invalid image data');
  }
  return { buffer, extension };
}

/**
 * 校验并返回一个合法的作用域目录段（规格 2.4.1）。
 * 放行：`alice` / `user-01` / `_dev` / `default`。
 * 拒绝：`..` / `../` / `%2e%2e` / `a/b` / 空串 / 超长（>64）/ 中文。
 * @throws McpError E4002
 */
export function sanitizeScopeSegment(value: unknown, field = 'scope'): string {
  const v = typeof value === 'string' ? value : '';
  if (!v) {
    throw new McpError('E4002', `${field} 不能为空`, { field });
  }
  if (v.length > SCOPE_SEGMENT_MAX) {
    throw new McpError('E4002', `${field} 超过 ${SCOPE_SEGMENT_MAX} 字符长度上限`, { field });
  }
  if (!SCOPE_SEGMENT_RE.test(v)) {
    throw new McpError('E4002', `${field} 只允许 [A-Za-z0-9_-] 字符`, { field });
  }
  return v;
}

/**
 * 按作用域段构造一个独立的 StorageService（规格 2.5.1 第 3 项）。
 * 每个 segment 都过 `sanitizeScopeSegment`，非法即抛错，不会落盘。
 */
export function createScopedStorage(...segments: string[]): StorageService {
  return new StorageService(segments);
}

@Injectable()
export class StorageService {
  private baseDir: string;
  private workspaceDir: string;
  private scope: string[];
  private remoteImageFetcher: RemoteImageFetcher;

  /**
   * @param scope 可选作用域段数组，如 `['tenants','default','users','alice']`。
   *              缺省（或空数组）时行为与改造前完全一致：`<cwd>/data` + `<cwd>/data/workspace`。
   */
  constructor(scope?: string[], options?: { remoteImageFetcher?: RemoteImageFetcher }) {
    this.scope = (scope && scope.length ? scope : []).map((s) => sanitizeScopeSegment(s));
    this.remoteImageFetcher = options?.remoteImageFetcher ?? fetchPinnedRemoteImage;
    this.baseDir = join(process.cwd(), 'data', ...this.scope);
    this.workspaceDir = join(this.baseDir, 'workspace');
    this.ensureDirs();
  }

  /** 当前作用域段（无作用域时为 `[]`）。 */
  getScope(): string[] {
    return [...this.scope];
  }

  /** 数据根（含 scope，不含 `workspace` 段）。 */
  getBaseDir(): string {
    return this.baseDir;
  }

  /**
   * 对外可访问的 URL 公共前缀（规格 2.5.1 第 4 项）。
   * 无作用域 → `/data/workspace`（与改造前硬编码前缀逐字符一致）；
   * 有作用域 → `/data/tenants/{t}/users/{u}/workspace`。
   */
  getPublicBase(): string {
    return this.scope.length ? `/data/${this.scope.join('/')}/workspace` : '/data/workspace';
  }

  private ensureDirs() {
    if (!existsSync(this.baseDir)) mkdirSync(this.baseDir, { recursive: true });
    if (!existsSync(this.workspaceDir)) mkdirSync(this.workspaceDir, { recursive: true });
  }

  getWorkspaceDir(): string {
    return this.workspaceDir;
  }

  getPresentationDir(presentationId: string): string {
    return resolveContainedPath(
      this.workspaceDir,
      'presentations',
      assertSafePathSegment(presentationId, 'presentationId'),
    );
  }

  getAssetsDir(presentationId: string): string {
    return resolveContainedPath(this.getPresentationDir(presentationId), 'assets');
  }

  getImagesDir(presentationId: string): string {
    return resolveContainedPath(this.getAssetsDir(presentationId), 'images');
  }

  getVideosDir(presentationId: string): string {
    return resolveContainedPath(this.getAssetsDir(presentationId), 'videos');
  }

  private safeFilePath(filePath: string): string {
    return assertContainedPath(this.baseDir, filePath);
  }

  private safeDirectoryPath(dirPath: string): string {
    return assertContainedPath(this.baseDir, dirPath);
  }

  ensurePresentationDir(presentationId: string) {
    const dir = this.getPresentationDir(presentationId);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const assetsDir = this.getAssetsDir(presentationId);
    if (!existsSync(assetsDir)) mkdirSync(assetsDir, { recursive: true });
    const imagesDir = this.getImagesDir(presentationId);
    if (!existsSync(imagesDir)) mkdirSync(imagesDir, { recursive: true });
    const videosDir = this.getVideosDir(presentationId);
    if (!existsSync(videosDir)) mkdirSync(videosDir, { recursive: true });
  }

  readJsonFile<T>(filePath: string, defaultValue: T): T {
    const safePath = this.safeFilePath(filePath);
    try {
      if (!existsSync(safePath)) return defaultValue;
      const content = readFileSync(safePath, 'utf-8');
      return JSON.parse(content) as T;
    } catch {
      return defaultValue;
    }
  }

  async writeJsonFile(filePath: string, data: unknown) {
    const safePath = this.safeFilePath(filePath);
    const dir = dirname(safePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const content = JSON.stringify(data, null, 2);
    await withSerializedFileWrite(safePath, async () => {
      const tempPath = `${safePath}.${uuidv4()}.tmp`;
      try {
        await fs.writeFile(tempPath, content, 'utf-8');
        await fs.rename(tempPath, safePath);
      } finally {
        if (existsSync(tempPath)) await fs.unlink(tempPath).catch(() => undefined);
      }
    });
  }

  async appendToLogFile(filePath: string, data: unknown) {
    const safePath = this.safeFilePath(filePath);
    const dir = dirname(safePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const line = JSON.stringify(data);
    await withSerializedFileWrite(safePath, async () => {
      const existing = existsSync(safePath) ? readFileSync(safePath, 'utf-8') : '';
      await fs.writeFile(safePath, existing + (existing ? '\n' : '') + line, 'utf-8');
    });
  }

  // Log entries intentionally remain dynamically shaped for existing callers.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readLogFile(filePath: string): any[] {
    const safePath = this.safeFilePath(filePath);
    if (!existsSync(safePath)) return [];
    const content = readFileSync(safePath, 'utf-8');
    if (!content.trim()) return [];
    return content
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }

  listDir(dirPath: string): string[] {
    const safePath = this.safeDirectoryPath(dirPath);
    if (!existsSync(safePath) || !statSync(safePath).isDirectory()) return [];
    return readdirSync(safePath);
  }

  deleteDir(dirPath: string) {
    const safePath = this.safeDirectoryPath(dirPath);
    if (!existsSync(safePath)) return;
    if (lstatSync(safePath).isSymbolicLink()) throw new Error('Invalid storage path');
    const files = readdirSync(safePath);
    for (const file of files) {
      const filePath = resolveContainedPath(safePath, file);
      if (lstatSync(filePath).isSymbolicLink()) throw new Error('Invalid storage path');
      if (statSync(filePath).isDirectory()) {
        this.deleteDir(filePath);
      } else {
        unlinkSync(filePath);
      }
    }
    rmdirSync(safePath);
  }

  generateId(): string {
    return uuidv4();
  }

  async saveImageFromUrl(presentationId: string, imageUrl: string): Promise<string> {
    this.ensurePresentationDir(presentationId);
    const imagesDir = this.getImagesDir(presentationId);
    const filename = `${uuidv4()}`;
    let extension: string;
    let buffer: Buffer;

    if (typeof imageUrl !== 'string' || /^data:/i.test(imageUrl)) {
      const decoded = decodeImageDataUrl(imageUrl);
      extension = decoded.extension;
      buffer = decoded.buffer;
      console.log(
        `[${formatBeijingTime()}] [Storage] Saved data URL image:`,
        `${filename}.${extension}`,
      );
    } else {
      const cleanUrl = imageUrl.trim().replace(/\s+/g, '%20');
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(cleanUrl);
      } catch {
        throw new Error('Invalid image URL');
      }
      if (
        !['http:', 'https:'].includes(parsedUrl.protocol) ||
        isForbiddenRemoteHost(parsedUrl.hostname)
      ) {
        throw new Error('Image URL destination is not allowed');
      }

      const controller = new AbortController();
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const fetchPromise = this.remoteImageFetcher(
          parsedUrl,
          controller.signal,
          MAX_IMAGE_BYTES,
          isForbiddenRemoteHost,
        );
        void fetchPromise.catch(() => undefined);
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeout = setTimeout(() => {
            controller.abort();
            reject(new Error('Image fetch timed out'));
          }, REMOTE_IMAGE_TIMEOUT_MS);
        });
        const response = await Promise.race([fetchPromise, timeoutPromise]);
        if (!response.ok) {
          throw new Error(`Failed to fetch image: ${response.status}`);
        }
        const contentType = response.headers.get('content-type') || '';
        const contentLength = Number(response.headers.get('content-length') || 0);
        if (contentLength > MAX_IMAGE_BYTES) {
          throw new Error('Downloaded image exceeds the size limit');
        }
        buffer = response.buffer;
        extension = isMatchingImage(contentType, buffer) || '';
        if (!extension) {
          throw new Error('Downloaded response is not a supported image');
        }
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    }

    const safeFilename = `${filename}.${extension}`;
    const filePath = resolveContainedPath(imagesDir, safeFilename);
    await fs.writeFile(filePath, buffer);
    console.log(
      `[${formatBeijingTime()}] [Storage] Saved image:`,
      safeFilename,
      'size:',
      buffer.length,
    );
    return `${this.getPublicBase()}/presentations/${presentationId}/assets/images/${safeFilename}`;
  }

  // —— 跨步骤参考属性缓存（Task 3.5 / FR-14）——
  getReferenceAttrsPath(presentationId: string, hash: string): string {
    return resolveContainedPath(
      this.getPresentationDir(presentationId),
      'reference-attrs',
      `${assertSafePathSegment(hash, 'hash')}.json`,
    );
  }

  async saveReferenceAttrs(presentationId: string, hash: string, data: unknown) {
    this.ensurePresentationDir(presentationId);
    await this.writeJsonFile(this.getReferenceAttrsPath(presentationId, hash), data);
  }

  loadReferenceAttrs(presentationId: string, hash: string): unknown | null {
    const p = this.getReferenceAttrsPath(presentationId, hash);
    return this.readJsonFile<unknown | null>(p, null);
  }

  /** 暂存参考图片原图副本（Q7 / FR-16 母版 LOGO 提取专用，不压缩），返回可访问 URL 及像素宽高 */
  async saveReferenceOriginalImage(
    presentationId: string,
    slot: 'cover' | 'content' | 'summary',
    dataUrl: string,
  ): Promise<{ url: string; width?: number; height?: number }> {
    this.ensurePresentationDir(presentationId);
    const dir = resolveContainedPath(
      this.getPresentationDir(presentationId),
      'reference-originals',
    );
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const decoded = decodeImageDataUrl(dataUrl);
    const ext = decoded.extension;
    // 固定文件名 + 写入前清理该槽位历史残留（旧 uuid 命名 `${slot}-*` 与新固定命名 `${slot}.*`），
    // 避免分步流程多次持久化同一批原图时累积孤儿文件（每次生成仅保留最新一份）。
    const safeSlot = assertSafePathSegment(slot, 'slot');
    for (const f of readdirSync(dir)) {
      if (f.startsWith(`${safeSlot}-`) || f.startsWith(`${safeSlot}.`)) {
        try {
          unlinkSync(resolveContainedPath(dir, f));
        } catch {
          /* ignore */
        }
      }
    }
    const filename = `${safeSlot}.${ext}`;
    const filePath = resolveContainedPath(dir, filename);
    await fs.writeFile(filePath, decoded.buffer);
    // 零依赖解析 PNG/JPEG 头部宽高（供 LOGO 开窗按真实宽高比定尺），失败降级为 undefined 不抛错
    const { width, height } = parseImageDimensions(decoded.buffer);
    return {
      url: `${this.getPublicBase()}/presentations/${presentationId}/reference-originals/${filename}`,
      width,
      height,
    };
  }

  /**
   * 读取已落盘的参考原图信息（URL + 像素宽高）。
   * 用于「分步生成 / 缓存命中」场景：本轮未重新上传原图 dataURL，但上一轮已落盘，
   * 仍可直接复用磁盘文件 URL 与尺寸，避免 content/summary 的 master.logo.src 跨步骤丢失。
   * 文件不存在返回 null。
   */
  readReferenceOriginalImage(
    presentationId: string,
    slot: 'cover' | 'content' | 'summary',
  ): { url: string; width?: number; height?: number } | null {
    const dir = resolveContainedPath(
      this.getPresentationDir(presentationId),
      'reference-originals',
    );
    if (!existsSync(dir)) return null;
    const safeSlot = assertSafePathSegment(slot, 'slot');
    let filename: string | undefined;
    let buffer: Buffer | undefined;
    for (const f of readdirSync(dir)) {
      if (f === `${safeSlot}.png` || f === `${safeSlot}.jpeg` || f === `${safeSlot}.jpg`) {
        try {
          const safeFile = resolveContainedPath(dir, f);
          if (!isSafeRegularFile(safeFile)) continue;
          filename = f;
          buffer = readFileSync(safeFile);
        } catch {
          buffer = undefined;
        }
        break;
      }
    }
    if (!filename) return null;
    const { width, height } = buffer ? parseImageDimensions(buffer) : {};
    return {
      url: `${this.getPublicBase()}/presentations/${presentationId}/reference-originals/${filename}`,
      width,
      height,
    };
  }
}

/**
 * 零依赖解析图片像素宽高（只读头部，O(1)）：
 * - PNG：IHDR 在固定偏移 16 处（width=16..20, height=20..24，大端 4 字节）。
 * - JPEG：扫描 SOF0~SOF15（除 SOF4/8/12 保留段）取出精度后两字节宽高。
 * 解析失败返回 {undefined,undefined}，调用方按退化策略处理（绝不抛错中断生成）。
 */
function parseImageDimensions(buf: Buffer): { width?: number; height?: number } {
  try {
    if (
      buf.length >= 24 &&
      buf[0] === 0x89 &&
      buf[1] === 0x50 &&
      buf[2] === 0x4e &&
      buf[3] === 0x47
    ) {
      const width = buf.readUInt32BE(16);
      const height = buf.readUInt32BE(20);
      if (width > 0 && height > 0) return { width, height };
      return {};
    }
    if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
      let i = 2;
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) {
          i++;
          continue;
        }
        const marker = buf[i + 1];
        // SOF markers：0xC0-0xC3, 0xC5-0xC7, 0xC9-0xCB, 0xCD-0xCF（排除 0xC4/0xC8/0xCC=表格类）
        const isSof =
          (marker >= 0xc0 && marker <= 0xc3) ||
          (marker >= 0xc5 && marker <= 0xc7) ||
          (marker >= 0xc9 && marker <= 0xcb) ||
          (marker >= 0xcd && marker <= 0xcf);
        if (isSof) {
          const height = buf.readUInt16BE(i + 5);
          const width = buf.readUInt16BE(i + 7);
          if (width > 0 && height > 0) return { width, height };
          return {};
        }
        // 跳到下一个 marker（长度段为后续 2 字节大端）
        const segLen = buf.readUInt16BE(i + 2);
        i += 2 + segLen;
      }
      return {};
    }
  } catch {
    /* ignore */
  }
  return {};
}

let storageServiceInstance: StorageService | null = null;

export function getStorageService(): StorageService {
  if (!storageServiceInstance) {
    storageServiceInstance = new StorageService();
  }
  return storageServiceInstance;
}
