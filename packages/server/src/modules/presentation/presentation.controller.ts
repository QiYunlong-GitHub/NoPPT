import { Controller, Get, Post, Put, Patch, Delete, Body, Param, NotFoundException } from '@nestjs/common';
import type { Presentation } from '@noppt/core';
import { PresentationService, PresentationListItem, ChatMessage } from './presentation.service';
import { getStorageService } from '../../common/storage.service';

@Controller('presentations')
export class PresentationController {
  private readonly presentationService: PresentationService;

  constructor() {
    this.presentationService = new PresentationService(getStorageService());
  }

  @Get()
  list(): PresentationListItem[] {
    return this.presentationService.list();
  }

  @Get(':id')
  async get(@Param('id') id: string): Promise<Presentation> {
    const presentation = await this.presentationService.get(id);
    if (!presentation) {
      throw new NotFoundException('演示文稿不存在');
    }
    return presentation;
  }

  @Post()
  async create(@Body() body?: { title?: string; width?: number; height?: number }): Promise<Presentation> {
    return this.presentationService.create(body?.title, body?.width, body?.height);
  }

  @Put(':id')
  async save(@Param('id') id: string, @Body() presentation: Presentation): Promise<Presentation> {
    return this.presentationService.save(id, presentation);
  }

  /**
   * 轻量更新：只更新元信息（标题、描述），避免前端发送大 body
   */
  @Patch(':id')
  async updateMeta(
    @Param('id') id: string,
    @Body() body: { title?: string; description?: string },
  ): Promise<Presentation> {
    return this.presentationService.updateMeta(id, body);
  }

  /**
   * 后端内部复制：避免前端把大 slides JSON 在 HTTP 上往返
   */
  @Post(':id/duplicate')
  async duplicate(@Param('id') id: string): Promise<Presentation> {
    return this.presentationService.duplicate(id);
  }

  @Delete(':id')
  delete(@Param('id') id: string): { success: boolean } {
    this.presentationService.delete(id);
    return { success: true };
  }

  @Delete()
  clearAll(): { success: boolean; count: number } {
    const count = this.presentationService.list().length;
    this.presentationService.clearAll();
    return { success: true, count };
  }

  @Get(':id/chat')
  getChatHistory(@Param('id') id: string): ChatMessage[] {
    return this.presentationService.getChatHistory(id);
  }

  @Put(':id/chat')
  async saveChatHistory(@Param('id') id: string, @Body() messages: ChatMessage[]): Promise<{ success: boolean }> {
    await this.presentationService.saveChatHistory(id, messages);
    return { success: true };
  }
}
