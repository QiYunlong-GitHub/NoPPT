import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  UseInterceptors,
  UploadedFile,
  Body,
  Query,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AssetsService, AssetInfo } from './assets.service';
import { getStorageService } from '../../common/storage.service';

@Controller('assets')
export class AssetsController {
  private readonly assetsService: AssetsService;

  constructor() {
    this.assetsService = new AssetsService(getStorageService());
  }

  @Get(':presentationId')
  list(
    @Param('presentationId') presentationId: string,
    @Query('type') type?: 'image' | 'video',
  ): AssetInfo[] {
    return this.assetsService.list(presentationId, type);
  }

  @Post(':presentationId/upload')
  @UseInterceptors(FileInterceptor('file'))
  upload(
    @Param('presentationId') presentationId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('type') type: 'image' | 'video',
  ): AssetInfo {
    return this.assetsService.upload(
      presentationId,
      type || 'image',
      file.originalname,
      file.buffer,
    );
  }

  @Delete(':presentationId/:type/:filename')
  delete(
    @Param('presentationId') presentationId: string,
    @Param('type') type: 'image' | 'video',
    @Param('filename') filename: string,
  ): { success: boolean } {
    this.assetsService.delete(presentationId, type, filename);
    return { success: true };
  }
}
