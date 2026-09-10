import { Module } from '@nestjs/common';
import { WorkspaceController } from './workspace.controller';
import { WorkspaceService } from './workspace.service';
import { StorageService, getStorageService } from '../../common/storage.service';

@Module({
  controllers: [WorkspaceController],
  providers: [
    WorkspaceService,
    // 用工厂提供而非类提供者：StorageService 构造函数带可选 `scope: string[]` 参数，
    // 走类提供者时 Nest 会尝试按 design:paramtypes 注入 `Array` 而报错。
    // 统一复用 `getStorageService()` 单例（无作用域），与其余控制器既有用法保持一致。
    { provide: StorageService, useFactory: (): StorageService => getStorageService() },
  ],
  exports: [WorkspaceService, StorageService],
})
export class WorkspaceModule {}
