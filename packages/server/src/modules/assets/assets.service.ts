import { Injectable } from '@nestjs/common';
import { StorageService } from '../../common/storage.service';
import { join } from 'path';
import { writeFileSync, existsSync, readFileSync } from 'fs';

export interface AssetInfo {
  id: string;
  name: string;
  type: 'image' | 'video';
  size: number;
  url: string;
  createdAt: number;
}

@Injectable()
export class AssetsService {
  constructor(private readonly storage: StorageService) {}

  list(presentationId: string, type?: 'image' | 'video'): AssetInfo[] {
    const imagesDir = this.storage.getImagesDir(presentationId);
    const videosDir = this.storage.getVideosDir(presentationId);
    const assets: AssetInfo[] = [];

    if (!type || type === 'image') {
      const images = this.storage.listDir(imagesDir);
      for (const img of images) {
        const filePath = join(imagesDir, img);
        const stats = require('fs').statSync(filePath);
        assets.push({
          id: img,
          name: img,
          type: 'image',
          size: stats.size,
          url: `/data/workspace/presentations/${presentationId}/assets/images/${img}`,
          createdAt: stats.birthtimeMs,
        });
      }
    }

    if (!type || type === 'video') {
      const videos = this.storage.listDir(videosDir);
      for (const vid of videos) {
        const filePath = join(videosDir, vid);
        const stats = require('fs').statSync(filePath);
        assets.push({
          id: vid,
          name: vid,
          type: 'video',
          size: stats.size,
          url: `/data/workspace/presentations/${presentationId}/assets/videos/${vid}`,
          createdAt: stats.birthtimeMs,
        });
      }
    }

    return assets.sort((a, b) => b.createdAt - a.createdAt);
  }

  upload(presentationId: string, type: 'image' | 'video', originalName: string, buffer: Buffer): AssetInfo {
    this.storage.ensurePresentationDir(presentationId);
    
    const ext = originalName.split('.').pop() || 'png';
    const id = `${this.storage.generateId()}.${ext}`;
    
    const dir = type === 'image' 
      ? this.storage.getImagesDir(presentationId)
      : this.storage.getVideosDir(presentationId);
    
    const filePath = join(dir, id);
    writeFileSync(filePath, buffer);

    const stats = require('fs').statSync(filePath);
    const typeDir = type === 'image' ? 'images' : 'videos';

    return {
      id,
      name: originalName,
      type,
      size: stats.size,
      url: `/data/workspace/presentations/${presentationId}/assets/${typeDir}/${id}`,
      createdAt: Date.now(),
    };
  }

  delete(presentationId: string, type: 'image' | 'video', filename: string): boolean {
    const dir = type === 'image' 
      ? this.storage.getImagesDir(presentationId)
      : this.storage.getVideosDir(presentationId);
    
    const filePath = join(dir, filename);
    if (existsSync(filePath)) {
      require('fs').unlinkSync(filePath);
      return true;
    }
    return false;
  }
}
