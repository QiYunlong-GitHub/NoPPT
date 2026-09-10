import { Injectable } from '@nestjs/common';
import {
  mkdirSync,
  existsSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  rmdirSync,
  statSync,
  promises as fs,
} from 'fs';
import { join, dirname } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { formatBeijingTime } from '@noppt/ai';
import { McpError } from './mcp-errors';

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

  /**
   * @param scope 可选作用域段数组，如 `['tenants','default','users','alice']`。
   *              缺省（或空数组）时行为与改造前完全一致：`<cwd>/data` + `<cwd>/data/workspace`。
   */
  constructor(scope?: string[]) {
    this.scope = (scope && scope.length ? scope : []).map((s) => sanitizeScopeSegment(s));
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
    return join(this.workspaceDir, 'presentations', presentationId);
  }

  getAssetsDir(presentationId: string): string {
    return join(this.getPresentationDir(presentationId), 'assets');
  }

  getImagesDir(presentationId: string): string {
    return join(this.getAssetsDir(presentationId), 'images');
  }

  getVideosDir(presentationId: string): string {
    return join(this.getAssetsDir(presentationId), 'videos');
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
    try {
      if (!existsSync(filePath)) return defaultValue;
      const content = readFileSync(filePath, 'utf-8');
      return JSON.parse(content) as T;
    } catch {
      return defaultValue;
    }
  }

  async writeJsonFile(filePath: string, data: any) {
    const dir = dirname(filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  async appendToLogFile(filePath: string, data: any) {
    const dir = dirname(filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const line = JSON.stringify(data);
    const existing = existsSync(filePath) ? readFileSync(filePath, 'utf-8') : '';
    await fs.writeFile(filePath, existing + (existing ? '\n' : '') + line, 'utf-8');
  }

  readLogFile(filePath: string): any[] {
    if (!existsSync(filePath)) return [];
    const content = readFileSync(filePath, 'utf-8');
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
    if (!existsSync(dirPath)) return [];
    return readdirSync(dirPath);
  }

  deleteDir(dirPath: string) {
    if (!existsSync(dirPath)) return;
    const files = readdirSync(dirPath);
    for (const file of files) {
      const filePath = join(dirPath, file);
      if (statSync(filePath).isDirectory()) {
        this.deleteDir(filePath);
      } else {
        unlinkSync(filePath);
      }
    }
    rmdirSync(dirPath);
  }

  generateId(): string {
    return uuidv4();
  }

  async saveImageFromUrl(presentationId: string, imageUrl: string): Promise<string> {
    this.ensurePresentationDir(presentationId);
    const imagesDir = this.getImagesDir(presentationId);

    console.log(
      `[${formatBeijingTime()}] [Storage] saveImageFromUrl called:`,
      imageUrl.substring(0, 150),
    );

    if (imageUrl.startsWith('data:')) {
      const mimeMatch = imageUrl.match(/^data:image\/(\w+);base64,/);
      const ext = mimeMatch ? mimeMatch[1] : 'png';
      const filename = `${uuidv4()}.${ext}`;
      const filePath = join(imagesDir, filename);
      const base64Data = imageUrl.split(',')[1];
      const buffer = Buffer.from(base64Data, 'base64');
      await fs.writeFile(filePath, buffer);
      console.log(`[${formatBeijingTime()}] [Storage] Saved base64 image:`, filename);
      return `${this.getPublicBase()}/presentations/${presentationId}/assets/images/${filename}`;
    } else {
      let cleanUrl = imageUrl.trim();
      cleanUrl = cleanUrl.replace(/\s+/g, '%20');

      try {
        cleanUrl = new URL(cleanUrl).toString();
      } catch (e) {
        console.warn(`[${formatBeijingTime()}] [Storage] URL parsing warning:`, e);
      }

      console.log(
        `[${formatBeijingTime()}] [Storage] Fetching image from:`,
        cleanUrl.substring(0, 150),
      );
      const response = await fetch(cleanUrl, {
        redirect: 'follow',
        headers: {
          Accept: 'image/*,*/*;q=0.8',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
      }

      const contentType = response.headers.get('content-type') || '';
      let ext = 'png';
      if (contentType.includes('jpeg') || contentType.includes('jpg')) {
        ext = 'jpg';
      } else if (contentType.includes('webp')) {
        ext = 'webp';
      } else if (contentType.includes('gif')) {
        ext = 'gif';
      } else if (contentType.includes('png')) {
        ext = 'png';
      }

      const filename = `${uuidv4()}.${ext}`;
      const filePath = join(imagesDir, filename);
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      if (buffer.length === 0) {
        throw new Error('Downloaded image is empty');
      }

      await fs.writeFile(filePath, buffer);
      console.log(
        `[${formatBeijingTime()}] [Storage] Saved image from URL:`,
        filename,
        'size:',
        buffer.length,
        'bytes',
        'content-type:',
        contentType,
      );
      return `${this.getPublicBase()}/presentations/${presentationId}/assets/images/${filename}`;
    }
  }

  // —— 跨步骤参考属性缓存（Task 3.5 / FR-14）——
  getReferenceAttrsPath(presentationId: string, hash: string): string {
    return join(this.getPresentationDir(presentationId), 'reference-attrs', `${hash}.json`);
  }

  async saveReferenceAttrs(presentationId: string, hash: string, data: any) {
    this.ensurePresentationDir(presentationId);
    await this.writeJsonFile(this.getReferenceAttrsPath(presentationId, hash), data);
  }

  loadReferenceAttrs(presentationId: string, hash: string): any | null {
    const p = this.getReferenceAttrsPath(presentationId, hash);
    return this.readJsonFile<any | null>(p, null);
  }

  /** 暂存参考图片原图副本（Q7 / FR-16 母版 LOGO 提取专用，不压缩），返回可访问 URL 及像素宽高 */
  async saveReferenceOriginalImage(
    presentationId: string,
    slot: 'cover' | 'content' | 'summary',
    dataUrl: string,
  ): Promise<{ url: string; width?: number; height?: number }> {
    this.ensurePresentationDir(presentationId);
    const dir = join(this.getPresentationDir(presentationId), 'reference-originals');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const mimeMatch = dataUrl.match(/^data:image\/(\w+);base64,/);
    const ext = mimeMatch ? mimeMatch[1] : 'png';
    // 固定文件名 + 写入前清理该槽位历史残留（旧 uuid 命名 `${slot}-*` 与新固定命名 `${slot}.*`），
    // 避免分步流程多次持久化同一批原图时累积孤儿文件（每次生成仅保留最新一份）。
    for (const f of readdirSync(dir)) {
      if (f.startsWith(`${slot}-`) || f.startsWith(`${slot}.`)) {
        try {
          unlinkSync(join(dir, f));
        } catch {
          /* ignore */
        }
      }
    }
    const filename = `${slot}.${ext}`;
    const filePath = join(dir, filename);
    const base64Data = dataUrl.split(',')[1];
    const buffer = Buffer.from(base64Data, 'base64');
    await fs.writeFile(filePath, buffer);
    // 零依赖解析 PNG/JPEG 头部宽高（供 LOGO 开窗按真实宽高比定尺），失败降级为 undefined 不抛错
    const { width, height } = parseImageDimensions(buffer);
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
    const dir = join(this.getPresentationDir(presentationId), 'reference-originals');
    if (!existsSync(dir)) return null;
    let filename: string | undefined;
    let buffer: Buffer | undefined;
    for (const f of readdirSync(dir)) {
      if (f === `${slot}.png` || f === `${slot}.jpeg` || f === `${slot}.jpg`) {
        filename = f;
        try {
          buffer = readFileSync(join(dir, f));
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
