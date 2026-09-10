import { Controller, Get, Put, Body } from '@nestjs/common';
import { WorkspaceService, Workspace } from './workspace.service';
import { StorageService } from '../../common/storage.service';

@Controller('workspace')
export class WorkspaceController {
  private readonly workspaceService: WorkspaceService;

  constructor() {
    console.log('WorkspaceController constructor called');
    const storage = new StorageService();
    this.workspaceService = new WorkspaceService(storage);
    console.log('workspaceService:', this.workspaceService);
  }

  @Get()
  async getWorkspace(): Promise<Workspace> {
    return this.workspaceService.getWorkspace();
  }

  @Put()
  async updateWorkspace(@Body() body: { name: string }): Promise<Workspace> {
    return this.workspaceService.updateWorkspaceName(body.name);
  }
}
