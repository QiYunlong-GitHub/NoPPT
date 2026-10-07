import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { McpAuth } from '../auth/api-key.guard';
import { CurrentAuth } from '../auth/api-key.guard';
import { withRestContext } from '../../common/rest-context';
import { MAX_ASSET_UPLOAD_BYTES } from './assets.service';
import type { AssetInfo } from './assets.service';

const ACCEPTED_UPLOAD_MIME = /^(image\/(png|jpeg|jpg|gif|webp)|video\/(mp4|webm|ogg|quicktime))$/i;

@Controller('assets')
export class AssetsController {
  @Get(':presentationId')
  list(
    @Param('presentationId') presentationId: string,
    @Query('type') type: 'image' | 'video' | undefined,
    @CurrentAuth() auth?: McpAuth,
  ): Promise<AssetInfo[]> {
    if (type !== undefined && type !== 'image' && type !== 'video') {
      throw new BadRequestException('Invalid asset type');
    }
    return withRestContext(auth, ({ assetsService }) => assetsService.list(presentationId, type));
  }

  @Post(':presentationId/upload')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_ASSET_UPLOAD_BYTES, files: 1 },
      fileFilter: (_req, file, callback) => {
        if (!ACCEPTED_UPLOAD_MIME.test(file.mimetype || '')) {
          callback(new BadRequestException('Unsupported upload MIME type'), false);
          return;
        }
        callback(null, true);
      },
    }),
  )
  upload(
    @Param('presentationId') presentationId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('type') type: 'image' | 'video',
    @CurrentAuth() auth?: McpAuth,
  ): Promise<AssetInfo> {
    if (!file || !Buffer.isBuffer(file.buffer)) {
      throw new BadRequestException('Upload file is required');
    }
    if (type !== 'image' && type !== 'video') {
      throw new BadRequestException('Invalid asset type');
    }
    return withRestContext(auth, ({ assetsService }) => {
      try {
        return assetsService.upload(
          presentationId,
          type,
          file.originalname,
          file.buffer,
          file.mimetype,
        );
      } catch (error) {
        if (error instanceof BadRequestException) throw error;
        throw new BadRequestException(error instanceof Error ? error.message : 'Invalid upload');
      }
    });
  }

  @Delete(':presentationId/:type/:filename')
  async delete(
    @Param('presentationId') presentationId: string,
    @Param('type') type: 'image' | 'video',
    @Param('filename') filename: string,
    @CurrentAuth() auth?: McpAuth,
  ): Promise<{ success: boolean }> {
    if (type !== 'image' && type !== 'video') {
      throw new BadRequestException('Invalid asset type');
    }
    return withRestContext(auth, ({ assetsService }) => {
      assetsService.delete(presentationId, type, filename);
      return { success: true };
    });
  }
}
