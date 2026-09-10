import { Injectable, NotFoundException } from '@nestjs/common';
import type { Presentation, Slide } from '@noppt/core';
import { LayoutEngine } from '@noppt/core';
import { StorageService } from '../../common/storage.service';
import { sanitizeHtmlServerSide } from '../../utils/sanitize';
import { join } from 'path';
import { readFileSync, existsSync } from 'fs';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  scope: 'current' | 'global';
}

export interface PresentationListItem {
  id: string;
  title: string;
  description?: string;
  createdAt: number;
  updatedAt: number;
  thumbnail?: string;
  slideCount: number;
}

@Injectable()
export class PresentationService {
  constructor(private readonly storage: StorageService) {}

  list(): PresentationListItem[] {
    const presentationsDir = join(this.storage.getWorkspaceDir(), 'presentations');
    const dirs = this.storage.listDir(presentationsDir);
    
    const presentations: PresentationListItem[] = [];
    for (const dir of dirs) {
      const metaFile = join(presentationsDir, dir, 'presentation.json');
      const data = this.storage.readJsonFile<Presentation>(metaFile, null);
      if (data) {
        presentations.push({
          id: data.id,
          title: data.title,
          description: data.description,
          createdAt: data.createdAt,
          updatedAt: data.updatedAt,
          thumbnail: data.thumbnail,
          slideCount: data.slides?.length || 0,
        });
      }
    }
    
    return presentations.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async get(id: string): Promise<Presentation | null> {
    const presentationFile = join(this.storage.getPresentationDir(id), 'presentation.json');
    const data = this.storage.readJsonFile<Presentation>(presentationFile, null);
    if (!data) return null;
    let changed = false;
    const normalizedSlides = data.slides.map((slide) => {
      const normalized = LayoutEngine.normalizeAISlide(slide);
      const sanitizedHtml = sanitizeHtmlServerSide(normalized.html);
      if (sanitizedHtml !== normalized.html) {
        normalized.html = sanitizedHtml;
        changed = true;
      }
      if (normalized.html !== slide.html) changed = true;
      return normalized;
    });
    if (changed) {
      data.slides = normalizedSlides;
      await this.storage.writeJsonFile(presentationFile, { ...data, updatedAt: Date.now() });
    }
    return { ...data, slides: normalizedSlides };
  }

  async create(title?: string, width?: number, height?: number): Promise<Presentation> {
    const presentation = LayoutEngine.createPresentation(title, width, height);
    this.storage.ensurePresentationDir(presentation.id);

    // 统一走 normalizeAISlide，保证和 get/save 路径的 slide.html 格式一致
    const normalizedSlides = presentation.slides.map((slide) => {
      const normalized = LayoutEngine.normalizeAISlide(slide);
      normalized.html = sanitizeHtmlServerSide(normalized.html);
      return normalized;
    });
    const normalizedPresentation = { ...presentation, slides: normalizedSlides };

    const presentationFile = join(this.storage.getPresentationDir(presentation.id), 'presentation.json');
    await this.storage.writeJsonFile(presentationFile, normalizedPresentation);

    const defaultMessages: ChatMessage[] = [
      {
        id: '1',
        role: 'assistant',
        content: '你好！我是你的 AI 演示助手。你可以告诉我怎么修改当前页面，或者对整个演示进行调整。想试试什么？',
        scope: 'current',
      },
    ];

    const chatFile = join(this.storage.getPresentationDir(presentation.id), 'chat-history.json');
    await this.storage.writeJsonFile(chatFile, defaultMessages);

    return normalizedPresentation;
  }

  async save(id: string, presentation: Presentation): Promise<Presentation> {
    this.storage.ensurePresentationDir(id);
    const presentationFile = join(this.storage.getPresentationDir(id), 'presentation.json');
    const sanitizedSlides = presentation.slides.map((slide) => ({
      ...slide,
      html: sanitizeHtmlServerSide(slide.html),
    }));
    const updated = { ...presentation, slides: sanitizedSlides, updatedAt: Date.now() };
    await this.storage.writeJsonFile(presentationFile, updated);
    return updated;
  }

  /**
   * 轻量更新：只更新元信息（标题、描述等），不重写整个 slides body
   * 避免前端 PUT 大 body（12页HTML）时触发代理 EPIPE / 超时
   */
  async updateMeta(id: string, meta: { title?: string; description?: string }): Promise<Presentation> {
    const presentationFile = join(this.storage.getPresentationDir(id), 'presentation.json');
    const existing = this.storage.readJsonFile<Presentation>(presentationFile, null);
    if (!existing) {
      throw new NotFoundException('演示文稿不存在');
    }
    const updated = {
      ...existing,
      ...(meta.title !== undefined ? { title: meta.title } : {}),
      ...(meta.description !== undefined ? { description: meta.description } : {}),
      updatedAt: Date.now(),
    };
    await this.storage.writeJsonFile(presentationFile, updated);
    return updated;
  }

  /**
   * 后端内部完成复制：避免前端把大 slides JSON 在 HTTP 上往返
   */
  async duplicate(id: string): Promise<Presentation> {
    const original = await this.get(id);
    if (!original) {
      throw new NotFoundException('演示文稿不存在');
    }
    const newPres = await this.create(
      `${original.title} - 副本`,
      original.width,
      original.height,
    );
    const now = Date.now();
    const newSlides: any[] = original.slides.map((slide, i) => ({
      ...slide,
      id: `${now}-${Math.random().toString(36).slice(2, 9)}-${i}`,
      index: i,
      createdAt: now,
      updatedAt: now,
    }));
    const updatedPres: Presentation = {
      ...newPres,
      slides: newSlides,
      selectedSlideId: newSlides[0]?.id,
      transition: original.transition,
      zoom: original.zoom,
      description: original.description,
      author: original.author,
      tags: original.tags,
      updatedAt: now,
    };
    return this.save(newPres.id, updatedPres);
  }

  delete(id: string): void {
    const dir = this.storage.getPresentationDir(id);
    this.storage.deleteDir(dir);
  }

  clearAll(): void {
    const presentationsDir = join(this.storage.getWorkspaceDir(), 'presentations');
    const dirs = this.storage.listDir(presentationsDir);
    for (const dir of dirs) {
      const fullPath = join(presentationsDir, dir);
      this.storage.deleteDir(fullPath);
    }
  }

  getChatHistory(id: string): ChatMessage[] {
    const chatFile = join(this.storage.getPresentationDir(id), 'chat-history.json');
    return this.storage.readJsonFile<ChatMessage[]>(chatFile, []);
  }

  async saveChatHistory(id: string, messages: ChatMessage[]): Promise<void> {
    this.storage.ensurePresentationDir(id);
    const chatFile = join(this.storage.getPresentationDir(id), 'chat-history.json');
    await this.storage.writeJsonFile(chatFile, messages);
  }
}
