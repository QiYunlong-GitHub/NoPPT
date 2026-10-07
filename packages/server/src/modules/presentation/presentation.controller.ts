import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import type { Presentation } from '@noppt/core';
import type { McpAuth } from '../auth/api-key.guard';
import { CurrentAuth } from '../auth/api-key.guard';
import { withRestContext } from '../../common/rest-context';
import type { ChatMessage, PresentationListItem } from './presentation.service';

@Controller('presentations')
export class PresentationController {
  @Get()
  list(@CurrentAuth() auth?: McpAuth): Promise<PresentationListItem[]> {
    return withRestContext(auth, ({ presentationService }) => presentationService.list());
  }

  @Get(':id')
  async get(@Param('id') id: string, @CurrentAuth() auth?: McpAuth): Promise<Presentation> {
    const presentation = await withRestContext(auth, ({ presentationService }) =>
      presentationService.get(id),
    );
    if (!presentation) throw new NotFoundException('演示文稿不存在');
    return presentation;
  }

  @Post()
  create(
    @Body() body: { title?: string; width?: number; height?: number } | undefined,
    @CurrentAuth() auth?: McpAuth,
  ): Promise<Presentation> {
    return withRestContext(auth, ({ presentationService }) =>
      presentationService.create(body?.title, body?.width, body?.height),
    );
  }

  @Put(':id')
  save(
    @Param('id') id: string,
    @Body() presentation: Presentation,
    @CurrentAuth() auth?: McpAuth,
  ): Promise<Presentation> {
    return withRestContext(auth, ({ presentationService }) =>
      presentationService.save(id, presentation),
    );
  }

  @Patch(':id')
  updateMeta(
    @Param('id') id: string,
    @Body() body: { title?: string; description?: string },
    @CurrentAuth() auth?: McpAuth,
  ): Promise<Presentation> {
    return withRestContext(auth, ({ presentationService }) =>
      presentationService.updateMeta(id, body),
    );
  }

  @Post(':id/duplicate')
  duplicate(@Param('id') id: string, @CurrentAuth() auth?: McpAuth): Promise<Presentation> {
    return withRestContext(auth, ({ presentationService }) => presentationService.duplicate(id));
  }

  @Delete(':id')
  async delete(
    @Param('id') id: string,
    @CurrentAuth() auth?: McpAuth,
  ): Promise<{ success: boolean }> {
    await withRestContext(auth, ({ presentationService }) => presentationService.delete(id));
    return { success: true };
  }

  @Delete()
  async clearAll(@CurrentAuth() auth?: McpAuth): Promise<{ success: boolean; count: number }> {
    return withRestContext(auth, ({ presentationService }) => {
      const count = presentationService.list().length;
      presentationService.clearAll();
      return { success: true, count };
    });
  }

  @Get(':id/chat')
  getChatHistory(@Param('id') id: string, @CurrentAuth() auth?: McpAuth): Promise<ChatMessage[]> {
    return withRestContext(auth, ({ presentationService }) =>
      presentationService.getChatHistory(id),
    );
  }

  @Put(':id/chat')
  async saveChatHistory(
    @Param('id') id: string,
    @Body() messages: ChatMessage[],
    @CurrentAuth() auth?: McpAuth,
  ): Promise<{ success: boolean }> {
    await withRestContext(auth, ({ presentationService }) =>
      presentationService.saveChatHistory(id, messages),
    );
    return { success: true };
  }
}
