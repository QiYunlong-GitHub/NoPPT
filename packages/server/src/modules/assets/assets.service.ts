import { Injectable } from '@nestjs/common';
import { existsSync, lstatSync, statSync, unlinkSync, writeFileSync } from 'fs';
import { extname } from 'path';
import { StorageService } from '../../common/storage.service';
import { isSafeRegularFile, resolveContainedPath } from '../../common/path-security';

export interface AssetInfo {
  id: string;
  name: string;
  type: 'image' | 'video';
  size: number;
  url: string;
  createdAt: number;
}

export const MAX_ASSET_UPLOAD_BYTES = 25 * 1024 * 1024;

const IMAGE_UPLOADS: Record<string, string[]> = {
  png: ['image/png'],
  jpg: ['image/jpeg', 'image/jpg'],
  jpeg: ['image/jpeg', 'image/jpg'],
  gif: ['image/gif'],
  webp: ['image/webp'],
};
const VIDEO_UPLOADS: Record<string, string[]> = {
  mp4: ['video/mp4'],
  webm: ['video/webm'],
  ogg: ['video/ogg'],
  ogv: ['video/ogg'],
  mov: ['video/quicktime'],
};

function hasImageSignature(buffer: Buffer, extension: string): boolean {
  if (extension === 'png') {
    return (
      buffer.length >= 8 &&
      buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    );
  }
  if (extension === 'jpg' || extension === 'jpeg') {
    return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (extension === 'gif')
    return buffer.length >= 6 && /^(GIF87a|GIF89a)$/.test(buffer.subarray(0, 6).toString('ascii'));
  if (extension === 'webp') {
    return (
      buffer.length >= 12 &&
      buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buffer.subarray(8, 12).toString('ascii') === 'WEBP'
    );
  }
  return false;
}

@Injectable()
export class AssetsService {
  constructor(private readonly storage: StorageService) {}

  list(presentationId: string, type?: 'image' | 'video'): AssetInfo[] {
    const imagesDir = this.storage.getImagesDir(presentationId);
    const videosDir = this.storage.getVideosDir(presentationId);
    const assets: AssetInfo[] = [];
    const publicBase = this.storage.getPublicBase();

    if (!type || type === 'image') {
      for (const img of this.storage.listDir(imagesDir)) {
        try {
          const filePath = resolveContainedPath(imagesDir, img);
          if (!isSafeRegularFile(filePath)) continue;
          const stats = statSync(filePath);
          assets.push({
            id: img,
            name: img,
            type: 'image',
            size: stats.size,
            url: `${publicBase}/presentations/${presentationId}/assets/images/${img}`,
            createdAt: stats.birthtimeMs,
          });
        } catch {
          // Ignore entries that disappear or fail containment during enumeration.
        }
      }
    }

    if (!type || type === 'video') {
      for (const vid of this.storage.listDir(videosDir)) {
        try {
          const filePath = resolveContainedPath(videosDir, vid);
          if (!isSafeRegularFile(filePath)) continue;
          const stats = statSync(filePath);
          assets.push({
            id: vid,
            name: vid,
            type: 'video',
            size: stats.size,
            url: `${publicBase}/presentations/${presentationId}/assets/videos/${vid}`,
            createdAt: stats.birthtimeMs,
          });
        } catch {
          // Ignore entries that disappear or fail containment during enumeration.
        }
      }
    }

    return assets.sort((a, b) => b.createdAt - a.createdAt);
  }

  upload(
    presentationId: string,
    type: 'image' | 'video',
    originalName: string,
    buffer: Buffer,
    mimetype?: string,
  ): AssetInfo {
    if (type !== 'image' && type !== 'video') throw new Error('Invalid asset type');
    if (!Buffer.isBuffer(buffer) || buffer.length === 0)
      throw new Error('Uploaded file is missing');
    if (buffer.length > MAX_ASSET_UPLOAD_BYTES)
      throw new Error('Uploaded file exceeds the size limit');
    if (typeof originalName !== 'string' || !originalName || originalName.includes('\0')) {
      throw new Error('Invalid uploaded filename');
    }

    const extension = extname(originalName).slice(1).toLowerCase();
    const allowed = type === 'image' ? IMAGE_UPLOADS : VIDEO_UPLOADS;
    const allowedMimes = allowed[extension];
    if (!allowedMimes) throw new Error('Unsupported file extension');
    const normalizedMime = (mimetype || allowedMimes[0]).toLowerCase().split(';', 1)[0].trim();
    if (!allowedMimes.includes(normalizedMime))
      throw new Error('MIME type does not match file extension');
    if (type === 'image' && !hasImageSignature(buffer, extension)) {
      throw new Error('Uploaded file is not a valid image');
    }

    this.storage.ensurePresentationDir(presentationId);
    const id = `${this.storage.generateId()}.${extension}`;
    if (!/^[0-9a-f-]{36}\.(png|jpe?g|gif|webp|mp4|webm|og[gvt]|mov)$/i.test(id)) {
      throw new Error('Invalid generated asset name');
    }
    const dir =
      type === 'image'
        ? this.storage.getImagesDir(presentationId)
        : this.storage.getVideosDir(presentationId);
    const filePath = resolveContainedPath(dir, id);
    writeFileSync(filePath, buffer, { flag: 'wx' });
    const stats = statSync(filePath);
    const typeDir = type === 'image' ? 'images' : 'videos';

    return {
      id,
      name: originalName,
      type,
      size: stats.size,
      url: `${this.storage.getPublicBase()}/presentations/${presentationId}/assets/${typeDir}/${id}`,
      createdAt: Date.now(),
    };
  }

  delete(presentationId: string, type: 'image' | 'video', filename: string): boolean {
    if (type !== 'image' && type !== 'video') throw new Error('Invalid asset type');
    const dir =
      type === 'image'
        ? this.storage.getImagesDir(presentationId)
        : this.storage.getVideosDir(presentationId);
    const filePath = resolveContainedPath(dir, filename);
    if (!existsSync(filePath)) return false;
    if (lstatSync(filePath).isSymbolicLink() || !isSafeRegularFile(filePath)) {
      throw new Error('Invalid asset path');
    }
    unlinkSync(filePath);
    return true;
  }
}
