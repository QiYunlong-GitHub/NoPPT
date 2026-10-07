import { Injectable } from '@nestjs/common';
import { StorageService } from '../../common/storage.service';
import { join } from 'path';

export interface Workspace {
  id: string;
  name: string;
  path: string;
  createdAt: number;
  updatedAt: number;
  presentationCount: number;
}

interface WorkspaceMeta {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

@Injectable()
export class WorkspaceService {
  constructor(private readonly storage: StorageService) {}

  async getWorkspace(): Promise<Workspace> {
    const workspaceDir = this.storage.getWorkspaceDir();
    const presentationsDir = join(workspaceDir, 'presentations');
    const presentationCount = this.storage.listDir(presentationsDir).length;

    const metaFile = join(workspaceDir, 'workspace.json');
    const meta = this.storage.readJsonFile<WorkspaceMeta | null>(metaFile, null);

    if (!meta) {
      const newMeta = {
        id: this.storage.generateId(),
        name: '默认工作空间',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await this.storage.writeJsonFile(metaFile, newMeta);
      return {
        ...newMeta,
        path: workspaceDir,
        presentationCount,
      };
    }

    return {
      ...meta,
      path: workspaceDir,
      presentationCount,
    };
  }

  async updateWorkspaceName(name: string): Promise<Workspace> {
    const workspaceDir = this.storage.getWorkspaceDir();
    const metaFile = join(workspaceDir, 'workspace.json');
    const meta = this.storage.readJsonFile<WorkspaceMeta | null>(metaFile, null);

    if (!meta) {
      const newMeta = {
        id: this.storage.generateId(),
        name,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await this.storage.writeJsonFile(metaFile, newMeta);
      return {
        ...newMeta,
        path: workspaceDir,
        presentationCount: 0,
      };
    }

    const updated = {
      ...meta,
      name,
      updatedAt: Date.now(),
    };
    await this.storage.writeJsonFile(metaFile, updated);

    const presentationsDir = join(workspaceDir, 'presentations');
    const presentationCount = this.storage.listDir(presentationsDir).length;

    return {
      ...updated,
      path: workspaceDir,
      presentationCount,
    };
  }
}
