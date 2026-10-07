import { describe, expect, it } from 'vitest';
import { mergeConfig } from '../settings';

describe('public server settings merge', () => {
  it('keeps locally-held provider secrets when public fields are returned', () => {
    const local = {
      apiConfig: {
        openai: {
          apiKey: 'local-api-key',
          userCode: 'local-user-code',
          baseUrl: 'https://local.example/v1',
          models: ['local-model'],
        },
      },
      imageGeneration: {
        providers: {
          openai: {
            apiKey: 'local-image-key',
            baseUrl: 'https://local-images.example/v1',
            models: [],
          },
        },
      },
    };
    const serverPublic = {
      apiConfig: {
        openai: {
          baseUrl: 'https://server.example/v1',
          models: ['server-model'],
        },
      },
      imageGeneration: {
        providers: {
          openai: {
            baseUrl: 'https://server-images.example/v1',
            models: [{ modelName: 'server-image', sizes: [] }],
          },
        },
      },
    };

    const merged = mergeConfig(local, serverPublic);

    expect(merged.apiConfig.openai).toMatchObject({
      apiKey: 'local-api-key',
      userCode: 'local-user-code',
      baseUrl: 'https://server.example/v1',
      models: ['server-model'],
    });
    expect(merged.imageGeneration.providers.openai).toMatchObject({
      apiKey: 'local-image-key',
      baseUrl: 'https://server-images.example/v1',
    });
  });
});
