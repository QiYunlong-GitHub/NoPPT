import { Body, Controller, Get, Put } from '@nestjs/common';
import type { McpAuth } from '../auth/api-key.guard';
import { CurrentAuth } from '../auth/api-key.guard';
import { withRestContext } from '../../common/rest-context';
import type { Workspace } from './workspace.service';

@Controller('workspace')
export class WorkspaceController {
  @Get()
  async getWorkspace(@CurrentAuth() auth?: McpAuth): Promise<Workspace> {
    return withRestContext(auth, ({ workspaceService }) => workspaceService.getWorkspace());
  }

  @Put()
  async updateWorkspace(
    @Body() body: { name: string },
    @CurrentAuth() auth?: McpAuth,
  ): Promise<Workspace> {
    return withRestContext(auth, ({ workspaceService }) =>
      workspaceService.updateWorkspaceName(body.name),
    );
  }
}
