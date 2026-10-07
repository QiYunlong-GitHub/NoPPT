import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { StorageService } from '../../common/storage.service';
import type { McpAuth } from '../auth/api-key.guard';
import { ConfigController } from './config.controller';
import { ConfigService } from './config.service';

describe('ConfigService public projection', () => {
  let tmpRoot: string;
  let cwdSpy: ReturnType<typeof vi.spyOn>;
  let service: ConfigService;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'noppt-config-test-'));
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tmpRoot);
    service = new ConfigService(new StorageService());
  });

  afterEach(() => {
    cwdSpy.mockRestore();
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('migrates valid legacy image providers and ignores unknown providers safely', async () => {
    const storage = new StorageService();
    await storage.writeJsonFile(join(tmpRoot, 'data', 'config.json'), {
      imageGeneration: {
        provider: 'company-gateway',
        model: 'legacy-image-model',
        size: '768x1024',
        apiKey: 'legacy-image-key',
        baseUrl: 'https://images.example.test/v1',
      },
    });

    const migrated = await service.getConfig();
    expect(migrated.imageGeneration.activeProvider).toBe('company-gateway');
    expect(migrated.imageGeneration.providers['company-gateway']).toMatchObject({
      apiKey: 'legacy-image-key',
      baseUrl: 'https://images.example.test/v1',
      models: [
        {
          modelName: 'legacy-image-model',
          sizes: [{ width: 768, height: 1024, label: '768x1024' }],
        },
      ],
    });

    await storage.writeJsonFile(join(tmpRoot, 'data', 'config.json'), {
      imageGeneration: {
        provider: 'unknown-provider',
        model: 'legacy-image-model',
      },
    });
    await expect(service.getConfig()).resolves.toBeDefined();
    expect((await service.getConfig()).imageGeneration.activeProvider).toBe('openai');
  });

  it('redacts provider apiKey/userCode from controller responses while raw resolution works', async () => {
    await service.saveConfig({
      apiConfig: {
        openai: {
          apiKey: 'sentinel-api-key',
          userCode: 'sentinel-user-code',
          baseUrl: 'https://example.test/v1',
          models: ['sentinel-model'],
        },
      },
      imageGeneration: {
        providers: {
          openai: {
            apiKey: 'sentinel-image-key',
            baseUrl: 'https://images.example.test/v1',
            models: [],
          },
        },
      },
    } as unknown as Parameters<ConfigService['saveConfig']>[0]);

    const controller = new ConfigController(service);
    const auth = { tenantId: 'default', userKey: 'default' } as McpAuth;
    const publicConfig = await controller.getConfig(auth);
    const publicJson = JSON.stringify(publicConfig);

    expect(publicJson).not.toContain('sentinel-api-key');
    expect(publicJson).not.toContain('sentinel-user-code');
    expect(publicJson).not.toContain('sentinel-image-key');
    expect(publicConfig.apiConfig.openai).toMatchObject({
      baseUrl: 'https://example.test/v1',
      models: ['sentinel-model'],
    });
    expect('apiKey' in publicConfig.apiConfig.openai).toBe(false);
    expect('userCode' in publicConfig.apiConfig.openai).toBe(false);
    expect('apiKey' in publicConfig.imageGeneration.providers.openai).toBe(false);

    await expect(service.resolveModelConfig('content')).resolves.toMatchObject({
      apiKey: 'sentinel-api-key',
      userCode: 'sentinel-user-code',
      model: 'sentinel-model',
    });

    const putResponse = await controller.saveConfig(
      {
        interfaceSettings: { language: 'en' },
      } as unknown as Parameters<ConfigService['saveConfig']>[0],
      auth,
    );
    const resetResponse = await controller.resetConfig(auth);
    expect(JSON.stringify(putResponse)).not.toContain('sentinel-api-key');
    expect(JSON.stringify(resetResponse)).not.toContain('sentinel-api-key');
  });
});
